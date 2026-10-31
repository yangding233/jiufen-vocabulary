"""Restricted offline USB document transport for pymobiledevice3 7.8.3.

Only the installed vocabulary app's File Sharing Exchange files are exposed.
Production uses USB only. --fixture-directory is an explicit test transport.
Stdout is one JSON result; optional sanitized diagnostics go to stderr.
"""
from __future__ import annotations
import argparse,json,os,re,sys,traceback
from contextlib import contextmanager
from pathlib import Path

MAX_BYTES=55*1024*1024
ALLOWED={'Exchange/outgoing.json','Exchange/incoming.json','Exchange/ack.json','Exchange/probe.json','Exchange/probe-return.json','Exchange/device-info.json'}
APP_ATTRIBUTES=['CFBundleIdentifier','CFBundleName','CFBundleDisplayName','UIFileSharingEnabled']
APP_NAMES={'九分词汇','九分词汇离线学习','jiufenvocabulary'}
APP_PREFIX='com.jiufen.vocabulary'
STAGES={
 'checking-runtime':'检查 USB 加密运行组件',
 'validating-request':'核对同步请求','validating-input':'校验传入同步包','opening-fixture':'打开测试目录',
 'loading-usb-components':'加载 USB 组件','enumerating-usb':'枚举 USB 设备','selecting-device':'选择 USB 手机',
 'pairing-device':'建立手机信任连接','listing-installed-apps':'检查已安装的词汇 App','matching-app':'匹配词汇 App',
 'opening-app-files':'打开手机 App 文件共享','locating-exchange':'定位手机同步目录',
 'reading-exchange':'读取手机同步文件','writing-exchange':'写入手机同步文件','closing-device':'关闭手机连接',
}

class TransportError(Exception):
 def __init__(self,message,code='USB_ERROR'):super().__init__(message);self.code=code

@contextmanager
def connection_stage(name):
 try:yield
 except Exception as error:
  if not getattr(error,'usb_stage',None):error.usb_stage=name
  raise

