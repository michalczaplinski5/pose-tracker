/**
 * Pure gesture primitives for PoseTracker Air Mouse V4.
 * No DOM, network, or MediaPipe dependency — safe to unit-test independently.
 */

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const usable = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

function extended(points, tip, pip) {
  const wrist = points[0];
  return distance(points[tip], wrist) > distance(points[pip], wrist) * 1.13;
}

export function classifyHand(points, wasPinched = false) {
  if (!Array.isArray(points) || points.length !== 21 ||
      ![0, 4, 5, 6, 8, 10, 12, 14, 16, 17, 18, 20].every(i => usable(points[i]))) {
    return { valid: false, kind: 'none', pinchRatio: Infinity };
  }
  const width = Math.max(0.02, distance(points[5], points[17]));
  const pinchRatio = distance(points[4], points[8]) / width;
  const finger = [
    extended(points, 8, 6),
    extended(points, 12, 10),
    extended(points, 16, 14),
    extended(points, 20, 18)
  ];
  let kind = 'other';
  // Pinch is prioritized; threshold hysteresis prevents chatter.
  if (pinchRatio < (wasPinched ? 0.64 : 0.43)) kind = 'pinch';
  else if (finger.every(v => !v)) kind = 'fist';
  else if (finger.every(Boolean)) kind = 'open';
  else if (finger[0] && finger[1] && !finger[2] && !finger[3]) kind = 'peace';
  else if (finger[0]) kind = 'point';
  return { valid: true, kind, pinchRatio, finger };
}

export function calibrationFromCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some(p => !usable(p))) {
    throw new Error('Kalibracja wymaga czterech prawidłowych punktów.');
  }
  const [tl, tr, bl, br] = corners;
  const minX = (tl.x + bl.x) / 2;
  const maxX = (tr.x + br.x) / 2;
  const minY = (tl.y + tr.y) / 2;
  const maxY = (bl.y + br.y) / 2;
  if (!(maxX - minX >= 0.12 && maxY - minY >= 0.12)) {
    throw new Error('Punkty są za blisko siebie. Rozsuń dłoń podczas kalibracji.');
  }
  // Reject corner order mistakes; horizontal and vertical edges must point forward.
  if (tr.x <= tl.x || br.x <= bl.x || bl.y <= tl.y || br.y <= tr.y) {
    throw new Error('Nieprawidłowa kolejność narożników. Rozpocznij kalibrację ponownie.');
  }
  return { minX, maxX, minY, maxY };
}

export function mapPoint(raw, calibration = null, sensitivity = 50) {
  const cal = calibration || { minX: 0.08, maxX: 0.92, minY: 0.08, maxY: 0.92 };
  const gain = 0.55 + (clamp(Number(sensitivity), 0, 100) / 100) * 0.9;
  const x = ((raw.x - cal.minX) / (cal.maxX - cal.minX) - 0.5) * gain + 0.5;
  const y = ((raw.y - cal.minY) / (cal.maxY - cal.minY) - 0.5) * gain + 0.5;
  return { x: clamp(x, 0.012, 0.988), y: clamp(y, 0.012, 0.988) };
}

// Low-latency One Euro filter with adjustable response and dead zone.
export class PointerFilter {
  constructor() { this.reset(); }
  reset() { this.last = null; this.lastRaw = null; this.time = null; this.derivative = { x: 0, y: 0 }; }
  update(point, now, smoothing = 60, deadzone = 0.3) {
    if (!this.last || this.time === null || now - this.time > 450) {
      this.last = { ...point }; this.lastRaw = { ...point }; this.time = now;
      return { ...point };
    }
    const dt = clamp((now - this.time) / 1000, 0.005, 0.25);
    this.time = now;
    const smooth = clamp(Number(smoothing), 0, 100) / 100;
    if (smooth === 0) { this.last = { ...point }; this.lastRaw = { ...point }; return { ...point }; }
    const alpha = (cutoff) => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };
    const minCutoff = 0.65 + (1 - smooth) * 2.1;
    const beta = 0.025 + (1 - smooth) * 0.55;
    const derivAlpha = alpha(1.1);
    const next = {};
    for (const axis of ['x', 'y']) {
      const d = (point[axis] - this.lastRaw[axis]) / dt;
      this.derivative[axis] += derivAlpha * (d - this.derivative[axis]);
      const cutoff = minCutoff + beta * Math.abs(this.derivative[axis]);
      const filtered = this.last[axis] + alpha(cutoff) * (point[axis] - this.last[axis]);
      next[axis] = Math.abs(filtered - this.last[axis]) < deadzone / 1000
        ? this.last[axis] : filtered;
    }
    this.last = next;
    this.lastRaw = { ...point };
    return { ...next };
  }
}

