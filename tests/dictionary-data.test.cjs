'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),file=fs.readFileSync(path.join(root,'web/dictionary-data.js'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'web/dictionary-manifest.json'),'utf8')),context={};
vm.runInNewContext(file.toString('utf8'),context,{timeout:5000});const data=context.DictionaryData,index=new Map(data.entries.map(e=>[e.word,e]));

test('lazy dictionary asset exactly matches its pinned manifest and is bounded',()=>{
 assert.equal(data.schema,1);assert.equal(manifest.format,'jiufen-dictionary');
 assert.equal(file.length,manifest.bytes);assert.equal(crypto.createHash('sha256').update(file).digest('hex'),manifest.sha256);
 assert.equal(data.entries.length,manifest.entryCount);assert.equal(data.entries.length,50000);assert(file.length<8*1024*1024);
 assert.equal(index.size,data.entries.length);assert.equal(manifest.withPhonetic,data.entries.filter(e=>e.phonetic).length);
 assert.deepEqual(JSON.parse(JSON.stringify(data.source)),manifest.source);
 assert.equal(manifest.source.commit,'39cfb9672c0906b63569e0453c2e6abfb9ab182a');
 assert.equal(manifest.source.sourceSha256,'d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc');
});

test('every source entry has usable Chinese text and bounded plain fields',()=>{
 for(const e of data.entries){
  assert(e.word&&e.word.length<=120);assert(/[\u3400-\u9fff]/.test(e.meaning));assert(e.meaning.length<=4000);
  assert.equal(typeof e.phonetic,'string');assert(e.phonetic.length<=500);
  assert(!/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(e.word+e.meaning+e.phonetic));
  assert(Object.keys(e).every(k=>['word','meaning','phonetic','partOfSpeech','exchange'].includes(k)));
  if(e.partOfSpeech)assert(/^[a-z. /]+$/.test(e.partOfSpeech),'POS must be labels, not corpus percentages');
 }
});

test('known words retain source meanings, transcription and inflection relations',()=>{
 assert.match(index.get('computer').meaning,/计算机|电脑/);
 assert.match(index.get('transparent').meaning,/透明/);
 assert.match(index.get('abandon').meaning,/放弃/);
 assert.match(index.get('go').exchange,/p:went/);assert.match(index.get('went').exchange,/0:go/);
 assert.equal(index.get('went').phonetic,'went');
 assert.match(index.get('presents').meaning,/礼物/);assert.equal(index.get('presents').phonetic,'','A missing form IPA cannot be copied from its base');
 assert.match(index.get('audiences').exchange,/0:audience/);
 assert.notEqual(index.get('computer').phonetic,index.get('transparent').phonetic);
});

test('the asset provides source attribution without claiming two accent-specific phonetics',()=>{
 assert.equal(data.source.license,'MIT');assert.match(data.source.phoneticLabel,/未分英美/);
 assert.match(data.source.phoneticLabel,/保留原库标记/);assert.equal(data.entries.some(e=>'phoneticUK' in e||'phoneticUS' in e),false);
 const license=fs.readFileSync(path.join(root,'web/vendor/LICENSE-ECDICT.txt'),'utf8');
 assert.match(license,/MIT License/);assert.match(license,/Copyright \(c\) 2025 Linwei/);assert.match(license,/Permission is hereby granted/);
 assert.equal(crypto.createHash('sha256').update(license).digest('hex'),'f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f');
});
