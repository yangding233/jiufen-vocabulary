"""Apply the offline dictionary UI without embedding its large data at startup."""
from pathlib import Path
import json,re
R=Path(__file__).resolve().parents[1]
p=R/'web/app.js';app=p.read_text(encoding='utf-8');marker='// Included inside the existing app closure, before boot().'
start=app.find('// Offline dictionary enrichment:')
end=app.index(marker)
if start>=0:app=app[:start]+app[end:]
end=app.index(marker)
app=app[:end]+(R/'tools/dictionary-integration.js').read_text(encoding='utf-8')+'\n'+app[end:]
old="el('detail-source').textContent=w.sourceRow?`原表第 ${w.sourceRow} 行 · ${w.part} · 考察 ${w.frequency} 篇`:'';"
new="el('detail-source').textContent=[w.sourceRow?`原表第 ${w.sourceRow} 行 · ${w.part} · 考察 ${w.frequency} 篇`:'',w.source||''].filter(Boolean).join('\\n');"
app=app.replace(old,new)
p.write_text(app,encoding='utf-8')
p=R/'web/index.html';html=p.read_text(encoding='utf-8')
panel=(R/'tools/dictionary-panel.html').read_text(encoding='utf-8')
html=re.sub(r'<dialog id="dict-dialog"[\s\S]*?</dialog>[\r\n]*','',html)
html=html.replace('<dialog id="word-import-dialog"',panel.rstrip()+'\n<dialog id="word-import-dialog"',1)
if 'id="open-dictionary"' not in html:html=html.replace('<button id="open-word-import"', '<button id="open-dictionary">补齐释义与音标</button><button id="open-word-import"',1)
if 'src="dictionary.js"' not in html:html=html.replace('<script src="wordbooks.js"></script>','<script src="wordbooks.js"></script><script src="dictionary.js"></script>',1)
version=json.loads((R/'package.json').read_text(encoding='utf-8'))['version']
html=re.sub(r'(<span id="app-version">)软件 [0-9.]+',lambda m:m[1]+'软件 '+version,html,count=1)
p.write_text(html,encoding='utf-8')
source=R/'shared/dictionary.js'
if source.exists():(R/'web/dictionary.js').write_bytes(source.read_bytes())
p=R/'web/style.css';style=p.read_text(encoding='utf-8').split('/* Offline dictionary enrichment */')[0].rstrip()
p.write_text(style+'\n'+(R/'tools/dictionary-style.css').read_text(encoding='utf-8'),encoding='utf-8')
print('Prepared offline dictionary enrichment UI')
