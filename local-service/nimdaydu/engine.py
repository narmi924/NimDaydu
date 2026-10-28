import json
import os
import time
from collections.abc import Callable

from .config import ROOT
from .system import SETUP_SCRIPT

UPDATE_INTERVAL = 0.5
# A draft pass re-reads its whole current line, so it costs more as a line
# grows. Upstream lets the interval shrink to one pass's own cost, which pins a
# core during long continuous speech and leaves nothing for the second pass or
# the browser. Waiting for this multiple of the last pass keeps drafts at most
# about two thirds of one core.
PASS_HEADROOM = 1.5
MAX_UPDATE_INTERVAL = 5.0


class MoonshineEngine:
    """All native operations are called on the service's single ASR executor."""
    def __init__(self, model: str):
        # Hybrid Intel CPUs can spend more time coordinating ORT's default
        # per-session thread pools than executing these small streaming graphs.
        os.environ.setdefault("MOONSHINE_ORT_SINGLE_THREAD", "1")
        from moonshine_voice import ModelArch, Transcriber

        manifest_path = ROOT / "models/manifest.json"
        if not manifest_path.exists():
            raise RuntimeError(f"Model missing. Run {SETUP_SCRIPT} first.")
        manifest = json.loads(manifest_path.read_text())
        if model not in manifest:
            raise RuntimeError(f"Model '{model}' missing. Run {SETUP_SCRIPT} again and choose {model}.")
        # Manifests written on Windows before v0.6 use backslashes.
        self.transcriber = Transcriber(ROOT / manifest[model]["path"].replace("\\", "/"), ModelArch(manifest[model]["arch"]), update_interval=UPDATE_INTERVAL)
        self.model = model
        self.stream = None
        self.emit: Callable = lambda _: None
        self.epoch = 0
        self.base_seconds = 0
        self.revisions = {}
        self.stream_seconds = 0.0
        self.updated_at = 0.0
        self.last_pass = 0.0

    def begin(self, emit: Callable):
        self.emit = emit
        self.epoch = 0
        self.revisions.clear()

    def audio(self, frame, sample_rate: int, behind: bool = False):
        if self.stream is None:
            self.epoch += 1
            self.base_seconds = frame.offset / sample_rate
            # The stream never schedules its own passes; see PASS_HEADROOM.
            self.stream = self.transcriber.create_stream(update_interval=10 ** 6)
            self.stream.add_listener(self._event)
            self.stream.start()
            self.stream_seconds = self.updated_at = self.last_pass = 0.0
        self.stream.add_audio(frame.samples.tolist(), sample_rate)
        self.stream_seconds += len(frame.samples) / sample_rate
        # While frames are queued, ingesting audio is cheap and a pass is not:
        # catch up first, then let one pass cover everything that arrived.
        needed = min(max(UPDATE_INTERVAL, PASS_HEADROOM * self.last_pass), MAX_UPDATE_INTERVAL)
        if not behind and self.stream_seconds - self.updated_at >= needed:
            started = time.perf_counter()
            self.stream.update_transcription()
            self.last_pass = time.perf_counter() - started
            self.updated_at = self.stream_seconds

    def _event(self, event):
        from moonshine_voice.transcriber import Error, LineCompleted, LineTextChanged

        if isinstance(event, Error):
            self.emit({"type": "error", "message": "Local speech engine failed. Stop and restart capture."})
            return
        if not isinstance(event, (LineTextChanged, LineCompleted)):
            return
        line = event.line
        segment_id = f"{self.epoch}:{line.line_id}"
        final = isinstance(event, LineCompleted) or line.is_complete
        previous = self.revisions.get(segment_id)
        if not line.text.strip():
            # The acoustic model can retract a provisional hypothesis by
            # completing it with empty text (common with noisy game audio).
            # Ignoring that event leaves an eternal draft ahead of good lines.
            if previous and not previous[1] and (previous[0] or final):
                revision = previous[2] + 1
                self.revisions[segment_id] = ('', final, revision)
                self.emit({'type': 'retract', 'id': segment_id, 'revision': revision})
            return
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
