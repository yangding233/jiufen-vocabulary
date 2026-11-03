'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const MAX_BYTES=50*1024*1024;
class Store {
 constructor(directory,validator=null,{contentValidator=null}={}){
  fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.validator=validator;this.contentValidator=contentValidator;
  this.db=new DatabaseSync(path.join(directory,'progress.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS backups(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,value TEXT NOT NULL);');
  if(!this.getMeta('deviceId'))this.setMeta('deviceId','windows-'+crypto.randomUUID());
 }
 getMeta(key){const row=this.db.prepare('SELECT value FROM kv WHERE key=?').get('meta:'+key);return row?JSON.parse(row.value):null;}
 setMeta(key,value){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('meta:'+key,JSON.stringify(value));}
 load(){const row=this.db.prepare("SELECT value FROM kv WHERE key='document'").get();if(!row)return null;const doc=JSON.parse(row.value);this.validate(doc);return doc;}
 validate(doc){
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.format!=='jiufen-usb'||doc.schema!==1)throw new Error('学习数据格式不正确。');
  const raw=JSON.stringify(doc);if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new Error('学习数据超过 50MB，未保存。');
  if(typeof doc.profileId!=='string'||!doc.profileId||typeof doc.deviceId!=='string'||!doc.deviceId||!Array.isArray(doc.operations))throw new Error('学习数据身份或操作列表不完整。');
  if(this.validator)this.validator(doc);return raw;
 }
 save(doc,{clearPairing=false}={}){
  const raw=this.validate(doc),previous=this.db.prepare("SELECT value FROM kv WHERE key='document'").get();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(previous&&previous.value!==raw)this.db.prepare('INSERT INTO backups(at,value) VALUES(?,?)').run(new Date().toISOString(),previous.value);
   this.db.prepare("INSERT INTO kv VALUES('document',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(raw);
   if(clearPairing)this.db.prepare("DELETE FROM kv WHERE key IN ('meta:pendingBatch','meta:lastSync','meta:phoneBundleId')").run();
   this.db.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 20)').run();
   this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 createRecovery(document){
  this.validate(document);const current=this.load();
  if(!current||document.profileId===current.profileId||document.deviceId!==current.deviceId)throw new Error('独立恢复档案必须使用新的档案身份，并保留本机设备身份。');
  this.saveSyncBackup('before-recovery',current);return this.save(document,{clearPairing:true});
 }
 saveSyncBackup(label,doc){
  const raw=this.validate(doc),dir=path.join(this.directory,'sync-backups');fs.mkdirSync(dir,{recursive:true});
  const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+label.replace(/[^a-z0-9-]/gi,'_')+'-'+crypto.randomUUID().slice(0,8)+'.json';
  const file=path.join(dir,name);fs.writeFileSync(file,raw,{encoding:'utf8',flag:'wx'});
  for(const old of this.syncBackupFiles().slice(20))fs.unlinkSync(path.join(dir,old.name));return file;
 }
 syncBackupFiles(){
  const dir=path.join(this.directory,'sync-backups');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>({name:entry.name,id:'sync:'+crypto.createHash('sha256').update(entry.name).digest('hex').slice(0,24),at:fs.statSync(path.join(dir,entry.name)).mtime.toISOString()})).sort((a,b)=>b.at.localeCompare(a.at)||b.name.localeCompare(a.name));
 }
 backupSummary(doc){
  const state=this.validator?.(doc)||doc.baseline||{};
  return {words:Array.isArray(state.words)?state.words.length:0,history:Array.isArray(state.history)?state.history.length:0,seen:state.cards&&typeof state.cards==='object'?Object.values(state.cards).filter(card=>card?.seen).length:0};
 }
 listBackups(){
  const entries=[];
  for(const row of this.db.prepare('SELECT id,at,value FROM backups ORDER BY id DESC LIMIT 20').all()){
   try{const doc=JSON.parse(row.value);this.validate(doc);entries.push({id:'sqlite:'+row.id,at:row.at,...this.backupSummary(doc)});}catch(_){/* A corrupt snapshot is never presented as restorable. */}
  }
  for(const file of this.syncBackupFiles().slice(0,20)){
   try{const doc=this.backupPreview(file.id);entries.push({id:file.id,at:file.at,...this.backupSummary(doc)});}catch(_){}
  }
  return entries.sort((a,b)=>b.at.localeCompare(a.at));
 }
 backupPreview(id){
  if(typeof id!=='string'||id.length>100)throw new Error('备份编号无效。');let raw;
  if(/^sqlite:[1-9][0-9]*$/.test(id)){const row=this.db.prepare('SELECT value FROM backups WHERE id=?').get(Number(id.slice(7)));if(row)raw=row.value;}
  else if(/^sync:[a-f0-9]{24}$/.test(id)){
   const file=this.syncBackupFiles().find(item=>item.id===id);if(file){const location=path.join(this.directory,'sync-backups',file.name),size=fs.statSync(location).size;if(size>MAX_BYTES)throw new Error('备份超过 50MB。');raw=fs.readFileSync(location,'utf8');}
  }
  if(raw===undefined)throw new Error('找不到这份备份，可能已超过保留数量。');const doc=JSON.parse(raw);this.validate(doc);return doc;
 }
 loadContent(){
  const file=path.join(this.directory,'content-pack.json');if(!fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw new Error('内容包文件大小或类型异常，原学习记录未更改。');
  const pack=JSON.parse(fs.readFileSync(file,'utf8'));return pack===null?null:this.validateContent(pack);
 }
 validateContent(pack){
  if(!this.contentValidator)throw new Error('内容包验证器不可用。');
  if(Buffer.byteLength(JSON.stringify(pack),'utf8')>MAX_BYTES)throw new Error('内容包超过 50MB。');return this.contentValidator(pack);
 }
 saveContent(pack){
  const value=pack===null?null:this.validateContent(pack),file=path.join(this.directory,'content-pack.json'),temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(value),{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}return true;
 }
 close(){this.db.close();}
}
module.exports={Store,MAX_BYTES};
