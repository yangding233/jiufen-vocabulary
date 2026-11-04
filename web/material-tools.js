'use strict';
// Personal learning material and external AI handoff live outside the study loop.
(()=>{
 let app,editId=null,schemes=[],schemesTouched=false,task=null,result=null,decisions={},preview=null;
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fields={meaning:'中文释义',phonetic:'音标',partOfSpeech:'词性',sentence:'英文例句',translation:'例句译文',source:'资料来源',tags:'标签'};
 const aiFields={schemes:'巧记',sentence:'英文例句',translation:'译文',collocations:'搭配',phonetic:'音标',partOfSpeech:'词性',source:'来源'};
 function dialog(id,title,body){document.body.insertAdjacentHTML('beforeend',`<dialog id="${id}" class="material-dialog"><div class="row spread"><h2>${title}</h2><button data-close-material="${id}">关闭</button></div>${body}</dialog>`);}
 function error(id,text=''){$(id).textContent=text;$(id).hidden=!text;}
 function manualSchemes(){
  const nodes=[...$('me-schemes').querySelectorAll('[data-scheme]')];
  return nodes.map((row,index)=>{
   const value=key=>row.querySelector('[data-scheme-field="'+key+'"]').value.trim();
   const old=schemes.find(s=>s.id===row.dataset.scheme);const parts=[...row.querySelectorAll('[data-part]')].map((part,i)=>{const text=part.querySelector('[data-part-text]').value,cue=part.querySelector('[data-part-cue]').value.trim(),original=old?.parts?.[i];return {...(original?.text===text?original:{}),text,cue};});
   return {id:row.dataset.scheme,label:value('label')||'巧记 '+(index+1),kind:'个人巧记',anchor:value('anchor'),parts,scene:value('scene'),focus:value('focus'),reference:value('reference')||'个人编写的助记，不作为词源或发音规则。'};
  });
 }
 function showSchemes(){
  $('me-schemes').innerHTML=schemes.map((scheme,index)=>`<section class="material-scheme" data-scheme="${esc(scheme.id||'scheme:'+app.uid())}"><div class="row spread"><h3>巧记 ${index+1}</h3><button data-remove-scheme="${index}">删除这条</button></div>${['label','anchor','scene','focus','reference'].map(key=>`<label class="field">${({label:'名称',anchor:'从哪些熟悉线索出发',scene:'怎样联系到这个词义',focus:'拼写还原说明',reference:'方法与来源'})[key]}<textarea data-scheme-field="${key}" maxlength="4000">${esc(scheme[key]||'')}</textarea></label>`).join('')}<p class="small muted">实际片段按顺序拼出原单词。短语的空格可以填在片段里，展示时不单开提示卡。增删换字母请在提示中写清楚。</p><div class="material-parts">${(scheme.parts||[]).map(p=>`<div data-part class="row"><input data-part-text aria-label="实际片段" value="${esc(p.text)}"><input data-part-cue aria-label="片段提示" value="${esc(p.cue)}"><button data-remove-part>移除片段</button></div>`).join('')}</div><button data-add-part>增加片段</button></section>`).join('')||'<p class="muted">没有自定义结构化巧记；可添加，也可继续使用详情页中的简单个人线索。</p>';
 }
 function openEditor(){
  const w=app.wordById(editId);if(!w)return;
  const entry=Materials.entry(app.getState(),w.id),usage=app.usageFor(w);
  $('me-word').textContent=w.word+' · '+w.meaning;
  for(const field of Object.keys(fields))$('me-'+field).value=field==='sentence'?usage.sentence||'':field==='translation'?usage.translation||'':w[field]||'';
  $('me-collocations').value=(entry.collocations||usage.collocations||[]).join('\n');
  schemes=structuredClone(entry.schemes||[]);schemesTouched=Object.hasOwn(entry,'schemes');showSchemes();error('me-error');$('me-dialog').showModal();
 }
 async function saveEditor(){
  try{
   error('me-error');const values=Object.fromEntries(Object.keys(fields).map(key=>[key,$('me-'+key).value.trim()]));
   values.collocations=$('me-collocations').value.split('\n').map(x=>x.trim()).filter(Boolean);values.schemes=manualSchemes().map(s=>({...s,focus:s.focus||(s.parts.length?s.parts.map(p=>p.text).join(' + ')+' = '+app.wordById(editId).word:'核对完整拼写：'+app.wordById(editId).word)}));
   Materials.validateSchemes(values.schemes,app.wordById(editId).word);if(!schemesTouched)delete values.schemes;
   if(!await app.commit(state=>{const before=structuredClone(state);Materials.updateWord(state,editId,values);BookTools.recordBatch(before,state,{name:'编辑单词资料',kind:'materials'});}))throw Error('资料没有保存成功，请查看保存提示后重试。');
   $('me-dialog').close();$('word-dialog').close();app.openDetail(editId);app.message('资料和巧记已保存，学习记录保留。');
  }catch(e){error('me-error',e.message);}
 }
 function resolvePublic(w){const usage=app.usageFor(w);return {sentence:usage.sentence||'',translation:usage.translation||'',collocations:usage.collocations||[],schemes:app.builtinMemoriesFor(w)};}
 function taskIds(){const chosen=app.selected();return (chosen.length?chosen:app.filteredWords().map(w=>w.id)).slice(0,Number($('ai-limit').value)||50);}
 async function makeTask(){
  try{error('ai-error');const selected=[...$('ai-fields').querySelectorAll('input:checked')].map(n=>n.value);if(!selected.length)throw Error('至少选择一项需要补的资料。');
   const ids=taskIds();if(!ids.length)throw Error('当前范围没有词条。');
   task=AIHandoff.createTask(app.getState(),ids,{fields:selected,maxItems:Number($('ai-limit').value)||50,resolve:resolvePublic});result=null;decisions={};preview=null;
   if(!await app.commit(state=>AIHandoff.registerTask(state,task),false))throw Error('任务未保存，请解决本机保存问题。');
   $('ai-task').value=JSON.stringify(task,null,2);$('ai-prompt').value=AIHandoff.prompt(task);$('ai-result').value='';$('ai-preview').innerHTML='';$('ai-apply').disabled=true;
   $('ai-summary').textContent=`任务包含 ${task.items.length} 词。优先使用已勾选词，否则使用当前筛选的前 ${$('ai-limit').value} 词。生成前请核对导出内容。`;
  }catch(e){error('ai-error',e.message);}
 }
 function valueText(value){if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:([v.label,v.anchor,v.scene,(v.parts||[]).map(p=>p.text+'（'+p.cue+'）').join(' + '),v.reference].filter(Boolean).join('\n'))).join('\n\n');return String(value??'');}
 function renderAI(){
  preview=AIHandoff.preview(app.getState(),task,result,decisions,{resolve:resolvePublic});
  $('ai-preview').innerHTML=preview.rows.map(row=>{
   const changes=row.candidate||{},before=row.before||{};
   return `<section class="material-scheme"><h3>${esc(row.word||app.wordById(row.id||row.wordId)?.word||row.id||row.wordId)}</h3><p class="small">${esc(({ready:'可采用',review:'请核对后勾选',complete:'资料一致',stale:'资料已变化',unavailable:'无法补全',skipped:'已跳过'})[row.status]||row.status||'')} ${esc((row.warnings||[]).join('；'))} ${esc(row.note||'')}</p>${Object.entries(changes).map(([key,value])=>`<label class="ai-field"><input type="checkbox" data-ai-id="${esc(row.id||row.wordId)}" data-ai-field="${esc(key)}" ${row.selectedFields?.includes(key)?'checked':''}><strong>${esc(aiFields[key]||key)}</strong><pre>已有：${esc(valueText(before[key]))}\n候选：${esc(valueText(value))}</pre></label>`).join('')}</section>`;
  }).join('');
  $('ai-apply').disabled=!preview.canApply;
 }
 function previewAI(){try{error('ai-error');task=JSON.parse($('ai-task').value);result=AIHandoff.parseResult($('ai-result').value);decisions={};renderAI();}catch(e){$('ai-apply').disabled=true;error('ai-error',e.message);}}
 async function applyAI(){try{error('ai-error');const next=AIHandoff.apply(app.getState(),task,result,decisions,{resolve:resolvePublic});if(!await app.commit(state=>{const before=structuredClone(state);state.words=next.words;state.library=next.library;state.materials=next.materials;BookTools.recordBatch(before,state,{name:'AI 资料采用',kind:'ai'});} ))throw Error('保存失败，结果未采用。');$('ai-apply').disabled=true;$('ai-preview').innerHTML='';app.message('AI 资料已采用；原学习记录保留。');$('ai-dialog').close();}catch(e){error('ai-error',e.message);}}
 window.VocabMaterials={isMissing(w,key){const s=app?.getState();if(!s)return false;return Materials.missing({...w,sentence:app.usageFor(w).sentence},Materials.entry(s,w.id),{hasMemory:Boolean(s.cards[w.id]?.memoryAnchor||s.cards[w.id]?.memoryScene||!s.cards[w.id]?.rejectBuiltinCue&&app.builtinMemoriesFor(w).length),hasAudio:Boolean(window.VocabAudio?.hasWord(w))}).includes(key);}};
 window.addEventListener('vocab-ready',()=>{
  app=window.VocabApp;
  dialog('me-dialog','编辑单词资料与巧记',`<p id="me-word"></p><p class="small muted">只修改学习资料。英文拼写和已有学习反馈保持原记录。</p><div class="material-fields">${Object.entries(fields).map(([key,label])=>`<label class="field">${label}<textarea id="me-${key}" maxlength="4000"></textarea></label>`).join('')}<label class="field">常用搭配（每行一条）<textarea id="me-collocations"></textarea></label></div><h3>自定义巧记</h3><div id="me-schemes"></div><button id="me-add">添加一条巧记</button><p id="me-error" class="error" role="alert" hidden></p><div class="row"><button id="me-save" class="primary">保存资料与巧记</button><button id="me-restore">恢复内置资料…</button></div>`);
  dialog('ai-dialog','交给 AI 补全',`<p class="small">先勾选词条或筛选词书，再生成任务。外部 AI 使用下方提示词返回 JSON；结果在核对并采用前不会更改词库。</p><div class="row"><label>每批词数 <select id="ai-limit"><option>20</option><option selected>50</option></select></label><div id="ai-fields" class="row">${Object.entries(aiFields).map(([key,label])=>`<label class="checks"><input type="checkbox" value="${key}" ${['schemes','sentence','translation','collocations','source'].includes(key)?'checked':''}>${label}</label>`).join('')}</div></div><button id="ai-make">生成待补任务</button><p id="ai-summary" role="status"></p><details><summary>任务内容（可核对或载入以前的任务）</summary><textarea id="ai-task" class="material-json" spellcheck="false"></textarea><label class="field">载入任务文件<input id="ai-task-file" type="file" accept=".json"></label><button id="ai-export">导出任务 JSON</button></details><label class="field">复制这份完整提示词发给 AI<textarea id="ai-prompt" class="material-json" readonly></textarea></label><button id="ai-copy">复制提示词</button><label class="field">粘贴 AI 返回的 JSON<textarea id="ai-result" class="material-json" spellcheck="false"></textarea></label><label class="field">或选择结果文件<input id="ai-result-file" type="file" accept=".json"></label><button id="ai-read">检查结果并预览</button><p id="ai-error" class="error" role="alert" hidden></p><div id="ai-preview"></div><button id="ai-apply" class="primary" disabled>采用选中的资料</button>`);
  $('edit-materials').addEventListener('click',openEditor);
  window.addEventListener('vocab-detail',event=>{editId=event.detail.id;});
  $('me-save').addEventListener('click',saveEditor);
  $('me-add').addEventListener('click',()=>{schemesTouched=true;schemes=manualSchemes();schemes.push({id:'scheme:'+app.uid(),parts:[{text:app.wordById(editId).word,cue:''}]});showSchemes();});
  $('me-schemes').addEventListener('click',event=>{
   if(event.target.matches('[data-remove-scheme]')){schemesTouched=true;schemes=manualSchemes();schemes.splice(Number(event.target.dataset.removeScheme),1);showSchemes();}
   if(event.target.matches('[data-add-part]')){schemes=manualSchemes();const index=[...$('me-schemes').querySelectorAll('[data-scheme]')].indexOf(event.target.closest('[data-scheme]'));schemes[index].parts.push({text:'',cue:''});showSchemes();}
   if(event.target.matches('[data-remove-part]'))event.target.closest('[data-part]').remove();
  });
  $('me-restore').addEventListener('click',async()=>{
   const original=JSON.parse($('vocabulary-data').textContent).find(w=>w.id===editId);if(!original){error('me-error','自加词没有随软件提供的原始资料。');return;}
   if(!confirm('将移除本词的资料覆盖与自定义结构化巧记，恢复安装包内容；个人联想、笔记和进度保留。当前编辑将丢弃。'))return;
   if(await app.commit(state=>{delete state.library?.overrides?.[editId];delete state.materials?.entries?.[editId];const word=state.words.find(w=>w.id===editId);for(const key of Materials.LEXICAL_FIELDS)word[key]=original[key]||'';word.phoneticNote=original.phoneticNote||'';})){$('me-dialog').close();$('word-dialog').close();app.openDetail(editId);}
  });
  $('open-ai-tools').addEventListener('click',()=>{error('ai-error');$('ai-dialog').showModal();});
  $('ai-make').addEventListener('click',makeTask);$('ai-read').addEventListener('click',previewAI);$('ai-apply').addEventListener('click',applyAI);
  $('ai-copy').addEventListener('click',async()=>{try{if(!$('ai-prompt').value)throw Error('请先生成任务。');if(window.vocabHost)await VocabNative.callAsync('copyText',{text:$('ai-prompt').value});else await navigator.clipboard.writeText($('ai-prompt').value);app.message('提示词已复制。');}catch(e){$('ai-prompt').focus();$('ai-prompt').select();error('ai-error','可直接在提示词文本框按 Ctrl+C 复制。');}});
  $('ai-export').addEventListener('click',()=>{if(task)app.download(JSON.stringify(task,null,2),'九分AI任务_'+app.day()+'.json','application/json');});
  for(const [input,target] of [['ai-task-file','ai-task'],['ai-result-file','ai-result']])$(input).addEventListener('change',async()=>{try{const file=$(input).files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('文件超过5MB，请拆分任务。');$(target).value=await file.text();if(target==='ai-task'){task=JSON.parse($(target).value);$('ai-prompt').value=AIHandoff.prompt(task);}preview=null;$('ai-apply').disabled=true;}catch(e){error('ai-error',e.message);}finally{$(input).value='';}});
  $('ai-result').addEventListener('input',()=>{$('ai-apply').disabled=true;preview=null;});$('ai-task').addEventListener('input',()=>{$('ai-apply').disabled=true;preview=null;});
  $('ai-preview').addEventListener('change',event=>{const node=event.target;if(!node.dataset.aiId)return;const decision=decisions[node.dataset.aiId]||(decisions[node.dataset.aiId]={fields:{},replaceFields:[]});decision.fields[node.dataset.aiField]=node.checked;if(node.checked&&!decision.replaceFields.includes(node.dataset.aiField))decision.replaceFields.push(node.dataset.aiField);try{renderAI();}catch(e){error('ai-error',e.message);}});
  document.addEventListener('click',event=>{if(event.target.dataset.closeMaterial)$(event.target.dataset.closeMaterial).close();});
 });
})();
