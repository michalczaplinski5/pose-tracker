/**
 * PoseTracker RobotLab
 * Camera tracking stays in the browser.
 * Desktop mouse is available ONLY if a local Python bridge serves this app.
 */

const PACKAGE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
  hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
};

const BODY_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]
];

const el = id => document.getElementById(id);
const ui = {
  video: el('camera'), canvas: el('overlay'), stage: el('stage'),
  start: el('start'), stop: el('stop'), message: el('message'),
  badge: el('model-badge'), badgeLabel: el('model-label'),
  tag: el('stage-tag'), fps: el('fps'),
  pose: el('show-pose'), hands: el('show-hands'), face: el('show-face'),
  lines: el('show-lines'), points: el('show-points'), mirror: el('mirror'),
  model: el('pose-model'), controlHand: el('control-hand'),
  smoothing: el('smoothing'), smoothingLabel: el('smoothing-label'),
  landmarkCount: el('landmarks-count'), handCount: el('hands-count'),
  gestureLabel: el('gesture-state'), gestureEnabled: el('gesture-enabled'),
  pointerLabel: el('pointer-state'), workspace: el('workspace'),
  cursor: el('virtual-cursor'), clickCount: el('click-count'),
  feedback: el('workspace-feedback'), desktopPanel: el('desktop-panel'),
  desktopArm: el('desktop-arm'), desktopDisarm: el('desktop-disarm'),
  desktopState: el('desktop-state')
};
const ctx = ui.canvas.getContext('2d');
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let vision = null;
let wasmFiles = null;
let poseDetector = null;
let handDetector = null;
let faceDetector = null;
let poseModelName = null;
let facePromise = null;
let stream = null;
let running = false;
let sequence = 0;
let frameId = 0;
let lastVideoTime = -1;
let frameCounter = 0;
let frameWindowStarted = 0;
let faceCounter = 0;
let facePoints = null;
let clickCounter = 0;
let lastTrackingMessage = '';

const pointer = {
  visible: false, x: .5, y: .5, pinched: false,
  pinchStarted: 0, lastClick: 0, seenAt: 0
};
const bridge = {
  local: ['127.0.0.1', 'localhost'].includes(window.location.hostname),
  available: false, armed: false, inflight: false,
  lastSend: 0, pendingClick: false
};

ui.start.addEventListener('click', startTracking);
ui.stop.addEventListener('click', stopTracking);
ui.mirror.addEventListener('change', () => ui.stage.classList.toggle('mirrored', ui.mirror.checked));
ui.smoothing.addEventListener('input', () => {
  ui.smoothingLabel.textContent = ui.smoothing.value + '%';
});
ui.model.addEventListener('change', () => {
  if (running) say('Model został zmieniony. Zatrzymaj kamerę i uruchom ją ponownie, aby zastosować zmianę.');
});
ui.face.addEventListener('change', async () => {
  if (!ui.face.checked) {
    facePoints = null;
    return;
  }
  if (running && !faceDetector) {
    const ticket = sequence;
    say('Pobieranie modelu twarzy (478 punktów)…');
    try {
      await ensureFaceModel();
      if (running && ticket === sequence) say('Śledzenie twarzy zostało włączone.', 'success');
    } catch (error) {
      console.error(error);
      ui.face.checked = false;
      say('Nie udało się włączyć detekcji twarzy: ' + (error.message || String(error)), 'error');
    }
  }
});
ui.gestureEnabled.addEventListener('change', () => {
  resetPointer();
  ui.pointerLabel.textContent = ui.gestureEnabled.checked
    ? 'Pokaż dłoń przed kamerą' : 'Tryb wyłączony';
  if (!ui.gestureEnabled.checked) void disarmDesktop();
});
ui.controlHand.addEventListener('change', resetPointer);
for (const button of document.querySelectorAll('.gesture-target')) {
  button.addEventListener('click', () => handleWorkspaceAction(button));
}
ui.desktopArm.addEventListener('click', () => void armDesktop());
ui.desktopDisarm.addEventListener('click', () => void disarmDesktop());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && bridge.armed) {
    event.preventDefault();
    void disarmDesktop();
  }
});
window.addEventListener('pagehide', stopTracking);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTracking();
});
ui.stage.classList.toggle('mirrored', ui.mirror.checked);

