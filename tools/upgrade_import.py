"""Keep the local wordbook/import UI reproducible without regenerating private legacy data."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
app_path = ROOT / 'web/app.js'
app = app_path.read_text(encoding='utf-8')
start = app.find('// User wordbooks:')
end = app.find('// Included inside the existing app closure, before boot().')
assert end >= 0
if start >= 0:
    app = app[:start] + app[end:]
end = app.index('// Included inside the existing app closure, before boot().')
app = app[:end] + (ROOT / 'tools/import-integration.js').read_text(encoding='utf-8') + '\n' + app[end:]
app = app.replace("!names.has(normalize(w.word)),'英文词条为空或重复。'", "(object(s.library)||!names.has(normalize(w.word))),'英文词条为空或重复。'")
app = app.replace("  return s;\n}\nfunction decode", "  if(s.library)WordBooks.validate(s);\n  return s;\n}\nfunction decode") if 'if(s.library)WordBooks.validate(s);' not in app else app
app = app.replace("let w=byName.get(normalize(original.word));", "let w=s.words.find(candidate=>candidate.id===String(original.id))||(!s.library?byName.get(normalize(original.word)):null);")
app = app.replace("  s.words.sort((a,b)=>(a.catalogueOrder??1e9)-(b.catalogueOrder??1e9));", "  s.words.sort((a,b)=>(a.catalogueOrder??1e9)-(b.catalogueOrder??1e9));\n  if(s.library)WordBooks.applyOverrides(s);") if 'if(s.library)WordBooks.applyOverrides(s);' not in app else app
app = app.replace("s.words.filter(w=>active(s.cards[w.id])&&!s.cards[w.id].seen)", "s.words.filter(w=>readyWord(w)&&active(s.cards[w.id])&&!s.cards[w.id].seen)")
app = app.replace("ids=[...new Set(ids)].filter(id=>Boolean(wordById(id)));", "ids=[...new Set(ids)].filter(id=>readyWord(wordById(id)));")
app = app.replace("ids=[...new Set(ids)].filter(id=>readyWord(wordById(id))); ", "ids=[...new Set(ids)].filter(id=>readyWord(wordById(id)));")
app = app.replace("return (group==='all'||w.group===group)&&", "return matchesWordbook(w)&&(group==='all'||w.group===group)&&")
app = app.replace("scope==='all'||scope==='mastered'", "scope==='all'||scope==='draft'&&!readyWord(w)||scope==='mastered'")
app = app.replace("function renderLibrary() {\n  const groups", "function renderLibrary() {\n  renderWordbooks();\n  const groups")
library_start=app.index('function filteredWords() {')
library_end=app.index('function renderLibrary() {',library_start)
library_body=app[library_start:library_end]
if 'sortByWordbook(state.words.filter' not in library_body:
    library_body=library_body.replace('return state.words.filter(', 'return sortByWordbook(state.words.filter(',1).replace(');});\n}', ');}));\n}')
    # The filter closes after its block body.
    library_body=library_body.replace(';});\n}', ';}));\n}')
app=app[:library_start]+library_body+app[library_end:]
app = app.replace("status=c.mastered?", "status=!readyWord(w)?'待完善释义':c.mastered?")
old = "el('enroll-selected').addEventListener('click',()=>{if(!selected.size){message('先选择要加入计划的词。');return;}commit(s=>{for(const id of selected){restoreMastered(s,id);s.cards[id].planned=true;s.cards[id].suspended=false;s.cards[id].updatedAt=now();}s.undo=null;});message(`已将 ${selected.size} 词加入或恢复计划。`);});"
new = "el('enroll-selected').addEventListener('click',()=>{const ids=[...selected].filter(id=>readyWord(wordById(id)));if(!ids.length){message('请先选择已有释义的词；待完善词可通过再次导入补齐资料。');return;}if(commit(s=>{for(const id of ids){restoreMastered(s,id);s.cards[id].planned=true;s.cards[id].suspended=false;s.cards[id].updatedAt=now();}s.undo=null;}))message(`已将 ${ids.length} 词加入或恢复计划${selected.size>ids.length?'，已跳过缺释义的词':''}。`);});"
app = app.replace(old, new)
# The legacy shortcut uses the same preview and protocol as full imports.
legacy_start=app.index("el('add-words').addEventListener('click',")
legacy_end=app.index("el('save-settings').addEventListener",legacy_start)
app=app[:legacy_start]+"el('add-words').addEventListener('click',()=>{openWordImport();el('wi-file').value='';el('wi-text').value=el('new-words').value;el('wi-book').value='new';el('wi-book-name').disabled=false;el('wi-book-name').value=el('new-group').value.trim()||'我的补充词';readWordImport();});\n"+app[legacy_end:]
app_path.write_text(app, encoding='utf-8')

html_path=ROOT/'web/index.html'
html=html_path.read_text(encoding='utf-8')
html=re.sub(r'(<span id="app-version">)软件 [0-9.]+',r'\g<1>软件 1.2.0',html,count=1)
panel=(ROOT/'tools/import-panel.html').read_text(encoding='utf-8')
match=re.search(r'(<section class="panel wordbooks-panel"[\s\S]*?</dialog>)[\r\n]*',html)
if match: html=html[:match.start()]+panel+html[match.end():]
else: html=html.replace('<section id="view-library" role="tabpanel" aria-labelledby="tab-library" hidden>', '<section id="view-library" role="tabpanel" aria-labelledby="tab-library" hidden>\n'+panel,1)
html=html.replace('<option value="unplanned">','<option value="draft">待完善释义</option><option value="unplanned">') if '<option value="draft">' not in html else html
scripts='<script src="wordbooks.js"></script><script src="sync-core.js"></script><script src="word-import.js"></script><script src="vendor/xlsx.full.min.js"></script>'
if 'src="wordbooks.js"' not in html:html=html.replace('<script src="sync-core.js"></script>',scripts,1)
html_path.write_text(html,encoding='utf-8')
for name in ('wordbooks.js','word-import.js','sync-core.js'):
    source=ROOT/'shared'/name
    if source.exists():(ROOT/'web'/name).write_bytes(source.read_bytes())
style_path=ROOT/'web/style.css'
style=style_path.read_text(encoding='utf-8').split('/* User wordbooks and local import */')[0].rstrip()
style_path.write_text(style+'\n'+(ROOT/'tools/import-style.css').read_text(encoding='utf-8'),encoding='utf-8')
print('Prepared wordbook and local import UI')
