// Prépare les fichiers statiques : copie ONNX Runtime Web dans public/vendor
// et télécharge le modèle Discogs-EffNet (400 styles) depuis essentia.upf.edu.
import { mkdir, copyFile, writeFile, readFile, access, rm } from 'fs/promises';
import { join } from 'path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const vendor = join(root, 'public', 'vendor');
const models = join(root, 'public', 'models');
await rm(vendor, { recursive: true, force: true }); // repart d'un dossier propre
await mkdir(vendor, { recursive: true });
await mkdir(models, { recursive: true });

// ONNX Runtime Web 1.18 : dernière version avec un build WebAssembly sans threads.
// Les versions suivantes n'ont que le build multithread, qui réserve 4 Go de mémoire
// partagée au démarrage : Safari iOS refuse (« RangeError: Out of memory »).
const ortDist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
for (const f of ['ort-wasm-simd.wasm', 'ort-wasm.wasm']) {
  await copyFile(join(ortDist, f), join(vendor, f));
  console.log('copié', f);
}
// Le bundle 1.18 n'existe qu'en script classique : on l'emballe en module ES pour le worker.
const umd = await readFile(join(ortDist, 'ort.wasm.min.js'), 'utf8');
await writeFile(join(vendor, 'ort.wasm.min.mjs'),
  umd.replace(/\/\/# sourceMappingURL=.*$/m, '') + '\nexport default ort;\n');
console.log('généré ort.wasm.min.mjs');

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