if (bridge.local) {
  ui.desktopPanel.hidden = false;
  void checkBridge();
}

function say(text, type = '') {
  ui.message.textContent = text;
  ui.message.className = 'message ' + type;
}

function setBadge(text, mode = '') {
  ui.badgeLabel.textContent = text;
  ui.badge.className = 'status-badge ' + mode;
}

function updateCameraState(on) {
  ui.stage.classList.toggle('active', on);
  ui.tag.hidden = !on;
  ui.start.hidden = on;
  ui.stop.hidden = !on;
  if (!on) ui.fps.textContent = '— FPS';
}

async function createTask(taskName, modelAssetPath, options) {
  const klass = vision[taskName];
  const common = Object.assign({ runningMode: 'VIDEO' }, options);
  try {
    return await klass.createFromOptions(wasmFiles, Object.assign({}, common, {
      baseOptions: { modelAssetPath, delegate: 'GPU' }
    }));
  } catch (error) {
    console.warn(taskName + ': GPU nie działa, używam CPU.', error);
    return klass.createFromOptions(wasmFiles, Object.assign({}, common, {
      baseOptions: { modelAssetPath, delegate: 'CPU' }
    }));
  }
}

async function ensureModels() {
  if (!vision) {
    vision = await import(PACKAGE + '/+esm');
    wasmFiles = await vision.FilesetResolver.forVisionTasks(PACKAGE + '/wasm');
  }
  if (!poseDetector || poseModelName !== ui.model.value) {
    say('Ładowanie modelu sylwetki: ' + ui.model.value + '…');
    const nextPose = await createTask('PoseLandmarker', MODEL_URLS[ui.model.value], {
      numPoses: 1, minPoseDetectionConfidence: .5,
      minPosePresenceConfidence: .5, minTrackingConfidence: .5
    });
    if (poseDetector) poseDetector.close();
    poseDetector = nextPose;
    poseModelName = ui.model.value;
  }
  if (!handDetector) {
    say('Ładowanie modelu dłoni (21 punktów na dłoń)…');
    handDetector = await createTask('HandLandmarker', MODEL_URLS.hands, {
      numHands: 2, minHandDetectionConfidence: .5,
      minHandPresenceConfidence: .5, minTrackingConfidence: .5
    });
  }
  if (ui.face.checked) await ensureFaceModel();
}

async function ensureFaceModel() {
  if (faceDetector) return faceDetector;
  if (!facePromise) {
    facePromise = (async () => {
      if (!vision) {
        vision = await import(PACKAGE + '/+esm');
        wasmFiles = await vision.FilesetResolver.forVisionTasks(PACKAGE + '/wasm');
      }
      const result = await createTask('FaceLandmarker', MODEL_URLS.face, {
        numFaces: 1, outputFaceBlendshapes: false, minFaceDetectionConfidence: .5,
        minFacePresenceConfidence: .5, minTrackingConfidence: .5
      });
      faceDetector = result;
      return result;
    })().finally(() => { facePromise = null; });
  }
  return facePromise;
}

async function startTracking() {
  if (running || ui.start.disabled) return;
  const ticket = ++sequence;
  ui.start.disabled = true;
  say('Otwieram kamerę…');
  setBadge('Uruchamianie…');
  let newStream = null;

  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamera wymaga HTTPS lub localhost oraz obsługiwanej przeglądarki.');
    }
    // Camera request is intentionally the first async action after a user click.
    newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 960 }, height: { ideal: 720 } }
    });
    if (ticket !== sequence) {
      newStream.getTracks().forEach(t => t.stop());
      return;
    }
    stream = newStream;
    ui.video.srcObject = stream;
    await ui.video.play();
    if (ticket !== sequence) return;
    updateCameraState(true);
    setBadge('Ładowanie AI…');
    await ensureModels();
    if (ticket !== sequence) return;
    running = true;
    lastVideoTime = -1;
    frameCounter = 0;
    frameWindowStarted = performance.now();
    faceCounter = 0;
    setBadge('Śledzenie aktywne', 'ready');
    say('AI działa. Pokaż dłonie przed kamerą; użyj szczypnięcia do kliknięcia.', 'success');
    frameId = requestAnimationFrame(processFrame);
  } catch (error) {
    if (ticket !== sequence) return;
    console.error(error);
    const reason = error.name === 'NotAllowedError'
      ? 'Odmówiono dostępu do kamery. Zezwól na kamerę i spróbuj ponownie.'
      : error.name === 'NotFoundError' ? 'Nie znaleziono kamery.'
      : error.message || String(error);
    stopTracking();
    setBadge('Błąd', 'error');
    say(reason, 'error');
  } finally {
    if (ticket === sequence) ui.start.disabled = false;
  }
}

