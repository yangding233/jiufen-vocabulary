'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('vocabHost',Object.freeze({
 call:(method,payload)=>ipcRenderer.sendSync('vocab-native-call',{method,payload}),
 callAsync:(method,payload)=>ipcRenderer.invoke('vocab-native-call-async',{method,payload})
}));
