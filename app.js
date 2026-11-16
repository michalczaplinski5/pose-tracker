import { classifyHand, calibrationFromCorners, mapPoint, PointerFilter, GestureMachine } from './gesture-engine.mjs';
// PoseTracker Air Mouse V4 — multi-gesture camera-first interface.
// No camera frames are uploaded. The optional Windows bridge only accepts pointer commands.
const PACKAGE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const URLS = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
};
const HAND_EDGES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];
const BODY_EDGES = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32]
];
const el = id => document.getElementById(id);
const ui = {
  video:el('camera'),canvas:el('overlay'),stage:el('stage'),start:el('start'),
  stop:el('stop'),message:el('message'),model:el('model-label'),
  dot:el('model-dot'),globalDot:el('global-dot'),globalText:el('global-status'),
  fps:el('fps'),live:el('camera-live'),handsBadge:el('camera-hands'),
  handsCount:el('hands-count'),pointCount:el('landmarks-count'),
  clickCount:el('click-count'),clicksMetric:el('clicks-metric'),
  gesture:el('gesture-state'),pointerStatus:el('pointer-state'),
  workspace:el('workspace'),feedback:el('workspace-feedback'),cursor:el('virtual-cursor'),
  body:el('show-pose'),face:el('show-face'),poseModel:el('pose-model'),
  handChoice:el('control-hand'),smooth:el('smoothing'),smoothLabel:el('smoothing-label'),
  mirror:el('mirror'),lines:el('show-lines'),points:el('show-points'),
  desktopPanel:el('desktop-panel'),desktopArm:el('desktop-arm'),
  desktopDisarm:el('desktop-disarm'),desktopState:el('desktop-state'),
  pause:el('pause-toggle'), demoTabs:[...document.querySelectorAll('.demo-tab')],
  demoClick:el('demo-click'),demoDrag:el('demo-drag'),demoScroll:el('demo-scroll'),
  dragLane:el('drag-lane'),dragCard:el('drag-card'),dropZone:el('drop-zone'),
  scrollArea:el('scroll-area'), sensitivity:el('sensitivity'),
  sensitivityLabel:el('sensitivity-label'),deadzone:el('deadzone'),
  deadzoneLabel:el('deadzone-label'),
  calStart:el('calibration-start'),calReset:el('calibration-reset'),
  calStatus:el('calibration-status'),calOverlay:el('calibration-overlay'),
  calStep:el('calibration-step'),calCross:el('calibration-cross'),
  calPrompt:el('calibration-prompt'),calCapture:el('calibration-capture'),
  calCancel:el('calibration-cancel')
};
const ctx = ui.canvas.getContext('2d');
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const targets = [...document.querySelectorAll('.gesture-target')];
const localBridge = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
let vision=null,fileset=null,handModel=null,poseModel=null,faceModel=null,poseVariant='';
let poseLoading=null,faceLoading=null,stream=null,running=false,epoch=0,raf=0;
let lastFrame=-1,lastHandsAt=0,lastPoseAt=0,lastFaceAt=0,lastFpsAt=0,frames=0;
let bodyPoints=null,facePoints=null,lastHandCount=0,lastModelError='',clicks=0;
const pointer={visible:false,x:.5,y:.5,pinched:false,pinchStart:0,lastClick:-9999,lastSeen:0,preferredLabel:null};
const bridge={available:false,armed:false,busy:false,lastSend:0,queue:[]};
const filter=new PointerFilter(), gestures=new GestureMachine();
const calibration={active:false,points:[],lastRaw:null,profile:null};
const demo={mode:'click',dragging:false,cardX:.15,cardY:.5,offsetX:0,offsetY:0};
const CAL_STEPS=[
  {title:'lewy górny róg',x:12,y:17},
  {title:'prawy górny róg',x:88,y:17},
  {title:'lewy dolny róg',x:12,y:83},
  {title:'prawy dolny róg',x:88,y:83}
];

