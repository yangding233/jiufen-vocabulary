'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../shared/sync-core.js'),B=require('../shared/wordbooks.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function state(){const words=[{id:'jf-0001',word:'audience',meaning:'观众',phonetic:'/ˈɔːdiəns/',sentence:'An audience waited.',group:'常规 List 01'}],cards={'jf-0001':{seen:true,mastered:false,planned:true,suspended:false,favorite:true,due:'2026-11-05',interval:3,streak:2,lastGrade:'good',legacyGrade:null,lastScheduledDay:'2026-11-02',learnedOn:'2026-11-01',lastSeen:'2026-11-02T10:00:00Z',updatedAt:'2026-11-02T10:00:00Z',reviewCount:2,lapses:0,note:'我的笔记',memoryAnchor:'audience',memoryScene:'观众席'}};return {schema:2,app:'jiufen-mnemonic-learning',revision:0,writer:'fixture',updatedAt:'2026-11-04T01:00:00Z',words,cards,settings:{dailyTarget:50,dailyNew:20,mode:'mnemonic'},history:[],session:null,undo:null,dailyPlan:null,baseline:{date:'2026-11-01',ids:[],source:'fixture'},meta:{lastBackupAt:null,migrated:0}};}
function change(doc,fn){const before=S.materialize(doc),after=clone(before);fn(after);return S.record(doc,before,after);}
function book(s,id='book:reading'){B.createBook(s,{id,name:'阅读生词',createdAt:'2026-11-04T00:00:00Z'});B.addMember(s,id,'jf-0001',{chapter:'第一章',order:0});}
function add(s,id,word){s.words.push({id,word,meaning:'测试',phonetic:'',sentence:'',group:'我的导入'});s.cards[id]={...clone(s.cards['jf-0001']),seen:false,mastered:false,planned:false,favorite:false,due:null,interval:0,streak:0,lastGrade:null,lastScheduledDay:null,learnedOn:null,lastSeen:null,updatedAt:null,reviewCount:0,note:'',memoryAnchor:'',memoryScene:''};}

test('legacy book projection does not change old state or baseline identity',()=>{
 const original=state(),before=clone(original),v=B.view(original);assert.equal(v.books['book:jiufen'].name,'九分常规词表');assert.equal(v.members['book:jiufen']['jf-0001'].chapter,'常规 List 01');assert.deepEqual(original,before);
 const doc=S.createDocument(original,'pc'),saved=clone(doc),updated=change(doc,s=>book(s));assert.equal(updated.schema,2);assert.equal(updated.profileId,saved.profileId);assert.equal(updated.deviceId,saved.deviceId);assert.equal(updated.baselineHash,saved.baselineHash);assert.deepEqual(updated.baseline,saved.baseline);assert.deepEqual(S.materialize(updated).cards,original.cards);assert.deepEqual(doc,saved);
});
test('one word belongs to multiple books and repeated association preserves learning and adds no operations',()=>{
 let d=S.createDocument(state(),'pc');d=change(d,s=>{book(s);book(s,'book:listening');});const s=S.materialize(d),n=d.operations.length;assert.equal(s.words.length,1);assert.equal(B.wordsInBook(s,'book:reading')[0].id,'jf-0001');assert.equal(B.wordsInBook(s,'book:listening')[0].id,'jf-0001');assert.deepEqual(s.cards,state().cards);
 d=change(d,s=>book(s));assert.equal(d.operations.length,n);assert.equal(S.materialize(d).cards['jf-0001'].due,'2026-11-05');
});
test('built-in content overlays survive save and replay without touching its original lexical baseline',()=>{
 const original=S.createDocument(state(),'pc'),d=change(original,s=>{book(s);B.setContent(s,'jf-0001',{meaning:'n. 观众；听众',translation:'观众等候。',tags:'听力',source:'我的词表.xlsx'});});const s=S.materialize(d);assert.equal(s.words[0].meaning,'n. 观众；听众');assert.equal(s.words[0].translation,'观众等候。');assert.equal(d.baseline.words[0].meaning,'观众');assert.deepEqual(s.cards,original.baseline.cards);
 s.words[0].meaning='旧内容重建';B.applyOverrides(s);assert.equal(s.words[0].meaning,'n. 观众；听众');
 assert.deepEqual(S.materialize(S.decodePacket(S.encodePacket(d,'archive')).document),S.materialize(d));assert.throws(()=>S.encodePacket(d,'wrong',{clientProtocol:2}),/新版/);
});
test('independent book membership additions merge in both directions and removal cannot resurrect on retry',()=>{
 const base=S.createDocument(state(),'pc'),pc=change(base,s=>book(s)),phone=change(S.adoptDocument(base,'phone'),s=>book(s,'book:listening'));
 const ab=S.mergeDocuments(pc,phone),ba=S.mergeDocuments(phone,pc);assert.deepEqual(S.materialize(ab).library,S.materialize(ba).library);assert.equal(Object.keys(S.materialize(ab).library.books).length,3);
 const removed=change(ab,s=>B.removeMember(s,'book:reading','jf-0001')),out=S.materialize(S.mergeDocuments(removed,pc));assert.equal(B.wordsInBook(out,'book:reading').length,0);assert.equal(B.wordsInBook(out,'book:listening').length,1);assert.equal(out.cards['jf-0001'].note,'我的笔记');
});
test('concurrent offline same-spelling additions preserve both identities and can be reviewed without stopping sync',()=>{
 const base=S.createDocument(state(),'pc'),pc=change(base,s=>{book(s);add(s,'custom:pc','Bank');B.addMember(s,'book:reading','custom:pc',{order:1});}),phone=change(S.adoptDocument(base,'phone'),s=>{book(s,'book:phone');add(s,'custom:phone','bank');B.addMember(s,'book:phone','custom:phone',{order:1});});
 const out=S.materialize(S.mergeDocuments(pc,phone));assert.equal(out.words.length,3);assert(out.cards['custom:pc']);assert(out.cards['custom:phone']);assert.deepEqual(new Set(B.duplicates(out)[0].wordIds),new Set(['custom:pc','custom:phone']));assert.equal(out.cards['jf-0001'].due,'2026-11-05');
 assert.equal(S.materialize(S.mergeDocuments(S.mergeDocuments(pc,phone),phone)).words.length,3);
});
test('concurrent content edits expose alternatives and explicit resolution propagates',()=>{
 const base=change(S.createDocument(state(),'pc'),s=>book(s)),pc=change(base,s=>B.setContent(s,'jf-0001',{meaning:'观众；听众'})),phone=change(S.adoptDocument(base,'phone'),s=>B.setContent(s,'jf-0001',{meaning:'读者；观众'}));
 const merged=S.mergeDocuments(pc,phone);assert.equal(merged.conflicts.length,1);assert.equal(merged.conflicts[0].section,'overrides');const resolved=S.resolveConflict(merged,merged.conflicts[0].id,'观众；听众；读者');assert.equal(resolved.conflicts.length,0);assert.equal(S.materialize(S.mergeDocuments(resolved,phone)).words[0].meaning,'观众；听众；读者');assert.deepEqual(S.materialize(resolved).cards,state().cards);
});
test('book batch metadata roundtrips; unknown members and dangerous keys fail validation',()=>{
 const d=change(S.createDocument(state(),'pc'),s=>{book(s);s.library.batches['batch:1']={id:'batch:1',bookId:'book:reading',name:'词表.xlsx',createdAt:'2026-11-04T01:00:00Z',rows:1,added:0,linked:1,updated:0,skipped:0,errors:0};});assert.equal(S.materialize(d).library.batches['batch:1'].linked,1);
 assert.throws(()=>change(d,s=>s.library.members['book:reading']['custom:missing']={wordId:'custom:missing',chapter:'',order:2}),/未知/);
 assert.throws(()=>B.validate({...state(),library:JSON.parse('{"schema":1,"books":{},"members":{},"batches":{},"overrides":{},"__proto__":{}}')}),/不安全/);
});

test('intentionally clearing a built-in field records an empty override; native key order does not create edits',()=>{
 const d=change(S.createDocument(state(),'pc'),s=>{book(s);B.setContent(s,'jf-0001',{sentence:''});});assert.equal(S.materialize(d).words[0].sentence,'');
 const s=S.materialize(d),reordered=clone(s);reordered.library.books['book:reading']=Object.fromEntries(Object.entries(reordered.library.books['book:reading']).reverse());assert.deepEqual(B.diff(s,reordered),[]);
});