def resolve_vocabulary_app(apps,requested):
 """Return only our app's minimal metadata, never the installed-app inventory."""
 matches={}
 for app in apps:
  bundle=app.get('CFBundleIdentifier')
  if not isinstance(bundle,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{2,199}',bundle):continue
  names=[app.get('CFBundleDisplayName'),app.get('CFBundleName')]
  belongs=bundle.casefold()==APP_PREFIX or bundle.casefold().startswith(APP_PREFIX+'.')
  belongs=belongs or any(isinstance(name,str) and name.strip().casefold() in APP_NAMES for name in names)
  if not belongs:continue
  matches[bundle]={'bundleId':bundle,'name':next((name for name in names if isinstance(name,str) and name.strip()),'九分词汇'),'fileSharingEnabled':app.get('UIFileSharingEnabled') is True}
 if requested in matches:return {**matches[requested],'matchedBy':'requested'}
 if len(matches)==1:return {**next(iter(matches.values())),'matchedBy':'single'}
 if not matches:raise TransportError('手机中没有找到“九分词汇”。请先签名安装 App。','APP_NOT_INSTALLED')
 raise TransportError('检测到多个“九分词汇”App，请在电脑面板填写要同步的实际 App 标识：'+', '.join(sorted(matches)[:5]),'AMBIGUOUS_APP')

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
 if args.action=='resolve-app':return {'bundleId':args.bundle_id,'name':'测试目录（不是真实手机）','fileSharingEnabled':True,'matchedBy':'fixture'}
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
 with connection_stage('loading-usb-components'):
  from pymobiledevice3.usbmux import list_devices
  from pymobiledevice3.lockdown import create_using_usbmux
 with connection_stage('enumerating-usb'):devices=[d for d in list_devices() if d.is_usb]
 if args.action=='list':return [{'udid':d.serial,'connection':'USB','name':'iPhone / iPad'} for d in devices]
 with connection_stage('selecting-device'):
  if not args.udid:raise TransportError('请选择 USB 设备。','NO_DEVICE')
  if not any(d.serial==args.udid for d in devices):raise TransportError('USB 设备已断开。','NO_DEVICE')
 if args.action!='resolve-app':
  with connection_stage('validating-request'):remote=safe_remote(args.remote)
 with connection_stage('pairing-device'):lockdown=create_using_usbmux(serial=args.udid,connection_type='USB',autopair=True,pair_timeout=10)
 try:
  if args.action=='resolve-app':
   with connection_stage('listing-installed-apps'):
    from pymobiledevice3.services.installation_proxy import InstallationProxyService
    with InstallationProxyService(lockdown) as proxy:apps=proxy.browse(options={'ApplicationType':'User'},attributes=APP_ATTRIBUTES)
   with connection_stage('matching-app'):return resolve_vocabulary_app(apps,args.bundle_id)
  with connection_stage('opening-app-files'):
   from pymobiledevice3.services.house_arrest import HouseArrestService
   afc=HouseArrestService(lockdown,args.bundle_id,documents_only=True)
  with afc:
   # This pinned release's AfcShell auto-cds to /Documents for VendDocuments.
   # Some service versions expose Documents as their root; detect instead of assuming.
   with connection_stage('locating-exchange'):base='/Documents' if afc.exists('/Documents') else ''
   target=base+'/'+remote
   if args.action=='pull':
    with connection_stage('reading-exchange'):
     if not afc.exists(target):raise TransportError('手机同步文件尚未生成。请打开正确的 App，进入同步页面并点击准备同步。','NOT_FOUND')
     stat=afc.stat(target)
     if int(stat.get('st_size',0))>MAX_BYTES:raise TransportError('手机同步文件超过大小限制。','TOO_LARGE')
     return validate_json(afc.get_file_contents(target))
   if args.action=='push':
    with connection_stage('writing-exchange'):
     validate_json(data);afc.makedirs(base+'/Exchange');temp=target+'.tmp';afc.set_file_contents(temp,data)
     # Final file only becomes visible when complete. A gap replacing the previous
     # exchange is harmless: the app keeps its private DB and polls again.
     if afc.exists(target):afc.rm_single(target)
     afc.rename(temp,target);return True
 finally:
  # A cleanup failure must not replace the original connection/read error.
  active_error=sys.exc_info()[1]
  try:
   with connection_stage('closing-device'):lockdown.close()
  except Exception:
   if active_error is None:raise

def parse_args(argv=None):
 parser=argparse.ArgumentParser(description='Vocabulary app USB File Sharing transport')
 parser.add_argument('action',choices=['self-test','list','resolve-app','pull','push']);parser.add_argument('--udid',default='');parser.add_argument('--bundle-id',default=APP_PREFIX);parser.add_argument('--remote',default='');parser.add_argument('--fixture-directory');parser.add_argument('--diagnostic',action='store_true',help='仅在 stderr 打印不含局部变量或文件正文的连接异常堆栈')
 return parser.parse_args(argv)

def run(args=None):
 args=args or parse_args()
 with connection_stage('validating-request'):
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{2,199}',args.bundle_id):raise TransportError('App 标识无效。','INVALID_BUNDLE')
 if args.action=='self-test':
  with connection_stage('checking-runtime'):
   import ssl
   ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
  return {'ssl':True,'frozen':bool(getattr(sys,'frozen',False))}
 data=None
 if args.action=='push':
  with connection_stage('validating-input'):data=sys.stdin.buffer.read(MAX_BYTES+1);validate_json(data)
 if args.fixture_directory:
  with connection_stage('opening-fixture'):return fixture(args,data)
 return real(args,data)

def short_reason(error):
 # Exceptions are diagnostics, not a channel for serialized records or secrets.
 reason=str(error)
 if not reason.strip() and error.__cause__ is not None:reason=type(error.__cause__).__name__+': '+str(error.__cause__)
 reason=re.sub(r'-----BEGIN[\s\S]*?-----END[^\n]*-----','[已隐藏密钥资料]',reason)
 reason=re.sub(r'(?i)\b(password|passwd|secret|token|authorization|credential)\s*[:=]\s*[^\s,;]+',r'\1=[已隐藏]',reason)
 if '<?xml' in reason or '<plist' in reason or ('{' in reason and '}' in reason):return '异常消息含结构化内容，已隐藏；未输出同步文件正文。'
 return ' '.join(reason.split())[:400] or '底层组件未提供错误详情。'

def failure(error):
 name=type(error).__name__;stage=getattr(error,'usb_stage','validating-request');reason=short_reason(error)
 if isinstance(error,TransportError):code_name=error.code;message=reason
 elif name=='AppNotInstalledError':code_name='APP_NOT_INSTALLED';message='手机中找不到指定 App，请检查签名后的实际 App 标识。'
 elif 'Pairing' in name or 'PasswordProtected' in name or name in ['NotTrustedError','NotPairedError','PasswordRequiredError','PasscodeRequiredError']:
  code_name='PAIRING_REQUIRED';message='手机信任连接尚未建立，请解锁 iPhone 并确认“信任此电脑”。'
 elif name in ['ConnectionRefusedError','ConnectionError','MuxException','BadDevError','NoDeviceConnectedError','ConnectionFailedError','ConnectionFailedToUsbmuxdError'] or isinstance(error,ConnectionError):
  code_name='USB_UNAVAILABLE';message='Apple USB 连接在此阶段失败。'
 else:code_name='USB_ERROR';message='USB 组件在此阶段失败。'
 detail=f'{STAGES.get(stage,stage)}；{name}：{reason}'
 return {'ok':False,'error':message+'（'+detail+'）','code':code_name,'stage':stage,'exceptionType':name,'reason':reason}

def print_diagnostic(error):
 # print_tb omits locals and exception values (unlike capture_locals/print_exc).
 # Sanitize exception text, including an immediate cause, before displaying it.
 print('USB diagnostic; stage='+getattr(error,'usb_stage','validating-request'),file=sys.stderr)
 traceback.print_tb(error.__traceback__,file=sys.stderr)
 print(type(error).__name__+': '+short_reason(error),file=sys.stderr)
 cause=error.__cause__
 if cause is not None:
  traceback.print_tb(cause.__traceback__,file=sys.stderr)
  print('Caused by '+type(cause).__name__+': '+short_reason(cause),file=sys.stderr)

def main(argv=None):
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
 args=parse_args(argv)
 try:result={'ok':True,'value':run(args)};code=0
 except Exception as error:
  result=failure(error);code=1
  if args.diagnostic:print_diagnostic(error)
 print(json.dumps(result,ensure_ascii=False));return code

if __name__=='__main__':raise SystemExit(main())
