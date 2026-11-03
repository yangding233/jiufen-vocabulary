'use strict';
const {chromium}=require('./playwright.cjs'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
 await context.addInitScript(()=>{
  window.exportResult=false;window.exports=[];window.vocabHost={call(method,payload){try{let value;
   if(method==='load')value=JSON.parse(localStorage.getItem('feature-doc')||'null');
   else if(method==='save'){localStorage.setItem('feature-doc',JSON.stringify(payload));value=true;}
   else if(method==='contentLoad')value=JSON.parse(localStorage.getItem('feature-content')||'null');
   else if(method==='contentSave'){localStorage.setItem('feature-content',JSON.stringify(payload));value=true;}
   else if(method==='syncStatus')value={platform:'windows',deviceId:'feature-test',appVersion:'1.1.0',lastSync:{at:'2026-11-01T10:00:00Z'},pendingBatch:null};
   else if(method==='export'){window.exports.push(payload);value=window.exportResult;}
   else if(method==='listBackups'){const d=JSON.parse(localStorage.getItem('feature-doc'));window.featureSnapshot=d;const s=OfflineSync.summary(d);value=[{id:'snapshot-test',at:new Date().toISOString(),words:s.wordCount,seen:s.seen,history:s.historyCount}];}
   else if(method==='backupPreview')value=window.featureSnapshot;
   else if(method==='recoveryCreate'){const old=JSON.parse(localStorage.getItem('feature-doc'));if(old.profileId===payload.document.profileId)throw Error('Requires new profile');localStorage.setItem('feature-recovery-previous',JSON.stringify(old));localStorage.setItem('feature-doc',JSON.stringify(payload.document));value=true;}
   else throw Error(method);
   return {ok:true,value};
  }catch(e){return {ok:false,error:e.message};}}};
 });
 const p=await context.newPage(),errors=[],remote=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});p.on('dialog',d=>d.accept());
 await p.goto(pathToFileURL(path.resolve(__dirname,'../web/index.html')).href);await p.waitForSelector('#start-new:not([disabled])');
 const state=()=>p.evaluate(()=>OfflineSync.materialize(JSON.parse(localStorage.getItem('feature-doc'))));
 await p.locator('#tab-library').click();await p.locator('#search').fill('accident');await p.locator('[data-open="jf-0006"]').click();await p.locator('[data-cue-choice="jf-0006"]').selectOption('alt-1');assert.match(await p.locator('#detail-memory .method-pill').textContent(),/替代巧记/);await p.locator('#detail-note').fill('我的笔记保留');await p.locator('#save-detail').click();await p.reload();let selection=await state();assert.equal(selection.cards['jf-0006'].cueChoice,'alt-1');assert.equal(selection.cards['jf-0006'].note,'我的笔记保留');
 assert.match(await p.locator('#content-version').textContent(),/2026-11-03\.2/);assert.match(await p.locator('#sync-brief').textContent(),/上次同步/);
 await p.locator('#start-new').click();await p.locator('#play-audio').click();await p.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('正常速度'));
 await p.locator('#reveal').click();assert.match(await p.locator('#study-usage').textContent(),/newspaper/);
 await p.locator('[data-cue-reason="unknown"]').first().click();let s=await state();assert.equal(s.cards[s.words[0].id].cueFeedback,'unknown');
 await p.locator('#recall-status').selectOption('independent');await p.locator('[data-grade="good"]').click();s=await state();assert.equal(s.history.at(-1).recall,'independent');assert.equal(s.history.at(-1).scheduler,'adaptive-v1');
 await p.locator('#study-mode').selectOption('meaning');await p.locator('#spelling').fill('a radio progrm');await p.locator('#reveal').click();assert.match(await p.locator('#spelling-result').textContent(),/漏写|字母/);await p.locator('[data-grade="hard"]').click();s=await state();assert.equal(s.history.at(-1).spelling.correct,false);
 await p.locator('#tab-history').click();assert.match(await p.locator('#learning-quality').textContent(),/可选拼写正确率/);await p.getByText('最近的拼写错题',{exact:true}).click();assert.match(await p.locator('#spelling-mistakes').textContent(),/progrm/);
 await p.locator('#tab-settings').click();const oldTime=(await state()).meta.lastBackupAt;await p.locator('#export').click();assert.equal((await state()).meta.lastBackupAt,oldTime);assert.match(await p.locator('#toast').textContent(),/取消保存/);
 await p.evaluate(()=>window.exportResult=true);await p.locator('#export').click();assert((await state()).meta.lastBackupAt);
 await p.locator('#load-backups').click();await p.locator('[data-backup-preview]').first().click();assert.match(await p.locator('#backup-preview').textContent(),/当前档案没有被改变/);
 const before=await state();await p.locator('#content-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"bad"}')});await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('内容未更新'));assert.deepEqual((await state()).cards,before.cards);
 const fresh=await p.evaluate(()=>{const pack=JSON.parse(localStorage.getItem('feature-content'));pack.entries[0].usage.sentence='He read a newspaper after the content update.';return ContentPack.create(pack.entries,'2026-11-03.3');});await p.locator('#content-import').setInputFiles({name:'updated-content.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fresh))});await p.waitForFunction(()=>document.getElementById('content-version').textContent.includes('2026-11-03.3'));assert.deepEqual((await state()).cards,before.cards);
 await p.evaluate(()=>{const pack=JSON.parse(localStorage.getItem('feature-content'));const newer=ContentPack.create(pack.entries,'2026-11-03.4');localStorage.setItem('feature-content',JSON.stringify(newer));window.dispatchEvent(new CustomEvent('vocab-sync-status',{detail:{phase:'complete',message:'同步完成'}}));});await p.waitForFunction(()=>document.getElementById('content-version').textContent.includes('2026-11-03.4'));
 await p.locator('#font-size').selectOption('large');await p.reload();assert.equal(await p.locator('body').getAttribute('data-font-size'),'large');
 await p.setViewportSize({width:390,height:844});await p.reload();assert.equal(await p.locator('#usb-panel-details').evaluate(x=>x.open),false);await p.locator('#continue-session').click();await p.locator('#study-mode').selectOption('listening');assert.match(await p.locator('#word').textContent(),/听音/);assert.equal(await p.locator('#spelling-box').isVisible(),true);
 assert.equal(await p.locator('.ratings').evaluate(x=>getComputedStyle(x).position),'fixed');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await p.screenshot({path:path.resolve(__dirname,'../test-results/features-mobile.png'),fullPage:true});
 await p.locator('#pause-session').click();await p.locator('#tab-settings').click();await p.locator('#load-backups').click();await p.locator('[data-backup-preview]').first().click();const previousProfile=await p.evaluate(()=>JSON.parse(localStorage.getItem('feature-doc')).profileId);await p.locator('#restore-snapshot').click();await p.waitForFunction(previous=>JSON.parse(localStorage.getItem('feature-doc')).profileId!==previous,previousProfile);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('feature-recovery-previous')).profileId),previousProfile);
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);await browser.close();console.log('PASS offline audio, cue feedback, recall metadata, spelling mistakes, accurate backup cancellation, content rejection, saved font and mobile focus layout.');
})().catch(e=>{console.error(e);process.exit(1);});
