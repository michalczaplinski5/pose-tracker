/**
 * PoseTracker HoloDesk V5.1 — robust camera input primitives.
 * Pure, testable gesture state machine: no DOM or MediaPipe dependency.
 */
export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const elapsed=(now,start)=>start===null?0:now-start;

/**
 * Uses the angle at each PIP joint rather than only tip-to-wrist distance.
 * This works better for tilted or partially rotated hands.
 */
export function toHand(points,id='Right',mirror=true){
  if(!Array.isArray(points)||points.length!==21||points.some(p=>!finite(p)))return null;
  const extension=[[5,6,8],[9,10,12],[13,14,16],[17,18,20]].map(([m,p,t])=>{
    const a={x:points[m].x-points[p].x,y:points[m].y-points[p].y};
    const b={x:points[t].x-points[p].x,y:points[t].y-points[p].y};
    const dot=(a.x*b.x+a.y*b.y)/(Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y)+1e-6);
    const angle=Math.acos(clamp(dot,-1,1))*180/Math.PI;
    return angle>144 && dist(points[t],points[0])>=dist(points[p],points[0])*.90;
  });
  const palmWidth=Math.max(.048,dist(points[5],points[17]),dist(points[0],points[9])*.76);
  const thumb=points[4],index=points[8],mid={x:(thumb.x+index.x)/2,y:(thumb.y+index.y)/2};
  const conv=p=>({x:clamp(mirror?1-p.x:p.x,0,1),y:clamp(p.y,0,1)});
  const pinchRatio=dist(thumb,index)/palmWidth;
  return {
    id:String(id),
    point:conv(index),palm:conv(points[9]),pinchPoint:conv(mid),
    pinchRatio,extended:extension,
    // Tolerate one partially occluded finger; timed holds suppress spurious triggers.
    open:extension.filter(Boolean).length>=3&&pinchRatio>.58,
    fist:extension.filter(Boolean).length<=1&&pinchRatio>.48
  };
}

/**
 * Fast when the hand moves, smooth when it stops; no visible snap after re-acquisition.
 * Normalized coordinates map central portion of camera to whole interaction workspace.
 */
export class DeskPointerFilter{
  constructor(){this.reset();}
  reset(){this.point=null;this.last=0;}
  update(raw,now,options={}){
    const reach=clamp(Number(options.reach??72),45,100)/100;
    const smooth=clamp(Number(options.smooth??55),0,100)/100;
    const half=reach/2;
    const profile=options.profile;
    const defaultBounds={minX:.5-half,maxX:.5+half,minY:.5-half,maxY:.5+half};
    const valid=profile&&[profile.minX,profile.maxX,profile.minY,profile.maxY].every(Number.isFinite)&&
      profile.maxX-profile.minX>.12&&profile.maxY-profile.minY>.12;
    const bounds=valid?profile:defaultBounds;
    const desired={
      x:clamp((raw.x-bounds.minX)/(bounds.maxX-bounds.minX),.02,.98),
      y:clamp((raw.y-bounds.minY)/(bounds.maxY-bounds.minY),.025,.975)
    };
    if(!this.point||now-this.last>400){
      this.last=now;this.point=desired;return {...desired};
    }
    const dt=clamp((now-this.last)/1000,.01,.15);
    const travel=dist(desired,this.point);
    const velocity=travel/dt;
    // Lower smoothing at high speed, greater suppression for camera jitter.
    const minAlpha=.17+(1-smooth)*.40;
    const alpha=clamp(minAlpha+velocity*.10,minAlpha,.88);
    const next={x:this.point.x+(desired.x-this.point.x)*alpha,
      y:this.point.y+(desired.y-this.point.y)*alpha};
    this.last=now;this.point=next;
    return {...next};
  }
}

