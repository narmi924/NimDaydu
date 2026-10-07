import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from nimdaydu.app import create_app
from nimdaydu.config import ROOT
from test_protocol import frame


class FakeEngine:
    def __init__(self, model):
        self.emit = lambda _: None
        self.active = False
        self.epoch = 0
        self.offset = 0

    def begin(self, emit):
        self.emit = emit
        self.epoch = 0

    def audio(self, packet, rate):
        self.offset = packet.offset / rate
        if not self.active:
            self.active = True
            self.epoch += 1
        self.emit({'type': 'caption', 'id': str(self.epoch), 'revision': 1, 'text': 'Hello Discord', 'final': False, 'start': packet.offset / rate, 'end': (packet.offset + len(packet.samples)) / rate})

    def pause(self):
        if self.active:
            self.emit({'type': 'caption', 'id': str(self.epoch), 'revision': 2, 'text': 'Hello Discord.', 'final': True, 'start': self.offset, 'end': self.offset + 0.08})
        self.active = False

    def finish(self):
        self.pause()

    def close(self):
        self.finish()


class FakeTranslator:
    def translate(self, text):
        return '你好，Discord。'


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    app = create_app(FakeEngine, tmp_path, FakeTranslator)
    token = json.loads((tmp_path / 'config.json').read_text())['token']
    with TestClient(app, base_url='http://127.0.0.1') as client:
        yield client, token


def hello(ws, token):
    ws.send_json({'type': 'hello', 'token': token, 'sampleRate': 16000})


def test_health_and_capabilities_require_correct_local_token(service):
    client, token = service
    assert client.get('/health').json()['ready'] is True
    assert client.get('/capabilities').status_code == 401
    assert client.get('/capabilities', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.get('/capabilities', headers={'Authorization': f'Bearer {token}'}).status_code == 200
    assert client.get('/pairing', headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/health', headers={'Host': 'evil.example'}).status_code == 400
    assert 'frame-ancestors' in client.get('/pairing').headers['content-security-policy']
    assert client.get('/health').headers.get('access-control-allow-origin') is None
    assert token not in client.get('/pairing').text


def test_bad_token_and_cross_origin_cannot_start_audio(service):
    client, token = service
    with client.websocket_connect('ws://127.0.0.1/audio') as ws:
        hello(ws, 'x' * 32)
        with pytest.raises(WebSocketDisconnect) as denied:
            ws.receive_json()
        assert denied.value.code == 1008
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('ws://127.0.0.1/audio', headers={'Origin': 'https://evil.example'}):
            pass
    assert client.get('/health').json()['busy'] is False


def test_capture_pause_resume_stop_and_single_session_lock(service):
    client, token = service
    with client.websocket_connect('ws://127.0.0.1/audio', headers={'Origin': 'chrome-extension://local-test'}) as ws:
        hello(ws, token)
        assert ws.receive_json()['type'] == 'ready'
        with client.websocket_connect('ws://127.0.0.1/audio') as second:
            hello(second, token)
            assert second.receive_json()['type'] == 'error'
        ws.send_bytes(frame())
        assert ws.receive_json()['type'] == 'pending'
        ws.send_json({'type': 'pause'})
        assert ws.receive_json()['final'] is True
        assert ws.receive_json()['pending'] is False
        assert ws.receive_json()['state'] == 'paused'
        ws.send_json({'type': 'resume'})
        assert ws.receive_json()['state'] == 'capturing'
        ws.send_bytes(frame(1, 160000))
        assert ws.receive_json()['pending'] is True
        ws.send_json({'type': 'stop'})
        final = ws.receive_json()
        assert final['final'] is True and final['start'] == 10
        assert ws.receive_json()['pending'] is False
        assert ws.receive_json()['state'] == 'stopped'
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1000
    assert client.get('/health').json()['busy'] is False


def test_sequence_gap_closes_and_releases_engine(service):
    client, token = service
    with client.websocket_connect('ws://127.0.0.1/audio') as ws:
        hello(ws, token)
        ws.receive_json()
        ws.send_bytes(frame())
        ws.receive_json()
        ws.send_bytes(frame(2, 1280))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1008
    assert client.get('/health').json()['busy'] is False


def test_deepseek_requires_key_and_never_automatically_falls_back(service):
    client, token = service
    assert client.post('/translate', json={'text': 'Hello'}).status_code == 401
    assert client.post('/translate', headers={'Authorization': f'Bearer {token}'}, json={'text': 'Hello'}).status_code == 503
    result = client.post('/translate', headers={'Authorization': f'Bearer {token}'}, json={'text': 'Hello Discord', 'provider': 'offline'})
    assert result.json() == {'text': '你好，Discord。', 'provider': 'offline'}


def test_auto_connect_only_exposes_token_to_fixed_extension_origin(service):
    client, token = service
    identity = json.loads((ROOT / 'extension/identity.json').read_text())
    origin = 'chrome-extension://' + identity['extensionId']
    for denied in (None, 'chrome-extension://another-extension', origin + '.evil', 'https://evil.example'):
        headers = {'Origin': denied} if denied else {}
        response = client.post('/connect', headers=headers, json={'extensionId': identity['extensionId']})
        assert response.status_code == 403
        assert token not in response.text
    response = client.post('/connect', headers={'Origin': origin}, json={})
    assert response.json()['token'] == token
    assert response.headers['access-control-allow-origin'] == origin
    preflight = client.options('/connect', headers={'Origin': origin})
    assert preflight.headers['access-control-allow-methods'] == 'POST'


def test_optional_provider_key_is_local_and_not_returned_in_responses(service):
    client, token = service
    origin = 'chrome-extension://' + json.loads((ROOT / 'extension/identity.json').read_text())['extensionId']
    headers = {'Origin': origin, 'Authorization': f'Bearer {token}'}
    assert client.post('/providers/deepseek', headers={'Origin': origin}, json={'key': 'test-only-key'}).status_code == 401
    response = client.post('/providers/deepseek', headers=headers, json={'key': 'test-only-key'})
    assert response.json() == {'deepseekConfigured': True}
    response = client.post('/connect', headers={'Origin': origin}, json={})
    assert response.json()['deepseekConfigured'] is True
    assert 'test-only-key' not in response.text
    assert client.post('/providers/deepseek', headers=headers, json={'clear': True}).json() == {'deepseekConfigured': False}
