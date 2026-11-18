// Test hors navigateur : synthétise un beat « house » 125 BPM et vérifie les prédictions.
import * as ort from 'onnxruntime-web';
import { readFile } from 'fs/promises';
import { melFrame, FRAME, HOP, BANDS, SR } from '../public/mel.js';

const labels = JSON.parse(await readFile(new URL('../public/models/labels.json', import.meta.url)));
const session = await ort.InferenceSession.create(
  await readFile(new URL('../public/models/discogs-effnet-bsdynamic-1.onnx', import.meta.url)));
console.log('entrées', session.inputNames, 'sorties', session.outputNames);

const N = HOP * 127 + FRAME, x = new Float32Array(N), beat = 60 / 125 * SR;
for (let i = 0; i < N; i++) {
  const tb = (i % beat) / SR, t8 = (i % (beat / 2)) / SR, t = i / SR;
  const kick = Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 8);
  const hat = (i % beat) > beat / 2 ? (Math.random() - 0.5) * Math.exp(-t8 * 60) : 0;
  const bass = 0.3 * Math.sign(Math.sin(2 * Math.PI * 55 * t)) * ((i % beat) > beat / 2 ? 1 : 0.2);
  const chord = 0.1 * [220, 261.6, 329.6].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0);
  x[i] = 0.5 * kick + 0.2 * hat + 0.2 * bass + chord;
}
const mel = new Float32Array(128 * BANDS);
for (let f = 0; f < 128; f++) mel.set(melFrame(x.subarray(f * HOP, f * HOP + FRAME)), f * BANDS);
const t0 = performance.now();
const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', mel, [1, 128, BANDS]) });
console.log('inférence', (performance.now() - t0).toFixed(0), 'ms');
const p = out[session.outputNames[0]].data;
[...p].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 8)
  .forEach(([v, i]) => console.log((v * 100).toFixed(1).padStart(5) + ' %', labels[i].genre, '›', labels[i].style));
