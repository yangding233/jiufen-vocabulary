'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),A=require('../shared/audio-library.js');
const root=path.resolve(__dirname,'..');
test('every built-in sentence has exact offline British and American recordings with complete file hashes',()=>{
 const pack=JSON.parse(fs.readFileSync(path.join(root,'web/content-pack.json'),'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(root,'web/sentence-audio-manifest.json'),'utf8')),files=new Set();
 assert.equal(pack.entries.length,1493);assert.equal(Object.keys(manifest.entries).length,2986);assert.equal(manifest.recipe,A.RECIPE);
 for(const entry of pack.entries)for(const locale of ['en-GB','en-US']){
  const key=A.key(entry.usage.sentence,locale),record=manifest.entries[key];A.validateRecord(record,key);assert.equal(manifest.words[entry.id][locale],key);assert.equal(record.file,`sentence-audio/${locale}/${key}.m4a`);
  const data=fs.readFileSync(path.join(root,'web',record.file));assert.equal(data.length,record.bytes);assert.equal(data.toString('ascii',4,8),'ftyp');assert.equal(crypto.createHash('sha256').update(data).digest('hex'),record.sha256);files.add(record.file);
 }
 const actual=new Set();for(const locale of ['en-GB','en-US'])for(const name of fs.readdirSync(path.join(root,'web/sentence-audio',locale)))actual.add(`sentence-audio/${locale}/${name}`);assert.deepEqual(actual,files);
});
