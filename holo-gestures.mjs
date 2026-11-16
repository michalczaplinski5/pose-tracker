/**
 * PoseTracker HoloLab — pure, dependency-free spatial gesture controller.
 * Commands are intentionally limited to a visualization, never a physical robot.
 */
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const unwrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function fingersExtended(points) {
  const wrist = points[0];
  return [[8,6],[12,10],[16,14],[20,18]].map(([tip,pip]) =>
    distance(points[tip], wrist) > distance(points[pip], wrist) * 1.12);
}

/** Convert one MediaPipe 21-point hand to a stable camera-space control hand. */
export function extractHand(landmarks, id, mirror = true) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 ||
      landmarks.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const extended = fingersExtended(landmarks);
  const palmSize = Math.max(.025, distance(landmarks[5], landmarks[17]));
  return {
    id: String(id),
    point: { x: clamp(mirror ? 1 - landmarks[8].x : landmarks[8].x, 0, 1),
             y: clamp(landmarks[8].y, 0, 1) },
    palm: { x: clamp(mirror ? 1 - landmarks[9].x : landmarks[9].x, 0, 1),
            y: clamp(landmarks[9].y, 0, 1) },
    pinchRatio: distance(landmarks[4], landmarks[8]) / palmSize,
    fist: extended.every(value => !value),
    open: extended.every(Boolean),
    score: 1
  };
}

export class HoloGestureController {
  constructor() { this.reset(); }
  reset() {
    this.mode = 'idle';
    this.paused = false;
    this.lastPointers = new Map();
    this.pinch = new Map();
    this.previousDual = null;
    this.singleId = null;
    this.lastSeen = 0;
    this.hold = { type: '', started: 0, fired: false };
  }
  setPaused(flag) {
    const events = this.release();
    this.paused = !!flag;
    this.hold = { type: '', started: 0, fired: false };
    return [...events, { type: this.paused ? 'paused' : 'resumed' }];
  }
  release() {
    const events = [];
    if (this.mode !== 'idle') events.push({ type: 'release' });
    this.mode = 'idle'; this.singleId = null; this.previousDual = null;
    this.lastPointers.clear();
    // Re-arm on the next distinct pinch; do not sustain an old pinch.
    this.pinch.clear();
    return events;
  }
  update(hands, now) {
    const events = [];
    if (!Array.isArray(hands)) hands = [];
    const valid = hands.filter(h => h && h.id && h.point &&
      Number.isFinite(h.point.x) && Number.isFinite(h.point.y))
      .sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(valid.map(h => h.id));
    if (!valid.length) {
      if (now - this.lastSeen > 180) {
        events.push(...this.release());
        this.hold = { type: '', started: 0, fired: false };
        events.push({ type: 'tracking-lost' });
      }
      return events;
    }
    this.lastSeen = now;

    const freeze = valid.some(h => h.fist && h.pinchRatio > .65);
    const resume = valid.some(h => h.open && h.pinchRatio > .65);
    const holdKind = this.paused ? (resume ? 'open' : '') : (freeze ? 'fist' : '');
    if (holdKind !== this.hold.type) this.hold = { type: holdKind, started: now, fired: false };
    else if (holdKind && !this.hold.fired && now - this.hold.started > 850) {
      this.hold.fired = true;
      events.push(...this.setPaused(!this.paused));
      // Prevent a repeated toggle with an unchanged palm.
      this.hold = { type: holdKind, started: now, fired: true };
    }
    if (this.paused) return events;

    // Multiple hands tracked independently with a pinch hysteresis band.
    const gripping = [];
    for (const h of valid) {
      const was = this.pinch.get(h.id) === true;
      const pinched = h.pinchRatio < (was ? .63 : .41);
      this.pinch.set(h.id, pinched);
      if (pinched) gripping.push(h);
    }
    for (const id of this.pinch.keys()) if (!ids.has(id)) this.pinch.delete(id);

    // Always expose the pointing position for the on-screen HUD reticle.
    const pointer = gripping[0] || valid.find(h => h.id === 'Right') || valid[0];
    events.push({ type: 'pointer', x: pointer.point.x, y: pointer.point.y,
      hand: pointer.id, active: gripping.length > 0 });

    if (gripping.length >= 2) {
      const [a,b] = gripping;
      const pair = { x: (a.palm.x+b.palm.x)/2, y: (a.palm.y+b.palm.y)/2,
        distance: Math.max(.01, distance(a.palm,b.palm)), angle: angle(a.palm,b.palm) };
      if (this.mode !== 'dual') {
        if (this.mode !== 'idle') events.push({ type: 'release' });
        this.mode = 'dual'; this.singleId = null; this.previousDual = pair;
        events.push({ type: 'dual-start' });
      } else {
        const prev = this.previousDual;
        events.push({ type:'dual-transform',
          scale: clamp(pair.distance/prev.distance,.85,1.15),
          roll: clamp(unwrap(pair.angle-prev.angle),-.22,.22),
          panX:clamp(pair.x-prev.x,-.06,.06), panY:clamp(pair.y-prev.y,-.06,.06) });
        this.previousDual = pair;
      }
      return events;
    }

    if (gripping.length === 1) {
      const h = gripping[0];
      if (this.mode !== 'single' || this.singleId !== h.id) {
        if (this.mode !== 'idle') events.push({ type:'release' });
        this.mode='single'; this.singleId=h.id;
        this.lastPointers.set(h.id,{...h.point});
        this.previousDual=null;
        events.push({ type:'grab-start',hand:h.id,x:h.point.x,y:h.point.y });
      } else {
        const prev=this.lastPointers.get(h.id);
        events.push({type:'rotate',dx:clamp(h.point.x-prev.x,-.07,.07),
          dy:clamp(h.point.y-prev.y,-.07,.07)});
        this.lastPointers.set(h.id,{...h.point});
      }
      return events;
    }

    if (this.mode !== 'idle') events.push(...this.release());
    return events;
  }
}