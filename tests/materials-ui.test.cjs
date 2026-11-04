'use strict';
const {chromium}=require('./playwright.cjs'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({timezoneId:'Asia/Shanghai',viewport:{width:1280,height:1000}});
  await context.addInitScript(()=>{
   window.materialExports=[];
   window.vocabHost={call(method,payload){try{let value;
    if(method==='load')value=JSON.parse(localStorage.getItem('materials-doc')||'null');
    else if(method==='save'){if(window.failMaterialSave){window.failMaterialSave=false;throw Error('模拟资料磁盘错误');}localStorage.setItem('materials-doc',JSON.stringify(payload));value=true;}
    else if(method==='appStatus')value={platform:'windows',deviceId:'materials-ui-pc',appVersion:'2.1.0'};
    else if(method==='contentLoad')value=JSON.parse(localStorage.getItem('materials-content')||'null');
    else if(method==='contentSave'){localStorage.setItem('materials-content',JSON.stringify(payload));value=true;}
    else if(method==='export'){window.materialExports.push(payload);value=true;}
    else if(method==='audioStatus')value={available:false,keys:[]};
    else return {ok:false,error:'No fixture method '+method};
    return {ok:true,value};
   }catch(e){return {ok:false,error:e.message};}}};
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error('UI ERROR:',e.message);});p.on('dialog',d=>d.accept());
  const flush=()=>p.evaluate(()=>VocabPersistence.flush());
  const state=async()=>{await flush();return p.evaluate(()=>JSON.parse(localStorage.getItem('materials-doc')).state);};
  await p.goto(pathToFileURL(path.resolve(__dirname,'../web/index.html')).href);await p.waitForFunction(()=>window.VocabApp&&window.VocabMaterials);await flush();
  await p.locator('#start-new').click();await flush();await p.locator('[data-grade="good"]').click();await flush();
  await p.evaluate(async()=>{await VocabApp.commit(s=>{WordBooks.createBook(s,{id:'book:materials-ui',name:'资料测试'});for(const [id,word,meaning] of [['custom:flower','sunflower','向日葵'],['custom:coat','raincoat','雨衣']]){s.words.push({id,word,meaning,phonetic:'',sentence:'',group:'资料测试'});s.cards[id]=VocabApp.blankCard(false);s.cards[id].note='DO_NOT_EXPORT_PRIVATE_NOTE';WordBooks.addMember(s,'book:materials-ui',id);}s.words=[...s.words];});});
  const original=await state();await p.locator('#tab-library').click();
  async function open(id,word){await p.locator('#search').fill(word);await p.locator('[data-open="'+id+'"]').click();}
  await open('custom:flower','sunflower');await p.locator('#edit-materials').click();
  await p.locator('#me-phonetic').fill('/ˈsʌnflaʊə/');await p.locator('#me-sentence').fill('A sunflower faces the sun.');await p.locator('#me-translation').fill('向日葵面向太阳。');await p.locator('#me-collocations').fill('sunflower seeds');
  await p.locator('#me-add').click();await p.locator('[data-scheme-field="anchor"]').fill('sun（太阳）＋ flower（花）');await p.locator('[data-scheme-field="scene"]').fill('朝向太阳的花，想到向日葵。');
  await p.locator('[data-part-text]').first().fill('sun');await p.locator('[data-part-cue]').first().fill('太阳');await p.locator('[data-add-part]').click();await p.locator('[data-part-text]').nth(1).fill('flower');await p.locator('[data-part-cue]').nth(1).fill('花');
  fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await p.screenshot({path:path.resolve(__dirname,'../test-results/material-editor.png')});
  await p.locator('#me-save').click();await p.waitForFunction(()=>!document.getElementById('me-dialog').open);await flush();
  assert.match(await p.locator('#detail-memory').textContent(),/朝向太阳/);assert.match(await p.locator('#detail-memory .rebuild').textContent(),/sunflower/);let edited=await state();assert.deepEqual(edited.cards,original.cards);assert.deepEqual(edited.history,original.history);assert.equal(edited.materials.entries['custom:flower'].schemes.length,1);
  await p.locator('#edit-materials').click();await p.locator('#me-meaning').fill('不应保存的修改');await p.evaluate(()=>window.failMaterialSave=true);await p.locator('#me-save').click();await p.waitForFunction(()=>document.getElementById('me-error').textContent.includes('没有保存成功'));
  const failed=await p.evaluate(()=>JSON.parse(localStorage.getItem('materials-doc')).state);assert.equal(failed.words.find(w=>w.id==='custom:flower').meaning,'向日葵');assert.deepEqual(failed.materials,edited.materials);
  await p.locator('[data-close-material="me-dialog"]').click();await p.locator('#close-detail').click();await p.reload();await flush();await p.locator('#tab-library').click();await open('custom:flower','sunflower');assert.match(await p.locator('#detail-memory').textContent(),/朝向太阳/);await p.locator('#close-detail').click();
  await p.locator('#search').fill('raincoat');await p.locator('#open-ai-tools').click();await p.locator('#ai-make').click();await flush();await p.waitForFunction(()=>document.getElementById('ai-task').value.includes('raincoat'));
  const task=JSON.parse(await p.locator('#ai-task').inputValue());assert.equal(task.items.length,1);assert.equal(task.items[0].word,'raincoat');assert(!(await p.locator('#ai-prompt').inputValue()).includes('DO_NOT_EXPORT_PRIVATE_NOTE'));
  const item=task.items[0],result={format:'jiufen-ai-result',schema:1,taskId:task.id,items:[{id:item.id,word:item.word,baseFingerprint:item.baseFingerprint,status:'candidate',fields:{schemes:[{id:'scheme:rain-coat',anchor:'rain（雨）＋ coat（外套）',parts:[{text:'rain',cue:'雨'},{text:'coat',cue:'外套'}],scene:'下雨时穿的外套就是雨衣。',reference:'原创助记'}],sentence:'Wear a raincoat in the rain.',translation:'下雨时穿上雨衣。',collocations:['wear a raincoat']}}]};
  const wrong=structuredClone(result);wrong.items[0].id='custom:wrong';await p.locator('#ai-result').fill(JSON.stringify(wrong));await p.locator('#ai-read').click();assert.match(await p.locator('#ai-error').textContent(),/编号/);assert(await p.locator('#ai-apply').isDisabled());
  await p.locator('#ai-result').fill(JSON.stringify(result));await p.locator('#ai-read').click();assert(await p.locator('[data-ai-field="schemes"]').isChecked());await p.locator('[data-ai-field="collocations"]').uncheck();
  const beforeAdopt=await state();await p.locator('#ai-apply').click();await p.waitForFunction(()=>!document.getElementById('ai-dialog').open);await flush();const adopted=await state();assert.equal(adopted.materials.entries['custom:coat'].schemes.length,1);assert.deepEqual(adopted.materials.entries['custom:coat'].collocations,undefined);assert.deepEqual(adopted.cards,beforeAdopt.cards);assert.deepEqual(adopted.history,beforeAdopt.history);
  await open('custom:coat','raincoat');assert.match(await p.locator('#detail-memory').textContent(),/下雨时穿的外套/);await p.locator('#close-detail').click();await p.locator('#open-ai-tools').click();await p.locator('#ai-task').evaluate(n=>n.closest('details').open=true);await p.locator('#ai-task').fill(JSON.stringify(task));await p.locator('#ai-result').fill(JSON.stringify(result));await p.locator('#ai-read').click();
  // Already adopted fields do not create duplicate schemes; the remaining field can be adopted.
  assert(!(await p.locator('[data-ai-field="schemes"]').isChecked()));await p.locator('#ai-apply').click();await p.waitForFunction(()=>!document.getElementById('ai-dialog').open);await flush();assert.equal((await state()).materials.entries['custom:coat'].schemes.length,1);
  await p.locator('#open-ai-tools').click();await p.locator('#ai-task').evaluate(n=>n.closest('details').open=true);await p.locator('#ai-task').fill(JSON.stringify(task));await p.locator('#ai-result').fill(JSON.stringify(result));await p.locator('#ai-read').click();assert(await p.locator('#ai-apply').isDisabled());await p.locator('[data-close-material="ai-dialog"]').click();
  await p.reload();await flush();const reopened=await state();assert.equal(reopened.materials.entries['custom:coat'].schemes.length,1);assert.deepEqual(reopened.cards,original.cards);assert.deepEqual(reopened.history,original.history);assert.deepEqual(errors,[]);
  console.log('PASS material editing, exact structured mnemonic display, disk rollback, cold restart, private task export, invalid ID rejection, selective AI adoption, partial repeat and unchanged learning data.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
