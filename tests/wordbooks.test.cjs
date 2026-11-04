'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../shared/desktop-state.js'),B=require('../shared/wordbooks.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function state(){const words=[{id:'jf-0001',word:'audience',meaning:'观众',phonetic:'/ˈɔːdiəns/',sentence:'An audience waited.',group:'常规 List 01'}],cards={'jf-0001':{seen:true,mastered:false,planned:true,suspended:false,favorite:true,due:'2026-11-05',interval:3,streak:2,lastGrade:'good',legacyGrade:null,lastScheduledDay:'2026-11-02',learnedOn:'2026-11-01',lastSeen:'2026-11-02T10:00:00Z',updatedAt:'2026-11-02T10:00:00Z',reviewCount:2,lapses:0,note:'我的笔记',memoryAnchor:'audience',memoryScene:'观众席'}};return {schema:2,app:'jiufen-mnemonic-learning',revision:0,writer:'fixture',updatedAt:'2026-11-04T01:00:00Z',words,cards,settings:{dailyTarget:50,dailyNew:20,mode:'mnemonic'},history:[],session:null,undo:null,dailyPlan:null,baseline:{date:'2026-11-01',ids:[],source:'fixture'},meta:{lastBackupAt:null,migrated:0}};}
function change(doc,fn){const before=S.materialize(doc),after=clone(before);fn(after);return S.update(doc,after);}
function book(s,id='book:reading'){B.createBook(s,{id,name:'阅读生词',createdAt:'2026-11-04T00:00:00Z'});B.addMember(s,id,'jf-0001',{chapter:'第一章',order:0});}
function add(s,id,word){s.words.push({id,word,meaning:'测试',phonetic:'',sentence:'',group:'我的导入'});s.cards[id]={...clone(s.cards['jf-0001']),seen:false,mastered:false,planned:false,favorite:false,due:null,interval:0,streak:0,lastGrade:null,lastScheduledDay:null,learnedOn:null,lastSeen:null,updatedAt:null,reviewCount:0,note:'',memoryAnchor:'',memoryScene:''};}

test('legacy book projection does not change old state or learning baseline',()=>{
 const original=state(),before=clone(original),v=B.view(original);assert.equal(v.books['book:jiufen'].name,'九分常规词表');assert.equal(v.members['book:jiufen']['jf-0001'].chapter,'常规 List 01');assert.deepEqual(original,before);
 const doc=S.createDocument(original,'pc'),saved=clone(doc),updated=change(doc,s=>book(s));assert.equal(updated.profileId,saved.profileId);assert.equal(updated.deviceId,saved.deviceId);assert.deepEqual(updated.state.baseline,saved.state.baseline);assert.deepEqual(S.materialize(updated).cards,original.cards);assert.deepEqual(doc,saved);
});
test('one word belongs to multiple books and repeated association preserves learning',()=>{
 let d=S.createDocument(state(),'pc');d=change(d,s=>{book(s);book(s,'book:listening');});const s=S.materialize(d);assert.equal(s.words.length,1);assert.equal(B.wordsInBook(s,'book:reading')[0].id,'jf-0001');assert.equal(B.wordsInBook(s,'book:listening')[0].id,'jf-0001');assert.deepEqual(s.cards,state().cards);
 d=change(d,s=>book(s));assert.deepEqual(S.materialize(d).library,s.library);assert.equal(S.materialize(d).cards['jf-0001'].due,'2026-11-05');
});
test('built-in content overlays survive a snapshot save without changing prior snapshot',()=>{
 const original=S.createDocument(state(),'pc'),d=change(original,s=>{book(s);B.setContent(s,'jf-0001',{meaning:'n. 观众；听众',translation:'观众等候。',tags:'听力',source:'我的词表.xlsx'});});const s=S.materialize(d);assert.equal(s.words[0].meaning,'n. 观众；听众');assert.equal(s.words[0].translation,'观众等候。');assert.equal(original.state.words[0].meaning,'观众');assert.deepEqual(s.cards,original.state.cards);
 s.words[0].meaning='旧内容重建';B.applyOverrides(s);assert.equal(s.words[0].meaning,'n. 观众；听众');assert.deepEqual(S.materialize(JSON.parse(JSON.stringify(d))),S.materialize(d));
});
test('removing a book membership preserves the word and its other books',()=>{
 let d=change(S.createDocument(state(),'pc'),s=>{book(s);book(s,'book:listening');});d=change(d,s=>B.removeMember(s,'book:reading','jf-0001'));const out=S.materialize(d);assert.equal(B.wordsInBook(out,'book:reading').length,0);assert.equal(B.wordsInBook(out,'book:listening').length,1);assert.equal(out.cards['jf-0001'].note,'我的笔记');assert.equal(out.words.length,1);
});
test('independent same-spelling additions preserve both identities for explicit review',()=>{
 const d=change(S.createDocument(state(),'pc'),s=>{book(s);add(s,'custom:first','Bank');add(s,'custom:second','bank');B.addMember(s,'book:reading','custom:first',{order:1});B.addMember(s,'book:reading','custom:second',{order:2});});
 const out=S.materialize(d);assert.equal(out.words.length,3);assert(out.cards['custom:first']);assert(out.cards['custom:second']);assert.deepEqual(new Set(B.duplicates(out)[0].wordIds),new Set(['custom:first','custom:second']));assert.equal(out.cards['jf-0001'].due,'2026-11-05');
});
test('book batch metadata roundtrips; unknown members and dangerous keys fail validation',()=>{
 const d=change(S.createDocument(state(),'pc'),s=>{book(s);s.library.batches['batch:1']={id:'batch:1',bookId:'book:reading',name:'词表.xlsx',createdAt:'2026-11-04T01:00:00Z',rows:1,added:0,linked:1,updated:0,skipped:0,errors:0};});assert.equal(S.materialize(d).library.batches['batch:1'].linked,1);
 assert.throws(()=>change(d,s=>s.library.members['book:reading']['custom:missing']={wordId:'custom:missing',chapter:'',order:2}),/未知/);
 assert.throws(()=>B.validate({...state(),library:JSON.parse('{"schema":1,"books":{},"members":{},"batches":{},"overrides":{},"__proto__":{}}')}),/不安全/);
});
test('intentionally clearing a field records an empty override; key order does not create edits',()=>{
 const d=change(S.createDocument(state(),'pc'),s=>{book(s);B.setContent(s,'jf-0001',{sentence:''});});assert.equal(S.materialize(d).words[0].sentence,'');
 const s=S.materialize(d),reordered=clone(s);reordered.library.books['book:reading']=Object.fromEntries(Object.entries(reordered.library.books['book:reading']).reverse());assert.deepEqual(B.diff(s,reordered),[]);
});
