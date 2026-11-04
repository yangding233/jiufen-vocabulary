'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('./storage.cjs');
const results=path.resolve(__dirname,'../../test-results');fs.mkdirSync(results,{recursive:true});
const tmp=()=>fs.mkdtempSync(path.join(results,'store-'));
const doc=n=>({format:'jiufen-usb',schema:1,profileId:'p',deviceId:'d',baseline:{n},operations:[]});
test('SQLite commits, keeps previous values and preserves stable device identity across reopen',()=>{
 const dir=tmp();let s=new Store(dir);assert.equal(s.load(),null);const device=s.getMeta('deviceId');s.save(doc(1));s.save(doc(2));assert.deepEqual(s.load(),doc(2));assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,1);s.close();s=new Store(dir);assert.equal(s.getMeta('deviceId'),device);assert.deepEqual(s.load(),doc(2));s.close();
});
test('validation failure does not destroy saved state; backups bounded; file backup written',()=>{
 const dir=tmp(),s=new Store(dir,d=>{if(d.baseline.n<0)throw new Error('Invalid state');});s.save(doc(1));assert.throws(()=>s.save(doc(-1)),/Invalid/);assert.deepEqual(s.load(),doc(1));for(let n=2;n<40;n++)s.save(doc(n));assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,20);const file=s.saveBackup('before-sync',doc(39));assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),doc(39));s.close();
});
test('metadata roundtrips pending batches without changing the document',()=>{
 const s=new Store(tmp());s.save(doc(1));s.setMeta('pendingBatch',{batchId:'b1'});assert.deepEqual(s.getMeta('pendingBatch'),{batchId:'b1'});assert.deepEqual(s.load(),doc(1));s.setMeta('pendingBatch',null);assert.equal(s.getMeta('pendingBatch'),null);s.close();
});

test('schema2 wordbook archive commits and reopens without changing profile or baseline',()=>{
 const dir=tmp(),upgraded={...doc(4),schema:2,operations:[{kind:'library-set',section:'books',key:'book:test',value:{id:'book:test',name:'我的词书'}}]};let s=new Store(dir);s.save(doc(4));s.save(upgraded);s.close();s=new Store(dir);assert.deepEqual(s.load(),upgraded);assert.equal(s.load().profileId,'p');assert.deepEqual(s.load().baseline,{n:4});assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,1);s.close();
});
test('content packs are independently validated and stored without changing learning data or backups',()=>{
 const ContentPack=require('../../shared/content-pack.js'),s=new Store(tmp(),null,{contentValidator:pack=>ContentPack.validate(pack)});
 const pack=ContentPack.create([{id:'jf-1',word:'word',usage:{sentence:'Write one word.',translation:'写一个单词。',collocations:['one word']}}],'2026-11-03.2');
 s.save(doc(1));assert.equal(s.loadContent(),null);assert.equal(s.saveContent(pack),true);assert.deepEqual(s.loadContent(),pack);assert.deepEqual(s.load(),doc(1));assert.equal(s.listBackups().length,0);
 const changed=JSON.parse(JSON.stringify(pack));changed.entries[0].word='other';assert.throws(()=>s.saveContent(changed),/校验/);assert.deepEqual(s.loadContent(),pack);assert.deepEqual(s.load(),doc(1));s.close();
});
test('backup center uses opaque IDs, bounded snapshots and previews without replacing the active document',()=>{
 const s=new Store(tmp(),d=>d.baseline),saved=n=>({...doc(n),baseline:{words:[{id:'w'}],cards:{w:{seen:n>0}},history:Array.from({length:n},(_,i)=>({id:String(i)}))}});
 s.save(saved(1));s.save(saved(2));for(let n=0;n<25;n++)s.saveBackup('sync',saved(n));
 const list=s.listBackups();assert.equal(list.length,21);assert(list.every(x=>Object.keys(x).sort().join(',')==='at,history,id,seen,words'));assert.equal(list[0].words,1);
 const sqlite=list.find(x=>x.id.startsWith('sqlite:'));assert.equal(sqlite.history,1);assert.deepEqual(s.backupPreview(sqlite.id),saved(1));assert.deepEqual(s.load(),saved(2));
 assert.throws(()=>s.backupPreview('../progress.sqlite'),/找不到|编号/);assert.throws(()=>s.backupPreview('file:../../secrets'),/找不到|编号/);assert.equal(s.backupFiles().length,20);s.close();
});
test('independent recovery keeps the former profile in a snapshot and clears pairing without changing device identity',()=>{
 const s=new Store(tmp()),original=doc(1),recovered={...doc(2),profileId:'independent-recovery'};s.save(original);s.setMeta('pendingBatch',{batchId:'old'});s.setMeta('lastSync',{batchId:'old'});s.setMeta('phoneBundleId','old.app');
 assert.throws(()=>s.createRecovery(original),/新的档案/);assert.throws(()=>s.createRecovery({...recovered,deviceId:'other-device'}),/设备身份/);assert.deepEqual(s.load(),original);
 s.createRecovery(recovered);assert.deepEqual(s.load(),recovered);assert.equal(s.getMeta('pendingBatch'),null);assert.equal(s.getMeta('lastSync'),null);assert.equal(s.getMeta('phoneBundleId'),null);
 const sync=s.listBackups().filter(item=>item.id.startsWith('file:'));assert.equal(sync.length,1);assert.deepEqual(s.backupPreview(sync[0].id),original);assert.notEqual(s.load().profileId,original.profileId);assert.equal(s.load().deviceId,original.deviceId);s.close();
});