ui.start.addEventListener('click',start);
ui.stop.addEventListener('click',stop);
ui.mirror.addEventListener('change',()=>{
  ui.stage.classList.toggle('mirrored',ui.mirror.checked);
  calibration.profile=loadCalibration();
  filter.reset();updateCalibrationStatus();
  if(calibration.active)cancelCalibration();
});
ui.smooth.addEventListener('input',()=>ui.smoothLabel.textContent=ui.smooth.value+'%');
ui.sensitivity.addEventListener('input',()=>ui.sensitivityLabel.textContent=ui.sensitivity.value+'%');
ui.deadzone.addEventListener('input',()=>ui.deadzoneLabel.textContent=Number(ui.deadzone.value).toFixed(1).replace('.',','));
ui.pause.addEventListener('click',()=>pauseGestures(!gestures.paused));
ui.demoTabs.forEach(tab=>tab.addEventListener('click',()=>selectDemo(tab.dataset.demo)));
ui.calStart.addEventListener('click',startCalibration);
ui.calReset.addEventListener('click',resetCalibration);
ui.calCancel.addEventListener('click',cancelCalibration);
ui.calCapture.addEventListener('click',captureCalibrationPoint);

ui.body.addEventListener('change',()=>{if(ui.body.checked&&running)void enablePose();else if(!ui.body.checked){bodyPoints=null;recountPoints();}});
ui.face.addEventListener('change',()=>{if(ui.face.checked&&running)void enableFace();else if(!ui.face.checked){facePoints=null;recountPoints();}});
ui.poseModel.addEventListener('change',()=>{if(ui.body.checked&&running)void enablePose();});
ui.handChoice.addEventListener('change',clearPointer);
targets.forEach(button=>button.addEventListener('click',()=>clickTarget(button)));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.addEventListener('pagehide',stop);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(calibration.active)cancelCalibration();
    pauseGestures(true);
    if(bridge.armed)void disarmDesktop();
  } else if(event.key.toLowerCase()==='p'&&
    !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){
    pauseGestures(!gestures.paused);
  }
});
ui.desktopArm.addEventListener('click',()=>void armDesktop());
ui.desktopDisarm.addEventListener('click',()=>void disarmDesktop());
ui.stage.classList.toggle('mirrored',ui.mirror.checked);
calibration.profile=loadCalibration();
updateCalibrationStatus();
selectDemo('click');
syncPauseUI();
if(localBridge){ui.desktopPanel.hidden=false;void probeBridge();}

function status(text,kind=''){
  ui.message.textContent=text;
  ui.message.className='status'+(kind?' '+kind:'');
}
function statusBadge(text,kind=''){
  ui.model.textContent=text;
  ui.dot.className='tag-dot'+(kind?' '+kind:'');
  ui.globalText.textContent=text;
  ui.globalDot.className='live-indicator'+(kind?' '+(kind==='ready'?'live':kind):'');
}
function showCamera(on){
  ui.stage.classList.toggle('active',on);
  ui.start.hidden=on;
  ui.stop.hidden=!on;
  ui.live.hidden=!on;
  ui.handsBadge.hidden=!on;
  if(!on){ui.fps.textContent='—';ui.handsBadge.textContent='0 dłoni';}
}
async function getVision(){
  if(vision)return;
  vision=await import(PACKAGE+'/+esm');
  fileset=await vision.FilesetResolver.forVisionTasks(PACKAGE+'/wasm');
}
async function createDetector(name,url,options={}){
  await getVision();
  const ctor=vision[name];
  const common={...options,runningMode:'VIDEO'};
  try{
    return await ctor.createFromOptions(fileset,{...common,baseOptions:{modelAssetPath:url,delegate:'GPU'}});
  }catch(gpuError){
    console.warn(name+': GPU unavailable; retrying CPU',gpuError);
    return ctor.createFromOptions(fileset,{...common,baseOptions:{modelAssetPath:url,delegate:'CPU'}});
  }
}
async function getHandModel(){
  if(handModel)return handModel;
  handModel=await createDetector('HandLandmarker',URLS.hand,{
    numHands:2,minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.45
  });
  return handModel;
}
async function enablePose(){
  const variant=ui.poseModel.value;
  if(poseModel&&poseVariant===variant)return;
  if(poseLoading)return poseLoading;
  status('Pobieram model sylwetki ('+variant+')…');
  poseLoading=(async()=>{
    const model=await createDetector('PoseLandmarker',URLS[variant],{numPoses:1});
    if(poseModel)poseModel.close();
    poseModel=model;
    poseVariant=variant;
    if(running)status('Śledzenie dłoni i sylwetki jest aktywne.','good');
  })();
  try{await poseLoading;}catch(error){
    console.error('Body model',error);
    ui.body.checked=false;
    status('Błąd ładowania sylwetki: '+(error.message||error),'error');
  }finally{poseLoading=null;}
}
async function enableFace(){
  if(faceModel)return;
  if(faceLoading)return faceLoading;
  status('Pobieram opcjonalny model twarzy…');
  faceLoading=(async()=>{faceModel=await createDetector('FaceLandmarker',URLS.face,{numFaces:1});})();
  try{await faceLoading;if(running)status('Śledzenie dłoni i twarzy jest aktywne.','good');}
  catch(error){console.error('Face model',error);ui.face.checked=false;status('Błąd ładowania twarzy: '+(error.message||error),'error');}
  finally{faceLoading=null;}
}

