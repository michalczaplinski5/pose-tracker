import { DeskGestureEngine, Inertia, toHand, clamp } from './desk-engine.mjs';

const $=id=>document.getElementById(id);
const ui={
  workspace:$('workspace'),layer:$('window-layer'),cursor:$('gesture-pointer'),
  radial:$('radial-menu'),menuOpen:$('menu-open'),feedback:$('feedback'),
  start:$('camera-start'),stop:$('camera-stop'),pause:$('pause'),
  imageInput:$('image-input'),glbInput:$('glb-input'),reset:$('layout-reset'),
  cam:$('camera'),overlay:$('camera-overlay'),camFrame:$('camera-view'),
  state:$('camera-state'),sysLabel:$('system-label'),sys:$('system-led'),
  handCount:$('hands-value'),dataHands:$('data-hands'),fps:$('fps-value'),
  dataFps:$('data-fps'),dataPanels:$('data-panels'),mode:$('mode-value'),
  status:$('mode-text'),workspaceState:$('workspace-state'),gestureState:$('gesture-state'),
  notes:$('notes-editor'),modelStage:$('model-stage'),modelCanvas:$('model-canvas'),
  modelFallback:$('model-fallback'),modelLabel:$('model-file-label'),help:$('show-help')
};
const ctx=ui.overlay.getContext('2d');
const engine=new DeskGestureEngine();
const HAND_EDGES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]];
const states=new Map(),urls=new Set(),smoothHands=new Map();
let front=10,activeId='model',grabbing=null,mouseDrag=null,gesturePoint={x:.5,y:.5};
let menuOpen=false,menuUntil=0,stream=null,handModel=null,starting=false,running=false;
let cameraEpoch=0,detectRaf=0,lastVideoTime=-1,lastDetection=-Infinity,detected=0,lastFps=0;
let handCount=0,three=null,viewer=null,viewerPromise=null,lastTick=performance.now();
let raf=0,photoCount=0,modelRotation={x:.18,y:.15},viewerDrag=null;
const initial=[
  {id:'gallery',x:.27,y:.31,z:72,rotY:-9,scale:.96},
  {id:'model',x:.67,y:.36,z:105,rotY:7,scale:1},
  {id:'notes',x:.29,y:.77,z:90,rotY:-5,scale:.97},
  {id:'data',x:.73,y:.77,z:42,rotY:9,scale:.95}
];
function announce(text){
  ui.feedback.textContent=text;
}
function stateFor(id){return states.get(id);}
function visiblePanels(){return [...states.values()].filter(v=>v.visible).length;}
function updateCounts(){ui.dataPanels.textContent=String(visiblePanels()).padStart(2,'0');}
function makeState(id,element,position,kind='default'){
  const st={id,element,kind,
    x:position.x,y:position.y,z:position.z??55,rotY:position.rotY??0,
    rotation:0,scale:position.scale??1,visible:true,zIndex:++front,
    inertia:new Inertia(),blobUrl:null
  };
  states.set(id,st);
  element.dataset.window=id;
  element.style.zIndex=String(st.zIndex);
  renderWindow(st);
  attachWindow(st);
  updateCounts();
  return st;
}
function renderWindow(st){
  if(!st.visible)return;
  st.element.style.left=(st.x*100).toFixed(3)+'%';
  st.element.style.top=(st.y*100).toFixed(3)+'%';
  st.element.style.transform=
    'translate(-50%,-50%) translateZ('+st.z.toFixed(1)+'px) rotateY('+st.rotY.toFixed(2)+
    'deg) rotateZ('+st.rotation.toFixed(2)+'deg) scale('+st.scale.toFixed(3)+')';
}
function selectWindow(id){
  const st=states.get(id);
  if(!st)return null;
  if(!st.visible){st.visible=true;st.element.classList.remove('hidden-window');updateCounts();}
  activeId=id;
  st.zIndex=++front;st.element.style.zIndex=String(st.zIndex);st.inertia.stop();
  for(const other of states.values())other.element.classList.toggle('selected',other.id===id);
  announce('Wybrano: '+(st.element.querySelector('.window-title strong')?.textContent||id));
  return st;
}
function closeWindow(id){
  const st=states.get(id);
  if(!st)return;
  st.visible=false;st.inertia.stop();
  st.element.classList.add('hidden-window');
  if(st.kind==='photo'){
    if(st.blobUrl){URL.revokeObjectURL(st.blobUrl);urls.delete(st.blobUrl);}
    st.element.remove();states.delete(id);
  }
  if(activeId===id){
    activeId='';
    const first=[...states.values()].find(v=>v.visible);
    if(first)selectWindow(first.id);
  }
  updateCounts();
  announce('Zamknięto panel '+id+'. Możesz go przywrócić z menu gestowego.');
}
function resetLayout(){
  for(const p of initial){
    const st=states.get(p.id);
    if(!st)continue;
    Object.assign(st,{x:p.x,y:p.y,z:p.z,rotY:p.rotY,rotation:0,scale:p.scale,visible:true});
    st.element.classList.remove('hidden-window');
    st.inertia.stop();
    renderWindow(st);
  }
  let i=0;
  for(const st of states.values()){
    if(st.kind==='photo'){
      st.x=.30+(i%3)*.19;st.y=.37+Math.floor(i/3)*.12;
      st.scale=.86;st.rotation=0;st.inertia.stop();renderWindow(st);i++;
    }
  }
  selectWindow('model');updateCounts();announce('Przywrócono układ przestrzennego pulpitu.');
}
function workspaceRect(){return ui.workspace.getBoundingClientRect();}
function screenPoint(point){
  const r=workspaceRect();
  return {x:r.left+point.x*r.width,y:r.top+point.y*r.height};
}
function pointerTarget(point){
  const screen=screenPoint(point);
  return [...states.values()].filter(s=>s.visible&&
    hitRect(screen,s.element.getBoundingClientRect())).sort((a,b)=>b.zIndex-a.zIndex)[0]||null;
}
function hitRect(p,r){return p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;}
function clampPosition(st){
  st.x=clamp(st.x,.08,.92);st.y=clamp(st.y,.11,.89);
}
function attachWindow(st){
  st.element.addEventListener('pointerdown',event=>{
    if(event.target.closest('button,input,textarea,canvas,label,a'))return;
    selectWindow(st.id);
    if(!event.target.closest('.window-chrome'))return;
    event.preventDefault();event.stopPropagation();
    beginMouseDrag(st,event);
  });
  st.element.addEventListener('keydown',event=>{
    if(event.target.closest('textarea'))return;
    if(event.key==='Enter'){selectWindow(st.id);event.preventDefault();}
  });
}
function beginMouseDrag(st,event){
  if(mouseDrag)return;
  st.inertia.stop();
  const r=workspaceRect();
  mouseDrag={st,pointerId:event.pointerId,lastX:event.clientX,lastY:event.clientY,
    lastTime:performance.now(),vx:0,vy:0};
  st.element.classList.add('grabbed');
  const target=event.currentTarget;
  target.setPointerCapture?.(event.pointerId);
  const move=e=>{
    if(!mouseDrag||e.pointerId!==mouseDrag.pointerId)return;
    const now=performance.now(),dt=Math.max(.012,(now-mouseDrag.lastTime)/1000);
    const dx=(e.clientX-mouseDrag.lastX)/r.width,dy=(e.clientY-mouseDrag.lastY)/r.height;
    st.x+=dx;st.y+=dy;clampPosition(st);
    mouseDrag.vx=clamp(mouseDrag.vx*.55+dx/dt*.45,-1.4,1.4);
    mouseDrag.vy=clamp(mouseDrag.vy*.55+dy/dt*.45,-1.4,1.4);
    mouseDrag.lastX=e.clientX;mouseDrag.lastY=e.clientY;mouseDrag.lastTime=now;
    renderWindow(st);
  };
  const up=e=>{
    if(!mouseDrag||e.pointerId!==mouseDrag.pointerId)return;
    st.element.classList.remove('grabbed');
    st.inertia.launch(mouseDrag.vx,mouseDrag.vy);
    mouseDrag=null;
    target.removeEventListener('pointermove',move);
    target.removeEventListener('pointerup',up);
    target.removeEventListener('pointercancel',up);
    target.removeEventListener('lostpointercapture',lost);
  };
  const lost=()=>{if(!mouseDrag)return;mouseDrag.vx=0;mouseDrag.vy=0;up({pointerId:mouseDrag.pointerId});};
  target.addEventListener('pointermove',move);
  target.addEventListener('pointerup',up);
  target.addEventListener('pointercancel',up);
  target.addEventListener('lostpointercapture',lost);
}
function showMenu(x=.5,y=.5){
  if(engine.paused)return;
  const rect=workspaceRect();
  const marginX=Math.min(.37,148/Math.max(1,rect.width));
  const marginY=Math.min(.31,148/Math.max(1,rect.height));
  const px=clamp(x,marginX,1-marginX),py=clamp(y,marginY,1-marginY);
  ui.radial.style.left=(px*100)+'%';ui.radial.style.top=(py*100)+'%';
  ui.radial.hidden=false;menuOpen=true;
  announce('Menu gestowe otwarte. Wskaż opcję palcem i wykonaj szczypnięcie.');
  ui.gestureState.textContent='MENU';
  for(const b of ui.radial.querySelectorAll('button'))b.classList.remove('aimed');
}
function closeMenu(){
  menuOpen=false;ui.radial.hidden=true;
  for(const b of ui.radial.querySelectorAll('button'))b.classList.remove('aimed');
}
function activateMenu(command){
  closeMenu();
  if(command==='dismiss')return;
  if(command==='arrange'){resetLayout();return;}
  if(states.has(command)){
    selectWindow(command);
    announce('Otworzono panel '+command.toUpperCase()+'.');
  }
}
function menuButtonAt(point){
  if(!menuOpen)return null;
  const pos=screenPoint(point);
  return [...ui.radial.querySelectorAll('button')].find(b=>hitRect(pos,b.getBoundingClientRect()))||null;
}
function updateAim(point){
  const hovered=menuButtonAt(point);
  for(const button of ui.radial.querySelectorAll('button')){
    button.classList.toggle('aimed',button===hovered);
  }
}
function onDeskEvent(event,now){
  switch(event.type){
    case 'pointer':
      gesturePoint={x:clamp((event.x-.05)/.90,.01,.99),y:clamp((event.y-.05)/.90,.01,.99)};
      ui.cursor.hidden=engine.paused;
      ui.cursor.style.left=gesturePoint.x*100+'%';
      ui.cursor.style.top=gesturePoint.y*100+'%';
      ui.cursor.classList.toggle('active',event.active);
      if(menuOpen)updateAim(gesturePoint);
      else if(!grabbing){
        const hover=pointerTarget(gesturePoint);
        for(const st of states.values())st.element.classList.toggle('aimed',st===hover);
      }
      break;
    case 'menu':
      if(menuOpen)closeMenu();
      else showMenu(gesturePoint.x,gesturePoint.y);
      break;
    case 'press':
      if(menuOpen){
        const button=menuButtonAt(gesturePoint);
        if(button)activateMenu(button.dataset.command);
        return;
      }
      grabbing=pointerTarget(gesturePoint);
      if(grabbing){
        selectWindow(grabbing.id);
        grabbing.element.classList.add('grabbed');
        grabbing.inertia.stop();
        ui.status.textContent='GRABBING';
        ui.gestureState.textContent='PINCH';
      }
      break;
    case 'move':
      if(grabbing&&!menuOpen){
        grabbing.x+=event.dx/.90;grabbing.y+=event.dy/.90;
        clampPosition(grabbing);renderWindow(grabbing);
      }
      break;
    case 'dual-start':
      if(menuOpen)closeMenu();
      if(!grabbing){
        grabbing=states.get(activeId)||pointerTarget(gesturePoint);
        if(grabbing)selectWindow(grabbing.id);
      }
      if(grabbing){grabbing.inertia.stop();grabbing.element.classList.add('grabbed');}
      ui.status.textContent='TWO-HAND';
      ui.gestureState.textContent='TRANSFORM';
      break;
    case 'dual':
      if(grabbing){
        grabbing.x+=event.dx/.90;grabbing.y+=event.dy/.90;
        grabbing.scale=clamp(grabbing.scale*event.scale,.56,1.75);
        grabbing.rotation+=event.rotation*180/Math.PI;
        clampPosition(grabbing);renderWindow(grabbing);
      }
      break;
    case 'release':
      if(grabbing){
        grabbing.element.classList.remove('grabbed');
        if(!event.cancelled&&!menuOpen){
          grabbing.inertia.launch(event.velocity?.x||0,event.velocity?.y||0);
        }
        grabbing=null;
      }
      if(!engine.paused){
        ui.status.textContent='TRACKING';
        ui.gestureState.textContent='RELEASED';
      }
      break;
    case 'pause':
      closeMenu();grabbing=null;
      for(const st of states.values()){st.element.classList.remove('grabbed');st.inertia.stop();}
      ui.pause.textContent='▶ WZNÓW';ui.pause.setAttribute('aria-pressed','true');
      ui.status.textContent='PAUSED';ui.mode.textContent='PAUSE';
      ui.gestureState.textContent='PAUSED';ui.cursor.hidden=true;
      announce('Sterowanie zatrzymane. Otwórz dłoń na 0,9 s lub kliknij Wznów.');
      break;
    case 'resume':
      ui.pause.textContent='Ⅱ PAUZA';ui.pause.setAttribute('aria-pressed','false');
      ui.status.textContent='TRACKING';ui.mode.textContent='GESTURE';
      ui.gestureState.textContent='READY';
      announce('Sterowanie wznowione.');
      break;
  }
}
function dispatch(events,now){
  for(const event of events)onDeskEvent(event,now);
}
function pauseAction(){
  const events=engine.pause(!engine.paused);dispatch(events,performance.now());
}
function animate(now){
  const dt=Math.max(0,(now-lastTick)/1000);lastTick=now;
  for(const st of states.values()){
    if(!st.visible)continue;
    if(!grabbing||grabbing.id!==st.id){
      if(Math.abs(st.inertia.vx)+Math.abs(st.inertia.vy)>.015){
        const next=st.inertia.step(dt,st);
        st.x=next.x;st.y=next.y;
        renderWindow(st);
      }
    }
  }
  if(viewer&&viewer.renderer){
    const stage=ui.modelStage, w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    if(viewer.w!==w||viewer.h!==h){
      viewer.w=w;viewer.h=h;viewer.renderer.setSize(w,h,false);
      viewer.camera.aspect=w/h;viewer.camera.updateProjectionMatrix();
    }
    if(states.get('model')?.visible){
      if(viewer.group)viewer.group.rotation.y+=Math.min(dt,.06)*.18;
      viewer.renderer.render(viewer.scene,viewer.camera);
    }
  }
  raf=requestAnimationFrame(animate);
}
function setupWindows(){
  for(const p of initial){
    const e=ui.layer.querySelector('[data-window="'+p.id+'"]');
    if(!e)throw new Error('Missing base window '+p.id);
    makeState(p.id,e,p);
  }
  selectWindow('model');
  ui.layer.addEventListener('click',event=>{
    const button=event.target.closest('[data-close]');
    if(button){event.stopPropagation();closeWindow(button.dataset.close);}
  });
}
function saveNotes(){
  try{localStorage.setItem('poseTracker:desk:notes',ui.notes.value);}catch(e){console.warn('Notes storage',e);}
}
function restoreNotes(){
  try{const value=localStorage.getItem('poseTracker:desk:notes');if(value!==null)ui.notes.value=value;}
  catch(e){console.warn('Notes storage',e);}
}
function addPhoto(file){
  if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){
    announce('Obsługiwane formaty zdjęć: JPG, PNG, WebP, GIF.');return;
  }
  if(file.size>18*1024*1024){announce('Zdjęcie przekracza limit 18 MB.');return;}
  if([...states.values()].filter(st=>st.kind==='photo').length>=10){
    announce('Limit 10 zdjęć. Zamknij niektóre, aby dodać kolejne.');return;
  }
  const objectUrl=URL.createObjectURL(file);urls.add(objectUrl);
  const id='photo-'+(++photoCount);
  const article=document.createElement('article');
  article.className='spatial-window photo-window';
  article.tabIndex=0;
  article.setAttribute('aria-label','Zdjęcie '+file.name);
  const chrome=document.createElement('div');chrome.className='window-chrome';
  const icon=document.createElement('span');icon.className='window-symbol';icon.textContent='▧';
  const title=document.createElement('div');title.className='window-title';
  const strong=document.createElement('strong');strong.textContent=file.name;
  const small=document.createElement('small');small.textContent='USER IMAGE / LOCAL';
  title.append(strong,small);
  const button=document.createElement('button');button.type='button';button.className='close-window';
  button.dataset.close=id;button.setAttribute('aria-label','Zamknij zdjęcie '+file.name);button.textContent='×';
  chrome.append(icon,title,button);
  const content=document.createElement('div');content.className='photo-content';
  const img=document.createElement('img');img.alt=file.name;img.src=objectUrl;
  content.append(img);
  const foot=document.createElement('div');foot.className='window-tail';
  const txt=document.createElement('span');txt.textContent='PHOTO / LOCAL IMPORT';
  const dot=document.createElement('span');dot.className='tail-dot';foot.append(txt,dot);
  article.append(chrome,content,foot);
  ui.layer.append(article);
  const count=[...states.values()].filter(st=>st.kind==='photo').length;
  const st=makeState(id,article,{
    x:clamp(.38+(count%4)*.12,.15,.85),
    y:clamp(.33+(count%3)*.13,.17,.82),
    z:120+count*6,scale:.90,rotY:count%2?7:-7
  },'photo');
  st.blobUrl=objectUrl;
  selectWindow(id);
  announce('Zdjęcie dodane lokalnie: '+file.name);
}
async function handleImages(list){
  for(const file of [...list])addPhoto(file);
  ui.imageInput.value='';
}
function fileLooksGlb(file){
  return /\.glb$/i.test(file.name)&&file.size<=40*1024*1024;
}
function disposeModel(root){
  if(!root)return;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(obj=>{
    if(obj.geometry)geometries.add(obj.geometry);
    const values=Array.isArray(obj.material)?obj.material:[obj.material];
    for(const m of values){
      if(!m)continue;materials.add(m);
      for(const key of Object.keys(m)){
        const t=m[key];if(t&&t.isTexture)textures.add(t);
      }
    }
  });
  textures.forEach(v=>v.dispose());materials.forEach(v=>v.dispose());geometries.forEach(v=>v.dispose());
}
function buildDefaultObject(T){
  const g=new T.Group();
  const inner=new T.Mesh(new T.IcosahedronGeometry(.64,3),new T.MeshStandardMaterial({
    color:0x46e3d0,metalness:.82,roughness:.22,emissive:0x178a83,emissiveIntensity:.55
  }));
  g.add(inner);
  for(const [r,rx,ry,c] of [[1.15,.6,.25,0x7af8e3],[1.37,1.1,-.4,0xf3b67b],[1.62,-.5,1.2,0x75c3e9]]){
    const mesh=new T.Mesh(new T.TorusGeometry(r,.021,8,100),new T.MeshBasicMaterial({
      color:c,transparent:true,opacity:.9
    }));
    mesh.rotation.set(rx,ry,0);g.add(mesh);
  }
  return g;
}
async function ensureViewer(){
  if(viewer)return viewer;
  if(viewerPromise)return viewerPromise;
  viewerPromise=(async()=>{
    const T=await import('three');
    three=T;
    const scene=new T.Scene();
    const camera=new T.PerspectiveCamera(42,1,.1,100);
    camera.position.set(0,0,5.7);
    const renderer=new T.WebGLRenderer({
      canvas:ui.modelCanvas,alpha:true,antialias:true,powerPreference:'low-power'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=T.SRGBColorSpace;
    scene.add(new T.HemisphereLight(0x98eeec,0x263244,2.1));
    const light=new T.DirectionalLight(0xf2ffff,3.4);light.position.set(3,4,5);scene.add(light);
    const rim=new T.PointLight(0xffb78e,32,12);rim.position.set(-3,-2,2);scene.add(rim);
    const group=buildDefaultObject(T);scene.add(group);
    viewer={scene,camera,renderer,group,defaultGroup:group,w:0,h:0};
    ui.modelFallback.hidden=true;
    return viewer;
  })().catch(err=>{
    viewerPromise=null;
    console.warn('3D viewer unavailable',err);
    announce('Podgląd 3D wymaga WebGL i połączenia z CDN. Inne funkcje HoloDesk nadal działają.');
    throw err;
  });
  return viewerPromise;
}
async function loadGlb(file){
  if(!fileLooksGlb(file)){announce('Wybierz plik .glb o wielkości maksymalnie 40 MB.');return;}
  selectWindow('model');
  announce('Wczytywanie modelu GLB: '+file.name+'…');
  try{
    const v=await ensureViewer();
    const buffer=await file.arrayBuffer();
    const view=new DataView(buffer);
    if(view.byteLength<20||view.getUint32(0,true)!==0x46546c67)throw new Error('Plik nie ma nagłówka GLB.');
    const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
    const gltf=await new GLTFLoader().parseAsync(buffer,'');
    const root=gltf.scene;
    const box=new three.Box3().setFromObject(root);
    if(box.isEmpty())throw new Error('Model nie zawiera geometrii.');
    const size=new three.Vector3();box.getSize(size);
    const max=Math.max(size.x,size.y,size.z,.001);
    const center=new three.Vector3();box.getCenter(center);
    const factor=2.7/max;
    root.scale.multiplyScalar(factor);
    root.position.sub(center.multiplyScalar(factor));
    if(v.group){v.scene.remove(v.group);if(v.group!==v.defaultGroup)disposeModel(v.group);}
    v.group=root;v.scene.add(root);
    ui.modelLabel.textContent='GLB / '+file.name.slice(0,25).toUpperCase();
    announce('Wczytano model lokalnie: '+file.name);
  }catch(error){
    console.error('GLB import',error);
    announce('Nie udało się otworzyć modelu GLB: '+(error.message||String(error)));
  }finally{ui.glbInput.value='';}
}
function beginViewerDrag(){
  ui.modelCanvas.addEventListener('pointerdown',event=>{
    if(!viewer||event.button!==0)return;
    event.stopPropagation();
    viewerDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY};
    ui.modelCanvas.setPointerCapture?.(event.pointerId);
  });
  ui.modelCanvas.addEventListener('pointermove',event=>{
    if(!viewerDrag||event.pointerId!==viewerDrag.pointerId||!viewer?.group)return;
    viewer.group.rotation.y+=(event.clientX-viewerDrag.x)*.009;
    viewer.group.rotation.x+=(event.clientY-viewerDrag.y)*.009;
    viewerDrag.x=event.clientX;viewerDrag.y=event.clientY;
  });
  const end=()=>{viewerDrag=null;};
  ui.modelCanvas.addEventListener('pointerup',end);
  ui.modelCanvas.addEventListener('pointercancel',end);
  ui.modelCanvas.addEventListener('lostpointercapture',end);
}
const mediapipe='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const handUrl='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
async function loadHandModel(){
  if(handModel)return handModel;
  const vision=await import(mediapipe+'/+esm');
  const assets=await vision.FilesetResolver.forVisionTasks(mediapipe+'/wasm');
  const opts=delegate=>({
    baseOptions:{modelAssetPath:handUrl,delegate},
    runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.50,
    minHandPresenceConfidence:.5,minTrackingConfidence:.50
  });
  try{handModel=await vision.HandLandmarker.createFromOptions(assets,opts('GPU'));}
  catch(e){
    console.warn('GPU unavailable, retrying CPU',e);
    handModel=await vision.HandLandmarker.createFromOptions(assets,opts('CPU'));
  }
  return handModel;
}
function updateCameraState(on){
  ui.camFrame.classList.toggle('on',on);
  ui.start.hidden=on;ui.stop.hidden=!on;
  document.querySelector('.connection').classList.toggle('connected',on);
  ui.sysLabel.textContent=on?'HAND TRACKING':'SYSTEM STANDBY';
  ui.state.textContent=on?'LIVE':'STANDBY';
  ui.state.classList.toggle('active',on);
  ui.status.textContent=on?'GESTURE':'MOUSE / TOUCH';
  ui.mode.textContent=on?'GESTURE':'MOUSE';
  ui.workspaceState.textContent=on?'CAMERA ONLINE':'NO TRACKING';
}
async function startCamera(){
  if(starting||running)return;
  starting=true;ui.start.disabled=true;
  const ticket=++cameraEpoch;
  announce('Proszę o dostęp do kamery…');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
      throw new Error('Kamera wymaga HTTPS i zgody w przeglądarce.');
    const s=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30},facingMode:{ideal:'user'}}
    });
    if(ticket!==cameraEpoch){s.getTracks().forEach(t=>t.stop());return;}
    stream=s;ui.cam.srcObject=s;
    await ui.cam.play();
    if(ticket!==cameraEpoch)return;
    updateCameraState(true);
    announce('Kamera aktywna, pobieranie modelu dłoni MediaPipe…');
    await loadHandModel();
    if(ticket!==cameraEpoch)return;
    engine.reset();
    running=true;lastVideoTime=-1;lastDetection=-Infinity;detected=0;lastFps=performance.now();
    announce('Śledzenie aktywne. Przytrzymaj otwartą dłoń przez 0,7 sekundy, aby otworzyć menu.');
    detectRaf=requestAnimationFrame(detectFrame);
  }catch(error){
    if(ticket!==cameraEpoch)return;
    stopCamera();
    announce(error.name==='NotAllowedError'?'Dostęp do kamery został zablokowany. Zmień uprawnienia strony.':
      'Nie udało się uruchomić kamery: '+(error.message||String(error)));
  }finally{
    if(ticket===cameraEpoch){starting=false;ui.start.disabled=false;}
  }
}
function stopCamera(){
  cameraEpoch++;starting=false;running=false;
  if(detectRaf)cancelAnimationFrame(detectRaf);
  detectRaf=0;
  if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
  try{ui.cam.pause();}catch(e){}
  ui.cam.srcObject=null;
  ctx.clearRect(0,0,ui.overlay.width,ui.overlay.height);
  dispatch(engine.end(true),performance.now());
  engine.reset();smoothHands.clear();closeMenu();grabbing=null;
  ui.cursor.hidden=true;handCount=0;updateHandValues();updateCameraState(false);
  ui.start.disabled=false;
  announce('Kamera wyłączona. Pulpitem można nadal sterować myszką.');
}
function smoothSample(raw,time){
  const previous=smoothHands.get(raw.id);
  const sample={...raw};
  if(previous&&time-previous.time<400){
    const alpha=.46;
    sample.point={
      x:alpha*raw.point.x+(1-alpha)*previous.point.x,
      y:alpha*raw.point.y+(1-alpha)*previous.point.y
    };
    sample.palm={
      x:alpha*raw.palm.x+(1-alpha)*previous.palm.x,
      y:alpha*raw.palm.y+(1-alpha)*previous.palm.y
    };
  }
  smoothHands.set(raw.id,{...sample,time});
  return sample;
}
function drawHands(hands){
  const width=ui.overlay.width,height=ui.overlay.height;
  ctx.clearRect(0,0,width,height);
  hands.forEach((pts,index)=>{
    ctx.strokeStyle=index===0?'#67f7e1':'#ffbe82';
    ctx.fillStyle='#ecffff';ctx.lineWidth=2.4;ctx.lineCap='round';
    for(const [a,b] of HAND_EDGES){
      ctx.beginPath();ctx.moveTo(pts[a].x*width,pts[a].y*height);
      ctx.lineTo(pts[b].x*width,pts[b].y*height);ctx.stroke();
    }
    for(let i=0;i<pts.length;i++){
      const p=pts[i];ctx.beginPath();
      ctx.arc(p.x*width,p.y*height,(i===4||i===8)?4.5:2,0,Math.PI*2);
      ctx.fill();
    }
  });
}
function updateHandValues(){
  const n=String(handCount).padStart(2,'0');
  ui.handCount.textContent=n;ui.dataHands.textContent=n;
}
function detectFrame(now){
  if(!running)return;
  try{
    const v=ui.cam;
    if(v.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&v.videoWidth&&
       v.currentTime!==lastVideoTime&&now-lastDetection>=40){
      lastVideoTime=v.currentTime;lastDetection=now;
      if(ui.overlay.width!==v.videoWidth||ui.overlay.height!==v.videoHeight){
        ui.overlay.width=v.videoWidth;ui.overlay.height=v.videoHeight;
      }
      const result=handModel.detectForVideo(v,now);
      const seen=result.landmarks||[];
      const handSamples=seen.map((points,index)=>{
        const raw=toHand(points,result.handednesses?.[index]?.[0]?.categoryName||'H'+index,true);
        return raw?smoothSample(raw,now):null;
      }).filter(Boolean);
      drawHands(seen);
      handCount=handSamples.length;updateHandValues();
      dispatch(engine.update(handSamples,now),now);
      ui.gestureState.textContent=engine.paused?'PAUSED':engine.mode.toUpperCase();
      detected++;
    }
    if(now-lastFps>=1000){
      const fps=Math.round(detected*1000/(now-lastFps));
      ui.fps.textContent=String(fps);ui.dataFps.textContent=String(fps);
      detected=0;lastFps=now;
    }
    detectRaf=requestAnimationFrame(detectFrame);
  }catch(error){
    console.error('HoloDesk camera error',error);
    stopCamera();announce('Błąd detekcji: '+(error.message||String(error)));
  }
}
function showHelp(){
  const dialog=document.createElement('dialog');
  dialog.className='help-dialog';
  dialog.innerHTML='<h2>HoloDesk — sterowanie</h2>'+
    '<p>🖐️ <b>Otwarta dłoń przez 0,7 s:</b> pokaż menu kołowe</p>'+
    '<p>🤏 <b>Pinch:</b> chwyć panel, przesuwaj i puść — rozpęd nada bezwładność</p>'+
    '<p>🤏🤏 <b>Obie dłonie:</b> skalowanie oraz obrót aktywnego okna</p>'+
    '<p>✊ <b>Pięść przez 0,95 s:</b> pauza; otwarta dłoń przez 0,9 s — wznowienie</p>'+
    '<p>🖱️ <b>Bez kamery:</b> przeciągaj za nagłówki, kółkiem skaluj okna.</p>'+
    '<p><b>Skróty:</b> M — menu, P — pauza, R — reset układu, Esc — zamknij menu.</p>';
  const btn=document.createElement('button');btn.type='button';btn.textContent='Zamknij';
  btn.addEventListener('click',()=>dialog.close());dialog.append(btn);
  dialog.addEventListener('close',()=>dialog.remove());
  document.body.append(dialog);dialog.showModal();
}
function installEvents(){
  ui.start.addEventListener('click',()=>void startCamera());
  ui.stop.addEventListener('click',stopCamera);
  ui.pause.addEventListener('click',pauseAction);
  ui.menuOpen.addEventListener('click',()=>menuOpen?closeMenu():showMenu());
  ui.reset.addEventListener('click',resetLayout);
  ui.help.addEventListener('click',showHelp);
  // Handle wheel at the 3D workspace level: overlapping transformed windows
  // and nested WebGL canvases otherwise may swallow the browser wheel target.
  ui.workspace.addEventListener('wheel',event=>{
    if(event.target.closest('textarea'))return;
    event.preventDefault();
    const windowElement=event.target.closest('.spatial-window');
    const candidate=windowElement?states.get(windowElement.dataset.window):null;
    const st=(candidate&&candidate.visible?candidate:null)||states.get(activeId);
    if(!st||!st.visible)return;
    selectWindow(st.id);
    st.scale=clamp(st.scale*Math.exp(-event.deltaY*.0011),.55,1.75);
    renderWindow(st);
  },{passive:false,capture:true});
  for(const button of ui.radial.querySelectorAll('button')){
    button.addEventListener('click',()=>activateMenu(button.dataset.command));
  }
  ui.imageInput.addEventListener('change',()=>void handleImages(ui.imageInput.files));
  ui.glbInput.addEventListener('change',()=>{
    const file=ui.glbInput.files?.[0];if(file)void loadGlb(file);
  });
  ui.notes.addEventListener('input',saveNotes);
  // Allow file drag-and-drop from local filesystem.
  ui.workspace.addEventListener('dragover',event=>{
    if(!event.dataTransfer?.types?.includes('Files'))return;
    event.preventDefault();ui.workspace.querySelector('#drop-hint').hidden=false;
  });
  ui.workspace.addEventListener('dragleave',event=>{
    if(!ui.workspace.contains(event.relatedTarget))$('drop-hint').hidden=true;
  });
  ui.workspace.addEventListener('drop',event=>{
    if(!event.dataTransfer?.files?.length)return;
    event.preventDefault();$('drop-hint').hidden=true;
    const all=[...event.dataTransfer.files];
    void handleImages(all.filter(f=>f.type.startsWith('image/')));
    const glb=all.find(f=>/\.glb$/i.test(f.name));if(glb)void loadGlb(glb);
  });
  document.addEventListener('keydown',event=>{
    if(['TEXTAREA','INPUT','SELECT'].includes(document.activeElement?.tagName))return;
    const key=event.key.toLowerCase();
    if(key==='escape'){closeMenu();}
    else if(key==='m'){menuOpen?closeMenu():showMenu();}
    else if(key==='p')pauseAction();
    else if(key==='r')resetLayout();
  });
  window.addEventListener('pagehide',()=>{
    stopCamera();cancelAnimationFrame(raf);
    for(const url of urls)URL.revokeObjectURL(url);
    urls.clear();
    viewer?.renderer.dispose();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stopCamera();});
  // Keyboard activation for labels that open local file pickers.
  document.querySelectorAll('.action-label').forEach(label=>{
    label.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();$(label.htmlFor).click();
      }
    });
  });
}
function init(){
  setupWindows();restoreNotes();installEvents();beginViewerDrag();
  ui.cursor.hidden=true;
  lastTick=performance.now();raf=requestAnimationFrame(animate);
  // Viewer failure cannot stop the rest of HoloDesk.
  void ensureViewer().catch(()=>{});
  announce('HoloDesk gotowy. Chwyć nagłówek okna lub otwórz menu gestowe.');
}
init();
