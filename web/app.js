(() => {
'use strict';
const KEY = 'jiufen-regular-mnemonic-v1', PREVIOUS = KEY + '-previous', OLD = 'jiufen-unused-legacy';
const APP = 'jiufen-mnemonic-learning', GRADES = ['again','hard','good'], MODES = ['mnemonic','context','cloze','meaning'];
const LABEL = {again:'忘记',hard:'模糊',good:'认识',mastered:'标记熟知',restore:'恢复复习'}, LEGACY = {known:'good',hesitant:'hard',unknown:'again'};
const el = id => document.getElementById(id), copy = x => JSON.parse(JSON.stringify(x));
const initialWords = JSON.parse(el('vocabulary-data').textContent);
const catalogue = JSON.parse(el('catalogue-data').textContent), CATALOGUE_VERSION='jiufen-regular-1493-2026-10-28';
const uid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const tabId = uid(), now = () => new Date().toISOString();
const day=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
function addDays(date,n){const d=new Date(date+'T04:00:00Z');d.setUTCDate(d.getUTCDate()+n);return day(d);}
const validDay = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(new Date(x + 'T12:00:00')) && day(new Date(x + 'T12:00:00')) === x;
const validTime = x => x === null || (typeof x === 'string' && !isNaN(Date.parse(x)));
const normalize = x => String(x).normalize('NFKC').trim().toLowerCase();
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const regex = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const integer = (x,min,max) => Number.isInteger(x) && x>=min && x<=max;
let state, baseRevision = null, lastRaw = null, saveOK = false, blocked = false, damaged = null, changedInMemory = false;
let tab = 'today', expanded = false, libraryPage = 0, historyPage = 0, detailId = null, pendingImport = null;
let selected = new Set(), bootMessage = '', recovered = false;

const PREVIOUS_APP = 'ielts-context-learning';
const PREVIOUS_KEY = 'ielts-context-learning-v2';
const memoryIndex = new Map(initialWords.map(w => [normalize(w.word), w.memory]));
const builtinNames = new Set(initialWords.map(w => normalize(w.word)));
let networkFamily = '', spellingTimer = null;
function withoutMemory(w) { const {memory,...plain}=w; return plain; }
function memoryFor(w) {
  const c=state?.cards[w.id]||{},m=memoryIndex.get(normalize(w.word))||{kind:'我的联想',family:'我的补充词',anchor:'从一个你熟悉的词或生活经历搭桥。',scene:'写下一个能让你想到这个词的具体画面。',related:[],focus:'先回忆，再核对完整拼写。',reference:'自己编写的助记，不作为词源说明。'};
  return {...m,anchor:c.memoryAnchor||m.anchor,scene:c.memoryScene||m.scene,personal:Boolean(c.memoryAnchor||c.memoryScene),rejected:Boolean(c.rejectBuiltinCue)};
}
function memoryHTML(w,where='study') {
 const m=memoryFor(w),links=m.related.map(name=>state.words.find(x=>normalize(x.word)===normalize(name))).filter(Boolean),c=state.cards[w.id];
 const parts=(m.parts?.length?m.parts:m.baseParts||[]).filter(p=>p.text.trim());
 return `<div class="memory-top"><span class="method-pill">${escape(m.kind)}</span><span class="small muted">${escape(m.status||'个人线索')}${m.personal?' · 含个人修改':''}</span></div>
 ${m.personal?`<h3>我的线索</h3><p>${escape(c.memoryAnchor||'')}</p><p>${escape(c.memoryScene||'')}</p><details><summary>查看内置方案</summary>`:''}
 ${m.rejected?'<p>你已停用这条内置线索。可写入自己的熟词和故事。</p>':`<h3>${m.kind==='待补巧记'?'这条需要补充':'① 实际字母怎样搭起来'}</h3><p>${escape(memoryIndex.get(normalize(w.word))?.anchor||m.anchor)}</p>
 ${parts.length?`<div class="cue-parts">${parts.map(p=>`<div class="cue-part"><strong>${escape(p.text)}</strong><span>${escape(p.cue)}</span>${p.from?`<details><summary class="small">核对借用步骤</summary><p class="small">${escape(p.from)} → ${escape(p.text)}<br>${escape(p.change)}</p></details>`:''}</div>`).join('')}</div>`:''}
 ${m.kind!=='待补巧记'?`<h3>② 用线索连接本词意思</h3>`:''}<p>${escape(memoryIndex.get(normalize(w.word))?.scene||m.scene)}</p>
 ${m.kind!=='待补巧记'?`<h3>③ 核对拼写还原</h3><p class="rebuild">${escape(m.focus)}</p>`:''}`}
 ${m.personal?'</details>':''}
 <details><summary>方法与来源</summary><p class="small muted">${escape(m.reference)} 字母结构通过校验不代表这条线索对每个人都有效；不认识提示词时可停用或修改。</p></details>
 ${links.length?`<div class="row">${links.map(x=>`<button data-memory-open="${escape(x.id)}">${escape(x.word)}</button>`).join('')}</div>`:''}
 <div class="row"><button data-reject-cue="${escape(w.id)}">${m.rejected?'恢复内置线索':'这条线索不适合我'}</button>${where==='study'?`<button data-memory-open="${escape(w.id)}">写自己的巧记</button>`:''}</div>`;
}

function renderNetwork() {
  const term=normalize(el('network-search').value),kind=el('network-kind').value;
  const eligible=state.words.filter(w=>builtinNames.has(normalize(w.word))).filter(w=>{const m=memoryFor(w);return (kind==='all'||m.kind===kind)&&(!term||normalize(w.word+' '+w.meaning+' '+m.family+' '+m.anchor+' '+m.scene).includes(term));});
  const families=[...new Set(eligible.map(w=>memoryFor(w).family))];
  if(!families.includes(networkFamily))networkFamily=families[0]||'';
  el('network-families').innerHTML=families.map(name=>`<button data-family="${escape(name)}" class="family-button ${name===networkFamily?'active':''}" aria-pressed="${name===networkFamily}">${escape(name)} <span>${eligible.filter(w=>memoryFor(w).family===name).length}</span></button>`).join('');
  const words=eligible.filter(w=>memoryFor(w).family===networkFamily),first=words[0];
  el('network-title').textContent=networkFamily||'没有匹配的词';
  el('network-count').textContent=`找到 ${eligible.length} 条 · 当前组 ${words.length} 条`;
  el('network-intro').textContent=first?memoryFor(first).anchor:'换一个英文、中文或熟悉线索试试。';
  el('network-words').innerHTML=words.map(w=>`<button class="network-word" data-memory-open="${escape(w.id)}"><strong>${escape(w.word)}</strong><span>${escape(w.meaning)}</span><small>${escape(memoryFor(w).kind)} · ${escape(w.group)}</small></button>`).join('');
  el('practice-network').disabled=!words.length;el('practice-network').dataset.ids=JSON.stringify(words.map(w=>w.id));
}
function projectPrevious(incoming) {
  const out=initialState(),target=new Map(out.words.map(w=>[normalize(w.word),w])),mapping=new Map();
  for(const old of incoming.words){const w=target.get(normalize(old.word));if(!w)continue;mapping.set(old.id,w.id);const current=state.words.find(x=>normalize(x.word)===normalize(old.word)),personal=current?state.cards[current.id]:{};out.cards[w.id]={...blankCard(false),...copy(incoming.cards[old.id]),memoryAnchor:personal.memoryAnchor||'',memoryScene:personal.memoryScene||''};}
  out.history=incoming.history.filter(e=>mapping.has(e.wordId)).map(e=>({...copy(e),wordId:mapping.get(e.wordId)}));
  out.baseline={...copy(incoming.baseline),ids:incoming.baseline.ids.filter(id=>mapping.has(id)).map(id=>mapping.get(id)),source:'从旧软件按英文精确匹配迁入的补记'};
  out.meta.migrated=out.words.filter(w=>out.cards[w.id].legacyGrade).length;
  out.meta.catalogueVersion=CATALOGUE_VERSION;
  out.meta.previousImport={matched:mapping.size,excluded:incoming.words.length-mapping.size,at:now()};
  out.settings.dailyLists=incoming.settings.dailyLists||2;Object.assign(out.settings,learningSettings(state));
  out.settings.dailyTarget=incoming.settings.dailyTarget;
  out.session=null;out.undo=null;out.dailyPlan=null;ensureDailyPlan(out);
  return validate(out);
}
function flushSpelling() {
  if(spellingTimer!==null){clearTimeout(spellingTimer);spellingTimer=null;persist();}
}
function readPreviousLocal(exportOnly=false) {
  try {
    const raw=localStorage.getItem(PREVIOUS_KEY);
    if(!raw){message('这个浏览器位置没有找到旧软件记录。可使用以前下载的 JSON 备份导入。');return;}
    const previous=decode(raw,true);
    assert(previous.app===PREVIOUS_APP,'找到的记录不属于旧软件。');
    if(exportOnly){download(raw,`旧软件完整记录_${day()}.json`,'application/json');message('已下载旧软件的完整记录，包含其原词库。');}
    else previewImport({type:'v2',state:projectPrevious(previous),previous:true});
  } catch(e){message('读取旧记录失败，原记录未改动：'+e.message,true);}
}

function checksum(text) { let n = 2166136261; for (let i=0;i<text.length;i++) { n ^= text.charCodeAt(i); n = Math.imul(n,16777619); } return (n>>>0).toString(16); }
function envelope(s,compress=false) {
  const payload=JSON.stringify(s),obj={format:APP,version:2,checksum:checksum(payload)};
  if(compress) {const bytes=pako.deflate(payload,{level:3});let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));obj.encoding='deflate-base64';obj.compressedPayload=btoa(binary);}
  else obj.payload=payload;
  return JSON.stringify(obj);
}
function assert(ok,msg) { if (!ok) throw new Error(msg); }
function validate(s, previousAllowed=false) {
  assert(object(s) && s.schema===2 && (s.app===APP || previousAllowed&&s.app===PREVIOUS_APP),'不是这个网页支持的第二版备份。');
  assert(integer(s.revision,0,1e12) && validTime(s.updatedAt) && s.updatedAt!==null && typeof s.writer==='string','记录版本或时间格式不正确。');
  assert(Array.isArray(s.words) && s.words.length>=1 && s.words.length<=10000 && object(s.cards),'词库格式不正确。');
  const ids=new Set(),names=new Set();
  for (const w of s.words) {
    assert(object(w) && typeof w.id==='string' && w.id.length>0 && w.id.length<160 && !['__proto__','constructor','prototype'].includes(w.id) && !ids.has(w.id),'词条编号重复或无效。');
    assert(typeof w.word==='string' && w.word.trim().length>0 && w.word.length<=120 && !names.has(normalize(w.word)),'英文词条为空或重复。');
    assert(typeof w.group==='string' && w.group.length<=80 && typeof w.meaning==='string' && w.meaning.length<=4000 && typeof w.sentence==='string' && w.sentence.length<=4000 && typeof w.phonetic==='string','词条内容格式不正确。');
    ids.add(w.id); names.add(normalize(w.word));
    const c=s.cards[w.id];
    assert(object(c) && ['seen','planned','suspended','favorite'].every(k=>typeof c[k]==='boolean'),'逐词状态不完整。');
    assert((c.due===null || validDay(c.due)) && (c.lastScheduledDay===null || validDay(c.lastScheduledDay)) && (c.learnedOn===null || validDay(c.learnedOn)),'复习日期不正确。');
    assert((c.lastGrade===null || GRADES.includes(c.lastGrade)) && (c.legacyGrade===null || GRADES.includes(c.legacyGrade)),'反馈标记不正确。');
    assert(integer(c.streak,0,1e6) && integer(c.interval,0,365) && integer(c.reviewCount,0,1e9) && integer(c.lapses,0,1e9) && typeof c.note==='string' && c.note.length<=4000,'逐词统计或笔记不正确。');
    assert(validTime(c.updatedAt) && validTime(c.lastSeen),'逐词时间不正确。');
    for(const k of ['memoryAnchor','memoryScene'])assert(c[k]===undefined||(typeof c[k]==='string'&&c[k].length<=2000),'个人联想内容格式不正确。');
    assert(c.mastered===undefined||typeof c.mastered==='boolean','熟知状态不正确。');
    assert(c.masteryUpdatedAt===undefined||validTime(c.masteryUpdatedAt),'熟知标记时间不正确。');
    assert(!c.mastered||(c.seen&&c.due===null),'熟知词不应有自动复习日期。');
    assert(!c.seen || c.mastered || validDay(c.due),'已接触词缺少复习日期。');
  }
  assert(Object.keys(s.cards).length===ids.size && Object.keys(s.cards).every(id=>ids.has(id)),'逐词状态和词库不匹配。');
  assert(object(s.settings) && integer(s.settings.dailyTarget,1,500) && MODES.includes(s.settings.mode),'学习设置不正确。');
  if(s.settings.dailyLists!==undefined)assert(integer(s.settings.dailyLists,1,6),'每日List数量不正确。');
  if(s.settings.dailyNew!==undefined)assert(integer(s.settings.dailyNew,0,500),'每日新词数量不正确。');
  if(s.settings.studyDays!==undefined)assert(Array.isArray(s.settings.studyDays)&&s.settings.studyDays.length>=1&&s.settings.studyDays.length<=7&&new Set(s.settings.studyDays).size===s.settings.studyDays.length&&s.settings.studyDays.every(d=>integer(d,0,6)),'学习日设置不正确。');
  if(s.settings.targetDate!==undefined&&s.settings.targetDate!==null)assert(validDay(s.settings.targetDate),'目标日期不正确。');
  if(s.dailyPlan!==undefined&&s.dailyPlan!==null){assert(object(s.dailyPlan)&&validDay(s.dailyPlan.day)&&Array.isArray(s.dailyPlan.groups)&&s.dailyPlan.groups.length<=10000&&new Set(s.dailyPlan.groups).size===s.dailyPlan.groups.length&&s.dailyPlan.groups.every(g=>s.words.some(w=>w.group===g)),'每日计划分组不正确。');if(s.dailyPlan.ids!==undefined)assert(Array.isArray(s.dailyPlan.ids)&&s.dailyPlan.ids.length<=500&&new Set(s.dailyPlan.ids).size===s.dailyPlan.ids.length&&s.dailyPlan.ids.every(id=>ids.has(id)),'每日新词计划不正确。');}
  assert(Array.isArray(s.history) && s.history.length<=500000,'反馈历史格式不正确。');
  const eventIds=new Set();
  for(const e of s.history) {
    assert(object(e) && typeof e.id==='string' && !eventIds.has(e.id) && ids.has(e.wordId) && validTime(e.at) && e.at!==null && validDay(e.day) && (e.kind==='mastery'?['mastered','restore'].includes(e.grade):GRADES.includes(e.grade)),'反馈历史包含无效记录。');
    assert(['new','review','repeat','free','mastery'].includes(e.kind) && (e.nextDue===null || validDay(e.nextDue)) && integer(e.interval,0,365),'反馈类型或间隔不正确。'); eventIds.add(e.id);
  }
  function checkSession(x) {
    assert(object(x) && typeof x.id==='string' && ['schedule','free'].includes(x.kind) && validDay(x.day) && MODES.includes(x.mode) && validTime(x.updatedAt),'学习断点格式不正确。');
    assert(Array.isArray(x.queue) && x.queue.length<=200000 && integer(x.cursor,0,x.queue.length) && integer(x.initialCount,0,10000) && typeof x.shown==='boolean' && typeof x.typed==='string' && x.typed.length<=150,'学习队列格式不正确。');
    assert(x.queue.every(q=>object(q) && ids.has(q.id) && ['new','review','repeat','free'].includes(q.kind)),'学习队列有未知词条。');
  }
  if(s.session!==null)checkSession(s.session);
  assert(object(s.baseline) && validDay(s.baseline.date) && Array.isArray(s.baseline.ids) && new Set(s.baseline.ids).size===s.baseline.ids.length && s.baseline.ids.every(id=>ids.has(id)) && typeof s.baseline.source==='string','补记来源不正确。');
  assert(object(s.meta) && validTime(s.meta.lastBackupAt) && integer(s.meta.migrated,0,10000),'保存信息不正确。');
  if(s.undo!==null) {
    assert(object(s.undo) && ids.has(s.undo.wordId) && object(s.undo.card) && typeof s.undo.eventId==='string','撤销信息不正确。');
    checkSession(s.undo.session);
    const probe=copy(s); probe.cards[s.undo.wordId]=s.undo.card; probe.session=null; probe.undo=null;
    validate(probe,previousAllowed);
  }
  return s;
}
function decode(raw, previousAllowed=false) {
  const obj=JSON.parse(raw);
  assert(object(obj) && (obj.format===APP || previousAllowed&&obj.format===PREVIOUS_APP) && obj.version===2,'备份格式无法识别。');
  let payload=obj.payload;
  if(obj.encoding==='deflate-base64') {
    assert(typeof obj.compressedPayload==='string'&&obj.compressedPayload.length<=30000000,'本机压缩记录过大或格式错误。');
    const bytes=Uint8Array.from(atob(obj.compressedPayload),c=>c.charCodeAt(0)),inflator=new pako.Inflate({to:'string'}),chunks=[];let size=0;
    inflator.onData=chunk=>{size+=chunk.length;assert(size<=50000000,'解压后的记录过大。');chunks.push(chunk);};
    inflator.push(bytes,true);assert(!inflator.err,'压缩记录损坏，无法读取。');payload=chunks.join('');
  }
  assert(typeof payload==='string','备份内容不完整。');
  assert(checksum(payload)===obj.checksum,'备份校验失败，文件可能被改动或没有保存完整。');
  const parsed=validate(JSON.parse(payload),previousAllowed);assert(parsed.app===obj.format,'备份内外标识不一致。');return parsed;
}
function blankCard(seen=false) { return {mastered:false,seen,planned:seen,suspended:false,favorite:false,due:seen?day():null,interval:0,streak:0,lastGrade:null,legacyGrade:null,lastScheduledDay:null,learnedOn:seen?day():null,lastSeen:null,updatedAt:null,reviewCount:0,lapses:0,note:'',memoryAnchor:'',memoryScene:''}; }
function initialState() {
  const words=initialWords.map(w=>({...withoutMemory(w),id:String(w.id)}));
  return {schema:2,app:APP,revision:0,writer:tabId,updatedAt:now(),words,cards:Object.fromEntries(words.map(w=>[w.id,{...blankCard(false),planned:true}])),settings:{dailyTarget:50,mode:'mnemonic',dailyLists:2,dailyNew:100,studyDays:[0,1,2,3,4,5,6],targetDate:null},history:[],session:null,undo:null,dailyPlan:null,baseline:{date:day(),ids:[],source:'九分常规词表从未学开始；旧进度仅按英文精确匹配导入。'},meta:{lastBackupAt:null,migrated:0}};
}
function syncCatalogue(s) {
  let added=0;const migrate=s.meta.catalogueVersion!==CATALOGUE_VERSION,byName=new Map(s.words.map(w=>[normalize(w.word),w]));
  for(const original of initialWords) {
    let w=byName.get(normalize(original.word));
    if(!w) {const id=Object.hasOwn(s.cards,String(original.id))?'builtin:'+original.id:String(original.id);w={...copy(withoutMemory(original)),id};s.words.push(w);s.cards[id]={...blankCard(false),planned:true};byName.set(normalize(w.word),w);added++;}
    else {
      const id=w.id;Object.assign(w,copy(withoutMemory(original)),{id});
      if(migrate)s.cards[w.id].planned=true;
      if(!w.sentence&&original.sentence)w.sentence=original.sentence;
      if(!w.sourceMeaning)w.sourceMeaning=original.sourceMeaning;
    }
  }
  s.words.sort((a,b)=>(a.catalogueOrder??1e9)-(b.catalogueOrder??1e9));
  if(migrate){s.settings.dailyLists=2;s.dailyPlan=null;s.meta.catalogueVersion=CATALOGUE_VERSION;}
  if(!s.settings.dailyLists)s.settings.dailyLists=2;
  migrateLearningPlan(s);fitSessionToPlan(s);
  return {added,migrate};
}
const WEEKDAYS=[1,2,3,4,5,6,0], WEEK_NAMES=['日','一','二','三','四','五','六'];
function learningSettings(s) {
  return {dailyNew:s.settings.dailyNew??(s.settings.dailyLists||2)*50,studyDays:s.settings.studyDays||[0,1,2,3,4,5,6],targetDate:s.settings.targetDate||null};
}
function newDoneIds(s,date=day()) {
  const ids=new Set(s.history.filter(e=>e.day===date&&e.kind==='new').map(e=>e.wordId));
  for(const w of s.words)if(s.cards[w.id].seen&&s.cards[w.id].learnedOn===date)ids.add(w.id);
  return ids;
}
function remainingNew(s) {return s.words.filter(w=>active(s.cards[w.id])&&!s.cards[w.id].seen);}
function isStudyDay(date,settings) {return settings.studyDays.includes(new Date(date+'T04:00:00Z').getUTCDay());}
function planFor(s,date=day()) {
  const settings=learningSettings(s),done=newDoneIds(s,date),target=isStudyDay(date,settings)?settings.dailyNew:0;
  const words=remainingNew(s).slice(0,Math.max(0,target-done.size));
  return {day:date,target,done:done.size,ids:words.map(w=>w.id),groups:[...new Set(words.map(w=>w.group))]};
}
function ensureDailyPlan(s) {s.dailyPlan=planFor(s);}
function migrateLearningPlan(s) {
  const migrated=s.settings.dailyNew===undefined;
  const settings=learningSettings(s);Object.assign(s.settings,settings);
  ensureDailyPlan(s);
  if(migrated){s.meta.planVersion=1;return true;}return false;
}
// Returns the nth selected weekday, counting start inclusively.
function nthLearningDate(start,n,settings) {
  const weeks=Math.floor((n-1)/settings.studyDays.length);
  let date=addDays(start,weeks*7),left=n-weeks*settings.studyDays.length;
  for(let i=0;i<7;i++,date=addDays(date,1))if(isStudyDay(date,settings)&&!--left)return date;
  throw new Error('无法计算学习日期。');
}
function forecastPlan(s,settings=learningSettings(s),date=day()) {
  const remaining=remainingNew(s).length,done=newDoneIds(s,date).size;
  const excluded=s.words.filter(w=>!s.cards[w.id].seen&&!active(s.cards[w.id])).length;
  const target=isStudyDay(date,settings)?settings.dailyNew:0;
  const today=Math.min(remaining,Math.max(0,target-done));
  if(!remaining)return {remaining,excluded,done,target,today,days:0,finish:null,status:'complete'};
  if(!settings.dailyNew)return {remaining,excluded,done,target,today:0,days:null,finish:null,status:'paused'};
  const later=Math.ceil((remaining-today)/settings.dailyNew);
  return {remaining,excluded,done,target,today,days:(today?1:0)+later,finish:later?nthLearningDate(addDays(date,1),later,settings):date,status:'active'};
}
function dateGap(a,b) {return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);}
function quotaForDeadline(s,targetDate,settings,date=day()) {
  if(!validDay(targetDate)||targetDate<date||dateGap(date,targetDate)>3650)return {error:'请选择今天起十年内的目标日期。'};
  let slots=0;
  for(let d=date;d<=targetDate;d=addDays(d,1))if(isStudyDay(d,settings))slots++;
  const remaining=remainingNew(s).length,done=newDoneIds(s,date).size;
  if(!remaining)return {quota:0,slots};
  if(!slots)return {error:'目标日期前没有选中的新词学习日，请调整日期或星期。'};
  // Today may already have consumed some of its quota. Find the smallest feasible integer.
  const todaySelected=isStudyDay(date,settings),future=slots-(todaySelected?1:0);
  let lo=1,hi=remaining+done;
  while(lo<hi){const q=Math.floor((lo+hi)/2),capacity=future*q+(todaySelected?Math.max(0,q-done):0);if(capacity>=remaining)hi=q;else lo=q+1;}
  return {quota:lo,slots};
}
function fitSessionToPlan(s) {
  removeMasteredFromSession(s);
  const session=s.session;
  if(!unfinished(session)||session.kind!=='schedule'||session.source!=='new')return;
  const permitted=new Set(planFor(s).ids),old=session.queue[session.cursor];
  const tail=session.queue.slice(session.cursor).filter(q=>s.cards[q.id].seen||permitted.has(q.id));
  session.queue=[...session.queue.slice(0,session.cursor),...tail];
  session.initialCount=new Set(session.queue.filter(q=>q.kind==='new').map(q=>q.id)).size;
  if(!tail[0]||tail[0].id!==old.id||tail[0].kind!==old.kind){session.shown=false;session.typed='';session.hintShown=false;session.cueSeen=false;session.wordCovered=false;}
  session.updatedAt=now();
}
function weekdayText(settings) {return settings.studyDays.length===7?'每天':settings.studyDays.length===5&&[1,2,3,4,5].every(d=>settings.studyDays.includes(d))?'周一至周五':WEEKDAYS.filter(d=>settings.studyDays.includes(d)).map(d=>'周'+WEEK_NAMES[d]).join('、');}
function renderLearningPlan() {
  const settings=learningSettings(state),f=forecastPlan(state),seen=state.words.filter(w=>state.cards[w.id].seen).length;
  el('learning-pace').textContent=settings.dailyNew?`${settings.dailyNew} 词 / 学习日`:'暂停新学 · 只复习';
  el('learning-weekdays').textContent=weekdayText(settings);
  el('learning-eta').textContent=f.status==='complete'?'当前计划首轮已完成':f.status==='paused'?'恢复新学后计算':`还需 ${f.days} 个学习日`;
  el('learning-date').textContent=f.finish?`预计 ${f.finish} 首轮学完`:f.status==='complete'?'熟知词不再安排复习，其余已学词按到期安排复习':'新词暂停期间，到期复习照常';
  el('learning-remaining').textContent=`${f.remaining} 词`;
  el('learning-scope').textContent=f.excluded?`另有 ${f.excluded} 个未学词暂停或未入计划`:'当前启用的未学词';
  el('book-progress').max=state.words.length;el('book-progress').value=seen;
  el('book-progress-label').textContent=`词库首轮进度 ${seen} / ${state.words.length} · ${(seen/state.words.length*100).toFixed(1)}% · 含 ${state.words.filter(w=>state.cards[w.id].mastered).length} 个熟知词`;
  el('goal-status').hidden=!settings.targetDate;
  el('goal-status').textContent=settings.targetDate?`目标 ${settings.targetDate}：${f.status==='complete'?'当前计划首轮已完成':f.finish?(f.finish<=settings.targetDate?'按当前安排可在目标日期前完成':`当前预计晚 ${dateGap(settings.targetDate,f.finish)} 天，可调整每日词量或学习日`):'新学已暂停，暂不预计完成日期'}`:'';
  const due=stats().due.length;
  el('review-load').textContent=`今日到期待复习 ${due} 词，今日可继续新学 ${f.today} 词。新词和复习分开计数；重复呈现不重复扣新词名额。`;
  let left=f.remaining;
  el('plan-week').innerHTML=Array.from({length:7},(_,i)=>{
    const date=addDays(day(),i),selected=isStudyDay(date,settings),n=Math.min(left,i===0?f.today:selected?settings.dailyNew:0);left-=n;
    return `<div class="week-cell"><span>${i===0?'今天':date.slice(5)} · 周${WEEK_NAMES[new Date(date+'T04:00:00Z').getUTCDay()]}</span><strong>${n}<small> 新词</small></strong><span>${!selected?'只复习日':!settings.dailyNew?'新学已暂停':i===0&&f.done?`已新学 ${f.done} 词`:'按完成每日计划预计'}</span></div>`;
  }).join('');
}
function readPlanDraft() {
  const raw=el('plan-daily-new').value.trim(),dailyNew=Number(raw),studyDays=[...document.querySelectorAll('[name="study-weekday"]:checked')].map(x=>Number(x.value));
  if(!raw||!integer(dailyNew,0,500))throw new Error('每日新词请填写 0–500 的整数；0 表示暂停新学。');
  if(!studyDays.length)throw new Error('请至少选择一个新词学习日；暂时只复习可将每日新词设为 0。');
  const targetDate=el('plan-deadline').value||null;
  if(targetDate&&(!validDay(targetDate)||targetDate<day()||dateGap(day(),targetDate)>3650))throw new Error('目标日期请选今天起十年内，或清空日期。');
  return {dailyNew,studyDays,targetDate};
}
function renderPlanPreview() {
  const preview=el('plan-preview');
  try {
    const draft=readPlanDraft(),f=forecastPlan(state,draft),current=forecastPlan(state);
    preview.classList.remove('error');el('apply-learning-plan').disabled=blocked||Boolean(damaged&&!recovered);
    let result=f.status==='complete'?'当前启用的词已完成首轮。':f.status==='paused'?`暂停新学，${f.remaining} 个未学词保留，复习继续。`:`剩余 ${f.remaining} 词，预计还需 ${f.days} 个学习日，于 ${f.finish} 首轮学完。`;
    result+=` 今天已新学 ${f.done} 词，应用后还能新学 ${f.today} 词。`;
    if(f.target<f.done)result+=' 今天已学数量超过新目标，已有记录保留，不再追加新词。';
    if(draft.targetDate&&f.finish)result+=f.finish<=draft.targetDate?' 可以按期完成。':` 比目标日期晚 ${dateGap(draft.targetDate,f.finish)} 天。`;
    if(current.finish&&f.finish&&current.finish!==f.finish)result+=` 当前计划原预计 ${current.finish} 完成。`;
    preview.textContent=result;
    document.querySelectorAll('[data-new-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.newPreset)===draft.dailyNew)));
  } catch(e){preview.textContent=e.message;preview.classList.add('error');el('apply-learning-plan').disabled=true;}
}
function openLearningPlan() {
  const settings=learningSettings(state);
  el('plan-daily-new').value=settings.dailyNew;el('plan-deadline').value=settings.targetDate||'';el('plan-deadline').min=day();el('plan-deadline').max=addDays(day(),3650);
  document.querySelectorAll('[name="study-weekday"]').forEach(c=>c.checked=settings.studyDays.includes(Number(c.value)));
  el('deadline-result').textContent='';renderPlanPreview();el('learning-plan-dialog').showModal();
}
function applyLearningPlan() {
  try {
    const draft=readPlanDraft();flushSpelling();
    if(!commit(s=>{Object.assign(s.settings,draft);ensureDailyPlan(s);fitSessionToPlan(s);s.undo=null;}))return;
    el('learning-plan-dialog').close();message('计划已应用。已学记录和待巩固词保留，未学词按新额度安排。');
  } catch(e){el('plan-preview').textContent=e.message;el('plan-preview').classList.add('error');}
}
function calculateDeadline() {
  try {
    const draft=readPlanDraft(),result=quotaForDeadline(state,el('plan-deadline').value,draft);
    if(result.error)throw new Error(result.error);
    if(result.quota>500)throw new Error(`按所选学习日，需要每天 ${result.quota} 个新词，超过本软件的 500 词上限。请延后目标日期或增加学习日。`);
    el('plan-daily-new').value=result.quota;el('deadline-result').textContent=`目标日期前有 ${result.slots} 个学习日，已计入今日完成量。建议每天 ${result.quota} 个新词，点击“应用计划”后生效。`;renderPlanPreview();
  }catch(e){el('deadline-result').textContent=e.message;}
}

function migrateRatings(s, ratings) {
  let count=0;
  for(const w of s.words) if(Object.hasOwn(ratings,w.id) && Object.hasOwn(LEGACY,ratings[w.id])) { s.cards[w.id].legacyGrade=LEGACY[ratings[w.id]]; count++; }
  s.meta.migrated=count; return count;
}
function message(text,error=false) { el('toast').textContent=text; el('toast').classList.toggle('error',error); }
function storageStatus() {
  el('save-status').textContent=blocked?'写入已暂停，等待载入最新记录。':saveOK?`已自动保存在本机 · ${new Date(state.updatedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:'当前仅保留在本页内存，请下载备份。';
  if(!saveOK && !blocked) { el('storage-warning').hidden=false; el('storage-warning').textContent='浏览器没有成功保存本次更改。请现在下载完整备份或含进度的网页；关闭本页会丢失尚未保存的更改。'; }
}
function persist(forcePlain=false) {
  if(nativeEnabled)return nativePersist();
  if(damaged && !recovered) { saveOK=false; storageStatus(); return false; }
  try {
    const current=localStorage.getItem(KEY);
    let parsed=current&&current===lastRaw?{revision:baseRevision}:null; if(current&&!parsed) { try{parsed=decode(current)}catch(_){} }
    if(parsed && baseRevision!==null && parsed.revision!==baseRevision) { blocked=true; el('conflict').hidden=false; saveOK=false; storageStatus(); return false; }
    const raw=envelope(state,!forcePlain);
    if(current && parsed) { try{localStorage.setItem(PREVIOUS,current)}catch(_){} }
    localStorage.setItem(KEY,raw);
    if(localStorage.getItem(KEY)!==raw)throw new Error('写入后核对失败');
    baseRevision=state.revision;lastRaw=raw;saveOK=true; changedInMemory=false;
    el('storage-warning').hidden=true; storageStatus(); return true;
  } catch(e) { saveOK=false; changedInMemory=true; storageStatus(); return false; }
}
function commit(fn, renderAfter=true) {
  if(blocked) { message('请先载入另一个标签页保存的最新记录。',true); return false; }
  if(damaged && !recovered) { message('请先导入有效备份恢复记录。',true); return false; }
  if(usbLocked){message('同步进行中，请先完成或退出同步。');return false;}
  const before=copy(state); fn(state); ensureDailyPlan(state); fitSessionToPlan(state); state.revision++;state.writer=tabId;state.updatedAt=now();changedInMemory=true;
  const stored=persist();
  if(blocked||nativeEnabled&&!stored)state=before;
  if(renderAfter)render(); return !blocked&&(!nativeEnabled||stored);
}
function boot() {
  state=initialState(); let primary=null,previous=null,embedded=null,legacy=null,storageError=false;
  if(nativeEnabled){primary=usbDocument?envelope(OfflineSync.materialize(usbDocument)):null;}else {try { primary=localStorage.getItem(KEY); previous=localStorage.getItem(PREVIOUS); legacy=localStorage.getItem(OLD); } catch(e){storageError=true;}}
  try { const p=el('portable-state').textContent.trim(); if(p!=='null')embedded=decode(p); } catch(e){ bootMessage='内嵌网页备份没有通过校验；未使用其中内容。'; }
  if(primary) {
    try { state=decode(primary);baseRevision=state.revision;lastRaw=primary;saveOK=true; }
    catch(e) {
      damaged=primary;
      try { if(!previous)throw new Error();state=decode(previous);baseRevision=null;recovered=true;bootMessage='本机最新记录损坏，已读取上一份有效快照。请核对最后一条反馈并马上下载备份。'; }
      catch(_) { el('fatal').hidden=false;bootMessage='本机记录损坏，原文已保留，未自动覆盖。请到备份与设置恢复。'; }
    }
    if(embedded && embedded.updatedAt>state.updatedAt && !damaged)bootMessage='此网页内嵌的备份比本机记录更新。本机记录暂时保留；点击“恢复网页内嵌备份”检查后恢复。';
  } else if(embedded) { state=embedded;state.writer=tabId;bootMessage='已从这份网页内嵌的备份恢复，词库、历史和断点均已读入。'; }
  else if(legacy) { try { const n=migrateRatings(state,JSON.parse(legacy));bootMessage=`已保留旧版最后标记 ${n} 词。旧版没有保存逐次时间，不补造历史。`; } catch(e) { bootMessage='旧版标记无法读取，旧数据原文没有改动。可导入旧版导出的记录。'; } }
  else bootMessage='九分常规 1,493 条已就绪。从第一个未学词开始，先搭联想，再回忆与拼写。';
  if(!damaged || recovered) {
    const imported=syncCatalogue(state);
    if(imported.migrate||imported.added){state.revision++;state.updatedAt=now();state.writer=tabId;bootMessage+=` 常规词表已接入，共30个List；每天按设置继续。`;}
    if(state.session && state.session.day!==day()) { state.session=null;state.undo=null;bootMessage+=' 上次任务已跨日，按当前到期时间重排，未完成词仍保留。'; }
    if(!storageError)persist(imported.migrate);else storageStatus();
  } else { storageStatus(); showTab('settings'); }
  showTab(damaged&&!recovered?'settings':'today'); if(bootMessage)message(bootMessage,Boolean(damaged));
  if(embedded && primary) { const b=document.createElement('button');b.textContent='恢复网页内嵌备份';b.addEventListener('click',()=>previewImport({type:'v2',state:embedded}));el('view-settings').appendChild(b); }
}
const wordById = id => state.words.find(w=>w.id===id);
const active = c => c.planned && !c.suspended && !c.mastered;
const unfinished = s => s && s.cursor<s.queue.length;
function stats(date=day()) {
  const events=state.history.filter(e=>e.day===date&&e.kind!=='mastery'),graded=new Set(events.map(e=>e.wordId));
  const all=new Set(graded); if(state.baseline.date===date)state.baseline.ids.forEach(id=>all.add(id));
  const due=state.words.filter(w=>{const c=state.cards[w.id];return active(c)&&c.seen&&c.due<=date;}).sort((a,b)=>state.cards[a.id].due.localeCompare(state.cards[b.id].due)||(a.catalogueOrder??1e9)-(b.catalogueOrder??1e9)||a.id.localeCompare(b.id,undefined,{numeric:true}));
  const plan=planFor(state,date),plannedIds=new Set(plan.ids),newWords=state.words.filter(w=>plannedIds.has(w.id));
  return {events,graded,all,due,newWords,newCount:newWords.length,plan};
}
function showTab(name) {
  tab=name;
  ['today','library','network','history','settings'].forEach(k=>{el('view-'+k).hidden=k!==name;el('tab-'+k).setAttribute('aria-selected',String(k===name));});
  render();
}
function render() {
  if(!state)return;
  const st=stats(),d=day(),settings=learningSettings(state),f=forecastPlan(state);
  el('today-heading').textContent=`${d} · 今日安排`;
  el('stat-due').textContent=st.due.length;el('stat-today').textContent=st.all.size;
  el('stat-seen').textContent=state.words.filter(w=>state.cards[w.id].seen).length;el('stat-new').textContent=st.newCount;
  const verified=state.words.filter(w=>state.cards[w.id].reviewCount>0).length;
  el('baseline-note').textContent=`常规词表 1,493 条，按原表顺序；List 仅作分组，不限制每日词量。目前 ${verified} 条有逐词反馈。${state.baseline.ids.length?` 另有 ${state.baseline.ids.length} 条从旧备份匹配的补记。`:''}`;
  const overdue=st.due.filter(w=>state.cards[w.id].due<d).length;
  el('plan-note').textContent=st.due.length?`旧词到期 ${st.due.length} 词${overdue?`，其中逾期 ${overdue} 词`:''}。每组最多50词，剩余保留；每日复习参考量 ${state.settings.dailyTarget}，不抵扣新词名额。`:'今天暂无到期旧词，可以按自己的计划学习新词。';
  el('catalogue-summary').textContent=`常规词库 ${catalogue.length} 个List · ${initialWords.length} 词`;
  el('list-plan-title').textContent='今日新词任务';
  el('list-plan-rows').innerHTML=`<div class="plan-mini-progress"><span>今日目标 <strong>${st.plan.target}</strong> 词</span><span>已新学 <strong>${st.plan.done}</strong> 词</span><span>还可新学 <strong>${st.newCount}</strong> 词</span></div>`+st.plan.groups.map(g=>`<div class="history-row"><strong>${escape(g)}</strong><span>今日待学 ${st.newWords.filter(w=>w.group===g).length} 词</span><span class="muted">继续原词序</span></div>`).join('');
  el('list-plan-note').textContent=st.newCount?'按设置的词数精确安排，每组最多50词；不必凑满或背完整个List。':f.remaining===0?(f.excluded?'当前计划首轮已覆盖，暂停或未入计划的词尚未计入。':'首轮新学已完成，继续巩固到期词。'):!settings.dailyNew?'新词已暂停，未学词保留。可在“调整计划”中恢复。':!isStudyDay(d,settings)?'今天是只复习日，下一学习日继续安排新词。':'今日新词额度已完成。继续完成待巩固词，或调整计划增加新词。';
  const running=unfinished(state.session);
  el('start-plan').hidden=Boolean(running)||!st.due.length;el('continue-session').classList.add('primary');
  el('start-new').textContent=st.newCount?`开始新学（本组 ${Math.min(50,st.newCount)} 词）`:'今日暂无待学新词';
  el('start-new').disabled=!st.newCount||Boolean(running)||blocked||Boolean(damaged&&!recovered);
  if(running)el('list-plan-note').textContent+=' 当前任务断点已保留，先继续当前组。';
  el('continue-session').hidden=!running;el('continue-session').textContent=running?`继续上次任务（剩余 ${state.session.queue.length-state.session.cursor} 次呈现）`:'继续上次任务';
  el('start-plan').disabled=Boolean(damaged&&!recovered)||(!running&&!st.due.length&&!st.newCount)||blocked;
  el('start-plan').textContent=running?'继续当前任务':st.due.length?`开始到期复习（本组 ${Math.min(50,st.due.length)} 词）`:'今日暂未到期';
  el('last-backup').textContent=state.meta.lastBackupAt?`上次下载备份：${day(new Date(state.meta.lastBackupAt))}`:'尚未下载独立备份';
  el('backup-note').textContent=state.meta.lastBackupAt?`上次发起备份下载：${new Date(state.meta.lastBackupAt).toLocaleString('zh-CN',{hour12:false})}。请确认文件已落在下载目录。`:'建议每次结束下载一份备份。浏览器自动保存和本机快照不能抵御浏览器数据清理。';
  renderLearningPlan();renderStudy();
  if(tab==='library')renderLibrary();if(tab==='network')renderNetwork();if(tab==='history')renderHistory();
  if(tab==='settings' && !['daily-target','default-mode'].some(id=>document.activeElement===el(id))) {el('daily-target').value=state.settings.dailyTarget;el('default-mode').value=state.settings.mode;}
  ['save-settings','add-words','enroll-selected','save-detail','merge-import','replace-import','open-plan-home','open-plan-settings'].forEach(id=>{el(id).disabled=blocked;});
  storageStatus();
}
function renderStudy() {
  const s=state.session,running=unfinished(s),done=s&&!running;
  el('study').hidden=!running||!expanded;el('session-finished').hidden=!done||!expanded;
  if(done){const st=stats();el('finish-note').textContent=`本组反馈已记录。${st.newCount?`今日还可新学 ${st.newCount} 词。`:'今天暂无剩余新词任务。'}${st.due.length?` 还有 ${st.due.length} 个到期词，可分次继续。`:' 现有到期词已处理。'}`;el('finish-undo').disabled=!state.undo;}
  if(!running)return;
  const q=s.queue[s.cursor],w=wordById(q.id),c=state.cards[q.id],m=memoryFor(w);
  const mode=s.mode==='cloze'&&!w.sentence.trim()?'meaning':s.mode;
  el('session-label').textContent=s.kind==='schedule'?(s.source==='new'?'顺序新学 · 熟词搭桥 → 联想 → 回忆':'到期复习 · 先自己回忆，再看线索'):'自主回顾 · 保留反馈，不改长期日期';
  el('shuffle').hidden=s.kind!=='free';el('shuffle').disabled=blocked||s.queue.length-s.cursor<2;
  el('session-progress').max=s.queue.length;el('session-progress').value=s.cursor;
  el('position').textContent=`${w.group} · 第 ${s.cursor+1} / ${s.queue.length} 次呈现${q.kind==='repeat'?' · 当轮重现':''}`;
  el('current-rating').textContent=c.lastGrade?`最近反馈：${LABEL[c.lastGrade]}`:c.legacyGrade?`旧版最后标记：${LABEL[c.legacyGrade]}`:'尚无逐词反馈';
  el('study-mode').value=s.mode;el('favorite').textContent=c.favorite?'★ 已收藏':'☆ 收藏';el('favorite').setAttribute('aria-pressed',String(c.favorite));
  el('word').textContent=['context','mnemonic'].includes(mode)||s.shown?w.word:mode==='meaning'?w.meaning:'先回忆目标词';
  el('sentence').hidden=(mode==='meaning'||mode==='mnemonic')&&!s.shown;
  el('sentence').innerHTML=escape(w.sentence).replace(new RegExp(regex(w.word),'i'),x=>mode==='cloze'&&!s.shown?'<span class="blank">______</span>':`<mark>${x}</mark>`);
  el('spelling-box').hidden=mode!=='meaning'||s.shown;el('spelling').value=s.typed;
  el('spelling-label').textContent='看中文回忆拼写（独立模式）';
  el('word').classList.remove('can-hide');
  
  if(mode==='mnemonic')el('word').textContent=w.word;
  el('clue-box').hidden=s.shown;el('clue-text').hidden=!s.hintShown;el('clue-text').textContent=s.hintShown?(m.rejected&&!m.personal?'这条内置线索已被你停用，请在词条中写自己的线索。':m.anchor):'';
  el('show-clue').textContent=s.hintShown?'收起熟词线索':'想不起来？看熟词线索';
  el('reveal').hidden=s.shown;el('answer').hidden=!s.shown;
  el('meaning').textContent=`${w.word} · ${w.meaning}`;el('phonetic').textContent=w.phonetic+(w.phoneticNote?' · '+w.phoneticNote:'');
  el('current-note').textContent=c.note?`我的笔记：${c.note}`:'';
  el('spelling-result').textContent=s.typed?(normalize(s.typed)===normalize(w.word)?'拼写正确。再检查是否能说出意思和对应画面。':`你的拼写：${s.typed}。目标：${w.word}。核对空格、字母和词尾。`):'';
  el('memory-card').hidden=!s.shown;el('memory-card').innerHTML=s.shown?memoryHTML(w):'';
  el('word-source').textContent=w.sourceRow?`原表第 ${w.sourceRow} 行 · ${w.part} · 考察 ${w.frequency} 篇 · 常规 ${w.letter}`:'自己的补充词';
  document.querySelectorAll('[data-grade]').forEach(b=>b.disabled=blocked||Boolean(damaged&&!recovered));
  el('mark-mastered').disabled=Boolean(c.mastered)||blocked||Boolean(damaged&&!recovered);el('mark-mastered').firstChild.textContent=c.mastered?'已熟知':'标记熟知';
  el('undo').disabled=!state.undo||blocked;
  el('feedback-hint').textContent=s.shown?`认识：独立想起；模糊：依靠提示；忘记：仍想不起来。${c.due?` 下次日期：${c.due}`:''}`:'可以直接选择忘记、模糊或认识；需要帮助时再展开巧记。';
}
function newSession(items,kind,source='review') { return {id:uid(),kind,source,day:day(),mode:state.settings.mode,queue:items,cursor:0,shown:false,typed:'',hintShown:false,wordCovered:false,initialCount:items.length,updatedAt:now()}; }
function startNew() {
  if(state.session&&state.session.day!==day()){commit(s=>{s.session=null;s.undo=null;});expanded=false;}
  if(unfinished(state.session)){message('当前这一组尚未完成，请先继续；断点不会被覆盖。');return;}
  const st=stats(),items=st.newWords.slice(0,50).map(w=>({id:w.id,kind:'new'}));
  if(!items.length){message('今天没有剩余新词额度，可进行到期复习或调整学习计划。');return;}
  expanded=true;commit(s=>{s.session=newSession(items,'schedule','new');s.undo=null;});showTab('today');
}
function startPlan() {
  if(state.session && state.session.day!==day()) {commit(s=>{s.session=null;s.undo=null;});expanded=false;message('已跨日，按当前到期日期重排。未完成词仍保留。');}
  if(unfinished(state.session)) { expanded=true;showTab('today');el('study').scrollIntoView({block:'start',behavior:'smooth'});return; }
  const st=stats(),items=st.due.slice(0,50).map(w=>({id:w.id,kind:'review'}));
  if(!st.due.length&&st.newCount){startNew();return;}
  if(!items.length){message('今天没有需要安排的词，可以自主回顾或休息。');return;}
  expanded=true;commit(s=>{s.session=newSession(items,'schedule');s.undo=null;});showTab('today');
}
function startFree(ids=null) {
  if(unfinished(state.session) && !confirm('当前任务尚未结束。改为自主回顾会重建当前队列，已保存的逐词记录和到期日期都会保留。继续吗？'))return;
  if(!ids) { const weak=state.words.filter(w=>{const c=state.cards[w.id];return !c.mastered&&['again','hard'].includes(c.lastGrade||c.legacyGrade);});ids=(weak.length?weak:state.words.filter(w=>state.cards[w.id].seen&&!state.cards[w.id].mastered)).map(w=>w.id); }
  ids=[...new Set(ids)].filter(id=>Boolean(wordById(id)));
  if(!ids.length){message('这个范围没有词可回顾。');return;}
  expanded=true;commit(s=>{s.session=newSession(ids.map(id=>({id,kind:'free'})),'free');s.undo=null;});showTab('today');
}
function removeMasteredFromSession(s) {
  const session=s.session;
  if(!unfinished(session)||session.kind!=='schedule')return;
  const old=session.queue[session.cursor];
  session.queue=[...session.queue.slice(0,session.cursor),...session.queue.slice(session.cursor).filter(q=>!s.cards[q.id].mastered)];
  if(session.queue[session.cursor]?.id!==old.id){session.shown=false;session.typed='';session.hintShown=false;session.cueSeen=false;}
}
function masteryEvent(s,id,grade,session=null) {
  const c=s.cards[id],e={id:uid(),wordId:id,at:now(),day:day(),grade,kind:'mastery',nextDue:c.due,interval:c.interval,answerViewed:Boolean(session?.shown),hintUsed:Boolean(session?.cueSeen||session?.hintShown)};
  s.history.push(e);return e;
}
function markMastered() {
  flushSpelling();
  const current=state.session;
  if(!unfinished(current))return;
  if(current.day!==day()){commit(s=>{s.session=null;s.undo=null;});expanded=false;render();message('已跨日，请重新开始今日安排；刚才的卡片没有标记。');return;}
  const id=current.queue[current.cursor].id,word=wordById(id).word;
  if(state.cards[id].mastered)return;
  if(commit(s=>{
    const c=s.cards[id],before=copy(c),sessionBefore=copy(s.session),session=s.session;
    c.mastered=true;c.masteryUpdatedAt=now();c.seen=true;c.due=null;c.interval=0;c.updatedAt=now();
    const e=masteryEvent(s,id,'mastered',session);
    session.cursor++;
    session.queue=[...session.queue.slice(0,session.cursor),...session.queue.slice(session.cursor).filter(q=>q.id!==id)];
    session.shown=false;session.typed='';session.hintShown=false;session.cueSeen=false;session.updatedAt=now();
    s.undo={wordId:id,card:before,session:sessionBefore,eventId:e.id};
  }))message(`已将 ${word} 标记熟知，不再自动安排复习。误点可撤销；也可在词库“熟知词”中恢复复习。`);
}
function restoreMastered(s,id) {
  const c=s.cards[id];if(!c.mastered)return false;
  c.mastered=false;c.masteryUpdatedAt=now();c.planned=true;c.suspended=false;c.seen=true;
  c.due=day();c.interval=0;c.lastScheduledDay=null;c.updatedAt=now();
  masteryEvent(s,id,'restore');s.undo=null;return true;
}

function grade(value) {
  flushSpelling();
  if(state.session && state.session.day!==day()) {commit(s=>{s.session=null;s.undo=null;});expanded=false;render();message('已跨日，请重新开始今日安排；刚才的卡片没有记作反馈。');return;}
  const s=state.session;if(!unfinished(s)||!GRADES.includes(value))return;
  const q=s.queue[s.cursor],id=q.id,c=state.cards[id],date=day();
  commit(d=>{
    const before=copy(c),sessionBefore=copy(s),first=s.kind==='schedule'&&c.lastScheduledDay!==date;
    const eventKind=s.kind==='free'?'free':first?(c.seen?'review':'new'):'repeat';
    if(first) {
      if(value==='good') {c.streak=Math.min(c.streak+1,7);c.interval=[1,3,7,14,30,60,120][c.streak-1];}
      else {c.streak=value==='again'?0:Math.max(0,c.streak-1);c.interval=1;if(value==='again')c.lapses++;}
      c.due=addDays(date,c.interval);c.lastScheduledDay=date;c.seen=true;if(!c.learnedOn)c.learnedOn=date;
    }
    c.lastGrade=value;c.lastSeen=now();c.updatedAt=now();c.reviewCount++;
    const e={id:uid(),wordId:id,at:now(),day:date,grade:value,kind:eventKind,nextDue:c.due,interval:c.interval,answerViewed:Boolean(s.shown),hintUsed:Boolean(s.cueSeen||s.hintShown)};d.history.push(e);
    if(value!=='good' && !s.queue.slice(s.cursor+1).some(x=>x.id===id)) {
      const offset=value==='again'?3:5,at=Math.min(s.cursor+1+offset,s.queue.length);
      s.queue.splice(at,0,{id,kind:s.kind==='free'?'free':'repeat'});
    }
    s.cursor++;s.shown=false;s.typed='';s.hintShown=false;s.cueSeen=false;s.wordCovered=false;s.updatedAt=now();
    d.undo={wordId:id,card:before,session:sessionBefore,eventId:e.id};
  });
}
function undo() {
  const u=state.undo;if(!u||state.history.at(-1)?.id!==u.eventId){message('没有可以撤销的最后一次反馈。');return;}
  expanded=true;commit(s=>{s.cards[u.wordId]=u.card;s.session=u.session;s.history.pop();s.undo=null;});message('已撤销最后一次反馈，日期和队列一并恢复。');
}
function filteredWords() {
  const term=normalize(el('search').value),group=el('list').value,scope=el('scope').value;
  return state.words.filter(w=>{const c=state.cards[w.id];return (group==='all'||w.group===group)&&(!term||normalize(w.word+' '+w.meaning+' '+c.note+' '+memoryFor(w).anchor+' '+memoryFor(w).scene).includes(term))&&(scope==='all'||scope==='mastered'&&c.mastered||scope==='due'&&active(c)&&c.seen&&c.due<=day()||scope==='weak'&&!c.mastered&&['again','hard'].includes(c.lastGrade||c.legacyGrade)||scope==='favorite'&&c.favorite||scope==='new'&&!c.seen||scope==='unplanned'&&!c.planned||scope==='paused'&&c.suspended);});
}
function renderLibrary() {
  const groups=[...new Set(state.words.map(w=>w.group))],prev=el('list').value;
  el('list').innerHTML='<option value="all">全部分组</option>'+groups.map(g=>`<option value="${escape(g)}">${escape(g)}</option>`).join('');el('list').value=groups.includes(prev)?prev:'all';
  const words=filteredWords(),pages=Math.max(1,Math.ceil(words.length/25));libraryPage=Math.min(libraryPage,pages-1);
  const items=words.slice(libraryPage*25,(libraryPage+1)*25);
  el('word-list').innerHTML=items.length?items.map(w=>{const c=state.cards[w.id],status=c.mastered?'已熟知 · 不再安排复习':c.suspended?'已暂停':!c.planned?'未加入计划':!c.seen?'未学':c.reviewCount===0?'已接触 · 待验证':LABEL[c.lastGrade]||'已接触';return `<div class="word-row"><input type="checkbox" aria-label="选择 ${escape(w.word)}" data-select="${escape(w.id)}" ${selected.has(w.id)?'checked':''}><button class="word-open" data-open="${escape(w.id)}">${escape(w.word)}${c.favorite?' ★':''}<div class="meta">${escape(w.meaning)}</div></button><span class="meta">${escape(status)}<br>${escape(w.group)}${c.due&&active(c)?`<br>下次 ${escape(c.due)}`:''}</span></div>`;}).join(''):'<p class="muted">这个筛选范围没有词。</p>';
  el('library-page').textContent=`${words.length} 词 · 第 ${libraryPage+1} / ${pages} 页`;
  el('library-prev').disabled=libraryPage===0;el('library-next').disabled=libraryPage===pages-1;
  el('selected-count').textContent=`已选 ${selected.size} 词`;el('select-page').checked=items.length>0&&items.every(w=>selected.has(w.id));
}
function openDetail(id) {
  const w=wordById(id);if(!w)return;detailId=id;const c=state.cards[id];
  el('detail-word').textContent=w.word;el('detail-meaning').textContent=w.meaning+' '+w.phonetic+(w.phoneticNote?' · '+w.phoneticNote:'');el('detail-sentence').textContent=w.sentence;
  el('detail-status').textContent=`${w.group} · ${c.mastered?'已熟知':c.seen?'已接触':'尚未学'} · ${c.mastered?'不再自动安排复习':c.due?'下次 '+c.due:'暂无复习日期'} · 已记录反馈 ${c.reviewCount} 次${c.legacyGrade?' · 旧版最后标记 '+LABEL[c.legacyGrade]:''}`;
  el('detail-memory').innerHTML=memoryHTML(w,'detail');el('detail-source').textContent=w.sourceRow?`原表第 ${w.sourceRow} 行 · ${w.part} · 考察 ${w.frequency} 篇`:'';el('detail-anchor').value=c.memoryAnchor||'';el('detail-scene').value=c.memoryScene||'';el('detail-note').value=c.note;el('detail-favorite').checked=c.favorite;el('detail-suspended').checked=c.suspended;el('restore-mastered').hidden=!c.mastered;el('restore-mastered').disabled=blocked||Boolean(damaged&&!recovered);el('detail-events').textContent='';el('word-dialog').showModal();
}
function renderHistory() {
  const feedback=state.history.filter(e=>e.kind!=='mastery'),n=feedback.length,unique=new Set(feedback.map(e=>e.wordId)).size;
  el('history-summary').textContent=`新版累计 ${n} 次反馈，涉及 ${unique} 词；当前 ${state.words.filter(w=>state.cards[w.id].mastered).length} 个熟知词。另有 ${state.baseline.ids.length} 词的一轮补记，以及 ${state.meta.migrated} 词旧版最后标记。补记不计算“认识率”。`;
  const st=stats(),counts=Array.from({length:7},(_,i)=>i===0?st.due.length:state.words.filter(w=>{const c=state.cards[w.id];return active(c)&&c.seen&&c.due===addDays(day(),i);}).length),max=Math.max(1,...counts);
  el('forecast').innerHTML=counts.map((n,i)=>`<div aria-label="${i?addDays(day(),i):'今天含逾期'}：${n}词"><strong>${n}</strong><div class="bar-slot"><div class="bar" style="height:${Math.max(2,Math.round(n/max*80))}px"></div></div><span>${i?addDays(day(),i).slice(5):'今天'}</span></div>`).join('');
  el('daily-history').innerHTML=Array.from({length:14},(_,i)=>{const date=addDays(day(),-i),x=stats(date),manual=state.baseline.date===date?state.baseline.ids.length:0;return `<div class="history-row"><span>${date}</span><span>${x.all.size} 词 · ${x.events.length} 次反馈</span><span class="muted">${manual?`其中 ${manual} 词为本人补记`:'按实际逐词反馈记录'}</span></div>`;}).join('');
  const items=[...state.history].reverse(),pages=Math.max(1,Math.ceil(items.length/20));historyPage=Math.min(historyPage,pages-1);
  el('event-history').innerHTML=items.slice(historyPage*20,(historyPage+1)*20).map(eventHTML).join('')||'<p class="muted">新版还没有逐次反馈。从这里开始记录每一次真实反馈。</p>';
  el('history-page').textContent=`第 ${historyPage+1} / ${pages} 页`;el('history-prev').disabled=historyPage===0;el('history-next').disabled=historyPage===pages-1;
}
function eventHTML(e) { const w=wordById(e.wordId);return `<div class="history-row"><span>${escape(e.day)}<br><span class="muted">${new Date(e.at).toLocaleTimeString('zh-CN',{hour12:false})}</span></span><strong>${escape(w.word)} · ${LABEL[e.grade]}</strong><span class="muted">${{new:'首次新学',review:'到期复习',repeat:'当轮重现',free:'自主回顾',mastery:'熟知状态操作'}[e.kind]}${e.nextDue?` · 下次 ${e.nextDue}`:''}</span></div>`; }
function download(content,name,type) { if(nativeEnabled){VocabNative.call('export',{content,name,type});return;} const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000); }
function backup(portable=false,mark=true) { if(portable&&nativeEnabled){message('桌面／手机版本请导出完整 JSON；安装包与学习记录分别备份。');return;}
  flushSpelling();
  if(mark)commit(s=>{s.meta.lastBackupAt=now();},false);
  const raw=envelope(state),stamp=day()+'_'+new Date().toTimeString().slice(0,8).replaceAll(':','-');
  if(portable) {
    const root=document.documentElement.cloneNode(true);root.querySelector('#portable-state').textContent=raw.replace(/</g,'\\u003c');
    root.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));
    download('<!doctype html>\n'+root.outerHTML,`九分常规联想_含进度_${stamp}.html`,'text/html;charset=utf-8');
  } else download(raw,`九分常规联想_完整备份_${stamp}.json`,'application/json;charset=utf-8');
  render();message('已发起备份下载，请确认文件已保存到下载目录。');
}
function legacyFile(obj) {
  assert(object(obj)&&obj.source==='预备级List1-4'&&Array.isArray(obj.records)&&obj.records.length<=200,'无法识别旧版复习记录。');
  const names=new Set();for(const r of obj.records) { assert(object(r)&&typeof r.word==='string'&&['known','hesitant','unknown','unreviewed'].includes(r.status)&&!names.has(normalize(r.word)),'旧版记录的单词或标记不正确。');names.add(normalize(r.word)); }
  return obj.records;
}
function previewImport(value) {
  pendingImport=value;
  const s=value.state,isV2=value.type==='v2';
  el('import-preview').textContent=isV2?`${s.words.length} 个词 · ${s.history.length} 次逐词反馈 · 备份更新于 ${new Date(s.updatedAt).toLocaleString('zh-CN',{hour12:false})} · ${unfinished(s.session)?'含未完成任务断点':'没有未完成任务'}`:`旧版记录 ${value.records.length} 词。只能恢复最后标记，旧版未记录的时间与轮次无法恢复。`;
  el('import-description').textContent=isV2?'合并：去重历史，逐词采用时间较新的状态，保留当前设置，重新生成任务。整份恢复：先下载当前记录，再用这份备份替换，并保留其断点。':'旧版标记按英文匹配，只补充尚无新版反馈的词；已有新版反馈不会被旧标记覆盖。';
  if(value.previous)el('import-description').textContent=`旧软件备份已按英文精确匹配：保留常规词表内 ${s.meta.previousImport.matched} 条，排除非本词表 ${s.meta.previousImport.excluded} 条。词形、单复数分别匹配，旧任务断点重新安排。`;el('replace-import').hidden=!isV2||Boolean(value.previous);el('merge-import').textContent=isV2?'合并恢复':'导入旧版标记';el('import-dialog').showModal();
}
function mergedState(a,b) {
  const out=copy(a),byName=new Map(out.words.map(w=>[normalize(w.word),w.id])),mapping=new Map();
  for(const w of b.words) {
    let id=byName.get(normalize(w.word));
    if(!id) {id=Object.hasOwn(out.cards,w.id)?'import:'+uid():w.id;out.words.push({...copy(w),id});out.cards[id]=copy(b.cards[w.id]);byName.set(normalize(w.word),id);}
    else {
      const ca=out.cards[id],cb=b.cards[w.id],latest=(cb.updatedAt||'')>(ca.updatedAt||'')?cb:ca;
      const result=copy(latest),learning=(cb.lastSeen||'')>(ca.lastSeen||'')?cb:ca;
      for(const k of ['seen','due','interval','streak','lastGrade','lastScheduledDay','learnedOn','lastSeen','reviewCount','lapses'])result[k]=copy(learning[k]);
      const mastery=(cb.masteryUpdatedAt||'')>(ca.masteryUpdatedAt||'')?cb:ca;
      if(mastery.masteryUpdatedAt){result.mastered=Boolean(mastery.mastered);result.masteryUpdatedAt=mastery.masteryUpdatedAt;}
      if(result.mastered){result.seen=true;result.due=null;result.interval=0;}
      else if(result.seen&&result.due===null){result.due=day();result.interval=0;result.lastScheduledDay=null;}
      result.legacyGrade=result.legacyGrade||ca.legacyGrade||cb.legacyGrade;
      out.cards[id]=result;
    }
    mapping.set(w.id,id);
  }
  const events=new Map(out.history.map(e=>[e.id,e]));for(const e of b.history)if(!events.has(e.id))events.set(e.id,{...copy(e),wordId:mapping.get(e.wordId)});
  out.history=[...events.values()].sort((x,y)=>x.at.localeCompare(y.at));out.session=null;out.undo=null;
  const counts=new Map();for(const e of out.history)if(e.kind!=='mastery')counts.set(e.wordId,(counts.get(e.wordId)||0)+1);for(const w of out.words)out.cards[w.id].reviewCount=counts.get(w.id)||0;
  out.meta.migrated=out.words.filter(w=>out.cards[w.id].legacyGrade).length;
  return validate(out);
}
function restoreImport(replace) {
 if(nativeEnabled&&usbDocument&&((usbDocument.operations||[]).length||state.history.length)){message('此入口只用于首次迁移到空白档案。已有记录请使用 USB 同步；恢复旧备份需先另存并建立独立档案，避免覆盖两端操作。',true);return;}
  if(!pendingImport)return;
  const value=pendingImport;
  if(value.type==='legacy') {
    commit(s=>{let count=0;for(const r of value.records) {const w=s.words.find(w=>normalize(w.word)===normalize(r.word));if(w&&LEGACY[r.status]&&s.cards[w.id].reviewCount===0){s.cards[w.id].legacyGrade=LEGACY[r.status];count++;}}s.meta.migrated=s.words.filter(w=>s.cards[w.id].legacyGrade).length;s.undo=null;});
    message('旧版最后标记已保留，已有新版反馈没有覆盖。');
  } else {
    const incoming=copy(value.state),result=replace?incoming:mergedState(state,incoming);
    syncCatalogue(result);
    if(replace && !confirm('用这份备份整份恢复当前进度？操作前会下载一份当前记录；请选择确认后检查下载文件。'))return;
    backup(false,false);
    if(damaged&&!recovered){download(damaged,'词汇记录_故障原文.txt','text/plain');recovered=true;}
    const rev=state.revision;
    if(nativeEnabled&&usbDocument&&!(usbDocument.operations||[]).length&&state.history.length===0){usbDocument=null;}
    commit(s=>{Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,result);s.revision=rev;s.writer=tabId;});
    expanded=unfinished(state.session);el('fatal').hidden=true;message(replace?'已恢复整份备份，断点保留。':'已合并恢复。历史按编号去重，接下来重新安排任务。');
  }
  el('import-dialog').close();pendingImport=null;render();
}

document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
el('start-plan').addEventListener('click',startPlan);el('continue-session').addEventListener('click',startPlan);
el('start-new').addEventListener('click',startNew);
el('mark-mastered').addEventListener('click',markMastered);
el('restore-mastered').addEventListener('click',()=>{if(!state.cards[detailId]?.mastered)return;if(commit(s=>restoreMastered(s,detailId))){el('word-dialog').close();message('已取消熟知，恢复为今日待复习；笔记和历史保留。');}});
el('free-review').addEventListener('click',()=>startFree());
el('pause-session').addEventListener('click',()=>{expanded=false;render();message('已保留当前任务，随时可以继续。');});
el('shuffle').addEventListener('click',()=>commit(s=>{if(!unfinished(s.session)||s.session.kind!=='free')return;const a=s.session.queue;for(let i=a.length-1;i>s.session.cursor;i--){const j=s.session.cursor+Math.floor(Math.random()*(i-s.session.cursor+1));[a[i],a[j]]=[a[j],a[i]];}s.session.shown=false;s.session.typed='';s.session.updatedAt=now();s.undo=null;}));
el('reveal').addEventListener('click',()=>commit(s=>{if(unfinished(s.session)){s.session.shown=true;s.session.updatedAt=now();}}));
document.querySelectorAll('[data-grade]').forEach(b=>b.addEventListener('click',()=>grade(b.dataset.grade)));
el('undo').addEventListener('click',undo);el('finish-undo').addEventListener('click',undo);
el('study-mode').addEventListener('change',()=>commit(s=>{s.session.mode=el('study-mode').value;s.session.shown=false;s.session.typed='';s.session.hintShown=false;s.session.cueSeen=false;s.session.wordCovered=false;s.session.updatedAt=now();}));
el('spelling').addEventListener('input',()=>{if(!unfinished(state.session)||blocked||damaged&&!recovered)return;state.session.typed=el('spelling').value.slice(0,150);state.session.updatedAt=now();state.updatedAt=now();state.revision++;state.writer=tabId;changedInMemory=true;clearTimeout(spellingTimer);spellingTimer=setTimeout(()=>{spellingTimer=null;persist();},250);});
el('favorite').addEventListener('click',()=>commit(s=>{const c=s.cards[s.session.queue[s.session.cursor].id];c.favorite=!c.favorite;c.updatedAt=now();s.undo=null;}));
el('finish-next').addEventListener('click',()=>{const wasNew=state.session?.source==='new';expanded=false;render();if(wasNew&&stats().newCount)startNew();else if(wasNew)message('今日新词额度已完成，可以进行到期复习或调整计划。');else startPlan();});el('finish-backup').addEventListener('click',()=>backup());
['search','list','scope'].forEach(id=>el(id).addEventListener(id==='search'?'input':'change',()=>{libraryPage=0;renderLibrary();}));
el('library-prev').addEventListener('click',()=>{libraryPage--;renderLibrary();});el('library-next').addEventListener('click',()=>{libraryPage++;renderLibrary();});
el('word-list').addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(b)openDetail(b.dataset.open);});
el('word-list').addEventListener('change',e=>{if(e.target.matches('[data-select]')){const id=e.target.dataset.select;e.target.checked?selected.add(id):selected.delete(id);renderLibrary();}});
el('select-page').addEventListener('change',()=>{filteredWords().slice(libraryPage*25,(libraryPage+1)*25).forEach(w=>el('select-page').checked?selected.add(w.id):selected.delete(w.id));renderLibrary();});
el('enroll-selected').addEventListener('click',()=>{if(!selected.size){message('先选择要加入计划的词。');return;}commit(s=>{for(const id of selected){restoreMastered(s,id);s.cards[id].planned=true;s.cards[id].suspended=false;s.cards[id].updatedAt=now();}s.undo=null;});message(`已将 ${selected.size} 词加入或恢复计划。`);});
el('practice-selected').addEventListener('click',()=>{if(!selected.size){message('先选择要回顾的词。');return;}startFree([...selected]);});
el('practice-filter').addEventListener('click',()=>startFree(filteredWords().map(w=>w.id)));
el('close-detail').addEventListener('click',()=>el('word-dialog').close());
el('save-detail').addEventListener('click',()=>{commit(s=>{const c=s.cards[detailId];c.note=el('detail-note').value.trim();c.memoryAnchor=el('detail-anchor').value.trim();c.memoryScene=el('detail-scene').value.trim();c.favorite=el('detail-favorite').checked;c.suspended=el('detail-suspended').checked;c.updatedAt=now();s.undo=null;});el('word-dialog').close();message('我的联想、笔记和状态已保存。');});
el('detail-history').addEventListener('click',()=>{el('detail-events').innerHTML=state.history.filter(e=>e.wordId===detailId).slice(-30).reverse().map(eventHTML).join('')||'<p class="muted small">这个词还没有新版逐词反馈。</p>';});
el('add-words').addEventListener('click',()=>{
  try {
    const group=el('new-group').value.trim(),lines=el('new-words').value.trim().split(/\r?\n/).filter(x=>x.trim());
    assert(group&&group.length<=80,'请填写分组名。');assert(lines.length>0&&lines.length<=500,'一次请加入1–500个词。');
    const known=new Set(state.words.map(w=>normalize(w.word))),items=[];let skipped=0;
    lines.forEach((line,i)=>{const fields=line.includes('\t')?line.split('\t'):line.split('|');assert(fields.length>=2&&fields.length<=3,`第${i+1}行需为：英文 | 中文 | 英文短句。`);const [word,meaning,sentence='']=fields.map(x=>x.trim());assert(word&&word.length<=120&&meaning&&meaning.length<=4000&&sentence.length<=4000,`第${i+1}行内容为空或过长。`);if(known.has(normalize(word))){skipped++;return;}known.add(normalize(word));items.push({id:'custom:'+uid(),group,word,meaning,sentence,phonetic:''});});
    assert(state.words.length+items.length<=10000,'词库上限为10000词，请分开管理更大的词库。');
    commit(s=>{for(const w of items){s.words.push(w);s.cards[w.id]=blankCard(false);}s.undo=null;});
    el('new-words').value='';renderLibrary();el('list').value=group;message(`已加入 ${items.length} 个未选词，跳过 ${skipped} 个重复词。选中后加入计划即可安排新学。`);renderLibrary();
  }catch(e){message(e.message,true);}
});
el('save-settings').addEventListener('click',()=>{const target=Number(el('daily-target').value);if(!integer(target,1,500)){message('每日复习参考量请填1–500。',true);return;}const mode=el('default-mode').value;if(commit(s=>{s.settings.dailyTarget=target;s.settings.mode=mode;}))message('复习参考量与默认回忆方式已保存。新词计划可单独调整。');});
el('history-prev').addEventListener('click',()=>{historyPage--;renderHistory();});el('history-next').addEventListener('click',()=>{historyPage++;renderHistory();});
el('export').addEventListener('click',()=>backup());el('portable-export').addEventListener('click',()=>backup(true));
el('import-file').addEventListener('change',async()=>{
  const file=el('import-file').files[0];if(!file)return;
  try {assert(file.size<=30*1024*1024,'备份超过30MB，请检查是否选错文件。');const raw=await file.text(),obj=JSON.parse(raw);if(obj.format===PREVIOUS_APP){previewImport({type:'v2',state:projectPrevious(decode(raw,true)),previous:true});}else previewImport(obj.format===APP?{type:'v2',state:decode(raw)}:{type:'legacy',records:legacyFile(obj)});}
  catch(e){message('导入失败，原记录未改动：'+e.message,true);}finally{el('import-file').value='';}
});
el('merge-import').addEventListener('click',()=>{try{restoreImport(false)}catch(e){message('恢复失败，原记录未改动：'+e.message,true);}});
el('replace-import').addEventListener('click',()=>{try{restoreImport(true)}catch(e){message('恢复失败，原记录未改动：'+e.message,true);}});
el('cancel-import').addEventListener('click',()=>{el('import-dialog').close();pendingImport=null;});
el('restore-local').addEventListener('click',()=>{try{const raw=localStorage.getItem(PREVIOUS);assert(raw,'本机还没有上一份快照。');previewImport({type:'v2',state:decode(raw)});}catch(e){message(e.message,true);}});
el('download-damaged').addEventListener('click',()=>download(damaged||'没有故障原文','词汇记录_故障原文.txt','text/plain;charset=utf-8'));
el('reload-latest').addEventListener('click',()=>{if(changedInMemory)backup(false,false);location.reload();});
window.addEventListener('storage',e=>{if(e.key===KEY && e.newValue){try{const s=decode(e.newValue);if(s.writer!==tabId&&s.revision!==baseRevision){blocked=true;el('conflict').hidden=false;storageStatus();renderStudy();}}catch(_){message('另一个标签页写入的记录未通过校验，请先导出本页备份。',true);}}});
window.addEventListener('beforeunload',e=>{flushSpelling();if(changedInMemory&&!saveOK){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{flushSpelling();if(!document.hidden&&state){if(state.session&&state.session.day!==day()){commit(s=>{s.session=null;s.undo=null;});expanded=false;message('已跨日，按当前到期日期重排。未完成词仍保留。');}render();}});
el('show-clue').addEventListener('click',()=>commit(s=>{if(unfinished(s.session)){s.session.hintShown=!s.session.hintShown;if(s.session.hintShown)s.session.cueSeen=true;}}));
document.addEventListener('click',e=>{const b=e.target.closest('[data-memory-open]');if(b){const open=el('word-dialog').open;if(open)el('word-dialog').close();openDetail(b.dataset.memoryOpen);}});
el('network-families').addEventListener('click',e=>{const b=e.target.closest('[data-family]');if(b){networkFamily=b.dataset.family;renderNetwork();}});
el('network-search').addEventListener('input',renderNetwork);el('network-kind').addEventListener('change',renderNetwork);
el('practice-network').addEventListener('click',()=>startFree(JSON.parse(el('practice-network').dataset.ids||'[]')));
el('practice-detail').addEventListener('click',()=>{el('word-dialog').close();startFree([detailId]);});
el('import-local-previous').addEventListener('click',()=>readPreviousLocal());
el('export-local-previous').addEventListener('click',()=>readPreviousLocal(true));
el('open-plan-home').addEventListener('click',openLearningPlan);el('open-plan-settings').addEventListener('click',openLearningPlan);
['close-learning-plan','cancel-learning-plan'].forEach(id=>el(id).addEventListener('click',()=>el('learning-plan-dialog').close()));
el('apply-learning-plan').addEventListener('click',applyLearningPlan);
['plan-daily-new','plan-deadline'].forEach(id=>el(id).addEventListener('input',renderPlanPreview));
document.querySelectorAll('[name="study-weekday"]').forEach(c=>c.addEventListener('change',renderPlanPreview));
document.querySelectorAll('[data-new-preset]').forEach(b=>b.addEventListener('click',()=>{el('plan-daily-new').value=b.dataset.newPreset;renderPlanPreview();}));
for(const [id,days] of [['select-every-day',[0,1,2,3,4,5,6]],['select-workdays',[1,2,3,4,5]]])el(id).addEventListener('click',()=>{document.querySelectorAll('[name="study-weekday"]').forEach(c=>c.checked=days.includes(Number(c.value)));renderPlanPreview();});
el('calculate-deadline').addEventListener('click',calculateDeadline);
let lastPlanDay=day();
setInterval(()=>{if(state&&!document.hidden&&day()!==lastPlanDay){lastPlanDay=day();commit(s=>{s.session=null;s.undo=null;});expanded=false;render();if(el('learning-plan-dialog').open)renderPlanPreview();message('已进入新的一天，新词额度重新计算，未完成词保留。');}},30000);
document.addEventListener('click',e=>{const b=e.target.closest('[data-reject-cue]');if(b){commit(s=>{const c=s.cards[b.dataset.rejectCue];c.rejectBuiltinCue=!c.rejectBuiltinCue;c.updatedAt=now();});if(el('word-dialog').open)el('detail-memory').innerHTML=memoryHTML(wordById(detailId),'detail');}});
// Included inside the existing app closure, before boot().
let usbDocument=null,usbLocked=false,usbReading=false;
const nativeEnabled=VocabNative.platform!=='browser';
function showUsbStatus(text){el('usb-message').textContent=text;}
function nativeDeviceId(){return VocabNative.call('syncStatus')?.deviceId||uid();}
function primeNativeStorage(){
 if(!nativeEnabled){showUsbStatus('浏览器预览模式：USB 同步和数据库保存需使用桌面程序或 iPhone App。');return;}
 const doc=VocabNative.call('load');
 if(doc){validate(OfflineSync.materialize(doc));usbDocument=doc;}
 if(VocabNative.platform==='windows'){const status=VocabNative.call('syncStatus');if(status.phoneBundleId)el('usb-bundle').value=status.phoneBundleId;}
 showUsbStatus(VocabNative.platform==='ios'?'手机离线模式 · 所有学习操作保存到本机数据库':'电脑离线模式 · 连接手机后可同步');
}
function nativePersist(){
 const previous=usbDocument;
 try{
  if(!usbDocument)usbDocument=OfflineSync.createDocument(state,nativeDeviceId());
  else usbDocument=OfflineSync.record(usbDocument,OfflineSync.materialize(usbDocument),state);
  VocabNative.call('save',usbDocument);
  baseRevision=state.revision;lastRaw=null;saveOK=true;changedInMemory=false;
  try{localStorage.setItem(KEY,envelope(state,true));}catch(_){} // disposable UI cache; SQLite is authoritative.
  el('storage-warning').hidden=true;storageStatus();renderUsbConflicts();return true;
 }catch(e){usbDocument=previous;saveOK=false;changedInMemory=true;showUsbStatus('数据库未能保存：'+e.message);storageStatus();return false;}
}
function renderUsbConflicts(){
 const conflicts=usbDocument?.conflicts||[];
 el('usb-conflicts').innerHTML='';
 if(!conflicts.length)return;
 const intro=document.createElement('p');intro.textContent=`有 ${conflicts.length} 项离线修改冲突，请保留或合并内容：`;el('usb-conflicts').append(intro);
 for(const conflict of conflicts){
  const row=document.createElement('div');row.className='notice';
  const title=document.createElement('p');const word=state.words.find(w=>w.id===conflict.wordId);title.textContent=(word?word.word+' · ':'')+(conflict.field||conflict.path||'个人内容冲突');row.append(title);
  const values=conflict.values||conflict.versions?.map(x=>x.value)||[];
  const area=document.createElement('textarea');area.value=values.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n\n');area.setAttribute('aria-label','合并后的内容');row.append(area);
  const button=document.createElement('button');button.textContent='保存合并结果';button.addEventListener('click',()=>{try{const first=values[0],value=typeof first==='string'?area.value:JSON.parse(area.value);const next=OfflineSync.resolveConflict(usbDocument,conflict.id,value);const nextState=validate(OfflineSync.materialize(next));VocabNative.call('save',next);usbDocument=next;state=nextState;ensureDailyPlan(state);render();renderUsbConflicts();}catch(e){showUsbStatus(e.message);}});row.append(button);
  if(values.some(v=>typeof v!=='string')){values.forEach((value,i)=>{const choose=document.createElement('button');choose.textContent='采用设备 '+(i+1)+' 的值：'+JSON.stringify(value);choose.addEventListener('click',()=>{area.value=JSON.stringify(value);button.click();});row.append(choose);});}
  el('usb-conflicts').append(row);
 }
}
function setUsbLock(locked){
 usbLocked=locked;
 // Freeze the study surface while exchange snapshot and receipt are in flight.
 el('usb-workspace').inert=locked;
 el('usb-workspace').classList.toggle('usb-locked',locked);
 el('usb-finish').hidden=!locked;
 el('usb-start').disabled=locked;
 el('usb-probe').disabled=locked;el('usb-bundle').disabled=locked;
 el('usb-archive-export').disabled=locked;el('usb-archive-import').disabled=locked;
}
for(const name of ['click','keydown','input','change','submit'])document.addEventListener(name,event=>{if(usbLocked&&el('usb-workspace').contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
function acceptIncoming(){
 if(!usbLocked||usbReading||VocabNative.platform!=='ios')return;
 usbReading=true;
 try{
  const packetText=VocabNative.call('readIncoming');if(!packetText)return;
  const packet=OfflineSync.decodePacket(packetText);
  if(packet.batchId===window.lastUsbBatch)return;
  let next;
  if(packet.document.profileId!==usbDocument.profileId){
   const untouched=state.history.length===0&&state.words.every(w=>!state.cards[w.id].seen&&!state.cards[w.id].note&&!state.cards[w.id].memoryAnchor&&!state.cards[w.id].memoryScene)&&!(usbDocument.operations||[]).length;
   if(!untouched)throw new Error('学习档案不同，已拒绝覆盖手机现有记录。请先通过备份核对迁移。');
   if(!confirm('接收电脑的学习档案，用于初始化这台尚未学习的手机？'))return;
   next=OfflineSync.adoptDocument(packet.document,usbDocument.deviceId);
  }else next=OfflineSync.mergeDocuments(usbDocument,packet.document);
  const nextState=validate(OfflineSync.materialize(next));
  VocabNative.call('save',next);usbDocument=next;state=nextState;ensureDailyPlan(state);fitSessionToPlan(state);render();
  VocabNative.call('ackIncoming',{batchId:packet.batchId});window.lastUsbBatch=packet.batchId;
  showUsbStatus('手机已保存合并记录并发送确认。请查看电脑同步结果。');renderUsbConflicts();
 }catch(e){showUsbStatus('手机未完成导入：'+e.message);}finally{usbReading=false;}
}
el('usb-start').addEventListener('click',()=>{
 if(!nativeEnabled){showUsbStatus('此功能需在 iPhone App 或 Windows 桌面程序内使用。');return;}
 try{
  flushSpelling();if(!persist())throw new Error('请先解决本机保存问题');
  if(VocabNative.platform==='ios'){
   const packet=OfflineSync.encodePacket(usbDocument,uid());
   VocabNative.call('prepareSync',{document:usbDocument,packet});setUsbLock(true);showUsbStatus('已准备手机操作包，学习已暂时锁定。请在电脑点击“数据线同步”。');
  }else{
   setUsbLock(true);VocabNative.call('syncUsb',{bootstrap:el('usb-bootstrap').checked,bundleId:el('usb-bundle').value.trim()||'com.jiufen.vocabulary'});showUsbStatus('正在连接手机，请保持手机解锁且已打开同步页面。');
  }
 }catch(e){setUsbLock(false);showUsbStatus('未开始同步：'+e.message);}
});
el('usb-finish').addEventListener('click',()=>{try{VocabNative.call('finishSync');if(VocabNative.platform==='windows'){showUsbStatus('正在停止同步，等待当前传输安全结束…');return;}setUsbLock(false);showUsbStatus('已退出同步准备，可继续离线学习。若刚才未双向确认，下次请重试。');}catch(e){showUsbStatus(e.message);}});
el('usb-probe').addEventListener('click',()=>{try{VocabNative.call('probeUsb',{bundleId:el('usb-bundle').value.trim()});showUsbStatus('正在检查手机、已安装 App 和文件共享连接…');}catch(e){showUsbStatus(e.message);}});
window.addEventListener('vocab-sync-status',e=>{
 const detail=e.detail||{};showUsbStatus(detail.message||detail.phase||'同步状态更新');
 if(detail.bundleId)el('usb-bundle').value=detail.bundleId;
 if(['complete','error','timeout','cancelled'].includes(detail.phase)){
  setUsbLock(false);
  try{const doc=VocabNative.call('load');if(doc){usbDocument=doc;state=validate(OfflineSync.materialize(doc));ensureDailyPlan(state);fitSessionToPlan(state);render();renderUsbConflicts();}}catch(err){showUsbStatus('同步后载入失败：'+err.message);}
 }
});
if(VocabNative.platform==='ios'){el('usb-start').textContent='准备与电脑同步';el('usb-desktop-options').hidden=true;el('usb-probe').hidden=true;}
el('usb-archive-export').addEventListener('click',()=>{try{if(!nativeEnabled||!usbDocument)throw new Error('请先在本机 App 中建立或导入学习档案');if(!persist())return;VocabNative.call('export',{name:'九分同步档案_'+day()+'.json',content:OfflineSync.encodePacket(usbDocument,'backup-'+uid()),type:'application/json'});showUsbStatus('已发起同步档案导出。该文件保留配对身份及操作记录，请确认保存。');}catch(e){showUsbStatus(e.message);}});
el('usb-archive-import').addEventListener('change',async event=>{try{
 const file=event.target.files[0];if(!file)return;if(usbLocked)throw new Error('请先退出同步');if(!nativeEnabled)throw new Error('请在本机 App 中恢复档案');if(file.size>55*1024*1024)throw new Error('档案超过大小限制');
 const incoming=OfflineSync.decodePacket(await file.text()).document;
 let next;if(usbDocument?.profileId===incoming.profileId)next=OfflineSync.mergeDocuments(usbDocument,incoming);
 else {const meaningful=usbDocument&&((usbDocument.operations||[]).length||state?.history?.length||state?.words.some(w=>state.cards[w.id].seen));if(meaningful)throw new Error('当前已有不同的学习档案，未覆盖。请先导出并使用新的程序数据目录进行灾难恢复。');if(!confirm('将这份同步档案恢复到当前空白设备？原档案中的配对身份和操作将一并保留。'))return;next=OfflineSync.adoptDocument(incoming,nativeDeviceId());}
 validate(OfflineSync.materialize(next));VocabNative.call('save',next);location.reload();
 }catch(e){showUsbStatus('未恢复档案：'+e.message);}finally{event.target.value='';}});
setInterval(acceptIncoming,1200);
try{primeNativeStorage();}catch(e){el('usb-workspace').inert=true;showUsbStatus('本机档案无法载入，已停止学习以保护记录：'+e.message);throw e;}

boot();
window.dispatchEvent(new Event('vocab-ready'));
})();
