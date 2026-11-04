'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path'),fs=require('node:fs'),{fileURLToPath}=require('node:url');
const {Store}=require('./storage.cjs');
const projectRoot=path.resolve(__dirname,'../..'),webFile=path.join(projectRoot,'web','index.html');
const DesktopState=require(path.join(projectRoot,'shared','desktop-state.js'));
const ContentPack=require(path.join(projectRoot,'shared','content-pack.js'));
const appVersion=require(path.join(projectRoot,'package.json')).version;
const contentWords=JSON.parse(fs.readFileSync(path.join(projectRoot,'web','content-pack.json'),'utf8')).entries;
if(contentWords.length!==1493)throw new Error('安装包的完整内容词库数量不正确。');
let window,store,closing=false,reloading=false;
const smoke=process.argv.includes('--smoke-test');
function contentVersion(){const installed=store.loadContent();if(installed)return installed.version;return JSON.parse(fs.readFileSync(path.join(projectRoot,'web','content-pack.json'),'utf8')).version||null;}
function validateCompleteContent(pack){const validated=ContentPack.validate(pack,contentWords);if(validated.entries.length!==1493)throw new Error('请选择包含全部 1,493 词的完整内容包。');return validated;}
function migrateDocument(document){
 if(document?.format==='jiufen-desktop')return document;
 const LegacyReader=require(path.join(projectRoot,'shared','legacy-reader.js'));
 return DesktopState.createDocument(LegacyReader.documentState(document),document.deviceId,document.profileId);
}
function trusted(event){try{return !!window&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&path.resolve(fileURLToPath(event.senderFrame.url))===webFile;}catch(_){return false;}}
function nativeCall(method,payload){
 switch(method){
  case 'load':return store.load();
  case 'save':return store.save(payload);
  case 'contentLoad':case 'loadContent':return store.loadContent();
  case 'contentSave':case 'saveContent':return store.saveContent(validateCompleteContent(payload));
  case 'listBackups':return store.listBackups();
  case 'backupPreview':return store.backupPreview(payload?.id);
  case 'recoveryCreate':return store.createRecovery(payload?.document);
  case 'appStatus':return {platform:'windows',appVersion,contentVersion:contentVersion(),deviceId:store.getMeta('deviceId'),message:'Windows 离线学习，进度保存在本机。'};
  case 'export':{
   if(!payload||typeof payload.content!=='string'||Buffer.byteLength(payload.content)>50*1024*1024)throw new Error('导出内容为空或超过 50MB。');
   const name=path.basename(String(payload.name||'学习备份.json')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
   const selected=dialog.showSaveDialogSync(window,{title:'保存学习备份',defaultPath:name});if(!selected)return false;
   fs.writeFileSync(selected,payload.content,'utf8');return true;
  }
  default:throw new Error('不支持的本机操作：'+method);
 }
}
function request(event,request){
 if(!trusted(event))return {ok:false,error:'不受信任的页面请求。'};
 try{if(!request||typeof request.method!=='string')throw new Error('无效的本机请求。');return {ok:true,value:nativeCall(request.method,request.payload)};}catch(e){return {ok:false,error:e.message};}
}
app.setName('九分词汇离线学习');
if(process.env.JIUFEN_DATA_DIR){const isolatedProfile=path.join(path.resolve(process.env.JIUFEN_DATA_DIR),'electron-profile');fs.mkdirSync(isolatedProfile,{recursive:true});app.setPath('userData',isolatedProfile);}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(async()=>{
  const dataRoot=process.env.JIUFEN_DATA_DIR||path.join(app.getPath('userData'),'offline-v1');
  store=new Store(dataRoot,doc=>{DesktopState.validateDocument(doc);return doc.state;},{contentValidator:validateCompleteContent,migrateDocument});
  window=new BrowserWindow({width:1180,height:900,minWidth:650,minHeight:550,title:'九分词汇 · 离线学习',icon:path.join(__dirname,'icon.png'),show:!smoke,backgroundColor:'#202a23',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('before-input-event',(event,input)=>{
   if(input.type!=='keyDown'||!(input.key==='F5'||input.control&&input.key.toLowerCase()==='r'))return;
   event.preventDefault();if(reloading||closing)return;reloading=true;
   window.webContents.executeJavaScript('Promise.resolve(window.VocabPersistence?.flush?.() ?? true)').then(saved=>{
    if(saved===false)throw new Error('学习进度尚未保存。请处理页面中的保存错误后再刷新。');
    window.reload();
   }).catch(error=>{dialog.showMessageBox(window,{type:'error',title:'进度尚未保存',message:error.message,buttons:['返回学习']});}).finally(()=>{reloading=false;});
  });
  window.webContents.on('will-navigate',(event,url)=>{try{if(path.resolve(fileURLToPath(url))!==webFile)event.preventDefault();}catch(_){event.preventDefault();}});
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')&&!details.url.startsWith('devtools:')}));
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  ipcMain.on('vocab-native-call',(event,payload)=>{event.returnValue=request(event,payload);});
  ipcMain.handle('vocab-native-call-async',(event,payload)=>request(event,payload));
  window.on('close',event=>{
   if(closing||smoke)return;
   event.preventDefault();
   window.webContents.executeJavaScript('Promise.resolve(window.VocabPersistence?.flush?.() ?? true)').then(saved=>{
    if(saved===false)throw new Error('学习进度尚未保存。请处理页面中的保存错误后再关闭。');
    closing=true;window.close();
   }).catch(error=>{dialog.showMessageBox(window,{type:'error',title:'进度尚未保存',message:error.message,buttons:['返回学习']});});
  });
  if(!fs.existsSync(webFile)){dialog.showErrorBox('页面尚未生成','请先运行项目的网页生成步骤。');app.quit();return;}
  await window.loadFile(webFile);
  if(smoke){
   const result=await window.webContents.executeJavaScript("({title:document.title,host:typeof window.vocabHost?.callAsync,status:window.vocabHost.call('appStatus'),load:window.vocabHost.call('load')})");
   console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,sqlite:true,result}));app.quit();
  }
 }).catch(error=>{console.error(error);if(!smoke)dialog.showErrorBox('启动失败',error.message);app.exit(1);});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{if(closing&&store){store.close();store=null;}});
 app.on('will-quit',()=>{if(store){store.close();store=null;}});
}
