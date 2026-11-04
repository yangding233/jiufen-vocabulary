'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../shared/legacy-reader.js'),D=require('../shared/desktop-state.js'),fixtures=require('./fixtures/legacy-documents.json');
for(const fixture of fixtures)test('old document migration is exact: '+fixture.name,()=>{
 const before=structuredClone(fixture.document),s=L.materialize(fixture.document);assert.deepEqual(s,fixture.expected);assert.deepEqual(fixture.document,before);
 const d=D.createDocument(s,fixture.document.deviceId,fixture.document.profileId);
 assert.deepEqual(D.documentState(d),fixture.expected);assert.equal(d.profileId,fixture.document.profileId);assert.equal(d.deviceId,fixture.document.deviceId);
 assert.deepEqual(L.documentState(JSON.stringify(fixture.document)),fixture.expected);
 if(fixture.packet){assert.deepEqual(L.decodePacket(fixture.packet).document,fixture.document);assert.deepEqual(L.documentState(fixture.packet),fixture.expected);assert.deepEqual(L.documentState(JSON.parse(fixture.packet)),fixture.expected);}
});
test('read-only migration rejects changed baseline, malformed operations and missing predecessors',()=>{
 const changed=structuredClone(fixtures[0].document);changed.baseline.cards['jf-0'].note='tampered';assert.throws(()=>L.materialize(changed),/起点校验/);
 const unknown=structuredClone(fixtures[0].document);unknown.operations[0].kind='execute';assert.throws(()=>L.materialize(unknown),/未知同步操作/);
 const missing=structuredClone(fixtures[0].document);missing.operations.shift();assert.throws(()=>L.materialize(missing),/依赖缺失/);
 assert.throws(()=>L.documentState('{invalid'));
 const packet=JSON.parse(fixtures[0].packet);packet.payload=packet.payload.replace('alpha','omega');assert.throws(()=>L.decodePacket(JSON.stringify(packet)),/校验/);
});
test('legacy reader has no recording, merging, signing, transport or packet-writing API',()=>{
 for(const name of ['record','createDocument','mergeDocuments','adoptDocument','resolveConflict','encodePacket'])assert.equal(L[name],undefined);
});
