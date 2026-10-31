'use strict';
window.VocabNative={
 platform:window.vocabHost?'windows':window.__JIUFEN_IOS__?'ios':'browser',
 call(method,payload=null){
  let response;
  if(window.vocabHost)response=window.vocabHost.call(method,payload);
  else if(window.__JIUFEN_IOS__){
   const raw=window.prompt('__JIUFEN_NATIVE__'+JSON.stringify({method,payload}),'');
   if(!raw)throw new Error('手机本机存储没有返回结果');
   response=JSON.parse(raw);
  }else throw new Error('请在九分离线 App 或 Windows 桌面程序中使用此功能');
  if(response?.ok===false)throw new Error(response.error||'本机操作失败');
  return response?.ok===true?response.value:response;
 }
};
