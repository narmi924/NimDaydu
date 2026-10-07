// A silent analysis branch. Original audio has its own direct playback branch.
class NimDayduPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.08);
    this.buffer = new Float32Array(this.size);
    this.position = 0;
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.position++] = sample / channels.length;
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
