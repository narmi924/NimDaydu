import json
import os
from collections.abc import Callable

from .config import ROOT


class MoonshineEngine:
    """All native operations are called on the service's single ASR executor."""
    def __init__(self, model: str):
        # Hybrid Intel CPUs can spend more time coordinating ORT's default
        # per-session thread pools than executing these small streaming graphs.
        os.environ.setdefault("MOONSHINE_ORT_SINGLE_THREAD", "1")
        from moonshine_voice import ModelArch, Transcriber

        manifest_path = ROOT / "models/manifest.json"
        if not manifest_path.exists():
            raise RuntimeError("Model missing. Run setup.ps1 first.")
        manifest = json.loads(manifest_path.read_text())
        if model not in manifest:
            raise RuntimeError(f"Model '{model}' missing. Run setup.ps1 -Model {model}.")
        self.transcriber = Transcriber(ROOT / manifest[model]["path"], ModelArch(manifest[model]["arch"]), update_interval=0.5)
        self.model = model
        self.stream = None
        self.emit: Callable = lambda _: None
        self.epoch = 0
        self.base_seconds = 0
        self.revisions = {}

    def begin(self, emit: Callable):
        self.emit = emit
        self.epoch = 0
        self.revisions.clear()

    def audio(self, frame, sample_rate: int):
        if self.stream is None:
            self.epoch += 1
            self.base_seconds = frame.offset / sample_rate
            self.stream = self.transcriber.create_stream(update_interval=0.5)
            self.stream.add_listener(self._event)
            self.stream.start()
        self.stream.add_audio(frame.samples.tolist(), sample_rate)

    def _event(self, event):
        from moonshine_voice.transcriber import Error, LineCompleted, LineTextChanged

        if isinstance(event, Error):
            self.emit({"type": "error", "message": "Local speech engine failed. Stop and restart capture."})
            return
        if not isinstance(event, (LineTextChanged, LineCompleted)) or not event.line.text.strip():
            return
        line = event.line
        segment_id = f"{self.epoch}:{line.line_id}"
        final = isinstance(event, LineCompleted) or line.is_complete
        previous = self.revisions.get(segment_id)
        if previous and previous[0] == line.text and previous[1] == final:
            return
        revision = previous[2] + 1 if previous else 1
        self.revisions[segment_id] = (line.text, final, revision)
        self.emit({"type": "caption", "id": segment_id, "revision": revision,
                   "text": line.text, "final": final,
                   "start": round(self.base_seconds + line.start_time, 3),
                   "end": round(self.base_seconds + line.start_time + line.duration, 3),
                   "inferenceMs": line.last_transcription_latency_ms})

    def pause(self):
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None

    def finish(self):
        self.pause()
        self.emit = lambda _: None

    def close(self):
        self.finish()
        self.transcriber.close()
