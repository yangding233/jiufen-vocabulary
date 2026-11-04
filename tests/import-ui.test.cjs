'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('./playwright.cjs');
const root=path.resolve(__dirname,'..'),url=pathToFileURL(path.join(root,'web/index.html')).href;

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
  await context.addInitScript(()=>{
   window.importExports=[];
   window.vocabHost={call(method,payload){try{let value;
    if(method==='load')value=JSON.parse(localStorage.getItem('import-ui-doc')||'null');
    else if(method==='save'){
     if(window.failImportSave){window.failImportSave=false;throw new Error('模拟导入磁盘写入失败');}
     localStorage.setItem('import-ui-doc',JSON.stringify(payload));value=true;
    }else if(method==='contentLoad')value=JSON.parse(localStorage.getItem('import-ui-content')||'null');
    else if(method==='contentSave'){localStorage.setItem('import-ui-content',JSON.stringify(payload));value=true;}
    else if(method==='syncStatus')value={platform:'windows',deviceId:'import-ui-pc',appVersion:'1.2.0'};
    else if(method==='export'){window.importExports.push(payload);value=true;}
    else if(method==='probeUsb')value={devices:[]};
    else if(method==='syncUsb')value={started:true};
    else if(method==='finishSync')value=true;
    else throw new Error('Unexpected native call: '+method);
    return {ok:true,value};
   }catch(e){return {ok:false,error:e.message};}}};
  });
  const p=await context.newPage(),errors=[],remote=[];
  p.on('pageerror',e=>errors.push(e.message));
  p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  p.on('dialog',d=>d.accept());
  await p.goto(url);await p.waitForSelector('#start-new:not([disabled])');
  const doc=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('import-ui-doc')));
  const state=()=>p.evaluate(()=>OfflineSync.materialize(JSON.parse(localStorage.getItem('import-ui-doc'))));
  const readText=async text=>{
   await p.locator('#wi-text').fill(text);await p.locator('#wi-read').click();
   await p.waitForFunction(()=>!document.getElementById('wi-read').disabled);
  };
  const importFile=async(name,mimeType,buffer)=>{
   await p.locator('#wi-file').setInputFiles({name,mimeType,buffer});await p.locator('#wi-read').click();
   await p.waitForFunction(()=>!document.getElementById('wi-read').disabled);
  };
  // Seed a genuine scheduled feedback. Importing the same entry must preserve it.
  await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();
  const original=await state(),identity=await doc(),first=original.words[0];
  assert.equal(original.history.length,1);assert.equal(first.word,'a newspaper');
  assert(!original.words.some(w=>w.word==='codeximportword'||w.word==='lexiconpending'));
  await p.locator('#tab-library').click();await p.locator('#open-word-import').click();
  // A curated usage sentence is already visible even when the legacy word's
  // sentence field is blank. Fill-only must preserve that visible sentence.
  await readText('英文\t中文释义\t英文例句\n'+first.word+'\t'+first.meaning+'\tA different imported example.');
  assert.match(await p.locator('#wi-preview-summary').textContent(),/待选择 1/);
  await p.locator('[data-import-choice="2"]').selectOption('fill');
  assert.match(await p.locator('#wi-preview-summary').textContent(),/更新 0/);
  assert.deepEqual(await doc(),identity,'checking visible usage must not change the learning archive');
  await readText('英文,中文释义,音标,英文例句,例句译文,章节\n'+
   'a newspaper,导入者另写的报纸释义,,"She read a newspaper, then left.",她看过报纸后离开了。,阅读\n'+
   'codeximportword,导入测试词,,"This example, with a comma, stays together.",这是测试例句。,阅读\n'+
   'codeximportword,导入测试词,,"This example, with a comma, stays together.",这是测试例句。,阅读\n'+
   'lexiconpending,,,,,待完善');
  assert(await p.locator('#wi-preview').isVisible());
  assert.equal(await p.locator('#wi-header').isChecked(),true);
  assert.equal(await p.locator('#wi-map-word').inputValue(),'0');
  assert.match(await p.locator('#wi-preview-summary').textContent(),/待选择 1/);
  assert(await p.locator('#wi-confirm').isDisabled());
  assert.deepEqual(await doc(),identity,'preview must not persist any change');
  await p.locator('[data-import-choice="2"]').selectOption('keep');
  await p.locator('#wi-book-name').fill('导入界面验证');
  assert.equal(await p.locator('#wi-confirm').isDisabled(),false);
  await p.locator('#wi-confirm').click();
  await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  let s=await state(),d=await doc();
  assert.equal(s.words.length,original.words.length+2);
  assert.deepEqual(s.cards[first.id],original.cards[first.id]);assert.deepEqual(s.history,original.history);
  assert.equal(d.profileId,identity.profileId);assert.equal(d.deviceId,identity.deviceId);
  assert.equal(d.baselineHash,identity.baselineHash);assert.deepEqual(d.baseline,identity.baseline);
  const bookId=await p.locator('#wordbook-filter').inputValue();
  assert.equal(s.library.books[bookId].name,'导入界面验证');
  assert.equal(Object.values(s.library.members[bookId]).filter(Boolean).length,3);
  const added=s.words.find(w=>w.word==='codeximportword'),draft=s.words.find(w=>w.word==='lexiconpending');
  assert.equal(added.sentence,'This example, with a comma, stays together.');
  assert.equal(s.cards[added.id].planned,false);assert.equal(s.cards[draft.id].planned,false);
  assert.match(await p.locator('#wordbook-summary').textContent(),/待完善释义 1/);
  assert.equal(await p.locator('#word-list [data-open]').count(),3);
  await p.locator('#search').fill('lexiconpending');
  await p.locator('[data-select="'+draft.id+'"]').check();await p.locator('#enroll-selected').click();
  assert.equal((await state()).cards[draft.id].planned,false,'a draft cannot enter the scheduled new-word pool');
  await p.locator('#search').fill('');
  // Reopen and repeat the same file into the same book: stable IDs, no duplicate cards.
  await p.reload();await p.locator('#tab-library').click();await p.locator('#wordbook-filter').selectOption(bookId);
  await p.locator('#open-word-import').click();
  await readText('单词\t释义\t例句\n'+
   'codeximportword\t导入测试词\tThis example, with a comma, stays together.\n'+
   'lexiconpending\t\t');
  assert.equal(await p.locator('#wi-book').inputValue(),bookId);
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  s=await state();assert.equal(s.words.length,original.words.length+2);assert.equal(s.words.find(w=>w.word==='codeximportword').id,added.id);
  assert.equal(Object.values(s.library.members[bookId]).filter(Boolean).length,3);assert.deepEqual(s.history,original.history);
  // Updating content is durable across cold boot and leaves the existing card untouched.
  await p.locator('#open-word-import').click();
  await importFile('update.csv','text/csv',Buffer.from('单词,释义,音标,例句\na newspaper,更新后的报纸说明,/ə ˈnjuːzˌpeɪpə/,This is the imported sentence.'));
  await p.locator('[data-import-choice="2"]').selectOption('replace');
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  await p.reload();s=await state();
  assert.equal(s.words.find(w=>w.id===first.id).meaning,'更新后的报纸说明');
  assert.deepEqual(s.cards[first.id],original.cards[first.id]);assert.deepEqual(s.history,original.history);
  // Linking an existing entry into a second book shares the original card and ID.
  await p.locator('#tab-library').click();await p.locator('#open-word-import').click();
  await readText('单词\t释义\ncodeximportword\t导入测试词');
  await p.locator('#wi-book').selectOption('new');await p.locator('#wi-book-name').fill('第二本共享词书');
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  const secondBook=await p.locator('#wordbook-filter').inputValue();s=await state();
  assert.notEqual(secondBook,bookId);assert(s.library.members[bookId][added.id]);assert(s.library.members[secondBook][added.id]);
  assert.equal(s.words.filter(w=>w.word==='codeximportword').length,1);
  // A deliberate independent entry survives reboot without stealing the built-in entry's history.
  await p.locator('#open-word-import').click();await readText('单词\t释义\na newspaper\t独立义项测试');
  await p.locator('[data-import-choice="2"]').selectOption('new');
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  await p.reload();s=await state();
  assert.equal(s.words.filter(w=>w.word==='a newspaper').length,2);
  assert(s.words.some(w=>w.id!==first.id&&w.word==='a newspaper'&&w.meaning==='独立义项测试'));
  assert.equal(s.words.find(w=>w.id===first.id).meaning,'更新后的报纸说明');
  assert.deepEqual(s.cards[first.id],original.cards[first.id]);assert.deepEqual(s.history,original.history);
  // Read a real two-sheet XLSX generated by the bundled parser; choose the second sheet.
  await p.locator('#tab-library').click();await p.locator('#open-word-import').click();
  const xlsx=await p.evaluate(()=>{
   const book=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['忽略','word'],['无关列','ignorethissheet']]),'不用这张');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['释义','扩展','常规','章节'],['表格测试词','ignoreextension','spreadsheetimportword','第二章']]),'常规词');
   return Array.from(new Uint8Array(XLSX.write(book,{bookType:'xlsx',type:'array'})));
  });
  await importFile('multi-sheet.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',Buffer.from(xlsx));
  await p.locator('#wi-sheet').selectOption('1');
  await p.locator('#wi-map-word').selectOption('2');await p.locator('#wi-map-meaning').selectOption('0');
  assert.match(await p.locator('#wi-rows').textContent(),/spreadsheetimportword/);
  assert(!/ignoreextension/.test(await p.locator('#wi-rows').textContent()));
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  s=await state();assert(s.words.some(w=>w.word==='spreadsheetimportword'));assert(!s.words.some(w=>w.word==='ignoreextension'||w.word==='ignorethissheet'));
  // Failed native save leaves both the stored doc and visible wordbook unchanged; retry works.
  await p.locator('#open-word-import').click();await readText('单词\t释义\ndurableimportword\t保存重试词');
  const beforeFailure=await doc();await p.evaluate(()=>window.failImportSave=true);await p.locator('#wi-confirm').click();
  assert.deepEqual(await doc(),beforeFailure);assert(await p.locator('#word-import-dialog').evaluate(x=>x.open));
  assert.match(await p.locator('#wi-error').textContent(),/保存没有完成/);
  await p.locator('#wi-confirm').click();
  // The rollback increases the local revision; a fresh preview may require one explicit reconfirmation.
  if(await p.locator('#word-import-dialog').evaluate(x=>x.open))await p.locator('#wi-confirm').click();
  await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  assert((await state()).words.some(w=>w.word==='durableimportword'));
  // Bad CSV never commits partial data. Error report and template are local exports.
  await p.locator('#open-word-import').click();const beforeBad=await doc();
  await readText('单词,释义\n"broken,quote');
  assert.match(await p.locator('#wi-error').textContent(),/引号/);assert.deepEqual(await doc(),beforeBad);
  await p.locator('#wi-template').click();assert.match(await p.evaluate(()=>window.importExports.at(-1).name),/模板/);
  await readText('单词\t释义\nvalidlocalword\t有效\n这不是英文\t错误');
  assert(await p.locator('#wi-confirm').isDisabled());await p.locator('#wi-export-errors').click();
  assert.match(await p.evaluate(()=>window.importExports.at(-1).content),/这不是英文/);
  await p.locator('[data-import-choice="3"]').selectOption('skip');assert.equal(await p.locator('#wi-confirm').isDisabled(),false);
  // Editing the source invalidates the old approved preview until it is read again.
  const beforeSourceEdit=await doc();await p.locator('#wi-text').fill('单词\t释义\nCodeximportword\t导入测试词');
  assert(await p.locator('#wi-confirm').isDisabled());assert.deepEqual(await doc(),beforeSourceEdit);
  await p.locator('#wi-read').click();await p.waitForFunction(()=>!document.getElementById('wi-read').disabled);
  assert(await p.locator('#wi-confirm').isDisabled());
  // Even a single case-only candidate must have an explicit target selector.
  assert.equal(await p.locator('[data-import-target="2"]').count(),1);
  await p.locator('[data-import-target="2"]').selectOption(added.id);
  assert.equal(await p.locator('#wi-confirm').isDisabled(),false);
  // The mobile dialog scrolls its own table, without horizontal overflow of the page.
  await p.setViewportSize({width:390,height:844});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await p.locator('#word-import-dialog').evaluate(x=>x.getBoundingClientRect().width<=innerWidth));
  await p.locator('#word-import-dialog').evaluate(x=>x.scrollTop=0);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results/import-mobile.png'),fullPage:false});
  await p.locator('#wi-confirm').click();await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  s=await state();assert.equal(s.words.length,OfflineWordCount(beforeSourceEdit));
  assert.equal(s.words.filter(w=>w.word.toLowerCase()==='codeximportword').length,1);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS import preview, CSV quoting, multi-sheet XLSX and mapping, repeated import, durable content updates, shared progress and baseline preservation, drafts, native save rollback/retry, errors, stale preview invalidation, case-only candidate selection, offline exports and mobile layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
function OfflineWordCount(document){return require('../shared/sync-core.js').materialize(document).words.length;}
