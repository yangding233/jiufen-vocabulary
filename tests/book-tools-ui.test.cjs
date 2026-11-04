'use strict';
const {chromium}=require('./playwright.cjs'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai'});
  await context.addInitScript(()=>{window.bookExports=[];window.vocabHost={call(method,payload){let value;
   if(method==='load')value=JSON.parse(localStorage.getItem('books-ui-doc')||'null');
   else if(method==='save'){if(window.failBookSave){window.failBookSave=false;return {ok:false,error:'模拟词书保存失败'};}localStorage.setItem('books-ui-doc',JSON.stringify(payload));value=true;}
   else if(method==='contentLoad')value=null;else if(method==='contentSave')value=true;
   else if(method==='appStatus')value={platform:'windows',appVersion:'2.1.0',deviceId:'books-ui'};
   else if(method==='export'){window.bookExports.push(payload);value=true;}
   else return {ok:false,error:'Unexpected '+method};return {ok:true,value};
  }}});
  const p=await context.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});p.on('dialog',dialog=>dialog.accept());
  await p.goto(pathToFileURL(path.resolve(__dirname,'../web/index.html')).href);await p.waitForSelector('#book-tools-panel',{state:'attached'});const flush=()=>p.evaluate(()=>VocabPersistence.flush());await flush();
  await p.locator('#start-new').click();await flush();await p.locator('[data-grade="good"]').click();await flush();await p.locator('#pause-session').click();
  await p.evaluate(async()=>{await VocabApp.commit(s=>{WordBooks.createBook(s,{id:'book:small',name:'两词测试'});WordBooks.addMember(s,'book:small',s.words[1].id,{chapter:'甲',order:0});WordBooks.addMember(s,'book:small',s.words[2].id,{chapter:'乙',order:1});});});await flush();
  const original=await p.evaluate(()=>vocabHost.call('load').value.state);
  await p.locator('#open-plan-home').click();await p.locator('#bt-scope-all').uncheck();await p.locator('[data-bt-study="book:jiufen"]').uncheck();await p.locator('#apply-learning-plan').click();await flush();
  let saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert.deepEqual(saved.settings.studyBooks,['book:small']);assert.deepEqual(saved.cards,original.cards);assert.deepEqual(saved.history,original.history);if(await p.locator('#learning-plan-dialog').evaluate(d=>d.open))await p.locator('#close-learning-plan').click();
  assert.equal(await p.locator('#stat-new').textContent(),'2');
  await p.locator('#tab-library').click();await p.locator('#wordbook-filter').selectOption('book:small');await p.locator('#book-tools-panel > details > summary').click();
  await p.locator('#bt-chapter').selectOption('乙');await p.locator('#bt-chapter-up').click();await flush();saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert(saved.library.members['book:small'][saved.words[2].id].order<saved.library.members['book:small'][saved.words[1].id].order);
  await p.locator('#bt-export').click();const exported=await p.evaluate(()=>bookExports.at(-1));assert(exported?.content);const pack=JSON.parse(exported.content);assert.equal(pack.entries.length,2);assert(!('cards' in pack)&&!('history' in pack));
  await p.locator('#bt-archive').click();await flush();saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert.equal(saved.library.books['book:small'].archived,true);assert.deepEqual(saved.settings.studyBooks,['book:small']);
  await p.locator('#bt-archived').selectOption('book:small');await p.locator('#bt-restore-archive').click();await flush();await p.locator('#wordbook-filter').selectOption('book:small');
  await p.locator('#bt-import').setInputFiles({name:'books.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});assert(await p.locator('#bt-preview-dialog').evaluate(d=>d.open));assert.match(await p.locator('#bt-package-summary').textContent(),/关联 2/);await p.evaluate(async()=>{await VocabApp.commit(s=>{s.settings.fontSize='large';});});await flush();const beforeStale=await p.evaluate(()=>vocabHost.call('load').value);await p.locator('#bt-package-apply').click();await p.waitForFunction(()=>document.getElementById('bt-dialog-error').textContent.includes('资料已更新'));assert.deepEqual(await p.evaluate(()=>vocabHost.call('load').value),beforeStale);await p.evaluate(()=>window.failBookSave=true);await p.locator('#bt-package-apply').click();await p.waitForFunction(()=>document.getElementById('bt-dialog-error').textContent.includes('保存未完成'));assert.deepEqual(await p.evaluate(()=>vocabHost.call('load').value),beforeStale);await p.locator('#bt-package-apply').click();await flush();await p.waitForFunction(()=>!document.getElementById('bt-preview-dialog').open);
  saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert.equal(saved.words.length,original.words.length);assert.deepEqual(saved.cards,original.cards);assert.deepEqual(saved.history,original.history);
  await p.evaluate(async()=>{await VocabApp.commit(s=>{const before=structuredClone(s);WordBooks.setContent(s,s.words[1].id,{meaning:'本批新释义'});BookTools.recordBatch(before,s,{id:'batch:ui-undo',name:'界面撤销测试'});});});await flush();
  await p.getByText('撤销最近的资料批次',{exact:true}).click();await p.locator('[data-bt-undo="batch:ui-undo"]').click();assert.match(await p.locator('#bt-package-summary').textContent(),/可安全还原/);await p.locator('#bt-undo-apply').click();await flush();
  saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert.equal(saved.words[1].meaning,original.words[1].meaning);assert.deepEqual(saved.history,original.history);
  await p.locator('#wordbook-filter').selectOption('book:jiufen');await p.locator('#bt-export').click();const builtins=await p.evaluate(()=>JSON.parse(bookExports.at(-1).content));assert.equal(builtins.entries.length,1493);assert(builtins.entries.some(e=>e.materials?.schemes?.length));
  await p.reload();await p.waitForSelector('#book-tools-panel',{state:'attached'});await flush();saved=await p.evaluate(()=>vocabHost.call('load').value.state);assert.deepEqual(saved.settings.studyBooks,['book:small']);assert.deepEqual(saved.history,original.history);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await p.locator('#tab-library').click();await p.locator('#book-tools-panel > details > summary').click();await p.screenshot({path:path.resolve(__dirname,'../test-results/books-tools-window.png'),fullPage:false});
  console.log('PASS study scope, chapter order, archive/restore, privacy-safe package export, explicit import, safe batch undo, builtin schemes and cold restart; progress retained.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
