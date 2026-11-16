/**
 * HoloDesk V5 browser smoke test.
 * Runs in GitHub Actions against a local static server; no private camera needed.
 * Produces a desktop screenshot as an artifact for visual inspection.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DESK_TEST_URL || 'http://127.0.0.1:8767';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
});
const context = await browser.newContext({viewport:{width:1500,height:1000},deviceScaleFactor:1});
const page = await context.newPage();
const errors=[];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if(message.type()==='error')console.warn('Browser console:',message.text());});
const test = async (label,fn)=>{
  await fn(); console.log('PASS:',label);
};
try{
  await page.goto(BASE+'/desk.html',{waitUntil:'domcontentloaded',timeout:45_000});
  await test('V5 page loads with four spatial windows',async()=>{
    assert.match(await page.title(),/HoloDesk/i);
    assert.equal(await page.locator('.spatial-window').count(),4);
    assert.equal(await page.locator('#model-canvas').count(),1);
  });
  await test('V5.1 sensitivity controls and calibration guidance respond',async()=>{
    const slider=page.locator('#pinch');
    await slider.focus();
    await slider.press('End');
    assert.equal(await page.locator('#pinch-label').textContent(),'100%');
    await page.locator('#calibration-start').click();
    assert.match(await page.locator('#feedback').textContent(),/kamerę/i);
    assert.equal(await page.locator('#calibration-layer').isVisible(),false);
  });
  await test('radial menu is clickable with mouse',async()=>{
    await page.locator('#menu-open').click();
    assert.equal(await page.locator('.radial-action[data-command="notes"]').isVisible(),true);
    await page.locator('.radial-action[data-command="notes"]').click();
    assert.equal(await page.locator('.radial-action[data-command="notes"]').isVisible(),false);
    assert.equal(await page.locator('[data-window="notes"]').isVisible(),true);
  });
  await test('floating windows move when dragging their header',async()=>{
    const window=page.locator('[data-window="gallery"]');
    const oldLeft=await window.evaluate(node=>parseFloat(node.style.left));
    const rect=await window.locator('.window-chrome').boundingBox();
    assert.ok(rect,'Window header must be visible');
    await page.mouse.move(rect.x+36,rect.y+20);
    await page.mouse.down();
    await page.mouse.move(rect.x+135,rect.y+70,{steps:7});
    await page.mouse.up();
    const newLeft=await window.evaluate(node=>parseFloat(node.style.left));
    assert.ok(newLeft>oldLeft+1.5,'Window should move horizontally');
  });
  await test('mouse wheel scales the active window',async()=>{
    const el=page.locator('[data-window="model"]');
    // The previously dragged gallery may be frontmost; explicitly focus the model.
    await el.locator('.window-chrome').click({position:{x:40,y:18}});
    const prev=await el.evaluate(node=>node.style.transform);
    await el.locator('.window-chrome').hover({position:{x:40,y:18}});
    await page.mouse.wheel(0,-170);
    await page.waitForTimeout(100);
    const after=await el.evaluate(node=>node.style.transform);
    assert.notEqual(after,prev,'Transform should change after zoom');
  });
  await test('photo upload adds a local draggable card',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yk0klEAAAAASUVORK5CYII=','base64');
    await page.locator('#image-input').setInputFiles({name:'demo-photo.png',mimeType:'image/png',buffer:png});
    await page.locator('.photo-window').first().waitFor({state:'visible',timeout:8000});
    assert.equal(await page.locator('.photo-window').count(),1);
    assert.match(await page.locator('.photo-window img').getAttribute('src'),/^blob:/);
  });
  await test('notes persist after reload on the same origin',async()=>{
    await page.locator('#notes-editor').fill('Notatka testowa HoloDesk V5');
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#notes-editor').inputValue(),'Notatka testowa HoloDesk V5');
  });
  await test('Three.js viewer initializes and can parse a local GLB',async()=>{
    // Wait for WebGL procedural object to become active, not a decorative fallback.
    await page.waitForFunction(()=>document.querySelector('#model-fallback')?.hidden===true,
      undefined,{timeout:50_000});
    const json={
      asset:{version:'2.0'},
      scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
      meshes:[{primitives:[{attributes:{POSITION:0}}]}],
      buffers:[{byteLength:36}],
      bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962}],
      accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}]
    };
    const jsonText=Buffer.from(JSON.stringify(json),'utf8');
    const jsonPadding=(4-jsonText.length%4)%4;
    const jsonBuf=Buffer.concat([jsonText,Buffer.alloc(jsonPadding,0x20)]);
    const bin=Buffer.alloc(36);
    [-1,-1,0,1,-1,0,0,1,0].forEach((value,i)=>bin.writeFloatLE(value,i*4));
    const glb=Buffer.alloc(12+8+jsonBuf.length+8+bin.length);
    glb.writeUInt32LE(0x46546c67,0);
    glb.writeUInt32LE(2,4);
    glb.writeUInt32LE(glb.length,8);
    glb.writeUInt32LE(jsonBuf.length,12);
    glb.writeUInt32LE(0x4e4f534a,16);
    jsonBuf.copy(glb,20);
    const binHeader=20+jsonBuf.length;
    glb.writeUInt32LE(bin.length,binHeader);
    glb.writeUInt32LE(0x004e4942,binHeader+4);
    bin.copy(glb,binHeader+8);
    await page.locator('#glb-input').setInputFiles({name:'triangle.glb',mimeType:'model/gltf-binary',buffer:glb});
    await page.waitForFunction(()=>document.querySelector('#model-file-label')?.textContent?.includes('TRIANGLE.GLB'),
      undefined,{timeout:30_000});
    assert.match(await page.locator('#feedback').textContent(),/Wczytano model lokalnie/);
  });
  await test('legacy V4 and HoloLab remain available',async()=>{
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#workspace').count(),1);
    assert.equal(await page.locator('a[href="./desk.html"]').count(),1);
    await page.goto(BASE+'/holo.html',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#three-canvas').count(),1);
    assert.equal(await page.locator('a[href="./desk.html"]').count(),1);
  });
  await page.goto(BASE+'/desk.html',{waitUntil:'domcontentloaded'});
  await page.locator('#menu-open').click();
  mkdirSync('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/holodesk-v5-desktop.png',fullPage:true});
  assert.equal(errors.length,0,'Uncaught browser errors: '+errors.join('; '));
  console.log('HoloDesk browser smoke tests passed.');
}finally{
  await browser.close();
}