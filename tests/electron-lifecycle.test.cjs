'use strict';
// Deliberately delayed saves exercise the main-process close/refresh barriers.
const {_electron:electron}=require('./playwright.cjs');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=path.join(root,'test-results','electron-lifecycle-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
(async()=>{
 let app,p;const errors=[];
 async function launch(){
  app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});
  p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));
  await p.waitForFunction(()=>window.VocabPersistence&&window.vocabHost?.callAsync);
  await p.evaluate(()=>window.VocabPersistence.flush());
 }
 async function state(){return p.evaluate(async()=>{await window.VocabPersistence.flush();return vocabHost.call('load').value.state;});}
 async function delayWrites(){await p.evaluate(()=>{
  const original=VocabNative.callAsync.bind(VocabNative);
  VocabNative.callAsync=async(method,payload)=>{if(method==='save')await new Promise(resolve=>setTimeout(resolve,800));return original(method,payload);};
 });}
 try{
  await launch();await p.locator('#start-new').click();await state();
  const before=await p.locator('#word').textContent();await delayWrites();
  const timing=await p.evaluate(async()=>{
   const started=performance.now();document.querySelector('[data-grade="good"]').click();
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
   return {paintMs:performance.now()-started,word:document.getElementById('word').textContent,disabled:document.querySelector('[data-grade="good"]').disabled};
  });
  assert.notEqual(timing.word,before,'next card should render while the 800ms disk delay is still pending');
  assert(timing.paintMs<750,'UI feedback must precede delayed save completion');assert(timing.disabled,'repeat grading must be guarded while the write is pending');
  const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;
  await launch();let saved=await state();assert.equal(saved.history.length,1);assert.equal(saved.session.cursor,1);
  await p.locator('#continue-session').click();await state();await delayWrites();
  await p.evaluate(()=>document.querySelector('[data-grade="good"]').click());
  const reloaded=p.waitForEvent('domcontentloaded');await app.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0].webContents;contents.sendInputEvent({type:'keyDown',keyCode:'F5'});contents.sendInputEvent({type:'keyUp',keyCode:'F5'});});await reloaded;
  await p.waitForFunction(()=>window.VocabPersistence);saved=await state();assert.equal(saved.history.length,2);assert.equal(saved.session.cursor,2);
  assert.equal(await p.locator('[id^=usb-]').count(),0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'test-results','electron-lifecycle-timing.json'),JSON.stringify(timing,null,2));
  console.log('PASS next-card paint before delayed persistence; close/F5 wait for saves; records survive cold restart. '+JSON.stringify(timing));
 }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exit(1);});
