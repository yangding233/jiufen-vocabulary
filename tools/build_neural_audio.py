"""Generate resumable Kokoro candidates in build/, then explicitly install a complete set.

Model and Python dependencies are development-only. Runtime uses AAC files.
No learning database is opened by this tool.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import html
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / 'build/neural-audio'
MODEL = ROOT / 'build/vendor/kokoro'
VOICES = {'en-GB': 'bf_emma', 'en-US': 'af_heart'}
ENCODING = {'codec': 'AAC-LC', 'container': 'M4A', 'channels': 1, 'sampleRate': 48000, 'bitrate': 48000}
RECIPE = 'kokoro-v1.0-misaki-reviewed-v1-safe-pad-atempo075'
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

def sha(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(path)

def words():
    text = (ROOT / 'web/index.html').read_text(encoding='utf-8')
    return json.loads(re.search(r'<script id="vocabulary-data" type="application/json">([\s\S]*?)</script>', text)[1])

def ipa_to_model(value, british):
    # Kokoro uses Misaki's documented compact alphabet, not raw dictionary IPA.
    value = value.strip('/[] ').replace('.', '').replace('(', '').replace(')', '')
    for old, new in [('dʒ','ʤ'),('tʃ','ʧ'),('eɪ','A'),('aɪ','I'),('aʊ','W'),('ɔɪ','Y'),('əʊ','Q'),('oʊ','O'),('ɝː','ɜɹ'),('ɝ','ɜɹ'),('ɚ','əɹ'),('r','ɹ'),('g','ɡ')]: value = value.replace(old,new)
    value = value.replace('e', 'ɛ')
    if british:
        value = value.replace('æ','a').replace('O','Q')
    else:
        value = value.replace('ɜː','ɜɹ').replace('ː','').replace('Q','O')
    # Dictionary IPA marks a stressed syllable before its consonant onset;
    # Misaki training strings place that marker next to the stressed vowel.
    # Leaving it before the onset caused measurable phantom vowel/word sounds.
    return re.sub(r'([ˈˌ])([bdfhjklmnpstvwzðŋɡɹʃʒʤʧθ]+)', r'\2\1', value)

def run(command):
    result = subprocess.run(command, capture_output=True, creationflags=FLAGS, timeout=60)
    if result.returncode: raise RuntimeError(result.stderr.decode('utf-8',errors='replace')[-1800:])

def make_preview(selected, manifest):
    body = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新版英美语音试听</title><style>body{font:17px system-ui;max-width:960px;margin:30px auto;padding:0 18px;background:#202a23;color:#eef4e5}section{border-top:1px solid #63735e;padding:20px 0}audio{max-width:100%}.row{display:flex;gap:24px;flex-wrap:wrap}h2{margin:0 0 10px}p{line-height:1.6}</style><h1>新版离线语音试听</h1><p>美式 af_heart，英式 bf_emma；每条都可以比较旧音频、神经语音正常版和不变调慢速版。当前为合成音，听感由你判断；自动检查不代表读音经过真人逐条验收。</p>']
    for word in selected:
        body.append('<section><h2>'+html.escape(word['word'])+'</h2><p>'+html.escape(word.get('meaning',''))+'</p><div class="row">')
        for locale, label in [('en-GB','英式'),('en-US','美式')]:
            card = manifest['entries'].get(word['id'],{}).get(locale)
            if not card: continue
            body.append('<div><strong>'+label+'</strong>')
            for text, source in [('旧版对照',f'old/{locale}/{word["id"]}.m4a'),('神经语音',card['file']),('慢速',card['slow']['file'])]:
                if text == '旧版对照' and not (STAGE/source).exists(): continue
                body.append('<p>'+text+'<br><audio controls preload="none" src="'+html.escape(source,quote=True)+'"></audio></p>')
            if card.get('note'): body.append('<p>'+html.escape(card['note'])+'</p>')
            body.append('</div>')
        body.append('</div></section>')
    (STAGE/'试听.html').write_text(''.join(body),encoding='utf-8')

def install(all_words):
    from build_audio import check_manifest
    manifest = json.loads((STAGE/'audio-manifest.json').read_text(encoding='utf-8'))
    assert set(manifest['entries']) == {w['id'] for w in all_words}, 'Generate all words before installing'
    expected={f'audio/{locale}/{w["id"]}{suffix}.m4a' for w in all_words for locale in VOICES for suffix in ('','-slow')}
    actual={p.relative_to(STAGE).as_posix() for p in (STAGE/'audio').rglob('*') if p.is_file()}
    assert actual==expected and not any(p.is_symlink() for p in (STAGE/'audio').rglob('*'))
    for variants in manifest['entries'].values():
        for card in variants.values():
            for record in (card,card['slow']):
                assert record['file'] in expected and .1<record['seconds']<20
                assert sha(STAGE/record['file']) == record['sha256']
    current = ROOT/'web/audio'
    previous = ROOT/'build/audio-before-kokoro'
    assert not previous.exists(), 'Keep prior engine snapshot; install only once per candidate set'
    # Copy candidate fully first. All renames stay on this workspace's volume.
    candidate=ROOT/'build/audio-install-candidate'
    for location in (current,previous,candidate,ROOT/'build/audio-failed-candidate'):
        assert location.resolve().is_relative_to(ROOT.resolve()) and not location.is_symlink(), location
    assert not candidate.exists()
    shutil.copytree(STAGE/'audio',candidate)
    previous.mkdir(parents=True)
    shutil.copy2(ROOT/'web/audio-manifest.json',previous/'audio-manifest.json')
    current.rename(previous/'audio')
    try:
        candidate.rename(current)
        check_manifest(manifest,all_words)
        write_json(ROOT/'web/audio-manifest.json',manifest)
    except BaseException:
        if current.exists():current.rename(ROOT/'build/audio-failed-candidate')
        (previous/'audio').rename(current)
        shutil.copy2(previous/'audio-manifest.json',ROOT/'web/audio-manifest.json')
        raise
    print(json.dumps({'installed':True,'files':len(all_words)*4,'previousAudio':str(previous)},ensure_ascii=False),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all',action='store_true',help='Generate the complete word list, otherwise 20 reviewed sample words')
    parser.add_argument('--install',action='store_true',help='Install an already complete verified staging set')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--encoder',type=Path,default=ROOT.parent/'work/video-bin/ffmpeg.exe')
    args=parser.parse_args();all_words=words()
    if args.install: install(all_words);return
    os.environ['HF_HUB_OFFLINE']='1'
    os.environ['TRANSFORMERS_OFFLINE']='1'
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from misaki import en
    from misaki.espeak import EspeakFallback
    import spacy
    from download_audio_model import FILES
    dependencies={name:importlib.metadata.version(name) for name in ('kokoro-onnx','misaki','onnxruntime','numpy','soundfile')}
    assert len(all_words)==1493 and len({w['id'] for w in all_words})==1493
    for name,(expected,_) in FILES.items(): assert sha(MODEL/name)==expected,name
    reviewed=json.loads((ROOT/'tools/audio-pronunciation-overrides.json').read_text(encoding='utf-8'))
    overrides={w['id']:w for w in reviewed['entries']}
    sample_ids={w['id'] if isinstance(w,dict) else w for w in reviewed['samples']}
    selected=all_words if args.all else [w for w in all_words if w['id'] in sample_ids]
    assert len(selected)==(1493 if args.all else 20)
    STAGE.mkdir(parents=True,exist_ok=True)
    # Never let the G2P constructor silently fetch a model during synthesis.
    if not spacy.util.is_package('en_core_web_sm'):
        raise RuntimeError('Install the pinned en_core_web_sm wheel in the development environment first')
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    options.log_severity_level=3
    session=ort.InferenceSession(str(MODEL/'kokoro-v1.0.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    engine=Kokoro.from_session(session,str(MODEL/'voices-v1.0.bin'))
    # Engine initialization configures the bundled eSpeak DLL/data. This explicit
    # local fallback includes Misaki's compact-phoneme conversion and disables
    # its optional network-based fallback model.
    g2ps={locale:en.G2P(trf=False,british=locale=='en-GB',fallback=EspeakFallback(british=locale=='en-GB')) for locale in VOICES}
    plan=[]
    for word in selected:
        for locale,voice in VOICES.items():
            reviewed_word=overrides.get(word['id']);variants=[]
            if reviewed_word:
                assert reviewed_word['word']==word['word']
                variants=[ipa_to_model(v['enGB' if locale=='en-GB' else 'enUS'],locale=='en-GB') for v in reviewed_word['variants']]
            else:
                phonemes,tokens=g2ps[locale](word['word'])
                assert '❓' not in phonemes and all(getattr(token,'phonemes',None) is not None for token in tokens),('Unresolved pronunciation',word['word'],locale)
                variants=[phonemes]
            for value in variants:
                assert value and len(engine.tokenizer.tokenize(value))>0,(word['word'],value)
                missing=set(value)-set(engine.tokenizer.vocab)
                assert not missing,(word['word'],missing,value)
            note='、'.join(v['label'] for v in reviewed_word['variants'])+'读法依次播放' if reviewed_word and len(variants)>1 else ''
            if reviewed_word and word['word'].lower()=='survey':
                note='按名词读法 /'+reviewed_word['variants'][0]['enGB' if locale=='en-GB' else 'enUS']+'/ 朗读'
            plan.append({'id':word['id'],'word':word['word'],'locale':locale,'voice':voice,'phonemes':variants,'note':note})
    write_json(STAGE/'sample-plan.json' if not args.all else STAGE/'full-plan.json',plan)
    manifest={'schema':1,'engine':'Kokoro-82M v1.0','displayName':'Kokoro 神经合成音','description':'预生成英美神经合成参考音，正常和不变调慢速均可离线播放。','encoding':ENCODING,'voices':list(VOICES),'voiceModels':VOICES,'recipe':RECIPE,'generatorDependencies':dependencies,'entries':{}}
    started=time.monotonic()
    def generate(item):
        identifier,locale=item['id'],item['locale'];stem=STAGE/('extras' if item.get('extra') else 'audio')/locale/identifier
        record_file=STAGE/('extra-records' if item.get('extra') else 'records')/locale/(identifier+'.json')
        fingerprint=hashlib.sha256(json.dumps({**item,'recipe':RECIPE,'dependencies':dependencies,'models':FILES},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        if record_file.exists():
            cached=json.loads(record_file.read_text(encoding='utf-8'))
            if cached.get('fingerprint')==fingerprint and all((STAGE/r['file']).is_file() and sha(STAGE/r['file'])==r['sha256'] for r in (cached['card'],cached['card']['slow'])):return identifier,locale,cached['card']
        pieces=[]
        for phonemes in item['phonemes']:
            samples,rate=engine.create(phonemes,voice=item['voice'],speed=1,lang=locale.lower(),is_phonemes=True,trim=False)
            assert rate==24000 and np.isfinite(samples).all()
            active=np.flatnonzero(np.abs(samples)>.0015)
            assert len(active)>0,(item['word'],'silent output')
            lo=max(0,int(active[0]) - int(.07*rate));hi=min(len(samples),int(active[-1])+int(.12*rate)+1)
            piece=samples[lo:hi]
            assert .15<len(piece)/rate<12,(item['word'],len(piece)/rate)
            pieces.extend([piece,np.zeros(int(.28*rate),dtype=np.float32)])
        combined=np.concatenate([np.zeros(2160,dtype=np.float32),*pieces])
        peak=float(np.max(np.abs(combined)));rms=float(np.sqrt(np.mean(combined**2)))
        gain=min(2.5,.12/max(rms,.00001),.92/max(peak,.00001));combined*=gain
        pcm=STAGE/'pcm'/locale/(identifier+'.wav');pcm.parent.mkdir(parents=True,exist_ok=True)
        sf.write(pcm,combined,24000,subtype='PCM_16');stem.parent.mkdir(parents=True,exist_ok=True)
        card={}
        for slow in (False,True):
            target=stem.with_name(stem.name+('-slow' if slow else '')).with_suffix('.m4a')
            command=[str(args.encoder),'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(pcm),'-map_metadata','-1']
            if slow:command+=['-af','atempo=0.75']
            command+=['-ac','1','-ar','48000','-c:a','aac','-profile:a','aac_low','-b:a','48k','-threads','1','-movflags','+faststart',str(target)]
            run(command)
            record={'file':target.relative_to(STAGE).as_posix(),'seconds':round(len(combined)/24000/(.75 if slow else 1),3),'sha256':sha(target)}
            assert .1<record['seconds']<20
            if slow:card['slow']=record
            else:card.update(record)
        if item['note']:card['note']=item['note']
        write_json(record_file,{'fingerprint':fingerprint,'card':card,'peak':round(peak*gain,5),'rms':round(rms*gain,5),'phonemes':item['phonemes']})
        return identifier,locale,card
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        futures=[pool.submit(generate,item) for item in plan]
        for count,future in enumerate(as_completed(futures),1):
            identifier,locale,card=future.result();manifest['entries'].setdefault(identifier,{})[locale]=card
            if count%20==0 or count==len(plan):print(json.dumps({'generatedVariants':count,'total':len(plan),'secondsElapsed':round(time.monotonic()-started,1)}),flush=True)
    manifest['entries']={identifier:{locale:variants[locale] for locale in VOICES} for identifier,variants in sorted(manifest['entries'].items())}
    write_json(STAGE/'audio-manifest.json',manifest)
    # Preserve a compact old-vs-new sample page, independent of later runtime updates.
    sample_words=[w for w in all_words if w['id'] in sample_ids]
    for w in sample_words:
        for locale in VOICES:
            old=ROOT/'web/audio'/locale/(w['id']+'.m4a');target=STAGE/'old'/locale/(w['id']+'.m4a')
            if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,target)
    preview_manifest=json.loads(json.dumps(manifest))
    for extra in reviewed.get('extraSamples',[]):
        identifier='extra-'+extra['word'];extra_word={'id':identifier,'word':extra['word'],'meaning':extra.get('note','词库外试听，不计入1493词覆盖')}
        for locale,voice in VOICES.items():
            phonemes,tokens=g2ps[locale](extra['word'])
            assert phonemes and '❓' not in phonemes
            _,_,card=generate({'id':identifier,'word':extra['word'],'locale':locale,'voice':voice,'phonemes':[phonemes],'note':'词库外试听，不计入1493词覆盖','extra':True})
            preview_manifest['entries'].setdefault(identifier,{})[locale]=card
        sample_words.append(extra_word)
    make_preview(sample_words,preview_manifest)
    print(json.dumps({'staged':True,'words':len(selected),'audioFiles':len(selected)*4,'bytes':sum((STAGE/r['file']).stat().st_size for variants in manifest['entries'].values() for card in variants.values() for r in (card,card['slow'])),'preview':str(STAGE/'试听.html')},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
