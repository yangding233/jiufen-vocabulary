'use strict';
// Real SQLite test; JIUFEN_DATA_DIR keeps daily learning data out of this run.
const {_electron:electron}=require('./playwright.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const data=path.join(root,'test-results','electron-dictionary-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');

(async()=>{
 let app,p;const errors=[];
 async function launch(){
  app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});
  p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(()=>typeof Dictionary==='object'&&typeof DesktopState==='object'&&window.vocabHost?.call('load')?.value?.state);
 }
 const doc=()=>p.evaluate(async()=>{await window.VocabPersistence.flush();const r=vocabHost.call('load');if(!r.ok)throw new Error(r.error);return r.value;});
 const state=()=>p.evaluate(async()=>{await window.VocabPersistence.flush();return DesktopState.documentState(vocabHost.call('load').value);});
 async function scan(){
  await p.getByRole('button',{name:'补齐释义与音标',exact:true}).click();
  await p.locator('#dict-scope').selectOption('book');await p.locator('#dict-scan').click();
  await p.waitForFunction(()=>!document.getElementById('dict-scan').disabled&&document.getElementById('dict-rows').children.length>0);
 }
 try{
  await launch();await p.locator('#start-new').click();await p.locator('[data-grade="good"]').click();
  await p.locator('#tab-library').click();await p.locator('#open-word-import').click();
  await p.locator('#wi-text').fill('单词\t释义\nphotosynthesis\t\nserendipity\t用户自填释义，请保留\nqzxvnotaword\t');
  await p.locator('#wi-read').click();await p.waitForFunction(()=>!document.getElementById('wi-confirm').disabled);
  await p.locator('#wi-book-name').fill('离线词典 SQLite 验证');await p.locator('#wi-confirm').click();
  await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  const bookId=await p.locator('#wordbook-filter').inputValue(),before=await state(),original=await doc();
  const photosynthesis=before.words.find(w=>w.word==='photosynthesis'),serendipity=before.words.find(w=>w.word==='serendipity'),unknown=before.words.find(w=>w.word==='qzxvnotaword');
  assert(photosynthesis&&serendipity&&unknown);assert.equal(photosynthesis.meaning,'');assert.equal(before.history.length,1);
  await scan();assert.deepEqual(await doc(),original,'preview must not write SQLite');
  const row=id=>p.locator('[data-dict-word="'+id+'"]');
  assert(await row(photosynthesis.id).locator('[data-dict-field="meaning"]').isChecked());
  assert(await row(photosynthesis.id).locator('[data-dict-field="phonetic"]').isChecked());
  assert.equal(await row(serendipity.id).locator('[data-dict-field="meaning"]').isChecked(),false);
  await p.locator('#dict-apply').click();
  await p.waitForFunction(id=>DesktopState.documentState(vocabHost.call('load').value).words.find(w=>w.id===id).meaning.length>0,photosynthesis.id);
  let s=await state(),saved=await doc();
  assert(s.words.find(w=>w.id===photosynthesis.id).phonetic.trim());
  assert.equal(s.words.find(w=>w.id===serendipity.id).meaning,'用户自填释义，请保留');
  assert(s.words.find(w=>w.id===serendipity.id).phonetic.trim());
  assert.equal(s.words.find(w=>w.id===unknown.id).meaning,'');
  assert.deepEqual(s.cards,before.cards);assert.deepEqual(s.history,before.history);
  assert.equal(saved.profileId,original.profileId);assert.equal(saved.deviceId,original.deviceId);
  assert.equal(saved.format,'jiufen-desktop');assert.equal(Object.hasOwn(saved,'operations'),false);
  assert.equal(s.cards[photosynthesis.id].planned,false,'filling metadata must not enroll new cards');
  await app.close();app=null;assert(fs.existsSync(path.join(data,'progress.sqlite')));
  await launch();s=await state();const reopened=await doc();
  assert.equal(s.words.find(w=>w.id===photosynthesis.id).meaning,OfflineSyncValue(saved,photosynthesis.id,'meaning'));
  assert(s.words.find(w=>w.id===photosynthesis.id).phonetic.trim());
  assert.equal(s.words.find(w=>w.id===serendipity.id).meaning,'用户自填释义，请保留');
  assert.deepEqual(reopened.state.library,saved.state.library);assert.deepEqual(s.cards,before.cards);assert.deepEqual(s.history,before.history);
  await p.locator('#tab-library').click();await p.locator('#wordbook-filter').selectOption(bookId);
  assert.match(await p.locator('#wordbook-summary').textContent(),/待完善释义 1/);
  await scan();assert(await p.locator('#dict-apply').isDisabled());assert.deepEqual(await doc(),reopened,'rescanning complete fields is idempotent');
  assert(await p.evaluate(()=>typeof require==='undefined'));assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(root,'test-results','electron-dictionary-window.png'),fullPage:false});
  await app.close();app=null;
  console.log('PASS real Electron offline dictionary preview, missing-field fill, user meaning preservation, unmatched draft, SQLite cold restart, idempotence and original learning/profile preservation. Isolated database: '+data);
 }finally{if(app)await app.close();}
 function OfflineSyncValue(document,id,field){return require('../shared/desktop-state').documentState(document).words.find(w=>w.id===id)[field];}
})().catch(e=>{console.error(e);process.exit(1);});
