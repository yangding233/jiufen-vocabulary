const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('./playwright.cjs');
const root=path.resolve(__dirname,'..'),app=pathToFileURL(path.join(root,'web/index.html')).href;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
 await context.addInitScript(()=>{
  window.vocabHost={call(method,payload){try{let value;switch(method){
   case 'load':value=JSON.parse(localStorage.getItem('test-native-doc')||'null');break;
   case 'contentLoad':value=JSON.parse(localStorage.getItem('test-native-content')||'null');break;
   case 'contentSave':localStorage.setItem('test-native-content',JSON.stringify(payload));value=true;break;
   case 'appStatus':value={deviceId:'windows-test-device',platform:'windows',appVersion:'2.0.0'};break;
   case 'save':if(window.failNextSave){window.failNextSave=false;throw new Error('模拟磁盘写入失败');}localStorage.setItem('test-native-doc',JSON.stringify(payload));value=true;break;
   case 'export':window.lastExport=payload;value=true;break;
   default:throw new Error(method);
  }return {ok:true,value};}catch(e){return {ok:false,error:e.message};}}};
 });
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(app);await p.waitForSelector('#start-new:not([disabled])');
 const flush=()=>p.evaluate(()=>VocabPersistence.flush());
 const doc=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('test-native-doc')));
 const state=async()=>{await flush();return p.evaluate(()=>DesktopState.documentState(JSON.parse(localStorage.getItem('test-native-doc'))));};
 let s=await state();assert.equal(s.words.length,1493);assert(s.words.every(w=>w.phonetic));assert.equal(s.history.length,0);
 assert.equal((await doc()).format,'jiufen-desktop');assert.equal(await p.locator('[id^=usb-]').count(),0);assert.equal(await p.evaluate(()=>typeof OfflineSync),'undefined');
 await p.locator('#start-new').click();await flush();await p.locator('[data-grade="good"]').click();await flush();s=await state();assert.equal(s.history.length,1);assert.equal(s.session.cursor,1);assert.equal(s.dailyPlan.done,1);const first=s.words[0].id;
 await p.reload();await p.locator('#continue-session').click();await flush();s=await state();assert.equal(s.session.cursor,1);assert.equal(s.cards[first].lastGrade,'good');
 const before=await doc();await p.evaluate(()=>window.failNextSave=true);await p.locator('[data-grade="good"]').click();
 await p.waitForFunction(()=>document.getElementById('local-message').textContent.includes('模拟磁盘写入失败'));
 assert.deepEqual(await doc(),before);assert.match(await p.locator('#position').textContent(),/第 2/);
 await p.locator('#mark-mastered').click();await flush();s=await state();const second=s.words[1].id;assert.equal(s.cards[second].mastered,true);assert.equal(s.cards[second].due,null);assert.equal(s.dailyPlan.done,1);
 await p.locator('#undo').click();await flush();s=await state();assert.equal(s.cards[second].mastered,false);assert.equal(s.session.cursor,1);
 await p.locator('#tab-library').click();await p.locator('#search').fill('abstract');await p.locator('#word-list [data-open]').first().click();await p.locator('#detail-anchor').fill('abs + tract');await p.locator('#detail-scene').fill('我的离线联想');await p.locator('#save-detail').click();await flush();await p.reload();s=await state();assert.equal(s.cards[s.words.find(w=>w.word==='abstract').id].memoryScene,'我的离线联想');
 await p.locator('#tab-settings').click();await p.locator('#export').click();await flush();const exported=await p.evaluate(()=>window.lastExport),archive=JSON.parse(exported.content);assert(exported.name.endsWith('.json'));assert.equal(archive.format,'jiufen-desktop');assert.equal(archive.state.words.length,1493);
 // One backup entrance restores snapshots; there is no transport, pairing or merge-log UI.
 await p.evaluate(()=>localStorage.removeItem('test-native-doc'));await p.reload();await p.locator('#tab-settings').click();
 await p.locator('#import-file').setInputFiles({name:'desktop-backup.json',mimeType:'application/json',buffer:Buffer.from(exported.content)});
 await p.locator('#replace-import').click();await flush();s=await state();assert.equal(s.history.length,1);assert.equal(s.cards[first].lastGrade,'good');assert.equal((await doc()).operations,undefined);
 assert.equal(s.cards[s.words.find(w=>w.word==='abstract').id].memoryScene,'我的离线联想');
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results/web-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS desktop snapshots, async save, disk failure rollback, cold launch, ratings/mastery/undo, private cues, one JSON restore entry and narrow window layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
