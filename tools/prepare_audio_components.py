"""Assemble an optional relocatable Windows audio runtime from installed local files.

Never downloads packages and never opens a learning profile. Run with the known
audio virtual environment so its already installed dependencies can be copied.
"""
import argparse, hashlib, json, shutil, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def ignored(directory,names):
    return [name for name in names if name in {'__pycache__','.git','.pytest_cache','tests','test','pip','ensurepip','idlelib','tkinter','turtledemo','direct_url.json'} or name.endswith(('.pyc','.pyo')) or name.startswith('pip-') and name.endswith('.dist-info')]
def total(path):return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'dist/audio-components/九分离线语音组件-2.1.0');args=parser.parse_args()
    target=args.output.resolve();target.relative_to(ROOT.resolve())
    if target.exists():raise FileExistsError('Preserve previous component folder: '+str(target))
    runtime=Path(sys.base_prefix);packages=Path(sys.prefix)/'Lib/site-packages';models=ROOT/'build/vendor/kokoro';encoder=ROOT.parent/'work/video-bin/ffmpeg.exe'
    if sys.version_info[:2]!=(3,12) or not (packages/'kokoro_onnx').is_dir():raise ValueError('Run with .venv-audio Python 3.12')
    estimated=total(packages)+total(runtime/'Lib')+total(runtime/'DLLs')+total(models)+encoder.stat().st_size
    if shutil.disk_usage(target.parent if target.parent.exists() else ROOT).free<estimated*1.2:raise OSError('Insufficient disk space for optional audio runtime')
    target.mkdir(parents=True);destination=target/'runtime';destination.mkdir()
    for file in runtime.iterdir():
        if file.is_file() and (file.suffix.lower() in {'.exe','.dll'} or file.name=='LICENSE.txt'):shutil.copy2(file,destination/file.name)
    for name in ('Lib','DLLs'):
        shutil.copytree(runtime/name,destination/name,ignore=lambda directory,names:ignored(directory,names)+(['site-packages'] if Path(directory)==runtime/'Lib' and 'site-packages' in names else []))
    shutil.copytree(packages,destination/'Lib/site-packages',dirs_exist_ok=True,ignore=ignored)
    (destination/'python312._pth').write_text('Lib\nDLLs\nLib/site-packages\nimport site\n',encoding='utf-8')
    (target/'models').mkdir()
    for name in ('kokoro-v1.0.onnx','voices-v1.0.bin'):shutil.copy2(models/name,target/'models'/name)
    shutil.copy2(encoder,target/'ffmpeg.exe');shutil.copy2(ROOT/'THIRD_PARTY_NOTICES.txt',target/'THIRD_PARTY_NOTICES.txt')
    licenses=target/'licenses';licenses.mkdir();shutil.copy2(ROOT/'LICENSE',licenses/'GPL-3.0.txt');shutil.copy2(packages/'misaki-0.9.4.dist-info/licenses/LICENSE',licenses/'Apache-2.0.txt')
    build_license=subprocess.run([str(encoder),'-L'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0);(licenses/'FFmpeg-build-license.txt').write_bytes(build_license.stdout+build_license.stderr)
    (target/'使用说明.txt').write_text('这是可选的本机离线语音生成组件。\n保留整个文件夹，在九分词汇的“词库与笔记 → 离线音频 → 选择语音组件”中选择本文件夹。\n选择词条后生成读音，完成后不联网也能播放。组件可放在程序目录外，换位置后重新选择。\n本组件包含Python运行时、第三方依赖、Kokoro模型与FFmpeg；依赖自身的许可文件保存在runtime/Lib/site-packages的对应目录中。\n',encoding='utf-8')
    manifest={'format':'jiufen-audio-components','schema':1,'version':'2.1.0','python':'3.12','voices':{'en-GB':'bf_emma','en-US':'af_heart'},'files':{}}
    for file in [destination/'python.exe',destination/'python312.dll',target/'ffmpeg.exe',*(target/'models').iterdir()]:
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        manifest['files'][file.relative_to(target).as_posix()]={'bytes':file.stat().st_size,'sha256':digest}
    (target/'components.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'directory':str(target),'bytes':total(target),'estimatedBeforeFiltering':estimated},ensure_ascii=False))
if __name__=='__main__':main()
