'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('vocabHost',Object.freeze({call:(method,payload)=>ipcRenderer.sendSync('vocab-native-call',{method,payload})}));
ipcRenderer.on('vocab-sync-status',(_event,detail)=>window.dispatchEvent(new CustomEvent('vocab-sync-status',{detail})));
