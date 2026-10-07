import struct

import numpy as np
import pytest

from nimdaydu.protocol import FrameOrder, parse_frame


def frame(sequence=0, offset=0, samples=None):
    samples = np.zeros(1280, dtype='<f4') if samples is None else np.array(samples, dtype='<f4')
    return struct.pack('<IQ', sequence, offset) + samples.tobytes()


def test_packet_preserves_sequence_64_bit_offset_and_real_samples():
    parsed = parse_frame(frame(9, 2**40, [0.25, -0.5, 0.75]), 16000)
    assert (parsed.sequence, parsed.offset) == (9, 2**40)
    assert parsed.samples.tolist() == [0.25, -0.5, 0.75]


@pytest.mark.parametrize('data', [b'bad', frame(samples=[float('nan')]), frame(samples=[1.5]), b'\0' * 16016], ids=['short', 'nan', 'out-of-range', 'oversize'])
def test_rejects_malformed_nonfinite_out_of_range_or_oversize_audio(data):
    with pytest.raises(ValueError):
        parse_frame(data, 16000)


def test_gap_is_rejected_but_pause_can_skip_time_without_skipping_sequence():
    order = FrameOrder()
    order.accept(parse_frame(frame(), 16000))
    with pytest.raises(ValueError):
        order.accept(parse_frame(frame(1, 2560), 16000))
    order.resume()
    order.accept(parse_frame(frame(1, 160000), 16000))
    with pytest.raises(ValueError):
        order.accept(parse_frame(frame(3, 161280), 16000))
