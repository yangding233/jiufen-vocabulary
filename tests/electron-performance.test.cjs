'use strict';
// Real Electron timings use isolated synthetic data, never the daily profile.
const {_electron:electron}=require('./playwright.cjs');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const DesktopState=require('../shared/desktop-state.js'),{Store}=require('../apps/windows/storage.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'test-results','electron-performance-'+Date.now());
const exe=process.env.JIUFEN_TEST_EXE||path.join(root,'apps/windows/node_modules/electron/dist/electron.exe');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const summarize=values=>({p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)});
(async()=>{
 let app,p;
 async function launch(directory){
  const started=Date.now();app=await electron.launch({executablePath:exe,args:process.env.JIUFEN_TEST_EXE?[]:[path.join(root,'apps/windows')],env:{...process.env,JIUFEN_DATA_DIR:directory}});
  p=await app.firstWindow();await p.waitForFunction(()=>window.VocabPersistence&&window.vocabHost?.callAsync);await p.evaluate(()=>window.VocabPersistence.flush());return Date.now()-started;
 }
 async function measure(){
  await p.locator('#start-new').click();await p.evaluate(()=>window.VocabPersistence.flush());
  await p.evaluate(()=>{
   const original=VocabNative.callAsync.bind(VocabNative);window.benchmarkLastSaveEnd=0;
   VocabNative.callAsync=async(method,payload)=>{const result=await original(method,payload);if(method==='save')window.benchmarkLastSaveEnd=performance.now();return result;};
  });
  const samples=[];
  for(let i=0;i<12;i++)samples.push(await p.evaluate(async()=>{
   await VocabPersistence.flush();const before=document.getElementById('word').textContent,started=performance.now();
   document.querySelector('[data-grade="good"]').click();
   await new Promise(requestAnimationFrame);const paintMs=performance.now()-started,next=document.getElementById('word').textContent;
   await VocabPersistence.flush();return {paintMs,saveMs:window.benchmarkLastSaveEnd-started,changed:next!==before};
  }));
  assert(samples.every(sample=>sample.changed));return {samples,paintMs:summarize(samples.map(s=>s.paintMs)),saveMs:summarize(samples.map(s=>s.saveMs))};
 }
 try{
  const freshDirectory=path.join(base,'fresh'),freshStartupMs=await launch(freshDirectory);
  const initial=await p.evaluate(()=>vocabHost.call('load').value.state);
  const fresh=await measure();await app.close();app=null;
  const heavy=JSON.parse(JSON.stringify(initial)),first=heavy.words[0].id;
  heavy.history=Array.from({length:2000},(_,i)=>({id:'perf-event-'+i,wordId:first,day:'2026-10-01',at:new Date(Date.UTC(2026,9,1,0,0,i)).toISOString(),kind:i?'repeat':'new',grade:'good',nextDue:'2026-11-05',interval:35}));
  Object.assign(heavy.cards[first],{seen:true,due:'2026-11-05',interval:35,streak:5,reviewCount:2000,lastGrade:'good',lastScheduledDay:'2026-10-01',learnedOn:'2026-10-01',lastSeen:'2026-10-01T00:33:19Z'});
  for(const card of Object.values(heavy.cards))card.note='合成性能测试笔记。'.repeat(12);
  heavy.session=null;heavy.undo=null;heavy.dailyPlan=null;
  const operations=Array.from({length:5000},(_,i)=>({kind:'card-set',wordId:first,field:'note',value:'最后一条合成笔记 '+(i+1),id:'legacy-perf:'+(i+1),deviceId:'legacy-perf',seq:i+1,lamport:i+1,context:i?{'legacy-perf':i}:{},at:'2026-11-04T00:00:00Z'}));
  const legacy={format:'jiufen-usb',schema:1,profileId:'performance-profile',deviceId:'legacy-perf',baseline:heavy,baselineHash:DesktopState.sha256(DesktopState.canonical(heavy)),operations,localState:{session:null,undo:null,dailyPlan:null,revision:heavy.revision,writer:heavy.writer,updatedAt:heavy.updatedAt},conflicts:[],createdAt:'2026-11-01T00:00:00Z'};
  const migratedDirectory=path.join(base,'migrated'),seed=new Store(migratedDirectory);seed.save(legacy);seed.close();
  const migrationStartupMs=await launch(migratedDirectory),converted=await p.evaluate(()=>vocabHost.call('load').value);
  assert.equal(converted.format,'jiufen-desktop');assert.equal(converted.state.history.length,2000);assert.equal(converted.state.cards[first].note,'最后一条合成笔记 5000');assert.equal(Object.hasOwn(converted,'operations'),false);
  const migrated=await measure();assert.equal(fs.readdirSync(path.join(migratedDirectory,'migration-backups')).length,1);
  const report={at:new Date().toISOString(),executable:exe,words:initial.words.length,samplesPerScenario:12,fresh:{startupMs:freshStartupMs,...fresh},afterLegacyMigration:{originalOperations:5000,history:2000,startupMs:migrationStartupMs,...migrated}};
  fs.writeFileSync(path.join(root,'test-results','electron-performance.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({fresh:{paintMs:fresh.paintMs,saveMs:fresh.saveMs},afterLegacyMigration:{paintMs:migrated.paintMs,saveMs:migrated.saveMs},path:path.join(root,'test-results','electron-performance.json')}));
 }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exit(1);});
