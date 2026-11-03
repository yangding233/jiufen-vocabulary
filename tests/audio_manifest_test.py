"""Audio asset validation, using isolated fake M4A headers instead of synthesis."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_audio', PROJECT / 'tools/build_audio.py')
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        temporary = PROJECT / 'build/audio-validation-tests'
        temporary.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=temporary)
        self.root = Path(self.temp.name)
        self.original_root, self.original_audio = audio.ROOT, audio.AUDIO
        audio.ROOT = self.root
        audio.AUDIO = self.root / 'web/audio'
        self.words = [{'id': 'jf-0001'}]
        self.manifest = {'schema': 1, 'engine': 'Kokoro-82M v1.0',
                         'encoding': audio.ENCODING, 'voices': list(audio.VOICES),
                         'entries': {'jf-0001': {}}}
        for locale in audio.VOICES:
            records = []
            for suffix in ('', '-slow'):
                relative = f'audio/{locale}/jf-0001{suffix}.m4a'
                file = self.root / 'web' / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'\0\0\0\x20ftyp' + b'\0' * 300)
                records.append({'file': relative, 'seconds': 1.5 if suffix else 1.1,
                                'sha256': audio.digest(file)})
            self.manifest['entries']['jf-0001'][locale] = {**records[0], 'slow': records[1]}

    def tearDown(self):
        audio.ROOT, audio.AUDIO = self.original_root, self.original_audio
        self.temp.cleanup()

    def test_complete_normal_and_slow_files_pass(self):
        self.assertGreater(audio.check_manifest(self.manifest, self.words), 0)

    def test_legacy_pair_without_slow_files_passes(self):
        for locale, card in self.manifest['entries']['jf-0001'].items():
            (self.root / 'web' / card.pop('slow')['file']).unlink()
        self.assertGreater(audio.check_manifest(self.manifest, self.words), 0)

    def test_one_missing_slow_card_is_rejected(self):
        del self.manifest['entries']['jf-0001']['en-US']['slow']
        with self.assertRaisesRegex(ValueError, 'Missing slow'):
            audio.check_manifest(self.manifest, self.words)

    def test_slow_checksum_must_match_file(self):
        self.manifest['entries']['jf-0001']['en-GB']['slow']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            audio.check_manifest(self.manifest, self.words)

    def test_slow_path_cannot_escape_asset_directory(self):
        self.manifest['entries']['jf-0001']['en-GB']['slow']['file'] = '../outside.m4a'
        with self.assertRaisesRegex(ValueError, 'Invalid manifest record'):
            audio.check_manifest(self.manifest, self.words)

    def test_optional_note_must_be_short_plain_data(self):
        self.manifest['entries']['jf-0001']['en-GB']['note'] = {'html': '<script>'}
        with self.assertRaisesRegex(ValueError, 'Invalid pronunciation note'):
            audio.check_manifest(self.manifest, self.words)

    def test_unlisted_extra_audio_is_rejected(self):
        (audio.AUDIO / 'extra.m4a').write_bytes(b'\0\0\0\x20ftyp' + b'\0' * 300)
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing'):
            audio.check_manifest(self.manifest, self.words)

    def test_legacy_builder_cannot_overwrite_neural_manifest(self):
        target = self.root / 'audio-manifest.json'
        target.write_text(json.dumps(self.manifest), encoding='utf-8')
        with patch('sys.argv', ['build_audio.py']), patch.object(audio, 'TARGET', target), \
                patch.object(audio, 'load_words', return_value=self.words), \
                patch.object(audio, 'preserve_pcm') as migrate:
            with self.assertRaisesRegex(ValueError, 'Refusing to replace non-eSpeak'):
                audio.main()
            migrate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
