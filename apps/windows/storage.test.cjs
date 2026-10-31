'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('./storage.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'jiufen-store-'));
const doc=n=>({format:'jiufen-usb',schema:1,profileId:'p',deviceId:'d',baseline:{n},operations:[]});
test('SQLite commits, keeps previous values and preserves stable device identity across reopen',()=>{
 const dir=tmp();let s=new Store(dir);assert.equal(s.load(),null);const device=s.getMeta('deviceId');s.save(doc(1));s.save(doc(2));assert.deepEqual(s.load(),doc(2));assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,1);s.close();s=new Store(dir);assert.equal(s.getMeta('deviceId'),device);assert.deepEqual(s.load(),doc(2));s.close();
});
test('validation failure does not destroy saved state; backups bounded; sync backup written',()=>{
 const dir=tmp(),s=new Store(dir,d=>{if(d.baseline.n<0)throw new Error('Invalid state');});s.save(doc(1));assert.throws(()=>s.save(doc(-1)),/Invalid/);assert.deepEqual(s.load(),doc(1));for(let n=2;n<40;n++)s.save(doc(n));assert.equal(s.db.prepare('SELECT COUNT(*) n FROM backups').get().n,20);const file=s.saveSyncBackup('before-sync',doc(39));assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),doc(39));s.close();
});
test('metadata roundtrips pending batches without changing the document',()=>{
 const s=new Store(tmp());s.save(doc(1));s.setMeta('pendingBatch',{batchId:'b1'});assert.deepEqual(s.getMeta('pendingBatch'),{batchId:'b1'});assert.deepEqual(s.load(),doc(1));s.setMeta('pendingBatch',null);assert.equal(s.getMeta('pendingBatch'),null);s.close();
});
