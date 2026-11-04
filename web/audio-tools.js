(function(){
 'use strict';
 let keys=new Set(),status=null,active=null,token=0,poll=null,preview=null,ready=false;
 const memo=new Map(),builtins=()=>JSON.parse(document.getElementById('audio-data')?.textContent||'{"entries":{}}').entries;
 let builtinWords={};
 const app=()=>window.VocabApp,el=id=>document.getElementById(id),message=text=>{const target=el('audio-tools-message');if(target)target.textContent=text;const toast=el('toast');if(toast)toast.textContent=text;};
 function hash(text,locale){const name=locale+'\n'+text;if(!memo.has(name))memo.set(name,AudioLibrary.key(text,locale));return memo.get(name);}
 function hasText(text){if(!text?.trim())return false;return ['en-GB','en-US'].every(locale=>keys.has(hash(text,locale)));}
 function hasWord(word){return Boolean(builtinWords[word.id])||hasText(word.word);}
 function stop(){token++;if(active){active.pause();active=null;}}
 async function play(text,locale){
  if(!text?.trim()){message('这个词暂无英文例句。');return false;}
  app()?.stopAudio?.();stop();const current=token,voice=locale||el('audio-voice')?.value||'en-GB';
  try{const result=await VocabNative.callAsync('audioResolve',{text,locale:voice});if(current!==token)return false;
   if(!result.available){message('这段文字暂无离线音频。可在词库的“离线音频”中生成。');return false;}
   active=new Audio(result.url);active.playbackRate=Number(app()?.getState()?.settings?.audioRate)||1;active.preservesPitch=true;await active.play();
   if(el('audio-status'))el('audio-status').textContent=(voice==='en-GB'?'英式 Emma':'美式 Heart')+' · 离线整段朗读';return true;
  }catch(error){message('播放失败：'+error.message);return false;}
 }
 function display(){
  if(!ready)return;
  el('audio-component-status').textContent=status?.message||'语音组件尚未连接。';
  el('audio-generate').disabled=!!status?.busy;el('audio-components').disabled=!!status?.busy;el('audio-cancel').hidden=!status?.busy;
  const progress=status?.progress;el('audio-tools-progress').textContent=progress?`已处理 ${progress.done} / ${progress.total} 条${progress.state==='cancelled'?' · 已取消':progress.state==='complete'?' · 已完成':progress.state==='partial'?' · 有项目未完成':''}`:'';
  el('audio-tools-errors').textContent=(progress?.errors||[]).map(item=>[item.text,item.locale,item.error].filter(Boolean).join(' · ')).join('\n');
 }
 async function refresh(){try{status=await VocabNative.callAsync('audioStatus');const previous=keys;keys=new Set(status.keys||[]);display();if((previous.size!==keys.size||[...keys].some(key=>!previous.has(key)))&&!el('view-library')?.hidden)app()?.renderLibrary?.();clearTimeout(poll);if(status.busy)poll=setTimeout(refresh,1500);return status;}catch(error){if(ready)el('audio-component-status').textContent='音频管理需要新版 Windows 桌面程序。';return null;}}
 async function generate(items){try{status=await VocabNative.callAsync('audioGenerate',{items});display();await refresh();}catch(error){message(error.message);}}
 function scopeWords(){const state=app().getState();if(el('audio-scope').value==='selected'){const ids=new Set(app().getSelectedIds());return state.words.filter(w=>ids.has(w.id));}return app().filteredWords();}
 function init(){
  if(ready||!app())return;ready=true;builtinWords=builtins();
  const section=document.createElement('details');section.className='panel';section.id='audio-tools';section.innerHTML='<summary>离线音频：为自加词和例句生成读音</summary><p id="audio-component-status" class="small muted">正在检查本地组件…</p><div class="row"><label>范围 <select id="audio-scope"><option value="selected">选中的词</option><option value="filter">当前词库筛选范围</option></select></label><label>内容 <select id="audio-kind"><option value="word">单词</option><option value="sentence">英文例句</option><option value="both">单词和例句</option></select></label><label>口音 <select id="audio-locales"><option value="both">英式和美式</option><option value="en-GB">英式 Emma</option><option value="en-US">美式 Heart</option></select></label></div><p class="small muted">生成在本机后台运行，已有相同文字的声音会复用。缺少组件时先选择可选语音组件文件夹；已有音频仍可播放。</p><div class="row"><button id="audio-generate">生成缺失音频</button><button id="audio-cancel" hidden>取消生成</button><button id="audio-components">选择语音组件</button><button id="audio-refresh">刷新状态</button></div><p id="audio-tools-message" role="status"></p><p id="audio-tools-progress" role="status"></p><p id="audio-tools-errors" class="small error" style="white-space:pre-wrap"></p>';
  el('view-library').append(section);
  el('audio-generate').addEventListener('click',()=>{try{const words=scopeWords();if(!words.length)throw new Error('请先选择词条，或改为当前词库筛选范围。');const locale=el('audio-locales').value,locales=locale==='both'?['en-GB','en-US']:[locale],kind=el('audio-kind').value,items=[];
   for(const word of words){const texts=[];if(kind!=='sentence')texts.push(word.word);if(kind!=='word'){const sentence=app().usageFor(word).sentence;if(sentence)texts.push(sentence);}for(const text of texts)for(const voice of locales)items.push({text,locale:voice});}
   const unique=AudioLibrary.items(items);if(!confirm(`检查并生成 ${unique.length} 条读音？已存在的声音会复用，生成时可以继续学习。`))return;generate(unique);
  }catch(error){message(error.message);}});
  el('audio-cancel').addEventListener('click',async()=>{try{status=await VocabNative.callAsync('audioCancel');display();setTimeout(refresh,500);}catch(error){message(error.message);}});
  el('audio-components').addEventListener('click',async()=>{try{status=await VocabNative.callAsync('audioConfigure');display();}catch(error){message(error.message);}});
  el('audio-refresh').addEventListener('click',refresh);section.addEventListener('toggle',()=>{if(section.open)refresh();});
  const bundle=document.createElement('section');bundle.className='panel';bundle.innerHTML='<h3>完整迁移包（包含自加音频）</h3><p class="small muted">换电脑时将学习记录和自加音频一起保存。普通 JSON 备份不包含音频文件。</p><div class="row"><button id="audio-bundle-export">导出完整迁移包</button><button id="audio-bundle-preview">预览迁移包</button></div><p id="audio-bundle-summary" role="status"></p><button id="audio-bundle-restore" hidden>确认恢复迁移包</button>';
  el('view-settings').append(bundle);
  el('audio-bundle-export').addEventListener('click',async()=>{try{if(!await VocabPersistence.flush())return;const result=await VocabNative.callAsync('audioBundleExport');el('audio-bundle-summary').textContent=result?'完整迁移包已保存。':'已取消导出。';}catch(error){el('audio-bundle-summary').textContent=error.message;}});
  el('audio-bundle-preview').addEventListener('click',async()=>{try{preview=null;el('audio-bundle-restore').hidden=true;el('audio-bundle-summary').textContent='正在检查迁移包…';preview=await VocabNative.callAsync('audioBundlePreview');el('audio-bundle-summary').textContent=preview?`${preview.words} 个词，${preview.history} 条反馈，${preview.audio} 个自加音频。预览未修改当前记录。`:'已取消选择。';el('audio-bundle-restore').hidden=!preview;}catch(error){el('audio-bundle-summary').textContent=error.message;}});
  el('audio-bundle-restore').addEventListener('click',async()=>{try{if(!preview||!confirm('用这份迁移包恢复学习记录？当前档案会先保留独立副本，已有学习状态将切换。'))return;if(!await VocabPersistence.flush())return;const restore=()=>VocabNative.callAsync('audioBundleRestore',{id:preview.id});if(app().withExclusive)await app().withExclusive(restore);else await restore();location.reload();}catch(error){el('audio-bundle-summary').textContent=error.message;}});
  refresh();
 }
 window.VocabAudio={hasWord,hasSentence:word=>hasText(app()?.usageFor(word)?.sentence),play,playWord:word=>play(word.word),playSentence:word=>play(app().usageFor(word).sentence),generate,refresh,stop,status:()=>status};
 window.addEventListener('vocab-ready',init);window.addEventListener('pagehide',stop);
})();