async function start(){
  if(running||ui.start.disabled)return;
  const ticket=++epoch;
  ui.start.disabled=true;
  statusBadge('Uruchamianie');
  status('Oczekiwanie na zgodę na dostęp do kamery…');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
      throw new Error('Kamera wymaga HTTPS (lub localhost) i nowoczesnej przeglądarki.');
    // Request access immediately inside the user gesture before awaiting downloads.
    const newStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},
      audio:false
    });
    if(ticket!==epoch){newStream.getTracks().forEach(t=>t.stop());return;}
    stream=newStream;
    ui.video.srcObject=stream;
    await ui.video.play();
    if(ticket!==epoch)return;
    showCamera(true);
    status('Kamera działa. Pobieram model dłoni — przy pierwszym uruchomieniu może to chwilę potrwać…');
    statusBadge('Ładowanie modelu');
    await getHandModel();
    if(ticket!==epoch)return;
    running=true;
    gestures.reset(false);syncPauseUI();filter.reset();
    lastFrame=-1;lastFpsAt=performance.now();frames=0;lastHandsAt=0;lastPoseAt=0;lastFaceAt=0;
    statusBadge('Śledzenie aktywne','ready');
    status('Gotowe. Pokaż jedną dłoń, wskaż przycisk A, B lub C i złącz palce, aby kliknąć.','good');
    ui.pointerStatus.textContent='Pokaż dłoń przed kamerą — mysz jest już aktywna.';
    raf=requestAnimationFrame(loop);
    if(ui.body.checked)void enablePose();
    if(ui.face.checked)void enableFace();
  }catch(error){
    if(ticket!==epoch)return;
    console.error('Camera / model load',error);
    const details=error.name==='NotAllowedError'
      ? 'Odmówiono dostępu do kamery. Zmień uprawnienia strony i spróbuj ponownie.'
      :error.name==='NotFoundError'
      ? 'Nie znaleziono kamery. Podłącz kamerę i spróbuj ponownie.'
      : 'Nie udało się uruchomić śledzenia: '+(error.message||String(error));
    stop();
    statusBadge('Wystąpił błąd','error');
    status(details,'error');
  }finally{
    if(ticket===epoch)ui.start.disabled=false;
  }
}
function stop(){
  epoch++;
  running=false;
  if(raf)cancelAnimationFrame(raf);
  raf=0;
  if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
  try{ui.video.pause();}catch(_){}
  ui.video.srcObject=null;
  ctx.clearRect(0,0,ui.canvas.width,ui.canvas.height);
  clearPointer();
  gestures.reset(false);syncPauseUI();cancelCalibration();
  bodyPoints=null;facePoints=null;lastHandCount=0;
  ui.handsCount.textContent='0';ui.pointCount.textContent='0';
  showCamera(false);
  ui.start.disabled=false;
  statusBadge(handModel?'Model gotowy':'Nieaktywna',handModel?'ready':'');
  status('Kamera wyłączona. Możesz ją uruchomić ponownie.');
  ui.pointerStatus.textContent='Sterowanie będzie aktywne po uruchomieniu kamery.';
  if(bridge.armed)void disarmDesktop();
}
function loop(now){
  if(!running)return;
  try{
    const v=ui.video;
    if(v.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&v.videoWidth){
      if(ui.canvas.width!==v.videoWidth||ui.canvas.height!==v.videoHeight){
        ui.canvas.width=v.videoWidth;ui.canvas.height=v.videoHeight;
      }
      // Cap inference work to ~25Hz, even on high-refresh-rate screens.
      if(now-lastHandsAt>=40&&v.currentTime!==lastFrame){
        lastFrame=v.currentTime;
        lastHandsAt=now;
        const hands=handModel.detectForVideo(v,now);
        if(ui.body.checked&&poseModel&&now-lastPoseAt>=135){
          bodyPoints=poseModel.detectForVideo(v,now).landmarks?.[0]||null;
          lastPoseAt=now;
        }
        if(ui.face.checked&&faceModel&&now-lastFaceAt>=240){
          facePoints=faceModel.detectForVideo(v,now).faceLandmarks?.[0]||null;
          lastFaceAt=now;
        }
        render(hands);
        updateHandCursor(hands,now);
        lastHandCount=(hands.landmarks||[]).length;
        ui.handsCount.textContent=String(lastHandCount);
        ui.handsBadge.textContent=lastHandCount===1?'1 dłoń':lastHandCount+' dłonie';
        recountPoints();
        frames++;
      }
    }
    if(now-lastFpsAt>=1000){
      ui.fps.textContent=String(Math.round(frames*1000/(now-lastFpsAt)));
      frames=0;lastFpsAt=now;
    }
    if(pointer.visible&&now-pointer.lastSeen>350)lostHand();
    raf=requestAnimationFrame(loop);
  }catch(error){
    console.error('Detection loop failed',error);
    stop();
    statusBadge('Błąd detekcji','error');
    status('Model nie mógł przetworzyć obrazu: '+(error.message||String(error))+'. Kliknij „Uruchom kamerę”, aby spróbować ponownie.','error');
  }
}
function recountPoints(){
  ui.pointCount.textContent=String(lastHandCount*21+(ui.body.checked&&bodyPoints?33:0)+(ui.face.checked&&facePoints?478:0));
}
function render(hands){
  const w=ui.canvas.width,h=ui.canvas.height;
  ctx.clearRect(0,0,w,h);
  if(ui.body.checked&&bodyPoints)drawLandmarks(bodyPoints,BODY_EDGES,w,h,'#94aae9','#e6ce8d',Math.max(2,w/240),Math.max(2,w/190),true);
  if(ui.face.checked&&facePoints&&ui.points.checked){
    ctx.fillStyle='#d6a0f2';
    for(const pt of facePoints){ctx.beginPath();ctx.arc(pt.x*w,pt.y*h,Math.max(.7,w/900),0,Math.PI*2);ctx.fill();}
  }
  for(const [i,landmarks] of (hands.landmarks||[]).entries()){
    drawLandmarks(landmarks,HAND_EDGES,w,h,i===0?'#6af7da':'#e5a4fb','#ffffff',Math.max(2,w/220),Math.max(3,w/135));
    // The pinch fingers are always highlighted when point display is on.
    if(ui.points.checked){
      ctx.fillStyle='#fdd275';
      for(const n of [4,8]){const p=landmarks[n];ctx.beginPath();ctx.arc(p.x*w,p.y*h,Math.max(5,w/85),0,Math.PI*2);ctx.fill();}
    }
  }
}
function drawLandmarks(points,edges,w,h,boneColor,pointColor,lineWidth,radius,checkVisibility=false){
  const visible=p=>p&&(!checkVisibility||(p.visibility??1)>=.4);
  if(ui.lines.checked){
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=boneColor;ctx.lineWidth=lineWidth;
    for(const [a,b] of edges){
      if(!visible(points[a])||!visible(points[b]))continue;
      ctx.beginPath();ctx.moveTo(points[a].x*w,points[a].y*h);ctx.lineTo(points[b].x*w,points[b].y*h);ctx.stroke();
    }
  }
  if(ui.points.checked){
    ctx.fillStyle=pointColor;
    for(const p of points){
      if(!visible(p))continue;
      ctx.beginPath();ctx.arc(p.x*w,p.y*h,radius,0,Math.PI*2);ctx.fill();
    }
  }
}
function chooseHand(results){
  const hands=results.landmarks||[];
  if(!hands.length)return null;
  if(ui.handChoice.value==='auto'){
    if(pointer.preferredLabel){
      const labels=results.handednesses||results.handedness||[];
      const i=labels.findIndex(x=>x?.[0]?.categoryName===pointer.preferredLabel);
      if(i>=0&&hands[i])return hands[i];
    }
    const labels=results.handednesses||results.handedness||[];
    pointer.preferredLabel=labels[0]?.[0]?.categoryName||null;
    return hands[0];
  }
  const labels=results.handednesses||results.handedness||[];
  const idx=labels.findIndex(x=>x?.[0]?.categoryName===ui.handChoice.value);
  return idx>=0?hands[idx]:null;
}

