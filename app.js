// PoseTracker Gesture Studio v3 — camera-first, hand-first.
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
  desktopDisarm:el('desktop-disarm'),desktopState:el('desktop-state')
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
const bridge={available:false,armed:false,busy:false,lastSend:0,pendingClick:false};

ui.start.addEventListener('click',start);
ui.stop.addEventListener('click',stop);
ui.mirror.addEventListener('change',()=>ui.stage.classList.toggle('mirrored',ui.mirror.checked));
ui.smooth.addEventListener('input',()=>ui.smoothLabel.textContent=ui.smooth.value+'%');
ui.body.addEventListener('change',()=>{if(ui.body.checked&&running)void enablePose();else if(!ui.body.checked){bodyPoints=null;recountPoints();}});
ui.face.addEventListener('change',()=>{if(ui.face.checked&&running)void enableFace();else if(!ui.face.checked){facePoints=null;recountPoints();}});
ui.poseModel.addEventListener('change',()=>{if(ui.body.checked&&running)void enablePose();});
ui.handChoice.addEventListener('change',clearPointer);
targets.forEach(button=>button.addEventListener('click',()=>clickTarget(button)));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.addEventListener('pagehide',stop);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&bridge.armed){event.preventDefault();void disarmDesktop();}
});
ui.desktopArm.addEventListener('click',()=>void armDesktop());
ui.desktopDisarm.addEventListener('click',()=>void disarmDesktop());
ui.stage.classList.toggle('mirrored',ui.mirror.checked);
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
function clearPointer(){
  pointer.visible=false;pointer.pinched=false;pointer.pinchStart=0;pointer.preferredLabel=null;
  ui.cursor.hidden=true;
  ui.cursor.classList.remove('pinched');
  targets.forEach(t=>t.classList.remove('hovered'));
  ui.gesture.textContent='Oczekiwanie';
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
  const index=hand[8],thumb=hand[4];
  // Compute in camera coordinates before mirror, scale by actual palm width.
  const pinchRatio=dist(index,thumb)/Math.max(.035,dist(hand[5],hand[17]));
  const xx=ui.mirror.checked?1-index.x:index.x;
  // Central 84% of the camera covers the full virtual test area.
  const targetX=clamp((xx-.08)/.84,.015,.985);
  const targetY=clamp((index.y-.08)/.84,.015,.985);
  const strength=Number(ui.smooth.value)/100;
  const step=Math.hypot(targetX-pointer.x,targetY-pointer.y);
  const alpha=clamp(.66-.5*strength+step*.35,.12,.9);
  if(!pointer.visible||now-pointer.lastSeen>500){pointer.x=targetX;pointer.y=targetY;}
  else {pointer.x+=(targetX-pointer.x)*alpha;pointer.y+=(targetY-pointer.y)*alpha;}
  pointer.visible=true;pointer.lastSeen=now;
  ui.cursor.hidden=false;
  ui.cursor.style.left=(pointer.x*100).toFixed(2)+'%';
  ui.cursor.style.top=(pointer.y*100).toFixed(2)+'%';

  let click=false;
  // Hysteresis + minimum pinch hold + cooldown prevent repeated clicks.
  if(!pointer.pinched){
    if(pinchRatio<.48){
      if(!pointer.pinchStart)pointer.pinchStart=now;
      if(now-pointer.pinchStart>=90&&now-pointer.lastClick>=550){
        pointer.pinched=true;pointer.pinchStart=0;pointer.lastClick=now;click=true;
      }
    }else pointer.pinchStart=0;
  }else if(pinchRatio>.67){
    pointer.pinched=false;pointer.pinchStart=0;
  }
  ui.cursor.classList.toggle('pinched',pointer.pinched);
  ui.gesture.textContent=pointer.pinched?'Kliknięcie':'Śledzenie';
  ui.pointerStatus.textContent=pointer.pinched
    ? 'Klik zarejestrowany. Rozsuń palce przed następnym kliknięciem.'
    : (pointer.pinchStart?'Przytrzymaj szczypnięcie…':'Sterowanie aktywne — złącz kciuk i wskazujący, aby kliknąć.');

  const zone=ui.workspace.getBoundingClientRect();
  const px=zone.left+pointer.x*zone.width,py=zone.top+pointer.y*zone.height;
  let hovered=null;
  for(const target of targets){
    const b=target.getBoundingClientRect();
    const inside=px>=b.left&&px<=b.right&&py>=b.top&&py<=b.bottom;
    target.classList.toggle('hovered',inside);
    if(inside)hovered=target;
  }
  if(click){
    if(hovered)hovered.click();
    else ui.feedback.textContent='Kliknięto poza przyciskami. Wskaż jeden z celów i spróbuj ponownie.';
  }
  if(bridge.armed)sendDesktopPointer(now,click);
}
function clickTarget(button){
  clicks++;
  ui.clickCount.textContent=clicks+' kliknięć';
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
    await bridgePost('arm',{armed:true});bridge.armed=true;
    ui.desktopArm.disabled=true;ui.desktopDisarm.disabled=false;
    ui.desktopState.textContent='Mysz systemowa UZBROJONA — Esc lub STOP rozbraja.';
  }catch(error){ui.desktopState.textContent='Nie udało się uzbroić: '+error.message;}
}
async function disarmDesktop(){
  bridge.armed=false;bridge.pendingClick=false;
  ui.desktopArm.disabled=!bridge.available;ui.desktopDisarm.disabled=true;
  ui.desktopState.textContent='Mysz systemowa rozbrojona';
  if(bridge.available){
    try{await bridgePost('arm',{armed:false});}catch(error){console.warn('Bridge disarm:',error);}
  }
}
function sendDesktopPointer(now,click){
  if(!bridge.armed||!pointer.visible)return;
  if(click)bridge.pendingClick=true;
  if(bridge.busy||(!bridge.pendingClick&&now-bridge.lastSend<70))return;
  bridge.busy=true;bridge.lastSend=now;
  const msg={x:pointer.x,y:pointer.y,click:bridge.pendingClick};
  bridge.pendingClick=false;
  bridgePost('mouse',msg).catch(error=>{
    console.warn('Bridge error',error);
    void disarmDesktop();
  }).finally(()=>{bridge.busy=false;});
}
