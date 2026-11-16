import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HoloGestureController, extractHand, clamp } from '../holo-gestures.mjs';

const P = (id,x,y,pinchRatio=1,other={}) => ({
  id, point:{x,y},palm:{x,y},pinchRatio,fist:false,open:false,...other
});

function sampleHand() {
  const p = Array.from({length:21},()=>({x:.4,y:.7}));
  p[0]={x:.5,y:.9};p[5]={x:.3,y:.6};p[17]={x:.7,y:.6};
  p[8]={x:.65,y:.3};p[4]={x:.65,y:.31};
  for(const i of [6,10,14,18])p[i]={x:.45,y:.55};
  for(const i of [12,16,20])p[i]={x:.45,y:.2};
  p[9]={x:.5,y:.6};
  return p;
}

test('hand extraction returns mirrored fingertip and normalized pinch',()=>{
  const h=extractHand(sampleHand(),'Right',true);
  assert.equal(h.id,'Right');
  assert.ok(Math.abs(h.point.x-.35)<.001);
  assert.ok(h.pinchRatio<.1);
});
test('invalid hand input is ignored',()=>{
  assert.equal(extractHand([],'Left'),null);
  assert.equal(extractHand(Array(21).fill(null),'Right'),null);
});
test('single pinch grabs and then rotates in normalized space',()=>{
  const c=new HoloGestureController();
  let e=c.update([P('Right',.4,.5,.2)],1000);
  assert.ok(e.some(x=>x.type==='grab-start'));
  e=c.update([P('Right',.48,.54,.2)],1050);
  const rotate=e.find(x=>x.type==='rotate');
  assert.ok(rotate);
  assert.equal(rotate.dx,.07); // per-frame clamp prevents jumps
  assert.ok(Math.abs(rotate.dy-.04)<.001);
});
test('release pinch stops rotation and resets interaction',()=>{
  const c=new HoloGestureController();
  c.update([P('Right',.4,.5,.2)],1000);
  const e=c.update([P('Right',.4,.5,1)],1070);
  assert.ok(e.some(x=>x.type==='release'));
  assert.equal(c.mode,'idle');
});
test('two pinches enter dual mode, scale and rotate',()=>{
  const c=new HoloGestureController();
  c.update([P('Left',.3,.5,.2),P('Right',.7,.5,.2)],1000);
  let e=c.update([P('Right',.7,.5,.2),P('Left',.3,.5,.2)],1040);
  assert.ok(e.some(x=>x.type==='dual-transform'));
  e=c.update([P('Left',.26,.48,.2),P('Right',.75,.56,.2)],1090);
  const transform=e.find(x=>x.type==='dual-transform');
  assert.ok(transform.scale>1&&transform.scale<=1.15);
  assert.ok(Math.abs(transform.roll)>0);
});
test('switching single to two hands releases first grip before scaling',()=>{
  const c=new HoloGestureController();
  c.update([P('Right',.5,.5,.2)],1000);
  const e=c.update([P('Left',.2,.5,.2),P('Right',.6,.5,.2)],1040);
  assert.ok(e.some(x=>x.type==='release'));
  assert.ok(e.some(x=>x.type==='dual-start'));
});
test('tracking loss ends interaction after grace period',()=>{
  const c=new HoloGestureController();
  c.update([P('Right',.5,.5,.2)],1000);
  assert.ok(!c.update([],1080).some(x=>x.type==='release'));
  assert.ok(c.update([],1200).some(x=>x.type==='release'));
});
test('fist hold pauses, open palm hold resumes',()=>{
  const c=new HoloGestureController();
  let e=c.update([P('Right',.5,.5,1,{fist:true})],1000);
  e=c.update([P('Right',.5,.5,1,{fist:true})],1900);
  assert.equal(c.paused,true);
  assert.ok(e.some(x=>x.type==='paused'));
  c.update([P('Right',.5,.5,1,{open:true})],2000);
  e=c.update([P('Right',.5,.5,1,{open:true})],2900);
  assert.equal(c.paused,false);
  assert.ok(e.some(x=>x.type==='resumed'));
});
test('manual pause releases a pinch and ignores movement',()=>{
  const c=new HoloGestureController();
  c.update([P('Right',.5,.5,.2)],1000);
  assert.ok(c.setPaused(true).some(x=>x.type==='release'));
  const e=c.update([P('Right',.8,.3,.2)],1050);
  assert.ok(!e.some(x=>x.type==='rotate'));
});
test('high motion is bounded for stability',()=>{
  assert.equal(clamp(5,0,1),1);
  const c=new HoloGestureController();
  c.update([P('Left',.3,.5,.2),P('Right',.7,.5,.2)],1000);
  const e=c.update([P('Left',.05,.1,.2),P('Right',.95,.9,.2)],1100);
  assert.ok(e.find(x=>x.type==='dual-transform').scale<=1.15);
});
test('HoloLab markup includes controls and separate entry point',()=>{
  const html=readFileSync(new URL('../holo.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const key of ['three-canvas','scene-pointer','video','start-camera','stop-camera','pause-scene','object-scale','camera-feedback']) {
    assert.ok(html.includes('id="'+key+'"'),'missing '+key);
  }
  assert.ok(app.includes('href="./holo.html"'));
  assert.ok(html.includes('./holo.js?v=1'));
});