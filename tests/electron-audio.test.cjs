'use strict';
const {_electron:electron}=require('./playwright.cjs'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),data=path.join(root,'test-results','electron-audio-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'web/sentence-audio-manifest.json'),'utf8'));
 const record=Object.values(manifest.entries).find(r=>r.text==='He bought a newspaper at the station.'&&r.locale==='en-GB');assert(record);
 let app;
 try{app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:data}});const p=await app.firstWindow(),errors=[];p.on('pageerror',error=>errors.push(error.message));await p.waitForFunction(()=>window.VocabApp&&window.VocabAudio);await p.evaluate(()=>VocabPersistence.flush());
  await p.evaluate(()=>{const Original=window.Audio;window.Audio=function(file){window.realSentenceAudio=new Original(file);return window.realSentenceAudio;};});
  await p.locator('#start-new').click();await p.evaluate(()=>VocabPersistence.flush());await p.locator('#reveal').click();await p.evaluate(()=>VocabPersistence.flush());await p.locator('#study-usage [data-play-sentence]').click();await p.waitForFunction(()=>window.realSentenceAudio?.readyState>=2);
  const playback=await p.evaluate(()=>({src:realSentenceAudio.src,seconds:realSentenceAudio.duration,pitch:realSentenceAudio.preservesPitch,status:document.getElementById('audio-status').textContent}));assert(playback.src.includes(record.key));assert(playback.seconds>2&&playback.seconds<6);assert(playback.pitch);assert.match(playback.status,/整段朗读/);
  await p.locator('[data-grade=good]').click();await p.evaluate(()=>VocabPersistence.flush());assert(await p.evaluate(()=>realSentenceAudio.paused));
  const changed=await p.evaluate(()=>VocabNative.callAsync('audioResolve',{text:'This sentence was changed.',locale:'en-GB'}));assert.equal(changed.available,false);assert.deepEqual(errors,[]);
  console.log('PASS real Electron content-addressed sentence resolve, actual M4A decoding/playback, stop on grade and changed-text invalidation. '+JSON.stringify(playback));
 }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exit(1);});
