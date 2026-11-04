(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WordBooks=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o),copy=o=>JSON.parse(JSON.stringify(o));
 const BAD=new Set(['__proto__','prototype','constructor']);
 const idOK=x=>typeof x==='string'&&x.length>0&&x.length<180&&!BAD.has(x)&&/^[A-Za-z0-9_.:@+-]+$/.test(x);
 const assert=(x,m)=>{if(!x)throw new Error('词书：'+m);};
 const CONTENT=['meaning','phonetic','sentence','translation','phoneticUS','phoneticUK','partOfSpeech','source','tags'];
 const normalized=x=>String(x).normalize('NFC').trim().replace(/\s+/g,' ');
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 function checkTree(x,depth=0){assert(depth<30,'嵌套过深');if(x&&typeof x==='object'){for(const k of Object.keys(x)){assert(!BAD.has(k),'不安全字段');checkTree(x[k],depth+1);}}}
 function legacyId(group){let a=2166136261,b=5381;for(const ch of group){a=Math.imul(a^ch.codePointAt(0),16777619);b=Math.imul(b,33)^ch.codePointAt(0);}return 'book:legacy:'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16);}
 function empty(){return {schema:1,books:{},members:{},batches:{},overrides:{}};}
 function view(state){
  if(state.library)return copy(state.library);
  const lib=empty();
  for(const [order,w] of state.words.entries()){
   const builtin=/^(?:builtin:)?jf-/.test(w.id),id=builtin?'book:jiufen':legacyId(w.group||'我的补充词');
   if(!own(lib.books,id)){lib.books[id]={id,name:builtin?'九分常规词表':w.group||'我的补充词',createdAt:'2026-10-28T00:00:00.000Z',archived:false,builtin};lib.members[id]={};}
   lib.members[id][w.id]={wordId:w.id,chapter:w.group||'',order};
  }
  return lib;
 }
 function ensure(state){if(!state.library)state.library=view(state);return state.library;}
 function createBook(state,options){
  assert(object(options)&&idOK(options.id),'词书编号无效');const lib=ensure(state),name=String(options.name||'').trim();assert(name.length>0&&name.length<=80,'名称须为1至80字');
  if(own(lib.books,options.id)){assert(lib.books[options.id]!==null,'此词书已移除');return lib.books[options.id];}
  lib.books[options.id]={id:options.id,name,createdAt:options.createdAt||new Date().toISOString(),archived:false,builtin:false};lib.members[options.id]={};return lib.books[options.id];
 }
 function addMember(state,bookId,wordId,options={}){
  assert(idOK(bookId)&&idOK(wordId),'词书或词条编号无效');const lib=ensure(state);assert(own(lib.books,bookId)&&lib.books[bookId]&&!lib.books[bookId].archived,'找不到可用词书');assert(state.words.some(w=>w.id===wordId),'找不到词条');
  if(!own(lib.members,bookId))lib.members[bookId]={};
  const member={wordId,chapter:String(options.chapter||''),order:options.order??Object.values(lib.members[bookId]).filter(Boolean).length};
  assert(member.chapter.length<=120&&Number.isSafeInteger(member.order)&&member.order>=0,'章节或顺序无效');lib.members[bookId][wordId]=member;return member;
 }
 function removeMember(state,bookId,wordId){assert(idOK(bookId)&&idOK(wordId),'词书或词条编号无效');const lib=ensure(state);assert(own(lib.books,bookId)&&lib.books[bookId],'找不到词书');if(!own(lib.members,bookId))lib.members[bookId]={};lib.members[bookId][wordId]=null;}
 function setContent(state,wordId,fields){
  assert(idOK(wordId),'词条编号无效');const lib=ensure(state),word=state.words.find(w=>w.id===wordId);assert(word,'找不到词条');assert(object(fields),'资料无效');if(!own(lib.overrides,wordId))lib.overrides[wordId]={};
  for(const [field,value] of Object.entries(fields)){assert(CONTENT.includes(field)&&typeof value==='string'&&value.length<=4000,'资料字段或长度无效');lib.overrides[wordId][field]=value;word[field]=value;}
 }
 function applyOverrides(state){if(state.library){const words=new Map(state.words.map(w=>[w.id,w]));for(const [id,fields] of Object.entries(state.library.overrides)){const word=words.get(id);if(word&&fields)for(const [key,value] of Object.entries(fields))word[key]=value;}}return state;}
 function validateOperation(op){
  assert(object(op)&&['books','members','batches','overrides'].includes(op.section)&&idOK(op.key),'词书操作无效');
  if(['members','overrides'].includes(op.section))assert(op.section==='members'?idOK(op.field):CONTENT.includes(op.field),'词书操作字段无效');else assert(op.field===undefined,'词书操作有多余字段');
  checkTree(op.value);if(op.section==='overrides')assert(typeof op.value==='string'&&op.value.length<=4000,'词条资料无效');
  if(op.section==='books'&&op.value!==null)assert(object(op.value)&&op.value.id===op.key,'词书内容无效');
  if(op.section==='members'&&op.value!==null)assert(object(op.value)&&op.value.wordId===op.field,'词书成员无效');
  if(op.section==='batches'&&op.value!==null)assert(object(op.value)&&op.value.id===op.key,'导入批次无效');return op;
 }
 function validate(state){
  if(state.library===undefined)return state;
  const lib=state.library;checkTree(lib);assert(object(lib)&&lib.schema===1&&Object.keys(lib).every(k=>['schema','books','members','batches','overrides'].includes(k)),'资料版本无效');
  for(const section of ['books','members','batches','overrides'])assert(object(lib[section]),'缺少'+section);
  assert(Object.keys(lib.books).length<=2000&&Object.keys(lib.batches).length<=5000,'词书或导入批次过多');
  const ids=new Set(state.words.map(w=>w.id));let memberCount=0;
  for(const [id,book] of Object.entries(lib.books)){assert(idOK(id),'词书编号无效');if(book===null)continue;assert(object(book)&&book.id===id&&typeof book.name==='string'&&book.name.trim()&&book.name.length<=80&&typeof book.createdAt==='string'&&!isNaN(Date.parse(book.createdAt))&&typeof book.archived==='boolean'&&(book.builtin===undefined||typeof book.builtin==='boolean'),'词书内容无效');}
  for(const [bookId,members] of Object.entries(lib.members)){assert(idOK(bookId)&&own(lib.books,bookId)&&object(members),'词书成员表无效');for(const [wordId,m] of Object.entries(members)){memberCount++;assert(idOK(wordId)&&ids.has(wordId),'词书引用未知词条');if(m===null)continue;assert(object(m)&&m.wordId===wordId&&typeof m.chapter==='string'&&m.chapter.length<=120&&Number.isSafeInteger(m.order)&&m.order>=0,'词书成员无效');}}
  assert(memberCount<=100000,'词书成员数量过多');
  for(const [id,batch] of Object.entries(lib.batches)){assert(idOK(id),'导入批次编号无效');if(batch===null)continue;assert(object(batch)&&batch.id===id&&JSON.stringify(batch).length<=2000000,'导入批次内容无效');}
  for(const [id,fields] of Object.entries(lib.overrides)){assert(ids.has(id)&&object(fields),'资料引用未知词条');for(const [field,value] of Object.entries(fields))assert(CONTENT.includes(field)&&typeof value==='string'&&value.length<=4000,'词条资料无效');}
  return state;
 }
 function diff(before,after){
  const result=[],a=before.library||empty(),b=after.library||empty();
  for(const section of ['books','batches'])for(const key of new Set([...Object.keys(a[section]),...Object.keys(b[section])])){const av=a[section][key]??null,bv=b[section][key]??null;if(canonical(av)!==canonical(bv))result.push({kind:'library-set',section,key,value:copy(bv)});}
  for(const section of ['members','overrides'])for(const key of new Set([...Object.keys(a[section]),...Object.keys(b[section])]))for(const field of new Set([...Object.keys(a[section][key]||{}),...Object.keys(b[section][key]||{})])){const av=a[section][key]?.[field]??(section==='overrides'?'':null),bv=b[section][key]?.[field]??(section==='overrides'?'':null);if(canonical(av)!==canonical(bv)||(section==='overrides'&&!own(a[section][key]||{},field)&&own(b[section][key]||{},field)))result.push({kind:'library-set',section,key,field,value:copy(bv)});}
  return result;
 }
 function applyOperation(state,op){validateOperation(op);if(!state.library)state.library=empty();const lib=state.library;if(op.section==='members'||op.section==='overrides'){if(!own(lib[op.section],op.key))lib[op.section][op.key]={};lib[op.section][op.key][op.field]=copy(op.value);}else lib[op.section][op.key]=copy(op.value);}
 function duplicates(state){const groups=new Map();for(const w of state.words){const key=normalized(w.word).toLocaleLowerCase('en');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(w);}return [...groups.values()].filter(ws=>ws.length>1).map(words=>({word:words[0].word,wordIds:words.map(w=>w.id),words:copy(words)}));}
 function wordsInBook(state,bookId){const lib=view(state);return Object.values(lib.members[bookId]||{}).filter(Boolean).sort((a,b)=>a.order-b.order||a.wordId.localeCompare(b.wordId)).map(m=>state.words.find(w=>w.id===m.wordId)).filter(Boolean);}
 return {view,ensure,empty,createBook,addMember,removeMember,setContent,applyOverrides,validate,validateOperation,diff,applyOperation,duplicates,wordsInBook,normalized,CONTENT,version:1};
});
