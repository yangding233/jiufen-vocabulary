'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../shared/book-tools.js'),W=require('../shared/wordbooks.js'),D=require('../shared/desktop-state.js');
const clone=x=>structuredClone(x);
function state(){return clone(require('./fixtures/legacy-documents.json')[0].expected);}
function fixture(){let s=state();if(!s){const L=require('../shared/legacy-reader.js');s=L.materialize(require('./fixtures/legacy-documents.json')[0].document);}s.revision=0;return s;}
function create(s,id,name='我的词书'){W.createBook(s,{id,name});for(const [i,w] of s.words.entries())W.addMember(s,id,w.id,{order:i,chapter:i%2?'第二章':'第一章'});}

test('study book union deduplicates memberships, empty scope pauses new selection and archive does not erase scope',()=>{
 const s=fixture();create(s,'book:a');create(s,'book:b');const cards=clone(s.cards),history=clone(s.history);
 assert.equal(B.studyIds(s),null);B.setStudyBooks(s,['book:a','book:b']);assert.equal(B.studyIds(s).size,s.words.length);
 B.archive(s,'book:a');assert.equal(B.studyIds(s).size,s.words.length);assert.equal(s.library.books['book:a'].archived,true);
 B.setStudyBooks(s,[]);assert.equal(B.studyIds(s).size,0);assert.deepEqual(s.cards,cards);assert.deepEqual(s.history,history);
 assert.throws(()=>B.setStudyBooks(s,['book:missing']),/不存在/);
});
test('chapter order and removing membership keep words, histories and orphan records',()=>{
 const s=fixture();create(s,'book:a');const ids=s.words.map(w=>w.id),cards=clone(s.cards),history=clone(s.history);
 B.reorderChapters(s,'book:a',['第二章','第一章']);assert.equal(W.wordsInBook(s,'book:a')[0].id,s.words[1].id);
 for(const [bookId,members] of Object.entries(s.library.members))B.removeMembers(s,bookId,Object.keys(members));
 assert.deepEqual([...B.ungroupedIds(s)].sort(),ids.sort());assert.deepEqual(s.cards,cards);assert.deepEqual(s.history,history);
 assert.throws(()=>B.reorderChapters(s,'book:a',['不存在']),/章节/);
});
test('public wordbook package excludes progress, personal notes, identity and arbitrary fields',()=>{
 const s=fixture();create(s,'book:a');const p=B.createPackage(s,['book:a'],{id:'package:test'}),raw=JSON.stringify(p);
 assert(!raw.includes('profileId')&&!raw.includes('memoryAnchor')&&!raw.includes('history')&&!raw.includes('reviewCount'));
 assert.equal(p.entries.length,s.words.length);assert(p.books[0].members.length);
 assert.throws(()=>B.validatePackage({...p,cards:{}}),/非资料/);
 const bad=clone(p);bad.entries[0].note='个人笔记';assert.throws(()=>B.validatePackage(bad),/未知/);
 const polluted=JSON.parse(JSON.stringify(p).replace('"schema":1','"schema":1,"__proto__":{}'));assert.throws(()=>B.validatePackage(polluted),/不安全/);
});
test('package preview is read only and fill protects local fields; explicit replacement preserves cards/history',()=>{
 const s=fixture();create(s,'book:a');const p=B.createPackage(s,['book:a'],{id:'package:test'}),before=clone(s),id=p.entries[0].id;
 p.entries[0].meaning='来自新包的资料';p.entries[0].translation='补译文';
 const plan=B.previewPackage(s,p);assert.deepEqual(s,before);assert.equal(plan.rows[0].changes.meaning,undefined);assert.equal(plan.rows[0].changes.translation,'补译文');
 let counter=0;const applied=B.applyPackage(s,plan,{idFactory:()=>String(++counter),blankCard:()=>{throw Error('existing words must link');}});
 assert.equal(applied.words.find(w=>w.id===id).meaning,before.words[0].meaning);assert.equal(applied.words[0].translation,'补译文');assert.deepEqual(applied.cards,before.cards);assert.deepEqual(applied.history,before.history);
 const replace=B.previewPackage(s,p,{decisions:{[id]:{action:'replace'}}}),changed=B.applyPackage(s,replace,{idFactory:()=>String(++counter),blankCard:()=>null});assert.equal(changed.words[0].meaning,'来自新包的资料');
 const again=B.previewPackage(applied,p);assert.equal(again.stats.added,0);const repeated=B.applyPackage(applied,again,{idFactory:()=>String(++counter),blankCard:()=>null});assert.equal(repeated.words.length,applied.words.length);assert.equal(Object.keys(repeated.library.books).length,Object.keys(applied.library.books).length);
 const stale={...s,revision:1};assert.throws(()=>B.applyPackage(stale,plan,{blankCard:()=>null}),/重新预览/);
 D.validateState(applied);
});
test('same spelling independent senses require explicit association',()=>{
 const s=fixture();create(s,'book:a');const p=B.createPackage(s,['book:a'],{id:'package:ambiguous'});p.entries[0].id='custom:unknown';p.books[0].members[0].wordId='custom:unknown';
 const another=clone(s.words[0]);another.id='custom:independent';s.words.push(another);s.cards[another.id]=clone(s.cards[s.words[0].id]);
 const preview=B.previewPackage(s,p);assert.equal(preview.rows[0].action,'review');assert.equal(preview.canApply,false);
 const decided=B.previewPackage(s,p,{decisions:{'custom:unknown':{targetId:s.words[0].id,action:'keep'}}});assert.equal(decided.canApply,true);
});
test('batch undo only reverts unchanged content and never rewinds later feedback',()=>{
 const before=fixture();create(before,'book:a');const after=clone(before),first=after.words[0].id,second=after.words[1].id;
 W.setContent(after,first,{meaning:'新释义'});W.setContent(after,second,{meaning:'另一个释义'});B.recordBatch(before,after,{id:'batch:fill',name:'补资料'});
 const now=clone(after);now.revision++;W.setContent(now,first,{meaning:'后来手动编辑'});now.history.push({...clone(now.history[0]),id:'later-event'});
 const preview=B.previewUndo(now,'batch:fill');assert(preview.conflicts>=1);assert(preview.ready>=1);const result=B.applyUndo(now,preview);
 assert.equal(result.words[0].meaning,'后来手动编辑');assert.equal(result.words[1].meaning,before.words[1].meaning);assert.deepEqual(result.cards,now.cards);assert.deepEqual(result.history,now.history);
 assert.throws(()=>B.previewUndo(result,'batch:fill'),/没有可撤销/);
 const malicious=clone(after);malicious.library.batches['batch:fill'].journal.changes[0].path=['library','books'];assert.throws(()=>B.previewUndo(malicious,'batch:fill'),/路径/);
 const malformed=clone(after);malformed.library.batches['batch:fill'].journal.changes[0].before={exists:true,value:{unexpected:'object'}};assert.throws(()=>B.previewUndo(malformed,'batch:fill'),/类型/);
});
test('first edit of a legacy projected library does not journal removal of its implicit books',()=>{
 const before=fixture();delete before.library;const after=clone(before),first=after.words[0].id;
 W.setContent(after,first,{meaning:'第一次编辑'});B.recordBatch(before,after,{id:'batch:first'});
 assert(after.library.batches['batch:first'].journal.changes.every(change=>!(change.path[0]==='library'&&change.path[1]==='members')));
 const reopened=JSON.parse(JSON.stringify(after)),undone=B.applyUndo(reopened,B.previewUndo(reopened,'batch:first'));
 assert.equal(undone.words[0].meaning,before.words[0].meaning);assert.equal(W.wordsInBook(undone,'book:jiufen').length,before.words.length);
});

test('selected book study order follows reordered chapters without duplicating shared words',()=>{const s=fixture();create(s,'book:order');B.setStudyBooks(s,['book:order']);const order=B.chapters(s,'book:order').reverse();B.reorderChapters(s,'book:order',order);const first=[...B.studyIds(s)][0];assert.equal(s.library.members['book:order'][first].chapter,order[0]);});
