import importlib.util,json,tempfile,unittest,argparse
from pathlib import Path
spec=importlib.util.spec_from_file_location('usb_transport',Path(__file__).resolve().parents[2]/'tools'/'usb_transport.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class TransportTests(unittest.TestCase):
 def args(self,base,action,remote='Exchange/incoming.json'):
  return argparse.Namespace(fixture_directory=str(base),action=action,remote=remote)
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
if __name__=='__main__':unittest.main()
