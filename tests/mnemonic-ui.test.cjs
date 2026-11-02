'use strict';
// Isolated browser fixture, not the user's SQLite or iPhone learning document.
const {chromium}=require('./playwright.cjs');
const {pathToFileURL}=require('node:url'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
 await context.addInitScript(()=>{window.vocabHost={call(method,payload){
  if(method==='load')return {ok:true,value:JSON.parse(localStorage.getItem('mnemonic-test-document')||'null')};
  if(method==='save'){localStorage.setItem('mnemonic-test-document',JSON.stringify(payload));return {ok:true,value:true};}
  if(method==='syncStatus')return {ok:true,value:{deviceId:'mnemonic-content-test',platform:'windows'}};
  return {ok:false,error:'Unexpected test method '+method};
 }};});
 const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));
 const file=pathToFileURL(path.resolve(__dirname,'../web/index.html')).href;
 const state=()=>p.evaluate(()=>OfflineSync.materialize(JSON.parse(localStorage.getItem('mnemonic-test-document'))));
 const open=async word=>{if(await p.locator('#word-dialog').evaluate(dialog=>dialog.open))await p.locator('#close-detail').click();await p.locator('#tab-library').click();await p.locator('#search').fill(word);const id=await p.evaluate(word=>OfflineSync.materialize(JSON.parse(localStorage.getItem('mnemonic-test-document'))).words.find(w=>w.word.toLowerCase()===word.toLowerCase()).id,word);await p.locator(`[data-open="${id}"]`).click();};
 await p.goto(file);await p.waitForSelector('#start-new:not([disabled])');
 await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();
 await open('Africa');assert(!/待补|暂未提供/.test(await p.locator('#detail-memory').textContent()));
 assert(await p.locator('#detail-memory .cue-part').count()>0);
 await p.locator('#detail-anchor').fill('我的非洲提示');await p.locator('#detail-scene').fill('我在非洲旅行的个人画面');await p.locator('#save-detail').click();
 await open('age');await p.locator('#detail-memory [data-reject-cue]').click();await p.locator('#close-detail').click();
 const previous=await state();assert.equal(previous.history.length,1);
 // A persisted old built-in memory must not shadow the newly shipped content.
 await p.evaluate(()=>{const d=JSON.parse(localStorage.getItem('mnemonic-test-document'));d.baseline.words.find(w=>w.word==='Africa').memory={kind:'待补巧记',anchor:'旧版空提示',scene:'旧版占位'};d.baselineHash=OfflineSync.createDocument(d.baseline,d.deviceId).baselineHash;localStorage.setItem('mnemonic-test-document',JSON.stringify(d));});
 await p.reload();
 const boot=await p.evaluate(()=>({usb:document.getElementById('usb-message').textContent,fatal:document.getElementById('fatal').hidden,warning:document.getElementById('storage-warning').textContent}));
 assert.deepEqual(errors,[],JSON.stringify(boot));assert(!boot.usb.includes('无法载入'),JSON.stringify(boot));
 await p.waitForSelector('#tab-library');await open('Africa');
 assert.equal(await p.locator('#detail-anchor').inputValue(),'我的非洲提示');assert.equal(await p.locator('#detail-scene').inputValue(),'我在非洲旅行的个人画面');
 await p.locator('#detail-memory summary').filter({hasText:'查看内置方案'}).click();
 assert(!/旧版空提示|旧版占位|待补巧记/.test(await p.locator('#detail-memory').textContent()));
 await open('age');assert.match(await p.locator('#detail-memory').textContent(),/已停用/);
 await open('aging');assert.match(await p.locator('#detail-memory').textContent(),/先记基础词 age/);assert.match(await p.locator('#detail-memory .base-scene').textContent(),/age/);
 assert.match(await p.locator('#detail-memory .spelling-steps').textContent(),/age → aging/);
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await p.screenshot({path:path.resolve(__dirname,'../test-results/mnemonic-derived-mobile.png'),fullPage:true});
 await open('a radio program');const parts=await p.locator('#detail-memory .cue-part strong').allTextContents();assert.deepEqual(parts,['a','radio','program']);
 assert.match(await p.locator('#detail-memory').textContent(),/节目/);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.setViewportSize({width:1280,height:1000});await p.screenshot({path:path.resolve(__dirname,'../test-results/mnemonic-phrase-desktop.png'),fullPage:true});
 const after=await state();assert.deepEqual(after.history,previous.history);assert.deepEqual(after.cards,previous.cards);assert.deepEqual(after.settings,previous.settings);assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS new cues replace old built-ins; personal cues, rejections, ratings and plans retained; base lessons, phrase cards and mobile layout verified.');
})().catch(error=>{console.error(error);process.exit(1);});
