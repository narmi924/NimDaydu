"""Version 1: uint32 sequence + uint64 sample offset + mono Float32LE PCM."""
import struct
from dataclasses import dataclass

import numpy as np
from pydantic import BaseModel, Field


class Hello(BaseModel):
    type: str = "hello"
    protocol: int = 1
    token: str = Field(min_length=20, max_length=100)
    sampleRate: int = Field(ge=8000, le=96000)
    format: str = "f32le"
    channels: int = 1
    sentenceHold: float = Field(default=0.8, ge=0.4, le=1.5)
    autoSave: bool = True
    source: dict[str, str] = Field(default_factory=dict, max_length=3)


@dataclass
class AudioFrame:
    sequence: int
    offset: int
    samples: np.ndarray


def parse_frame(data: bytes, sample_rate: int) -> AudioFrame:
    if len(data) < 16 or (len(data) - 12) % 4 or len(data) > 12 + sample_rate * 4 // 4:
        raise ValueError("Invalid PCM frame size (maximum 250 ms)")
    sequence, offset = struct.unpack_from("<IQ", data)
    samples = np.frombuffer(data, dtype="<f4", offset=12)
    if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 1.01:
        raise ValueError("PCM must contain finite samples in [-1, 1]")
    return AudioFrame(sequence, offset, samples)


class FrameOrder:
    def __init__(self):
        self.sequence: int | None = None
        self.next_offset: int | None = None

    def accept(self, frame: AudioFrame):
        if self.sequence is not None and frame.sequence != (self.sequence + 1) % (2**32):
            raise ValueError("Audio sequence gap; restart capture")
        if self.next_offset is not None and frame.offset != self.next_offset:
            raise ValueError("Audio sample gap; restart capture")
        self.sequence = frame.sequence
        self.next_offset = frame.offset + len(frame.samples)

    def resume(self):
        self.next_offset = None
