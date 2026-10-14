from pathlib import Path
import shutil,re
root=Path(__file__).resolve().parents[2]
out=root/'android/app/src/main/assets/site'
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True)
for name in ['css','js','images']:shutil.copytree(root/name,out/name)
for f in root.glob('*.html'):
 if f.name not in ['android-app.html','filter.html','yidplus-dashboard.html']:shutil.copy2(f,out/f.name)
# Do not register a browser service worker inside the native shell.
for f in out.rglob('*.js'):
 text=f.read_text()
 if 'serviceWorker.register' in text: text=text.replace("if (!('serviceWorker' in navigator)) return;", "return; // Native shell: bundled public assets, no service worker.")
 f.write_text(text)
# Replace stale personal media subdomain with current verified public worker URL.
f=out/'js/chat.js'
s=f.read_text();s=re.sub(r"var TG_STREAM_BASE = '[^']*';", "var TG_STREAM_BASE = 'https://yidplus-telegram-worker.abdeveloping.workers.dev';", s)
f.write_text(s)