function syncPauseUI(){
  ui.pause.textContent=gestures.paused?'▶ Wznów':'⏸ Pauza';
  ui.pause.setAttribute('aria-pressed',String(gestures.paused));
  ui.gesture.classList.toggle('paused',gestures.paused);
  ui.cursor.classList.toggle('paused',gestures.paused);
  if(gestures.paused){
    ui.gesture.textContent='Pauza';
    ui.pointerStatus.textContent='Sterowanie wstrzymane. Pokaż otwartą dłoń przez 0,85 s lub kliknij Wznów.';
  }
}
function pauseGestures(pause){
  if(gestures.paused===pause)return;
  const events=gestures.setPaused(pause);
  applyGestureEvents(events,performance.now());
  if(pause&&bridge.armed)void disarmDesktop();
  filter.reset();syncPauseUI();
  if(!pause)ui.pointerStatus.textContent='Sterowanie wznowione. Pokaż palec wskazujący.';
}
function clearPointer(){
  const pending=gestures.reset();
  applyGestureEvents(pending,performance.now());
  filter.reset();calibration.lastRaw=null;
  pointer.visible=false;pointer.preferredLabel=null;
  ui.cursor.hidden=true;ui.cursor.classList.remove('pinched','paused');
  targets.forEach(t=>t.classList.remove('hovered'));
  if(!gestures.paused)ui.gesture.textContent='Oczekiwanie';
}
function lostHand(){
  if(!pointer.visible)return;
  clearPointer();
  ui.pointerStatus.textContent='Nie widzę dłoni. Pokaż ją w kadrze, aby wznowić.';
  if(bridge.armed)void disarmDesktop();
}
function updateHandCursor(hands,now){
  const hand=chooseHand(hands);
  if(!hand||!hand[8]||!hand[4]||!hand[5]||!hand[17]){
    if(pointer.visible&&now-pointer.lastSeen>350)lostHand();
    return;
  }
  const raw={x:ui.mirror.checked?1-hand[8].x:hand[8].x,y:hand[8].y};
  calibration.lastRaw=raw;
  const info=classifyHand(hand,gestures.pinching);
  if(!info.valid)return;
  const mapped=mapPoint(raw,calibration.active?null:calibration.profile,ui.sensitivity.value);
  if(!gestures.paused){
    const filtered=filter.update(mapped,now,ui.smooth.value,ui.deadzone.value);
    pointer.x=filtered.x;pointer.y=filtered.y;
  }
  pointer.visible=true;pointer.lastSeen=now;
  ui.cursor.hidden=gestures.paused;
  ui.cursor.style.left=(pointer.x*100).toFixed(2)+'%';
  ui.cursor.style.top=(pointer.y*100).toFixed(2)+'%';

  const events=gestures.update(info.kind,now,{x:pointer.x,y:pointer.y});
  applyGestureEvents(events,now);
  ui.cursor.classList.toggle('pinched',gestures.pinching);
  syncPauseUI();
  if(gestures.paused)return;

  const modeLabel={
    pinch:'Szczypnięcie',peace:'Przewijanie',fist:'Zatrzymanie…',
    open:'Otwarta dłoń',point:'Wskazywanie',other:'Śledzenie'
  };
  ui.gesture.textContent=modeLabel[info.kind]||'Śledzenie';
  if(calibration.active){
    ui.pointerStatus.textContent='Kalibracja '+(calibration.points.length+1)+'/4: '+CAL_STEPS[calibration.points.length].title+'. Wykonaj krótki pinch.';
  }else if(info.kind==='peace'&&demo.mode==='scroll'){
    ui.pointerStatus.textContent='Przewijaj, przesuwając wyprostowane dwa palce w górę lub w dół.';
  }else if(gestures.dragging){
    ui.pointerStatus.textContent='Przeciąganie: przesuwaj dłoń; rozłącz palce, aby upuścić.';
  }else if(info.kind==='fist'){
    ui.pointerStatus.textContent='Przytrzymaj pięść 0,85 s, aby wstrzymać sterowanie.';
  }else{
    ui.pointerStatus.textContent='Wskaż cel. Krótki pinch = klik; długi = przeciąganie; dwa palce = scroll.';
  }
  updateHover();
  if(bridge.armed&&!calibration.active&&!(info.kind==='fist'||info.kind==='open'||info.kind==='peace'))
    queueBridge('move',now);
}
function getPointerScreen(){
  const z=ui.workspace.getBoundingClientRect();
  return {x:z.left+pointer.x*z.width,y:z.top+pointer.y*z.height};
}
function rectContains(rect,p){return p.x>=rect.left&&p.x<=rect.right&&p.y>=rect.top&&p.y<=rect.bottom;}
function updateHover(){
  const pos=getPointerScreen();
  for(const target of targets){
    target.classList.toggle('hovered',demo.mode==='click'&&rectContains(target.getBoundingClientRect(),pos));
  }
}
function selectDemo(mode){
  if(!['click','drag','scroll'].includes(mode))return;
  cancelDemoDrag();
  demo.mode=mode;
  for(const tab of ui.demoTabs){
    tab.classList.toggle('active',tab.dataset.demo===mode);
    tab.setAttribute('aria-pressed',String(tab.dataset.demo===mode));
  }
  ui.demoClick.hidden=mode!=='click';
  ui.demoDrag.hidden=mode!=='drag';
  ui.demoScroll.hidden=mode!=='scroll';
  ui.feedback.textContent=mode==='click'?'Wskaż A, B lub C i wykonaj krótki pinch.'
    :mode==='drag'?'Wskaż turkusowy element, przytrzymaj pinch i przesuń do celu.'
    :'Pokaż dwa wyprostowane palce i przesuń dłoń pionowo.';
}
function cancelDemoDrag(){
  demo.dragging=false;
  ui.dragCard.classList.remove('dragging');
  ui.dropZone.classList.remove('over');
}
function resetDragItem(){
  demo.cardX=.15;demo.cardY=.5;
  ui.dragCard.style.left='15%';ui.dragCard.style.top='50%';
  cancelDemoDrag();
}
function dragStart(event){
  if(demo.mode!=='drag'||calibration.active)return;
  const pos={x:ui.workspace.getBoundingClientRect().left+event.x*ui.workspace.getBoundingClientRect().width,
             y:ui.workspace.getBoundingClientRect().top+event.y*ui.workspace.getBoundingClientRect().height};
  if(!rectContains(ui.dragCard.getBoundingClientRect(),pos)){
    ui.feedback.textContent='Aby chwycić, zacznij długie szczypnięcie na turkusowej karcie.';
    return;
  }
  demo.dragging=true;ui.dragCard.classList.add('dragging');
  const r=ui.dragCard.getBoundingClientRect();
  demo.offsetX=(r.left+r.width/2)-pos.x;
  demo.offsetY=(r.top+r.height/2)-pos.y;
}
function dragMove(event){
  if(!demo.dragging)return;
  const zone=ui.dragLane.getBoundingClientRect();
  const pos={x:ui.workspace.getBoundingClientRect().left+event.x*ui.workspace.getBoundingClientRect().width+demo.offsetX,
             y:ui.workspace.getBoundingClientRect().top+event.y*ui.workspace.getBoundingClientRect().height+demo.offsetY};
  demo.cardX=clamp((pos.x-zone.left)/zone.width,.08,.92);
  demo.cardY=clamp((pos.y-zone.top)/zone.height,.2,.8);
  ui.dragCard.style.left=(demo.cardX*100).toFixed(1)+'%';
  ui.dragCard.style.top=(demo.cardY*100).toFixed(1)+'%';
  ui.dropZone.classList.toggle('over',rectContains(ui.dropZone.getBoundingClientRect(),pos));
}
function dragEnd(event){
  if(!demo.dragging)return;
  const r=ui.dragCard.getBoundingClientRect(),center={x:r.left+r.width/2,y:r.top+r.height/2};
  const success=!event.cancelled&&rectContains(ui.dropZone.getBoundingClientRect(),center);
  cancelDemoDrag();
  if(success){
    ui.dropZone.classList.add('success');
    ui.feedback.textContent='✓ Element przeniesiony poprawnie! Spróbuj ponownie.';
  }else{
    ui.feedback.textContent=event.cancelled?'Przeciąganie anulowane.':'Poza celem. Spróbuj jeszcze raz.';
  }
  resetDragItem();
}
function applyGestureEvents(events,now){
  for(const event of events){
    if(event.type==='pause'){
      cancelDemoDrag();
      if(bridge.armed)void disarmDesktop();
      filter.reset();syncPauseUI();
    }else if(event.type==='resume'){
      filter.reset();syncPauseUI();
    }else if(event.type==='click'){
      if(calibration.active)captureCalibrationPoint();
      else if(demo.mode==='click'){
        const pos=getPointerScreen();
        const hit=targets.find(target=>rectContains(target.getBoundingClientRect(),pos));
        if(hit)hit.click();
        else ui.feedback.textContent='Klik poza przyciskami. Spróbuj ponownie.';
      }
      if(!calibration.active&&bridge.armed)queueBridge('click',now,true);
    }else if(event.type==='dragStart'){
      if(!calibration.active){
        dragStart(event);
        if(bridge.armed)queueBridge('down',now,true);
      }
    }else if(event.type==='dragMove'){
      if(!calibration.active)dragMove(event);
    }else if(event.type==='dragEnd'){
      dragEnd(event);
      if(bridge.armed)queueBridge('up',now,true);
    }else if(event.type==='scroll'&&!calibration.active){
      if(demo.mode==='scroll'){
        ui.scrollArea.scrollTop+=event.delta*600;
        ui.feedback.textContent=event.delta>0?'Przewijanie w dół':'Przewijanie w górę';
      }
      if(bridge.armed)queueBridge('scroll',now,true,{scroll:clamp(-event.delta*8,-3,3)});
    }
  }
}
function calibrationStorageKey(){return 'poseTracker:v4:calibration:'+(ui.mirror.checked?'mirrored':'normal');}
function loadCalibration(){
  try{
    const raw=localStorage.getItem(calibrationStorageKey());
    if(!raw)return null;
    const data=JSON.parse(raw);
    if([data.minX,data.maxX,data.minY,data.maxY].every(Number.isFinite)&&
       data.maxX-data.minX>=.12&&data.maxY-data.minY>=.12)return data;
  }catch(error){console.warn('Cannot load calibration',error);}
  return null;
}
function updateCalibrationStatus(){
  ui.calStatus.textContent=calibration.profile?
    'Kalibracja zapisana dla aktualnej orientacji kamery.':'Brak kalibracji — używany jest domyślny zakres.';
}
function startCalibration(){
  if(!running){ui.calStatus.textContent='Najpierw uruchom kamerę.';return;}
  if(gestures.paused)pauseGestures(false);
  cancelDemoDrag();
  calibration.active=true;calibration.points=[];
  gestures.reset();filter.reset();
  ui.calOverlay.hidden=false;
  renderCalibrationStep();
}
function renderCalibrationStep(){
  const index=calibration.points.length;
  if(index>=4)return;
  const step=CAL_STEPS[index];
  ui.calStep.textContent=(index+1)+'/4';
  ui.calCross.style.left=step.x+'%';
  ui.calCross.style.top=step.y+'%';
  ui.calPrompt.textContent='Wskaż '+step.title+' strefy dłonią, wykonaj krótki pinch i rozłącz palce.';
  ui.calStatus.textContent='Kalibracja trwa — krok '+(index+1)+' z 4.';
}
function captureCalibrationPoint(){
  if(!calibration.active||!calibration.lastRaw){
    ui.calStatus.textContent='Pokaż wyprostowany palec wskazujący przed kamerą.';
    return;
  }
  calibration.points.push({...calibration.lastRaw});
  if(calibration.points.length===4){
    try{
      calibration.profile=calibrationFromCorners(calibration.points);
      localStorage.setItem(calibrationStorageKey(),JSON.stringify(calibration.profile));
      ui.calOverlay.hidden=true;calibration.active=false;calibration.points=[];
      filter.reset();updateCalibrationStatus();
      ui.feedback.textContent='✓ Kalibracja zakończona. Możesz teraz używać gestów.';
    }catch(error){
      calibration.points=[];
      ui.calStatus.textContent=error.message;
      renderCalibrationStep();
    }
  }else renderCalibrationStep();
}
function cancelCalibration(){
  calibration.active=false;calibration.points=[];ui.calOverlay.hidden=true;
  updateCalibrationStatus();
}
function resetCalibration(){
  cancelCalibration();calibration.profile=null;
  try{localStorage.removeItem(calibrationStorageKey());}catch(error){console.warn(error);}
  filter.reset();updateCalibrationStatus();
}
function clickTarget(button){
  clicks++;
  ui.clickCount.textContent=clicks===1?'1 kliknięcie':(clicks%10>=2&&clicks%10<=4&&(clicks%100<12||clicks%100>14)?clicks+' kliknięcia':clicks+' kliknięć');
  ui.clicksMetric.textContent=String(clicks);
  ui.feedback.textContent='✓ Kliknięto punkt '+button.dataset.action+'!';
  targets.forEach(target=>target.classList.toggle('selected',target===button));
  button.classList.add('pressed');
  // CSS active indication is also provided by the selected class (no timer required).
}

