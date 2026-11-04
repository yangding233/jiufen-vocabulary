(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./desktop-state.js'));else root.AudioLibrary=factory(root.DesktopState);})(typeof globalThis!=='undefined'?globalThis:this,function(core){
 'use strict';
 const RECIPE='kokoro-emma-heart-text-v1',VOICES={'en-GB':'bf_emma','en-US':'af_heart'};
 function normalized(text){if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('读音文本须为1—2000字。');return text.normalize('NFC').trim();}
 function key(text,locale){if(!Object.hasOwn(VOICES,locale))throw new Error('请选择英式或美式读音。');return core.sha256(JSON.stringify([RECIPE,locale,normalized(text)]));}
 function validateRecord(record,id){if(!record||record.key!==id||key(record.text,record.locale)!==id||record.voice!==VOICES[record.locale]||typeof record.seconds!=='number'||record.seconds<.1||record.seconds>180||!Number.isSafeInteger(record.bytes)||record.bytes<256||record.bytes>10*1024*1024||!/^[a-f0-9]{64}$/.test(record.sha256))throw new Error('音频清单内容无效。');return record;}
 function items(input){if(!Array.isArray(input)||input.length<1||input.length>4000)throw new Error('每批生成1—4000条音频。');const out=new Map();for(const item of input){const text=normalized(item?.text),locale=item.locale,id=key(text,locale);out.set(id,{text,locale,key:id});}return [...out.values()];}
 return {RECIPE,VOICES,normalized,key,validateRecord,items};
});
