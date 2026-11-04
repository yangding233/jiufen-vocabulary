"""Verify all built-in sentence recordings, then install an immutable resource set."""
import argparse,hashlib,json,shutil,uuid
from pathlib import Path
from generate_text_audio import key,RECIPE,VOICES
ROOT=Path(__file__).resolve().parents[1]
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def verify(root):
    pack=json.loads((root/'web/content-pack.json').read_text(encoding='utf-8'));manifest=json.loads((root/'web/sentence-audio-manifest.json').read_text(encoding='utf-8'))
    expected={key(entry['usage']['sentence'],locale):(entry['usage']['sentence'],locale) for entry in pack['entries'] for locale in VOICES}
    assert len(expected)==2986 and set(manifest['entries'])==set(expected)
    files=set()
    for identifier,(text,locale) in expected.items():
        record=manifest['entries'][identifier];assert record['key']==identifier and record['text']==text and record['locale']==locale and record['voice']==VOICES[locale]
        expected_file=f'sentence-audio/{locale}/{identifier}.m4a';assert record['file']==expected_file and .1<record['seconds']<180
        file=root/'web'/expected_file;data=file.read_bytes();assert len(data)==record['bytes'] and data[4:8]==b'ftyp' and hashlib.sha256(data).hexdigest()==record['sha256'];files.add(expected_file)
    assert {p.relative_to(root/'web').as_posix() for p in (root/'web/sentence-audio').rglob('*') if p.is_file()}==files
    return {'sentences':len(pack['entries']),'files':len(files),'bytes':sum(r['bytes'] for r in manifest['entries'].values())}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage',type=Path,default=ROOT/'build/sentence-audio-full');parser.add_argument('--check',action='store_true');args=parser.parse_args()
    if args.check:print(json.dumps(verify(ROOT)));return
    stage=args.stage.resolve();stage.relative_to(ROOT);pack=json.loads((ROOT/'web/content-pack.json').read_text(encoding='utf-8'));entries={};words={}
    for entry in pack['entries']:
        words[entry['id']]={}
        for locale in VOICES:
            text=entry['usage']['sentence'];identifier=key(text,locale);record=json.loads((stage/(identifier+'.json')).read_text(encoding='utf-8'));file=stage/(identifier+'.m4a')
            assert record['key']==identifier and record['text']==text and record['locale']==locale and record['voice']==VOICES[locale] and digest(file)==record['sha256'] and file.stat().st_size==record['bytes']
            entries[identifier]={**record,'file':f'sentence-audio/{locale}/{identifier}.m4a'};words[entry['id']][locale]=identifier
    assert len(entries)==2986
    destination=ROOT/'web/sentence-audio';manifest={'schema':1,'engine':'Kokoro-82M v1.0','recipe':RECIPE,'voiceModels':VOICES,'entries':entries,'words':words}
    if destination.exists():
        for identifier,record in entries.items():assert digest(ROOT/'web'/record['file'])==record['sha256'],'Preserve existing sentence resource set'
    else:
        candidate=ROOT/'build'/('sentence-install-'+str(uuid.uuid4()));candidate.mkdir()
        for identifier,record in entries.items():
            target=candidate/record['locale']/(identifier+'.m4a');target.parent.mkdir(exist_ok=True);shutil.copy2(stage/(identifier+'.m4a'),target)
        candidate.rename(destination)
    output=ROOT/'web/sentence-audio-manifest.json';temporary=output.with_suffix('.json.tmp');temporary.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8');temporary.replace(output)
    print(json.dumps(verify(ROOT)))
if __name__=='__main__':main()
