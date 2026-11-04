'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../shared/materials.js'),D=require('../shared/desktop-state.js');
const fixtures=require('./fixtures/legacy-documents.json');
const initial=()=>structuredClone(fixtures[0].expected);
const scheme=(word='alpha')=>({id:'scheme:1',label:'熟词线索',kind:'人为助记',anchor:'按真实字母搭桥',parts:[{text:word,cue:'目标字母'}],scene:'在卡片上联系目标词义',focus:'还原 '+word,reference:'原创助记'});

test('manual materials and lexical edits retain historical learning and snapshot roundtrip',()=>{
 const s=initial(),cards=structuredClone(s.cards),history=structuredClone(s.history);
 M.updateWord(s,'jf-0',{meaning:'用户义项',phonetic:'/ˈælfə/',sentence:'Alpha comes first.',translation:'阿尔法排在第一。',schemes:[scheme()],collocations:['alpha particle']});
 assert.deepEqual(s.cards,cards);assert.deepEqual(s.history,history);assert.equal(s.words[0].meaning,'用户义项');assert.equal(s.library.overrides['jf-0'].sentence,'Alpha comes first.');
 const reopened=D.documentState(D.createDocument(s,'test-pc','old-profile'));assert.deepEqual(reopened.materials,s.materials);assert.deepEqual(M.entry(reopened,'jf-0').schemes,[scheme()]);
 const detached=M.entry(s,'jf-0');detached.schemes[0].scene='outside';assert.notEqual(M.entry(s,'jf-0').schemes[0].scene,'outside');
});

test('simple personal cue is allowed but placeholder does not falsely complete an empty material entry',()=>{
 const s=initial();M.set(s,'jf-0',{schemes:[{...scheme(),parts:[]}],collocations:[]});M.validate(s);
 assert(!M.missing(s.words[0],M.entry(s,'jf-0'),{hasAudio:true}).includes('schemes'));
 assert(M.missing({meaning:'',phonetic:'',sentence:''},{}).includes('schemes'));
 assert(!M.missing(s.words[0],{}, {hasMemory:true,hasAudio:true}).includes('schemes'));
});

test('structured spelling checks preserve phrase spaces and verify actual borrowed letters',()=>{
 const phrase={...scheme('a radio'),parts:[{text:'a',cue:'冠词'},{text:' ',cue:''},{text:'radio',cue:'收音机'}]};M.validateSchemes([phrase],'a radio');
 assert.throws(()=>M.validateSchemes([phrase],'a  radio'),/精确还原/);
 const changed={...scheme('age'),parts:[{text:'age',cue:'cage 去 c',from:'cage',change:'删去开头 c',operations:[{kind:'delete',start:0,end:1,before:'c',after:''},{kind:'equal',start:1,end:4,before:'age',after:'age'}]}]};M.validateSchemes([changed],'age');
 changed.parts[0].operations[0].after='x';assert.throws(()=>M.validateSchemes([changed],'age'),/删除操作/);
 assert.throws(()=>M.validateSchemes([scheme('Alpha')],'alpha'),/大小写/);
});

test('invalid or executable materials are rejected before a word can be partially edited',()=>{
 const s=initial(),before=structuredClone(s);
 for(const fields of [{meaning:'new',schemes:[scheme('other')]},{word:'other'},{sentence:'<script>bad</script>'},JSON.parse('{"__proto__":{}}')]){
  assert.throws(()=>M.updateWord(s,'jf-0',fields));assert.deepEqual(s,before);
 }
 M.ensure(s).entries.unknown={schemes:[]};assert.throws(()=>D.validateState(s),/未知词条/);
});

test('content fingerprint ignores cards and histories but follows material and lexical changes',()=>{
 const s=initial(),first=M.fingerprint(s,'jf-0');s.cards['jf-0'].note='private';s.cards['jf-0'].favorite=false;s.history.pop();assert.equal(M.fingerprint(s,'jf-0'),first);
 M.set(s,'jf-0',{schemes:[scheme()]});assert.notEqual(M.fingerprint(s,'jf-0'),first);const second=M.fingerprint(s,'jf-0');s.words[0].meaning='另一义项';assert.notEqual(M.fingerprint(s,'jf-0'),second);
});

test('desktop saves validate chosen wordbook scope without changing legacy default settings',()=>{
 const s=initial();D.validateState(s);const books=require('../shared/wordbooks.js').view(s).books;s.settings.studyBooks=[Object.keys(books)[0]];D.validateState(s);
 s.settings.studyBooks=['book:unknown'];assert.throws(()=>D.validateState(s),/范围/);s.settings.studyBooks=null;D.validateState(s);
});

test('replacing phonetic text drops inherited accent/source labels but an unchanged value retains them',()=>{
 const s=initial();s.words[0].phoneticNote='英式分词读音参考';s.words[0].phoneticSource='旧库';
 M.updateWord(s,'jf-0',{phonetic:s.words[0].phonetic});assert.equal(s.words[0].phoneticNote,'英式分词读音参考');
 M.updateWord(s,'jf-0',{phonetic:'/ˈælfə/'});assert.equal(s.words[0].phoneticNote,undefined);assert.equal(s.words[0].phoneticSource,undefined);
 assert.match(M.fingerprint(s,'jf-0'),/^m1-[a-f0-9]{16}$/);
});
