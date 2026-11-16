// PoseTracker — minimalna, statyczna aplikacja do śledzenia pozycji ciała.
// Biblioteka MediaPipe i model pobierane są przy pierwszym uruchomieniu.

const PACKAGE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]
];

const ui = {
  video: document.querySelector('#camera'),
  canvas: document.querySelector('#overlay'),
  stage: document.querySelector('#stage'),
  start: document.querySelector('#start'),
  stop: document.querySelector('#stop'),
  status: document.querySelector('#message'),
  badge: document.querySelector('#model-badge'),
  badgeText: document.querySelector('#model-label'),
  tag: document.querySelector('#stage-tag'),
  fps: document.querySelector('#fps'),
  lines: document.querySelector('#show-lines'),
  points: document.querySelector('#show-points'),
  mirror: document.querySelector('#mirror')
};

const ctx = ui.canvas.getContext('2d');
let detector = null;
let stream = null;
let active = false;
let frameId = 0;
let lastVideoTime = -1;
let lifecycle = 0;
let framesInWindow = 0;
let windowStarted = 0;

ui.start.addEventListener('click', startTracking);
ui.stop.addEventListener('click', stopTracking);
ui.mirror.addEventListener('change', updateMirror);
window.addEventListener('pagehide', stopTracking);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTracking();
});
updateMirror();

function updateMirror() {
  ui.stage.classList.toggle('mirrored', ui.mirror.checked);
}

function say(message, type = '') {
  ui.status.textContent = message;
  ui.status.className = `message ${type}`;
}

function setBadge(label, state = '') {
  ui.badgeText.textContent = label;
  ui.badge.className = `status-badge ${state}`;
}

function showCamera(isOn) {
  ui.stage.classList.toggle('active', isOn);
  ui.tag.hidden = !isOn;
  ui.start.hidden = isOn;
  ui.stop.hidden = !isOn;
  if (!isOn) ui.fps.textContent = '— FPS';
}

async function loadDetector() {
  if (detector) return detector;
  const vision = await import(`${PACKAGE}/+esm`);
  const assets = await vision.FilesetResolver.forVisionTasks(`${PACKAGE}/wasm`);
  const options = delegate => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  try {
    return await vision.PoseLandmarker.createFromOptions(assets, options('GPU'));
  } catch (e) {
    console.warn('Brak delegata GPU, korzystam z CPU:', e);
    say('GPU niedostępne — uruchamianie modelu na CPU…');
    return vision.PoseLandmarker.createFromOptions(assets, options('CPU'));
  }
}

async function startTracking() {
  if (active || ui.start.disabled) return;
  const session = ++lifecycle;
  ui.start.disabled = true;
  say('Proszę o zgodę na dostęp do kamery…');
  setBadge('Uruchamianie…');
  let localStream = null;

  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamera wymaga strony HTTPS lub localhost i obsługiwanej przeglądarki.');
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
    });
    if (session !== lifecycle) { localStream.getTracks().forEach(t => t.stop()); return; }
    stream = localStream;
    ui.video.srcObject = stream;
    await ui.video.play();
    if (session !== lifecycle) return;
    showCamera(true);
    say('Kamera aktywna. Trwa pobieranie modelu AI…');
    setBadge('Ładowanie modelu…');

    if (!detector) {
      const nextDetector = await loadDetector();
      if (session !== lifecycle) { nextDetector.close(); return; }
      detector = nextDetector;
    }

    if (session !== lifecycle) return;
    setBadge('Model gotowy', 'ready');
    say('Śledzenie sylwetki jest aktywne.', 'success');
    active = true;
    lastVideoTime = -1;
    windowStarted = performance.now();
    framesInWindow = 0;
    frameId = requestAnimationFrame(drawFrame);
  } catch (error) {
    if (session !== lifecycle) return;
    console.error(error);
    const reason = error.name === 'NotAllowedError'
      ? 'Nie przyznano dostępu do kamery. Zezwól na użycie kamery w ustawieniach przeglądarki.'
      : error.name === 'NotFoundError'
      ? 'Nie znaleziono dostępnej kamery.'
      : error.message || String(error);
    stopTracking();
    setBadge('Błąd uruchamiania', 'error');
    say(reason, 'error');
  } finally {
    if (session === lifecycle) ui.start.disabled = false;
  }
}

function stopTracking() {
  lifecycle += 1;
  active = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  ui.video.pause();
  ui.video.srcObject = null;
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  showCamera(false);
  ui.start.disabled = false;
  setBadge(detector ? 'Model gotowy' : 'Model nieaktywny', detector ? 'ready' : '');
  say('Kamera jest wyłączona. Możesz uruchomić ją ponownie.');
}

function drawFrame() {
  if (!active) return;
  try {
    const video = ui.video;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
      if (ui.canvas.width !== video.videoWidth || ui.canvas.height !== video.videoHeight) {
        ui.canvas.width = video.videoWidth;
        ui.canvas.height = video.videoHeight;
      }
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        const result = detector.detectForVideo(video, performance.now());
        const pose = result.landmarks?.[0];
        if (pose) drawSkeleton(pose, ui.canvas.width, ui.canvas.height);
        framesInWindow++;
      }
      const elapsed = performance.now() - windowStarted;
      if (elapsed >= 1000) {
        ui.fps.textContent = `${Math.round(framesInWindow * 1000 / elapsed)} FPS`;
        framesInWindow = 0;
        windowStarted = performance.now();
      }
    }
  } catch (error) {
    console.error('Błąd przetwarzania klatki:', error);
    stopTracking();
    say('Błąd podczas analizy obrazu. Spróbuj uruchomić kamerę ponownie.', 'error');
    return;
  }
  frameId = requestAnimationFrame(drawFrame);
}

function drawSkeleton(pose, width, height) {
  const visible = p => p && (p.visibility ?? 1) >= 0.4;
  if (ui.lines.checked) {
    ctx.strokeStyle = '#5de4e0';
    ctx.lineWidth = Math.max(2.5, width / 180);
    ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if (!visible(pose[a]) || !visible(pose[b])) continue;
      ctx.beginPath();
      ctx.moveTo(pose[a].x * width, pose[a].y * height);
      ctx.lineTo(pose[b].x * width, pose[b].y * height);
      ctx.stroke();
    }
  }
  if (ui.points.checked) {
    ctx.fillStyle = '#f6c96b';
    for (const point of pose) {
      if (!visible(point)) continue;
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, Math.max(3.2, width / 125), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
