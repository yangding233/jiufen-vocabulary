"""Validate pronunciation targets and transactional asset installation, without a model."""
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'tools'))
import build_audio as validator
import build_neural_audio as builder


class PronunciationTargetsTest(unittest.TestCase):
    def test_british_compact_alphabet_preserves_stress_and_length(self):
        self.assertEqual(builder.ipa_to_model('/ˈæbstrækt/', True), 'ˈabstɹakt')
        self.assertEqual(builder.ipa_to_model('/ˈpɜːmɪt/', True), 'pˈɜːmɪt')
        self.assertEqual(builder.ipa_to_model('/əʊ aɪ aʊ ɔɪ tʃ dʒ/', True), 'Q I W Y ʧ ʤ')

    def test_american_compact_alphabet_retains_rhotic_vowels(self):
        self.assertEqual(builder.ipa_to_model('/pɚˈmɪt/', False), 'pəɹmˈɪt')
        self.assertEqual(builder.ipa_to_model('/ˈpɝːmɪt/', False), 'pˈɜɹmɪt')
        self.assertEqual(builder.ipa_to_model('/daɪˈdʒest/', False), 'dIʤˈɛst')
        self.assertEqual(builder.ipa_to_model('/oʊ juːz/', False), 'O juz')

    def test_dictionary_syllable_stress_moves_after_the_consonant_onset(self):
        self.assertEqual(builder.ipa_to_model('/ˈkɒntrɑːst/', True), 'kˈɒntɹɑːst')
        self.assertEqual(builder.ipa_to_model('/lɪv ˌnɪəˈbaɪ/', True), 'lɪv nˌɪəbˈI')
        self.assertEqual(builder.ipa_to_model('/ˈprezənts/', False), 'pɹˈɛzənts')

    def test_reviewed_ids_match_the_original_word_list(self):
        words = {w['id']: w for w in builder.words()}
        review = json.loads((PROJECT / 'tools/audio-pronunciation-overrides.json').read_text(encoding='utf-8'))
        entries = review['entries']
        self.assertEqual(len(entries), len({w['id'] for w in entries}))
        for entry in entries:
            self.assertEqual(entry['word'], words[entry['id']]['word'])
            self.assertTrue(entry['sources'])
            for variant in entry['variants']:
                self.assertTrue(variant['enGB'].strip())
                self.assertTrue(variant['enUS'].strip())
        samples = review['samples']
        self.assertEqual(len(samples), 20)
        self.assertEqual(len({w['id'] for w in samples}), 20)
        for sample in samples:
            self.assertEqual(sample['word'], words[sample['id']]['word'])
        self.assertNotIn('transparent', {w['word'].lower() for w in words.values()})
        self.assertIn('transparent', {w['word'] for w in review['extraSamples']})

    def test_seven_multi_pronunciation_words_keep_the_declared_order(self):
        review = json.loads((PROJECT / 'tools/audio-pronunciation-overrides.json').read_text(encoding='utf-8'))
        multiple = {w['word']: w for w in review['entries'] if len(w['variants']) > 1}
        expected = {'contrast': ['名词', '动词'], 'digest': ['动词', '名词'],
                    'estimate': ['动词', '名词'], 'increase': ['名词', '动词'],
                    'permit': ['名词', '动词'], 'transport': ['名词', '动词'],
                    'use': ['动词', '名词']}
        self.assertEqual(set(multiple), set(expected))
        for word, labels in expected.items():
            entry = multiple[word]
            self.assertEqual([v['label'] for v in entry['variants']], labels)
            for locale in ('enGB', 'enUS'):
                self.assertNotEqual(entry['variants'][0][locale], entry['variants'][1][locale])
        singles = {w['word']: w for w in review['entries']}
        for word in ('abstract', 'desert', 'survey', 'wind'):
            self.assertEqual(len(singles[word]['variants']), 1)