export class DeskGestureEngine{
  constructor(config={}){
    this.config={start:.67,end:1.00,onMs:60,offMs:100,menuMs:850,fistMs:1000,...config};
    this.reset();
  }
  setConfig(next){
    const c=this.config;
    if(Number.isFinite(next.start))c.start=clamp(next.start,.33,.87);
    if(Number.isFinite(next.end))c.end=clamp(next.end,c.start+.18,1.25);
    if(Number.isFinite(next.onMs))c.onMs=clamp(next.onMs,0,160);
    if(Number.isFinite(next.offMs))c.offMs=clamp(next.offMs,0,220);
  }
  reset(){
    this.paused=false;this.mode='idle';this.primary=null;this.previous=null;
    this.dualPrev=null;this.prevTime=0;this.lastMotion=0;
    this.v={x:0,y:0};this.pinch=new Map();this.transitions=new Map();
    this.handSeen=new Map();this.lastSeen=-Infinity;this.lastPair=-Infinity;
    this.tracking=false;
    this.openSince=null;this.lastOpen=-Infinity;this.fistSince=null;
    this.lastFist=-Infinity;this.resumeSince=null;this.lastResume=-Infinity;
    this.menuLatched=false;this.menuCooldown=-Infinity;
  }
  pause(flag){
    const events=this.end(true);
    this.paused=!!flag;this.openSince=null;this.fistSince=null;this.resumeSince=null;
    this.menuLatched=true;
    return [...events,{type:this.paused?'pause':'resume'}];
  }
  end(cancelled=false,keepPinch=false){
    const velocity=cancelled||this.prevTime-this.lastMotion>120?
      {x:0,y:0}:{...this.v};
    const events=this.mode!=='idle'?[{type:'release',cancelled,velocity}]:[];
    this.mode='idle';this.primary=null;this.previous=null;this.dualPrev=null;
    this.v={x:0,y:0};
    if(!keepPinch){this.pinch.clear();this.transitions.clear();}
    return events;
  }
  stablePinch(hand,now){
    const state=this.pinch.get(hand.id)===true;
    let transition=this.transitions.get(hand.id)||{on:null,off:null};
    const ratio=hand.pinchRatio;
    if(state){
      transition.on=null;
      if(ratio>this.config.end){
        if(transition.off===null)transition.off=now;
        if(elapsed(now,transition.off)>=this.config.offMs || ratio>this.config.end+.7){
          this.pinch.set(hand.id,false);
          transition.off=null;
        }
      }else transition.off=null;
    }else{
      transition.off=null;
      if(ratio<this.config.start&&!hand.fist){
        if(transition.on===null)transition.on=now;
        if(elapsed(now,transition.on)>=this.config.onMs ||
          ratio<this.config.start*.43){
          this.pinch.set(hand.id,true);
          transition.on=null;
        }
      }else transition.on=null;
    }
    this.transitions.set(hand.id,transition);
    return this.pinch.get(hand.id)===true;
  }
  update(samples,now){
    const events=[];
    const hands=Array.isArray(samples)?samples.filter(h=>
      h&&typeof h.id==='string'&&finite(h.point)&&finite(h.palm)&&Number.isFinite(h.pinchRatio))
      .sort((a,b)=>a.id.localeCompare(b.id)):[];
    if(!hands.length){
      if(now-this.lastSeen>300){
        events.push(...this.end(true));
        if(this.tracking)events.push({type:'tracking-lost'});
        this.tracking=false;
        this.openSince=null;this.resumeSince=null;this.fistSince=null;this.menuLatched=false;
      }
      return events;
    }
    this.tracking=true;
    this.lastSeen=now;
    const pinchHands=[];
    for(const hand of hands){
      const last=this.handSeen.get(hand.id);
      if(last!==undefined&&now-last>260){
        this.pinch.delete(hand.id);this.transitions.delete(hand.id);
      }
      this.handSeen.set(hand.id,now);
      if(this.stablePinch(hand,now))pinchHands.push(hand);
    }
    for(const id of [...this.handSeen.keys()]){
      if(now-this.handSeen.get(id)>280){
        this.handSeen.delete(id);this.pinch.delete(id);this.transitions.delete(id);
      }
    }
    const lead=pinchHands[0]||hands.find(h=>h.id==='Right')||hands[0];
    events.push({
      type:'pointer',x:lead.point.x,y:lead.point.y,
      pinching:pinchHands.length>0,active:pinchHands.length>0,
      ratio:lead.pinchRatio,hand:lead.id
    });
    if(this.paused){
      const resume=hands.some(h=>h.open);
      if(resume){
        if(this.resumeSince===null)this.resumeSince=now;
        this.lastResume=now;
        if(elapsed(now,this.resumeSince)>=900)events.push(...this.pause(false));
      }else if(now-this.lastResume>150)this.resumeSince=null;
      return events;
    }

    const fist=hands.some(h=>h.fist)&&pinchHands.length===0;
    if(fist){
      if(this.fistSince===null)this.fistSince=now;
      this.lastFist=now;
      if(elapsed(now,this.fistSince)>=this.config.fistMs){
        events.push(...this.pause(true));return events;
      }
    }else if(now-this.lastFist>180)this.fistSince=null;

    const open=hands.some(h=>h.open)&&!pinchHands.length&&this.mode==='idle';
    if(open){
      if(this.openSince===null)this.openSince=now;
      this.lastOpen=now;
      if(!this.menuLatched&&elapsed(now,this.openSince)>=this.config.menuMs&&
         now-this.menuCooldown>=1800){
        this.menuLatched=true;this.menuCooldown=now;
        events.push({type:'menu',x:lead.palm.x,y:lead.palm.y});
      }
    }else if(now-this.lastOpen>160){
      this.openSince=null;this.menuLatched=false;
    }

    if(pinchHands.length>=2){
      const [a,b]=pinchHands;
      const pair={
        x:(a.palm.x+b.palm.x)/2,y:(a.palm.y+b.palm.y)/2,
        width:Math.max(.028,dist(a.palm,b.palm)),
        angle:Math.atan2(b.palm.y-a.palm.y,b.palm.x-a.palm.x)
      };
      this.lastPair=now;
      if(this.mode!=='dual'){
        events.push(...this.end(true,true));
        this.mode='dual';this.dualPrev=pair;
        events.push({type:'dual-start',x:pair.x,y:pair.y});
      }else{
        const prev=this.dualPrev;
        events.push({type:'dual',scale:clamp(pair.width/prev.width,.92,1.08),
          rotation:clamp(wrap(pair.angle-prev.angle),-.12,.12),
          dx:clamp(pair.x-prev.x,-.038,.038),
          dy:clamp(pair.y-prev.y,-.038,.038)});
        this.dualPrev=pair;
      }
      return events;
    }
    // Keep a two-handed transform briefly when one hand is temporarily occluded.
    if(this.mode==='dual'&&now-this.lastPair<160)return events;
    if(pinchHands.length===1){
      const hand=pinchHands[0];
      if(this.mode!=='single'||this.primary!==hand.id){
        events.push(...this.end(true,true));
        this.mode='single';this.primary=hand.id;
        this.previous={...hand.point};this.prevTime=now;this.lastMotion=now;
        events.push({type:'press',x:hand.point.x,y:hand.point.y,hand:hand.id});
      }else{
        const dt=clamp((now-this.prevTime)/1000,.015,.16);
        const dx=clamp(hand.point.x-this.previous.x,-.06,.06);
        const dy=clamp(hand.point.y-this.previous.y,-.06,.06);
        const speed=dist({x:dx,y:dy},{x:0,y:0});
        if(speed>.0025)this.lastMotion=now;
        this.v.x=clamp(this.v.x*.72+(dx/dt)*.28,-1.3,1.3);
        this.v.y=clamp(this.v.y*.72+(dy/dt)*.28,-1.3,1.3);
        if(speed<.003){this.v.x*=.7;this.v.y*=.7;}
        this.previous={...hand.point};this.prevTime=now;
        events.push({type:'move',dx,dy,x:hand.point.x,y:hand.point.y});
      }
      return events;
    }
    events.push(...this.end(false,true));
    return events;
  }
}

export class Inertia{
  constructor(){this.vx=0;this.vy=0;}
  launch(vx,vy){
    this.vx=clamp(Number(vx)||0,-1.4,1.4);
    this.vy=clamp(Number(vy)||0,-1.4,1.4);
  }
  stop(){this.vx=0;this.vy=0;}
  step(dt,position){
    const seconds=clamp(dt,0,.06);
    if(Math.abs(this.vx)+Math.abs(this.vy)<.015){this.stop();return {...position};}
    let x=position.x+this.vx*seconds,y=position.y+this.vy*seconds;
    const decay=Math.exp(-6.5*seconds);this.vx*=decay;this.vy*=decay;
    if(x<.12||x>.88){x=clamp(x,.12,.88);this.vx*=-.2;}
    if(y<.13||y>.87){y=clamp(y,.13,.87);this.vy*=-.2;}
    return {x,y};
  }
}
