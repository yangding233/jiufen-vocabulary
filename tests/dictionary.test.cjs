'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const D=require('../shared/dictionary'),B=require('../shared/wordbooks');
const data={schema:1,source:{id:'ecdict',name:'ECDICT 社区英汉词典',version:'fixture-v1',url:'https://github.com/skywind3000/ECDICT',license:'MIT',phoneticLabel:'词典音标（未分英美）'},entries:[
 {word:'audience',meaning:'n. 观众；听众',phonetic:'ˈɔːdiəns',partOfSpeech:'n.'},
 {word:'US',meaning:'美国',phonetic:'ˌjuːˈes'},
 {word:'walk',meaning:'v. 步行',phonetic:'wɔːk',partOfSpeech:'v.',exchange:'d:walked/p:walked/3:walks/i:walking'},
 {word:'gone',meaning:'a. 离去的',phonetic:'',exchange:'0:go'},
 {word:'go',meaning:'v. 去',phonetic:'ɡəʊ',partOfSpeech:'v.'},
 {word:'a radio program',meaning:'广播节目',phonetic:'/ə ˈreɪdiəʊ ˈprəʊɡræm/'},
 {word:'lead',meaning:'v. 领导',phonetic:'liːd'},
 {word:'lead',meaning:'n. 铅',phonetic:'led'}
]};
const index=D.create(data);
function state(word='audience',fields={}){return {words:[{id:'custom:one',word,group:'测试',meaning:'',phonetic:'',sentence:'',source:'',...fields}],cards:{'custom:one':{seen:true,mastered:false,due:'2026-11-08',note:'用户笔记'}},history:[{id:'event-1',wordId:'custom:one'}]};}
const preview=(s,options={})=>D.preview(s,['custom:one'],{index,...options});
test('exact dictionary values are candidates, normalization keeps phrases and unknown accent is not invented',()=>{
 const found=D.lookup(' a   radio program ',{index});assert.equal(found.status,'exact');assert.equal(found.candidates[0].phonetic,'/ə ˈreɪdiəʊ ˈprəʊɡræm/');
 const c=D.lookup('audience',{index}).candidates[0];assert.equal(c.phonetic,'/ˈɔːdiəns/');assert.match(c.source.phoneticLabel,/未分英美/);assert(!Object.hasOwn(c,'phoneticUK'));assert(!Object.hasOwn(c,'phoneticUS'));
 c.meaning='外部修改';assert.match(D.lookup('audience',{index}).candidates[0].meaning,/观众/);
});
test('preview only fills missing selected fields and never mutates the words, cards, history or index input',()=>{
 const s=state('audience',{meaning:'观众',source:'我的课堂资料'}),before=structuredClone(s),original=structuredClone(data);
 const p=preview(s),row=p.rows[0];assert.deepEqual(row.changes,{phonetic:'/ˈɔːdiəns/'});assert.deepEqual(row.protectedFields,['meaning']);assert(p.canApply);assert.equal(p.stats.changedFields,1);
 assert.deepEqual(s,before);assert.deepEqual(data,original);assert.match(row.warnings.join(' '),/原释义已保留/);assert.equal(row.provenance.phonetic.version,'fixture-v1');
 const source=D.sourceFor(row);assert(source.startsWith('我的课堂资料\n[词典补全]'));assert.match(source,/ECDICT/);
});
test('independent field switches and explicit replacement are required for nonempty content',()=>{
 const s=state('audience',{meaning:'用户自己的词义',phonetic:'/personal/'});
 const ordinary=preview(s,{decisions:{'custom:one':{fields:{meaning:true,phonetic:true}}}});assert.deepEqual(ordinary.rows[0].changes,{});
 const p=preview(s,{decisions:{'custom:one':{fields:{meaning:true,phonetic:false,partOfSpeech:true},replaceFields:['meaning']}}});
 assert.deepEqual(p.rows[0].changes,{meaning:'n. 观众；听众',partOfSpeech:'n.'});assert(!p.rows[0].changes.phonetic);
});
test('case mismatches and ambiguous exact entries need an explicit candidate',()=>{
 const s=state('us'),p=preview(s);assert.equal(p.rows[0].status,'review');assert.deepEqual(p.rows[0].changes,{});assert.equal(p.canApply,false);
 const candidate=p.rows[0].candidates[0],accepted=preview(s,{decisions:{'custom:one':{candidateId:candidate.id}}});assert.equal(accepted.rows[0].status,'ready');assert.equal(accepted.rows[0].changes.meaning,'美国');
 const lead=preview(state('lead'));assert.equal(lead.rows[0].status,'review');assert.equal(lead.rows[0].candidates.length,2);
});
test('lemma suggestions never copy a base pronunciation or definition into an inflected word',()=>{
 const s=state('walked'),p=preview(s);assert.equal(p.rows[0].status,'related');assert.equal(p.rows[0].candidates[0].word,'walk');
 const explicit=preview(s,{decisions:{'custom:one':{candidateId:p.rows[0].candidates[0].id,fields:{meaning:true,phonetic:true},replaceFields:['meaning','phonetic']}}});assert.deepEqual(explicit.rows[0].changes,{});assert.equal(D.sourceFor(explicit.rows[0]),undefined);
 const gone=preview(state('gone'));assert.equal(gone.rows[0].changes.meaning,'a. 离去的');assert(!gone.rows[0].changes.phonetic);assert(gone.rows[0].candidates.some(c=>c.match==='lemma'&&c.word==='go'));
});
test('known same-spelling multiple readings need an explicit phonetic checkbox without inferring the user sense',()=>{
 const readings=D.create({...data,entries:[{word:'lead',meaning:'v. 领导；n. 铅',phonetic:'li:d'}]});
 const s=state('lead',{meaning:'铅'}),row=preview(s,{index:readings}).rows[0];
 assert.equal(row.status,'review');assert.deepEqual(row.changes,{});assert.match(row.warnings.join(' '),/词性、词义或时态可能影响读音/);
 const explicit=preview(s,{index:readings,decisions:{'custom:one':{fields:{phonetic:true}}}}).rows[0];assert.equal(explicit.changes.phonetic,'/li:d/');assert(!explicit.changes.meaning);assert.match(explicit.warnings.join(' '),/核对后采用/);
 const missingMeaning=preview(state('lead'),{index:readings}).rows[0];assert.equal(missingMeaning.changes.meaning,'v. 领导；n. 铅');assert(!missingMeaning.changes.phonetic);
 const builtinWords=[{id:'jf-lead',word:'lead',meaning:'项目核对词义',phonetic:'/project/'}];assert.equal(preview(s,{index:readings,builtinWords}).rows[0].changes.phonetic,'/project/');
});
test('one unavailable word does not block valid rows; uncollected entries stay pending',()=>{
 const s=state();s.words.push({...s.words[0],id:'custom:missing',word:'notinfixture'});
 const p=D.preview(s,['custom:one','custom:missing'],{index});assert(p.canApply);assert.equal(p.stats.ready,1);assert.equal(p.stats.missing,1);assert.deepEqual(p.rows[1].changes,{});
 const skip=preview(state(),{decisions:{'custom:one':{skip:true}}});assert.equal(skip.rows[0].status,'skipped');assert.equal(skip.canApply,false);
});
test('builtin data is preferred for exact matches and never automatically matches a different case',()=>{
 const builtinWords=[{id:'jf-test',word:'audience',meaning:'内置观众',phonetic:'/builtin/'}];const p=preview(state(),{builtinWords});assert.equal(p.rows[0].selectedCandidateId,'builtin:jf-test');assert.equal(p.rows[0].changes.phonetic,'/builtin/');
 assert.equal(preview(state('Audience'),{builtinWords}).rows[0].status,'review');
});
test('large previews reuse per-preview builtin indexes without mutating inputs or sharing candidate source objects',()=>{
 const builtinWords=Array.from({length:1493},(_,i)=>({id:'jf-'+i,word:i?'builtin word '+i:'audience',meaning:'内置释义',phonetic:'/builtin/'}));
 const before=JSON.stringify(builtinWords),s={words:Array.from({length:10000},(_,i)=>({id:'custom:'+i,word:'audience',meaning:'',phonetic:''}))};
 const stateBefore=JSON.stringify(s),p=D.preview(s,s.words.map(w=>w.id),{index,builtinWords});
 assert.equal(p.rows.length,10000);assert.equal(p.stats.ready,10000);assert(p.rows.every(row=>row.selectedCandidateId==='builtin:jf-0'));
 assert.equal(JSON.stringify(builtinWords),before);assert.equal(JSON.stringify(s),stateBefore);
 p.rows[0].candidates[0].source.name='只修改这一行';assert.equal(p.rows[1].candidates[0].source.name,'项目内置词表');
 // A subsequent preview reflects changed caller input: no stale cross-preview cache.
 builtinWords[0].phonetic='/new builtin/';assert.equal(D.preview(s,[s.words[0].id],{index,builtinWords}).rows[0].changes.phonetic,'/new builtin/');
});
test('applying a preview preserves progress and repeated enrichment has no source churn',()=>{
 const s=state('audience',{source:'旧来源'}),cards=structuredClone(s.cards),history=structuredClone(s.history),row=preview(s).rows[0];
 B.setContent(s,row.wordId,{...row.changes,source:D.sourceFor(row)});const next=preview(s).rows[0];
 assert.deepEqual(s.cards,cards);assert.deepEqual(s.history,history);assert.deepEqual(next.changes,{});assert.equal(D.sourceFor(next),undefined);assert.equal(next.status,'complete');
 const already={...row,before:{...row.before,source:D.sourceFor(row)}};assert.equal(D.sourceFor(already),D.sourceFor(row));
 const full={...row,before:{...row.before,source:'x'.repeat(4000)}};assert.equal(D.sourceFor(full),undefined);assert(row.provenance.meaning.url);
});
test('snapshots detect source/content changes without reading learning history',()=>{
 const w=state().words[0],old=D.snapshot(w);assert.equal(D.snapshot({...w}),old);assert.notEqual(D.snapshot({...w,meaning:'后来编辑'}),old);assert.notEqual(D.snapshot({...w,source:'来源更新'}),old);
});
test('older source phonetic marks are retained and flagged instead of silently converted to a claimed accent',()=>{
 const legacy=D.create({...data,entries:[{word:'computer',meaning:'n. 计算机',phonetic:"kәm'pju:tә"}]});
 const row=preview(state('computer'),{index:legacy}).rows[0];assert.equal(row.changes.phonetic,"/kәm'pju:tә/");assert.match(row.warnings.join(' '),/旧式标记/);assert.match(row.provenance.phonetic.phoneticLabel,/原库标记/);assert(!row.changes.phoneticUK);assert(!row.changes.phoneticUS);
});
test('malformed data, frequency-pos, invalid decisions and unknown IDs are refused',()=>{
 assert.throws(()=>D.create({...data,entries:[{word:'x',partOfSpeech:'n:46/v:54'}]}),/频率/);
 assert.throws(()=>D.create({...data,source:{...data.source,url:'javascript:bad'}}),/网址/);
 assert.throws(()=>preview(state(),{decisions:{'custom:one':{fields:{audio:true}}}}),/字段/);
 assert.throws(()=>preview(state(),{decisions:{'custom:one':{candidateId:'missing'}}}),/不存在/);
 assert.throws(()=>D.preview(state(),['unknown'],{index}),/找不到/);
 assert.throws(()=>D.lookup('word',{index:null}),/尚未载入/);
});
test('UMD dictionary engine runs in the offline browser without require or network',()=>{
 const context=vm.createContext({console});vm.runInContext(fs.readFileSync(require.resolve('../shared/dictionary'),'utf8'),context);
 assert.equal(vm.runInContext('typeof Dictionary.create',context),'function');vm.runInContext('var fixture='+JSON.stringify(data)+';var idx=Dictionary.create(fixture);',context);assert.equal(vm.runInContext("Dictionary.lookup('audience',{index:idx}).status",context),'exact');
});
