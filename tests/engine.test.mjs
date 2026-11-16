import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHand, calibrationFromCorners, mapPoint, PointerFilter, GestureMachine } from '../gesture-engine.mjs';

function makeHand() {
  const points = Array.from({ length: 21 }, () => ({ x: .5, y: .65 }));
  points[0] = { x: .5, y: .9 };
  for (const [index, x] of [[5,.40], [9,.46], [13,.54], [17,.62]])
    points[index] = { x, y: .55 };
  for (const [pip, tip, x] of [[6,8,.40], [10,12,.46], [14,16,.54], [18,20,.62]]) {
    points[pip] = { x, y: .45 };
    points[tip] = { x, y: .20 };
  }
  points[4] = { x: .29, y: .35 };
  return points;
}
const pos = { x: .5, y: .5 };

test('classifies open palm', () => assert.equal(classifyHand(makeHand()).kind, 'open'));
test('classifies peace without a pinch', () => {
  const hand = makeHand();
  hand[16].y = .82; hand[20].y = .82;
  assert.equal(classifyHand(hand).kind, 'peace');
});
test('classifies fist', () => {
  const hand = makeHand();
  for (const index of [8, 12, 16, 20]) hand[index].y = .83;
  assert.equal(classifyHand(hand).kind, 'fist');
});
test('pinch has hysteresis', () => {
  const hand = makeHand();
  hand[4] = { x: .401, y: .20 };
  assert.equal(classifyHand(hand).kind, 'pinch');
  hand[4] = { x: .51, y: .20 };
  assert.notEqual(classifyHand(hand, false).kind, 'pinch');
  assert.equal(classifyHand(hand, true).kind, 'pinch');
});
test('invalid frame returns none', () => assert.equal(classifyHand([]).valid, false));

test('calibration maps corners and center', () => {
  const profile = calibrationFromCorners([
    { x:.2,y:.2 }, { x:.8,y:.2 }, { x:.2,y:.8 }, { x:.8,y:.8 }
  ]);
  const center = mapPoint({ x:.5,y:.5 }, profile, 50);
  assert.ok(Math.abs(center.x-.5) < .001);
  assert.ok(Math.abs(center.y-.5) < .001);
  assert.ok(mapPoint({ x:.2,y:.2 }, profile, 50).x < .03);
});
test('calibration rejects narrow or inverted area', () => {
  assert.throws(() => calibrationFromCorners([
    {x:.45,y:.4},{x:.55,y:.4},{x:.45,y:.5},{x:.55,y:.5}
  ]));
  assert.throws(() => calibrationFromCorners([
    {x:.8,y:.2},{x:.2,y:.2},{x:.8,y:.8},{x:.2,y:.8}
  ]));
});
test('One Euro filter damps jitter but resets after lost tracking', () => {
  const f = new PointerFilter();
  f.update({ x:.5,y:.5 },0,80,0);
  const smoothed = f.update({x:.501,y:.502},40,80,0);
  assert.ok(smoothed.y < .502);
  const reacquired = f.update({x:.8,y:.8},510,80,0);
  assert.equal(reacquired.x,.8);
});
test('smoothing zero follows raw input', () => {
  const f = new PointerFilter();
  f.update({ x:.2,y:.2 },0,0,0);
  const point = f.update({x:.9,y:.8},40,0,0);
  assert.equal(point.x,.9);
  assert.equal(point.y,.8);
});
test('short pinch clicks once on release', () => {
  const m = new GestureMachine();
  m.update('pinch',1000,pos);
  m.update('pinch',1120,pos);
  assert.deepEqual(m.update('point',1170,pos).map(e=>e.type),['click']);
  assert.equal(m.update('point',1250,pos).length,0);
});
test('click cannot repeat within cooldown', () => {
  const m = new GestureMachine();
  m.update('pinch',1000,pos);m.update('point',1160,pos);
  m.update('pinch',1220,pos);const result=m.update('point',1320,pos);
  assert.equal(result.filter(e=>e.type==='click').length,0);
});
test('long pinch starts drag, movement and release ends without click', () => {
  const m = new GestureMachine();
  m.update('pinch',1000,pos);
  let actions=m.update('pinch',1450,pos).map(e=>e.type);
  assert.ok(actions.includes('dragStart'));
  assert.ok(actions.includes('dragMove'));
  actions=m.update('point',1510,pos).map(e=>e.type);
  assert.ok(actions.includes('dragEnd'));
  assert.ok(!actions.includes('click'));
});
test('loss of tracking cancels drag', () => {
  const m = new GestureMachine();
  m.update('pinch',1000,pos);m.update('pinch',1450,pos);
  assert.deepEqual(m.reset(),[{type:'dragEnd',cancelled:true}]);
});
test('manual pause cancels drag', () => {
  const m = new GestureMachine();
  m.update('pinch',1000,pos);m.update('pinch',1450,pos);
  const actions=m.setPaused(true);
  assert.ok(m.paused);
  assert.deepEqual(actions,[{type:'dragEnd',cancelled:true}]);
});
test('fist pauses and open palm resumes after dwell', () => {
  const m=new GestureMachine();
  m.update('fist',1000,pos);
  assert.equal(m.update('fist',1400,pos).length,0);
  assert.ok(m.update('fist',1900,pos).some(e=>e.type==='pause'));
  assert.ok(m.paused);
  m.update('open',2000,pos);
  assert.ok(m.update('open',2900,pos).some(e=>e.type==='resume'));
  assert.equal(m.paused,false);
});
test('peace scroll is emitted only after dwell', () => {
  const m=new GestureMachine();
  m.update('peace',1000,{x:.5,y:.3});
  assert.equal(m.update('peace',1100,{x:.5,y:.33}).length,0);
  const events=m.update('peace',1240,{x:.5,y:.43});
  assert.ok(events.some(e=>e.type==='scroll'&&e.delta>0));
  m.update('point',1300,pos);
  assert.equal(m.scrollY,null);
});
