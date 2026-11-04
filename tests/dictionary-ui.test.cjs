'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('./playwright.cjs');
const root=path.resolve(__dirname,'..'),url=pathToFileURL(path.join(root,'web/index.html')).href;

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},timezoneId:'Asia/Shanghai',colorScheme:'dark'});
  await context.addInitScript(()=>{
   const originalAppend=Element.prototype.append;
   Element.prototype.append=function(...nodes){
    for(const node of nodes)if(node?.tagName==='SCRIPT'&&node.getAttribute('src')==='dictionary-data.js'&&!sessionStorage.getItem('dictionary-race-tested')){
     sessionStorage.setItem('dictionary-race-tested','yes');
     const loaded=node.onload;node.onload=event=>{window.dictionaryLoadWaiting=true;window.releaseDictionaryLoad=()=>loaded.call(node,event);};
    }
    return originalAppend.apply(this,nodes);
   };
   window.dictionaryExports=[];
   window.vocabHost={call(method,payload){try{let value;
    if(method==='load')value=JSON.parse(localStorage.getItem('dictionary-ui-doc')||'null');
    else if(method==='save'){
     if(window.failDictionarySave){window.failDictionarySave=false;throw new Error('模拟词典保存失败');}
     localStorage.setItem('dictionary-ui-doc',JSON.stringify(payload));value=true;
    }else if(method==='contentLoad')value=JSON.parse(localStorage.getItem('dictionary-ui-content')||'null');
    else if(method==='contentSave'){localStorage.setItem('dictionary-ui-content',JSON.stringify(payload));value=true;}
    else if(method==='appStatus')value={platform:'windows',deviceId:'dictionary-ui-pc',appVersion:'2.0.0'};
    else if(method==='export'){window.dictionaryExports.push(payload);value=true;}
    else throw new Error('Unexpected native call: '+method);
    return {ok:true,value};
   }catch(e){return {ok:false,error:e.message};}}};
  });
  const p=await context.newPage(),errors=[],remote=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  p.on('request',request=>{if(/^https?:/.test(request.url()))remote.push(request.url());});
  await p.goto(url);await p.waitForSelector('#start-new:not([disabled])');
  const flush=()=>p.evaluate(()=>window.VocabPersistence?.flush());
  const doc=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('dictionary-ui-doc')));
  const state=async()=>{await flush();return p.evaluate(()=>DesktopState.documentState(JSON.parse(localStorage.getItem('dictionary-ui-doc'))));};
  const row=id=>p.locator('[data-dict-word="'+id+'"]');
  async function scan(){await p.locator('#dict-scan').click();await flush();await p.waitForFunction(()=>!document.getElementById('dict-scan').disabled&&document.getElementById('dict-rows').children.length>0);}

  await p.locator('#start-new').click();await flush();await p.locator('[data-grade="good"]').click();await flush();
  await p.locator('#tab-library').click();await flush();await p.locator('#open-word-import').click();await flush();
  await p.locator('#wi-text').fill('单词\t释义\nphotosynthesis\t\nserendipity\t这是用户明确填写的意思\nqzxvnotaword\t');
  await p.locator('#wi-read').click();await flush();await p.waitForFunction(()=>!document.getElementById('wi-confirm').disabled);
  await p.locator('#wi-book-name').fill('离线资料补全测试');await p.locator('#wi-confirm').click();await flush();
  await p.waitForFunction(()=>!document.getElementById('word-import-dialog').open);
  const book=await p.locator('#wordbook-filter').inputValue(),before=await state(),identity=await doc();
  const photosynthesis=before.words.find(w=>w.word==='photosynthesis'),serendipity=before.words.find(w=>w.word==='serendipity'),unknown=before.words.find(w=>w.word==='qzxvnotaword');
  assert(photosynthesis&&serendipity&&unknown);assert.equal(before.history.length,1);
  assert.equal(await p.evaluate(()=>typeof DictionaryData),'undefined','dictionary should load only when requested');
  await p.locator('#open-dictionary').click();await flush();await p.locator('#dict-scan').click();await flush();
  await p.waitForFunction(()=>window.dictionaryLoadWaiting===true);
  await p.locator('#dict-scope').selectOption('selected');await flush();await p.evaluate(()=>window.releaseDictionaryLoad());
  await p.waitForFunction(()=>!document.getElementById('dict-scan').disabled);
  assert.equal(await p.locator('[data-dict-word]').count(),0,'an old in-flight scan cannot repopulate a changed scope');
  assert(await p.locator('#dict-apply').isDisabled());assert.deepEqual(await doc(),identity);
  await p.locator('#dict-scope').selectOption('book');await flush();await scan();
  assert.deepEqual(await doc(),identity,'lookup and preview may not persist changes');
  assert.match(await p.locator('#dict-source').textContent(),/ECDICT/);
  assert.match(await p.locator('#dict-source').textContent(),/未分英美|未区分英美/);
  assert(await row(photosynthesis.id).locator('[data-dict-field="meaning"]').isChecked());
  assert(await row(photosynthesis.id).locator('[data-dict-field="phonetic"]').isChecked());
  assert.equal(await row(serendipity.id).locator('[data-dict-field="meaning"]').isChecked(),false);
  assert.match(await row(unknown.id).textContent(),/未查到|没有找到/);
  const candidateId=await row(photosynthesis.id).locator('[data-dict-candidate]').inputValue();
  await row(photosynthesis.id).locator('[data-dict-candidate]').selectOption('');
  assert.equal(await row(photosynthesis.id).locator('[data-dict-field="meaning"]').isChecked(),false,'unselecting a candidate must not fall back to auto-selection');
  await row(photosynthesis.id).locator('[data-dict-candidate]').selectOption(candidateId);
  await row(serendipity.id).locator('[data-dict-field="meaning"]').check();
  assert(await row(serendipity.id).locator('[data-dict-field="meaning"]').isChecked());
  await row(serendipity.id).locator('[data-dict-field="meaning"]').uncheck();
  // Respect a per-field opt out, even though other fields and other rows are saved.
  await row(photosynthesis.id).locator('[data-dict-field="phonetic"]').uncheck();
  assert.deepEqual(await doc(),identity);await p.locator('#dict-apply').click();await flush();
  await p.waitForFunction(()=>document.getElementById('dict-summary').textContent.includes('本次已保存'));
  let s=await state(),saved=await doc();
  assert.match(s.words.find(w=>w.id===photosynthesis.id).meaning,/光合作用/);
  assert.equal(s.words.find(w=>w.id===photosynthesis.id).phonetic,'');
  assert.equal(s.words.find(w=>w.id===serendipity.id).meaning,'这是用户明确填写的意思');
  assert(s.words.find(w=>w.id===serendipity.id).phonetic.trim());
  assert.equal(s.words.find(w=>w.id===unknown.id).meaning,'');
  assert.equal(s.words.find(w=>w.id===unknown.id).phonetic,'');
  assert(!s.words.find(w=>w.id===serendipity.id).phoneticUS&&!s.words.find(w=>w.id===serendipity.id).phoneticUK);
  assert.deepEqual(s.cards,before.cards);assert.deepEqual(s.history,before.history);
  assert.equal(saved.profileId,identity.profileId);assert.equal(saved.deviceId,identity.deviceId);
  assert.deepEqual(s.baseline,before.baseline);
  assert.match(s.words.find(w=>w.id===photosynthesis.id).source,/ECDICT/);
  assert(Object.values(s.library.batches).some(batch=>batch?.kind==='dictionary'&&batch.items?.length));
  // Scope changes cannot submit a preview from the old range.
  await p.locator('#dict-scope').selectOption('selected');await flush();assert(await p.locator('#dict-apply').isDisabled());
  assert.equal(await p.locator('#dict-rows').locator('[data-dict-word]').count(),0);
  await p.locator('#dict-scan').click();await flush();await p.waitForFunction(()=>!document.getElementById('dict-scan').disabled);
  assert.match(await p.locator('#dict-error').textContent(),/没有词条/);assert.deepEqual(await doc(),saved);
  await p.locator('#dict-scope').selectOption('book');await flush();await scan();
  assert(await row(photosynthesis.id).locator('[data-dict-field="phonetic"]').isChecked());
  await p.evaluate(()=>window.failDictionarySave=true);await p.locator('#dict-apply').click();await p.waitForFunction(()=>document.getElementById('dict-error').textContent.includes('保存没有完成'));
  assert.match(await p.locator('#dict-error').textContent(),/保存没有完成/);assert.deepEqual(await doc(),saved,'failed save must not leave partially filled fields');
  await p.locator('#dict-apply').click();await flush();await p.waitForFunction(()=>document.getElementById('dict-summary').textContent.includes('本次已保存'));
  assert.equal(await p.locator('#dict-error').isVisible(),false);
  assert(!((await p.locator('#local-message').textContent()).startsWith('数据库未能保存：')));
  s=await state();saved=await doc();assert(s.words.find(w=>w.id===photosynthesis.id).phonetic.trim());
  await scan();assert(await p.locator('#dict-apply').isDisabled());assert.deepEqual(await doc(),saved,'repeat scan must not change the snapshot');
  // A successful cold reload keeps provenance and ordinary learning state.
  await p.locator('#dict-close').click();await flush();await flush();await p.reload();s=await state();
  assert.deepEqual(s.cards,before.cards);assert.deepEqual(s.history,before.history);
  const reopened=await doc();assert.deepEqual(reopened.state.words,saved.state.words);assert.deepEqual(reopened.state.library,saved.state.library);assert.deepEqual(reopened.state.baseline,saved.state.baseline);assert.equal(reopened.profileId,saved.profileId);
  await p.locator('#tab-library').click();await flush();await p.locator('#wordbook-filter').selectOption(book);await flush();
  await p.locator('#search').fill('photosynthesis');await p.locator('[data-open="'+photosynthesis.id+'"]').click();await flush();
  assert.match(await p.locator('#detail-source').textContent(),/ECDICT/);await p.locator('#close-detail').click();await flush();
  await p.locator('#search').fill('');await p.locator('#open-dictionary').click();await flush();await scan();
  await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await p.locator('#dict-dialog').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await p.screenshot({path:path.join(root,'test-results','dictionary-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  console.log('PASS offline dictionary lazy load, field preview/opt out, user meaning protection, unmatched drafts, source and accent labels, scope invalidation, atomic retry, idempotence, cold reload, unchanged learning data and mobile layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
