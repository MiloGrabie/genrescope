// Worker d'analyse : rééchantillonnage 16 kHz → spectrogramme mel → modèle ONNX (voir catalog.js).
import ort from './vendor/ort.wasm.min.mjs';
import { melFrame, SR, FRAME, HOP, BANDS } from './mel.js';

let model = null;                          // entrée de catalog.js, reçue avec le message « load »
let PATCH = 0;                             // trames par inférence
let WINDOW = 0;                            // échantillons nécessaires à 16 kHz
const STEP = SR;                           // une analyse par seconde de nouvel audio
const SILENCE_RMS = 0.003;                 // ≈ -50 dBFS
const TARGET_RMS = 0.12;                   // niveau proche d'un morceau masterisé
const MAX_GAIN = 40;

ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // build sans threads : mémoire non partagée, compatible iOS
ort.env.wasm.proxy = false;

let session = null;
let outputName = '';
let resampler = null;
let ring = new Float32Array(0);
let written = 0;      // total d'échantillons 16 kHz reçus
let sinceLast = 0;
let busy = false;
let generation = 0;   // identifiant de la session d'écoute, pour ignorer les résultats d'une écoute précédente

// --- Rééchantillonneur sinc fenêtré (streaming) ---------------------------
class Resampler {
  constructor(inRate, outRate) {
    this.ratio = inRate / outRate;
    this.passthrough = inRate === outRate;
    this.half = 16;
    this.fc = Math.min(1, 1 / this.ratio) * 0.95;
    this.buf = new Float32Array(0);
    this.pos = this.half; // position fractionnaire dans buf
  }
  kernel(x) {
    if (Math.abs(x) >= this.half) return 0;
    const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / this.half) + 0.08 * Math.cos((2 * Math.PI * x) / this.half);
    const a = Math.PI * this.fc * x;
    return this.fc * w * (x === 0 ? 1 : Math.sin(a) / a);
  }
  process(chunk) {
    if (this.passthrough) return chunk;
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    const out = [];
    while (this.pos + this.half < merged.length) {
      const c = Math.floor(this.pos), frac = this.pos - c;
      let s = 0;
      for (let k = -this.half + 1; k <= this.half; k++) s += merged[c + k] * this.kernel(k - frac);
      out.push(s);
      this.pos += this.ratio;
    }
    const keep = Math.floor(this.pos) - this.half;
    this.buf = merged.slice(keep);
    this.pos -= keep;
    return Float32Array.from(out);
  }
}

// --- Chargement du modèle avec progression ---------------------------------
async function loadModel(m) {
  model = m;
  PATCH = m.frames;
  WINDOW = HOP * (PATCH - 1) + FRAME;
  ring = new Float32Array(WINDOW);
  const res = await fetch(new URL(m.file, location.href));
  if (!res.ok) throw new Error(`Modèle ${m.name} introuvable (avez-vous lancé « npm run setup » ?)`);
  // Taille réelle du modèle décompressé : Content-Length est faux si le serveur compresse (gzip).
  const total = m.bytes;
  const reader = res.body.getReader();
  let bytes = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > bytes.length) {
      const bigger = new Uint8Array(Math.max(bytes.length * 2, got + value.length));
      bigger.set(bytes.subarray(0, got));
      bytes = bigger;
    }
    bytes.set(value, got);
    got += value.length;
    postMessage({ type: 'progress', value: Math.min(1, got / total) });
  }
  session = await ort.InferenceSession.create(bytes.subarray(0, got), { executionProviders: ['wasm'] });
  bytes = null;
  if (!session.outputNames.includes(m.output)) {
    throw new Error(`Sortie « ${m.output} » absente du modèle ${m.name} (${session.outputNames.join(', ')})`);
  }
  outputName = m.output;
  postMessage({ type: 'ready', seconds: WINDOW / SR });
}

// --- Réception audio -------------------------------------------------------
function push(samples) {
  for (let i = 0; i < samples.length; i++) ring[(written + i) % WINDOW] = samples[i];
  written += samples.length;
  sinceLast += samples.length;
  if (written >= WINDOW && sinceLast >= STEP && !busy) {
    sinceLast = 0;
    analyse();
  }
}

async function analyse() {
  busy = true;
  const gen = generation;
  try {
    // Fenêtre linéaire des ~2 dernières secondes
    const x = new Float32Array(WINDOW);
    const start = written % WINDOW;
    x.set(ring.subarray(start));
    x.set(ring.subarray(0, start), WINDOW - start);

    let sum = 0;
    for (let i = 0; i < WINDOW; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / WINDOW);
    if (rms < SILENCE_RMS) {
      postMessage({ type: 'silence', rms, gen });
      return;
    }
    // Normalisation du niveau : le micro capte bien plus bas qu'un fichier masterisé
    const gain = Math.min(MAX_GAIN, TARGET_RMS / rms);
    for (let i = 0; i < WINDOW; i++) x[i] *= gain;

    const mel = new Float32Array(PATCH * BANDS);
    const frame = new Float32Array(BANDS);
    for (let f = 0; f < PATCH; f++) mel.set(melFrame(x.subarray(f * HOP, f * HOP + FRAME), frame), f * BANDS);
    if (model.norm) {
      const { mean, scale } = model.norm;
      for (let i = 0; i < mel.length; i++) mel[i] = (mel[i] - mean) / scale;
    }

    const t0 = performance.now();
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', mel, [1, PATCH, BANDS]) });
    postMessage({
      type: 'prediction',
      activations: out[outputName].data,
      rms,
      gen,
      ms: Math.round(performance.now() - t0),
    });
  } catch (err) {
    postMessage({ type: 'error', message: String(err.message || err) });
  } finally {
    busy = false;
  }
}

onmessage = (e) => {
  const { type } = e.data;
  if (type === 'load') {
    loadModel(e.data.model).catch((err) => postMessage({ type: 'error', message: String(err.message || err) }));
  } else if (type === 'start') {
    generation = e.data.gen;
    resampler = new Resampler(e.data.sampleRate, SR);
    ring.fill(0);
    written = 0;
    sinceLast = 0;
    e.data.port.onmessage = (m) => push(resampler.process(m.data));
  }
};
