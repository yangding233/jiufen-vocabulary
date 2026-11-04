(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./wordbooks.js'));else root.Materials=factory(root.WordBooks);})(typeof globalThis!=='undefined'?globalThis:this,function(WordBooks){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),clone=x=>typeof structuredClone==='function'?structuredClone(x):JSON.parse(JSON.stringify(x));
 const BAD=new Set(['__proto__','constructor','prototype']);
 const assert=(ok,msg)=>{if(!ok)throw new Error('学习资料：'+msg);};
 const idOK=x=>typeof x==='string'&&x.length>0&&x.length<180&&/^[A-Za-z0-9_.:@+-]+$/.test(x)&&!BAD.has(x);
 const LEXICAL_FIELDS=['meaning','phonetic','sentence','translation','partOfSpeech','phoneticUK','phoneticUS','source','tags'];
 const MATERIAL_FIELDS=['schemes','collocations'];
 function canonical(x){return Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);}
 function safe(x,depth=0){assert(depth<30,'嵌套过深');if(typeof x==='number')assert(Number.isFinite(x),'无效数值');if(x&&typeof x==='object'){assert(Array.isArray(x)||[Object.prototype,null].includes(Object.getPrototypeOf(x)),'只接受普通数据');for(const k of Object.keys(x)){assert(!BAD.has(k),'不安全字段');safe(x[k],depth+1);}}}
 function keys(x,allowed,label){assert(object(x),label+'必须为对象');for(const k of Object.keys(x))assert(allowed.includes(k),label+'有未知字段 '+k);}
 function text(x,label,max=4000,required=false){assert(typeof x==='string'&&x.length<=max&&(!required||x.trim()),label+'文本无效');assert(!/<\s*\/?[A-Za-z!][^>]*>|javascript\s*:|data\s*:\s*text\/html/i.test(x),label+'只接受纯文本');}
 function validateSchemes(schemes,word){
  safe(schemes);assert(Array.isArray(schemes)&&schemes.length<=5,'每词最多五条巧记');const ids=new Set();
  for(const s of schemes){keys(s,['id','label','kind','anchor','parts','scene','focus','reference'],'巧记');assert(idOK(s.id)&&!ids.has(s.id),'巧记编号重复或无效');ids.add(s.id);for(const k of ['label','kind','anchor','scene','focus','reference'])if(own(s,k))text(s[k],k,k==='scene'?8000:4000,['anchor','scene'].includes(k));assert(typeof s.anchor==='string'&&s.anchor.trim()&&typeof s.scene==='string'&&s.scene.trim(),'巧记需填写熟悉线索和联想画面');
   assert(Array.isArray(s.parts)&&s.parts.length<=40,'片段格式无效');
   if(s.parts.length){
    for(const p of s.parts){keys(p,['text','cue','from','operations','change'],'片段');text(p.text,'字母片段',240);assert(p.text.length>0,'字母片段为空');text(p.cue,'片段提示',2000,!/^\s+$/.test(p.text));if(own(p,'from'))text(p.from,'借用熟词',240,true);if(own(p,'change'))text(p.change,'变换说明',2000);
     if(own(p,'operations')){assert(typeof p.from==='string','变换步骤需要借用熟词');assert(Array.isArray(p.operations)&&p.operations.length>0&&p.operations.length<=100,'变换步骤格式无效');let cursor=0,result='';for(const op of p.operations){keys(op,['kind','start','end','before','after'],'变换步骤');assert(['equal','delete','insert','replace'].includes(op.kind)&&Number.isInteger(op.start)&&Number.isInteger(op.end)&&op.start===cursor&&op.end>=op.start&&op.end<=p.from.length,'变换步骤位置无效');text(op.before,'变换前',240);text(op.after,'变换后',240);assert(p.from.slice(op.start,op.end)===op.before,'变换前字母不符');if(op.kind==='equal')assert(op.before===op.after,'相同片段不能修改字母');if(op.kind==='delete')assert(op.after==='','删除操作不能插入字母');if(op.kind==='insert')assert(op.start===op.end&&op.before==='','插入操作不能删除字母');cursor=op.end;result+=op.after;}assert(cursor===p.from.length&&result===p.text,'借词步骤不能还原片段');}
    }
    assert(s.parts.map(p=>p.text).join('')===word,'片段必须按顺序精确还原完整拼写（含大小写、空格和连接符）');
   }
  }
  return schemes;
 }
 function validateEntry(value,word){keys(value,MATERIAL_FIELDS,'资料');if(own(value,'schemes'))validateSchemes(value.schemes,word);if(own(value,'collocations')){assert(Array.isArray(value.collocations)&&value.collocations.length<=12,'搭配数量无效');for(const x of value.collocations)text(x,'搭配',300,true);}return value;}
 function ensure(state){if(!state.materials)state.materials={schema:1,entries:{},batches:{}};return state.materials;}
 function entry(state,id){return clone(state.materials?.entries?.[id]||{});}
 function set(state,id,fields){assert(idOK(id),'词条编号无效');const w=state.words.find(w=>w.id===id);assert(w,'找不到词条');keys(fields,MATERIAL_FIELDS,'资料');const value={...entry(state,id),...clone(fields)};validateEntry(value,w.word);ensure(state).entries[id]=value;return value;}
 function updateWord(state,id,fields){
  safe(fields);keys(fields,[...LEXICAL_FIELDS,...MATERIAL_FIELDS],'修改资料');const word=state.words.find(w=>w.id===id);assert(word,'找不到词条');const lexical={},material={};for(const [field,value] of Object.entries(fields)){if(LEXICAL_FIELDS.includes(field)){text(value,field,field==='phonetic'||field==='phoneticUK'||field==='phoneticUS'?500:4000);lexical[field]=value;}else material[field]=clone(value);}
  validateEntry({...entry(state,id),...material},word.word);
  const changedPhonetic=own(lexical,'phonetic')&&lexical.phonetic!==word.phonetic;
  if(Object.keys(lexical).length)WordBooks.setContent(state,id,lexical);
  if(changedPhonetic){delete word.phoneticNote;delete word.phoneticSource;}
  if(Object.keys(material).length)set(state,id,material);
  return state;
 }
 function validate(state){
  if(state.materials===undefined)return state;const m=state.materials;safe(m);keys(m,['schema','entries','batches'],'资料库');assert(m.schema===1&&object(m.entries)&&object(m.batches),'资料库版本无效');const words=new Map(state.words.map(w=>[w.id,w.word]));assert(Object.keys(m.entries).length<=10000&&Object.keys(m.batches).length<=1000,'资料条目或任务过多');for(const [id,value] of Object.entries(m.entries)){assert(words.has(id),'资料引用未知词条');validateEntry(value,words.get(id));}for(const [id,batch] of Object.entries(m.batches)){assert(idOK(id)&&object(batch)&&JSON.stringify(batch).length<=2000000,'资料任务编号或大小无效');}return state;
 }
 function missing(word,material={},options={}){const fields=[];if(!word.meaning?.trim())fields.push('meaning');if(!word.phonetic?.trim())fields.push('phonetic');if(!material.schemes?.length&&!options.hasMemory)fields.push('schemes');if(!word.sentence?.trim())fields.push('sentence');if(!options.hasAudio)fields.push('audio');return fields;}
 function digest(value){const serialized=canonical(value);let a=2166136261,b=5381;for(let i=0;i<serialized.length;i++){a=Math.imul(a^serialized.charCodeAt(i),16777619);b=Math.imul(b,33)^serialized.charCodeAt(i);}return 'm1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
 function fingerprint(state,id,context=null){const word=state.words.find(w=>w.id===id);assert(word,'找不到词条');const value={id,word:word.word};for(const key of LEXICAL_FIELDS)value[key]=word[key]||'';value.materials=state.materials?.entries?.[id]||{};if(context!==null)value.context=context;return digest(value);}
 return {ensure,entry,set,updateWord,validate,validateEntry,validateSchemes,missing,fingerprint,digest,canonical,LEXICAL_FIELDS,MATERIAL_FIELDS,version:1};
});
