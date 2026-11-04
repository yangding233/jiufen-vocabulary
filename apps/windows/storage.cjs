'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const MAX_BYTES=50*1024*1024;
class Store {
 constructor(directory,validator=null,{contentValidator=null,migrateDocument=null}={}){
  fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.validator=validator;this.contentValidator=contentValidator;this.migrateDocument=migrateDocument;
  this.db=new DatabaseSync(path.join(directory,'progress.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS backups(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,value TEXT NOT NULL);');
  if(!this.getMeta('deviceId'))this.setMeta('deviceId','windows-'+crypto.randomUUID());
 }
 getMeta(key){const row=this.db.prepare('SELECT value FROM kv WHERE key=?').get('meta:'+key);return row?JSON.parse(row.value):null;}
 setMeta(key,value){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('meta:'+key,JSON.stringify(value));}
 load(){
  const row=this.db.prepare("SELECT value FROM kv WHERE key='document'").get();if(!row)return null;
  const original=JSON.parse(row.value),document=this.readDocument(original);
  if(document!==original){
   // This immutable original is never part of rolling backup cleanup.
   this.saveMigrationBackup(row.value);
   this.save(document,{clearPairing:true});
  }
  return document;
 }
 readDocument(document){
  const converted=this.migrateDocument&&document?.format!=='jiufen-desktop'?this.migrateDocument(document):document;
  this.validate(converted);return converted;
 }
 saveMigrationBackup(raw){
  const directory=path.join(this.directory,'migration-backups');fs.mkdirSync(directory,{recursive:true});
  const digest=crypto.createHash('sha256').update(raw).digest('hex'),file=path.join(directory,'legacy-'+digest+'.json');
  if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==raw)throw new Error('原档案迁移备份校验失败，未修改学习记录。');return file;}
  fs.writeFileSync(file,raw,{encoding:'utf8',flag:'wx',flush:true});return file;
 }
 validate(doc){
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||!(doc.format==='jiufen-desktop'&&doc.schema===1||doc.format==='jiufen-usb'&&[1,2].includes(doc.schema)))throw new Error('学习数据格式不正确。');
  const raw=JSON.stringify(doc);if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new Error('学习数据超过 50MB，未保存。');
  if(typeof doc.profileId!=='string'||!doc.profileId||typeof doc.deviceId!=='string'||!doc.deviceId||doc.format==='jiufen-usb'&&!Array.isArray(doc.operations)||doc.format==='jiufen-desktop'&&(!doc.state||typeof doc.state!=='object'))throw new Error('学习数据身份或内容不完整。');
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
  this.saveBackup('before-recovery',current);return this.save(document,{clearPairing:true});
 }
 saveBackup(label,doc){
  const raw=this.validate(doc),dir=path.join(this.directory,'snapshots');fs.mkdirSync(dir,{recursive:true});
  const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+label.replace(/[^a-z0-9-]/gi,'_')+'-'+crypto.randomUUID().slice(0,8)+'.json';
  const file=path.join(dir,name);fs.writeFileSync(file,raw,{encoding:'utf8',flag:'wx'});
  for(const old of this.backupFiles().filter(file=>file.directory===dir).slice(20))fs.unlinkSync(path.join(dir,old.name));return file;
 }
 backupFiles(){
  const files=[];
  // Old file backups remain readable; new snapshots use a platform-neutral name.
  for(const folder of ['snapshots','sync-backups']){
   const directory=path.join(this.directory,folder);if(!fs.existsSync(directory))continue;
   for(const entry of fs.readdirSync(directory,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.json')){
    files.push({name:entry.name,directory,id:'file:'+crypto.createHash('sha256').update(folder+'/'+entry.name).digest('hex').slice(0,24),at:fs.statSync(path.join(directory,entry.name)).mtime.toISOString()});
   }
  }
  return files.sort((a,b)=>b.at.localeCompare(a.at)||a.name.localeCompare(b.name));
 }
 backupSummary(doc){
  const state=this.validator?.(doc)||doc.state||doc.baseline||{};
  return {words:Array.isArray(state.words)?state.words.length:0,history:Array.isArray(state.history)?state.history.length:0,seen:state.cards&&typeof state.cards==='object'?Object.values(state.cards).filter(card=>card?.seen).length:0};
 }
 listBackups(){
  const entries=[];
  for(const row of this.db.prepare('SELECT id,at,value FROM backups ORDER BY id DESC LIMIT 20').all()){
   try{const doc=this.readDocument(JSON.parse(row.value));entries.push({id:'sqlite:'+row.id,at:row.at,...this.backupSummary(doc)});}catch(_){/* A corrupt snapshot is never presented as restorable. */}
  }
  for(const file of this.backupFiles().slice(0,20)){
   try{const doc=this.backupPreview(file.id);entries.push({id:file.id,at:file.at,...this.backupSummary(doc)});}catch(_){}
  }
  return entries.sort((a,b)=>b.at.localeCompare(a.at));
 }
 backupPreview(id){
  if(typeof id!=='string'||id.length>100)throw new Error('备份编号无效。');let raw;
  if(/^sqlite:[1-9][0-9]*$/.test(id)){const row=this.db.prepare('SELECT value FROM backups WHERE id=?').get(Number(id.slice(7)));if(row)raw=row.value;}
  else if(/^file:[a-f0-9]{24}$/.test(id)){
   const file=this.backupFiles().find(item=>item.id===id);if(file){const location=path.join(file.directory,file.name),size=fs.statSync(location).size;if(size>MAX_BYTES)throw new Error('备份超过 50MB。');raw=fs.readFileSync(location,'utf8');}
  }
  if(raw===undefined)throw new Error('找不到这份备份，可能已超过保留数量。');return this.readDocument(JSON.parse(raw));
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
