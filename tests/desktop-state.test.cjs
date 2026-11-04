'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const D=require('../shared/desktop-state.js'),fixtures=require('./fixtures/legacy-documents.json');
const state=()=>structuredClone(fixtures[0].expected);

test('snapshot updates keep identity and detach input state without operation logs',()=>{
 const initial=state(),d=D.createDocument(initial,'pc','profile-1');
 assert.equal(d.format,'jiufen-desktop');assert.equal(d.schema,1);assert.deepEqual(D.documentState(d),initial);
 initial.cards['jf-0'].note='outside mutation';assert.notEqual(d.state.cards['jf-0'].note,initial.cards['jf-0'].note);
 const next=D.documentState(d);next.cards['jf-0'].note='new note';next.revision++;
 const updated=D.update(d,next);next.history.length=0;
 assert.equal(updated.profileId,d.profileId);assert.equal(updated.deviceId,d.deviceId);
 assert.equal(updated.state.cards['jf-0'].note,'new note');assert.notEqual(d.state.cards['jf-0'].note,'new note');
 assert.equal(updated.state.history.length,d.state.history.length);assert.equal(updated.operations,undefined);
});
test('state validation retains dates, mastery, history and rejects invalid or unsafe records',()=>{
 const s=state();assert.equal(D.validateState(s),s);
 for(const mutate of [s=>s.cards['jf-0'].due='2026-02-30',s=>s.history.push(s.history[0]),s=>s.settings.audioRate=20,s=>s.cards['jf-1'].mastered=false]){
  const invalid=state();mutate(invalid);assert.throws(()=>D.createDocument(invalid,'pc'));
 }
 const polluted=JSON.parse(JSON.stringify(s).replace('"meta":{','"meta":{"__proto__":{},'));assert.throws(()=>D.validateState(polluted),/不安全/);
 assert.throws(()=>D.validateDocument({...D.createDocument(s,'pc'),operations:[]}),/未知字段/);
});
test('stable UTF-8 hashes keep existing content and backup integrity compatible',()=>{
 for(const text of ['', 'abc','中文 /ɑː/', 'x'.repeat(100000)])assert.equal(D.sha256(text),crypto.createHash('sha256').update(text).digest('hex'));
});
test('normal snapshot writes preserve imported wordbooks and meaning overrides',()=>{
 const s=structuredClone(fixtures[2].expected),d=D.createDocument(s,'pc','old-profile');
 const fresh=D.update(d,{...D.documentState(d),revision:s.revision+1});
 assert.deepEqual(fresh.state.cards,s.cards);assert.deepEqual(fresh.state.history,s.history);
 assert.deepEqual(fresh.state.library,s.library);assert.deepEqual(fresh.state.baseline,s.baseline);
 assert.equal(D.summary(fresh).wordCount,s.words.length);assert.equal(D.summary(fresh).historyCount,s.history.length);
});
