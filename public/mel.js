// Spectrogramme mel compatible avec TensorflowInputMusiCNN d'Essentia
// (16 kHz, trame 512, hop 256, 96 bandes slaney 0-8 kHz, log10(1 + 10000·x)).
// Implémentation autonome (pas de dépendance AGPL).

export const SR = 16000;
export const FRAME = 512;
export const HOP = 256;
export const BANDS = 96;
const NBINS = FRAME / 2 + 1;

function hzToMelSlaney(f) {
  const fSp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fSp, logStep = Math.log(6.4) / 27;
  return f < minLogHz ? f / fSp : minLogMel + Math.log(f / minLogHz) / logStep;
}
function melToHzSlaney(m) {
  const fSp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fSp, logStep = Math.log(6.4) / 27;
  return m < minLogMel ? m * fSp : minLogHz * Math.exp(logStep * (m - minLogMel));
}

// Fenêtre de Hann (non normalisée, comme TensorflowInputMusiCNN)
const WINDOW = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  return w;
})();

// Banc de filtres triangulaires (pondération linéaire en Hz, normalisation "unit_tri")
const FILTERS = (() => {
  const lo = hzToMelSlaney(0), hi = hzToMelSlaney(SR / 2);
  const edges = [];
  for (let i = 0; i < BANDS + 2; i++) edges.push(melToHzSlaney(lo + ((hi - lo) * i) / (BANDS + 1)));
  const binHz = SR / 2 / (NBINS - 1);
  const filters = [];
  for (let b = 0; b < BANDS; b++) {
    const [f0, f1, f2] = [edges[b], edges[b + 1], edges[b + 2]];
    const w = new Float32Array(NBINS);
    for (let k = 0; k < NBINS; k++) {
      const f = k * binHz;
      if (f >= f0 && f <= f1 && f1 > f0) w[k] = (f - f0) / (f1 - f0);
      else if (f > f1 && f <= f2 && f2 > f1) w[k] = (f2 - f) / (f2 - f1);
    }
    const norm = 2 / (f2 - f0);
    let start = NBINS, end = 0;
    for (let k = 0; k < NBINS; k++) { w[k] *= norm; if (w[k] > 0) { start = Math.min(start, k); end = k; } }
    filters.push({ start, end, w });
  }
  return filters;
})();

// FFT radix-2 réelle (via FFT complexe in-place)
const COS = new Float32Array(FRAME / 2), SIN = new Float32Array(FRAME / 2);
for (let i = 0; i < FRAME / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / FRAME); SIN[i] = -Math.sin((2 * Math.PI * i) / FRAME); }
const REV = new Uint16Array(FRAME);
for (let i = 0, bits = Math.log2(FRAME); i < FRAME; i++) {
  let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r;
}
const re = new Float32Array(FRAME), im = new Float32Array(FRAME), power = new Float32Array(NBINS);

function powerSpectrum(frame) {
  for (let i = 0; i < FRAME; i++) { re[REV[i]] = frame[i] * WINDOW[i]; im[REV[i]] = 0; }
  for (let size = 2; size <= FRAME; size <<= 1) {
    const half = size >> 1, step = FRAME / size;
    for (let s = 0; s < FRAME; s += size) {
      for (let j = 0; j < half; j++) {
        const c = COS[j * step], d = SIN[j * step], a = s + j, b = a + half;
        const tr = re[b] * c - im[b] * d, ti = re[b] * d + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let k = 0; k < NBINS; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

/** Calcule les bandes mel log-compressées d'une trame de 512 échantillons. */
export function melFrame(frame, out = new Float32Array(BANDS)) {
  const p = powerSpectrum(frame);
  for (let b = 0; b < BANDS; b++) {
    const { start, end, w } = FILTERS[b];
    let s = 0;
    for (let k = start; k <= end; k++) s += w[k] * p[k];
    out[b] = Math.log10(1 + 10000 * s);
  }
  return out;
}
