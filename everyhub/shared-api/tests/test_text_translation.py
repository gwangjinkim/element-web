# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

from fastapi.testclient import TestClient
from app.main import Settings, create_app


class FakeTextEngine:
    def __init__(self):
        self.calls = 0

    def translate(self, text, source, target, temperature=0.0, instructions=""):
        self.calls += 1
        return {'translatedText':'Guten Morgen', 'detectedLanguage':source, 'skipped':False}


def test_private_text_route_requires_service_key_and_bounds_input(tmp_path):
    engine = FakeTextEngine()
    app = create_app(Settings(data=tmp_path, text_translation_key='a-private-test-key'), text_engine=engine)
    payload = {'text':'Good morning', 'source':'en', 'target':'de'}
    with TestClient(app) as client:
        assert client.post('/internal/text-translation', json=payload).status_code == 403
        assert client.post('/internal/text-translation', json=payload,
                           headers={'x-matrix-translation-key':'wrong-key'}).status_code == 403
        assert engine.calls == 0
        headers = {'x-matrix-translation-key':'a-private-test-key'}
        assert client.post('/internal/text-translation', json={**payload,'text':'x'*3001},headers=headers).status_code == 422
        assert client.post('/internal/text-translation', json={**payload,'target':'zz'},headers=headers).status_code == 400
        response = client.post('/internal/text-translation',json=payload,headers=headers)
        assert response.status_code == 200
        assert response.json()['translatedText'] == 'Guten Morgen'
        assert engine.calls == 1


def test_auto_source_is_accepted_and_detection_metadata_is_returned(tmp_path):
    class DetectorEngine:
        def translate(self, text, source, target, temperature=0.0, instructions=""):
            assert source == 'auto'
            return {'translatedText':'', 'detectedLanguage':'en', 'skipped':True}
    app = create_app(Settings(data=tmp_path, text_translation_key='test-key'), text_engine=DetectorEngine())
    with TestClient(app) as client:
        response=client.post('/internal/text-translation', json={'text':'Already English','target':'en'},
                             headers={'x-matrix-translation-key':'test-key'})
        assert response.status_code == 200
        assert response.json()['skipped'] is True
        assert response.json()['detectedLanguage'] == 'en'


def test_native_engine_skips_same_language_and_nonlinguistic_messages_without_loading_llm(tmp_path):
    from app.text_translation import TextTranslationEngine
    engine=TextTranslationEngine(tmp_path)
    engine.detect=lambda text: ('en',0.99)
    assert engine.translate('Already English','auto','en')['skipped'] is True
    assert engine.translate('Already English','en','en')['reason'] == 'same-language'
    assert engine.translate('12345 🙂 https://example.org','auto','en')['reason'] == 'no-language'
    assert engine.translator is None


def test_native_engine_bounds_results_preserves_paragraphs_and_disables_thinking(tmp_path):
    from app.text_translation import TextTranslationEngine, LANGUAGES
    import pytest
    class Model:
        calls=[]
        truncated=False
        def tokenize(self, text): return list(text)
        def create_completion(self,prompt,**options):
            self.calls.append((prompt,options))
            return {'choices':[{'text':'Translated', 'finish_reason':'length' if self.truncated else 'stop'}]}
    engine=TextTranslationEngine(tmp_path)
    engine.translator=Model()
    engine.detect=lambda text: ('ru',0.99)
    result=engine.translate('Первая строка.\nВторая строка.','auto','en')
    assert result['translatedText'] == 'Translated\nTranslated'
    assert result['detectedLanguage'] == 'ru'
    assert result['skipped'] is False
    assert '<think>\n\n</think>' in engine.translator.calls[0][0]
    assert engine.translator.calls[0][1]['temperature'] == 0
    engine.translator.truncated=True
    with pytest.raises(ValueError,match='length limit'): engine.translate('Привет','ru','en')
    with pytest.raises(ValueError,match='Unsupported'): engine.translate('Hello','zz','en')
    assert len(LANGUAGES) == 150
    assert all(code in LANGUAGES for code in ['en','de','ru','uk','ko','pl','el'])


def test_model_configuration_and_room_settings_are_authenticated_and_bounded(tmp_path):
    from app.text_translation import TextTranslationEngine, PROMPT_TEMPLATE
    app=create_app(Settings(data=tmp_path,text_translation_key='test-key'),text_engine=FakeTextEngine())
    with TestClient(app) as client:
        assert client.get('/internal/text-translation/config').status_code == 403
        headers={'x-matrix-translation-key':'test-key'}
        config=client.get('/internal/text-translation/config',headers=headers).json()
        assert config['promptTemplate']==PROMPT_TEMPLATE and config['defaultTemperature']==0
        payload={'text':'Hello','source':'en','target':'de'}
        for invalid in [{'temperature':-1},{'temperature':1.01},{'instructions':'x'*1601}]:
            assert client.post('/internal/text-translation',json={**payload,**invalid},headers=headers).status_code==422
    engine=TextTranslationEngine(tmp_path)
    import pytest
    with pytest.raises(ValueError,match='settings'):engine.translate('Hi','en','de',2)
    with pytest.raises(ValueError,match='settings'):engine.translate('Hi','en','de',0,'x'*1601)


def test_custom_settings_apply_to_only_the_request_not_the_shared_model_defaults(tmp_path):
    from app.text_translation import TextTranslationEngine
    class Model:
        calls=[]
        def tokenize(self,text):return list(text)
        def create_completion(self,prompt,**options):
            self.calls.append((prompt,options))
            return {'choices':[{'text':'Hallo','finish_reason':'stop'}]}
    engine=TextTranslationEngine(tmp_path);engine.translator=Model()
    engine.translate('Hello','en','de',0.2,'Use informal language.')
    engine.translate('Hello','en','de')
    assert engine.translator.calls[0][1]['temperature']==0.2
    assert 'Use informal language.' in engine.translator.calls[0][0]
    assert engine.translator.calls[1][1]['temperature']==0
    assert 'Use informal language.' not in engine.translator.calls[1][0]
