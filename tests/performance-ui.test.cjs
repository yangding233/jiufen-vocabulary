'use strict';
const {chromium}=require('./playwright.cjs'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({timezoneId:'Asia/Shanghai',viewport:{width:1280,height:1000}});
  await context.addInitScript(()=>{
   window.vocabHost={
    call(method,payload){let value;
     if(method==='load')value=JSON.parse(localStorage.getItem('performance-doc')||'null');
     else if(method==='save'){localStorage.setItem('performance-doc',JSON.stringify(payload));value=true;}
     else if(method==='appStatus')value={platform:'windows',deviceId:'performance-test',appVersion:'2.0.0'};
     else if(method==='contentLoad')value=null;
     else if(method==='contentSave')value=true;
     else return {ok:false,error:'Unexpected '+method};
     return {ok:true,value};
    },
    async callAsync(method,payload){
     if(method==='save'&&window.holdNextSave){window.holdNextSave=false;await new Promise(resolve=>window.releasePendingSave=resolve);}
     return this.call(method,payload);
    }
   };
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.resolve(__dirname,'../web/index.html')).href);
  await p.waitForFunction(()=>window.VocabPersistence&&document.getElementById('start-new')&&!document.getElementById('start-new').disabled);
  await p.evaluate(()=>VocabPersistence.flush());await p.locator('#start-new').click();await p.evaluate(()=>VocabPersistence.flush());
  const initial=await p.evaluate(()=>JSON.parse(localStorage.getItem('performance-doc')));
  const firstWord=await p.locator('#word').textContent();
  await p.evaluate(()=>window.holdNextSave=true);
  const frame=await p.evaluate(()=>new Promise(resolve=>{
   const start=performance.now();document.querySelector('[data-grade="good"]').click();
   requestAnimationFrame(()=>resolve({elapsedMs:performance.now()-start,word:document.getElementById('word').textContent,status:document.getElementById('save-status').textContent,disabled:document.querySelector('[data-grade="good"]').disabled}));
  }));
  assert.notEqual(frame.word,firstWord,'the next card must render before a slow disk finishes');assert.match(frame.status,/正在保存/);assert.equal(frame.disabled,true);
  assert(frame.elapsedMs<300,'the first visible response took '+frame.elapsedMs.toFixed(1)+'ms');
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('performance-doc'))),initial,'an in-flight save is never reported as durable');
  await p.evaluate(()=>{document.querySelector('[data-grade="good"]').click();window.releasePendingSave();});await p.evaluate(()=>VocabPersistence.flush());
  let saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('performance-doc')));assert.equal(saved.state.history.length,1,'double clicks may not rate the next word during a pending save');
  await p.reload();await p.evaluate(()=>VocabPersistence.flush());saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('performance-doc')));assert.equal(saved.state.history.length,1);assert.equal(saved.state.session.cursor,1);
  assert.deepEqual(errors,[]);fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../test-results/desktop-response.json'),JSON.stringify(frame,null,2));
  console.log('PASS next card paints before delayed persistence, save status stays accurate, repeated ratings are blocked, cold reload retains exactly one feedback. First frame '+frame.elapsedMs.toFixed(1)+'ms.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
