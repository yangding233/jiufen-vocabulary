(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OfflineSync=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_BYTES=50*1024*1024,MAX_OPS=100000,FORMAT='jiufen-usb';
 const LEARNING=['seen','due','interval','streak','lastGrade','lastScheduledDay','learnedOn','lastSeen','reviewCount','lapses','mastered','masteryUpdatedAt'];
 const PERSONAL=['planned','suspended','favorite','note','memoryAnchor','memoryScene','rejectBuiltinCue','legacyGrade'];
 const SETTINGS=['dailyTarget','mode','dailyLists','dailyNew','studyDays','targetDate'];
 const BAD=new Set(['__proto__','prototype','constructor']);
 const copy=x=>JSON.parse(JSON.stringify(x));
 const equal=(a,b)=>canonical(a)===canonical(b);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const idOK=x=>typeof x==='string'&&x.length>0&&x.length<180&&!BAD.has(x)&&/^[A-Za-z0-9_.:@+-]+$/.test(x);
 const dayOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
 const uuid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const now=()=>new Date().toISOString();
 const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 function safeTree(x,depth=0){assert(depth<80,'数据嵌套过深。');if(x&&typeof x==='object'){for(const k of Object.keys(x)){assert(!BAD.has(k),'数据包含不安全字段。');safeTree(x[k],depth+1);}}else if(typeof x==='number')assert(Number.isFinite(x),'数据包含无效数字。');}
 function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
 // SHA-256 on UTF-8 text; integrity only. USB pairing/authentication is provided by the host.
 function sha256(text){
  const bytes=typeof TextEncoder!=='undefined'?new TextEncoder().encode(text):Uint8Array.from(unescape(encodeURIComponent(text)),c=>c.charCodeAt(0));
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const padded=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);padded.set(bytes);padded[bytes.length]=128;const view=new DataView(padded.buffer);view.setUint32(padded.length-8,Math.floor(bytes.length/0x20000000));view.setUint32(padded.length-4,(bytes.length*8)>>>0);
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rot=(a,n)=>(a>>>n)|(a<<(32-n));
  for(let offset=0;offset<padded.length;offset+=64){for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const s0=rot(w[i-15],7)^rot(w[i-15],18)^(w[i-15]>>>3),s1=rot(w[i-2],17)^rot(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const s1=rot(e,6)^rot(e,11)^rot(e,25),ch=(e&f)^(~e&g),t1=(z+s1+ch+k[i]+w[i])>>>0,s0=rot(a,2)^rot(a,13)^rot(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);}
  return h.map(x=>x.toString(16).padStart(8,'0')).join('');
 }
 function validateState(s){
  assert(object(s)&&s.schema===2&&s.app==='jiufen-mnemonic-learning','不是兼容的学习记录。');safeTree(s);
  assert(Array.isArray(s.words)&&s.words.length>0&&s.words.length<=10000&&object(s.cards)&&object(s.settings),'词库或设置无效。');
  const ids=new Set(),names=new Set();for(const w of s.words){assert(object(w)&&idOK(w.id)&&!ids.has(w.id)&&typeof w.word==='string'&&w.word.length>0&&w.word.length<=120,'词条无效或重复。');const name=w.word.normalize('NFKC').trim().toLowerCase();assert(!names.has(name),'词条拼写重复。');ids.add(w.id);names.add(name);assert(typeof w.meaning==='string'&&w.meaning.length<=4000&&typeof w.phonetic==='string'&&typeof w.sentence==='string'&&typeof w.group==='string','词条字段无效。');const c=s.cards[w.id];assert(object(c)&&['seen','planned','suspended','favorite'].every(k=>typeof c[k]==='boolean'),'逐词状态无效。');assert(c.mastered===undefined||typeof c.mastered==='boolean','熟知状态无效。');assert(c.due===null||dayOK(c.due),'复习日期无效。');assert(!c.seen||c.mastered||dayOK(c.due),'已学词缺少日期。');assert(!c.mastered||(c.seen&&c.due===null),'熟知状态与日期冲突。');for(const k of ['streak','interval','reviewCount','lapses'])assert(Number.isSafeInteger(c[k])&&c[k]>=0&&(k!=='interval'||c[k]<=365),'逐词数值无效。');for(const k of ['note','memoryAnchor','memoryScene'])assert(c[k]===undefined||(typeof c[k]==='string'&&c[k].length<=4000),'笔记内容无效。');}
  assert(Object.keys(s.cards).length===ids.size,'词条与卡片不匹配。');
  const timeOK=x=>x===null||(typeof x==='string'&&!isNaN(Date.parse(x)));
  assert(Number.isSafeInteger(s.revision)&&s.revision>=0&&s.revision<=1e12&&typeof s.writer==='string'&&s.updatedAt!==null&&timeOK(s.updatedAt),'本机版本或保存时间无效。');
  for(const c of Object.values(s.cards)){
   for(const k of ['lastGrade','legacyGrade'])assert(c[k]===null||['again','hard','good'].includes(c[k]),'反馈标记无效。');
   for(const k of ['lastScheduledDay','learnedOn'])assert(c[k]===null||dayOK(c[k]),'学习日期无效。');
   for(const k of ['updatedAt','lastSeen'])assert(timeOK(c[k]),'卡片时间无效。');
   for(const k of ['memoryAnchor','memoryScene'])assert(c[k]===undefined||c[k].length<=2000,'个人巧记超过2000字。');
  }
  assert(Array.isArray(s.history)&&s.history.length<=500000,'历史记录过多。');const events=new Set();for(const e of s.history){validateEvent(e);assert(ids.has(e.wordId)&&!events.has(e.id),'反馈词条未知或编号重复。');events.add(e.id);}
  assert(['mnemonic','context','cloze','meaning'].includes(s.settings.mode),'回忆模式无效。');for(const [k,min,max] of [['dailyTarget',1,500],['dailyNew',0,500],['dailyLists',1,6]])if(s.settings[k]!==undefined)assert(Number.isSafeInteger(s.settings[k])&&s.settings[k]>=min&&s.settings[k]<=max,'学习量无效。');if(s.settings.studyDays!==undefined)assert(Array.isArray(s.settings.studyDays)&&s.settings.studyDays.length>0&&s.settings.studyDays.length<=7&&new Set(s.settings.studyDays).size===s.settings.studyDays.length&&s.settings.studyDays.every(x=>Number.isInteger(x)&&x>=0&&x<=6),'学习日无效。');if(s.settings.targetDate)assert(dayOK(s.settings.targetDate),'目标日期无效。');
  assert(object(s.meta)&&object(s.baseline)&&dayOK(s.baseline.date)&&Array.isArray(s.baseline.ids)&&s.baseline.ids.length<=10000&&new Set(s.baseline.ids).size===s.baseline.ids.length&&s.baseline.ids.every(id=>ids.has(id))&&typeof s.baseline.source==='string','记录元信息无效。');
  assert(Number.isSafeInteger(s.settings.dailyTarget)&&s.settings.dailyTarget>=1&&s.settings.dailyTarget<=500,'复习参考量无效。');
  assert(timeOK(s.meta.lastBackupAt)&&Number.isSafeInteger(s.meta.migrated)&&s.meta.migrated>=0&&s.meta.migrated<=10000,'备份信息无效。');
  if(s.session!==null){const x=s.session;assert(object(x)&&Array.isArray(x.queue)&&x.queue.length<=200000&&Number.isInteger(x.cursor)&&x.cursor>=0&&x.cursor<=x.queue.length&&x.queue.every(q=>ids.has(q.id)&&['new','review','repeat','free'].includes(q.kind)),'任务断点无效。');assert(dayOK(x.day)&&['schedule','free'].includes(x.kind)&&typeof x.shown==='boolean'&&typeof x.typed==='string','任务断点字段无效。');}
  return s;
 }
 function validateEvent(e){assert(object(e)&&idOK(e.id)&&idOK(e.wordId)&&dayOK(e.day)&&typeof e.at==='string'&&!isNaN(Date.parse(e.at)),'反馈记录无效。');assert(['new','review','repeat','free','mastery'].includes(e.kind),'反馈类型无效。');assert(e.kind==='mastery'?['mastered','restore'].includes(e.grade):['again','hard','good'].includes(e.grade),'反馈值无效。');assert((e.nextDue===null||dayOK(e.nextDue))&&Number.isSafeInteger(e.interval)&&e.interval>=0&&e.interval<=365,'反馈日期/间隔无效。');}
 function validateDocument(d){
  assert(object(d)&&d.format===FORMAT&&d.schema===1&&idOK(d.profileId)&&idOK(d.deviceId),'不是兼容的同步文档。');safeTree(d);validateState(d.baseline);assert(typeof d.baselineHash==='string'&&sha256(canonical(d.baseline))===d.baselineHash,'同步起点校验失败。');assert(Array.isArray(d.operations)&&d.operations.length<=MAX_OPS,'操作数过多。');
  const ids=new Map(),seqs=new Set(),events=new Map(d.baseline.history.map(e=>[e.id,e]));for(const op of d.operations){assert(object(op)&&idOK(op.id)&&idOK(op.deviceId)&&Number.isSafeInteger(op.seq)&&op.seq>0&&Number.isSafeInteger(op.lamport)&&op.lamport>0&&object(op.context),'同步操作编号无效。');assert(typeof op.at==='string'&&!isNaN(Date.parse(op.at)),'操作时间无效。');for(const [k,v] of Object.entries(op.context))assert(idOK(k)&&Number.isSafeInteger(v)&&v>=0,'因果版本无效。');assert((op.context[op.deviceId]||0)===op.seq-1,'设备序号不连续。');assert(!ids.has(op.id),'重复的操作编号。');ids.set(op.id,op);const pair=op.deviceId+':'+op.seq;assert(!seqs.has(pair),'设备操作序号冲突。');seqs.add(pair);
   if(op.kind==='event'){validateEvent(op.event);assert(!events.has(op.event.id)||equal(events.get(op.event.id),op.event),'同一反馈编号对应不同内容。');events.set(op.event.id,op.event);}
   else if(op.kind==='undo'){assert(idOK(op.eventId),'撤销编号无效。');if(op.restoreLearning!==undefined)assert(idOK(op.restoreWordId)&&object(op.restoreLearning)&&Object.keys(op.restoreLearning).every(k=>LEARNING.includes(k)),'撤销恢复字段无效。');}
   else if(op.kind==='card-set')assert(idOK(op.wordId)&&PERSONAL.includes(op.field),'个人字段无效。');
   else if(op.kind==='learning-set')assert(idOK(op.wordId)&&object(op.values)&&Object.keys(op.values).every(k=>LEARNING.includes(k)),'学习恢复字段无效。');
   else if(op.kind==='setting-set')assert(SETTINGS.includes(op.field),'设置字段无效。');
   else if(op.kind==='word-add')assert(object(op.word)&&idOK(op.word.id)&&object(op.card),'新增词无效。');
   else if(op.kind==='word-set')assert(idOK(op.wordId)&&op.wordId.startsWith('custom:')&&['word','meaning','phonetic','sentence','group'].includes(op.field),'词条修改字段无效。');
   else if(op.kind==='meta-set')assert(['lastBackupAt'].includes(op.field),'元信息字段无效。');
   else if(op.kind==='baseline-set')assert(object(op.value),'导入补记无效。');
   else throw new Error('未知同步操作。');
  }
  // Every dependency must be present; packets are full operation sets, not arbitrary partial logs.
  const byDevice={};for(const o of d.operations){if(!byDevice[o.deviceId])byDevice[o.deviceId]=new Map();byDevice[o.deviceId].set(o.seq,o);}
  for(const o of d.operations)for(const [device,n] of Object.entries(o.context))if(n){const parent=byDevice[device]?.get(n);assert(parent&&parent.lamport<o.lamport,'同步操作依赖缺失或顺序无效。');}
  if(d.localState!==undefined){assert(object(d.localState),'本机视图无效。');for(const k of Object.keys(d.localState))assert(['session','undo','dailyPlan','revision','writer','updatedAt'].includes(k),'本机视图字段无效。');}
  return d;
 }
 const ordered=d=>[...d.operations].sort((a,b)=>a.lamport-b.lamport||a.deviceId.localeCompare(b.deviceId)||a.seq-b.seq||a.id.localeCompare(b.id));
 const vector=d=>{const v={};for(const op of d.operations)v[op.deviceId]=Math.max(v[op.deviceId]||0,op.seq);return v;};
 const sees=(a,b)=>(a.context[b.deviceId]||0)>=b.seq;
 function localState(s){const o={};for(const k of ['session','undo','dailyPlan','revision','writer','updatedAt'])o[k]=copy(s[k]===undefined?null:s[k]);return o;}
 function createDocument(state,deviceId=uuid()) {validateState(state);assert(idOK(deviceId),'设备编号无效。');const base=copy(state);return {format:FORMAT,schema:1,profileId:uuid(),deviceId,baseline:base,baselineHash:sha256(canonical(base)),operations:[],localState:localState(base),conflicts:[],createdAt:now()};}
 function emit(d,data){const ctx=vector(d),seq=(ctx[d.deviceId]||0)+1,lamport=1+d.operations.reduce((n,o)=>Math.max(n,o.lamport),0);const op={...copy(data),id:d.deviceId+':'+seq,deviceId:d.deviceId,seq,lamport,context:ctx,at:now()};d.operations.push(op);return op;}
 function record(document,before,after){
  validateDocument(document);validateState(before);validateState(after);const d=copy(document),oldEvents=new Map(before.history.map(e=>[e.id,e])),newEvents=new Map(after.history.map(e=>[e.id,e])),affected=new Set(),undoneWords=new Set();
  const oldWords=new Map(before.words.map(w=>[w.id,w]));for(const w of after.words){if(!oldWords.has(w.id))emit(d,{kind:'word-add',word:w,card:after.cards[w.id]});else if(w.id.startsWith('custom:'))for(const k of ['word','meaning','phonetic','sentence','group'])if(!equal(w[k],oldWords.get(w.id)[k]))emit(d,{kind:'word-set',wordId:w.id,field:k,value:w[k]});}
  for(const e of after.history)if(!oldEvents.has(e.id)){emit(d,{kind:'event',event:e});affected.add(e.wordId);}else assert(equal(e,oldEvents.get(e.id)),'历史记录不能原地修改；请撤销后新增。');
  for(const e of before.history)if(!newEvents.has(e.id)){const op={kind:'undo',eventId:e.id};if(document.baseline.history.some(x=>x.id===e.id)&&before.undo?.eventId===e.id){op.restoreWordId=e.wordId;op.restoreLearning={};for(const k of LEARNING)if(before.undo.card[k]!==undefined)op.restoreLearning[k]=before.undo.card[k];}emit(d,op);affected.add(e.wordId);undoneWords.add(e.wordId);}
  for(const w of after.words){const b=before.cards[w.id],a=after.cards[w.id];if(!b)continue;for(const k of PERSONAL)if(!undoneWords.has(w.id)&&!equal(a[k],b[k]))emit(d,{kind:'card-set',wordId:w.id,field:k,value:a[k]===undefined?null:a[k]});if(!affected.has(w.id)){const values={};for(const k of LEARNING)if(!equal(a[k],b[k]))values[k]=a[k]===undefined?null:a[k];if(Object.keys(values).length)emit(d,{kind:'learning-set',wordId:w.id,values});}}
  for(const k of SETTINGS)if(!equal(before.settings[k],after.settings[k]))emit(d,{kind:'setting-set',field:k,value:after.settings[k]===undefined?null:after.settings[k]});
  if(!equal(before.baseline,after.baseline))emit(d,{kind:'baseline-set',value:after.baseline});
  if(!equal(before.meta.lastBackupAt,after.meta.lastBackupAt))emit(d,{kind:'meta-set',field:'lastBackupAt',value:after.meta.lastBackupAt});
  d.localState=localState(after);d.conflicts=conflicts(d);validateDocument(d);return d;
 }
 function target(op){return op.kind==='card-set'?'card:'+op.wordId+':'+op.field:op.kind==='setting-set'?'setting:'+op.field:op.kind==='word-set'?'word:'+op.wordId+':'+op.field:null;}
 function conflicts(d){const writes=new Map();for(const op of ordered(d)){const key=target(op);if(key){if(!writes.has(key))writes.set(key,[]);writes.get(key).push(op);}}const result=[];for(const [key,ops] of writes){const maximal=ops.filter(a=>!ops.some(b=>a!==b&&sees(b,a)));if(maximal.length>1&&new Set(maximal.map(o=>canonical(o.value))).size>1){const ids=maximal.map(o=>o.id).sort();result.push({id:sha256(key+'|'+ids.join('|')).slice(0,24),target:key,kind:maximal[0].kind,wordId:maximal[0].wordId||null,field:maximal[0].field,versions:maximal.map(o=>({operationId:o.id,deviceId:o.deviceId,value:copy(o.value),at:o.at})),chosenOperationId:maximal[maximal.length-1].id});}}return result;}
 function resolveConflict(document,conflictId,value){validateDocument(document);const c=conflicts(document).find(x=>x.id===conflictId);assert(c,'冲突已变化，请重新载入。');const d=copy(document);emit(d,{kind:c.kind,wordId:c.wordId||undefined,field:c.field,value});d.conflicts=conflicts(d);validateState(materialize(d));return d;}
 function materialize(document){
  validateDocument(document);const s=copy(document.baseline),ops=ordered(document),cancelled=new Set(ops.filter(o=>o.kind==='undo').map(o=>o.eventId));
  for(const o of ops)if(o.kind==='undo'&&o.restoreLearning&&o.restoreWordId&&s.cards[o.restoreWordId])for(const k of LEARNING)if(Object.hasOwn(o.restoreLearning,k))s.cards[o.restoreWordId][k]=copy(o.restoreLearning[k]);
  s.history=s.history.filter(e=>!cancelled.has(e.id));const eventIds=new Set(s.history.map(e=>e.id));
  // Distinct offline devices can upload older learning days after newer ones.
  // Field edits use causal order; feedback replays by study day, then causal order within that day.
  const eventOps=ops.filter(o=>o.kind==='event').sort((a,b)=>a.event.day.localeCompare(b.event.day)||a.lamport-b.lamport||a.deviceId.localeCompare(b.deviceId)||a.seq-b.seq);
  for(const op of [...ops.filter(o=>o.kind!=='event'),...eventOps]){
   if(op.kind==='word-add'){const known=s.words.find(w=>w.id===op.word.id||w.word.toLowerCase()===op.word.word.toLowerCase());assert(!known||known.id===op.word.id,'两端新增同名词存在编号冲突，请先处理。');if(!known){s.words.push(copy(op.word));s.cards[op.word.id]=copy(op.card);}continue;}
   if(op.kind==='card-set'){assert(s.cards[op.wordId],'个人修改引用了未知词。');s.cards[op.wordId][op.field]=copy(op.value);s.cards[op.wordId].updatedAt=op.at;continue;}
   if(op.kind==='word-set'){const w=s.words.find(w=>w.id===op.wordId);assert(w,'词条修改引用了未知词。');w[op.field]=copy(op.value);continue;}
   if(op.kind==='learning-set'){const c=s.cards[op.wordId];assert(c,'学习恢复引用了未知词。');for(const k of LEARNING)if(Object.hasOwn(op.values,k))c[k]=copy(op.values[k]);continue;}
   if(op.kind==='setting-set'){s.settings[op.field]=copy(op.value);continue;}
   if(op.kind==='meta-set'){s.meta[op.field]=copy(op.value);continue;}
   if(op.kind==='baseline-set'){s.baseline=copy(op.value);continue;}
   if(op.kind!=='event'||cancelled.has(op.event.id))continue;
   const e=copy(op.event);if(eventIds.has(e.id))continue;const c=s.cards[e.wordId];assert(c,'反馈引用了未知词。');eventIds.add(e.id);
   if(e.kind==='mastery'){
    c.masteryUpdatedAt=op.at;c.updatedAt=op.at;
    if(e.grade==='mastered'){c.mastered=true;c.seen=true;c.due=null;c.interval=0;}
    else {c.mastered=false;c.planned=true;c.suspended=false;c.seen=true;c.due=e.day;c.interval=0;c.lastScheduledDay=null;}
   }else{
    // Only the first scheduled feedback for a word/day changes its long-term schedule.
    if(e.kind!=='free')e.kind=c.lastScheduledDay===e.day?'repeat':c.seen?'review':'new';
    const scheduled=e.kind!=='free'&&(!c.lastScheduledDay||e.day>c.lastScheduledDay)&&!c.mastered;
    if(scheduled){if(e.grade==='good'){c.streak=Math.min(c.streak+1,7);c.interval=[1,3,7,14,30,60,120][c.streak-1];}else {c.streak=e.grade==='again'?0:Math.max(0,c.streak-1);c.interval=1;if(e.grade==='again')c.lapses++;}c.due=addDays(e.day,c.interval);c.lastScheduledDay=e.day;c.seen=true;if(!c.learnedOn)c.learnedOn=e.day;}
    c.lastGrade=e.grade;c.lastSeen=e.at;c.updatedAt=op.at;c.reviewCount++;
   }
   e.nextDue=c.due;e.interval=c.interval;s.history.push(e);
  }
  // Keep exact local UI on ordinary saves; a merge explicitly clears stale undo/session below.
  if(document.localState)for(const [k,v] of Object.entries(document.localState))s[k]=copy(v);
  if(s.session){const tail=s.session.queue.slice(s.session.cursor).filter(q=>s.cards[q.id]&&(s.session.kind==='free'||!s.cards[q.id].mastered));s.session.queue=[...s.session.queue.slice(0,s.session.cursor),...tail];}
  validateState(s);return s;
 }
 function mergeDocuments(local,incoming){
  validateDocument(local);validateDocument(incoming);assert(local.profileId===incoming.profileId,'学习档案不同，需要明确执行首次配对。');assert(local.baselineHash===incoming.baselineHash,'学习档案起点不同，不能自动覆盖。');
  const d=copy(local),known=new Map(d.operations.map(o=>[o.id,o]));let remoteChanges=false;for(const op of incoming.operations){if(known.has(op.id)){assert(equal(known.get(op.id),op),'同一操作编号对应不同内容，拒绝同步。');}else{known.set(op.id,copy(op));remoteChanges=true;}}d.operations=[...known.values()];d.conflicts=conflicts(d);
  const localSession=local.localState?.session,incomingSession=incoming.localState?.session;
  const hasTask=x=>x&&x.cursor<x.queue.length;
  const adoptingTask=!hasTask(localSession)&&hasTask(incomingSession);
  if(remoteChanges||adoptingTask){
   const temp=materialize({...d,localState:local.localState});const current=adoptingTask?incomingSession:localSession;
   d.localState={...(d.localState||{}),undo:null,dailyPlan:null};
   if(current){const mergedEvents=temp.history.filter(e=>e.kind!=='mastery'),done=new Set(mergedEvents.filter(e=>e.day===current.day&&e.kind!=='free').map(e=>e.wordId));const q=current.queue.slice(current.cursor).filter(x=>temp.cards[x.id]&&!temp.cards[x.id].mastered&&(current.kind==='free'||x.kind==='repeat'&&temp.cards[x.id].lastGrade!=='good'||x.kind!=='repeat'&&!done.has(x.id)));d.localState.session={...copy(current),queue:q,cursor:0,initialCount:new Set(q.map(x=>x.id)).size,shown:false,typed:'',hintShown:false,cueSeen:false,updatedAt:now()};}
   else d.localState.session=null;
  }
  validateDocument(d);materialize(d);return d;
 }
 function adoptDocument(incoming,deviceId){validateDocument(incoming);assert(idOK(deviceId),'设备编号无效。');const d=copy(incoming);d.deviceId=deviceId;d.localState={...localState(materialize(incoming)),undo:null};return d;}
 function encodePacket(document,batchId=uuid()){validateDocument(document);assert(idOK(batchId),'同步批次编号无效。');const payload=JSON.stringify({document,batchId});assert(payload.length<=MAX_BYTES,'同步包过大。');return JSON.stringify({format:'jiufen-usb-packet',schema:1,algorithm:'sha256',checksum:sha256(payload),payload});}
 function decodePacket(text){assert(typeof text==='string'&&text.length<=MAX_BYTES*1.1,'同步包过大或不是文本。');let e;try{e=JSON.parse(text);}catch(_){throw new Error('同步包不是有效 JSON。');}safeTree(e);assert(object(e)&&e.format==='jiufen-usb-packet'&&e.schema===1&&e.algorithm==='sha256'&&typeof e.payload==='string'&&e.payload.length<=MAX_BYTES,'同步包格式无效。');assert(sha256(e.payload)===e.checksum,'同步包校验失败，原记录未改动。');let p;try{p=JSON.parse(e.payload);}catch(_){throw new Error('同步包内容无效。');}assert(object(p)&&idOK(p.batchId),'同步批次无效。');validateDocument(p.document);materialize(p.document);return p;}
 function summary(document){const s=materialize(document);return {profileId:document.profileId,deviceId:document.deviceId,operationCount:document.operations.length,wordCount:s.words.length,seen:s.words.filter(w=>s.cards[w.id].seen).length,mastered:s.words.filter(w=>s.cards[w.id].mastered).length,conflicts:conflicts(document).length,historyCount:s.history.length};}
 return {createDocument,record,materialize,mergeDocuments,adoptDocument,encodePacket,decodePacket,summary,resolveConflict,validateDocument,validateState,sha256,today,version:1};
});
