import { extractHand, HoloGestureController } from './holo-gestures.mjs';
import { createHoloRenderer } from './holo-scene.mjs';

const id = name => document.getElementById(name);
const ui = {
  scene:id('scene'), canvas:id('three-canvas'), pointer:id('scene-pointer'),
  error:id('scene-error'), errorText:id('scene-error-text'), renderStatus:id('render-status'),
  camera:id('video'), overlay:id('hands-overlay'), camStage:id('camera-stage'),
  camEmpty:id('camera-empty'), start:id('start-camera'), stop:id('stop-camera'),
  feedback:id('camera-feedback'), signal:id('camera-signal'), fps:id('camera-fps'),
  inputState:id('input-state'), objectScale:id('object-scale'), scaleReadout:id('scale-readout'),
  handCount:id('hand-count'), inferenceFps:id('inference-fps'), handsOnline:id('hands-online'),
  gestureMode:id('gesture-mode'), activeObject:id('active-object'),
  pause:id('pause-scene'), reset:id('reset-view'), topStatus:id('top-status'),
  trackingState:id('tracking-state'),
  modelButtons:[...document.querySelectorAll('.object-button')]
};
const ctx=ui.overlay.getContext('2d');
const HAND_EDGES=[
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];
const visionPackage='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const handModelUrl='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const controller=new HoloGestureController();
let holo=null,model=null,stream=null,running=false,starting=false,epoch=0,raf=0;
let lastFrame=-1,lastInference=-Infinity,frames=0,fpsStarted=0,handLock=false;
let mouseActive=false,mousePrevious=null,scaleDisplayAt=0;
let lastMode='';
const state={selected:'core'};

