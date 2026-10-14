"""Exercise a real-time-capable recognizer receiving a delayed browser burst."""
import json
import importlib
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from nimdaydu.app import create_app
from test_protocol import frame
from test_service import FakeEngine, FakeTranslator


class RealtimeEngine(FakeEngine):
    def __init__(self, model):
        super().__init__(model)
        self.processed = []

    def audio(self, packet, rate):
        # 20 ms of computation per 80 ms of audio can comfortably keep up.
        time.sleep(.02)
        self.processed.append(packet.sequence)


def test_delayed_audio_burst_is_processed_without_disconnect_or_lost_frames(tmp_path):
    engine = RealtimeEngine('small')
    app = create_app(lambda _: engine, tmp_path, FakeTranslator)
    token = json.loads((tmp_path / 'config.json').read_text())['token']
    with TestClient(app, base_url='http://127.0.0.1') as client:
        with client.websocket_connect('ws://127.0.0.1/audio') as ws:
            ws.send_json({'type': 'hello', 'token': token, 'sampleRate': 16000})
            assert ws.receive_json()['type'] == 'ready'
            # Browser scheduling can batch already-captured worklet messages.
            for sequence in range(48):
                ws.send_bytes(frame(sequence, sequence * 1280))
            ws.send_json({'type': 'stop'})
            recovery_states = []
            for _ in range(100):
                message = ws.receive_json()
                assert message['type'] != 'error', message
                if message['type'] == 'backpressure':
                    recovery_states.append(message['recovering'])
                if message.get('state') == 'stopped':
                    break
            else:
                raise AssertionError('The audio burst never finished')
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 1000
        assert engine.processed == list(range(48))
        health = client.get('/health').json()
        assert health['busy'] is False
        assert recovery_states == [True, False]
        assert health['audio']['framesProcessed'] == 48
        assert health['audio']['maxQueuedFrames'] <= 25


@pytest.mark.parametrize('latency, stall_limit, recovery_limit', [(.3, .03, 8), (.02, 1, .09)],
                         ids=['native-stall', 'persistent-backlog-with-progress'])
def test_persistent_overload_stops_with_a_clear_error_and_releases_the_session(
        tmp_path, monkeypatch, latency, stall_limit, recovery_limit):
    class StalledEngine(RealtimeEngine):
        def audio(self, packet, rate):
            time.sleep(latency)
            self.processed.append(packet.sequence)

    app_module = importlib.import_module('nimdaydu.app')
    monkeypatch.setattr(app_module, 'AUDIO_STALL_TIMEOUT', stall_limit)
    monkeypatch.setattr(app_module, 'AUDIO_RECOVERY_TIMEOUT', recovery_limit)
    app = create_app(StalledEngine, tmp_path, FakeTranslator)
    token = json.loads((tmp_path / 'config.json').read_text())['token']
    with TestClient(app, base_url='http://127.0.0.1') as client:
        with client.websocket_connect('ws://127.0.0.1/audio') as ws:
            ws.send_json({'type': 'hello', 'token': token, 'sampleRate': 16000})
            assert ws.receive_json()['type'] == 'ready'
            for sequence in range(48):
                ws.send_bytes(frame(sequence, sequence * 1280))
            for _ in range(100):
                message = ws.receive_json()
                if message['type'] == 'error':
                    assert message['code'] == 'asr_overload'
                    assert '持续积压' in message['message']
                    break
            else:
                raise AssertionError('The stalled recognizer was left running')
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 1013
        deadline = time.monotonic() + 1
        while client.get('/health').json()['busy'] and time.monotonic() < deadline:
            time.sleep(.01)
        health = client.get('/health').json()
        assert health['busy'] is False
        assert health['audio']['status'] == 'overload'
