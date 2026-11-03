"""Apply the 0.2 offline learning UI to the maintained shared web application."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app_path = ROOT/'web/app.js'
app = app_path.read_text(encoding='utf-8')


def change(before, after):
    global app
    assert app.count(before) == 1, 'Unexpected app template: '+before[:100]
    app = app.replace(before, after, 1)


if '// Learning features 0.2:' not in app:
    change("MODES = ['mnemonic','context','cloze','meaning']", "MODES = ['mnemonic','context','cloze','meaning','listening']")
    change("m=memoryIndex.get(normalize(w.word))||{kind:", "m=chosenMemoryFor(w)||{kind:")
    change("builtin=memoryIndex.get(normalize(w.word))||m", "builtin=chosenMemoryFor(w)||m")
    change(' <details><summary>方法与来源</summary>', ' ${cueControls(w)}\n <details><summary>方法与来源</summary>')
    change("const mode=s.mode==='cloze'&&!w.sentence.trim()?'meaning':s.mode;", "const sentenceText=usageFor(w).sentence||w.sentence;\n  const mode=s.mode==='cloze'&&!sentenceText.trim()?'meaning':s.mode;")
    change("w.meaning:'先回忆目标词';", "w.meaning:mode==='listening'?'听音，回忆意思':'先回忆目标词';")
    change("(mode==='meaning'||mode==='mnemonic')&&!s.shown", "(mode==='meaning'||mode==='mnemonic'||mode==='listening')&&!s.shown")
    change("escape(w.sentence).replace(new RegExp(regex(w.word),'i')", "escape(sentenceText).replace(new RegExp(regex(w.word),'i')")
    change("el('spelling-box').hidden=mode!=='meaning'||s.shown;", "el('spelling-box').hidden=!['meaning','listening'].includes(mode)||s.shown;")
    change("el('spelling-label').textContent='看中文回忆拼写（独立模式）';", "el('spelling-label').textContent=mode==='listening'?'听音后尝试拼写（可选）':'看中文回忆拼写（独立模式）';")
    change("wordCovered:false,initialCount:items.length", "wordCovered:false,recallStatus:'',initialCount:items.length")
    change("s.wordCovered=false;s.updatedAt=now();", "s.wordCovered=false;s.recallStatus='';s.updatedAt=now();")
    change("if(value==='good') {c.streak=Math.min(c.streak+1,7);c.interval=[1,3,7,14,30,60,120][c.streak-1];}\n      else {c.streak=value==='again'?0:Math.max(0,c.streak-1);c.interval=1;if(value==='again')c.lapses++;}", "Object.assign(c,LearningTools.nextSchedule(c,{grade:value,...eventLearningExtras(s,wordById(id),value)}));")
    change("kind:eventKind,nextDue:c.due,interval:c.interval,answerViewed:Boolean(s.shown),hintUsed:Boolean(s.cueSeen||s.hintShown)", "kind:eventKind,nextDue:c.due,interval:c.interval,answerViewed:Boolean(s.shown),hintUsed:Boolean(s.cueSeen||s.hintShown),...eventLearningExtras(s,wordById(id),value)")
    change("storageStatus();\n}\nfunction renderStudy()", "storageStatus();renderLearningEnhancements();\n}\nfunction renderStudy()")
    change("el('detail-sentence').textContent=w.sentence;", "el('detail-sentence').innerHTML=usageHTML(w);")
    change("function download(content,name,type) { if(nativeEnabled){VocabNative.call('export',{content,name,type});return;}", "function download(content,name,type) { if(nativeEnabled)return VocabNative.call('export',{content,name,type});")
    change("setTimeout(()=>URL.revokeObjectURL(url),2000); }", "setTimeout(()=>URL.revokeObjectURL(url),2000);return {status:'requested'}; }")
    start=app.index('function backup(portable=false,mark=true) {')
    end=app.index('\nfunction legacyFile(',start)
    app=app[:start]+'''function backup(portable=false,mark=true) {
 if(portable&&nativeEnabled){message('请导出完整同步档案，方便两端恢复配对身份。');return;}
 flushSpelling();
 const stamp=day()+'_'+new Date().toTimeString().slice(0,8).replaceAll(':','-');
 let content=envelope(state),name=`九分常规联想_完整备份_${stamp}.json`,type='application/json;charset=utf-8';
 if(portable){const root=document.documentElement.cloneNode(true);root.querySelector('#portable-state').textContent=content.replace(/</g,'\\\\u003c');root.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));content='<!doctype html>\\n'+root.outerHTML;name=`九分常规联想_含进度_${stamp}.html`;type='text/html;charset=utf-8';}
 try{const result=download(content,name,type);if(exportResult(result,'备份文件已保存。')&&mark)commit(s=>{s.meta.lastBackupAt=now();});}catch(e){message('备份未保存：'+e.message,true);}
}'''+app[end:]
    marker='// Included inside the existing app closure, before boot().'
    change(marker,(ROOT/'tools/learning-integration.js').read_text(encoding='utf-8')+'\n'+marker)
    app_path.write_text(app,encoding='utf-8')

# Refresh the integration sources on each build without changing the application body.
app=app.replace("session.hintShown=false;session.cueSeen=false;}","session.hintShown=false;session.cueSeen=false;session.recallStatus='';}")
app=app.replace("session.cueSeen=false;session.updatedAt=now();","session.cueSeen=false;session.recallStatus='';session.updatedAt=now();")
app=app.replace("session.wordCovered=false;}","session.wordCovered=false;session.recallStatus='';}")
app=app.replace("s.session.wordCovered=false;s.session.updatedAt=now();","s.session.wordCovered=false;s.session.recallStatus='';s.session.updatedAt=now();")
app=app.replace("s.session.typed='';s.session.updatedAt=now();s.undo=null;","s.session.typed='';s.session.hintShown=false;s.session.cueSeen=false;s.session.wordCovered=false;s.session.recallStatus='';s.session.updatedAt=now();s.undo=null;")
start=app.index('// Learning features 0.2:')
native=app.index('// Included inside the existing app closure, before boot().',start)
app=app[:start]+(ROOT/'tools/learning-integration.js').read_text(encoding='utf-8')+'\n'+app[native:]
native=app.index('// Included inside the existing app closure, before boot().')
app=app[:native]+(ROOT/'tools/web-integration.js').read_text(encoding='utf-8')+'\nboot();\nwindow.dispatchEvent(new Event(\'vocab-ready\'));\n})();\n'
app_path.write_text(app,encoding='utf-8')

html_path=ROOT/'web/index.html'
html=html_path.read_text(encoding='utf-8')
if 'id="learning-quality"' not in html:
    html=html.replace('width=device-width, initial-scale=1','width=device-width, initial-scale=1, viewport-fit=cover',1)
    html=html.replace('<section class="panel usb-panel" aria-label="数据线同步">','<section class="panel usb-panel" aria-label="数据线同步"><div class="row spread small"><span id="sync-brief">离线学习 · 需要时连接电脑同步</span><span id="app-version">软件 1.1.0</span></div><details id="usb-panel-details" open><summary id="usb-summary">数据线同步</summary>',1)
    html=html.replace('<div id="usb-conflicts"></div></section>','<div id="usb-conflicts"></div></details></section>',1)
    html=html.replace('<option value="meaning">看中文，回忆拼写</option>','<option value="meaning">看中文，回忆拼写</option><option value="listening">听音，回忆意思</option>')
    html=html.replace('<div class="sentence" id="sentence"></div>','''<div class="sentence" id="sentence"></div><div class="audio-tools row"><button id="play-audio">▶ 播放读音</button><label class="small">口音 <select id="audio-voice"><option value="en-GB">英式</option><option value="en-US">美式</option></select></label><label class="small">速度 <select id="audio-rate"><option value="1">正常</option><option value="0.75">慢速</option></select></label><span id="audio-status" class="small muted">随包离线合成音</span></div>''',1)
    html=html.replace('<div id="memory-card" class="memory-card" hidden></div>','''<div id="study-usage" hidden></div><label class="field small">本次回忆方式（可选）<select id="recall-status"><option value="">不另外标记</option><option value="independent">先独立想起，再核对</option><option value="assisted">依靠提示才想起</option></select></label><div id="memory-card" class="memory-card" hidden></div>''',1)
    html=html.replace('<div id="plan-note" class="muted"></div>','''<div id="plan-note" class="muted"></div><p id="load-advice" class="small notice"></p><details class="workload"><summary>未来7天的学习负担估算</summary><div id="workload-week" class="plan-week"></div><p id="workload-note" class="small muted"></p></details>''',1)
    html=html.replace('<h2>学习记录</h2>','''<h2>学习记录</h2><div id="learning-quality"></div><details><summary>最近的拼写错题</summary><div id="spelling-mistakes"></div></details><details><summary>需要换巧记的词</summary><div id="cue-problems" class="row"></div></details>''',1)
    html=html.replace('<h2>备份与设置</h2>','''<h2>备份与设置</h2><section class="panel"><h3>显示与复习</h3><label class="field">文字大小<select id="font-size"><option value="normal">标准</option><option value="large">大字</option></select></label><label class="checks"><input id="adaptive-review" type="checkbox">根据本次回忆情况调整后续间隔</label><p class="small muted">从今后的反馈生效，保留已有历史和已安排日期；随时可以关闭。</p></section><section class="panel"><h3>离线内容更新</h3><p id="content-version"></p><p class="small">在电脑或手机导入完整内容包。连接数据线同步时，也会传递较新的内容；你的个人联想与进度保留。</p><button id="content-export">导出当前内容包</button><label class="field">导入新版内容包<input id="content-import" type="file" accept=".json,application/json"></label></section><section class="panel"><h3>内部备份中心</h3><p class="small">内部快照和已保存到“文件”或电脑目录的外部档案是两份保护。预览不会改变当前档案。</p><button id="load-backups">查看内部快照</button><div id="backup-list"></div><p id="backup-preview" class="small"></p><button id="export-snapshot" hidden>导出这份恢复副本</button><button id="restore-snapshot" hidden>建立独立恢复档案</button></section>''',1)
    html=html.replace('<p id="detail-sentence" class="long"></p>','<div id="detail-sentence" class="long"></div>',1)
    html=re.sub(r'<div class="notice"><strong>下次怎样继续？</strong>[\s\S]*?</div>', '<div class="notice"><strong>下次怎样继续？</strong><p>再次打开本机程序，点击“继续上次任务”。每次反馈自动保存到本机。需要跨设备学习时，通过数据线同步；在升级、续签或换设备前，导出完整同步档案并确认保存。</p></div>',html,count=1)
    html=re.sub(r'<details><summary>保存方式与边界</summary>[\s\S]*?</details>', '<details><summary>保存与恢复说明</summary><p>Windows 和 iPhone 的学习档案保存在本机数据库，并保留内部快照。完整同步档案包含配对身份和操作记录，建议另存一份到外部目录或“文件”。同档案导入会合并；历史快照可先导出为恢复副本核对。日常学习和数据线同步不需要联网。</p></details>',html,count=1)
    html=html.replace('认识逐步按1、3、7、14、30、60、120天安排；模糊或忘记改为次日','可在设置中选择按回忆情况调整间隔，或沿用1、3、7、14、30、60、120天的基础规则；模糊或忘记会较快复习',1)
    html=html.replace('这是简化间隔规则，不估算精确记忆率','负担和用时是估算值，不表示精确记忆率',1)
    html=html.replace('<script src="sync-core.js"></script>','<script src="learning-tools.js"></script><script src="sync-core.js"></script><script src="content-pack.js"></script>',1)
    html=html.replace('<script id="portable-state"','<script id="learning-content" type="application/json">null</script><script id="audio-data" type="application/json">{"entries":{}}</script><script id="portable-state"',1)
help_file=ROOT/'tools/help-content.html'
if help_file.exists():
    help_body='<dialog id="help-dialog" aria-labelledby="help-title"><div class="row spread"><h2 id="help-title">简单使用说明</h2><button id="close-help">关闭</button></div>'+help_file.read_text(encoding='utf-8')+'</dialog>'
    if 'id="help-dialog"' in html:html=re.sub(r'<dialog id="help-dialog"[\s\S]*?</dialog>',lambda _:help_body,html,count=1)
    else:html=html.replace('<script id="learning-content"',help_body+'\n<script id="learning-content"',1)
    if 'id="open-help"' not in html:html=html.replace('<h1>九分常规词汇 · 联想巧记</h1>','<h1>九分常规词汇 · 联想巧记</h1><button id="open-help">使用说明</button>',1)
html_path.write_text(html,encoding='utf-8')
for name in ('learning-tools.js','content-pack.js','sync-core.js'):
    source=ROOT/'shared'/name
    if source.exists():(ROOT/'web'/name).write_bytes(source.read_bytes())
style_path=ROOT/'web/style.css'
style=style_path.read_text(encoding='utf-8').split('/* Learning 0.2 styles */')[0].rstrip()
style_path.write_text(style+'\n/* Learning 0.2 styles */\n'+(ROOT/'tools/learning-style.css').read_text(encoding='utf-8'),encoding='utf-8')
print('Prepared 0.2 offline learning UI')
