'use strict';
window.VocabNative={
 platform:window.vocabHost?'windows':'browser',
 call(method,payload=null){
  let response;
  if(window.vocabHost)response=window.vocabHost.call(method,payload);
  else throw new Error('请在 Windows 桌面程序中使用此功能');
  if(response?.ok===false)throw new Error(response.error||'本机操作失败');
  return response?.ok===true?response.value:response;
 },
 async callAsync(method,payload=null){
  if(!window.vocabHost)throw new Error('请在 Windows 桌面程序中使用此功能');
  const response=window.vocabHost.callAsync?await window.vocabHost.callAsync(method,payload):window.vocabHost.call(method,payload);
  if(response?.ok===false)throw new Error(response.error||'本机操作失败');
  return response?.ok===true?response.value:response;
 }
};
