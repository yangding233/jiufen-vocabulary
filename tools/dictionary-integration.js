// Offline dictionary enrichment: explicit preview and atomic content-only save.
let dictionaryIndex=null,dictionaryLoading=null,dictPlan=null,dictIds=[],dictDecisions={},dictPage=0,dictRevision=null,dictBusy=false,dictReadToken=0;
const DICT_FIELDS={meaning:'中文释义',phonetic:'词典音标',partOfSpeech:'词性'};
const DICT_STATUS={exact:'精确匹配',case:'大小写待确认',related:'词形建议',missing:'未查到',ambiguous:'需要选择',review:'需要选择',unavailable:'资料不全',complete:'已有资料',skipped:'已跳过',ready:'可补全',pending:'待确认'};
function dictionaryError(text=''){el('dict-error').hidden=!text;el('dict-error').textContent=text;}
function loadLocalDictionary(){
 if(dictionaryIndex)return Promise.resolve(dictionaryIndex);
 if(dictionaryLoading)return dictionaryLoading;
 dictionaryLoading=new Promise((resolve,reject)=>{
  const loaded=()=>{try{dictionaryIndex=Dictionary.create(globalThis.DictionaryData);resolve(dictionaryIndex);}catch(e){dictionaryLoading=null;reject(e);}};
  if(globalThis.DictionaryData){loaded();return;}
  const script=document.createElement('script');script.src='dictionary-data.js';script.onload=loaded;script.onerror=()=>{script.remove();dictionaryLoading=null;reject(new Error('离线词典文件未能读取，请完整解压新版程序后重试。'));};document.head.append(script);
 });return dictionaryLoading;
}
function dictionaryScopeIds(){
 if(el('dict-scope').value==='selected')return [...selected].filter(id=>Boolean(wordById(id)));
 if(el('dict-scope').value==='all')return state.words.map(w=>w.id);
 return filteredWords().map(w=>w.id);
}
function openDictionary(){
 if(usbLocked||blocked||damaged&&!recovered){message('请先完成同步或恢复可写的学习档案。',true);return;}
 dictReadToken++;dictPlan=null;dictDecisions={};dictIds=[];dictPage=0;dictionaryError();el('dict-rows').innerHTML='';el('dict-page').textContent='';el('dict-apply').disabled=true;
 el('dict-scope').value=selected.size?'selected':'book';el('dict-summary').textContent='选择范围后，点击“查找可补资料”。';el('dict-dialog').showModal();
}
async function scanDictionary(){
 if(dictBusy)return;const token=++dictReadToken;dictBusy=true;el('dict-scan').disabled=true;el('dict-apply').disabled=true;dictionaryError();el('dict-summary').textContent='正在读取本机词典并匹配…';
 try{
  dictIds=dictionaryScopeIds();if(!dictIds.length)throw new Error('这个范围没有词条，请先选择词书或勾选词条。');
  await loadLocalDictionary();await new Promise(r=>setTimeout(r,0));if(token!==dictReadToken)return;dictRevision=state.revision;dictDecisions={};dictPage=0;refreshDictionary();
  const source=globalThis.DictionaryData.source;el('dict-source').textContent=`${source.name} · ${source.version} · ${globalThis.DictionaryData.entries.length.toLocaleString()} 条参考词条。${source.phoneticLabel||'原音标未区分英美。'} 查词完全离线。`;
 }catch(e){dictPlan=null;dictionaryError(e.message);el('dict-summary').textContent='未修改词库，可以调整范围后重试。';}
 finally{dictBusy=false;el('dict-scan').disabled=false;if(dictPlan&&token===dictReadToken)renderDictionary();}
}
function refreshDictionary(){
 try{dictPlan=Dictionary.preview(state,dictIds,{index:dictionaryIndex,builtinWords:initialWords,decisions:dictDecisions});renderDictionary();}
 catch(e){dictPlan=null;el('dict-apply').disabled=true;dictionaryError(e.message);}
}
function dictionaryChangedRows(){return (dictPlan?.rows||[]).filter(row=>Object.keys(row.changes||{}).length>0);}
function renderDictionary(){
 if(!dictPlan)return;const rows=dictPlan.rows,pages=Math.max(1,Math.ceil(rows.length/30));dictPage=Math.min(dictPage,pages-1);
 const changed=dictionaryChangedRows(),fields=changed.reduce((n,row)=>n+Object.keys(row.changes).length,0),missing=rows.filter(row=>row.status==='missing').length,pending=rows.filter(row=>['case','related','ambiguous','pending','review'].includes(row.status)).length;
 el('dict-summary').textContent=`检查 ${rows.length} 词 · 可保存 ${changed.length} 词 / ${fields} 项 · 未查到 ${missing} 词 · 待确认或词形建议 ${pending} 词。已有非空资料默认保留。`;
 el('dict-rows').innerHTML=rows.slice(dictPage*30,(dictPage+1)*30).map(row=>{
  const decision=dictDecisions[row.wordId]||{},candidate=row.candidates.find(c=>c.id===row.selectedCandidateId),lemma=candidate?.match==='lemma';
  return `<section class="dictionary-row" data-dict-word="${escape(row.wordId)}"><div class="row spread"><h3>${escape(row.word)}</h3><span class="small">${DICT_STATUS[row.status]||escape(row.status)}</span></div>
  ${row.candidates.length?`<label class="field small">匹配词条<select data-dict-candidate="${escape(row.wordId)}"><option value="">暂不选择</option>${row.candidates.map(c=>`<option value="${escape(c.id)}" ${row.selectedCandidateId===c.id?'selected':''}>${escape(c.word+' · '+c.source.name+' · '+(c.meaning||'').slice(0,60))}</option>`).join('')}</select></label>`:'<p class="small muted">没有找到可用资料。可检查拼写或稍后自行填写。</p>'}
  <div class="dictionary-fields">${Object.entries(DICT_FIELDS).map(([field,label])=>{
   const before=row.before[field]||'',after=candidate?.[field]||'',different=Boolean(after&&before!==after),disabled=!different||lemma;
   return `<div class="dictionary-field"><label class="checks"><input type="checkbox" data-dict-field="${field}" data-dict-id="${escape(row.wordId)}" ${Object.hasOwn(row.changes,field)?'checked':''} ${disabled?'disabled':''}>${before?'替换已有'+label:'补齐'+label}</label><p class="small muted dictionary-before">当前：${escape(before||'（空）')}</p><p class="small">候选：${escape(after||'暂无')}</p></div>`;
  }).join('')}</div>
  ${candidate?`<p class="dictionary-provenance muted">来源：${escape(candidate.source.name)} · ${escape(candidate.source.version)}${candidate.source.phoneticLabel?' · '+escape(candidate.source.phoneticLabel):''}</p>`:''}
  ${(row.warnings||[]).length?`<p class="small dictionary-warnings">${escape(row.warnings.join('\n'))}</p>`:''}
  <label class="checks small"><input type="checkbox" data-dict-skip="${escape(row.wordId)}" ${decision.skip?'checked':''}>本次跳过这个词</label></section>`;
 }).join('');
 el('dict-page').textContent=`第 ${dictPage+1} / ${pages} 页 · 每页 30 词`;el('dict-prev').disabled=dictPage===0;el('dict-next').disabled=dictPage===pages-1;
 el('dict-apply').disabled=dictBusy||!changed.length||usbLocked||blocked;el('dict-apply').textContent=`保存选中的补全资料（${changed.length} 词）`;
}
function applyDictionary(){
 try{
  dictionaryError();if(dictBusy||!dictPlan)return;
  if(state.revision!==dictRevision){dictRevision=state.revision;refreshDictionary();throw new Error('学习档案有更新，已重新检查，请核对预览后再次保存。');}
  refreshDictionary();const rows=dictionaryChangedRows();if(!rows.length)throw new Error('没有选择可保存的资料。');
  const candidate=copy(state),oldCards=copy(state.cards),oldHistory=copy(state.history);WordBooks.ensure(candidate);
  for(const row of rows){const source=Dictionary.sourceFor(row);WordBooks.setContent(candidate,row.wordId,{...row.changes,...(source?{source}:{})});}
  const sources={};for(const row of rows)for(const source of Object.values(row.provenance)){const key=source.id+'@'+source.version;if(!sources[key])sources[key]={id:source.id,name:source.name,version:source.version,url:source.url,phoneticLabel:source.phoneticLabel};}
  const batchId='batch:'+uid();candidate.library.batches[batchId]={id:batchId,kind:'dictionary',bookId:el('wordbook-filter').value,name:'离线词典补全',createdAt:now(),rows:dictIds.length,added:0,linked:0,updated:rows.length,skipped:dictPlan.rows.length-rows.length,sources,items:rows.map(row=>({wordId:row.wordId,fields:Object.keys(row.changes),candidateId:row.selectedCandidateId,sourceKeys:[...new Set(Object.values(row.provenance).map(s=>s.id+'@'+s.version))]}))};
  WordBooks.validate(candidate);validate(candidate);OfflineSync.validateState(candidate);assert(JSON.stringify(oldCards)===JSON.stringify(candidate.cards),'补全不得修改学习进度。');assert(JSON.stringify(oldHistory)===JSON.stringify(candidate.history),'补全不得修改反馈历史。');
  if(!commit(s=>{s.words=candidate.words;s.library=candidate.library;}))throw new Error('本机保存没有完成，原资料已保留，可以重试。');
  const count=rows.length;dictRevision=state.revision;dictDecisions={};refreshDictionary();message(`已补全 ${count} 词的选中资料，来源已记录，学习进度和原笔记保留。`);el('dict-summary').textContent=`本次已保存 ${count} 词。`+el('dict-summary').textContent;
 }catch(e){dictionaryError(e.message);}
}
el('open-dictionary').addEventListener('click',openDictionary);el('dict-scan').addEventListener('click',scanDictionary);el('dict-apply').addEventListener('click',applyDictionary);
el('dict-close').addEventListener('click',()=>{if(!dictBusy)el('dict-dialog').close();});
el('dict-scope').addEventListener('change',()=>{dictReadToken++;dictPlan=null;dictDecisions={};el('dict-rows').innerHTML='';el('dict-apply').disabled=true;el('dict-summary').textContent='范围已变更，请重新查找可补资料。';});
el('dict-rows').addEventListener('change',event=>{
 const control=event.target,id=control.dataset.dictId||control.dataset.dictCandidate||control.dataset.dictSkip;if(!id)return;const old=dictDecisions[id]||{},decision={...old,fields:{...(old.fields||{})},replaceFields:[...(old.replaceFields||[])]};
 if(control.dataset.dictCandidate){decision.candidateId=control.value;decision.skip=!control.value;decision.fields={};decision.replaceFields=[];}
 else if(control.dataset.dictSkip)decision.skip=control.checked;
 else{const field=control.dataset.dictField;decision.fields[field]=control.checked;const row=dictPlan.rows.find(r=>r.wordId===id);decision.replaceFields=decision.replaceFields.filter(f=>f!==field);if(control.checked&&row.before[field])decision.replaceFields.push(field);}
 dictDecisions[id]=decision;refreshDictionary();
});
el('dict-prev').addEventListener('click',()=>{dictPage--;renderDictionary();});el('dict-next').addEventListener('click',()=>{dictPage++;renderDictionary();});
