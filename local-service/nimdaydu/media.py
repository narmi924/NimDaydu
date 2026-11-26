"""Decode a selected local recording in bounded, overlapping acoustic windows."""
import shutil
import subprocess

import numpy as np

from .refinement import recognize_region
from .segmentation import display_units, timed_parts


def file_captions(path, refiner):
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('文件转录需要 FFmpeg。请安装 FFmpeg 后重启本机服务。')
    rate, stride, context = 16000, 12 * 16000, 16000
    with subprocess.Popen([ffmpeg, '-nostdin', '-loglevel', 'error', '-i', str(path), '-vn',
                           '-ac', '1', '-ar', str(rate), '-f', 'f32le', 'pipe:1'],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        offset = sequence = 0
        previous = b''
        try:
            data = process.stdout.read((stride + context) * 4)
            while data:
                samples = np.frombuffer(previous + data, dtype='<f4')
                origin = (offset - len(previous) // 4) / rate
                last = len(data) <= stride * 4
                end = (offset + min(len(data) // 4, stride)) / rate
                owned = recognize_region(refiner, samples, rate, origin, offset / rate, end)
                if owned:
                    parts = display_units(' '.join(w[0] for w in owned))
                    for part, (start, end) in zip(parts, timed_parts(parts, owned[0][1], owned[-1][2], owned)):
                        sequence += 1
                        yield {'id': f'sentence:{sequence}', 'revision': 1, 'final': True,
                               'start': round(start, 3), 'end': round(end, 3), 'text': part,
                               'paragraph': 1 + (sequence - 1) // 3}
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
