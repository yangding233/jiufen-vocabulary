(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./desktop-state.js'));else root.ContentPack=factory(root.DesktopState);})(typeof globalThis!=='undefined'?globalThis:this,function(core){
 'use strict';
 const MAX_BYTES=25*1024*1024,BAD=new Set(['__proto__','prototype','constructor']);
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
 const assert=(ok,message)=>{if(!ok)throw new Error('内容包：'+message);};
 function safe(value,depth=0){
  assert(depth<=45,'嵌套层级过深');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){assert(value.length<=12000,'文本过长');assert(!/<\s*\/?\s*[A-Za-z!][^>]*>|javascript\s*:|data\s*:\s*text\/html/i.test(value),'不允许 HTML 或可执行链接');return;}
  if(typeof value==='number'){assert(Number.isFinite(value),'无效数值');return;}
  assert(Array.isArray(value)||object(value),'只允许纯 JSON 数据');
  if(!Array.isArray(value))assert([Object.prototype,null].includes(Object.getPrototypeOf(value)),'不允许自定义对象原型');
  for(const key of Object.keys(value)){assert(!BAD.has(key),'不安全字段 '+key);safe(value[key],depth+1);}
 }
 function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
 function sha256(text){assert(core&&typeof core.sha256==='function','请先加载 desktop-state.js');return core.sha256(text);}
 function checksum(pack){const unsigned={};for(const k of Object.keys(pack))if(k!=='checksum')unsigned[k]=pack[k];return sha256(canonical(unsigned));}
 function keys(value,allowed,label){assert(object(value),label+'必须是对象');for(const k of Object.keys(value))assert(allowed.includes(k),label+'不允许字段 '+k);}
 function text(value,label,max=8000,nonempty=false){assert(typeof value==='string'&&value.length<=max&&(!nonempty||value.trim().length>0),label+'文本无效');}
 function id(value,label){text(value,label,180,true);assert(/^[A-Za-z0-9_.:@+-]+$/.test(value)&&!BAD.has(value),label+'编号无效');}
 function operations(values){assert(Array.isArray(values)&&values.length<=100,'字母变换列表无效');for(const op of values){keys(op,['kind','start','end','before','after'],'字母变换');assert(['equal','delete','insert','replace'].includes(op.kind),'字母变换类型无效');assert(Number.isSafeInteger(op.start)&&op.start>=0&&Number.isSafeInteger(op.end)&&op.end>=op.start&&op.end<=240,'字母变换位置无效');text(op.before,'变换前',240);text(op.after,'变换后',240);}}
 function parts(values,target){
  assert(Array.isArray(values)&&values.length>0&&values.length<=40,'拆分片段数量无效');
  for(const p of values){keys(p,['text','cue','from','operations','change'],'片段');text(p.text,'实际片段',240);assert(p.text.length>0,'实际片段为空');text(p.cue,'片段提示',2000,true);if(own(p,'from'))text(p.from,'借词',240,true);if(own(p,'change'))text(p.change,'借词操作',2000);if(own(p,'operations'))operations(p.operations);
   if(p.from&&p.operations){let result='',cursor=0;for(const op of p.operations){assert(op.start===cursor&&p.from.slice(op.start,op.end)===op.before,'片段借词变换位置不连续或内容不符');result+=op.after;cursor=op.end;}assert(cursor===p.from.length&&result===p.text,'片段借词变换不能还原目标');}
  }
  if(target!==undefined)assert(values.map(p=>p.text).join('').toLowerCase()===target.toLowerCase(),'实际片段不能精确拼出 '+target);
 }
 function memory(value,word){
  keys(value,['kind','family','anchor','parts','baseParts','scene','focus','related','reference','status','version','contentVersion','base','target','operations','cueWord','baseMeaning','baseScene','spellingSteps'],'巧记');
  for(const [k,v] of Object.entries(value)){
   if(['parts','baseParts','operations','spellingSteps','related','version'].includes(k))continue;
   text(v,'巧记 '+k,k==='scene'||k==='baseScene'?10000:8000);
  }
  if(own(value,'parts')&&value.parts.length)parts(value.parts,word);else if(own(value,'parts'))assert(Array.isArray(value.parts),'parts 必须是数组');
  if(value.baseParts?.length)parts(value.baseParts,value.cueWord||value.base);else if(own(value,'baseParts'))assert(Array.isArray(value.baseParts),'baseParts 必须是数组');
  if(own(value,'operations')){
   operations(value.operations);assert(typeof value.base==='string'&&typeof value.target==='string'&&value.target.toLowerCase()===word.toLowerCase(),'变形方案必须指定本词');
   let result='',cursor=0;for(const op of value.operations){assert(op.start===cursor&&value.base.slice(op.start,op.end)===op.before,'整词变换位置不连续或内容不符');result+=op.after;cursor=op.end;}
   assert(cursor===value.base.length&&result.toLowerCase()===word.toLowerCase(),'整词变换不能还原本词');
  }
  assert((value.parts&&value.parts.length)||(value.operations&&value.operations.length),'巧记缺少可检查的实际字母');
  if(own(value,'version'))assert(Number.isSafeInteger(value.version)&&value.version>=0&&value.version<=10000,'巧记版本无效');
  if(own(value,'related')){assert(Array.isArray(value.related)&&value.related.length<=40,'相关词无效');for(const name of value.related)text(name,'相关词',240,true);}
  if(own(value,'spellingSteps')){assert(Array.isArray(value.spellingSteps)&&value.spellingSteps.length<=40,'变形步骤无效');for(const step of value.spellingSteps){keys(step,['from','to','change','meaning'],'变形步骤');for(const [k,v] of Object.entries(step))text(v,'变形步骤 '+k,4000);}}
 }
 function expectedMap(words){
  if(words===undefined||words===null)return null;
  if(words instanceof Map)return new Map([...words].map(([k,v])=>[k,typeof v==='string'?v:v.word]));
  assert(Array.isArray(words),'校验词表必须是数组或 Map');return new Map(words.map(w=>[w.id,w.word]));
 }
 function validate(pack,expectedWords){
  safe(pack);keys(pack,['format','schema','version','createdAt','entries','checksum'],'顶层');
  assert(pack.format==='jiufen-content'&&pack.schema===1,'格式或 schema 不兼容');
  assert(typeof pack.version==='string'&&/^\d{4}-\d{2}-\d{2}(?:\.\d{1,6})?$/.test(pack.version),'版本应为日期或日期.修订号');
  const date=pack.version.slice(0,10);assert(!isNaN(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date,'版本日期无效');
  assert(typeof pack.createdAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(pack.createdAt)&&!isNaN(Date.parse(pack.createdAt)),'创建时间无效');
  assert(Array.isArray(pack.entries)&&pack.entries.length>=1&&pack.entries.length<=10000,'词条数量须为 1 至 10000');
  const expected=expectedMap(expectedWords),ids=new Set(),names=new Set();
  for(const entry of pack.entries){
   keys(entry,['id','word','memory','alternatives','usage'],'词条');id(entry.id,'词条');text(entry.word,'英文',120,true);
   assert(!ids.has(entry.id)&&!names.has(entry.word.toLowerCase()),'重复词条');ids.add(entry.id);names.add(entry.word.toLowerCase());
   if(expected)assert(expected.get(entry.id)===entry.word,'词条编号或英文不属于当前词库：'+entry.id);
   assert(own(entry,'memory')||own(entry,'alternatives')||own(entry,'usage'),'词条没有内容');
   if(own(entry,'memory'))memory(entry.memory,entry.word);
   if(own(entry,'alternatives')){assert(Array.isArray(entry.alternatives)&&entry.alternatives.length>=1&&entry.alternatives.length<=5,'备选巧记数量无效');const choices=new Set();for(const a of entry.alternatives){keys(a,['id','label','parts','scene','focus','reference'],'备选巧记');id(a.id,'方案');assert(!choices.has(a.id),'重复方案编号');choices.add(a.id);text(a.label,'方案名称',100,true);parts(a.parts,entry.word);text(a.scene,'方案场景',8000,true);for(const k of ['focus','reference'])if(own(a,k))text(a[k],'方案 '+k,4000);}}
   if(own(entry,'usage')){keys(entry.usage,['sentence','translation','collocations'],'用法');for(const k of ['sentence','translation'])if(own(entry.usage,k))text(entry.usage[k],'用法 '+k,2000,true);if(own(entry.usage,'collocations')){assert(Array.isArray(entry.usage.collocations)&&entry.usage.collocations.length<=12,'搭配数量无效');for(const v of entry.usage.collocations)text(v,'搭配',300,true);}}
  }
  assert(typeof pack.checksum==='string'&&/^[a-f0-9]{64}$/.test(pack.checksum)&&pack.checksum===checksum(pack),'校验和不符');
  const serialized=JSON.stringify(pack);assert(new TextEncoder().encode(serialized).length<=MAX_BYTES,'大小超过 25 MB');return JSON.parse(serialized);
 }
 function create(entries,version,options={}){safe(entries);const pack={format:'jiufen-content',schema:1,version,createdAt:options.createdAt||version.slice(0,10)+'T00:00:00.000Z',entries:JSON.parse(JSON.stringify(entries))};pack.checksum=checksum(pack);return validate(pack,options.expectedWords);}
 function choose(a,b,expectedWords){
  const first=a==null?null:validate(a,expectedWords),second=b==null?null:validate(b,expectedWords);if(!first)return second;if(!second)return first;
  if(first.version===second.version){assert(first.checksum===second.checksum,'同版本内容冲突，请换用明确的新版本');return first;}
  const av=first.version.split(/[.-]/).map(Number),bv=second.version.split(/[.-]/).map(Number);for(let i=0;i<Math.max(av.length,bv.length);i++){if((av[i]||0)!==(bv[i]||0))return (av[i]||0)>(bv[i]||0)?first:second;}
  // Different spelling of the same version (date vs date.0) is still deterministic.
  return first.version>second.version?first:second;
 }
 return {validate,create,choose,checksum,canonical,sha256,MAX_BYTES,version:1};
});