function stopTracking() {
  sequence++;
  running = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  ui.video.pause();
  ui.video.srcObject = null;
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  updateCameraState(false);
  resetPointer();
  facePoints = null;
  ui.landmarkCount.textContent = '0';
  ui.handCount.textContent = '0';
  ui.start.disabled = false;
  setBadge(poseDetector && handDetector ? 'Modele gotowe' : 'Nieaktywne',
    poseDetector && handDetector ? 'ready' : '');
  say('Kamera wyłączona. Modele pozostają w pamięci przeglądarki.');
  if (bridge.armed) void disarmDesktop();
}

function processFrame() {
  if (!running) return;
  try {
    if (ui.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && ui.video.videoWidth) {
      const w = ui.video.videoWidth, h = ui.video.videoHeight;
      if (ui.canvas.width !== w || ui.canvas.height !== h) {
        ui.canvas.width = w;
        ui.canvas.height = h;
      }

      if (ui.video.currentTime !== lastVideoTime) {
        lastVideoTime = ui.video.currentTime;
        const now = performance.now();
        const body = ui.pose.checked ? poseDetector.detectForVideo(ui.video, now) : null;
        const hands = (ui.hands.checked || ui.gestureEnabled.checked)
          ? handDetector.detectForVideo(ui.video, now) : null;

        if (ui.face.checked && faceDetector && (++faceCounter % 3 === 0)) {
          facePoints = faceDetector.detectForVideo(ui.video, now).faceLandmarks?.[0] || null;
        }
        if (!ui.face.checked) facePoints = null;

        ctx.clearRect(0, 0, w, h);
        const pose = body?.landmarks?.[0] || null;
        const handList = hands?.landmarks || [];
        if (pose) renderPose(pose, w, h);
        for (let i = 0; i < handList.length; i++) renderHand(handList[i], w, h, i);
        if (facePoints) renderFace(facePoints, w, h);

        ui.landmarkCount.textContent = String((pose ? pose.length : 0)
          + handList.reduce((n, hand) => n + hand.length, 0)
          + (facePoints?.length || 0));
        ui.handCount.textContent = String(handList.length);
        if (ui.gestureEnabled.checked) updateGesture(hands, now);
        else if (pointer.visible) resetPointer();

        frameCounter++;
        const seconds = (now - frameWindowStarted) / 1000;
        if (seconds >= 1) {
          ui.fps.textContent = Math.round(frameCounter / seconds) + ' FPS';
          frameCounter = 0;
          frameWindowStarted = now;
        }
      }
    }
  } catch (error) {
    console.error('Błąd śledzenia:', error);
    stopTracking();
    setBadge('Błąd detekcji', 'error');
    say('Nie udało się przetworzyć klatki obrazu: ' + (error.message || String(error)), 'error');
    return;
  }
  frameId = requestAnimationFrame(processFrame);
}

function drawBones(points, connections, width, height, color, lineWidth) {
  if (!ui.lines.checked) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  for (const [a,b] of connections) {
    const p = points[a], q = points[b];
    if (!p || !q || (p.visibility ?? 1) < .4 || (q.visibility ?? 1) < .4) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
    ctx.stroke();
  }
}

