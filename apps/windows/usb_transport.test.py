import importlib.util,json,tempfile,unittest,argparse,io,sys,types
from contextlib import redirect_stdout,redirect_stderr
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('usb_transport',Path(__file__).resolve().parents[2]/'tools'/'usb_transport.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class TransportTests(unittest.TestCase):
 def args(self,base,action,remote='Exchange/incoming.json'):
  return argparse.Namespace(fixture_directory=str(base),action=action,remote=remote,bundle_id=module.APP_PREFIX)
 def test_atomic_exchange_and_missing(self):
  with tempfile.TemporaryDirectory() as d:
   base=Path(d);a=self.args(base,'pull')
   with self.assertRaises(module.TransportError) as cm:module.fixture(a)
   self.assertEqual(cm.exception.code,'NOT_FOUND')
   self.assertTrue(module.fixture(self.args(base,'push'),b'{"batchId":"abc"}'))
   self.assertEqual(json.loads(module.fixture(a)),{'batchId':'abc'})
   self.assertFalse((base/'Exchange/incoming.json.tmp').exists())
 def test_invalid_file_never_replaces_valid_packet(self):
  with tempfile.TemporaryDirectory() as d:
   base=Path(d);module.fixture(self.args(base,'push'),b'{"valid":true}')
   with self.assertRaises(module.TransportError):module.fixture(self.args(base,'push'),b'not JSON')
   self.assertEqual(json.loads(module.fixture(self.args(base,'pull'))),{'valid':True})
 def test_path_restriction_and_explicit_test_mode(self):
  with tempfile.TemporaryDirectory() as d:
   for path in ['../../secrets','Documents/progress.sqlite','Exchange/other.txt','/Exchange/incoming.json']:
    with self.assertRaises(module.TransportError):module.fixture(self.args(Path(d),'pull',path))
   devices=module.fixture(self.args(Path(d),'list'));self.assertEqual(devices[0]['fixture'],True)
 def test_cli_resolve_and_diagnostic_flags(self):
  args=module.parse_args(['resolve-app','--udid','test-phone','--diagnostic'])
  self.assertEqual(args.action,'resolve-app');self.assertTrue(args.diagnostic)
  self.assertEqual(args.bundle_id,'com.jiufen.vocabulary')
  with self.assertRaises(module.TransportError) as cm:module.run(module.parse_args(['list','--bundle-id','../../other']))
  self.assertEqual(cm.exception.code,'INVALID_BUNDLE');self.assertEqual(cm.exception.usb_stage,'validating-request')
 def test_fixture_resolve_does_not_touch_a_real_device(self):
  with tempfile.TemporaryDirectory() as d:
   args=module.parse_args(['resolve-app','--fixture-directory',d,'--bundle-id','com.jiufen.vocabulary.test'])
   value=module.run(args)
   self.assertEqual(value['bundleId'],args.bundle_id);self.assertEqual(value['matchedBy'],'fixture')
   self.assertEqual(list(Path(d).iterdir()),[])
 def app(self,bundle='com.jiufen.vocabulary.SIGNED',name='九分词汇',sharing=True):
  return {'CFBundleIdentifier':bundle,'CFBundleDisplayName':name,'UIFileSharingEnabled':sharing,'UnrelatedPrivateMetadata':'do-not-return'}
 def test_resolution_prefers_requested_id_and_returns_minimal_metadata(self):
  apps=[self.app(),self.app('com.jiufen.vocabulary'),self.app('com.other.mail','邮件')]
  value=module.resolve_vocabulary_app(apps,'com.jiufen.vocabulary')
  self.assertEqual(value['bundleId'],'com.jiufen.vocabulary');self.assertEqual(value['matchedBy'],'requested')
  self.assertEqual(set(value),{'bundleId','name','fileSharingEnabled','matchedBy'})
 def test_resolution_finds_signed_prefix_or_exact_app_name(self):
  value=module.resolve_vocabulary_app([self.app(name='我的改名词汇')],module.APP_PREFIX)
  self.assertEqual(value['bundleId'],'com.jiufen.vocabulary.SIGNED');self.assertEqual(value['matchedBy'],'single')
  value=module.resolve_vocabulary_app([self.app('example.custom.id','JiufenVocabulary',False)],module.APP_PREFIX)
  self.assertEqual(value['bundleId'],'example.custom.id');self.assertIs(value['fileSharingEnabled'],False)
 def test_resolution_rejects_ambiguous_or_unrelated_apps(self):
  with self.assertRaises(module.TransportError) as cm:module.resolve_vocabulary_app([self.app(),self.app('com.jiufen.vocabulary.OTHER')],module.APP_PREFIX)
  self.assertEqual(cm.exception.code,'AMBIGUOUS_APP')
  with self.assertRaises(module.TransportError) as cm:module.resolve_vocabulary_app([self.app('com.jiufen.vocabularyfake','Other'),self.app('com.other.mail','邮件')],module.APP_PREFIX)
  self.assertEqual(cm.exception.code,'APP_NOT_INSTALLED')
 def test_real_resolve_uses_limited_attributes_and_closes_connection(self):
  seen={};apps=[self.app()]
  class Lockdown:
   def close(self):seen['closed']=True
  class Proxy:
   def __init__(self,lockdown):self.lockdown=lockdown
   def __enter__(self):return self
   def __exit__(self,*unused):pass
   def browse(self,**options):seen.update(options);return apps
  fake={name:types.ModuleType(name) for name in ['pymobiledevice3','pymobiledevice3.services','pymobiledevice3.usbmux','pymobiledevice3.lockdown','pymobiledevice3.services.installation_proxy']}
  fake['pymobiledevice3.usbmux'].list_devices=lambda:[types.SimpleNamespace(is_usb=True,serial='test-phone')]
  fake['pymobiledevice3.lockdown'].create_using_usbmux=lambda **kwargs:Lockdown()
  fake['pymobiledevice3.services.installation_proxy'].InstallationProxyService=Proxy
  with patch.dict(sys.modules,fake):value=module.real(module.parse_args(['resolve-app','--udid','test-phone']))
  self.assertEqual(value['bundleId'],'com.jiufen.vocabulary.SIGNED')
  self.assertEqual(seen['attributes'],['CFBundleIdentifier','CFBundleName','CFBundleDisplayName','UIFileSharingEnabled'])
  self.assertEqual(seen['options'],{'ApplicationType':'User'});self.assertTrue(seen['closed'])
 def test_errors_preserve_connection_phase_type_and_reason(self):
  MuxException=type('MuxException',(Exception,),{})
  with self.assertRaises(MuxException) as cm:
   with module.connection_stage('pairing-device'):raise MuxException('socket connection broken')
  result=module.failure(cm.exception)
  self.assertEqual(result['code'],'USB_UNAVAILABLE');self.assertEqual(result['stage'],'pairing-device')
  self.assertEqual(result['exceptionType'],'MuxException');self.assertEqual(result['reason'],'socket connection broken')
  self.assertIn('socket connection broken',result['error']);self.assertNotIn('数据线',result['error'])
  AppNotInstalledError=type('AppNotInstalledError',(Exception,),{})
  self.assertEqual(module.failure(AppNotInstalledError('missing app'))['code'],'APP_NOT_INSTALLED')
  ConnectionFailedToUsbmuxdError=type('ConnectionFailedToUsbmuxdError',(Exception,),{})
  self.assertEqual(module.failure(ConnectionFailedToUsbmuxdError())['code'],'USB_UNAVAILABLE')
 def test_diagnostic_is_opt_in_stderr_and_does_not_print_payload_or_credentials(self):
  secret_body='{"note":"private learner content","password":"not-for-output"}'
  error=RuntimeError(secret_body);error.usb_stage='reading-exchange'
  for enabled in [False,True]:
   out=io.StringIO();err=io.StringIO()
   with patch.object(module,'run',side_effect=error),redirect_stdout(out),redirect_stderr(err):
    code=module.main(['list']+(['--diagnostic'] if enabled else []))
   result=json.loads(out.getvalue());self.assertEqual(code,1);self.assertEqual(result['stage'],'reading-exchange')
   self.assertNotIn('private learner content',out.getvalue()+err.getvalue());self.assertNotIn('not-for-output',out.getvalue()+err.getvalue())
   if enabled:self.assertIn('USB diagnostic',err.getvalue());self.assertIn('RuntimeError',err.getvalue())
   else:self.assertEqual(err.getvalue(),'')
  self.assertNotIn('abc-secret',module.short_reason(RuntimeError('password=abc-secret token=abc-secret')))
if __name__=='__main__':unittest.main()
