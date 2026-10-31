from pathlib import Path
import re,hashlib,json
R=Path(__file__).resolve().parents[1]
html=(R/'tools/source.html').read_text(encoding='utf-8')
assert re.search(r'<script id="portable-state" type="application/json">\s*null\s*</script>',html)
scripts=list(re.finditer(r'<script>([\s\S]*?)</script>',html));app=scripts[-1][1]
assert len(scripts)==2,'Expect one bundled pako library and one app'
(R/'web/pako.min.js').write_text(scripts[0][1],encoding='utf-8')
html=html.replace(scripts[0][0],'<script src="pako.min.js"></script>')
def change(a,b):
 global app
 assert a in app,a[:70]
 app=app.replace(a,b)
change("function persist(forcePlain=false) {", "function persist(forcePlain=false) {\n  if(nativeEnabled)return nativePersist();")
change("try { primary=localStorage.getItem(KEY); previous=localStorage.getItem(PREVIOUS); legacy=localStorage.getItem(OLD); } catch(e){storageError=true;}", "if(nativeEnabled){primary=usbDocument?envelope(OfflineSync.materialize(usbDocument)):null;}else {try { primary=localStorage.getItem(KEY); previous=localStorage.getItem(PREVIOUS); legacy=localStorage.getItem(OLD); } catch(e){storageError=true;}}")
change("const before=copy(state); fn(state);", "if(usbLocked){message('同步进行中，请先完成或退出同步。');return false;}\n  const before=copy(state); fn(state);")
change("persist();\n  if(blocked)state=before;", "const stored=persist();\n  if(blocked||nativeEnabled&&!stored)state=before;")
change("if(renderAfter)render(); return !blocked;", "if(renderAfter)render(); return !blocked&&(!nativeEnabled||stored);")
change("function download(content,name,type) {", "function download(content,name,type) { if(nativeEnabled){VocabNative.call('export',{content,name,type});return;}")
# Device-local wall-clock must not alter the account's learning day.
change("const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;", "const day=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);")
change("function addDays(date, n) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate()+n); return day(d); }", "function addDays(date,n){const d=new Date(date+'T04:00:00Z');d.setUTCDate(d.getUTCDate()+n);return day(d);}")
change("new Date(date+'T12:00:00').getDay()", "new Date(date+'T04:00:00Z').getUTCDay()")
change("new Date(date+'T12:00:00').getDay()", "new Date(date+'T04:00:00Z').getUTCDay()") if "new Date(date+'T12:00:00').getDay()" in app else None
change("function backup(portable=false,mark=true) {", "function backup(portable=false,mark=true) { if(portable&&nativeEnabled){message('桌面／手机版本请导出完整 JSON；安装包与学习记录分别备份。');return;}")
change("function restoreImport(replace) {", "function restoreImport(replace) {\n if(nativeEnabled&&usbDocument&&((usbDocument.operations||[]).length||state.history.length)){message('此入口只用于首次迁移到空白档案。已有记录请使用 USB 同步；恢复旧备份需先另存并建立独立档案，避免覆盖两端操作。',true);return;}")
# Keep history dates and state during first legacy import, rather than replaying an imported snapshot as new feedback.
change("const rev=state.revision;", "const rev=state.revision;\n    if(nativeEnabled&&usbDocument&&!(usbDocument.operations||[]).length&&state.history.length===0){usbDocument=null;}")
# Expose only test/host reload hook; no Node or filesystem capabilities in learning page.
change("boot();", (R/'tools/web-integration.js').read_text(encoding='utf-8')+"\nboot();\nwindow.dispatchEvent(new Event('vocab-ready'));" )
(R/'web/app.js').write_text(app,encoding='utf-8')
html=html.replace(scripts[-1][0],'<script src="sync-core.js"></script><script src="native-adapter.js"></script><script src="app.js"></script>')
css=re.search(r'<style>([\s\S]*?)</style>',html)[1]
(R/'web/style.css').write_text(css+'\n.usb-panel{margin-bottom:20px}.usb-panel textarea{width:100%}#usb-message{white-space:pre-line;overflow-wrap:anywhere}.usb-locked{pointer-events:none;opacity:.55}\n',encoding='utf-8')
html=re.sub(r'<style>[\s\S]*?</style>','<link rel="stylesheet" href="style.css">',html,count=1)
html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',1)
html=html.replace('<main>','''<main><section class="panel usb-panel" aria-label="数据线同步"><div class="row spread"><strong>九分离线版 · USB 同步</strong><span class="small muted">学习时不需要联网</span></div>
<p id="usb-message" role="status" aria-live="polite">正在载入本机记录…</p><div id="usb-desktop-options"><label class="field">手机 App 标识（签名工具更改后填写实际值）<input id="usb-bundle" value="com.jiufen.vocabulary" maxlength="180"></label><label class="checks"><input type="checkbox" id="usb-bootstrap">首次配对：允许用已有进度初始化尚未学习的一端</label></div><div class="row"><button id="usb-start" class="primary">数据线同步</button><button id="usb-probe">检查手机连接</button><button id="usb-finish" hidden>退出同步准备</button></div><p class="muted small">首次迁移：在“备份与设置”导入旧网页的完整 JSON，核对后再初始化手机。同步前手机需解锁并打开 App。</p><details><summary>同步档案备份与恢复</summary><p class="small">日常备份请保存同步档案，它保留配对身份和操作记录。同档案恢复会合并；不同档案只允许导入空白设备。</p><button id="usb-archive-export">导出完整同步档案</button><label class="field">恢复／合并同步档案<input id="usb-archive-import" type="file" accept=".json,application/json"></label></details><div id="usb-conflicts"></div></section><div id="usb-workspace">''',1)
html=html.replace('</main>','</div></main>',1)
(R/'web/index.html').write_text(html,encoding='utf-8')
core=R/'shared/sync-core.js'
if core.exists():(R/'web/sync-core.js').write_bytes(core.read_bytes())
print('Prepared offline shared web UI; source SHA256:',hashlib.sha256((R/'tools/source.html').read_bytes()).hexdigest())
