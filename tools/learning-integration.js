// Learning features 0.2: content data is independent of the learning document.
let currentContentPack=null,contentEntries=new Map(),activeAudio=null,previewBackup=null,nativeAudioActive=false;
const originalBuiltinMemories=new Map(memoryIndex);
const builtinContentPack=JSON.parse(el('learning-content')?.textContent||'null');
const offlineAudio=JSON.parse(el('audio-data')?.textContent||'{"entries":{}}');
function chosenMemoryFor(w){
 return memoryIndex.get(normalize(w.word));
}
function builtinMemoriesFor(w){
 const original=chosenMemoryFor(w),alternatives=contentEntries.get(w.id)?.alternatives||[];
 return [...(original?[original]:[]),...alternatives.map(alternative=>({...original,kind:'替代巧记',anchor:alternative.parts.map(p=>p.text+'（'+p.cue+'）').join(' + '),parts:alternative.parts,baseParts:[],spellingSteps:[],scene:alternative.scene,focus:alternative.focus||alternative.parts.map(p=>p.text).join(' + ')+' = '+w.word,reference:alternative.reference||'另一条原创助记，不作为英语词源或标准读音。',status:alternative.label}))];
}
function usageFor(w){return contentEntries.get(w.id)?.usage||{sentence:w.sentence||'',translation:'',collocations:[]};}
function usageHTML(w){const usage=usageFor(w);return `<div class="usage-card"><div class="row spread"><h3>常用例句与搭配</h3><button class="small" data-play-word="${escape(w.id)}">▶ 听单词</button></div>${usage.sentence?`<p lang="en">${escape(usage.sentence)}</p><p class="muted">${escape(usage.translation||'')}</p>`:'<p class="muted">自加词可在笔记中补充例句。</p>'}<div class="row">${(usage.collocations||[]).map(x=>`<span class="usage-chip">${escape(x)}</span>`).join('')}</div></div>`;}
function activateContent(pack){
 currentContentPack=pack;contentEntries=new Map((pack?.entries||[]).map(x=>[x.id,x]));
 memoryIndex.clear();for(const [key,value] of originalBuiltinMemories)memoryIndex.set(key,value);
 for(const w of initialWords){const update=contentEntries.get(w.id)?.memory;if(update)memoryIndex.set(normalize(w.word),copy(update));}
 if(el('content-version'))el('content-version').textContent='巧记内容 '+(pack?.version||'随软件提供');
}
function validateCompleteContent(pack){const valid=ContentPack.validate(pack,initialWords);if(valid.entries.length!==initialWords.length)throw new Error('请使用完整1493词条的内容包');return valid;}
function initializeLearningContent(){
 let saved=null;
 if(nativeEnabled){try{saved=VocabNative.call('contentLoad');}catch(e){/* Older hosts still open safely for export. */}}
 else {try{saved=JSON.parse(localStorage.getItem(KEY+'-content')||'null');}catch(e){}}
 try{
  const selected=validateCompleteContent(ContentPack.choose(builtinContentPack,saved,initialWords));activateContent(selected);
  if(selected&&selected.checksum!==saved?.checksum){if(nativeEnabled){try{VocabNative.call('contentSave',selected);}catch(e){showUsbStatus('内容更新需要新版程序：'+e.message);}}else localStorage.setItem(KEY+'-content',JSON.stringify(selected));}
 }catch(e){activateContent(ContentPack.validate(builtinContentPack,initialWords));showUsbStatus('外部内容包未通过检查，使用安装包内的内容：'+e.message);}
}
function currentWord(){const s=state?.session;return unfinished(s)?wordById(s.queue[s.cursor].id):null;}
async function playOffline(w,locale){
 if(!w)return;
 const voice=locale||el('audio-voice').value||'en-GB',item=offlineAudio.entries[w.id]?.[voice];
 if(!item){message('这个自加词暂无随包离线音频。');return;}
 const rate=Number(state.settings.audioRate)||1,slow=rate===0.75&&item.slow;
 const label=(voice==='en-GB'?'英式':'美式')+(offlineAudio.displayName||(/kokoro/i.test(offlineAudio.engine||'')?'Kokoro 神经合成音':'离线合成音'))+' · '+(rate<1?'慢速':'正常速度')+(item.note?' · '+item.note:'');
 try{
  if(VocabNative.platform==='ios'){VocabNative.call('playAudio',{id:w.id,voice,rate});nativeAudioActive=true;el('audio-status').textContent=label;return;}
  if(activeAudio){activeAudio.pause();activeAudio.currentTime=0;}
  activeAudio=new Audio(slow?slow.file:item.file);activeAudio.playbackRate=slow?1:rate;
  activeAudio.preservesPitch=true;
  await activeAudio.play();el('audio-status').textContent=label;
 }catch(e){el('audio-status').textContent='播放失败：'+(e.message||'请检查媒体音量和完整程序目录后重试。');}
}
function stopOfflineAudio(){if(activeAudio){activeAudio.pause();activeAudio=null;}if(nativeAudioActive){try{VocabNative.call('stopAudio');}catch(e){}nativeAudioActive=false;}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopOfflineAudio();});
window.addEventListener('pagehide',stopOfflineAudio);
function eventLearningExtras(session,w,value){
 const recall=session.cueSeen||session.hintShown?'assisted':!session.shown&&value==='good'?'independent':'unverified';
 const extras={mode:session.mode,recall};
 if(session.typed?.trim())extras.spelling=LearningTools.diffSpelling(w.word,session.typed);
 if(state.settings.adaptiveReview!==false)extras.scheduler='adaptive-v1';
 return extras;
}
function renderLearningEnhancements(){
 if(!state)return;
 document.body.dataset.fontSize=state.settings.fontSize||'normal';
 document.body.classList.toggle('learning-active',Boolean(expanded&&unfinished(state.session)&&tab==='today'));
 const s=state.session,w=currentWord();
 if(el('audio-rate'))el('audio-rate').value=String(state.settings.audioRate||1);
 if(el('font-size'))el('font-size').value=state.settings.fontSize||'normal';
 if(el('adaptive-review'))el('adaptive-review').checked=state.settings.adaptiveReview!==false;
 if(w){
  el('study-usage').hidden=!s.shown;el('study-usage').innerHTML=s.shown?usageHTML(w):'';
  if(s.shown&&s.typed){const result=LearningTools.diffSpelling(w.word,s.typed);el('spelling-result').textContent=result.correct?'拼写正确。':'你的拼写：'+s.typed+'。'+result.issues.map(x=>x.label).join('；');}
 }
 if(tab==='history'){
  const quality=LearningTools.qualityStats(state),number=x=>x===null?'暂无记录':Math.round(x*100)+'%';
  el('learning-quality').innerHTML=`<div class="stats"><div class="metric"><strong>${quality.independent}</strong><span>独立回忆记录</span></div><div class="metric"><strong>${quality.assisted}</strong><span>使用提示的反馈</span></div><div class="metric"><strong>${number(quality.spellingAccuracy)}</strong><span>可选拼写正确率</span></div><div class="metric"><strong>${quality.unverified}</strong><span>未细分的反馈</span></div></div><p class="small muted">新反馈按提示使用和答案展开状态自动记录，无需另选回忆标记；看过答案后评分归为未细分，不自动当作独立记住。旧版已保存的回忆标记保留。</p>`;
  const spelling=state.history.filter(e=>e.spelling&&!e.spelling.correct).slice(-20).reverse();
  el('spelling-mistakes').innerHTML=spelling.length?spelling.map(e=>`<button data-memory-open="${escape(e.wordId)}" class="mistake-row"><strong>${escape(wordById(e.wordId)?.word||'')}</strong><span>${escape(e.spelling.typed)} → ${escape(e.spelling.expected)}</span><small>${escape((e.spelling.issues||[]).map(x=>x.label).join('；'))}</small></button>`).join(''):'<p class="small muted">使用可选拼写模式后，这里会记录需要巩固的字母和词尾。</p>';
  const cueWords=state.words.filter(x=>['unknown','complex','irrelevant'].includes(state.cards[x.id].cueFeedback));
  el('cue-problems').innerHTML=cueWords.length?cueWords.map(x=>`<button data-memory-open="${escape(x.id)}">${escape(x.word)}</button>`).join(''):'<p class="small muted">这里保留旧版的巧记反馈记录。需要调整时可直接打开单词，写自己的巧记。</p>';
 }
 if(tab==='today'||tab==='history'){
  const forecast=LearningTools.workloadForecast(state,{days:7});
  el('workload-week').innerHTML=forecast.days.map(x=>`<div class="week-cell"><span>${escape(x.date.slice(5))}</span><strong>${x.total}<small> 词次</small></strong><span>新 ${x.newWords} · 复习 ${x.reviewWords}</span><span>约 ${x.minutes} 分钟</span></div>`).join('');
  el('workload-note').textContent=forecast.assumption+' 用时按新词35秒、复习12秒粗估，可分多次完成。';
  const due=stats().due.length,target=learningSettings(state).dailyNew;
  el('load-advice').textContent=due>Math.max(80,target*3)?`今天已有 ${due} 个到期词。可以在调整计划里暂时减少新词，先巩固旧词；软件不会自行修改你的目标。`:'';
 }
}
function exportResult(result,successText){
 if(result===false){message('已取消保存，外部备份时间没有更新。');return false;}
 if(result===true){message(successText||'文件已保存。');return true;}
 message('已打开分享或下载，请选择“存储到文件”并确认保存。');return false;
}
function refreshSyncOverview(){
 if(!nativeEnabled)return;
 try{const info=VocabNative.call('syncStatus');el('app-version').textContent='软件 '+(info.appVersion||'1.1.0');el('sync-brief').textContent=info.pendingBatch?'有待确认的同步，请展开查看':info.lastSync?.at?'上次同步 '+new Date(info.lastSync.at).toLocaleString('zh-CN'):'尚无成功同步记录';el('usb-summary').textContent=info.prepared?'手机已准备同步':info.connected===true?'设备已连接':'数据线同步';}catch(e){}
}
async function loadBackupList(){
 const target=el('backup-list');
 if(!nativeEnabled){target.textContent='备份中心在 Windows 或 iPhone App 中使用。';return;}
 try{const items=VocabNative.call('listBackups');target.innerHTML=items.length?items.map(x=>`<button class="backup-row" data-backup-preview="${escape(x.id)}"><strong>${escape(new Date(x.at).toLocaleString('zh-CN'))}</strong><span>${x.words} 词 · 已接触 ${x.seen} · ${x.history} 条反馈</span></button>`).join(''):'<p class="muted small">尚无内部快照。继续学习或完成同步后会自动保留。</p>';}catch(e){target.textContent='读取备份列表失败：'+e.message;}
}
document.addEventListener('click',event=>{
 const play=event.target.closest('[data-play-word]');if(play)playOffline(wordById(play.dataset.playWord));
 const backup=event.target.closest('[data-backup-preview]');
 if(backup){try{previewBackup=VocabNative.call('backupPreview',{id:backup.dataset.backupPreview});const summary=OfflineSync.summary(previewBackup);el('backup-preview').textContent=`预览：${summary.wordCount} 词，已接触 ${summary.seen}，${summary.historyCount} 条反馈。当前档案没有被改变。`;el('export-snapshot').hidden=false;el('restore-snapshot').hidden=false;}catch(e){message(e.message,true);}}
});
el('play-audio').addEventListener('click',()=>playOffline(currentWord()));
el('audio-rate').addEventListener('change',()=>commit(s=>{s.settings.audioRate=Number(el('audio-rate').value);}));
el('font-size').addEventListener('change',()=>commit(s=>{s.settings.fontSize=el('font-size').value;}));
el('adaptive-review').addEventListener('change',()=>commit(s=>{s.settings.adaptiveReview=el('adaptive-review').checked;}));
el('open-help')?.addEventListener('click',()=>el('help-dialog').showModal());
el('close-help')?.addEventListener('click',()=>el('help-dialog').close());
el('load-backups').addEventListener('click',loadBackupList);
el('export-snapshot').addEventListener('click',()=>{if(previewBackup)exportResult(download(OfflineSync.encodePacket(previewBackup,'snapshot-'+uid()),'九分恢复副本_'+day()+'.json','application/json'),'恢复副本已保存，当前学习档案保留。');});
el('restore-snapshot').addEventListener('click',()=>{
 if(!previewBackup||usbLocked)return;
 if(!confirm('以这份快照建立独立恢复档案？程序会先保留当前档案备份。恢复后请核对记录，其他设备也需明确切换到这份恢复档案。'))return;
 try{const next=OfflineSync.createDocument(validate(OfflineSync.materialize(previewBackup)),nativeDeviceId());VocabNative.call('recoveryCreate',{document:next});location.reload();}catch(e){message('未建立恢复档案：'+e.message,true);}
});
el('content-export').addEventListener('click',()=>{if(currentContentPack)exportResult(download(JSON.stringify(currentContentPack),'九分内容包_'+currentContentPack.version+'.json','application/json'),'离线内容包已保存。');});
el('content-import').addEventListener('change',async event=>{
 try{
  if(usbLocked)throw new Error('请先退出同步准备');const file=event.target.files[0];if(!file)return;if(file.size>30*1024*1024)throw new Error('内容包超过30MB');
  const incoming=validateCompleteContent(JSON.parse(await file.text()));
  const selected=ContentPack.choose(currentContentPack,incoming,initialWords);
  if(nativeEnabled)VocabNative.call('contentSave',selected);else localStorage.setItem(KEY+'-content',JSON.stringify(selected));
  activateContent(selected);render();message('内容已更新至 '+selected.version+'，个人联想和进度保留。');
 }catch(e){message('内容未更新：'+e.message,true);}finally{event.target.value='';}
});
window.addEventListener('vocab-export-status',event=>{const result=event.detail||{};message(result.status==='cancelled'?'已取消分享，未记录为已保存外部备份。':result.status==='error'?'分享失败：'+(result.message||'请重试'):'分享已完成，请在“文件”中确认备份位置。');});
window.addEventListener('vocab-ready',()=>{
 renderLearningEnhancements();refreshSyncOverview();
 if(innerWidth<=640)el('usb-panel-details').open=false;
 el('portable-export').hidden=nativeEnabled;
});
window.addEventListener('vocab-sync-status',()=>refreshSyncOverview());
