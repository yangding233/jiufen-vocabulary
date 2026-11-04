'use strict';
// Optional integration: uses prepared local component files, never downloads.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {AudioService}=require('../apps/windows/audio-service.cjs'),{Store}=require('../apps/windows/storage.cjs'),D=require('../shared/desktop-state.js'),A=require('../shared/audio-library.js'),fixture=require('./fixtures/legacy-documents.json')[0];
const root=path.resolve(__dirname,'..'),component=process.env.JIUFEN_AUDIO_COMPONENTS||path.join(root,'dist/audio-components/九分离线语音组件-2.1.0');
(async()=>{
 assert(fs.existsSync(path.join(component,'runtime/python.exe')),'Build the optional components first');
 const directory=path.join(root,'test-results','audio-components-'+Date.now()),store=new Store(directory,document=>D.validateDocument(document));store.save(D.createDocument(fixture.expected,store.getMeta('deviceId')));const before=store.load();
 const service=new AudioService({projectRoot:root,directory,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[component]})},getWindow:()=>null,store,DesktopState:D});
 try{await service.configure();assert(service.status().configured);const items=[{text:'The portable speech component works offline.',locale:'en-GB'},{text:'photosynthesis',locale:'en-US'}];service.generate({items});const end=Date.now()+180000;
  while(service.status().busy&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,500));
  const status=service.status();assert.equal(status.busy,false,'generation timeout');assert.equal(status.progress.state,'complete',JSON.stringify(status.progress.errors));assert.equal(status.progress.done,2);
  for(const item of items){const record=service.resolve(item);assert(record.available);assert(record.seconds>1);assert(fs.existsSync(path.join(service.folder,A.key(item.text,item.locale)+'.m4a')));}
  assert.deepEqual(store.load(),before);service.generate({items});assert.equal(service.status().busy,false);assert.equal(service.status().progress.state,'complete');
  service.generate({items:[{text:'Cancel this isolated synthesis task.',locale:'en-GB'}]});await new Promise(resolve=>setTimeout(resolve,300));service.cancel();const cancelledEnd=Date.now()+15000;while(service.status().busy&&Date.now()<cancelledEnd)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(service.status().busy,false);assert.equal(service.status().progress.state,'cancelled');assert.deepEqual(store.load(),before);
  console.log('PASS configured portable component synthesizes real custom word and full sentence offline, resolves cached audio, reuses outputs, cancels its process tree and preserves learning state.');
 }finally{service.cancel();store.close();}
})().catch(error=>{console.error(error);process.exit(1);});
