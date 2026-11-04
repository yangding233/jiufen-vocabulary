'use strict';
const {_electron:electron}=require('./playwright.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const data=path.join(root,'test-results','electron-import-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');

(async()=>{
 let app,p;const errors=[];
 async function launch(){
  app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});
  p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(()=>typeof WordBooks==='object'&&typeof WordImport==='object'&&typeof OfflineSync==='object'&&window.vocabHost?.call('load')?.value?.baseline&&document.getElementById('open-word-import'));
 }
 const doc=()=>p.evaluate(()=>{const result=window.vocabHost.call('load');if(!result.ok)throw new Error(result.error);return result.value;});
 const state=()=>p.evaluate(()=>OfflineSync.materialize(window.vocabHost.call('load').value));
 async function preview(text,bookId=null){
  await p.locator('#tab-library').click();
  if(bookId)await p.locator('#wordbook-filter').selectOption(bookId);
  await p.locator('#open-word-import').click();await p.locator('#wi-text').fill(text);await p.locator('#wi-read').click();
  await p.waitForFunction(()=>!document.getElementById('wi-read').disabled&&document.getElementById('wi-preview').hidden===false);
 }
 async function confirm(){
  await p.locator('#wi-confirm').click();
  await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
 }
 try{
  await launch();let s=await state();assert.equal(s.words.length,1493);assert.equal(s.schema,2);
  assert.equal(s.library,undefined,'opening an old-style blank profile must not rewrite its baseline');
  await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();
  await p.locator('#tab-library').click();await p.locator('#search').fill('a newspaper');await p.locator('[data-open="jf-0001"]').click();
  await p.locator('#detail-note').fill('真实 SQLite 导入前的个人笔记');await p.locator('#save-detail').click();
  const before=await state(),beforeDoc=await doc(),first='jf-0001';
  assert.equal(before.history.length,1);assert.equal(before.cards[first].seen,true);
  await preview('单词\t释义\t音标\t例句\t章节\n'+
   'a newspaper\t导入的报纸资料\t\tThe newspaper is on the desk.\t第一章\n'+
   'electronimportword\t原生导入测试词\t\tThis is a local import test.\t第一章\n'+
   'electrondraftword\t\t\t\t待完善');
  assert.deepEqual(await doc(),beforeDoc,'preview may not mutate real SQLite');
  await p.locator('[data-import-choice="2"]').selectOption('replace');
  await p.locator('#wi-book-name').fill('原生 SQLite 词书');await confirm();
  const bookId=await p.locator('#wordbook-filter').inputValue();s=await state();let d=await doc();
  const added=s.words.find(w=>w.word==='electronimportword'),draft=s.words.find(w=>w.word==='electrondraftword');
  assert(added&&draft);assert.equal(s.words.length,1495);assert.equal(s.library.schema,1);
  assert.equal(s.words.find(w=>w.id===first).meaning,'导入的报纸资料');
  assert.equal(s.words.find(w=>w.id===first).sentence,'The newspaper is on the desk.');
  assert.deepEqual(s.cards[first],before.cards[first]);assert.deepEqual(s.history,before.history);
  assert.equal(d.profileId,beforeDoc.profileId);assert.equal(d.deviceId,beforeDoc.deviceId);
  assert.equal(d.baselineHash,beforeDoc.baselineHash);assert.deepEqual(d.baseline,beforeDoc.baseline);
  assert.equal(s.cards[added.id].planned,false);assert.equal(s.cards[draft.id].planned,false);
  assert(s.library.members[bookId][first]&&s.library.members[bookId][added.id]&&s.library.members[bookId][draft.id]);
  await p.locator('#search').fill('electrondraftword');await p.locator('[data-select="'+draft.id+'"]').check();
  await p.locator('#enroll-selected').click();assert.equal((await state()).cards[draft.id].planned,false);
  await p.locator('#search').fill('');
  await preview('单词\t释义\n'+
   'electronimportword\t原生导入测试词\n'+
   'electrondraftword\t',bookId);
  assert.equal(await p.locator('#wi-book').inputValue(),bookId);await confirm();
  s=await state();assert.equal(s.words.length,1495);assert.equal(s.words.find(w=>w.word==='electronimportword').id,added.id);
  assert.equal(Object.values(s.library.members[bookId]).filter(Boolean).length,3);
  const saved=await doc();await app.close();app=null;
  assert(fs.existsSync(path.join(data,'progress.sqlite')));
  await launch();s=await state();d=await doc();
  assert.equal(s.schema,2);assert.equal(s.library.schema,1);assert.equal(s.library.books[bookId].name,'原生 SQLite 词书');
  assert.equal(s.words.length,1495);assert.equal(s.words.find(w=>w.id===first).meaning,'导入的报纸资料');
  assert.equal(s.words.find(w=>w.id===first).sentence,'The newspaper is on the desk.');
  assert.equal(s.words.find(w=>w.word==='electronimportword').id,added.id);
  assert.deepEqual(s.cards[first],before.cards[first]);assert.deepEqual(s.history,before.history);
  assert.equal(d.profileId,beforeDoc.profileId);assert.equal(d.deviceId,beforeDoc.deviceId);
  assert.equal(d.baselineHash,beforeDoc.baselineHash);assert.deepEqual(d.baseline,beforeDoc.baseline);
  assert.deepEqual(d.operations,saved.operations);assert.equal(s.cards[draft.id].planned,false);
  await p.locator('#tab-library').click();await p.locator('#wordbook-filter').selectOption(bookId);
  assert.equal(await p.locator('#word-list [data-open]').count(),3);
  assert.match(await p.locator('#wordbook-summary').textContent(),/待完善释义 1/);
  assert(await p.evaluate(()=>typeof require==='undefined'));assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(root,'test-results','electron-import-window.png'),fullPage:false});
  await app.close();app=null;
  console.log('PASS real Electron import, SQLite transaction persistence and cold restart, repeated import without duplicate cards, built-in content override, draft plan protection, schema2 compatibility, original profile/baseline/history/card preservation. Isolated database: '+data);
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