const DesktopState=require('../../shared/desktop-state.js'),LegacyReader=require('../../shared/legacy-reader.js');
function learningState(){
 const word={id:'jf-0001',word:'audience',meaning:'观众',phonetic:'/a/',sentence:'An audience waited.',group:'常规 List 01'};
 const card={seen:true,mastered:false,planned:true,suspended:false,favorite:true,due:'2026-11-05',interval:3,streak:2,lastGrade:'good',legacyGrade:null,lastScheduledDay:'2026-11-02',learnedOn:'2026-11-01',lastSeen:'2026-11-02T10:00:00Z',updatedAt:'2026-11-02T10:00:00Z',reviewCount:2,lapses:0,note:'我的笔记',memoryAnchor:'audience',memoryScene:'观众席'};
 return {schema:2,app:'jiufen-mnemonic-learning',revision:2,writer:'fixture',updatedAt:'2026-11-04T01:00:00Z',words:[word],cards:{[word.id]:card},settings:{dailyTarget:50,dailyNew:20,mode:'mnemonic'},history:[],session:null,undo:null,dailyPlan:null,baseline:{date:'2026-11-01',ids:[],source:'fixture'},meta:{lastBackupAt:null,migrated:0}};
}
function oldDocument(){
 const baseline=learningState(),operation={kind:'card-set',wordId:'jf-0001',field:'note',value:'迁移后保留的历史操作',id:'old-pc:1',deviceId:'old-pc',seq:1,lamport:1,context:{},at:'2026-11-04T02:00:00Z'};
 return {format:'jiufen-usb',schema:1,profileId:'same-profile',deviceId:'old-pc',baseline,baselineHash:DesktopState.sha256(DesktopState.canonical(baseline)),operations:[operation],localState:{session:null,undo:null,dailyPlan:null,revision:2,writer:'fixture',updatedAt:'2026-11-04T01:00:00Z'},conflicts:[],createdAt:'2026-11-01T00:00:00Z'};
}
const migrate=document=>DesktopState.createDocument(LegacyReader.documentState(document),document.deviceId,document.profileId);
const desktopStore=directory=>new Store(directory,document=>DesktopState.documentState(document),{migrateDocument:migrate});
test('desktop migration keeps full immutable legacy archive before replacing the active record and survives rolling cleanup',()=>{
 const directory=tmp(),original=oldDocument(),seed=new Store(directory);seed.save(original);seed.close();
 const s=desktopStore(directory),converted=s.load();
 assert.equal(converted.format,'jiufen-desktop');assert.equal(converted.profileId,original.profileId);assert.equal(converted.deviceId,original.deviceId);
 assert.deepEqual(converted.state,LegacyReader.documentState(original));assert.equal(converted.state.cards['jf-0001'].note,'迁移后保留的历史操作');
 assert.equal(Object.hasOwn(converted,'operations'),false);
 const preserved=fs.readdirSync(path.join(directory,'migration-backups'));assert.equal(preserved.length,1);
 const backup=path.join(directory,'migration-backups',preserved[0]);assert.deepEqual(JSON.parse(fs.readFileSync(backup,'utf8')),original);
 for(let n=0;n<25;n++){const next=DesktopState.documentState(converted);next.revision+=n+1;s.save(DesktopState.update(converted,next));}
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,20);assert(fs.existsSync(backup));
 assert.equal(fs.readdirSync(path.join(directory,'migration-backups')).length,1);s.close();
 const reopened=desktopStore(directory);assert.equal(reopened.load().format,'jiufen-desktop');assert.equal(fs.readdirSync(path.join(directory,'migration-backups')).length,1);reopened.close();
});
test('failed migration backup cannot overwrite the original database document',()=>{
 const directory=tmp(),original=oldDocument(),seed=new Store(directory);seed.save(original);seed.close();
 fs.writeFileSync(path.join(directory,'migration-backups'),'blocked directory');
 const s=desktopStore(directory);assert.throws(()=>s.load());
 const raw=s.db.prepare("SELECT value FROM kv WHERE key='document'").get().value;assert.deepEqual(JSON.parse(raw),original);s.close();
});
test('legacy rolling and file backups remain previewable without rewriting either file or active desktop record',()=>{
 const directory=tmp(),legacy=oldDocument(),seed=new Store(directory);seed.save(legacy);const oldFile=seed.saveBackup('old',legacy);seed.close();
 const s=desktopStore(directory),current=s.load();let backups=s.listBackups();assert(backups.length>=2);
 for(const item of backups){const preview=s.backupPreview(item.id);assert.equal(preview.format,'jiufen-desktop');assert.equal(preview.profileId,current.profileId);assert.equal(preview.state.cards['jf-0001'].note,'迁移后保留的历史操作');}
 assert.deepEqual(JSON.parse(fs.readFileSync(oldFile,'utf8')),legacy);assert.deepEqual(s.load(),current);s.close();
});
