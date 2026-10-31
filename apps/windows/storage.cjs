'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const MAX_BYTES=50*1024*1024;
class Store {
 constructor(directory,validator=null){
  fs.mkdirSync(directory,{recursive:true});this.directory=directory;this.validator=validator;
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
 save(doc){
  const raw=this.validate(doc),previous=this.db.prepare("SELECT value FROM kv WHERE key='document'").get();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(previous&&previous.value!==raw)this.db.prepare('INSERT INTO backups(at,value) VALUES(?,?)').run(new Date().toISOString(),previous.value);
   this.db.prepare("INSERT INTO kv VALUES('document',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(raw);
   this.db.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 20)').run();
   this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 saveSyncBackup(label,doc){
  const raw=this.validate(doc),dir=path.join(this.directory,'sync-backups');fs.mkdirSync(dir,{recursive:true});
  const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+label.replace(/[^a-z0-9-]/gi,'_')+'.json';
  const file=path.join(dir,name);fs.writeFileSync(file,raw,{encoding:'utf8',flag:'wx'});return file;
 }
 close(){this.db.close();}
}
module.exports={Store,MAX_BYTES};
