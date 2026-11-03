'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const core=require('../../shared/sync-core.js'),{SyncManager}=require('./sync-manager.cjs');
function state(){return {schema:2,app:'jiufen-mnemonic-learning',revision:0,writer:'test',updatedAt:new Date().toISOString(),words:[{id:'jf-1',word:'word',meaning:'词',phonetic:'/wɜːd/',sentence:'',group:'List1'}],cards:{'jf-1':{seen:false,planned:true,suspended:false,favorite:false,mastered:false,due:null,interval:0,streak:0,lastGrade:null,legacyGrade:null,lastScheduledDay:null,learnedOn:null,lastSeen:null,updatedAt:null,reviewCount:0,lapses:0,note:'',memoryAnchor:'',memoryScene:''}},settings:{mode:'mnemonic',dailyTarget:50,dailyNew:10,studyDays:[0,1,2,3,4,5,6],targetDate:null},history:[],session:null,undo:null,dailyPlan:null,meta:{lastBackupAt:null,migrated:0},baseline:{date:'2026-10-31',ids:[],source:'test'}};}
const clone=x=>JSON.parse(JSON.stringify(x));
class MemoryStore{constructor(doc){this.doc=doc;this.meta={};this.backups=[];this.content=null;}load(){return clone(this.doc);}save(d){core.materialize(d);this.doc=clone(d);}loadContent(){return clone(this.content);}saveContent(pack){this.content=clone(pack);}getMeta(k){return this.meta[k]||null;}setMeta(k,v){this.meta[k]=v;}saveSyncBackup(l,d){this.backups.push([l,clone(d)]);}}
class Phone{constructor(doc,ack=true){this.doc=doc;this.ack=ack;this.writes=0;this.packetExtras={};}async list(){return [{udid:'test-phone'}];}async read(_o,file){if(file.endsWith('outgoing.json'))return core.encodePacket(this.doc,'outgoing-batch',this.packetExtras);if(this.last&&this.ack)return JSON.stringify({format:'jiufen-sync-ack',schema:1,deviceId:'phone',batchId:this.last.batchId});throw Object.assign(new Error('Missing'),{code:'NOT_FOUND'});}async write(_o,_file,text){this.writes++;this.last=core.decodePacket(text);this.doc=core.adoptDocument(this.last.document,'phone');}}
test('successful sync merges different edits and reports complete only after correct phone acknowledgment',async()=>{
 const initial=state(),desktop=core.createDocument(initial,'pc'),phone=core.adoptDocument(desktop,'phone');let a=clone(initial),b=clone(initial);a.cards['jf-1'].note='电脑笔记';b.cards['jf-1'].favorite=true;const store=new MemoryStore(core.record(desktop,initial,a)),transport=new Phone(core.record(phone,initial,b)),events=[];const manager=new SyncManager({store,transport,core,emit:e=>events.push(e),ackTimeout:100,pollInterval:1});await manager.run({});const s=core.materialize(store.doc);assert.equal(s.cards['jf-1'].note,'电脑笔记');assert.equal(s.cards['jf-1'].favorite,true);assert.equal(events.at(-1).phase,'complete');assert.equal(store.getMeta('pendingBatch'),null);assert.equal(store.backups.length,2);
});
test('timeout keeps pending batch; retry is idempotent and never reports premature completion',async()=>{
 const desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone'),false),events=[];const manager=new SyncManager({store,transport,core,emit:e=>events.push(e),ackTimeout:8,pollInterval:1});await assert.rejects(manager.run({}),/尚未确认/);assert(!events.some(e=>e.phase==='complete'));const batch=store.getMeta('pendingBatch').batchId;transport.ack=true;await manager.run({});assert.notEqual(transport.last.batchId,batch);assert.equal(events.at(-1).phase,'complete');assert.equal(core.summary(store.doc).operationCount,0);
});
test('first pairing requires confirmation and refuses two unrelated meaningful profiles',async()=>{
 const base=state(),desktop=core.createDocument(base,'pc'),phone=core.createDocument(base,'phone'),store=new MemoryStore(desktop),transport=new Phone(phone),manager=new SyncManager({store,transport,core,emit:()=>{},ackTimeout:30,pollInterval:1});await assert.rejects(manager.run({}),/首次配对/);await manager.run({bootstrap:true});assert.equal(transport.doc.profileId,desktop.profileId);
 const a=state();a.cards['jf-1'].note='电脑已有笔记';const b=state();b.cards['jf-1'].note='手机已有笔记';const other=new SyncManager({store:new MemoryStore(core.createDocument(a,'pc')),transport:new Phone(core.createDocument(b,'phone')),core,emit:()=>{},ackTimeout:30,pollInterval:1});await assert.rejects(other.run({bootstrap:true}),/都有不同来源/);
});
test('damaged phone packet is rejected before modifying the local document',async()=>{
 const desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport={list:async()=>[{udid:'phone'}],read:async()=>'{broken'},manager=new SyncManager({store,transport,core,emit:()=>{}});await assert.rejects(manager.run({}),/JSON/);assert.deepEqual(store.doc,desktop);assert.equal(store.backups.length,0);
});
test('signed app is resolved before file access and the actual bundle ID is reused throughout exchange',async()=>{
 const desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone')),events=[];
 const read=transport.read.bind(transport),write=transport.write.bind(transport),actual='com.jiufen.vocabulary.signed';let resolutions=0;
 transport.resolveApp=async options=>{resolutions++;assert.equal(options.bundleId,'com.jiufen.vocabulary');return {bundleId:actual};};
 transport.read=async(options,file)=>{assert.equal(options.bundleId,actual);return read(options,file);};
 transport.write=async(options,file,text)=>{assert.equal(options.bundleId,actual);return write(options,file,text);};
 const manager=new SyncManager({store,transport,core,emit:event=>events.push(event),ackTimeout:100,pollInterval:1});await manager.run({});
 assert.equal(resolutions,1);assert.equal(store.getMeta('phoneBundleId'),actual);assert.equal(events.find(event=>event.phase==='app-found').bundleId,actual);assert.equal(events.at(-1).phase,'complete');
});
test('ambiguous installed apps stop before modifying learning records or writing to phone',async()=>{
 const desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone'));
 transport.resolveApp=async()=>{throw Object.assign(new Error('多个候选 App'),{code:'AMBIGUOUS_APP'});};
 const manager=new SyncManager({store,transport,core,emit:()=>{}});await assert.rejects(manager.run({}),error=>error.code==='AMBIGUOUS_APP');assert.deepEqual(store.doc,desktop);assert.equal(transport.writes,0);
});
test('stale acknowledgments cannot confirm new data, and cancel preserves pending local data',async()=>{
 const desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone')),events=[];
 const ordinary=transport.read.bind(transport);transport.read=async(o,file)=>file.endsWith('ack.json')?JSON.stringify({format:'jiufen-sync-ack',schema:1,deviceId:'phone',batchId:'stale-old-batch'}):ordinary(o,file);
 const manager=new SyncManager({store,transport,core,emit:e=>events.push(e),ackTimeout:8,pollInterval:1});await assert.rejects(manager.run({}),/尚未确认/);assert(!events.some(e=>e.phase==='complete'));assert(store.getMeta('pendingBatch'));
 manager.ackTimeout=1000;manager.start({});while(!manager.busy||!events.some(e=>e.phase==='waiting'))await new Promise(r=>setTimeout(r,1));manager.cancel();while(manager.busy)await new Promise(r=>setTimeout(r,1));assert.equal(events.at(-1).phase,'cancelled');assert(store.getMeta('pendingBatch'));assert.deepEqual(core.materialize(store.doc).history,[]);
});
test('production protocol gate refuses old phone before any learning or content data changes',async()=>{
 const ContentPack=require('../../shared/content-pack.js'),desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone'));
 const manager=new SyncManager({store,transport,core,ContentPack,minProtocol:2,emit:()=>{}});
 await assert.rejects(manager.run({}),/版本过旧/);assert.deepEqual(store.doc,desktop);assert.equal(store.backups.length,0);assert.equal(transport.writes,0);assert.equal(store.content,null);
});
test('newer validated content travels independently with the merged learning packet',async()=>{
 const ContentPack=require('../../shared/content-pack.js'),desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone')),events=[];
 const make=version=>ContentPack.create([{id:'jf-1',word:'word',usage:{sentence:'Write one word.',translation:'写一个单词。',collocations:['one word']}}],version);
 store.content=make('2026-11-03.1');transport.packetExtras={clientProtocol:2,contentPack:make('2026-11-03.2')};
 const manager=new SyncManager({store,transport,core,ContentPack,minProtocol:2,emit:e=>events.push(e),ackTimeout:100,pollInterval:1});await manager.run({});
 assert.equal(store.content.version,'2026-11-03.2');assert.deepEqual(transport.last.contentPack,store.content);assert.equal(transport.last.clientProtocol,2);assert.deepEqual(core.materialize(store.doc).cards,desktop.baseline.cards);assert.equal(events.at(-1).phase,'complete');
});
test('conflicting content of the same version stops before backups or document changes',async()=>{
 const ContentPack=require('../../shared/content-pack.js'),desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone'));
 store.content=ContentPack.create([{id:'jf-1',word:'word',usage:{sentence:'Write one word.',translation:'写一个单词。',collocations:['one word']}}],'2026-11-03.2');
 const remote=ContentPack.create([{id:'jf-1',word:'word',usage:{sentence:'Read one word.',translation:'读一个单词。',collocations:['one word']}}],'2026-11-03.2');transport.packetExtras={clientProtocol:2,contentPack:remote};
 const manager=new SyncManager({store,transport,core,ContentPack,minProtocol:2,emit:()=>{}});await assert.rejects(manager.run({}),/相同|同一|冲突/);assert.deepEqual(store.doc,desktop);assert.equal(store.backups.length,0);assert.equal(transport.writes,0);
});
test('production content gate rejects partial packs before changing learning data',async()=>{
 const ContentPack=require('../../shared/content-pack.js'),desktop=core.createDocument(state(),'pc'),store=new MemoryStore(desktop),transport=new Phone(core.adoptDocument(desktop,'phone'));
 transport.packetExtras={clientProtocol:2,contentPack:ContentPack.create([{id:'jf-1',word:'word',usage:{sentence:'Write one word.',translation:'写一个单词。',collocations:['one word']}}],'2026-11-03.2')};
 const manager=new SyncManager({store,transport,core,ContentPack,expectedWords:[{id:'jf-1',word:'word'},{id:'jf-2',word:'other'}],minProtocol:2,emit:()=>{}});
 await assert.rejects(manager.run({}),/完整词库/);assert.deepEqual(store.doc,desktop);assert.equal(store.backups.length,0);assert.equal(transport.writes,0);
});
