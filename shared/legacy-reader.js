(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./desktop-state.js'),require('./learning-tools.js'),()=>require('./content-pack.js'),require('./wordbooks.js'));else root.LegacyReader=factory(root.DesktopState,root.LearningTools,()=>root.ContentPack,root.WordBooks);})(typeof globalThis!=='undefined'?globalThis:this,function(desktop,learningTools,contentPack,wordbooks){
 'use strict';
 const MAX_BYTES=50*1024*1024,MAX_OPS=100000,FORMAT='jiufen-usb';
 const LEARNING=['seen','due','interval','streak','lastGrade','lastScheduledDay','learnedOn','lastSeen','reviewCount','lapses','mastered','masteryUpdatedAt'];
 const PERSONAL=['planned','suspended','favorite','note','memoryAnchor','memoryScene','rejectBuiltinCue','legacyGrade','cueChoice','cueFeedback'];
 const SETTINGS=['dailyTarget','mode','dailyLists','dailyNew','studyDays','targetDate','fontSize','audioRate','adaptiveReview'];
 const {validateState,validateEvent,sha256,canonical,safeTree}=desktop;
 const BAD=new Set(['__proto__','prototype','constructor']);
 const copy=x=>typeof structuredClone==='function'?structuredClone(x):JSON.parse(JSON.stringify(x));
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const equal=(a,b)=>canonical(a)===canonical(b);
 const idOK=x=>typeof x==='string'&&x.length>0&&x.length<180&&!BAD.has(x)&&/^[A-Za-z0-9_.:@+-]+$/.test(x);
 const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 const ordered=d=>[...d.operations].sort((a,b)=>a.lamport-b.lamport||a.deviceId.localeCompare(b.deviceId)||a.seq-b.seq||a.id.localeCompare(b.id));
 function validateDocument(d){
  assert(object(d)&&d.format===FORMAT&&[1,2].includes(d.schema)&&idOK(d.profileId)&&idOK(d.deviceId),'不是兼容的同步文档。');safeTree(d);assert(d.schema===2||d.baseline?.library===undefined,'词书档案需要新版格式。');validateState(d.baseline);assert(typeof d.baselineHash==='string'&&sha256(canonical(d.baseline))===d.baselineHash,'同步起点校验失败。');assert(Array.isArray(d.operations)&&d.operations.length<=MAX_OPS,'操作数过多。');
  const ids=new Map(),seqs=new Set(),events=new Map(d.baseline.history.map(e=>[e.id,e]));for(const op of d.operations){assert(object(op)&&idOK(op.id)&&idOK(op.deviceId)&&Number.isSafeInteger(op.seq)&&op.seq>0&&Number.isSafeInteger(op.lamport)&&op.lamport>0&&object(op.context),'同步操作编号无效。');assert(typeof op.at==='string'&&!isNaN(Date.parse(op.at)),'操作时间无效。');for(const [k,v] of Object.entries(op.context))assert(idOK(k)&&Number.isSafeInteger(v)&&v>=0,'因果版本无效。');assert((op.context[op.deviceId]||0)===op.seq-1,'设备序号不连续。');assert(!ids.has(op.id),'重复的操作编号。');ids.set(op.id,op);const pair=op.deviceId+':'+op.seq;assert(!seqs.has(pair),'设备操作序号冲突。');seqs.add(pair);
   if(op.kind==='event'){validateEvent(op.event);assert(!events.has(op.event.id)||equal(events.get(op.event.id),op.event),'同一反馈编号对应不同内容。');events.set(op.event.id,op.event);}
   else if(op.kind==='undo'){assert(idOK(op.eventId),'撤销编号无效。');if(op.restoreLearning!==undefined)assert(idOK(op.restoreWordId)&&object(op.restoreLearning)&&Object.keys(op.restoreLearning).every(k=>LEARNING.includes(k)),'撤销恢复字段无效。');}
   else if(op.kind==='card-set')assert(idOK(op.wordId)&&PERSONAL.includes(op.field),'个人字段无效。');
   else if(op.kind==='learning-set')assert(idOK(op.wordId)&&object(op.values)&&Object.keys(op.values).every(k=>LEARNING.includes(k)),'学习恢复字段无效。');
   else if(op.kind==='setting-set')assert(SETTINGS.includes(op.field),'设置字段无效。');
   else if(op.kind==='word-add')assert(object(op.word)&&idOK(op.word.id)&&object(op.card),'新增词无效。');
   else if(op.kind==='word-set')assert(idOK(op.wordId)&&op.wordId.startsWith('custom:')&&['word','meaning','phonetic','sentence','group'].includes(op.field),'词条修改字段无效。');
   else if(op.kind==='library-set'){assert(d.schema===2&&wordbooks,'词书同步需要新版程序。');wordbooks.validateOperation(op);}
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
 function materialize(document){
  validateDocument(document);const s=copy(document.baseline),ops=ordered(document),cancelled=new Set(ops.filter(o=>o.kind==='undo').map(o=>o.eventId));
  if(document.schema===2&&!s.library)s.library=wordbooks.empty();
  for(const o of ops)if(o.kind==='undo'&&o.restoreLearning&&o.restoreWordId&&s.cards[o.restoreWordId])for(const k of LEARNING)if(Object.hasOwn(o.restoreLearning,k))s.cards[o.restoreWordId][k]=copy(o.restoreLearning[k]);
  s.history=s.history.filter(e=>!cancelled.has(e.id));const eventIds=new Set(s.history.map(e=>e.id));
  // Distinct offline devices can upload older learning days after newer ones.
  // Field edits use causal order; feedback replays by study day, then causal order within that day.
  const eventOps=ops.filter(o=>o.kind==='event').sort((a,b)=>a.event.day.localeCompare(b.event.day)||a.lamport-b.lamport||a.deviceId.localeCompare(b.deviceId)||a.seq-b.seq);
  for(const op of [...ops.filter(o=>o.kind!=='event'),...eventOps]){
   if(op.kind==='word-add'){const known=s.words.find(w=>w.id===op.word.id||(document.schema===1&&w.word.toLowerCase()===op.word.word.toLowerCase()));assert(!known||known.id===op.word.id,'两端新增同名词存在编号冲突，请先处理。');assert(!known||known.word===op.word.word,'同一词条编号对应不同拼写，请核对导入资料。');if(!known){s.words.push(copy(op.word));s.cards[op.word.id]=copy(op.card);}continue;}
   if(op.kind==='library-set'){wordbooks.applyOperation(s,op);continue;}
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
    if(scheduled){assert(learningTools&&typeof learningTools.nextSchedule==='function','请先加载 learning-tools.js。');Object.assign(c,learningTools.nextSchedule(c,e));c.due=addDays(e.day,c.interval);c.lastScheduledDay=e.day;c.seen=true;if(!c.learnedOn)c.learnedOn=e.day;}
    c.lastGrade=e.grade;c.lastSeen=e.at;c.updatedAt=op.at;c.reviewCount++;
   }
   e.nextDue=c.due;e.interval=c.interval;s.history.push(e);
  }
  // Keep exact local UI on ordinary saves; a merge explicitly clears stale undo/session below.
  if(document.localState)for(const [k,v] of Object.entries(document.localState))s[k]=copy(v);
  if(s.session){const tail=s.session.queue.slice(s.session.cursor).filter(q=>s.cards[q.id]&&(s.session.kind==='free'||!s.cards[q.id].mastered));s.session.queue=[...s.session.queue.slice(0,s.session.cursor),...tail];}
  wordbooks.applyOverrides(s);validateState(s);return s;
 }
 function packetExtras(extras){
  assert(object(extras)&&Object.keys(extras).every(k=>['clientProtocol','contentPack'].includes(k)),'同步扩展字段无效。');safeTree(extras);
  if(extras.clientProtocol!==undefined)assert(Number.isSafeInteger(extras.clientProtocol)&&[1,2,3].includes(extras.clientProtocol),'客户端同步协议不兼容。');
  if(extras.contentPack!==undefined&&extras.contentPack!==null){const api=contentPack();assert(api&&typeof api.validate==='function','请先加载 content-pack.js。');api.validate(extras.contentPack);}
  return extras;
 }
 const byteLength=text=>typeof TextEncoder!=='undefined'?new TextEncoder().encode(text).length:unescape(encodeURIComponent(text)).length;
 function decodePacket(text){assert(typeof text==='string'&&text.length<=MAX_BYTES*2+1024,'同步包过大或不是文本。');let e;try{e=JSON.parse(text);}catch(_){throw new Error('同步包不是有效 JSON。');}safeTree(e);assert(object(e)&&e.format==='jiufen-usb-packet'&&e.schema===1&&e.algorithm==='sha256'&&typeof e.payload==='string'&&byteLength(e.payload)<=MAX_BYTES,'同步包格式无效。');assert(sha256(e.payload)===e.checksum,'同步包校验失败，原记录未改动。');let p;try{p=JSON.parse(e.payload);}catch(_){throw new Error('同步包内容无效。');}safeTree(p);assert(object(p)&&idOK(p.batchId)&&Object.keys(p).every(k=>['document','batchId','clientProtocol','contentPack'].includes(k)),'同步批次或字段无效。');const extras={};for(const k of ['clientProtocol','contentPack'])if(Object.hasOwn(p,k))extras[k]=p[k];packetExtras(extras);assert(p.document?.schema!==2||(p.clientProtocol??3)>=3,'词书资料需要新版同步协议。');validateDocument(p.document);materialize(p.document);return p;}
 function documentState(input){if(typeof input==='string'){const parsed=JSON.parse(input);input=parsed.format==='jiufen-usb-packet'?decodePacket(input).document:parsed;}if(input?.format==='jiufen-usb-packet')input=decodePacket(JSON.stringify(input)).document;return materialize(input);}
 return {validateDocument,materialize,decodePacket,documentState,version:1};
});
