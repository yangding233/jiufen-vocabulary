'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const AudioLibrary=require('../../shared/audio-library.js');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>{const temporary=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value),{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,file);};
class AudioService {
 constructor({projectRoot,directory,dialog,getWindow,store,DesktopState}){
  Object.assign(this,{projectRoot,directory,dialog,getWindow,store,DesktopState});this.folder=path.join(directory,'generated-audio');fs.mkdirSync(this.folder,{recursive:true});this.configFile=path.join(directory,'audio-components.json');this.manifestFile=path.join(this.folder,'manifest.json');this.entries={};this.builtins={};this.verified=new Map();this.job=null;this.preview=null;
  if(fs.existsSync(this.manifestFile)){const manifest=JSON.parse(fs.readFileSync(this.manifestFile,'utf8'));for(const [key,record] of Object.entries(manifest.entries||{})){AudioLibrary.validateRecord(record,key);this.entries[key]=record;}}
  const builtin=path.join(projectRoot,'web/sentence-audio-manifest.json');if(fs.existsSync(builtin)){const manifest=JSON.parse(fs.readFileSync(builtin,'utf8'));for(const [key,record] of Object.entries(manifest.entries||{})){AudioLibrary.validateRecord(record,key);if(record.file!==`sentence-audio/${record.locale}/${key}.m4a`)throw new Error('例句音频路径无效。');this.builtins[key]=record;}}
 }
 components(){
  const chosen=fs.existsSync(this.configFile)?JSON.parse(fs.readFileSync(this.configFile,'utf8')).directory:null;
  if(chosen){const base=path.resolve(chosen);return {python:path.join(base,'runtime','python.exe'),models:path.join(base,'models'),encoder:path.join(base,'ffmpeg.exe')};}
  return {python:path.join(this.projectRoot,'.venv-audio','Scripts','python.exe'),models:path.join(this.projectRoot,'build','vendor','kokoro'),encoder:path.resolve(this.projectRoot,'..','work','video-bin','ffmpeg.exe')};
 }
 ready(){const c=this.components();return [c.python,c.encoder,path.join(c.models,'kokoro-v1.0.onnx'),path.join(c.models,'voices-v1.0.bin')].every(file=>fs.existsSync(file)&&fs.statSync(file).isFile());}
 status(){return {configured:this.ready(),busy:!!this.job?.process,progress:this.job?{done:this.job.done,total:this.job.total,errors:[...this.job.errors],state:this.job.state}:null,keys:[...new Set([...Object.keys(this.builtins),...Object.keys(this.entries)])],message:this.ready()?'本地生成组件已就绪。':'已有音频可直接播放；生成新读音需准备可选语音组件。'};}
 async configure(){if(this.job?.process)throw new Error('请先完成或取消当前生成。');const result=await this.dialog.showOpenDialog(this.getWindow(),{title:'选择离线语音组件文件夹（含runtime、models和ffmpeg.exe）',properties:['openDirectory']});if(result.canceled)return this.status();const directory=path.resolve(result.filePaths[0]);const previous=fs.existsSync(this.configFile)?fs.readFileSync(this.configFile,'utf8'):null;write(this.configFile,{directory});if(!this.ready()){if(previous===null)fs.unlinkSync(this.configFile);else fs.writeFileSync(this.configFile,previous);throw new Error('组件不完整，需要 runtime/python.exe、models 内两份模型和 ffmpeg.exe。');}return this.status();}
 resolve({text,locale}){
  const key=AudioLibrary.key(text,locale),record=this.entries[key]||this.builtins[key];if(!record)return {available:false,key};
  const file=this.entries[key]?path.join(this.folder,key+'.m4a'):path.join(this.projectRoot,'web',record.file);
  if(!fs.existsSync(file))return {available:false,key};const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.bytes)return {available:false,key};
  if(this.verified.get(file)!==stat.mtimeMs){if(sha(file)!==record.sha256)return {available:false,key};this.verified.set(file,stat.mtimeMs);}
  return {available:true,key,url:pathToFileURL(file).href,seconds:record.seconds,voice:record.voice};
 }
 persist(){write(this.manifestFile,{schema:1,recipe:AudioLibrary.RECIPE,entries:this.entries});}
 generate(payload){
  if(this.job?.process)throw new Error('已有音频正在生成。');if(!this.ready())throw new Error('请先选择完整的离线语音组件。');
  const items=AudioLibrary.items(payload?.items);const pending=items.filter(item=>!this.resolve(item).available);this.job={process:null,done:items.length-pending.length,total:items.length,errors:[],state:'running'};
  if(!pending.length){this.job.state='complete';return this.status();}
  const requestFile=path.join(this.folder,'request-'+crypto.randomUUID()+'.json'),components=this.components();write(requestFile,{...components,output:this.folder,items:pending,workers:3});
  const worker=path.join(this.projectRoot,'tools','generate_text_audio.py');if(!fs.existsSync(worker))throw new Error('安装包缺少音频生成工具，请重新安装完整程序。');
  const child=spawn(components.python,['-B',worker,'--request',requestFile],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});this.job.process=child;let buffer='',errorText='',lastWrite=0;const skipped=this.job.done;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{errorText=(errorText+text).slice(-4000);});
  const handle=line=>{try{const event=JSON.parse(line);if(event.type==='record'){const record=AudioLibrary.validateRecord(event.record,event.record.key),file=path.join(this.folder,record.key+'.m4a');if(!fs.existsSync(file)||sha(file)!==record.sha256)throw new Error('生成音频的校验失败。');this.entries[record.key]=record;if(Date.now()-lastWrite>500){this.persist();lastWrite=Date.now();}}if(event.type==='item-error'||event.type==='fatal'){if(this.job.errors.length<100)this.job.errors.push({text:event.text||'',locale:event.locale||'',error:event.error});}if(Number.isInteger(event.done))this.job.done=skipped+event.done;}catch(error){if(this.job.errors.length<100)this.job.errors.push({error:error.message});}};
  child.stdout.on('data',text=>{buffer+=text;let n;while((n=buffer.indexOf('\n'))>=0){handle(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(buffer.length>1024*1024){child.kill();this.job.errors.push({error:'生成组件输出异常。'});}});
  child.on('error',error=>{this.job.errors.push({error:error.message});});
  child.on('close',code=>{if(buffer.trim())handle(buffer);this.persist();if(code&&this.job.state!=='cancelled'&&!this.job.errors.length)this.job.errors.push({error:errorText||'生成组件意外退出。'});if(this.job.state!=='cancelled')this.job.state=this.job.errors.length?'partial':'complete';this.job.process=null;try{fs.unlinkSync(requestFile);}catch(_){}});
  return this.status();
 }
 cancel(){if(this.job?.process){this.job.state='cancelled';const child=this.job.process;if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}return this.status();}
 async zip(mode,request){
  const transfer=path.join(this.directory,'audio-transfer');fs.mkdirSync(transfer,{recursive:true});const requestFile=path.join(transfer,'request-'+crypto.randomUUID()+'.json');write(requestFile,request);
  try{return await new Promise((resolve,reject)=>{const process=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'audio-bundle.ps1'),'-Mode',mode,'-RequestFile',requestFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';process.stdout.setEncoding('utf8');process.stderr.setEncoding('utf8');process.stdout.on('data',text=>out+=text);process.stderr.on('data',text=>err+=text);process.on('error',reject);process.on('close',code=>{if(code)return reject(new Error(err.slice(-1500)||'音频迁移包处理失败。'));try{resolve(JSON.parse(out));}catch(_){reject(new Error('音频迁移包返回无效。'));}});});}finally{try{fs.unlinkSync(requestFile);}catch(_){}}
 }
 async exportBundle(){
  if(this.job?.process)throw new Error('请先完成或取消生成，再导出迁移包。');const document=this.store.load();if(!document)throw new Error('请先建立学习记录。');
  const result=await this.dialog.showSaveDialog(this.getWindow(),{title:'导出完整学习迁移包（包含自加音频）',defaultPath:'九分完整迁移包.zip',filters:[{name:'ZIP迁移包',extensions:['zip']}]});if(result.canceled)return false;
  const stage=path.join(this.directory,'audio-transfer','export-'+crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});const raw=JSON.stringify(document);fs.writeFileSync(path.join(stage,'document.json'),raw,'utf8');
  const records={};for(const [key,record] of Object.entries(this.entries))if(this.resolve(record).available)records[key]=record;if(Object.keys(records).length>100000)throw new Error('自加音频数量超过完整迁移包的上限，请先导出JSON文字备份。');
  const manifest={format:'jiufen-audio-backup',schema:1,documentSha256:crypto.createHash('sha256').update(raw).digest('hex'),entries:records};const content=this.store.loadContent();if(content){const file=path.join(stage,'content-pack.json');write(file,content);manifest.contentSha256=sha(file);}write(path.join(stage,'manifest.json'),manifest);
  await this.zip('create',{stage,output:result.filePath,audioFolder:this.folder,keys:Object.keys(records)});return true;
 }
 async previewBundle(){
  if(this.job?.process)throw new Error('请先完成或取消生成。');const selected=await this.dialog.showOpenDialog(this.getWindow(),{title:'预览完整学习迁移包',properties:['openFile'],filters:[{name:'ZIP迁移包',extensions:['zip']}]});if(selected.canceled)return null;
  const id=crypto.randomUUID(),stage=path.join(this.directory,'audio-transfer','import-'+id);const info=await this.zip('extract',{input:selected.filePaths[0],stage});
  const document=JSON.parse(fs.readFileSync(path.join(stage,'document.json'),'utf8'));this.DesktopState.validateDocument(document);const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
  if(manifest.format!=='jiufen-audio-backup'||manifest.schema!==1||!manifest.entries||typeof manifest.entries!=='object'||Array.isArray(manifest.entries)||sha(path.join(stage,'document.json'))!==manifest.documentSha256)throw new Error('迁移包档案校验失败。');
  for(const [key,record] of Object.entries(manifest.entries)){AudioLibrary.validateRecord(record,key);const file=path.join(stage,'audio',key+'.m4a');if(!fs.existsSync(file)||fs.statSync(file).size!==record.bytes||sha(file)!==record.sha256)throw new Error('迁移包音频校验失败。');}
  const actual=fs.existsSync(path.join(stage,'audio'))?fs.readdirSync(path.join(stage,'audio')):[];if(actual.length!==Object.keys(manifest.entries).length)throw new Error('迁移包含有未声明的音频文件。');
  let content=null;const contentFile=path.join(stage,'content-pack.json');if(manifest.contentSha256){if(!fs.existsSync(contentFile)||sha(contentFile)!==manifest.contentSha256)throw new Error('内容包校验失败。');content=this.store.validateContent(JSON.parse(fs.readFileSync(contentFile,'utf8')));}else if(fs.existsSync(contentFile))throw new Error('迁移包含有未声明的内容包。');
  this.preview={id,stage,document,content,entries:manifest.entries};const summary=this.DesktopState.summary(document);return {id,words:summary.wordCount,history:summary.historyCount,audio:Object.keys(manifest.entries).length,bytes:info.bytes};
 }
 restoreBundle({id}){
  if(this.job?.process||!this.preview||this.preview.id!==id)throw new Error('请先重新预览迁移包。');const preview=this.preview,next=this.DesktopState.createDocument(preview.document.state,this.store.load()?.deviceId||this.store.getMeta('deviceId'));
  // New content-addressed files can be staged first without replacing old records.
  const merged={...this.entries};for(const [key,record] of Object.entries(preview.entries)){const source=path.join(preview.stage,'audio',key+'.m4a');if(sha(source)!==record.sha256)throw new Error('音频文件在预览后发生变化。');const target=path.join(this.folder,key+'.m4a');if(!fs.existsSync(target))fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);else if(sha(target)!==record.sha256)throw new Error('本机已有音频内容冲突。');merged[key]=record;}
  const previousEntries=this.entries,previousContent=this.store.loadContent();
  try{write(this.manifestFile,{schema:1,recipe:AudioLibrary.RECIPE,entries:merged});this.entries=merged;if(preview.content)this.store.saveContent(preview.content);this.store.createRecovery(next);}
  catch(error){this.entries=previousEntries;this.persist();if(preview.content)this.store.saveContent(previousContent);throw error;}
  this.preview=null;return true;
 }
}
module.exports={AudioService};
