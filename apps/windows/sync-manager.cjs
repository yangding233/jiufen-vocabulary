'use strict';
const crypto=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function hasProgress(core,doc){
 const s=core.materialize(doc);
 return doc.operations.length>0||s.history.length>0||s.baseline?.ids?.length>0||Object.values(s.cards).some(c=>c.seen||c.mastered||c.favorite||c.suspended||c.note||c.memoryAnchor||c.memoryScene)||s.words.some(w=>w.id.startsWith('custom:'));
}
class SyncManager {
 constructor({store,transport,core,emit,ackTimeout=30000,pollInterval=1000}){Object.assign(this,{store,transport,core,emit,ackTimeout,pollInterval});this.busy=false;}
 start(payload={}){
  if(this.busy)throw new Error('同步正在进行，请等待完成。');
  if(!this.store.load())throw new Error('请先初始化或导入电脑学习记录。');
  this.busy=true;this.cancelRequested=false;this.run(payload).catch(e=>{this.busy=false;this.emit({phase:e.code==='CANCELLED'?'cancelled':'error',message:e.message,pending:Boolean(this.store.getMeta('pendingBatch'))});}).finally(()=>{this.busy=false;});
  return {started:true};
 }
 cancel(){if(this.busy){this.cancelRequested=true;return {cancelling:true};}return {cancelling:false};}
 checkCancelled(){if(this.cancelRequested)throw Object.assign(new Error('同步已取消。已保存的操作和待完成批次保留，可稍后重新同步。'),{code:'CANCELLED'});}
 async run({bootstrap=false,bundleId='com.jiufen.vocabulary',udid=''}={}){
  this.checkCancelled();
  if(!/^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/.test(bundleId))throw new Error('App 标识格式不正确。');
  this.emit({phase:'connecting',message:this.transport.fixtureDirectory?'测试模式：正在连接模拟目录，不是真实手机。':'正在检查 USB 设备…'});
  const devices=await this.transport.list();this.checkCancelled();if(!devices.length)throw new Error('没有检测到 USB iPhone。请连接数据线，解锁并信任电脑。');
  if(!udid&&devices.length>1)throw new Error('检测到多个设备，请先只连接要同步的一台 iPhone。');
  const device=udid?devices.find(d=>d.udid===udid):devices[0];if(!device)throw new Error('指定的手机不在当前 USB 设备列表中。');
  const options={udid:device.udid,bundleId};
  this.emit({phase:'reading',message:'正在读取手机同步包，请保持手机 App 的同步页面打开。'});
  const packet=this.core.decodePacket(await this.transport.read(options,'Exchange/outgoing.json'));this.checkCancelled();
  let local=this.store.load(),incoming=packet.document;
  if(local.profileId!==incoming.profileId){
   if(!bootstrap)throw new Error('手机和电脑尚未配对。请核对两端记录后勾选“首次配对”，再同步。');
   const a=hasProgress(this.core,local),b=hasProgress(this.core,incoming);
   if(a&&b)throw new Error('两端都有不同来源的学习进度，不能直接首次配对。请先导出备份，在同一端明确合并后再初始化另一端。');
   this.store.saveSyncBackup('before-pairing-desktop',local);this.store.saveSyncBackup('before-pairing-phone',incoming);
   if(b){local=this.core.adoptDocument(incoming,local.deviceId);}
   else incoming=this.core.adoptDocument(local,incoming.deviceId);
  }
  this.emit({phase:'merging',message:'正在核对并合并记录，自动保存两端同步前备份。'});
  this.store.saveSyncBackup('desktop',local);this.store.saveSyncBackup('phone',packet.document);
  const merged=this.core.mergeDocuments(local,incoming);this.store.save(merged);
  // Every exchange attempt gets a fresh batch. An old ack must never confirm a newer payload.
  // Operation IDs (not batch IDs) provide retry deduplication.
  const batchId=crypto.randomUUID();
  const encoded=this.core.encodePacket(merged,batchId);
  this.store.setMeta('pendingBatch',{batchId,device:device.udid,profileId:merged.profileId,at:new Date().toISOString()});
  this.checkCancelled();this.emit({phase:'writing',message:'电脑已保存，正在写回手机…'});await this.transport.write(options,'Exchange/incoming.json',encoded);this.checkCancelled();
  this.emit({phase:'waiting',message:'已写入手机，等待手机 App 导入并确认。请保持手机同步页面打开。'});
  const deadline=Date.now()+this.ackTimeout;
  while(Date.now()<deadline){
   await sleep(this.pollInterval);this.checkCancelled();
   try{const ack=JSON.parse(await this.transport.read(options,'Exchange/ack.json'));this.checkCancelled();if(ack.format==='jiufen-sync-ack'&&ack.schema===1&&ack.deviceId===packet.document.deviceId&&ack.batchId===batchId){this.store.setMeta('pendingBatch',null);this.store.setMeta('lastSync',{at:new Date().toISOString(),device:device.udid,batchId});this.busy=false;this.emit({phase:'complete',message:'双向同步完成，可以断开数据线。',batchId,summary:this.core.summary(merged)});return;}}catch(e){if(!['NOT_FOUND','AFC_NOT_FOUND'].includes(e.code))throw e;}
  }
  throw new Error('电脑已保存，手机尚未确认导入。待同步批次已保留；打开手机同步页面后可重试，请勿卸载 App。');
 }
}
module.exports={SyncManager,hasProgress};
