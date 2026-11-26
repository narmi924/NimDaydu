"""Decode a selected local recording in bounded, overlapping acoustic windows."""
import shutil
import subprocess
from contextlib import closing

import numpy as np

from .refinement import recognize_region
from .segmentation import display_units, timed_parts


def _word_windows(path, refiner):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('文件转录需要 FFmpeg。请安装 FFmpeg 后重启本机服务。')
    rate, stride, context = 16000, 12 * 16000, 16000
    with subprocess.Popen([ffmpeg, '-nostdin', '-loglevel', 'error', '-i', str(path), '-vn',
                           '-ac', '1', '-ar', str(rate), '-f', 'f32le', 'pipe:1'],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        offset = 0
        previous = b''
        try:
            data = process.stdout.read((stride + context) * 4)
            while data:
                samples = np.frombuffer(previous + data, dtype='<f4')
                origin = (offset - len(previous) // 4) / rate
                last = len(data) <= stride * 4
                end = (offset + min(len(data) // 4, stride)) / rate
                yield recognize_region(refiner, samples, rate, origin, offset / rate, end), offset / rate, end
                if last:
                    break
                previous = data[(stride - context) * 4:stride * 4]
                data = data[stride * 4:] + process.stdout.read(stride * 4)
                offset += stride
            if process.wait():
                raise ValueError('FFmpeg 无法读取这个音视频文件。')
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.terminate()


def _file_units(windows):
    tail = []
    for owned, left, right in windows:
        if tail and (not owned or owned[0][1] - tail[-1][2] > 1.5):
            yield ' '.join(w[0] for w in tail), tail[0][1], tail[-1][2]
            tail = []
        if not owned:
            continue
        spans = tail + owned
        tail = []
        parts = display_units(' '.join(w[0] for w in spans))
        bounds = timed_parts(parts, spans[0][1], spans[-1][2], spans)
        for index, (text, (start, end)) in enumerate(zip(parts, bounds)):
            # Only carry the unfinished unit at the cut. Complete sentences stream
            # immediately, and an unpunctuated monologue spans at most two windows.
            if (index == len(parts) - 1 and start >= left and right - end <= 1.5
                    and not text.rstrip('"”’').endswith(('.', '!', '?'))):
                tail = [w for w in spans if w[1] >= start]
            else:
                yield text, start, end
    if tail:
        yield ' '.join(w[0] for w in tail), tail[0][1], tail[-1][2]


def file_captions(path, refiner):
    with closing(_word_windows(path, refiner)) as windows:
        for sequence, (text, start, end) in enumerate(_file_units(windows), 1):
            yield {'id': f'sentence:{sequence}', 'revision': 1, 'final': True,
                   'start': round(start, 3), 'end': round(end, 3), 'text': text,
                   'paragraph': 1 + (sequence - 1) // 3}
