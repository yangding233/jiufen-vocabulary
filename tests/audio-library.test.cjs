'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('../shared/audio-library.js');
test('text/locale cache keys are stable, content-aware and match worker hashing',()=>{
 const text='He bought a newspaper at the station.';
 assert.equal(A.key(text,'en-GB'),'21265ddad78c401b9f772eb0a6df0385656e66e8e72dc612e02a5cdd367d563d');
 assert.equal(A.key(' '+text+' ','en-GB'),A.key(text,'en-GB'));assert.notEqual(A.key(text,'en-US'),A.key(text,'en-GB'));assert.notEqual(A.key(text+'!','en-GB'),A.key(text,'en-GB'));
 assert.throws(()=>A.key('', 'en-GB'));assert.throws(()=>A.key(text,'zh-CN'));assert.throws(()=>A.key('x'.repeat(2001),'en-GB'));
});
test('generation plans deduplicate texts and validate the entire batch',()=>{
 const input=[{text:'Hello.',locale:'en-US'},{text:'Hello.',locale:'en-US'},{text:'Hello.',locale:'en-GB'}],before=structuredClone(input);
 assert.equal(A.items(input).length,2);assert.deepEqual(input,before);assert.throws(()=>A.items([...input,{text:'',locale:'en-US'}]));assert.throws(()=>A.items([]));
});
test('records bind the voice and complete source text to their cache identity',()=>{
 const text='Hello.',locale='en-GB',key=A.key(text,locale),record={key,text,locale,voice:'bf_emma',seconds:1,bytes:1000,sha256:'a'.repeat(64)};
 assert.equal(A.validateRecord(record,key),record);assert.throws(()=>A.validateRecord({...record,text:'Another sentence.'},key));assert.throws(()=>A.validateRecord({...record,voice:'af_heart'},key));assert.throws(()=>A.validateRecord({...record,seconds:500},key));
});