export class GestureMachine {
  constructor() { this.reset(false); }
  reset(preservePause = true) {
    const events = this.dragging ? [{ type: 'dragEnd', cancelled: true }] : [];
    this.paused = preservePause ? !!this.paused : false;
    this.kind = 'none';
    this.holdKind = '';
    this.holdStarted = -1;
    this.toggleLatched = false;
    this.pinching = false;
    this.pinchStarted = -1;
    this.dragging = false;
    this.pinchOrigin = null;
    this.lastTap = -Infinity;
    this.scrollStarted = -1;
    this.scrollY = null;
    return events;
  }
  setPaused(paused) {
    const events = this.dragging ? [{ type: 'dragEnd', cancelled: true }] : [];
    this.paused = !!paused;
    this.pinching = false; this.dragging = false; this.pinchStarted = -1;
    this.scrollStarted = -1; this.scrollY = null;
    this.holdKind = ''; this.toggleLatched = false;
    return events;
  }
  update(gesture, now, position) {
    const events = [];
    const kind = gesture || 'none';
    this.kind = kind;
    // Holding a fist pauses, holding an open palm resumes.
    const needed = this.paused ? 'open' : 'fist';
    if (kind === needed) {
      if (this.holdKind !== kind) {
        this.holdKind = kind; this.holdStarted = now; this.toggleLatched = false;
      } else if (!this.toggleLatched && now - this.holdStarted >= 850) {
        this.toggleLatched = true;
        events.push(...this.setPaused(!this.paused));
        events.push({ type: this.paused ? 'pause' : 'resume' });
        this.holdKind = kind;
        this.toggleLatched = true;
      }
    } else { this.holdKind = ''; this.toggleLatched = false; }

    if (this.paused || kind === 'none' || kind === 'fist') {
      // A disappearing or changing hand releases an active drag safely.
      if (this.dragging) {
        events.push({ type: 'dragEnd', cancelled: true });
        this.dragging = false;
      }
      this.pinching = false; this.pinchStarted = -1; this.scrollStarted = -1;
      this.scrollY = null;
      return events;
    }

    if (kind === 'pinch') {
      this.scrollStarted = -1; this.scrollY = null;
      if (!this.pinching) {
        this.pinching = true; this.pinchStarted = now;
        this.pinchOrigin = { ...position };
      } else if (!this.dragging && now - this.pinchStarted >= 430) {
        this.dragging = true;
        events.push({ type: 'dragStart', x: this.pinchOrigin.x, y: this.pinchOrigin.y });
      }
      if (this.dragging) events.push({ type: 'dragMove', x: position.x, y: position.y });
      return events;
    }

    if (this.pinching) {
      const duration = now - this.pinchStarted;
      if (this.dragging) events.push({ type: 'dragEnd', cancelled: false, x: position.x, y: position.y });
      else if (duration >= 75 && duration < 430 && now - this.lastTap >= 500) {
        events.push({ type: 'click', x: position.x, y: position.y });
        this.lastTap = now;
      }
      this.pinching = false; this.dragging = false; this.pinchStarted = -1;
    }

    if (kind === 'open') {
      this.scrollStarted = -1; this.scrollY = null;
      return events;
    }

    if (kind === 'peace') {
      if (this.scrollStarted < 0) { this.scrollStarted = now; this.scrollY = position.y; }
      else {
        const dy = position.y - this.scrollY;
        this.scrollY = position.y;
        if (now - this.scrollStarted >= 180 && Math.abs(dy) > 0.001) {
          events.push({ type: 'scroll', delta: clamp(dy * 4, -0.22, 0.22) });
        }
      }
    } else { this.scrollStarted = -1; this.scrollY = null; }
    return events;
  }
}