function drawPoints(points, width, height, color, radius, thin = false) {
  if (!ui.points.checked) return;
  ctx.fillStyle = color;
  for (const p of points) {
    if ((p.visibility ?? 1) < .4) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderPose(points, width, height) {
  drawBones(points, BODY_CONNECTIONS, width, height, '#4de3dc', Math.max(2, width / 230));
  drawPoints(points, width, height, '#f7c76f', Math.max(2.6, width / 185));
}

function renderHand(points, width, height, index) {
  const col = index === 0 ? '#ff9a73' : '#ab8bff';
  drawBones(points, HAND_CONNECTIONS, width, height, col, Math.max(2, width / 290));
  drawPoints(points, width, height, '#f4f8ff', Math.max(2.3, width / 230));
  // Highlight the two landmarks responsible for pinch detection.
  if (ui.points.checked) drawPoints([points[4], points[8]], width, height, '#ffe071', Math.max(4, width / 140));
}

function renderFace(points, width, height) {
  drawPoints(points, width, height, '#e6a5ff', Math.max(.65, width / 900), true);
}

function resetPointer() {
  pointer.visible = false;
  pointer.pinched = false;
  pointer.pinchStarted = 0;
  ui.cursor.hidden = true;
  ui.cursor.classList.remove('pinched');
  ui.gestureLabel.textContent = '—';
  document.querySelectorAll('.gesture-target').forEach(b => b.classList.remove('gesture-hover'));
}

function chooseHand(hands) {
  const list = hands?.landmarks || [];
  if (!list.length) return null;
  const preferred = ui.controlHand.value;
  if (preferred === 'auto') return list[0];
  const labels = hands.handednesses || hands.handedness || [];
  const index = labels.findIndex(items => items?.[0]?.categoryName === preferred);
  return index >= 0 ? list[index] : null;
}

function updateGesture(results, now) {
  const hand = chooseHand(results);
  if (!hand || !hand[8] || !hand[4] || !hand[5] || !hand[17]) {
    if (pointer.visible && now - pointer.seenAt > 250) {
      resetPointer();
      ui.pointerLabel.textContent = 'Nie widać dłoni — sterowanie wstrzymane';
      if (bridge.armed) void disarmDesktop();
    }
    return;
  }

  const tip = hand[8], thumb = hand[4];
  // Normalize pinch distance relative to palm width: robust to camera distance.
  const ratio = distance(tip, thumb) / Math.max(.03, distance(hand[5], hand[17]));
  const mirroredX = ui.mirror.checked ? 1 - tip.x : tip.x;
  const targetX = clamp((mirroredX - .10) / .80, .01, .99);
  const targetY = clamp((tip.y - .10) / .80, .01, .99);
  const smoothing = Number(ui.smoothing.value) / 100;
  const shift = Math.hypot(targetX - pointer.x, targetY - pointer.y);
  const alpha = clamp(1 - .90 * smoothing + shift * .75, .12, 1);

  if (!pointer.visible || now - pointer.seenAt > 400) {
    pointer.x = targetX;
    pointer.y = targetY;
  } else {
    pointer.x += (targetX - pointer.x) * alpha;
    pointer.y += (targetY - pointer.y) * alpha;
  }
  pointer.seenAt = now;
  pointer.visible = true;
  ui.cursor.hidden = false;
  ui.cursor.style.left = (pointer.x * 100).toFixed(2) + '%';
  ui.cursor.style.top = (pointer.y * 100).toFixed(2) + '%';

  let clicked = false;
  if (!pointer.pinched) {
    if (ratio < .43) {
      if (!pointer.pinchStarted) pointer.pinchStarted = now;
      if (now - pointer.pinchStarted >= 110 && now - pointer.lastClick > 480) {
        pointer.pinched = true;
        pointer.lastClick = now;
        clicked = true;
      }
    } else {
      pointer.pinchStarted = 0;
    }
  } else if (ratio > .64) {
    pointer.pinched = false;
    pointer.pinchStarted = 0;
  }
  ui.cursor.classList.toggle('pinched', pointer.pinched);
  ui.gestureLabel.textContent = pointer.pinched ? 'Klik' : 'Ruch';
  ui.pointerLabel.textContent = pointer.pinched
    ? 'Kliknięcie rozpoznane — rozsuń palce' : 'Wskaźnik aktywny';

  const rect = ui.workspace.getBoundingClientRect();
  const posX = rect.left + pointer.x * rect.width;
  const posY = rect.top + pointer.y * rect.height;
  let hovered = null;
  for (const button of document.querySelectorAll('.gesture-target')) {
    const b = button.getBoundingClientRect();
    const inside = posX >= b.left && posX <= b.right && posY >= b.top && posY <= b.bottom;
    button.classList.toggle('gesture-hover', inside);
    if (inside) hovered = button;
  }
  if (clicked) {
    if (hovered) hovered.click();
    else ui.feedback.textContent = 'Kliknięcie poza przyciskami — spróbuj ponownie.';
  }
  if (bridge.armed) sendDesktopPointer(clicked, now);
}

function handleWorkspaceAction(button) {
  if (button.dataset.action === 'RESET') {
    clickCounter = 0;
    ui.feedback.textContent = 'Zresetowano wybór punktu.';
    document.querySelectorAll('.gesture-target').forEach(b => b.classList.remove('active'));
  } else {
    clickCounter++;
    ui.feedback.textContent = 'Wybrano punkt ' + button.dataset.action + '. Gest został poprawnie zarejestrowany!';
    document.querySelectorAll('.gesture-target').forEach(b => {
      b.classList.toggle('active', b === button);
    });
  }
  ui.clickCount.textContent = 'Kliknięcia: ' + clickCounter;
}

// Optional local Windows bridge. GitHub Pages never sends commands to the OS.
async function checkBridge() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Brak mostu');
    const data = await response.json();
    if (!data.available) throw new Error('Most nieaktywny');
    bridge.available = true;
    ui.desktopArm.disabled = false;
    ui.desktopState.textContent = 'Most lokalny gotowy';
  } catch (error) {
    bridge.available = false;
    ui.desktopState.textContent = 'Uruchom desktop_bridge.py, aby włączyć mysz systemową';
  }
}

