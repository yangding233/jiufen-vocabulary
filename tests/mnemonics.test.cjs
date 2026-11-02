'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8');
const words=JSON.parse(html.match(/<script id="vocabulary-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
test('all 1,493 regular entries have useful authored cues and retain their catalogue identity',()=>{
 assert.equal(words.length,1493);assert.equal(new Set(words.map(w=>w.id)).size,1493);
 for(const [i,w] of words.entries()){
  assert.equal(w.catalogueOrder,i);assert.equal(w.id,'jf-'+String(i+1).padStart(4,'0'));
  assert(w.phonetic.trim(),w.word);assert(w.meaning.trim(),w.word);
  const m=w.memory;assert(!['待补巧记','形近对照候选'].includes(m.kind),w.word);
  assert(!/暂未提供|自行联想|此处没有单独词义资料|盯住改变的一处字母/.test(m.anchor+' '+m.scene),w.word);
  assert(m.anchor.trim()&&m.scene.trim(),w.word);
  const parts=m.parts?.length?m.parts:m.baseParts;
  assert(parts?.length,w.word+' has no spelling cue');assert(parts.every(p=>p.text&&p.cue.trim()),w.word);
  assert.equal(parts.map(p=>p.text).join('').toLowerCase(),(m.parts?.length?w.word:m.cueWord).toLowerCase(),w.word);
 }
 assert.equal(JSON.parse(html.match(/<script id="portable-state" type="application\/json">([\s\S]*?)<\/script>/)[1]),null);
 const footer=html.match(/<footer class="page-footer small muted">([\s\S]*?)<\/footer>/)[1];assert(!/待补|候选/.test(footer));assert.match(footer,/2026-11-03/);
});
test('derived-word lessons have reversible operations and an acyclic path ending at the actual word',()=>{
 for(const w of words.filter(w=>w.memory.kind==='熟词变形')){
  const m=w.memory;assert(m.spellingSteps.length,w.word);
  const path=[m.spellingSteps[0].from,...m.spellingSteps.map(s=>s.to)].map(x=>x.toLowerCase());
  assert.equal(new Set(path).size,path.length,w.word+' circular cue path');
  assert.equal(path.at(-1),w.word.toLowerCase());assert.equal(path[0],m.cueWord.toLowerCase());
  for(let i=1;i<m.spellingSteps.length;i++)assert.equal(m.spellingSteps[i-1].to.toLowerCase(),m.spellingSteps[i].from.toLowerCase(),w.word);
  for(const op of m.operations)assert.equal(m.base.slice(op.start,op.end),op.before,w.word);
  assert.equal(m.operations.map(op=>op.after).join('').toLowerCase(),w.word.toLowerCase(),w.word);
 }
});
