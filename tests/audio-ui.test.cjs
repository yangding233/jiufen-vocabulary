'use strict';
const {chromium}=require('./playwright.cjs'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({timezoneId:'Asia/Shanghai',viewport:{width:1280,height:1000}});
  await context.addInitScript(()=>{
   window.audioCalls=[];window.audioInstances=[];window.audioBusy=false;window.Audio=function(file){this.src=file;this.paused=false;this.play=async()=>{};this.pause=()=>this.paused=true;window.audioInstances.push(this);};
   window.vocabHost={call(method,payload){let value;
    if(method==='load')value=JSON.parse(localStorage.getItem('audio-ui-doc')||'null');
    else if(method==='save'){localStorage.setItem('audio-ui-doc',JSON.stringify(payload));value=true;}
    else if(method==='appStatus')value={deviceId:'audio-ui',platform:'windows'};
    else if(method==='contentLoad')value=null;else if(method==='contentSave')value=true;
    else if(method==='audioStatus')value={configured:true,busy:audioBusy,keys:[],message:'本地组件就绪',progress:audioBusy?{done:0,total:2,state:'running',errors:[]}:null};
    else if(method==='audioResolve'){audioCalls.push(payload);value={available:!payload.text.includes('Changed'),url:'file:///mock/'+payload.locale+'.m4a'};}
    else if(method==='audioGenerate'){window.lastGenerate=payload;window.audioBusy=true;value={configured:true,busy:true,keys:[],progress:{done:0,total:payload.items.length,state:'running',errors:[]}};}
    else if(method==='audioCancel'){window.audioBusy=false;value={configured:true,busy:false,keys:[],progress:{done:0,total:2,state:'cancelled',errors:[]}};}
    else if(method==='audioConfigure')value={configured:true,busy:false,keys:[],message:'已选择本地组件'};
    else return {ok:false,error:'Unexpected '+method};
    return {ok:true,value};
   }};
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));p.on('dialog',dialog=>dialog.accept());
  await p.goto(pathToFileURL(path.resolve(__dirname,'../web/index.html')).href);await p.waitForFunction(()=>window.VocabApp&&window.VocabAudio);await p.evaluate(()=>VocabPersistence.flush());
  await p.locator('#start-new').click();await p.evaluate(()=>VocabPersistence.flush());await p.locator('#reveal').click();await p.evaluate(()=>VocabPersistence.flush());
  const sentence=await p.locator('#study-usage p[lang=en]').textContent();await p.locator('#study-usage [data-play-sentence]').click();
  await p.waitForFunction(()=>audioCalls.length===1);assert.deepEqual(await p.evaluate(()=>audioCalls[0]),{text:sentence,locale:'en-GB'});assert.notEqual(sentence,await p.locator('#word').textContent());
  await p.locator('#audio-voice').selectOption('en-US');await p.locator('#study-usage [data-play-sentence]').click();await p.waitForFunction(()=>audioCalls.length===2);assert.equal(await p.evaluate(()=>audioCalls[1].locale),'en-US');assert(await p.evaluate(()=>audioInstances[0].paused));
  await p.locator('[data-grade=good]').click();await p.evaluate(()=>VocabPersistence.flush());assert(await p.evaluate(()=>audioInstances.at(-1).paused));
  await p.evaluate(()=>VocabAudio.play('Changed example text.','en-GB'));assert.match(await p.locator('#toast').textContent(),/暂无离线音频/);assert.equal(await p.evaluate(()=>audioInstances.length),2);
  await p.locator('#tab-library').click();await p.locator('#audio-tools').evaluate(element=>element.open=true);await p.locator('#word-list [data-select]').first().check();await p.locator('#audio-generate').click();await p.waitForFunction(()=>window.lastGenerate);
  const items=await p.evaluate(()=>lastGenerate.items);assert.equal(items.length,2);assert(items.every(item=>item.text&&!item.text.includes('\n')));assert(await p.locator('#audio-generate').isDisabled());
  await p.locator('#audio-cancel').click();await p.waitForFunction(()=>!document.getElementById('audio-generate').disabled);assert.match(await p.locator('#audio-tools-progress').textContent(),/取消/);assert.deepEqual(errors,[]);
  console.log('PASS sentence buttons resolve complete visible text and selected accent; no word/sentence mismatch; previous audio stops on change; stale text cannot play; selected generation and cancellation stay asynchronous.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
