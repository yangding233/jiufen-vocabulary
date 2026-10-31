// Included inside the existing app closure, before boot().
let usbDocument=null,usbLocked=false,usbReading=false;
const nativeEnabled=VocabNative.platform!=='browser';
function showUsbStatus(text){el('usb-message').textContent=text;}
function nativeDeviceId(){return VocabNative.call('syncStatus')?.deviceId||uid();}
function primeNativeStorage(){
 if(!nativeEnabled){showUsbStatus('浏览器预览模式：USB 同步和数据库保存需使用桌面程序或 iPhone App。');return;}
 const doc=VocabNative.call('load');
 if(doc){validate(OfflineSync.materialize(doc));usbDocument=doc;}
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
el('usb-probe').addEventListener('click',()=>{try{const result=VocabNative.call('probeUsb');showUsbStatus(typeof result==='string'?result:JSON.stringify(result));}catch(e){showUsbStatus(e.message);}});
window.addEventListener('vocab-sync-status',e=>{
 const detail=e.detail||{};showUsbStatus(detail.message||detail.phase||'同步状态更新');
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
