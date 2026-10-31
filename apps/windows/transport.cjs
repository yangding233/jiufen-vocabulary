'use strict';
const path=require('node:path'),fs=require('node:fs'),{execFile}=require('node:child_process');
class UsbTransport {
 constructor({resourcesRoot,projectRoot,fixtureDirectory=null}){this.resourcesRoot=resourcesRoot;this.projectRoot=projectRoot;this.fixtureDirectory=fixtureDirectory;}
 command(){
  const exe=path.join(this.resourcesRoot,'usb_transport.exe');
  if(fs.existsSync(exe))return {executable:exe,prefix:[]};
  const python=process.env.JIUFEN_USB_PYTHON||path.join(this.projectRoot,'.venv-usb','Scripts','python.exe');
  if(!fs.existsSync(python))throw new Error('USB 组件尚未准备好：请运行 Windows USB 构建脚本，或设置 JIUFEN_USB_PYTHON。');
  return {executable:python,prefix:[path.join(this.projectRoot,'tools','usb_transport.py')]};
 }
 run(action,{udid='',bundleId='com.jiufen.vocabulary',remote='',content=''}={}){
  let cmd;try{cmd=this.command();}catch(e){return Promise.reject(e);}
  const args=[...cmd.prefix,action,'--bundle-id',bundleId];if(udid)args.push('--udid',udid);if(remote)args.push('--remote',remote);if(this.fixtureDirectory)args.push('--fixture-directory',this.fixtureDirectory);
  return new Promise((resolve,reject)=>{
   const child=execFile(cmd.executable,args,{windowsHide:true,encoding:'utf8',maxBuffer:60*1024*1024,timeout:45000},(error,stdout,stderr)=>{
    let result;try{result=JSON.parse(stdout.trim());}catch(_){return reject(new Error('USB 组件未返回有效结果：'+(stderr||error?.message||stdout).slice(0,600)));}
    if(!result.ok)return reject(Object.assign(new Error(result.error||'USB 操作失败'),{code:result.code,stage:result.stage,exceptionType:result.exceptionType}));resolve(result.value);
   });
   if(action==='push'){child.stdin.end(content);}else child.stdin.end();
  });
 }
 list(){return this.run('list');}
 resolveApp(options){return this.run('resolve-app',options);}
 read(options,remote){return this.run('pull',{...options,remote});}
 write(options,remote,content){return this.run('push',{...options,remote,content});}
}
module.exports={UsbTransport};
