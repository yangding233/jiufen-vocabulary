'use strict';
// Capacity fixtures are entirely synthetic. Timings describe this run, not a device-independent guarantee.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const D=require('../shared/desktop-state.js'),M=require('../shared/materials.js'),A=require('../shared/ai-handoff.js'),W=require('../shared/wordbooks.js'),B=require('../shared/book-tools.js'),{Store}=require('../apps/windows/storage.cjs');
function largeState(){
 const s=structuredClone(require('./fixtures/legacy-documents.json')[0].expected),blank=structuredClone(s.cards['jf-2']);s.session=null;s.undo=null;s.dailyPlan=null;
 for(let i=3;i<10000;i++){const id='custom:capacity-'+i,word='capacityword'+i;s.words.push({id,word,meaning:'合成容量测试义项 '+i,phonetic:'',sentence:'',group:'容量测试'});s.cards[id]=structuredClone(blank);}
 s.history=Array.from({length:20000},(_,i)=>({id:'capacity-event:'+i,wordId:s.words[i%10000].id,at:'2026-11-01T10:00:00Z',day:'2026-11-01',kind:'free',grade:'good',nextDue:null,interval:0}));
 const materials=M.ensure(s);for(let i=3;i<1003;i++){const w=s.words[i];materials.entries[w.id]={schemes:[{id:'scheme:capacity',anchor:'合成字母线索',scene:'合成场景用于检查资料能否保存。',parts:[{text:w.word,cue:'完整目标字母'}],reference:'容量测试夹具'}],collocations:[]};}
 W.ensure(s);s.settings.studyBooks=['book:jiufen'];return s;
}

test('10,000-word / 20,000-feedback / 1,000-scheme archive validates and survives snapshot plus SQLite',()=>{
 const started=performance.now(),s=largeState(),document=D.createDocument(s,'capacity-pc','capacity-profile'),created=performance.now(),reopened=D.documentState(document),roundtrip=performance.now();
 assert.equal(reopened.words.length,10000);assert.equal(reopened.history.length,20000);assert.equal(Object.keys(reopened.materials.entries).length,1000);assert.deepEqual(reopened.cards,s.cards);assert.deepEqual(reopened.history,s.history);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jiufen-material-capacity-')),store=new Store(directory,d=>D.validateDocument(d));
 try{store.save(document);const loaded=store.load();assert.equal(loaded.state.history.length,20000);assert.deepEqual(loaded.state.materials,s.materials);const afterStorage=performance.now();
  const tasks=s.words.slice(-50).map(w=>w.id),task=A.createTask(s,tasks),result={format:A.RESULT,schema:1,taskId:task.id,items:task.items.map(item=>({id:item.id,word:item.word,baseFingerprint:item.baseFingerprint,status:'candidate',fields:{sentence:'This is a synthetic capacity example.'}}))};
  const before=structuredClone(s),adopted=A.apply(s,task,result);assert.deepEqual(adopted.cards,before.cards);assert.deepEqual(adopted.history,before.history);assert.equal(adopted.words.at(-1).sentence,'This is a synthetic capacity example.');D.validateState(adopted);
  const batch=B.recordBatch(before,adopted,{name:'容量 AI 采用'});if(batch){const id=typeof batch==='string'?batch:batch.id;assert(id);}
  const total=performance.now();console.log(JSON.stringify({capacity:{words:10000,history:20000,schemes:1000,aiItems:50},milliseconds:{create:created-started,roundtrip:roundtrip-created,storage:afterStorage-roundtrip,adoption:total-afterStorage,total:total-started},jsonBytes:Buffer.byteLength(JSON.stringify(document))}));
 }finally{store.close();}
});

test('oversize material snapshot is refused before overwriting saved learning data',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jiufen-material-limit-')),store=new Store(directory,d=>D.validateDocument(d)),s=structuredClone(require('./fixtures/legacy-documents.json')[0].expected),document=D.createDocument(s,'limit-pc');
 try{store.save(document);const oversized=structuredClone(document);oversized.state.words[0].meaning='x'.repeat(51*1024*1024);assert.throws(()=>store.save(oversized),/50MB/);assert.deepEqual(store.load(),document);assert.equal(store.listBackups().length,0);}finally{store.close();}
});