async function postBridge(endpoint, payload) {
  const response = await fetch('/api/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Most lokalny zwrócił błąd ' + response.status);
  return response.json();
}

async function armDesktop() {
  if (!bridge.local || !bridge.available || bridge.armed || !running) {
    ui.desktopState.textContent = running ? 'Most nieaktywny' : 'Najpierw uruchom kamerę';
    return;
  }
  ui.gestureEnabled.checked = true;
  resetPointer();
  try {
    await postBridge('arm', { armed: true });
    bridge.armed = true;
    ui.desktopArm.disabled = true;
    ui.desktopDisarm.disabled = false;
    ui.desktopState.textContent = 'MYSZ UZBROJONA — Esc lub STOP, aby rozbroić';
  } catch (error) {
    bridge.armed = false;
    ui.desktopState.textContent = 'Nie udało się uzbroić: ' + error.message;
  }
}

async function disarmDesktop() {
  bridge.armed = false;
  bridge.pendingClick = false;
  ui.desktopDisarm.disabled = true;
  ui.desktopArm.disabled = !bridge.available;
  ui.desktopState.textContent = bridge.available ? 'Mysz systemowa rozbrojona' : 'Most nieaktywny';
  if (bridge.available) {
    try { await postBridge('arm', { armed: false }); }
    catch (error) { console.warn('Nie udało się rozbroić mostu:', error); }
  }
}

function sendDesktopPointer(clicked, now) {
  if (!bridge.armed || !pointer.visible) return;
  if (clicked) bridge.pendingClick = true;
  if (bridge.inflight || (!bridge.pendingClick && now - bridge.lastSend < 70)) return;
  bridge.inflight = true;
  bridge.lastSend = now;
  const data = { x: pointer.x, y: pointer.y, click: bridge.pendingClick };
  bridge.pendingClick = false;
  postBridge('mouse', data).catch(error => {
    console.warn('Mysz systemowa:', error);
    void disarmDesktop();
  }).finally(() => { bridge.inflight = false; });
}
