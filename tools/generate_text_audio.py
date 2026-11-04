"""Offline optional text-to-audio worker. stdin/request contains data, never commands."""
import argparse, atexit, hashlib, json, os, shutil, subprocess, tempfile, time, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

RECIPE='kokoro-emma-heart-text-v1'
VOICES={'en-GB':'bf_emma','en-US':'af_heart'}
MODEL_HASH={'kokoro-v1.0.onnx':'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a','voices-v1.0.bin':'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'}
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def key(text,locale):return hashlib.sha256(json.dumps([RECIPE,locale,text],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def write(path,data):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8');temporary.replace(path)
def emit(data):print(json.dumps(data,ensure_ascii=False),flush=True)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--request',type=Path,required=True);args=parser.parse_args()
    request=json.loads(args.request.read_text(encoding='utf-8'));output=Path(request['output']).resolve();models=Path(request['models']).resolve();encoder=Path(request['encoder']).resolve()
    if not encoder.is_file():raise ValueError('缺少本地音频编码组件。')
    for name,expected in MODEL_HASH.items():
        if digest(models/name)!=expected:raise ValueError('本地音频模型校验失败：'+name)
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import EspeakConfig
    from misaki import en
    from misaki.espeak import EspeakFallback
    import espeakng_loader
    import spacy
    if not spacy.util.is_package('en_core_web_sm'):raise ValueError('语音组件缺少本地英文模型。')
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.log_severity_level=3
    data_path=espeakng_loader.get_data_path()
    # eSpeak's C data loader on Windows does not handle every Unicode path.
    # Keep the portable component movable while giving that one loader a local
    # ASCII temporary data directory. No executable is copied or downloaded.
    if os.name=='nt' and not data_path.isascii():
        candidates=[Path(tempfile.gettempdir()),Path(os.environ.get('PUBLIC','C:/Users/Public'))]
        for base in candidates:
            if not str(base).isascii() or not base.is_dir():continue
            try:
                temporary=Path(tempfile.mkdtemp(prefix='jiufen-espeak-',dir=base));shutil.copytree(data_path,temporary/'espeak-ng-data');data_path=str(temporary/'espeak-ng-data');atexit.register(shutil.rmtree,temporary,True);break
            except OSError:continue
        else:raise ValueError('本机无法创建语音数据临时目录，请将组件放在英文路径后重试。')
    engine=Kokoro.from_session(ort.InferenceSession(str(models/'kokoro-v1.0.onnx'),sess_options=options,providers=['CPUExecutionProvider']),str(models/'voices-v1.0.bin'),espeak_config=EspeakConfig(data_path=data_path,lib_path=espeakng_loader.get_library_path()))
    g2ps={locale:en.G2P(trf=False,british=locale=='en-GB',fallback=EspeakFallback(british=locale=='en-GB')) for locale in VOICES}
    if not 1<=len(request['items'])<=4000:raise ValueError('本批音频数量超限。')
    output.mkdir(parents=True,exist_ok=True);plan=[];errors=0;done=0
    for item in request['items']:
        text=unicodedata.normalize('NFC',item['text']).strip();locale=item['locale'];identifier=key(text,locale)
        if not 1<=len(text)<=2000 or locale not in VOICES or item.get('key',identifier)!=identifier:raise ValueError('生成任务内容无效。')
        recordfile=output/(identifier+'.json');target=output/(identifier+'.m4a')
        if recordfile.is_file() and target.is_file():
            record=json.loads(recordfile.read_text(encoding='utf-8'))
            if record.get('key')==identifier and record.get('sha256')==digest(target):done+=1;emit({'type':'record','record':record,'done':done,'total':len(request['items']),'cached':True});continue
        try:
            phonemes,tokens=g2ps[locale](text)
            if not phonemes or '❓' in phonemes or set(phonemes)-set(engine.tokenizer.vocab):raise ValueError('部分文字无法确定读音，请检查拼写或简化句子。')
            plan.append((identifier,text,locale,phonemes))
        except Exception as error:errors+=1;done+=1;emit({'type':'item-error','text':text,'locale':locale,'error':str(error),'done':done,'total':len(request['items'])})
    def generate(item):
        identifier,text,locale,phonemes=item
        samples,rate=engine.create(phonemes,voice=VOICES[locale],speed=1,lang=locale.lower(),is_phonemes=True,trim=False)
        if rate!=24000 or not np.isfinite(samples).all():raise ValueError('音频采样结果无效。')
        active=np.flatnonzero(np.abs(samples)>.0015)
        if not len(active):raise ValueError('生成结果为空。')
        samples=samples[max(0,int(active[0])-1680):min(len(samples),int(active[-1])+2881)]
        samples=np.concatenate([np.zeros(2160,dtype=np.float32),samples,np.zeros(4800,dtype=np.float32)])
        seconds=len(samples)/24000
        if not .1<seconds<180:raise ValueError('音频时长超限，请缩短句子。')
        rms=float(np.sqrt(np.mean(samples**2)));peak=float(np.max(np.abs(samples)));samples*=min(2.5,.12/max(rms,.00001),.92/max(peak,.00001))
        pcm=output/(identifier+'.wav');target=output/(identifier+'.m4a');temporary=output/(identifier+'.partial.m4a')
        try:
            sf.write(pcm,samples,24000,subtype='PCM_16')
            result=subprocess.run([str(encoder),'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(pcm),'-map_metadata','-1','-ac','1','-ar','48000','-c:a','aac','-profile:a','aac_low','-b:a','48k','-threads','1','-movflags','+faststart',str(temporary)],capture_output=True,timeout=120,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if result.returncode:raise ValueError('音频编码失败。')
            temporary.replace(target)
            record={'key':identifier,'text':text,'locale':locale,'voice':VOICES[locale],'seconds':round(seconds,3),'bytes':target.stat().st_size,'sha256':digest(target)}
            write(output/(identifier+'.json'),record);return record
        finally:
            if pcm.exists():pcm.unlink()
            if temporary.exists():temporary.unlink()
    with ThreadPoolExecutor(max_workers=max(1,min(int(request.get('workers',3)),6))) as pool:
        futures={pool.submit(generate,item):item for item in plan}
        for future in as_completed(futures):
            done+=1
            try:emit({'type':'record','record':future.result(),'done':done,'total':len(request['items'])})
            except Exception as error:
                errors+=1;item=futures[future];emit({'type':'item-error','text':item[1],'locale':item[2],'error':str(error),'done':done,'total':len(request['items'])})
    emit({'type':'complete','done':done,'total':len(request['items']),'errors':errors})
if __name__=='__main__':
    try:main()
    except Exception as error:emit({'type':'fatal','error':str(error)});raise SystemExit(1)
