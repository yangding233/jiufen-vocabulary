'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path'),fs=require('node:fs'),{fileURLToPath}=require('node:url');
const {Store}=require('./storage.cjs'),{UsbTransport}=require('./transport.cjs'),{SyncManager}=require('./sync-manager.cjs');
const projectRoot=path.resolve(__dirname,'../..'),webFile=path.join(projectRoot,'web','index.html'),core=require(path.join(projectRoot,'shared','sync-core.js'));
let window,store,manager;
const smoke=process.argv.includes('--smoke-test'),fixtureArg=process.argv.find(a=>a.startsWith('--usb-fixture='));
const fixtureDirectory=fixtureArg?path.resolve(fixtureArg.slice('--usb-fixture='.length)):null;
const emit=detail=>{if(window&&!window.isDestroyed())window.webContents.send('vocab-sync-status',detail);};
function trusted(event){try{return event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&path.resolve(fileURLToPath(event.senderFrame.url))===webFile;}catch(_){return false;}}
function nativeCall(method,payload){
 switch(method){
  case 'load':return store.load();
  case 'save':if(manager.busy)throw new Error('正在进行 USB 同步，暂时不能修改学习记录。');return store.save(payload);
  case 'syncStatus':return {platform:'windows',deviceId:store.getMeta('deviceId'),connected:false,busy:manager.busy,lastSync:store.getMeta('lastSync'),pendingBatch:store.getMeta('pendingBatch'),message:fixtureDirectory?'测试目录模式（不是真实手机）':'本机离线保存；数据线连接后点击同步。'};
  case 'probeUsb':
   if(manager.busy)throw new Error('同步进行中，请稍候。');
   transport.list().then(devices=>emit({phase:'devices',devices,message:devices.length?`检测到 ${devices.length} 台 USB 设备。`:'没有检测到 USB iPhone。请连接数据线、解锁并信任电脑。'})).catch(e=>emit({phase:'error',message:e.message}));return {started:true};
  case 'syncUsb':return manager.start(payload||{});
  case 'finishSync':return manager.cancel();
  case 'export':{
   if(!payload||typeof payload.content!=='string'||Buffer.byteLength(payload.content)>50*1024*1024)throw new Error('导出内容为空或超过 50MB。');
   const name=path.basename(String(payload.name||'学习备份.json')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
   const selected=dialog.showSaveDialogSync(window,{title:'保存学习备份',defaultPath:name});if(!selected)return false;
   fs.writeFileSync(selected,payload.content,'utf8');return true;
  }
  default:throw new Error('不支持的本机操作：'+method);
 }
}
const transport=new UsbTransport({projectRoot,resourcesRoot:app.isPackaged?path.join(process.resourcesPath,'usb'):path.join(projectRoot,'tools','dist'),fixtureDirectory});
app.setName('九分词汇离线学习');
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  const dataRoot=process.env.JIUFEN_DATA_DIR||path.join(app.getPath('userData'),'offline-v1');
  store=new Store(dataRoot,doc=>core.materialize(doc));manager=new SyncManager({store,transport,core,emit});
  window=new BrowserWindow({width:1180,height:900,minWidth:360,minHeight:550,title:'九分词汇 · 离线学习与数据线同步',show:!smoke,backgroundColor:'#202a23',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{try{if(path.resolve(fileURLToPath(url))!==webFile)event.preventDefault();}catch(_){event.preventDefault();}});
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')&&!details.url.startsWith('devtools:')}));
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  ipcMain.on('vocab-native-call',(event,request)=>{
   if(!trusted(event)){event.returnValue={ok:false,error:'不受信任的页面请求。'};return;}
   try{if(!request||typeof request.method!=='string')throw new Error('无效的本机请求。');event.returnValue={ok:true,value:nativeCall(request.method,request.payload)};}catch(e){event.returnValue={ok:false,error:e.message};}
  });
  if(!fs.existsSync(webFile)){dialog.showErrorBox('页面尚未生成','请先运行项目的网页生成步骤。');app.quit();return;}
  await window.loadFile(webFile);
  if(smoke){
   const result=await window.webContents.executeJavaScript("({title:document.title,host:typeof window.vocabHost?.call,status:window.vocabHost.call('syncStatus'),load:window.vocabHost.call('load')})");
   console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,sqlite:true,result}));app.quit();
  }
 }).catch(error=>{console.error(error);if(!smoke)dialog.showErrorBox('启动失败',error.message);app.exit(1);});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{if(store){store.close();store=null;}});
}
