// AudioWorklet : récupère le signal du micro (mono) et l'envoie par blocs
// au worker d'analyse via un MessagePort dédié.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port2 = null;
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data.port) this.port2 = e.data.port; };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !this.port2) return true;
    const chans = input.length;
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < chans; c++) s += input[c][i];
      this.buf[this.n++] = s / chans;
      if (this.n === this.buf.length) {
        this.port2.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(2048);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
