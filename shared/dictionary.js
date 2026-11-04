(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Dictionary=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const FIELDS=['meaning','phonetic','partOfSpeech'],BAD=new Set(['__proto__','prototype','constructor']);
 // Conservative review guard, not a pronunciation generator or a complete
 // heteronym dictionary. The source's one reading may not fit the user's sense.
 const READING_REVIEW=new Set(['lead','read','tear','live','wind','bow','close','record','object','content','minute','present','produce','refuse','subject','wound','contrast','digest','estimate','increase','permit','transport','use','survey']);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
 const assert=(ok,message)=>{if(!ok)throw new Error('词典补全：'+message);};
 const text=x=>String(x??'').normalize('NFC').trim();
 const normalize=x=>text(x).replace(/\s+/g,' '),fold=x=>normalize(x).toLowerCase();
 const clone=x=>JSON.parse(JSON.stringify(x));
 function safeText(value,label,max=4000){assert(typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),label+'格式或长度无效');return text(value);}
 function phonetic(value){const clean=text(value);return !clean?'':/^[\/\[]/.test(clean)?clean:'/'+clean+'/';}
 function source(value){
  assert(object(value),'缺少词典来源');
  const result={};for(const key of ['id','name','version','url','license','phoneticLabel'])result[key]=safeText(value[key]??'',key,key==='url'?2000:500);
  if(result.id==='ecdict'&&!result.phoneticLabel.includes('原库标记'))result.phoneticLabel+='；保留原库标记';
  for(const key of ['commit','sourceSha256'])if(value[key]!==undefined)result[key]=safeText(value[key],key,100);
  assert(result.id&&result.name&&result.version&&/^https:\/\//.test(result.url),'词典来源、版本或网址无效');return result;
 }
 function entry(value,id,provenance){
  assert(object(value),'词典条目无效');const word=safeText(value.word,'英文',120);assert(word,'英文为空');
  const pos=safeText(value.partOfSpeech||'','词性',500);assert(!/\d\s*[:/]|:\s*\d/.test(pos),'词性不能使用语料词性频率');
  return {id,word,meaning:safeText(value.meaning||'','释义'),phonetic:phonetic(safeText(value.phonetic||'','音标',500)),partOfSpeech:pos,exchange:safeText(value.exchange||'','词形关系',2000),source:provenance};
 }
 function push(map,key,value){if(!map.has(key))map.set(key,[]);map.get(key).push(value);}
 function exchanges(value){const out=[];for(const item of value.split('/')){const at=item.indexOf(':');if(at<1)continue;const kind=item.slice(0,at);if(!['0','p','d','i','3','r','t','s'].includes(kind))continue;for(const word of item.slice(at+1).split(',')){const name=normalize(word);if(name)out.push({kind,word:name});}}return out;}
 function create(data){
  assert(object(data)&&data.schema===1&&Array.isArray(data.entries)&&data.entries.length>0&&data.entries.length<=250000,'离线词典格式或条数无效');
  const provenance=source(data.source),exact=new Map(),similar=new Map(),related=new Map(),records=[];
  data.entries.forEach((raw,i)=>{const e=entry(raw,provenance.id+':'+i,provenance);records.push(e);push(exact,normalize(e.word),e);push(similar,fold(e.word),e);});
  for(const e of records)for(const relation of exchanges(e.exchange)){
   if(relation.kind==='0'){
    for(const base of exact.get(relation.word)||[])if(normalize(base.word)!==normalize(e.word))push(related,normalize(e.word),{entry:base,relation:'原形 '+base.word});
   }else if(normalize(relation.word)!==normalize(e.word))push(related,normalize(relation.word),{entry:e,relation:'词形来自 '+e.word});
  }
  return {source:clone(provenance),size:records.length,exact,similar,related};
 }
 function candidate(e,match,relation=''){
  const oldPhonetic=e.source.id==='ecdict'&&/[':\u0400-\u04ff]/.test(e.phonetic);
  const warnings=match==='case'?['拼写大小写不同，请明确选择后核对含义。']:match==='lemma'?['仅供原形参考，不会把原形的释义或音标直接写到本词。']:[];
  if(oldPhonetic)warnings.push('原库音标含旧式标记，仅作词典参考；未换算为现代国际音标，也未区分英美。');
  return {id:e.id,word:e.word,meaning:e.meaning,phonetic:e.phonetic,partOfSpeech:e.partOfSpeech,source:clone(e.source),match,relation,
   warnings};
 }
 function builtinEntries(words){
  assert(Array.isArray(words)&&words.length<=10000,'内置词表无效');
  const provenance={id:'builtin',name:'项目内置词表',version:'1493-2026-10-28',url:'https://github.com/yangding233/jiufen-vocabulary',license:'见项目词表来源说明',phoneticLabel:'内置词表音标（沿用原标注）'};
  const exact=new Map(),similar=new Map();for(const w of words){const e=entry(w,'builtin:'+w.id,provenance);push(exact,normalize(e.word),e);push(similar,fold(e.word),e);}return {exact,similar};
 }
 function search(query,index,builtins){
  assert(typeof query==='string'&&query.length>0&&query.length<=120,'查询单词无效');
  assert(index&&index.exact instanceof Map&&index.similar instanceof Map&&index.related instanceof Map,'离线词典尚未载入');
  const name=normalize(query),folded=fold(name),candidates=[],seen=new Set();
  function add(e,match,relation=''){const k=e.id+'|'+match;if(!seen.has(k)){seen.add(k);candidates.push(candidate(e,match,relation));}}
  for(const e of builtins.exact.get(name)||[])add(e,'exact');
  for(const e of index.exact.get(name)||[])add(e,'exact');
  for(const e of builtins.similar.get(folded)||[])if(normalize(e.word)!==name)add(e,'case');
  for(const e of index.similar.get(folded)||[])if(normalize(e.word)!==name)add(e,'case');
  for(const relation of index.related.get(name)||[])add(relation.entry,'lemma',relation.relation);
  const status=candidates.some(c=>c.match==='exact')?'exact':candidates.some(c=>c.match==='case')?'case':candidates.length?'related':'missing';
  return {query:name,status,candidates};
 }
 function lookup(query,options={}){return search(query,options.index,builtinEntries(options.builtinWords||[]));}
 function snapshot(word){assert(object(word),'词条无效');return JSON.stringify([word.id,word.word,...FIELDS.map(f=>word[f]??''),word.source??'']);}
 function preview(state,ids,options={}){
  assert(object(state)&&Array.isArray(state.words)&&Array.isArray(ids)&&ids.length<=10000,'待补词表无效');
  const words=new Map(state.words.map(w=>[w.id,w])),decisions=options.decisions||{},rows=[];
  assert(object(decisions),'选择设置无效');for(const key of Object.keys(decisions))assert(!BAD.has(key),'选择设置字段不安全');
  const builtin=builtinEntries(options.builtinWords||[]);
  const stats={total:0,ready:0,changedFields:0,complete:0,review:0,missing:0,related:0,skipped:0,unavailable:0};
  for(const id of new Set(ids)){
   const w=words.get(id);assert(w,'找不到待补词条');let decision=decisions[id]||{};if(typeof decision==='string')decision=decision==='skip'?{skip:true}:{};
   assert(object(decision)&&Object.keys(decision).every(k=>['skip','candidateId','fields','replaceFields'].includes(k)),'补全选择无效');
   const found=search(w.word,options.index,builtin);
   const row={wordId:id,word:w.word,before:{...Object.fromEntries(FIELDS.map(f=>[f,w[f]||''])),source:w.source||''},snapshot:snapshot(w),candidates:found.candidates,selectedCandidateId:null,changes:{},provenance:{},protectedFields:[],status:'missing',warnings:[]};
   stats.total++;
   if(decision.skip){row.status='skipped';stats.skipped++;rows.push(row);continue;}
   const exact=found.candidates.filter(c=>c.match==='exact'),builtins=exact.filter(c=>c.source.id==='builtin');
   let selected=decision.candidateId?found.candidates.find(c=>c.id===decision.candidateId):builtins.length===1?builtins[0]:exact.length===1?exact[0]:null;
   if(decision.candidateId)assert(selected,'所选词典候选已不存在');
   if(!selected){row.status=found.status==='missing'?'missing':found.status==='related'?'related':'review';row.warnings.push(found.status==='missing'?'离线词典未收录，保留原资料。':found.status==='related'?'仅找到原形参考，不自动填入本词。':'请明确选择匹配的词条。');stats[row.status]++;rows.push(row);continue;}
   row.selectedCandidateId=selected.id;row.warnings.push(...selected.warnings);
   if(selected.match==='lemma'){row.status='related';stats.related++;rows.push(row);continue;}
   const fields={meaning:true,phonetic:true,partOfSpeech:false,...decision.fields};
   assert(object(fields)&&Object.keys(fields).every(f=>FIELDS.includes(f))&&Object.values(fields).every(v=>typeof v==='boolean'),'补全字段选择无效');
   const readingReview=selected.source.id==='ecdict'&&READING_REVIEW.has(fold(w.word))&&Boolean(selected.phonetic);
   const withheldPhonetic=readingReview&&!text(w.phonetic||'')&&decision.fields?.phonetic!==true;
   if(readingReview){row.warnings.push('这个词的词性、词义或时态可能影响读音，需勾选音标并核对后采用。');if(decision.fields?.phonetic!==true)fields.phonetic=false;}
   const replace=decision.replaceFields||[];assert(Array.isArray(replace)&&replace.every(f=>FIELDS.includes(f)),'覆盖字段选择无效');
   for(const field of FIELDS){
    if(!fields[field]||!selected[field])continue;
    const before=text(w[field]||''),after=selected[field];if(before===after)continue;
    if(before&&!replace.includes(field)){row.protectedFields.push(field);continue;}
    row.changes[field]=after;row.provenance[field]={...clone(selected.source),candidateId:selected.id,lookupWord:selected.word,match:selected.match};
   }
   if(w.meaning&&selected.meaning&&text(w.meaning)!==selected.meaning&&row.changes.phonetic)row.warnings.push('原释义已保留；词典可能含多个词义，请核对音标是否对应当前词义和词性。');
   const count=Object.keys(row.changes).length;row.status=count?'ready':withheldPhonetic?'review':FIELDS.filter(f=>fields[f]).every(f=>text(w[f]||''))?'complete':'unavailable';
   if(row.status==='unavailable')row.warnings.push('所选词条缺少需要的资料，保持待完善。');
   stats[row.status]++;stats.changedFields+=count;rows.push(row);
  }
  return {rows,stats,canApply:stats.ready>0};
 }
 function provenanceText(row){
  const values=Object.values(row.provenance||{}),seen=new Set(),parts=[];
  for(const value of values){const key=value.id+'|'+value.version+'|'+value.lookupWord;if(seen.has(key))continue;seen.add(key);parts.push(value.name+' '+value.version+'；查询 '+value.lookupWord+'；'+value.phoneticLabel+'；'+value.url);}
  return parts.join('\n');
 }
 function sourceFor(row){
  if(!Object.keys(row.changes||{}).length)return undefined;
  const note=provenanceText(row);if(!note)return undefined;
  const previous=row.before?.source||'',addition='[词典补全] '+note;
  if(previous.includes(addition))return previous;
  const next=previous?previous+'\n'+addition:addition;
  return next.length<=4000?next:undefined;
 }
 return {create,lookup,preview,snapshot,provenanceText,sourceFor,normalize,FIELDS,version:1};
});
