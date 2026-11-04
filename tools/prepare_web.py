"""Copy runtime modules and refresh version/help. web/ is the only UI source."""
from pathlib import Path
import json
import re
ROOT = Path(__file__).resolve().parents[1]
for source in sorted((ROOT / 'shared').glob('*.js')):
    (ROOT / 'web' / source.name).write_bytes(source.read_bytes())
page = ROOT / 'web' / 'index.html'
html = page.read_text(encoding='utf-8')
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
html = re.sub(r'(<span id="app-version">)软件 [0-9.]+', lambda m: m[1] + '软件 ' + version, html, count=1)
help_body = (ROOT / 'tools' / 'help-content.html').read_text(encoding='utf-8')
html = re.sub(r'(<dialog id="help-dialog"[\s\S]*?<button id="close-help">关闭</button></div>)[\s\S]*?</dialog>', lambda m: m[1] + help_body + '</dialog>', html, count=1)
page.write_text(html, encoding='utf-8')
print('Prepared Windows runtime modules and help; web/ remains canonical.')
