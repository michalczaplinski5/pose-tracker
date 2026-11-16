/**
 * HoloLab renderer. The 3D scene is a visualization only, not robot kinematics.
 * Uses an injected Three.js namespace so tests can isolate gesture behavior.
 */
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

export function createHoloRenderer(THREE, canvas, container) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x061324, 0.035);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 90);
  camera.position.set(0, 0.2, 7.8);
  camera.lookAt(0,0,0);
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;

  scene.add(new THREE.HemisphereLight(0x65e6f1,0x0b1425,2.4));
  const key=new THREE.PointLight(0x64f5e0,90,16);key.position.set(2.7,3.7,4);scene.add(key);
  const rim=new THREE.PointLight(0xffb371,65,14);rim.position.set(-3,-1.4,-2);scene.add(rim);

  const grid=new THREE.GridHelper(12,28,0x246d80,0x174352);
  grid.position.set(0,-1.95,0);
  grid.material.transparent=true;grid.material.opacity=.32;
  scene.add(grid);

  const stars=new THREE.BufferGeometry();
  const xyz=[];
  for(let i=0;i<350;i++){
    // Deterministic star cloud, no random test inconsistencies.
    let n=(i*1664525+1013904223)>>>0;
    const r1=(n%1000)/1000;
    n=(n*1664525+1013904223)>>>0;
    const r2=(n%1000)/1000;
    n=(n*1664525+1013904223)>>>0;
    const r3=(n%1000)/1000;
    xyz.push((r1-.5)*16,(r2-.5)*9,(r3-.5)*10-1.2);
  }
  stars.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
  const starPoints=new THREE.Points(stars,new THREE.PointsMaterial({
    color:0x65baca,size:.018,transparent:true,opacity:.42,sizeAttenuation:true
  }));
  scene.add(starPoints);

  let mode='core', model=null, animateParts=[], frame=0, stopped=false, active=false;
  const target={rx:-.14,ry:.22,rz:0,x:0,y:0,scale:1};
  const world=new THREE.Group();scene.add(world);

  function material(color,emissive,intensity=.65) {
    return new THREE.MeshStandardMaterial({
      color,metalness:.68,roughness:.28,emissive,emissiveIntensity:intensity,
      transparent:true,opacity:.96
    });
  }
  const cyan=material(0x46e4dd,0x0f847e,.65);
  const pale=material(0xa6fff5,0x4dcbb5,.55);
  const dark=material(0x163b49,0x083b52,.45);
  const gold=material(0xf8ba7d,0xae5430,.4);
  const lineCyan=new THREE.MeshBasicMaterial({color:0x70faf0,wireframe:true,transparent:true,opacity:.35});
  const lineGold=new THREE.MeshBasicMaterial({color:0xffb878,wireframe:true,transparent:true,opacity:.25});

  function sphere(radius,mat,parent,x=0,y=0,z=0,detail=2) {
    const m=new THREE.Mesh(new THREE.IcosahedronGeometry(radius,detail),mat);
    m.position.set(x,y,z);parent.add(m);return m;
  }
  function ring(parent,radius,tube,mat,rx=0,ry=0,rz=0) {
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,10,112),mat);
    mesh.rotation.set(rx,ry,rz);parent.add(mesh);return mesh;
  }
  function cylinderBetween(parent,a,b,radius,mat) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    const mid=start.clone().add(end).multiplyScalar(.5);
    const delta=end.clone().sub(start);
    const geom=new THREE.CylinderGeometry(radius,radius*1.05,delta.length(),12);
    const mesh=new THREE.Mesh(geom,mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    parent.add(mesh);
    return mesh;
  }
  function core() {
    const group=new THREE.Group();
    sphere(.58,dark,group,0,0,0,4);
    sphere(.65,lineCyan,group,0,0,0,2);
    sphere(.32,pale,group,0,0,0,3);
    sphere(.21,gold,group,0,0,0,3);
    const r1=ring(group,1.04,.035,cyan,Math.PI/2.9,.3);
    const r2=ring(group,1.33,.023,gold,Math.PI/1.7,Math.PI/3);
    const r3=ring(group,1.61,.016,pale,Math.PI/2.5,Math.PI/4);
    const r4=ring(group,.84,.012,cyan,Math.PI/2,.1);
    for(let i=0;i<12;i++){
      const t=(i/12)*Math.PI*2;
      const p=sphere(.043,i%3===0?gold:cyan,group,Math.cos(t)*1.58,Math.sin(t)*1.58,0,1);
    }
    animateParts=[{mesh:r1,speed:.15,axis:'y'},{mesh:r2,speed:-.12,axis:'x'},
      {mesh:r3,speed:.09,axis:'z'},{mesh:r4,speed:.2,axis:'y'}];
    return group;
  }
  function robot() {
    const group=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.52,.56,.16,32),dark);
    base.position.set(0,-1.4,0);group.add(base);
    ring(group,.42,.025,cyan,Math.PI/2,0,0).position.set(0,-1.30,0);
    const points=[[0,-1.32,0],[0,-.88,0],[.54,.06,.03],[.32,.78,.12],[.60,1.2,.13]];
    cylinderBetween(group,points[0],points[1],.26,dark);
    cylinderBetween(group,points[1],points[2],.16,pale);
    cylinderBetween(group,points[2],points[3],.135,cyan);
    cylinderBetween(group,points[3],points[4],.105,dark);
    for(let i=1;i<points.length-1;i++){
      sphere(i===2?.22:.18,i%2?gold:cyan,group,...points[i],3);
      sphere(.26,lineCyan,group,...points[i],1);
    }
    cylinderBetween(group,[.60,1.19,.13],[.68,1.43,.13],.1,pale);
    cylinderBetween(group,[.62,1.43,.01],[.65,1.71,.01],.046,cyan);
    cylinderBetween(group,[.73,1.43,.25],[.76,1.71,.25],.046,cyan);
    const station=new THREE.Group();
    ring(station,1.50,.012,cyan,Math.PI/2,0,0);
    ring(station,1.37,.012,lineGold,Math.PI/2,0,0);
    station.position.y=-1.33;
    group.add(station);
    animateParts=[{mesh:station,speed:.10,axis:'y'}];
    group.rotation.z=.05;
    return group;
  }

  function disposeObject(group) {
    if(!group)return;
    group.traverse(obj=>{
      if(obj.geometry && typeof obj.geometry.dispose==='function')obj.geometry.dispose();
      // Shared materials are kept until the scene is disposed.
    });
  }
  function setModel(next) {
    if(!['core','robot'].includes(next))return;
    if(model){world.remove(model);disposeObject(model);}
    mode=next;
    model=next==='core'?core():robot();
    world.add(model);
    Object.assign(target,{rx:-.14,ry:.22,rz:0,x:0,y:0,scale:next==='core'?1:1.12});
    world.position.set(0,0,0);
    world.rotation.set(target.rx,target.ry,target.rz);
    world.scale.setScalar(target.scale);
  }
  function resetView() {
    Object.assign(target,{rx:-.14,ry:.22,rz:0,x:0,y:0,scale:mode==='core'?1:1.12});
  }
  function rotate(dx,dy) {
    target.ry+=dx*6.5;
    target.rx=clamp(target.rx+dy*5.0,-1.38,1.38);
  }
  function transform({scale=1,roll=0,panX=0,panY=0}) {
    target.scale=clamp(target.scale*scale,.48,2.65);
    target.rz+=roll;
    target.x=clamp(target.x+panX*4.3,-1.5,1.5);
    target.y=clamp(target.y-panY*3.8,-1.05,1.05);
  }
  function zoom(amount) {target.scale=clamp(target.scale*amount,.48,2.65);}
  function setInteracting(is){active=!!is;}
  function resize(){
    const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  }
  function frameLoop(time){
    if(stopped)return;
    frame=requestAnimationFrame(frameLoop);
    if(Math.abs(container.clientWidth-canvas.width/(renderer.getPixelRatio()))>2 ||
       Math.abs(container.clientHeight-canvas.height/(renderer.getPixelRatio()))>2)resize();
    if(!active)target.ry+=.0006;
    const smooth=.12;
    world.rotation.x+=(target.rx-world.rotation.x)*smooth;
    world.rotation.y+=(target.ry-world.rotation.y)*smooth;
    world.rotation.z+=(target.rz-world.rotation.z)*smooth;
    world.position.x+=(target.x-world.position.x)*smooth;
    world.position.y+=(target.y-world.position.y)*smooth;
    const scale=world.scale.x+(target.scale-world.scale.x)*smooth;
    world.scale.setScalar(scale);
    for(const item of animateParts)item.mesh.rotation[item.axis]+=item.speed*.012;
    renderer.render(scene,camera);
  }
  setModel('core');
  resize();
  frame=requestAnimationFrame(frameLoop);
  return {
    setModel,resetView,rotate,transform,zoom,setInteracting,
    get mode(){return mode;},get scale(){return target.scale;},
    dispose(){
      stopped=true;cancelAnimationFrame(frame);
      disposeObject(model);
      stars.dispose();
      starPoints.material.dispose();
      for(const mat of [cyan,pale,dark,gold,lineCyan,lineGold])mat.dispose();
      renderer.dispose();
    }
  };
}