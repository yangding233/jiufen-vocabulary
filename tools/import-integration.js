// User wordbooks: local parsing, explicit preview, then one persisted change.
let wiWorkbook=null,wiSheetIndex=0,wiDecisions={},wiPlan=null,wiPage=0,wiSourceName='',wiSourceBytes=null,wiRevision=null,wiBusy=false,currentBookMembers=null,wiReadToken=0;
const WI_FIELDS={word:'英文单词／短语',meaning:'中文释义',phonetic:'音标',sentence:'英文例句',translation:'例句译文',chapter:'章节／List',tags:'标签',source:'来源'};
const WI_ACTIONS={new:'新建词条',link:'关联已有词',update:'更新资料',skip:'跳过',error:'资料有误',conflict:'需要选择'};
function readyWord(w){return Boolean(w&&w.meaning.trim());}
function importError(text=''){el('wi-error').hidden=!text;el('wi-error').textContent=text;}
function bookMembership(bookId){return WordBooks.view(state).members[bookId]||{};}
function renderWordbooks(){
 const library=WordBooks.view(state),books=Object.values(library.books).filter(b=>b&&!b.archived),filter=el('wordbook-filter'),previous=filter.value||'all';
 filter.innerHTML='<option value="all">全部词书</option>'+books.map(b=>`<option value="${escape(b.id)}">${escape(b.name)}</option>`).join('');filter.value=books.some(b=>b.id===previous)?previous:'all';
 const members=filter.value==='all'?null:library.members[filter.value]||{},words=members?state.words.filter(w=>members[w.id]):state.words;currentBookMembers=members;
 const chapter=el('wordbook-chapter'),old=chapter.value,chapters=members?[...new Set(Object.values(members).filter(Boolean).map(m=>m.chapter).filter(Boolean))]:[];
 chapter.innerHTML='<option value="all">全部章节</option>'+chapters.map(c=>`<option value="${escape(c)}">${escape(c)}</option>`).join('');chapter.value=chapters.includes(old)?old:'all';chapter.disabled=!members;
 const drafts=words.filter(w=>!readyWord(w)).length,seen=words.filter(w=>state.cards[w.id].seen).length;
 el('wordbook-summary').textContent=`${members?library.books[filter.value].name+' · ':''}${words.length} 词 · 已接触 ${seen} 词 · 待完善释义 ${drafts} 词。相同词条在不同词书中共用进度。`;
 el('wordbook-rename').disabled=filter.value==='all'||Boolean(library.books[filter.value]?.builtin)||blocked||usbLocked;
 const batches=Object.values(library.batches).filter(b=>b&&(filter.value==='all'||b.bookId===filter.value)).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 el('wordbook-batches').innerHTML=batches.slice(0,20).map(b=>`<div class="import-batch">${escape(b.name||'粘贴词表')} · ${escape(b.createdAt?new Date(b.createdAt).toLocaleString('zh-CN',{hour12:false}):'')}<br>新增 ${b.added||0} · 关联 ${b.linked||0} · 更新 ${b.updated||0} · 跳过 ${b.skipped||0}</div>`).join('')||'还没有导入记录。';
 const byName=new Map();for(const w of state.words){const key=normalize(w.word);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(w);}
 const duplicates=[...byName.values()].filter(ws=>ws.length>1);el('wordbook-duplicates-panel').hidden=!duplicates.length;
 el('wordbook-duplicates').innerHTML=duplicates.slice(0,30).map(ws=>`<div class="row">${ws.map(w=>`<button class="small" data-memory-open="${escape(w.id)}">${escape(w.word)} · ${escape(w.meaning||'待完善')}</button>`).join('')}</div>`).join('');
}
function matchesWordbook(w){
 const book=el('wordbook-filter').value;if(book==='all')return true;
 const member=currentBookMembers?.[w.id];return Boolean(member)&&(el('wordbook-chapter').value==='all'||member.chapter===el('wordbook-chapter').value);
}
function sortByWordbook(words){return currentBookMembers?words.sort((a,b)=>(currentBookMembers[a.id]?.order??0)-(currentBookMembers[b.id]?.order??0)||a.id.localeCompare(b.id)):words;}
function openWordImport(){
 if(usbLocked||blocked||damaged&&!recovered){message('请先完成同步或恢复可写的学习档案。',true);return;}
 const books=Object.values(WordBooks.view(state).books).filter(b=>b&&!b.archived&&!b.builtin),prev=el('wordbook-filter').value;
 el('wi-book').innerHTML='<option value="new">新建词书</option>'+books.map(b=>`<option value="${escape(b.id)}">${escape(b.name)}</option>`).join('');
 el('wi-book').value=books.some(b=>b.id===prev)?prev:'new';el('wi-book-name').disabled=el('wi-book').value!=='new';
 importError();el('word-import-dialog').showModal();
}
function selectedImportSheet(){return wiWorkbook?.sheets[wiSheetIndex];}
function importMapping(){return Object.fromEntries(Object.keys(WI_FIELDS).map(key=>[key,Number(el('wi-map-'+key).value)]));}
function renderImportColumns(reset=false){
 const sheet=selectedImportSheet();if(!sheet)return;const guessed=WordImport.guessColumns(sheet.rows),old=reset?guessed.mapping:importMapping();
 if(reset)el('wi-header').checked=guessed.header;
 const width=sheet.rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);
 el('wi-columns').innerHTML=Object.entries(WI_FIELDS).map(([key,label])=>`<label class="field">${escape(label)}<select id="wi-map-${key}" data-import-map="${key}"><option value="-1">不导入此项</option>${Array.from({length:width},(_,i)=>`<option value="${i}">第 ${i+1} 列 · ${escape(String(sheet.rows[0]?.[i]??'').slice(0,35))}</option>`).join('')}</select></label>`).join('');
 for(const key of Object.keys(WI_FIELDS))el('wi-map-'+key).value=String(Number.isInteger(old[key])?old[key]:-1);
}
async function readWordImport(){
 if(wiBusy)return;const token=++wiReadToken;wiBusy=true;el('wi-read').disabled=true;el('wi-confirm').disabled=true;importError();
 try{
  await new Promise(r=>setTimeout(r,0));const file=el('wi-file').files[0];
  if(file){if(file.size>WordImport.MAX_BYTES)throw new Error('文件超过 10MB，请拆分后导入。');wiSourceBytes=await file.arrayBuffer();if(token!==wiReadToken)return;wiSourceName=file.name;
   if(/\.xlsx$/i.test(file.name))wiWorkbook=WordImport.parseWorkbook(wiSourceBytes,{XLSX:window.XLSX});
   else {if(!/\.(csv|tsv|txt)$/i.test(file.name))throw new Error('请选择 .xlsx、.csv、.tsv 或 .txt 文件。');const text=new TextDecoder(el('wi-encoding').value,{fatal:true}).decode(wiSourceBytes);wiWorkbook=WordImport.parseText(text,{separator:el('wi-separator').value});}
  }else{wiSourceName='粘贴词表';wiWorkbook=WordImport.parseText(el('wi-text').value,{separator:el('wi-separator').value});}
  if(!wiWorkbook.sheets.length)throw new Error('文件中没有可读取的工作表。');wiSheetIndex=0;wiDecisions={};wiPage=0;wiRevision=state.revision;
  el('wi-sheet').innerHTML=wiWorkbook.sheets.map((sheet,i)=>`<option value="${i}">${escape(sheet.name)}（${sheet.rows.length} 行）</option>`).join('');el('wi-preview').hidden=false;
  if(!el('wi-book-name').value.trim())el('wi-book-name').value=wiSourceName==='粘贴词表'?'我的补充词':wiSourceName.replace(/\.[^.]+$/,'').slice(0,80);
  renderImportColumns(true);refreshImportPreview();
 }catch(e){wiPlan=null;el('wi-preview').hidden=true;importError('无法读取：'+e.message+' 原词库未改动。');}
 finally{wiBusy=false;el('wi-read').disabled=false;if(wiPlan&&token===wiReadToken)renderImportPreview();}
}
function invalidateWordImport(){wiReadToken++;wiPlan=null;wiWorkbook=null;wiDecisions={};el('wi-confirm').disabled=true;el('wi-preview').hidden=true;importError('来源已变更，请点击“读取并预览”重新检查。');}
function refreshImportPreview(){
 const sheet=selectedImportSheet();if(!sheet)return;
 try{importError();wiPlan=WordImport.preview(state,sheet.rows,{mapping:importMapping(),header:el('wi-header').checked,rowNumbers:sheet.rowNumbers,decisions:wiDecisions});renderImportPreview();}
 catch(e){wiPlan=null;el('wi-confirm').disabled=true;importError(e.message);}
}
function renderImportPreview(){
 const plan=wiPlan;if(!plan)return;const s=plan.stats,pages=Math.max(1,Math.ceil(plan.rows.length/50));wiPage=Math.min(wiPage,pages-1);
 const sheetWarnings=selectedImportSheet()?.warnings||[];
 el('wi-preview-summary').textContent=`共 ${s.total} 行 · 新增 ${s.new} · 关联 ${s.linked} · 更新 ${s.updated} · 跳过 ${s.skipped} · 待完善释义 ${s.drafts} · 问题 ${s.errors} · 待选择 ${s.conflicts}。${plan.canImport?'核对后可确认导入。':'请处理或跳过问题行，再确认导入。'}${sheetWarnings.length?' Excel 提示：'+sheetWarnings.slice(0,8).join('；'):''}`;
 const choices=[['','自动检查'],['keep','沿用已有资料'],['fill','只补空缺'],['replace','使用导入资料'],['new','新建独立词条'],['skip','跳过这行']];
 el('wi-rows').innerHTML=plan.rows.slice(wiPage*50,(wiPage+1)*50).map(row=>{
  const decision=wiDecisions[row.rowNumber],choice=typeof decision==='string'?decision:decision?.action||'',candidates=row.candidates||[];
  const differences=(row.conflicts||[]).map(c=>`${WI_FIELDS[c.field]||c.field}：${c.before||'（空）'} → ${c.after||'（空）'}`);
  const details=[...(row.errors||[]),...(row.warnings||[]),...differences,row.duplicateOf?`与文件第 ${row.duplicateOf} 行重复`:null].filter(Boolean).join('\n');
  return `<tr><td>${row.rowNumber}</td><td><strong>${escape(row.input.word||'（空）')}</strong><span class="import-row-detail">${escape(row.input.meaning||'缺释义 · 待完善')}</span>${row.input.phonetic?`<span class="small muted">${escape(row.input.phonetic)}</span>`:''}</td><td><span class="${['conflict','error'].includes(row.action)?'import-conflict':''}">${WI_ACTIONS[row.action]||escape(row.action)}${row.draft?' · 草稿':''}</span><small class="import-row-detail">${escape(details)}</small></td><td><select data-import-choice="${row.rowNumber}" aria-label="第${row.rowNumber}行处理方式">${choices.map(([value,label])=>`<option value="${value}" ${value===choice?'selected':''}>${label}</option>`).join('')}</select>${candidates.length>1||candidates.length===1&&!row.wordId?`<select data-import-target="${row.rowNumber}" aria-label="第${row.rowNumber}行关联词条"><option value="">选择关联的词条</option>${candidates.map(c=>`<option value="${escape(c.id)}" ${decision?.wordId===c.id?'selected':''}>${escape(c.word+' · '+(c.meaning||'待完善'))}</option>`).join('')}</select>`:''}</td></tr>`;
 }).join('');
 el('wi-page').textContent=`第 ${wiPage+1} / ${pages} 页 · 每页 50 行`;el('wi-prev').disabled=wiPage===0;el('wi-next').disabled=wiPage===pages-1;
 el('wi-confirm').disabled=!plan.canImport||wiBusy||plan.rows.every(r=>['skip','error','conflict'].includes(r.action));
}
function applyWordImport(){
 try{
  if(wiBusy||!wiPlan)return;if(state.revision!==wiRevision){wiRevision=state.revision;refreshImportPreview();throw new Error('学习档案有更新，已重新检查预览，请核对后再次确认。');}
  refreshImportPreview();if(!wiPlan?.canImport)throw new Error('还有问题行或未选择的重复项。');
  const name=el('wi-book-name').value.trim(),requested=el('wi-book').value;if(requested==='new'&&(!name||name.length>80))throw new Error('请填写 1–80 字的新词书名称。');
  const plan=copy(wiPlan),bookId=requested==='new'?'book:'+uid():requested,batchId='batch:'+uid(),createdAt=now(),rowIds=new Map();
  // Build and validate a candidate first; a failed row cannot change the active state.
  const candidate=copy(state);WordBooks.ensure(candidate);
  if(requested==='new')WordBooks.createBook(candidate,{id:bookId,name,createdAt});
  assert(candidate.library.books[bookId]&&!candidate.library.books[bookId].archived,'词书已不存在，请重新选择。');
  const lastOrder=Math.max(-1,...Object.values(candidate.library.members[bookId]||{}).filter(Boolean).map(m=>m.order));let addedOrder=lastOrder;
  for(const row of plan.rows){
   if(['skip','error','conflict'].includes(row.action))continue;
   let id=row.wordId;
   if(row.action==='new'){
    id='custom:'+uid();const input=row.input;
    candidate.words.push({id,word:input.word,meaning:input.meaning||'',phonetic:input.phonetic||'',sentence:input.sentence||'',group:(input.chapter||candidate.library.books[bookId].name).slice(0,80)});
    candidate.cards[id]=blankCard(false);
    const extra={};for(const key of ['translation','tags','source'])if(input[key])extra[key]=input[key];if(Object.keys(extra).length)WordBooks.setContent(candidate,id,extra);
   }else if(row.duplicateOf&&rowIds.has(row.duplicateOf))id=rowIds.get(row.duplicateOf);
   assert(id&&candidate.cards[id],`第 ${row.rowNumber} 行没有可关联的词条，请检查重复项。`);
   if(row.action==='update'&&Object.keys(row.changes||{}).length)WordBooks.setContent(candidate,id,row.changes);
   const existing=candidate.library.members[bookId]?.[id];
   if(!existing)WordBooks.addMember(candidate,bookId,id,{chapter:row.input.chapter||'',order:++addedOrder});
   rowIds.set(row.rowNumber,id);
  }
  const stats=plan.stats;candidate.library.batches[batchId]={id:batchId,bookId,name:wiSourceName,createdAt,rows:stats.total,added:stats.new,linked:stats.linked,updated:stats.updated,skipped:stats.skipped,errors:stats.errors};
  WordBooks.validate(candidate);validate(candidate);OfflineSync.validateState(candidate);
  const oldCards=copy(state.cards),oldHistory=copy(state.history);
  for(const id of Object.keys(oldCards))assert(JSON.stringify(oldCards[id])===JSON.stringify(candidate.cards[id]),'导入不得修改已有学习进度。');assert(JSON.stringify(oldHistory)===JSON.stringify(candidate.history),'导入不得修改反馈历史。');
  if(!commit(s=>{s.words=candidate.words;s.cards=candidate.cards;s.library=candidate.library;}))throw new Error('保存没有完成，请查看本机保存提示；可以保留预览后重试。');
  el('word-import-dialog').close();wiPlan=null;wiWorkbook=null;wiDecisions={};el('wi-preview').hidden=true;el('wi-file').value='';el('wi-text').value='';
  renderWordbooks();el('wordbook-filter').value=bookId;el('list').value='all';libraryPage=0;renderLibrary();
  message(`已导入“${candidate.library.books[bookId].name}”：新增 ${stats.new}、关联 ${stats.linked}、更新 ${stats.updated}。已有进度保留；新词尚未加入计划。`);
 }catch(e){importError(e.message);}
}
el('open-word-import').addEventListener('click',openWordImport);
el('wi-close').addEventListener('click',()=>{if(!wiBusy)el('word-import-dialog').close();});
el('wi-read').addEventListener('click',readWordImport);el('wi-confirm').addEventListener('click',applyWordImport);
el('wi-file').addEventListener('change',()=>{el('wi-text').value='';invalidateWordImport();});el('wi-text').addEventListener('input',()=>{if(el('wi-text').value)el('wi-file').value='';invalidateWordImport();});
el('wi-separator').addEventListener('change',invalidateWordImport);el('wi-encoding').addEventListener('change',invalidateWordImport);
el('wi-sheet').addEventListener('change',()=>{wiSheetIndex=Number(el('wi-sheet').value);wiDecisions={};wiPage=0;renderImportColumns(true);refreshImportPreview();});
el('wi-header').addEventListener('change',()=>{wiDecisions={};wiPage=0;refreshImportPreview();});
el('wi-columns').addEventListener('change',()=>{wiDecisions={};wiPage=0;refreshImportPreview();});
el('wi-book').addEventListener('change',()=>{el('wi-book-name').disabled=el('wi-book').value!=='new';});
el('wi-rows').addEventListener('change',event=>{
 const control=event.target,n=control.dataset.importChoice||control.dataset.importTarget;if(!n)return;
 const old=wiDecisions[n],decision=typeof old==='string'?{action:old}:old||{action:'keep'};
 if(control.dataset.importChoice){if(!control.value)delete wiDecisions[n];else wiDecisions[n]={...decision,action:control.value};}
 else wiDecisions[n]={...decision,wordId:control.value};refreshImportPreview();
});
el('wi-apply-choice').addEventListener('click',()=>{const action=el('wi-bulk-choice').value;if(!action||!wiPlan)return;for(const row of wiPlan.rows)if(row.wordId||row.duplicateOf||row.candidates?.length||row.action==='conflict')wiDecisions[row.rowNumber]={action,wordId:row.wordId||undefined};refreshImportPreview();});
el('wi-prev').addEventListener('click',()=>{wiPage--;renderImportPreview();});el('wi-next').addEventListener('click',()=>{wiPage++;renderImportPreview();});
el('wordbook-filter').addEventListener('change',()=>{el('wordbook-chapter').value='all';el('list').value='all';libraryPage=0;selected.clear();renderLibrary();});
el('wordbook-chapter').addEventListener('change',()=>{libraryPage=0;renderLibrary();});
el('wordbook-create').addEventListener('click',()=>{try{const name=el('wordbook-create-name').value.trim();assert(name&&name.length<=80,'请填写 1–80 字的词书名称。');const id='book:'+uid();if(commit(s=>WordBooks.createBook(s,{id,name,createdAt:now()}))){el('wordbook-create-name').value='';renderWordbooks();el('wordbook-filter').value=id;el('list').value='all';renderLibrary();message('词书已建立，可以导入词表。');}}catch(e){message(e.message,true);}});
el('wordbook-rename').addEventListener('click',()=>{try{const id=el('wordbook-filter').value,book=WordBooks.view(state).books[id];if(!book||book.builtin)return;const name=prompt('词书的新名称',book.name);if(name===null)return;assert(name.trim()&&name.trim().length<=80,'词书名称需为 1–80 字。');if(commit(s=>{WordBooks.ensure(s);s.library.books[id].name=name.trim();}))message('词书名称已保存，词条和学习记录保留。');}catch(e){message(e.message,true);}});
el('wi-template').addEventListener('click',()=>{try{exportResult(download('\ufeff单词\t释义\t音标\t例句\t例句译文\t章节\t标签\t来源\r\nexample\t例子\t/ɪɡˈzɑːmpəl/\tCould you give me an example?\t你能给我举个例子吗？\t第一章\t听力\t自己的课堂笔记\r\n','自建词表模板.tsv','text/tab-separated-values;charset=utf-8'),'词表模板已保存。');}catch(e){importError(e.message);}});
el('wi-export-errors').addEventListener('click',()=>{try{if(!wiPlan)return;const csvCell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['原行号','英文','释义','问题'],...wiPlan.rows.filter(r=>['error','conflict'].includes(r.action)).map(r=>[r.rowNumber,r.input.word,r.input.meaning,[...(r.errors||[]),...(r.conflicts||[]).map(c=>c.field+'资料不同')].join('；')])];exportResult(download('\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'词表导入问题行.csv','text/csv;charset=utf-8'),'问题行已保存。');}catch(e){importError(e.message);}});
