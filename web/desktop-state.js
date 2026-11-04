(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./learning-tools.js'),require('./wordbooks.js'));else root.DesktopState=factory(root.LearningTools,root.WordBooks);})(typeof globalThis!=='undefined'?globalThis:this,function(learningTools,wordbooks){
 'use strict';
 const MAX_BYTES=50*1024*1024,FORMAT='jiufen-desktop';
 const BAD=new Set(['__proto__','prototype','constructor']);
 const copy=x=>typeof structuredClone==='function'?structuredClone(x):JSON.parse(JSON.stringify(x));
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
 // Stable SHA-256 on UTF-8 JSON, retained for content and legacy backup integrity.
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
  const ids=new Set(),names=new Set();for(const w of s.words){assert(object(w)&&idOK(w.id)&&!ids.has(w.id)&&typeof w.word==='string'&&w.word.length>0&&w.word.length<=120,'词条无效或重复。');const name=w.word.normalize('NFKC').trim().toLowerCase();assert(!names.has(name)||s.library!==undefined,'词条拼写重复。');ids.add(w.id);names.add(name);assert(typeof w.meaning==='string'&&w.meaning.length<=4000&&typeof w.phonetic==='string'&&typeof w.sentence==='string'&&typeof w.group==='string','词条字段无效。');const c=s.cards[w.id];assert(object(c)&&['seen','planned','suspended','favorite'].every(k=>typeof c[k]==='boolean'),'逐词状态无效。');assert(c.mastered===undefined||typeof c.mastered==='boolean','熟知状态无效。');assert(c.due===null||dayOK(c.due),'复习日期无效。');assert(!c.seen||c.mastered||dayOK(c.due),'已学词缺少日期。');assert(!c.mastered||(c.seen&&c.due===null),'熟知状态与日期冲突。');for(const k of ['streak','interval','reviewCount','lapses'])assert(Number.isSafeInteger(c[k])&&c[k]>=0&&(k!=='interval'||c[k]<=365),'逐词数值无效。');for(const k of ['note','memoryAnchor','memoryScene'])assert(c[k]===undefined||(typeof c[k]==='string'&&c[k].length<=4000),'笔记内容无效。');}
  assert(Object.keys(s.cards).length===ids.size,'词条与卡片不匹配。');
  for(const c of Object.values(s.cards)){assert(c.cueChoice===undefined||(typeof c.cueChoice==='string'&&c.cueChoice.length<=180),'巧记选择无效。');assert(c.cueFeedback===undefined||['unknown','complex','irrelevant','none'].includes(c.cueFeedback),'巧记反馈无效。');}
  assert(s.settings.fontSize===undefined||['normal','large'].includes(s.settings.fontSize),'字体设置无效。');assert(s.settings.audioRate===undefined||[0.75,1].includes(s.settings.audioRate),'语速设置无效。');assert(s.settings.adaptiveReview===undefined||typeof s.settings.adaptiveReview==='boolean','复习算法设置无效。');
  const timeOK=x=>x===null||(typeof x==='string'&&!isNaN(Date.parse(x)));
  assert(Number.isSafeInteger(s.revision)&&s.revision>=0&&s.revision<=1e12&&typeof s.writer==='string'&&s.updatedAt!==null&&timeOK(s.updatedAt),'本机版本或保存时间无效。');
  for(const c of Object.values(s.cards)){
   for(const k of ['lastGrade','legacyGrade'])assert(c[k]===null||['again','hard','good'].includes(c[k]),'反馈标记无效。');
   for(const k of ['lastScheduledDay','learnedOn'])assert(c[k]===null||dayOK(c[k]),'学习日期无效。');
   for(const k of ['updatedAt','lastSeen'])assert(timeOK(c[k]),'卡片时间无效。');
   for(const k of ['memoryAnchor','memoryScene'])assert(c[k]===undefined||c[k].length<=2000,'个人巧记超过2000字。');
  }
  assert(Array.isArray(s.history)&&s.history.length<=500000,'历史记录过多。');const events=new Set();for(const e of s.history){validateEvent(e);assert(ids.has(e.wordId)&&!events.has(e.id),'反馈词条未知或编号重复。');events.add(e.id);}
  assert(['mnemonic','context','cloze','meaning','listening'].includes(s.settings.mode),'回忆模式无效。');for(const [k,min,max] of [['dailyTarget',1,500],['dailyNew',0,500],['dailyLists',1,6]])if(s.settings[k]!==undefined)assert(Number.isSafeInteger(s.settings[k])&&s.settings[k]>=min&&s.settings[k]<=max,'学习量无效。');if(s.settings.studyDays!==undefined)assert(Array.isArray(s.settings.studyDays)&&s.settings.studyDays.length>0&&s.settings.studyDays.length<=7&&new Set(s.settings.studyDays).size===s.settings.studyDays.length&&s.settings.studyDays.every(x=>Number.isInteger(x)&&x>=0&&x<=6),'学习日无效。');if(s.settings.targetDate)assert(dayOK(s.settings.targetDate),'目标日期无效。');
  assert(object(s.meta)&&object(s.baseline)&&dayOK(s.baseline.date)&&Array.isArray(s.baseline.ids)&&s.baseline.ids.length<=10000&&new Set(s.baseline.ids).size===s.baseline.ids.length&&s.baseline.ids.every(id=>ids.has(id))&&typeof s.baseline.source==='string','记录元信息无效。');
  assert(Number.isSafeInteger(s.settings.dailyTarget)&&s.settings.dailyTarget>=1&&s.settings.dailyTarget<=500,'复习参考量无效。');
  assert(timeOK(s.meta.lastBackupAt)&&Number.isSafeInteger(s.meta.migrated)&&s.meta.migrated>=0&&s.meta.migrated<=10000,'备份信息无效。');
  if(s.session!==null){const x=s.session;assert(object(x)&&Array.isArray(x.queue)&&x.queue.length<=200000&&Number.isInteger(x.cursor)&&x.cursor>=0&&x.cursor<=x.queue.length&&x.queue.every(q=>ids.has(q.id)&&['new','review','repeat','free'].includes(q.kind)),'任务断点无效。');assert(dayOK(x.day)&&['schedule','free'].includes(x.kind)&&typeof x.shown==='boolean'&&typeof x.typed==='string','任务断点字段无效。');}
  if(s.library!==undefined){assert(wordbooks,'请先加载 wordbooks.js。');wordbooks.validate(s);}
  return s;
 }
 function validateEvent(e){
  assert(object(e)&&idOK(e.id)&&idOK(e.wordId)&&dayOK(e.day)&&typeof e.at==='string'&&!isNaN(Date.parse(e.at)),'反馈记录无效。');
  assert(['new','review','repeat','free','mastery'].includes(e.kind),'反馈类型无效。');assert(e.kind==='mastery'?['mastered','restore'].includes(e.grade):['again','hard','good'].includes(e.grade),'反馈值无效。');
  assert((e.nextDue===null||dayOK(e.nextDue))&&Number.isSafeInteger(e.interval)&&e.interval>=0&&e.interval<=365,'反馈日期/间隔无效。');
  assert(e.mode===undefined||['mnemonic','context','cloze','meaning','listening'].includes(e.mode),'反馈题型无效。');
  assert(e.recall===undefined||['independent','assisted','unverified'].includes(e.recall),'回忆质量无效。');
  assert(e.scheduler===undefined||e.scheduler===null||e.scheduler==='adaptive-v1','复习算法版本无效。');
  if(e.spelling!==undefined){const p=e.spelling;assert(object(p)&&Object.keys(p).every(k=>['correct','expected','typed','issues'].includes(k))&&typeof p.correct==='boolean'&&typeof p.expected==='string'&&p.expected.length<=256&&typeof p.typed==='string'&&p.typed.length<=2000,'拼写结果无效。');if(p.issues!==undefined)assert(Array.isArray(p.issues)&&p.issues.length<=512&&p.issues.every(i=>object(i)&&typeof i.type==='string'&&i.type.length<=50&&typeof i.label==='string'&&i.label.length<=1000),'拼写问题列表无效。');assert(learningTools&&learningTools.diffSpelling(p.expected,p.typed).correct===p.correct,'拼写正确性与作答不符。');}
 }

 function identity(d){assert(object(d)&&d.format===FORMAT&&d.schema===1&&idOK(d.profileId)&&idOK(d.deviceId),'不是兼容的电脑学习档案。');}
 function validateDocument(d){identity(d);assert(Object.keys(d).every(k=>['format','schema','profileId','deviceId','state'].includes(k)),'电脑学习档案包含未知字段。');validateState(d.state);return d;}
 function createDocument(state,deviceId=uuid(),profileId=uuid()){assert(idOK(deviceId)&&idOK(profileId),'档案或设备编号无效。');validateState(state);return {format:FORMAT,schema:1,profileId,deviceId,state:copy(state)};}
 function update(document,state){identity(document);return createDocument(state,document.deviceId,document.profileId);}
 function documentState(document){validateDocument(document);return copy(document.state);}
 function summary(document){validateDocument(document);const s=document.state;return {profileId:document.profileId,deviceId:document.deviceId,wordCount:s.words.length,seen:s.words.filter(w=>s.cards[w.id].seen).length,mastered:s.words.filter(w=>s.cards[w.id].mastered).length,historyCount:s.history.length};}
 return {FORMAT,MAX_BYTES,validateState,validateEvent,validateDocument,createDocument,update,documentState,materialize:documentState,summary,sha256,canonical,safeTree,version:1};
});
