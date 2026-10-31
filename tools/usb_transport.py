"""Restricted offline USB document transport for pymobiledevice3 7.8.3.

Only the installed vocabulary app's File Sharing Exchange files are exposed.
Production uses USB only. --fixture-directory is an explicit test transport.
Stdout is one JSON result; device/protocol diagnostics go to stderr.
"""
from __future__ import annotations
import argparse,json,os,re,sys
from pathlib import Path,PurePosixPath

MAX_BYTES=55*1024*1024
ALLOWED={'Exchange/outgoing.json','Exchange/incoming.json','Exchange/ack.json','Exchange/probe.json','Exchange/probe-return.json','Exchange/device-info.json'}

class TransportError(Exception):
 def __init__(self,message,code='USB_ERROR'):super().__init__(message);self.code=code

def safe_remote(value):
 if value not in ALLOWED:raise TransportError('USB 组件只允许访问专用同步文件。','INVALID_PATH')
 return value

def validate_json(data):
 if len(data)>MAX_BYTES:raise TransportError('同步文件超过 55MB，已拒绝。','TOO_LARGE')
 try:text=data.decode('utf-8');json.loads(text)
 except (UnicodeError,json.JSONDecodeError) as e:raise TransportError('同步文件不是有效 UTF-8 JSON。','INVALID_JSON') from e
 return text

def fixture(args,data=None):
 base=Path(args.fixture_directory).resolve(strict=True)
 if not base.is_dir():raise TransportError('测试目录不存在。','FIXTURE_ERROR')
 if args.action=='list':return [{'udid':'fixture-phone','connection':'USB','name':'测试目录（不是真实手机）','fixture':True}]
 remote=safe_remote(args.remote);target=(base/remote).resolve()
 if not target.is_relative_to(base):raise TransportError('测试路径越界。','INVALID_PATH')
 if args.action=='pull':
  if not target.exists():raise TransportError('手机同步文件尚未生成，请在手机点击准备同步。','NOT_FOUND')
  if target.stat().st_size>MAX_BYTES:raise TransportError('同步文件过大。','TOO_LARGE')
  return validate_json(target.read_bytes())
 if args.action=='push':
  validate_json(data);target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.tmp');temp.write_bytes(data);os.replace(temp,target);return True

def real(args,data=None):
 # Imports are deferred so fixture tests run without the device dependency.
 from pymobiledevice3.usbmux import list_devices
 from pymobiledevice3.lockdown import create_using_usbmux
 from pymobiledevice3.services.house_arrest import HouseArrestService
 devices=[d for d in list_devices() if d.is_usb]
 if args.action=='list':return [{'udid':d.serial,'connection':'USB','name':'iPhone / iPad'} for d in devices]
 if not args.udid:raise TransportError('请选择 USB 设备。','NO_DEVICE')
 if not any(d.serial==args.udid for d in devices):raise TransportError('USB 设备已断开。','NO_DEVICE')
 remote=safe_remote(args.remote)
 lockdown=create_using_usbmux(serial=args.udid,connection_type='USB',autopair=True,pair_timeout=10)
 try:
  with HouseArrestService(lockdown,args.bundle_id,documents_only=True) as afc:
   # This pinned release's AfcShell auto-cds to /Documents for VendDocuments.
   # Some service versions expose Documents as their root; detect instead of assuming.
   base='/Documents' if afc.exists('/Documents') else ''
   target=base+'/'+remote
   if args.action=='pull':
    if not afc.exists(target):raise TransportError('手机同步文件尚未生成。请打开正确的 App，进入同步页面并点击准备同步。','NOT_FOUND')
    stat=afc.stat(target)
    if int(stat.get('st_size',0))>MAX_BYTES:raise TransportError('手机同步文件超过大小限制。','TOO_LARGE')
    return validate_json(afc.get_file_contents(target))
   if args.action=='push':
    validate_json(data);afc.makedirs(base+'/Exchange');temp=target+'.tmp';afc.set_file_contents(temp,data)
    # Final file only becomes visible when complete. A gap replacing the previous
    # exchange is harmless: the app keeps its private DB and polls again.
    if afc.exists(target):afc.rm_single(target)
    afc.rename(temp,target);return True
 finally:lockdown.close()

def run():
 parser=argparse.ArgumentParser(description='Vocabulary app USB File Sharing transport')
 parser.add_argument('action',choices=['list','pull','push']);parser.add_argument('--udid',default='');parser.add_argument('--bundle-id',default='com.jiufen.vocabulary');parser.add_argument('--remote',default='');parser.add_argument('--fixture-directory')
 args=parser.parse_args()
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{2,199}',args.bundle_id):raise TransportError('App 标识无效。','INVALID_BUNDLE')
 data=None
 if args.action=='push':data=sys.stdin.buffer.read(MAX_BYTES+1);validate_json(data)
 return fixture(args,data) if args.fixture_directory else real(args,data)

def main():
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
 try:result={'ok':True,'value':run()};code=0
 except Exception as e:
  name=type(e).__name__;message=str(e)
  if isinstance(e,TransportError):code_name=e.code
  elif name=='AppNotInstalledError':message='手机中找不到指定 App。请确认已安装，并填写签名后的实际 App 标识。';code_name='APP_NOT_INSTALLED'
  elif name in ['ConnectionRefusedError','ConnectionError','MuxException','BadDevError','NoDeviceConnectedError'] or isinstance(e,ConnectionError):message='无法连接 Apple USB 设备服务。请确认数据线、设备驱动、手机解锁和信任电脑。';code_name='USB_UNAVAILABLE'
  elif 'Pairing' in name or 'PasswordProtected' in name:message='请解锁 iPhone 并确认“信任此电脑”，然后重试。';code_name='PAIRING_REQUIRED'
  else:code_name='USB_ERROR';message='USB 组件错误（'+name+'）：'+message[:500]
  result={'ok':False,'error':message,'code':code_name};code=1
 print(json.dumps(result,ensure_ascii=False));return code

if __name__=='__main__':raise SystemExit(main())
