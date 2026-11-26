// A silent analysis branch. Original audio has its own direct playback branch.
class NimDayduPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = Math.min(16000, sampleRate);
    this.size = Math.round(this.rate * 0.08);
    this.inputCount = 0;
    this.outputCount = 0;
    this.history = new Float32Array(64);
    // Low-pass before sampling. Playback and PCM share one hardware clock.
    const cutoff = .46 * this.rate / sampleRate;
    this.filters = Array.from({ length: 128 }, (_, phase) => {
      const taps = Array.from({ length: 64 }, (_, j) => {
        const x = j - 31 - phase / 128;
        const window = .42 - .5 * Math.cos(2 * Math.PI * j / 63) + .08 * Math.cos(4 * Math.PI * j / 63);
        return window * (x ? Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x) : 2 * cutoff);
      });
      const sum = taps.reduce((a, b) => a + b, 0);
      return Float32Array.from(taps, value => value / sum);
    });
    this.buffer = new Float32Array(this.size);
    this.position = 0;
    this.offset = 0;
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    for (let i = 0; i < outputs[0][0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      sample /= channels.length || 1;
      const index = this.inputCount++;
      this.history[index & 63] = sample;
      const next = this.outputCount * sampleRate / this.rate;
      if (index < Math.ceil(next)) continue;
      this.outputCount++;
      if (this.rate !== sampleRate) {
        sample = 0;
        const taps = this.filters[Math.min(127, Math.floor((index - next) * 128))];
        for (let j = 0; j < taps.length; j++) sample += taps[j] * this.history[(index - j) & 63];
      }
      this.buffer[this.position++] = Math.max(-1, Math.min(1, sample));
      if (this.position === this.size) {
        this.port.postMessage({ samples: this.buffer.buffer, offset: this.offset }, [this.buffer.buffer]);
        this.offset += this.size;
        this.buffer = new Float32Array(this.size);
        this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('nimdaydu-pcm', NimDayduPCM);
