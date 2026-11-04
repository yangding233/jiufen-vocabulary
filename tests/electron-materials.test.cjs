'use strict';
// Real Electron + SQLite only. The daily user profile is never used.
const {_electron:electron}=require('./playwright.cjs');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),data=path.join(root,'test-results','electron-materials-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
(async()=>{
 let app,p;const errors=[];
 async function launch(){
  app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});
  p=await app.firstWindow();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.waitForFunction(()=>window.VocabApp&&window.VocabPersistence&&document.getElementById('me-dialog'));
  await p.evaluate(()=>VocabPersistence.flush());
 }
 const doc=()=>p.evaluate(async()=>{await VocabPersistence.flush();const result=vocabHost.call('load');if(result.ok!==true)throw Error(result.error);return result.value;});
 const state=async()=>(await doc()).state;
 const flush=()=>p.evaluate(()=>VocabPersistence.flush());
 async function openWord(){await p.locator('#tab-library').click();await p.locator('#search').fill('raincoat');await p.locator('[data-open="custom:real-material"]').click();}
 async function read(task,result){await p.locator('#ai-task').evaluate(n=>n.closest('details').open=true);await p.locator('#ai-task').fill(JSON.stringify(task));await p.locator('#ai-result').fill(JSON.stringify(result));await p.locator('#ai-read').click();}
 try{
  await launch();await p.locator('#start-new').click();await flush();await p.locator('[data-grade="good"]').click();await flush();await p.locator('#mark-mastered').click();await flush();
  await p.evaluate(async()=>VocabApp.commit(s=>{const id='custom:real-material';WordBooks.createBook(s,{id:'book:real-materials',name:'原生资料测试'});s.words=[...s.words,{id,word:'raincoat',meaning:'雨衣',phonetic:'',sentence:'',group:'原生资料测试'}];s.cards[id]=VocabApp.blankCard(false);s.cards[id].note='私人笔记绝不可导出';WordBooks.addMember(s,'book:real-materials',id);}));
  const original=await doc(),before=original.state;assert.equal(before.history.length,2);assert(before.cards['jf-0002'].mastered);
  await openWord();await p.locator('#edit-materials').click();await p.locator('#me-phonetic').fill('/ˈreɪnkəʊt/');await p.locator('#me-source').fill('个人核对资料');await p.locator('#me-save').click();await p.waitForFunction(()=>!document.getElementById('me-dialog').open);await flush();await p.locator('#close-detail').click();
  await p.locator('#open-ai-tools').click();await p.locator('#ai-make').click();await flush();const task=JSON.parse(await p.locator('#ai-task').inputValue()),item=task.items[0];assert.equal(item.word,'raincoat');assert(!(await p.locator('#ai-prompt').inputValue()).includes('私人笔记绝不可导出'));
  const result={format:'jiufen-ai-result',schema:1,taskId:task.id,items:[{id:item.id,word:item.word,baseFingerprint:item.baseFingerprint,status:'candidate',fields:{schemes:[{id:'scheme:real-rain-coat',anchor:'rain（雨）＋ coat（外套）',parts:[{text:'rain',cue:'雨'},{text:'coat',cue:'外套'}],scene:'下雨穿的外套帮助想到雨衣。',reference:'原创熟词组合助记'}],sentence:'Take your raincoat today.',translation:'今天带上你的雨衣。',collocations:['wear a raincoat'],source:'已核对的原创学习资料'}}]};
  const unchanged=await doc(),wrong=structuredClone(result);wrong.items[0].id='custom:unknown';await read(task,wrong);assert.match(await p.locator('#ai-error').textContent(),/编号/);assert(await p.locator('#ai-apply').isDisabled());assert.deepEqual(await doc(),unchanged);
  await read(task,result);assert(!(await p.locator('[data-ai-field="source"]').isChecked()),'nonempty source must be protected');await p.locator('[data-ai-field="source"]').check();await p.locator('#ai-apply').click();await p.waitForFunction(()=>!document.getElementById('ai-dialog').open);await flush();
  const saved=await doc(),material=saved.state.materials.entries[item.id];assert.equal(material.schemes.length,1);assert.deepEqual(material.collocations,['wear a raincoat']);assert.equal(saved.state.words.find(w=>w.id===item.id).source,'已核对的原创学习资料');assert.deepEqual(saved.state.cards,before.cards);assert.deepEqual(saved.state.history,before.history);assert.equal(saved.profileId,original.profileId);assert.equal(saved.deviceId,original.deviceId);
  await openWord();assert.match(await p.locator('#detail-memory').textContent(),/下雨穿的外套/);assert.match(await p.locator('#detail-source').textContent(),/已核对的原创/);await p.locator('#close-detail').click();
  // Generate a new task, then prove a later user edit prevents adoption of its stale result.
  await p.locator('#open-ai-tools').click();await p.locator('#ai-make').click();await flush();const staleTask=JSON.parse(await p.locator('#ai-task').inputValue()),staleItem=staleTask.items[0];
  const staleResult={format:'jiufen-ai-result',schema:1,taskId:staleTask.id,items:[{id:staleItem.id,word:staleItem.word,baseFingerprint:staleItem.baseFingerprint,status:'candidate',fields:{sentence:'This old result must not overwrite an edit.'}}]};
  await p.evaluate(async()=>VocabApp.commit(s=>Materials.updateWord(s,'custom:real-material',{sentence:'My newer sentence about a raincoat.'})));const edited=await doc();await read(staleTask,staleResult);assert.match(await p.locator('#ai-preview').textContent(),/资料已变化|任务导出后/);assert(await p.locator('#ai-apply').isDisabled());assert.deepEqual(await doc(),edited);await p.locator('[data-close-material="ai-dialog"]').click();
  await app.close();app=null;assert(fs.existsSync(path.join(data,'progress.sqlite')));await launch();const reopened=await doc();assert.equal(reopened.profileId,original.profileId);assert.equal(reopened.deviceId,original.deviceId);assert.deepEqual(reopened.state.cards,before.cards);assert.deepEqual(reopened.state.history,before.history);assert.deepEqual(reopened.state.materials,edited.state.materials);assert.equal(reopened.state.words.find(w=>w.id===item.id).sentence,'My newer sentence about a raincoat.');
  await openWord();assert.match(await p.locator('#detail-memory').textContent(),/下雨穿的外套/);assert.match(await p.locator('#detail-source').textContent(),/已核对的原创/);assert.deepEqual(errors,[]);
  console.log('PASS real Electron SQLite material editing and AI adoption, private notes excluded, source preserved, invalid IDs/stale results refused, mastery/history exact and cold reopen retained.');
 }finally{if(app)await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
