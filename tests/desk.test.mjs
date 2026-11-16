import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DeskGestureEngine, DeskPointerFilter, Inertia, toHand } from '../desk-engine.mjs';

const P=(id,x=.5,y=.5,pinchRatio=1,extra={})=>({
  id,point:{x,y},palm:{x,y},pinchRatio,open:false,fist:false,...extra
});
const types=events=>events.map(event=>event.type);
const one=(e,t)=>e.find(v=>v.type===t);

function handSample(){
  const a=Array.from({length:21},()=>({x:.5,y:.7}));
  a[0]={x:.5,y:.93};a[5]={x:.35,y:.58};a[9]={x:.48,y:.52};a[17]={x:.66,y:.59};
  for(const [pip,tip,x] of [[6,8,.35],[10,12,.46],[14,16,.56],[18,20,.66]]){
    a[pip]={x,y:.43};a[tip]={x,y:.19};
  }
  a[4]={x:.18,y:.38};
  return a;
}
test('MediaPipe 21-point hands normalize correctly',()=>{
  const hand=toHand(handSample(),'Right',true);
  assert.equal(hand.id,'Right');
  assert.ok(Math.abs(hand.point.x-.65)<1e-9);
  assert.equal(hand.open,true);
});
test('invalid points are rejected without crashing',()=>{
  assert.equal(toHand([]),null);
  assert.equal(toHand(Array(21).fill(null)),null);
});
test('mirroring changes x but preserves y',()=>{
  const a=toHand(handSample(),'Left',false),b=toHand(handSample(),'Left',true);
  assert.equal(a.point.x+b.point.x,1);
  assert.equal(a.point.y,b.point.y);
});
test('finger posture identifies fist',()=>{
  const hand=handSample();
  for(const i of [8,12,16,20])hand[i]={x:hand[i].x,y:.83};
  assert.equal(toHand(hand).fist,true);
});
test('single pinch starts grip, movement emits deltas, release preserves velocity',()=>{
  const e=new DeskGestureEngine();
  assert.ok(types(e.update([P('Right',.3,.4,.2)],1000)).includes('press'));
  const move=e.update([P('Right',.42,.48,.2)],1040);
  assert.ok(types(move).includes('move'));
  assert.ok(one(move,'move').dx<=.085);
  e.update([P('Right',.44,.5,1.25)],1110);
  const end=e.update([P('Right',.44,.5,1.25)],1230);
  assert.ok(types(end).includes('release'));
  assert.ok(one(end,'release').velocity.x>0);
  assert.equal(e.mode,'idle');
});
test('pinch hysteresis avoids flicker near threshold',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.3,.4,.2)],1000);
  assert.equal(e.mode,'single');
  e.update([P('Right',.3,.4,.52)],1050);
  assert.equal(e.mode,'single');
  e.update([P('Right',.3,.4,1.25)],1100);
  assert.equal(e.mode,'single'); // release confirmation avoids one-frame jitter
  e.update([P('Right',.3,.4,1.25)],1210);
  assert.equal(e.mode,'idle');
});
test('two simultaneous pinches emit scale, rotation, pan deltas',()=>{
  const e=new DeskGestureEngine();
  const before=e.update([P('Left',.3,.45,.2),P('Right',.7,.45,.2)],1000);
  assert.ok(types(before).includes('dual-start'));
  const next=e.update([P('Left',.24,.42,.2),P('Right',.75,.54,.2)],1040);
  const t=one(next,'dual');
  assert.ok(t);
  assert.ok(t.scale>1);
  assert.ok(t.rotation>0);
  assert.ok(Math.abs(t.dx)<=.075);
  assert.equal(e.mode,'dual');
});
test('switching from one to two hands releases old grip safely',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.7,.5,.2)],1000);
  const actions=e.update([P('Left',.2,.5,.2),P('Right',.7,.5,.2)],1050);
  assert.ok(one(actions,'release').cancelled);
  assert.ok(types(actions).includes('dual-start'));
});
test('tracking loss cancels grip after short grace',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.5,.4,.2)],1000);
  assert.ok(!types(e.update([],1100)).includes('release'));
  assert.ok(one(e.update([],1360),'release').cancelled);
  assert.equal(e.mode,'idle');
});
test('open palm held 700 ms emits radial menu once',()=>{
  const e=new DeskGestureEngine();
  const palm=P('Right',.55,.3,1,{open:true});
  assert.ok(!types(e.update([palm],1000)).includes('menu'));
  assert.ok(!types(e.update([palm],1300)).includes('menu'));
  assert.ok(types(e.update([palm],1900)).includes('menu'));
  assert.ok(!types(e.update([palm],2100)).includes('menu'));
});
test('radial menu gesture does not activate while gripping an object',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.4,.4,.2)],1000);
  const open=P('Left',.7,.4,1,{open:true});
  assert.ok(!types(e.update([P('Right',.4,.4,.2),open],1800)).includes('menu'));
});
test('fist held 950 ms pauses controls',()=>{
  const e=new DeskGestureEngine(),f=P('Right',.5,.5,1,{fist:true});
  e.update([f],1000);
  assert.ok(!types(e.update([f],1500)).includes('pause'));
  assert.ok(types(e.update([f],2050)).includes('pause'));
  assert.equal(e.paused,true);
});
test('open palm resumes after pause',()=>{
  const e=new DeskGestureEngine(),p=P('Right',.5,.5,1,{open:true});
  e.pause(true);
  assert.ok(!types(e.update([p],1000)).includes('resume'));
  assert.ok(types(e.update([p],1920)).includes('resume'));
  assert.equal(e.paused,false);
});
test('manual pause cancels held window and resumes cleanly',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.5,.5,.2)],1000);
  const events=e.pause(true);
  assert.ok(one(events,'release').cancelled);
  assert.ok(types(events).includes('pause'));
  assert.ok(!types(e.update([P('Right',.6,.5,.2)],1100)).includes('press'));
  e.pause(false);
  assert.equal(e.paused,false);
});
test('inertial throw decays over time without runaway',()=>{
  const motion=new Inertia();
  motion.launch(1.1,-.7);
  let pos={x:.5,y:.5};
  for(let i=0;i<60;i++)pos=motion.step(1/60,pos);
  assert.ok(pos.x>.5&&pos.x<.9);
  assert.ok(pos.y<.5&&pos.y>=.13);
  assert.ok(Math.abs(motion.vx)<.02);
});
test('inertia clamps at screen edges with bounce',()=>{
  const motion=new Inertia();
  motion.launch(1.4,1.4);
  const p=motion.step(.06,{x:.87,y:.86});
  assert.ok(p.x<=.88);
  assert.ok(p.y<=.87);
  assert.ok(motion.vx<0&&motion.vy<0);
});
test('all old demos and dedicated HoloDesk are present',()=>{
  const root=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const holo=readFileSync(new URL('../holo.html',import.meta.url),'utf8');
  const desk=readFileSync(new URL('../desk.html',import.meta.url),'utf8');
  assert.ok(root.includes('app.js?v=4'));
  assert.ok(holo.includes('holo.js?v=1'));
  for(const id of ['workspace','radial-menu','window-layer','image-input','glb-input',
    'camera-start','model-canvas','notes-editor','gesture-pointer'])assert.ok(desk.includes('id="'+id+'"'),id);
  assert.ok(desk.includes('desk.js?v=51'));
  assert.ok(desk.includes('type="importmap"'));
});


