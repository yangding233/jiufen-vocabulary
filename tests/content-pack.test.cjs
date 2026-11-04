const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const P=require('../shared/content-pack.js');
const entry=()=>({id:'jf-1',word:'cat',memory:{kind:'拆分巧记',parts:[{text:'c',cue:'弯曲的尾巴'},{text:'at',cue:'at，在'}],scene:'猫在桌边弯着尾巴。'},alternatives:[{id:'hat','label':'借帽子',parts:[{text:'cat',cue:'hat 的 h 换 c'}],scene:'猫戴着帽子。'}],usage:{sentence:'The cat is asleep.',translation:'猫睡着了。',collocations:['a black cat']}});
test('content JSON roundtrip, canonical checksums and explicit partial packs',()=>{
 const a=P.create([entry()],'2026-11-03.2'),b=P.create([entry()],'2026-11-03.2');assert.deepEqual(a,b);assert.equal(P.validate(a,[{id:'jf-1',word:'cat'}]).entries.length,1);const reversed=Object.fromEntries(Object.entries(a).reverse());assert.equal(P.checksum(reversed),a.checksum);const copy=P.validate(a);copy.entries[0].memory.scene='changed';assert.notEqual(copy.entries[0].memory.scene,a.entries[0].memory.scene);
});
test('content refuses executable markup, prototype pollution, lexical overwrite and mismatched spelling',()=>{
 for(const alter of [e=>e.meaning='换掉释义',e=>e.phonetic='/x/',e=>e.memory.parts[0].text='z',e=>e.usage.sentence='<img src=x onerror=alert(1)>',e=>e.usage.sentence='javascript:alert(1)',e=>e.alternatives[0].parts[0].text='dog']){const e=entry();alter(e);assert.throws(()=>P.create([e],'2026-11-03.2'));}
 const a=P.create([entry()],'2026-11-03.2');assert.throws(()=>P.validate(a,[{id:'jf-1',word:'dog'}]),/词库/);const polluted=JSON.parse(JSON.stringify(a).replace('"scene":','"__proto__":{},"scene":'));assert.throws(()=>P.validate(polluted),/不安全/);assert.throws(()=>P.create([{...entry(),extra:()=>1}],'2026-11-03.2'),/JSON/);
 const broken=JSON.parse(JSON.stringify(a));broken.entries[0].usage.sentence='Tampered';assert.throws(()=>P.validate(broken),/校验和/);
});
test('content choices are deterministic; a same-version collision cannot silently win',()=>{
 const a=P.create([entry()],'2026-11-03.2'),b=P.create([entry()],'2026-11-03.10');assert.deepEqual(P.choose(a,b),b);assert.deepEqual(P.choose(b,a),b);assert.deepEqual(P.choose(null,a),a);assert.equal(P.choose(null,null),null);const e=entry();e.memory.scene='另一幅画面';const collision=P.create([e],a.version);assert.throws(()=>P.choose(a,collision),/同版本/);
});
test('all shipped 1493 word memories are accepted without changing lexical fields',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8'),words=JSON.parse(html.match(/<script id="vocabulary-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);const pack=P.create(words.map(w=>({id:w.id,word:w.word,memory:w.memory})),'2026-11-03.2');assert.equal(pack.entries.length,1493);assert.equal(P.validate(pack,words).entries.length,1493);
});
test('browser UMD builds run without Node imports',()=>{
 const context=vm.createContext({TextEncoder,Uint8Array,Uint16Array,Uint32Array,DataView,Date,console});for(const file of ['learning-tools.js','wordbooks.js','desktop-state.js','content-pack.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared',file),'utf8'),context);
 const output=vm.runInContext("ContentPack.create([{id:'w',word:'cat',usage:{sentence:'A cat sleeps.'}}],'2026-11-03.2')",context);assert.equal(output.format,'jiufen-content');assert.equal(context.LearningTools.diffSpelling('cat','CAT').correct,true);
});