class InstallationTest(unittest.TestCase):
    def setUp(self):
        base = PROJECT / 'build/neural-install-tests'
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=base)
        self.root = Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(base.resolve()))
        self.addCleanup(self.temp.cleanup)
        self.stage = self.root / 'build/neural-audio'
        self.current = self.root / 'web/audio'
        self.current.mkdir(parents=True)
        self.old_audio = b'original audio, preserved exactly'
        (self.current / 'old.m4a').write_bytes(self.old_audio)
        self.old_manifest = b'{"engine":"previous engine","snapshot":"unchanged"}\n'
        (self.root / 'web/audio-manifest.json').write_bytes(self.old_manifest)
        self.words = [{'id': 'jf-0001'}]
        self.manifest = {'schema': 1, 'engine': 'Kokoro-82M v1.0',
                         'encoding': validator.ENCODING, 'voices': list(builder.VOICES),
                         'entries': {'jf-0001': {}}}
        for locale in builder.VOICES:
            records = []
            for suffix in ('', '-slow'):
                relative = f'audio/{locale}/jf-0001{suffix}.m4a'
                file = self.stage / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'\0\0\0\x20ftyp' + b'\0' * 300)
                records.append({'file': relative, 'seconds': 1.1,
                                'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
            self.manifest['entries']['jf-0001'][locale] = {**records[0], 'slow': records[1]}
        for module, values in ((builder, {'ROOT': self.root, 'STAGE': self.stage}),
                               (validator, {'ROOT': self.root, 'AUDIO': self.current})):
            patches = patch.multiple(module, **values)
            patches.start()
            self.addCleanup(patches.stop)

    def install(self):
        (self.stage / 'audio-manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        with redirect_stdout(io.StringIO()):
            builder.install(self.words)

    def assert_original_untouched(self):
        self.assertEqual((self.current / 'old.m4a').read_bytes(), self.old_audio)
        self.assertEqual((self.root / 'web/audio-manifest.json').read_bytes(), self.old_manifest)
        self.assertEqual([p.name for p in self.current.iterdir()], ['old.m4a'])

    def test_incomplete_word_set_rejected_before_touching_current(self):
        self.words.append({'id': 'jf-0002'})
        with self.assertRaisesRegex(AssertionError, 'Generate all words'):
            self.install()
        self.assert_original_untouched()
        self.assertFalse((self.root / 'build/audio-before-kokoro').exists())

    def test_missing_slow_file_rejected_before_touching_current(self):
        file = self.manifest['entries']['jf-0001']['en-US']['slow']['file']
        (self.stage / file).unlink()
        with self.assertRaises(AssertionError):
            self.install()
        self.assert_original_untouched()
        self.assertFalse((self.root / 'build/audio-before-kokoro').exists())

    def test_bad_manifest_path_rejected_before_touching_current(self):
        self.manifest['entries']['jf-0001']['en-GB']['file'] = '../outside.m4a'
        with self.assertRaises(AssertionError):
            self.install()
        self.assert_original_untouched()

    def test_valid_candidate_keeps_exact_previous_snapshot(self):
        self.install()
        previous = self.root / 'build/audio-before-kokoro'
        self.assertEqual((previous / 'audio/old.m4a').read_bytes(), self.old_audio)
        self.assertEqual((previous / 'audio-manifest.json').read_bytes(), self.old_manifest)
        self.assertEqual(len(list(self.current.rglob('*.m4a'))), 4)
        self.assertEqual(json.loads((self.root / 'web/audio-manifest.json').read_text()), self.manifest)

    def test_validation_failure_after_swap_restores_audio_and_manifest(self):
        card = self.manifest['entries']['jf-0001']['en-GB']
        target = self.stage / card['file']
        target.write_bytes(b'not an AAC header' + b'\0' * 300)
        card['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'M4A header'):
            self.install()
        self.assert_original_untouched()


if __name__ == '__main__':
    unittest.main()
