"""Replay a WAV at real speed and measure ASR, excluding browser/translation."""
import argparse
import json
import os
import time
import wave
from pathlib import Path

import numpy as np
from moonshine_voice import ModelArch, Transcriber
from moonshine_voice.transcriber import LineCompleted, LineTextChanged

ROOT = Path(__file__).resolve().parent.parent


def benchmark(name, audio, rate, manifest):
    started = time.perf_counter()
    transcriber = Transcriber(ROOT / manifest[name]["path"], ModelArch(manifest[name]["arch"]), update_interval=0.5)
    load_time = time.perf_counter() - started
    stream = transcriber.create_stream()
    events = []
    replay_start = time.perf_counter()

    def on_event(event):
        if isinstance(event, (LineTextChanged, LineCompleted)) and event.line.text.strip():
            events.append({"at": round(time.perf_counter() - replay_start, 3), "text": event.line.text,
                           "final": isinstance(event, LineCompleted), "start": event.line.start_time,
                           "duration": event.line.duration})

    stream.add_listener(on_event)
    stream.start()
    chunk_size = int(rate * 0.08)
    native_time = 0
    for index in range(0, len(audio), chunk_size):
        chunk = audio[index:index + chunk_size]
        due = replay_start + (index + len(chunk)) / rate
        time.sleep(max(0, due - time.perf_counter()))
        before = time.perf_counter()
        stream.add_audio(chunk.tolist(), rate)
        native_time += time.perf_counter() - before
    stream.stop()
    stream.close()
    transcriber.close()
    completed = [event for event in events if event["final"]]
    result = {"model": name, "sample": "Windows synthetic English; not a real Discord benchmark",
              "single_thread": os.getenv("MOONSHINE_ORT_SINGLE_THREAD", "0"),
              "load_seconds": round(load_time, 3), "audio_seconds": round(len(audio) / rate, 3),
              "native_real_time_factor": round(native_time / (len(audio) / rate), 3),
              "first_text_seconds": events[0]["at"] if events else None,
              "finalization_delays_seconds": [round(e["at"] - e["start"] - e["duration"], 3) for e in completed],
              "final_text": " ".join(e["text"] for e in completed), "events": events}
    print(json.dumps({key: value for key, value in result.items() if key != "events"}, ensure_ascii=False), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", default=["small", "medium"])
    parser.add_argument("--wav", type=Path, default=ROOT / "samples/english.wav")
    parser.add_argument("--single-thread", action="store_true")
    args = parser.parse_args()
    os.environ["MOONSHINE_ORT_SINGLE_THREAD"] = "1" if args.single_thread else "0"
    with wave.open(str(args.wav)) as sample:
        if sample.getsampwidth() != 2:
            raise ValueError("Benchmark accepts PCM16 WAV")
        rate = sample.getframerate()
        audio = np.frombuffer(sample.readframes(sample.getnframes()), dtype="<i2").astype(np.float32) / 32768
        audio = audio.reshape(-1, sample.getnchannels()).mean(axis=1)
    audio = np.concatenate([audio, np.zeros(rate * 2, dtype=np.float32)])
    manifest = json.loads((ROOT / "models/manifest.json").read_text())
    results = [benchmark(name, audio, rate, manifest) for name in args.models]
    out_dir = ROOT / "artifacts"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "benchmark.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
