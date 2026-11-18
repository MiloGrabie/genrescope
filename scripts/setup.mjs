// Prépare les fichiers statiques : copie ONNX Runtime Web dans public/vendor
// et télécharge le modèle Discogs-EffNet (400 styles) depuis essentia.upf.edu.
import { mkdir, copyFile, writeFile, access } from 'fs/promises';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const vendor = join(root, 'public', 'vendor');
const models = join(root, 'public', 'models');
await mkdir(vendor, { recursive: true });
await mkdir(models, { recursive: true });

const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(ortDist, f), join(vendor, f));
  console.log('copié', f);
}

const BASE = 'https://essentia.upf.edu/models/feature-extractors/discogs-effnet/';
const exists = (p) => access(p).then(() => true, () => false);

const modelPath = join(models, 'discogs-effnet-bsdynamic-1.onnx');
if (!(await exists(modelPath))) {
  console.log('téléchargement du modèle (~18 Mo)…');
  const res = await fetch(BASE + 'discogs-effnet-bsdynamic-1.onnx');
  if (!res.ok) throw new Error('Échec du téléchargement du modèle : ' + res.status);
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
}

const meta = await (await fetch(BASE + 'discogs-effnet-bsdynamic-1.json')).json();
const labels = meta.classes.map((c) => {
  const [genre, style] = c.split('---');
  return { genre, style };
});
await writeFile(join(models, 'labels.json'), JSON.stringify(labels));
console.log(`OK : ${labels.length} styles. Lancez « npm start ».`);