test('medium pinch requires a short confirmation instead of one noisy frame',()=>{
  const e=new DeskGestureEngine();
  assert.ok(!types(e.update([P('Right',.4,.4,.5)],1000)).includes('press'));
  assert.ok(!types(e.update([P('Right',.4,.4,1.2)],1040)).includes('press'));
  assert.ok(!types(e.update([P('Right',.4,.4,.5)],1100)).includes('press'));
  assert.ok(types(e.update([P('Right',.4,.4,.5)],1190)).includes('press'));
});
test('single frame of false open-pinch distance does not release the held window',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.4,.4,.19)],1000);
  assert.equal(e.mode,'single');
  e.update([P('Right',.4,.4,1.12)],1040);
  e.update([P('Right',.4,.4,.3)],1080);
  assert.equal(e.mode,'single');
});
test('short dropout in both hands preserves grip, prolonged dropout cancels it',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Right',.4,.4,.1)],1000);
  e.update([],1190);
  assert.equal(e.mode,'single');
  const lost=e.update([],1320);
  assert.ok(one(lost,'release').cancelled);
});
test('two-hand mode tolerates brief occlusion of one hand',()=>{
  const e=new DeskGestureEngine();
  e.update([P('Left',.2,.5,.1),P('Right',.8,.5,.1)],1000);
  assert.equal(e.mode,'dual');
  e.update([P('Right',.8,.5,.1)],1070);
  assert.equal(e.mode,'dual');
});
test('adaptive pointer mapping covers workspace from a shorter comfortable hand range',()=>{
  const f=new DeskPointerFilter();
  const a=f.update({x:.24,y:.25},1000,{profile:{minX:.24,maxX:.76,minY:.25,maxY:.78}});
  assert.ok(a.x<.03&&a.y<.035);
  f.reset();
  const b=f.update({x:.76,y:.78},1200,{profile:{minX:.24,maxX:.76,minY:.25,maxY:.78}});
  assert.ok(b.x>.96&&b.y>.96);
});
test('pointer smoothing reduces jitter and resets after tracking gap',()=>{
  const f=new DeskPointerFilter();
  f.update({x:.5,y:.5},1000,{smooth:85});
  const a=f.update({x:.52,y:.51},1040,{smooth:85});
  assert.ok(a.x<.527);
  const b=f.update({x:.8,y:.8},1600,{smooth:85});
  assert.ok(b.x>.85);
});
