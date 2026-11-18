// Compare src/mel.js avec TensorflowInputMusiCNN d'Essentia (référence).
import { createRequire } from 'module';
import { melFrame, FRAME } from '../public/mel.js';
const require = createRequire(import.meta.url);
const EssentiaWASM = require('essentia.js/dist/essentia-wasm.umd.js');
if (!EssentiaWASM.EssentiaJS) await new Promise(r => { EssentiaWASM.onRuntimeInitialized = r; });
const essentia = new EssentiaWASM.EssentiaJS(false);
let maxErr = 0, maxVal = 0;
for (let t = 0; t < 20; t++) {
  const x = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * (100 + t * 350) * i / 16000) + 0.1 * (Math.random() - 0.5);
  const ref = EssentiaWASM.vectorToArray(essentia.TensorflowInputMusiCNN(EssentiaWASM.arrayToVector(x)).bands);
  const mine = melFrame(x);
  for (let b = 0; b < 96; b++) { maxErr = Math.max(maxErr, Math.abs(ref[b] - mine[b])); maxVal = Math.max(maxVal, ref[b]); }
  if (t === 3) console.log('ref', Array.from(ref.slice(0, 6)).map(v => v.toFixed(4)), '\nmine', Array.from(mine.slice(0, 6)).map(v => v.toFixed(4)));
}
console.log('erreur max', maxErr.toFixed(5), '/ valeur max', maxVal.toFixed(3));
