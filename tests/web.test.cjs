const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/23353/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),app=pathToFileURL(path.join(root,'web/index.html')).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
 await context.addInitScript(()=>{
  window.vocabHost={call(method,payload){try{let value;switch(method){
   case 'load':value=JSON.parse(localStorage.getItem('test-native-doc')||'null');break;
   case 'syncStatus':value={deviceId:'windows-test-device',platform:'windows'};break;
   case 'save':if(window.failNextSave){window.failNextSave=false;throw new Error('模拟磁盘写入失败');}localStorage.setItem('test-native-doc',JSON.stringify(payload));value=true;break;
   case 'export':window.lastExport=payload;value=true;break;
   case 'probeUsb':value={devices:[]};break;
   case 'syncUsb':value={started:true};break;
   case 'finishSync':value=true;break;
   default:throw new Error(method);
  }return {ok:true,value};}catch(e){return {ok:false,error:e.message};}}};
 });
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(app);await p.waitForSelector('#start-new:not([disabled])');
 const doc=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('test-native-doc'))),state=()=>p.evaluate(()=>OfflineSync.materialize(JSON.parse(localStorage.getItem('test-native-doc'))));
 let s=await state();assert.equal(s.words.length,1493);assert(s.words.every(w=>w.phonetic));assert.equal(s.history.length,0);
 await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();s=await state();assert.equal(s.history.length,1);assert.equal(s.session.cursor,1);assert.equal(s.dailyPlan.done,1);const first=s.words[0].id;
 await p.reload();await p.locator('#continue-session').click();s=await state();assert.equal(s.session.cursor,1);assert.equal(s.cards[first].lastGrade,'good');
 const before=await doc();await p.evaluate(()=>window.failNextSave=true);await p.locator('[data-grade="good"]').click();assert.deepEqual(await doc(),before);assert.match(await p.locator('#usb-message').textContent(),/模拟磁盘写入失败/);assert.match(await p.locator('#position').textContent(),/第 2/);
 await p.locator('#mark-mastered').click();s=await state();const second=s.words[1].id;assert.equal(s.cards[second].mastered,true);assert.equal(s.cards[second].due,null);assert.equal(s.dailyPlan.done,1);await p.locator('#undo').click();s=await state();assert.equal(s.cards[second].mastered,false);assert.equal(s.session.cursor,1);
 await p.locator('#tab-library').click();await p.locator('#search').fill('abstract');await p.locator('#word-list [data-open]').first().click();await p.locator('#detail-anchor').fill('abs + tract');await p.locator('#detail-scene').fill('我的离线联想');await p.locator('#save-detail').click();await p.reload();s=await state();assert.equal(s.cards[s.words.find(w=>w.word==='abstract').id].memoryScene,'我的离线联想');
 await p.locator('#tab-settings').click();await p.locator('#export').click();const exported=await p.evaluate(()=>window.lastExport);assert(exported.name.endsWith('.json'));assert.equal(JSON.parse(JSON.parse(exported.content).payload).words.length,1493);
 // First migration is a baseline import; old dates/history are preserved instead of replayed as new work.
 await p.evaluate(()=>localStorage.removeItem('test-native-doc'));await p.reload();await p.locator('#tab-settings').click();await p.locator('#import-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(exported.content)});await p.locator('#merge-import').click();s=await state();assert.equal(s.history.length,1);assert.equal(s.cards[first].lastGrade,'good');assert.equal((await doc()).operations.length,0);
 await p.getByText('同步档案备份与恢复',{exact:true}).click();await p.locator('#usb-archive-export').click();const archive=await p.evaluate(()=>window.lastExport),profile=(await doc()).profileId;assert.equal(JSON.parse(archive.content).format,'jiufen-usb-packet');await p.evaluate(()=>localStorage.removeItem('test-native-doc'));await p.reload();await p.getByText('同步档案备份与恢复',{exact:true}).click();await p.locator('#usb-archive-import').setInputFiles({name:'archive.json',mimeType:'application/json',buffer:Buffer.from(archive.content)});await p.waitForFunction(profile=>JSON.parse(localStorage.getItem('test-native-doc')).profileId===profile,profile);assert.equal((await state()).history.length,1);
 await p.locator('#usb-start').click();assert(await p.locator('#usb-workspace').evaluate(x=>x.inert));await p.evaluate(()=>window.dispatchEvent(new CustomEvent('vocab-sync-status',{detail:{phase:'error',message:'未连接手机'}})));assert(!await p.locator('#usb-workspace').evaluate(x=>x.inert));
 // Explicit remote text conflict is visible, editable and durably resolved.
 await p.evaluate(()=>{
  let d=JSON.parse(localStorage.getItem('test-native-doc')),a=OfflineSync.materialize(d),remote=OfflineSync.adoptDocument(d,'phone-test-device');let local=structuredClone(a),other=structuredClone(a),id=a.words[0].id;local.cards[id].note='电脑笔记';other.cards[id].note='手机笔记';d=OfflineSync.record(d,a,local);remote=OfflineSync.record(remote,a,other);d=OfflineSync.mergeDocuments(d,remote);localStorage.setItem('test-native-doc',JSON.stringify(d));
 });await p.reload();assert.match(await p.locator('#usb-conflicts').textContent(),/离线修改冲突/);await p.locator('#usb-conflicts textarea').fill('保留两边的笔记');await p.locator('#usb-conflicts button').click();s=await state();assert.equal(s.cards[first].note,'保留两边的笔记');
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(root,'test-results/web-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS native persistence, disk failure rollback, cold launch, ratings/mastery/undo, private cues, JSON export, sync lock, conflict resolution and mobile layout.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