function cameraStatus(text,kind=''){
  ui.feedback.textContent=text;
  ui.feedback.className='camera-feedback'+(kind?' '+kind:'');
}
function setTop(active){
  ui.topStatus.classList.toggle('online',active);
  ui.topStatus.lastElementChild && null;
  ui.topStatus.textContent=active?'● HAND TRACKING ONLINE':'● SYSTEM READY';
  ui.signal.textContent=active?'TRACKING':'NO SIGNAL';
  ui.signal.classList.toggle('online',active);
}
function setModel(name){
  if(!['core','robot'].includes(name))return;
  state.selected=name;
  holo?.setModel(name);
  ui.activeObject.textContent=name==='core'?'ENERGY CORE / H-01':'ROBOT ARM / R-02';
  ui.modelButtons.forEach(button=>{
    const active=button.dataset.model===name;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  updateScale();
}
function updateScale(){
  const value=(holo?.scale||1).toFixed(2)+'×';
  ui.objectScale.textContent='SCALE '+value;
  ui.scaleReadout.textContent=value;
}
function setPaused(paused){
  const events=controller.setPaused(paused);
  handLock=false;
  consumeEvents(events);
  ui.pause.textContent=paused?'▶ WZNÓW':'Ⅱ PAUZA';
  ui.pause.setAttribute('aria-pressed',String(paused));
  holo?.setInteracting(paused);
  ui.pointer.classList.remove('grabbing');
  ui.gestureMode.textContent=paused?'CONTROL PAUSED':'GESTURE READY';
  ui.trackingState.textContent=paused?'PAUSED':'ACTIVE';
}
function consumeEvents(events){
  for(const event of events){
    switch(event.type){
      case 'pointer':
        ui.pointer.hidden=false;
        ui.pointer.style.left=(event.x*100).toFixed(2)+'%';
        ui.pointer.style.top=(event.y*100).toFixed(2)+'%';
        break;
      case 'grab-start':
        ui.pointer.classList.add('grabbing');
        if(selectByGesture(event.x,event.y)) {
          handLock=true;
          ui.gestureMode.textContent='OBJECT SELECTED';
        } else {
          handLock=false;
          ui.gestureMode.textContent='ROTATING / 1 HAND';
          holo?.setInteracting(true);
        }
        break;
      case 'rotate':
        if(!handLock)holo?.rotate(event.dx,-event.dy);
        break;
      case 'dual-start':
        handLock=false;ui.pointer.classList.add('grabbing');
        ui.gestureMode.textContent='TRANSFORM / 2 HANDS';
        holo?.setInteracting(true);
        break;
      case 'dual-transform':
        holo?.transform(event);
        updateScale();
        break;
      case 'release':
        ui.pointer.classList.remove('grabbing');
        holo?.setInteracting(false);
        handLock=false;
        ui.gestureMode.textContent=controller.paused?'CONTROL PAUSED':'HAND RELEASED';
        break;
      case 'paused':
        ui.pointer.classList.remove('grabbing');
        ui.pointer.hidden=true;
        ui.pause.textContent='▶ WZNÓW';
        ui.pause.setAttribute('aria-pressed','true');
        holo?.setInteracting(true);
        ui.gestureMode.textContent='PAUSED / FIST';
        ui.trackingState.textContent='PAUSED';
        break;
      case 'resumed':
        ui.pause.textContent='Ⅱ PAUZA';
        ui.pause.setAttribute('aria-pressed','false');
        holo?.setInteracting(false);
        ui.gestureMode.textContent='RESUMED / PALM';
        ui.trackingState.textContent='ACTIVE';
        break;
      case 'tracking-lost':
        ui.pointer.hidden=true;
        ui.pointer.classList.remove('grabbing');
        ui.inputState.textContent='WAITING';
        holo?.setInteracting(controller.paused);
        handLock=false;
        break;
    }
  }
}
function selectByGesture(x,y) {
  const stage=ui.scene.getBoundingClientRect();
  const px=stage.left+stage.width*x;
  const py=stage.top+stage.height*y;
  for(const button of ui.modelButtons) {
    const r=button.getBoundingClientRect();
    if(px>=r.left&&px<=r.right&&py>=r.top&&py<=r.bottom) {
      setModel(button.dataset.model);
      return true;
    }
  }
  return false;
}
async function initScene(){
  try{
    ui.renderStatus.textContent='LOADING 3D';
    const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
    holo=createHoloRenderer(THREE,ui.canvas,ui.scene);
    setModel(state.selected);
    ui.renderStatus.textContent='WEBGL OK';
    cameraStatus('Scena 3D gotowa. Użyj myszy lub uruchom kamerę, aby sterować dłonią.');
  }catch(error){
    console.error('HoloLab WebGL failed',error);
    ui.renderStatus.textContent='WEBGL ERROR';
    ui.error.hidden=false;
    ui.errorText.textContent='Three.js lub WebGL nie zostały uruchomione: '+(error.message||String(error));
    cameraStatus('Nie udało się załadować sceny 3D. Sprawdź akcelerację sprzętową przeglądarki.','error');
  }
}
async function makeDetector(){
  if(model)return model;
  const vision=await import(visionPackage+'/+esm');
  const fileset=await vision.FilesetResolver.forVisionTasks(visionPackage+'/wasm');
  const opts=delegate=>({
    baseOptions:{modelAssetPath:handModelUrl,delegate},
    runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.5,
    minHandPresenceConfidence:.5,minTrackingConfidence:.5
  });
  try{model=await vision.HandLandmarker.createFromOptions(fileset,opts('GPU'));}
  catch(error){
    console.warn('Hand model GPU fallback to CPU',error);
    model=await vision.HandLandmarker.createFromOptions(fileset,opts('CPU'));
  }
  return model;
}
async function startCamera(){
  if(starting||running)return;
  starting=true;
  const session=++epoch;
  ui.start.disabled=true;
  cameraStatus('Proszę o dostęp do kamery…');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
      throw new Error('Ta funkcja wymaga HTTPS i zgody na dostęp do kamery.');
    const nextStream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30},facingMode:{ideal:'user'}}
    });
    if(session!==epoch){nextStream.getTracks().forEach(t=>t.stop());return;}
    stream=nextStream;
    ui.camera.srcObject=stream;
    await ui.camera.play();
    if(session!==epoch)return;
    ui.camStage.classList.add('active');
    ui.start.hidden=true;ui.stop.hidden=false;
    cameraStatus('Kamera działa. Pobieram model 21 punktów dłoni…');
    await makeDetector();
    if(session!==epoch)return;
    running=true;setTop(true);
    lastFrame=-1;lastInference=-Infinity;frames=0;fpsStarted=performance.now();
    controller.reset();
    setPaused(false);
    cameraStatus('Śledzenie aktywne. Złącz kciuk i wskazujący, aby chwycić obiekt.');
    raf=requestAnimationFrame(track);
  }catch(error){
    if(session!==epoch)return;
    console.error('HoloLab camera',error);
    stopCamera();
    cameraStatus(error.name==='NotAllowedError'
      ? 'Odmówiono dostępu do kamery. Zezwól na korzystanie z kamery w przeglądarce.'
      : 'Błąd kamery lub modelu: '+(error.message||String(error)),'error');
  }finally{
    if(session===epoch){starting=false;ui.start.disabled=false;}
  }
}
function stopCamera(){
  epoch++;
  running=false;starting=false;
  if(raf)cancelAnimationFrame(raf);
  raf=0;
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
  ui.camera.pause();ui.camera.srcObject=null;
  ctx.clearRect(0,0,ui.overlay.width,ui.overlay.height);
  ui.camStage.classList.remove('active');
  ui.start.hidden=false;ui.stop.hidden=true;ui.start.disabled=false;
  setTop(false);
  consumeEvents(controller.release());
  controller.reset();
  ui.pointer.hidden=true;ui.handCount.textContent='00';
  ui.handsOnline.textContent='0 HANDS';
  ui.inputState.textContent='WAITING';
  ui.trackingState.textContent='IDLE';
  ui.inferenceFps.textContent='—';ui.fps.textContent='— FPS';
  setPaused(false);
  cameraStatus('Kamera wyłączona. Tryb myszki nadal jest dostępny.');
}
function track(now){
  if(!running)return;
  try{
    const v=ui.camera;
    if(v.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&v.videoWidth&&
       v.currentTime!==lastFrame&&now-lastInference>=42){
      lastFrame=v.currentTime;lastInference=now;
      if(ui.overlay.width!==v.videoWidth||ui.overlay.height!==v.videoHeight){
        ui.overlay.width=v.videoWidth;ui.overlay.height=v.videoHeight;
      }
      const result=model.detectForVideo(v,now);
      const hands=(result.landmarks||[]).map((landmarks,index)=>{
        const label=result.handednesses?.[index]?.[0]?.categoryName || ('H'+index);
        return extractHand(landmarks,label,true);
      }).filter(Boolean);
      drawHands(result.landmarks||[]);
      consumeEvents(controller.update(hands,now));
      ui.handCount.textContent=String(hands.length).padStart(2,'0');
      ui.handsOnline.textContent=hands.length+' HAND'+(hands.length===1?'':'S');
      ui.inputState.textContent=hands.length===0?'SEARCHING':controller.paused?'PAUSED':'TRACKING';
      ui.trackingState.textContent=hands.length?'LIVE':'SEARCHING';
      frames++;
    }
    if(now-fpsStarted>=1000){
      const fps=Math.round(frames*1000/(now-fpsStarted));
      ui.inferenceFps.textContent=String(fps);
      ui.fps.textContent=fps+' FPS';
      fpsStarted=now;frames=0;
    }
  }catch(error){
    console.error('HoloLab detection error',error);
    stopCamera();
    cameraStatus('Błąd przetwarzania obrazu: '+(error.message||String(error)),'error');
    return;
  }
  raf=requestAnimationFrame(track);
}
function drawHands(list){
  const w=ui.overlay.width,h=ui.overlay.height;
  ctx.clearRect(0,0,w,h);
  ctx.lineCap='round';
  list.forEach((points,index)=>{
    const color=index===0?'#5bf7e5':'#ffbd83';
    ctx.strokeStyle=color;
    ctx.lineWidth=Math.max(2,w/250);
    for(const [a,b] of HAND_EDGES){
      ctx.beginPath();
      ctx.moveTo(points[a].x*w,points[a].y*h);
      ctx.lineTo(points[b].x*w,points[b].y*h);
      ctx.stroke();
    }
    points.forEach((p,i)=>{
      ctx.beginPath();
      ctx.arc(p.x*w,p.y*h,i===4||i===8?5:2.5,0,Math.PI*2);
      ctx.fillStyle=i===4||i===8?'#ffe09d':'#e8fcfd';
      ctx.fill();
    });
  });
}
function setupMouse(){
  ui.canvas.addEventListener('pointerdown',event=>{
    if(!holo||controller.paused)return;
    if(event.button!==0)return;
    mouseActive=true;
    mousePrevious={x:event.clientX,y:event.clientY};
    ui.canvas.setPointerCapture?.(event.pointerId);
    holo.setInteracting(true);
    ui.gestureMode.textContent='MOUSE ROTATION';
  });
  ui.canvas.addEventListener('pointermove',event=>{
    if(!mouseActive||!holo)return;
    const dx=(event.clientX-mousePrevious.x)/Math.max(1,ui.canvas.clientWidth);
    const dy=(event.clientY-mousePrevious.y)/Math.max(1,ui.canvas.clientHeight);
    holo.rotate(dx,dy);mousePrevious={x:event.clientX,y:event.clientY};
  });
  const release=()=>{
    if(!mouseActive)return;
    mouseActive=false;mousePrevious=null;
    holo?.setInteracting(controller.paused);
  };
  ui.canvas.addEventListener('pointerup',release);
  ui.canvas.addEventListener('pointercancel',release);
  ui.canvas.addEventListener('lostpointercapture',release);
  ui.scene.addEventListener('wheel',event=>{
    if(!holo||controller.paused)return;
    event.preventDefault();
    holo.zoom(Math.exp(-event.deltaY*.0013));
    updateScale();
    ui.gestureMode.textContent='MOUSE ZOOM';
  },{passive:false});
}
ui.modelButtons.forEach(button=>button.addEventListener('click',()=>setModel(button.dataset.model)));
ui.reset.addEventListener('click',()=>{
  holo?.resetView();updateScale();ui.gestureMode.textContent='VIEW RESET';
});
ui.pause.addEventListener('click',()=>setPaused(!controller.paused));
ui.start.addEventListener('click',()=>void startCamera());
ui.stop.addEventListener('click',stopCamera);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stopCamera();});
window.addEventListener('pagehide',()=>{stopCamera();holo?.dispose();});
document.addEventListener('keydown',event=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(event.key==='1')setModel('core');
  else if(event.key==='2')setModel('robot');
  else if(event.key.toLowerCase()==='r')holo?.resetView();
  else if(event.code==='Space'){event.preventDefault();setPaused(!controller.paused);}
  else if(event.key==='Escape')setPaused(true);
});
setTop(false);
setupMouse();
void initScene();