// Optional local OS bridge; never active from GitHub Pages.
async function probeBridge(){
  try{
    const r=await fetch('/api/health',{cache:'no-store'});
    if(!r.ok)throw new Error('Unavailable');
    const d=await r.json();
    if(!d.available)throw new Error('Unavailable');
    bridge.available=true;ui.desktopArm.disabled=false;
    ui.desktopState.textContent='Most lokalny dostępny';
  }catch(_){ui.desktopState.textContent='Uruchom desktop_bridge.py, aby włączyć mysz systemową';}
}
async function bridgePost(endpoint,data){
  const r=await fetch('/api/'+endpoint,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data),cache:'no-store'
  });
  if(!r.ok)throw new Error('Bridge HTTP '+r.status);
  return r.json();
}
async function armDesktop(){
  if(!localBridge||!bridge.available||bridge.armed||!running){
    ui.desktopState.textContent=running?'Most jest niedostępny':'Najpierw uruchom kamerę';return;
  }
  try{
    await bridgePost('arm',{armed:true});bridge.armed=true;bridge.queue=[];
    ui.desktopArm.disabled=true;ui.desktopDisarm.disabled=false;
    ui.desktopState.textContent='Mysz systemowa UZBROJONA — Esc lub STOP rozbraja.';
  }catch(error){ui.desktopState.textContent='Nie udało się uzbroić: '+error.message;}
}
async function disarmDesktop(){
  bridge.armed=false;bridge.queue=[];
  ui.desktopArm.disabled=!bridge.available;ui.desktopDisarm.disabled=true;
  ui.desktopState.textContent='Mysz systemowa rozbrojona';
  if(bridge.available){
    try{await bridgePost('arm',{armed:false});}catch(error){console.warn('Bridge disarm:',error);}
  }
}
function queueBridge(event,now,urgent=false,extra={}){
  if(!bridge.armed)return;
  if(event==='move'&&!urgent&&now-bridge.lastSend<80)return;
  bridge.lastSend=now;
  const packet={event,x:pointer.x,y:pointer.y,...extra};
  if(event==='move'){
    const i=bridge.queue.findIndex(v=>v.event==='move');
    if(i>=0)bridge.queue[i]=packet;
    else bridge.queue.push(packet);
  }else{
    bridge.queue.push(packet);
  }
  if(bridge.queue.length>14)bridge.queue=bridge.queue.filter(v=>v.event!=='move').slice(-12);
  void drainBridge();
}
async function drainBridge(){
  if(bridge.busy||!bridge.armed)return;
  bridge.busy=true;
  try{
    while(bridge.armed&&bridge.queue.length){
      const msg=bridge.queue.shift();
      await bridgePost('mouse',msg);
    }
  }catch(error){
    console.warn('Most systemowy rozłączony:',error);
    void disarmDesktop();
  }finally{bridge.busy=false;}
}
