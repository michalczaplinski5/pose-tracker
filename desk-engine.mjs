/** HoloDesk V5 - testable gesture interpretation + inertial window physics.
 * No DOM, camera, network or Three.js dependencies.
 */
export const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
export const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));

/** Returns a stable, screen-oriented hand sample from MediaPipe's 21 landmarks. */
export function toHand(points,id='Right',mirror=true) {
  if(!Array.isArray(points)||points.length!==21||points.some(p=>!finite(p)))return null;
  const wrist=points[0];
  const extended=[[8,6],[12,10],[16,14],[20,18]].map(([tip,pip])=>
    dist(points[tip],wrist)>dist(points[pip],wrist)*1.12);
  const palmWidth=Math.max(.028,dist(points[5],points[17]));
  return {
    id:String(id),
    point:{x:clamp(mirror?1-points[8].x:points[8].x,0,1),y:clamp(points[8].y,0,1)},
    palm:{x:clamp(mirror?1-points[9].x:points[9].x,0,1),y:clamp(points[9].y,0,1)},
    pinchRatio:dist(points[4],points[8])/palmWidth,
    open:extended.every(Boolean),
    fist:extended.every(v=>!v)
  };
}

/** Gesture stream emits press/move/release and two-hand transform events. */
export class DeskGestureEngine {
  constructor(){this.reset();}
  reset(){
    this.paused=false;this.mode='idle';this.pinch=new Map();
    this.primary=null;this.previous=null;this.dualPrev=null;this.prevTime=0;
    this.v={x:0,y:0};this.lastSeen=-Infinity;this.openSince=null;
    this.fistSince=null;this.resumeSince=null;this.menuLatched=false;
    this.menuCooldown=-Infinity;
  }
  pause(value){
    const events=this.end(true);
    this.paused=!!value;
    this.openSince=null;this.fistSince=null;this.resumeSince=null;this.menuLatched=true;
    return [...events,{type:this.paused?'pause':'resume'}];
  }
  end(cancelled=false){
    const events=this.mode!=='idle'?[{type:'release',cancelled,velocity:
      cancelled?{x:0,y:0}:{...this.v}}]:[];
    this.mode='idle';this.primary=null;this.previous=null;this.dualPrev=null;
    this.v={x:0,y:0};this.pinch.clear();
    return events;
  }
  update(samples,now){
    const events=[];
    const hands=Array.isArray(samples)?samples.filter(h=>h&&h.id&&finite(h.point)&&
      finite(h.palm)&&Number.isFinite(h.pinchRatio)).sort((a,b)=>a.id.localeCompare(b.id)):[];
    if(!hands.length){
      if(now-this.lastSeen>220){
        events.push(...this.end(true));
        this.openSince=null;this.fistSince=null;this.resumeSince=null;this.menuLatched=false;
      }
      return events;
    }
    this.lastSeen=now;
    const pinchHands=[];
    for(const hand of hands){
      const was=this.pinch.get(hand.id)===true;
      const pinched=hand.pinchRatio<(was ? .62 : .40);
      this.pinch.set(hand.id,pinched);
      if(pinched)pinchHands.push(hand);
    }
    for(const id of this.pinch.keys()){
      if(!hands.some(h=>h.id===id))this.pinch.delete(id);
    }
    const lead=pinchHands[0]||hands.find(h=>h.id==='Right')||hands[0];
    events.push({type:'pointer',x:lead.point.x,y:lead.point.y,active:pinchHands.length>0});

    if(this.paused){
      const open=hands.some(h=>h.open&&h.pinchRatio>.62);
      if(open){
        if(this.resumeSince===null)this.resumeSince=now;
        if(now-this.resumeSince>=900)events.push(...this.pause(false));
      }else this.resumeSince=null;
      return events;
    }

    const fist=hands.some(h=>h.fist&&h.pinchRatio>.62);
    if(fist&&pinchHands.length===0){
      if(this.fistSince===null)this.fistSince=now;
      if(now-this.fistSince>=950){events.push(...this.pause(true));return events;}
    }else this.fistSince=null;

    const open=hands.some(h=>h.open&&h.pinchRatio>.62);
    if(open&&pinchHands.length===0&&this.mode==='idle'){
      if(this.openSince===null)this.openSince=now;
      if(!this.menuLatched&&now-this.openSince>=700&&now-this.menuCooldown>=1600){
        this.menuLatched=true;this.menuCooldown=now;
        events.push({type:'menu',x:lead.palm.x,y:lead.palm.y});
      }
    }else{
      this.openSince=null;
      this.menuLatched=false;
    }
    if(pinchHands.length>=2){
      const [a,b]=pinchHands;
      const pair={
        x:(a.palm.x+b.palm.x)/2,
        y:(a.palm.y+b.palm.y)/2,
        width:Math.max(.025,dist(a.palm,b.palm)),
        angle:Math.atan2(b.palm.y-a.palm.y,b.palm.x-a.palm.x)
      };
      if(this.mode!=='dual'){
        events.push(...this.end(true));
        this.mode='dual';this.dualPrev=pair;this.pinch.set(a.id,true);this.pinch.set(b.id,true);
        events.push({type:'dual-start',x:pair.x,y:pair.y});
      }else{
        const prev=this.dualPrev;
        events.push({
          type:'dual',scale:clamp(pair.width/prev.width,.82,1.18),
          rotation:clamp(wrapAngle(pair.angle-prev.angle),-.22,.22),
          dx:clamp(pair.x-prev.x,-.075,.075),
          dy:clamp(pair.y-prev.y,-.075,.075)
        });
        this.dualPrev=pair;
      }
      return events;
    }
    if(pinchHands.length===1){
      const hand=pinchHands[0];
      if(this.mode!=='single'||this.primary!==hand.id){
        events.push(...this.end(true));
        this.mode='single';this.primary=hand.id;this.previous={...hand.point};
        this.prevTime=now;this.pinch.set(hand.id,true);
        events.push({type:'press',x:hand.point.x,y:hand.point.y,hand:hand.id});
      }else{
        const dt=clamp((now-this.prevTime)/1000,.015,.16);
        const dx=clamp(hand.point.x-this.previous.x,-.085,.085);
        const dy=clamp(hand.point.y-this.previous.y,-.085,.085);
        this.v.x=clamp(this.v.x*.55+(dx/dt)*.45,-1.8,1.8);
        this.v.y=clamp(this.v.y*.55+(dy/dt)*.45,-1.8,1.8);
        this.previous={...hand.point};this.prevTime=now;
        events.push({type:'move',dx,dy,x:hand.point.x,y:hand.point.y});
      }
      return events;
    }
    events.push(...this.end(false));
    return events;
  }
}

/** Unit-compatible inertial motion; values are screen width/height fractions. */
export class Inertia {
  constructor(){this.x=0;this.y=0;this.vx=0;this.vy=0;}
  launch(vx,vy){
    this.vx=clamp(Number(vx)||0,-1.4,1.4);
    this.vy=clamp(Number(vy)||0,-1.4,1.4);
  }
  stop(){this.vx=0;this.vy=0;}
  step(dt,position){
    const seconds=clamp(dt,0,.06);
    if(Math.abs(this.vx)+Math.abs(this.vy)<.015){this.stop();return {...position};}
    let x=position.x+this.vx*seconds,y=position.y+this.vy*seconds;
    const decay=Math.exp(-6.5*seconds);
    this.vx*=decay;this.vy*=decay;
    if(x<.12||x>.88){x=clamp(x,.12,.88);this.vx*=-.2;}
    if(y<.13||y>.87){y=clamp(y,.13,.87);this.vy*=-.2;}
    return {x,y};
  }
}
