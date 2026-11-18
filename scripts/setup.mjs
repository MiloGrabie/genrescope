// Prépare les fichiers statiques : copie ONNX Runtime Web dans public/vendor
// et télécharge le modèle Discogs-EffNet (400 styles) depuis essentia.upf.edu.
import { mkdir, copyFile, writeFile, readFile, access, rm, stat } from 'fs/promises';
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

/** fetch avec délai large et plusieurs tentatives (le serveur du MTG est parfois lent à joindre). */
/** Le délai couvre aussi la lecture du corps : il faut l'allonger pour un gros fichier. */
async function fetchRetry(url, tries = 5, timeoutMs = 120_000) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw new Error(`Échec du téléchargement de ${url} : ${err.cause?.code || err.message}`);
      console.log(`tentative ${i}/${tries} échouée (${err.cause?.code || err.message}), nouvel essai dans ${i * 5} s…`);
      await new Promise((r) => setTimeout(r, i * 5000));
    }
  }
}

const modelPath = join(models, 'discogs-effnet-bsdynamic-1.onnx');
if (!(await exists(modelPath))) {
  console.log('téléchargement du modèle (~18 Mo)…');
  await writeFile(modelPath, await fetchRetry(BASE + 'discogs-effnet-bsdynamic-1.onnx'));
}

const meta = JSON.parse(await fetchRetry(BASE + 'discogs-effnet-bsdynamic-1.json'));
const labels = meta.classes.map((c) => {
  const [genre, style] = c.split('---');
  return { genre, style };
});
await writeFile(join(models, 'labels.json'), JSON.stringify(labels));

// Modèles de test (à activer via DEFAULT_MODEL dans public/catalog.js), seulement avec « npm run setup -- --maest ».
// Non bloquant : en cas d'échec, l'appli fonctionne avec le modèle par défaut.
if (process.argv.includes('--maest')) {
  const maestPath = join(models, 'discogs-maest-5s-pw-2.onnx');
  const local = join(root, 'bench', 'models', 'discogs-maest-5s-pw-2.onnx');
  try {
    const FULL = 343373202; // taille complète : une copie partielle (téléchargement en cours) est refusée
    const complete = async (p) => (await exists(p)) && (await stat(p)).size === FULL;
    if (await complete(maestPath)) { /* déjà là */ }
    else if (await complete(local)) { await copyFile(local, maestPath); console.log('copié MAEST 5 s depuis bench/models'); }
    else {
      console.log('téléchargement de MAEST 5 s (~330 Mo)…');
      const buf = await fetchRetry('https://essentia.upf.edu/models/feature-extractors/maest/discogs-maest-5s-pw-2.onnx', 3, 15 * 60_000);
      if (buf.length !== FULL) throw new Error(`taille inattendue (${buf.length} octets)`);
      await writeFile(maestPath, buf);
    }
  } catch (err) {
    console.warn(`MAEST 5 s non installé (${err.message}) : il ne pourra pas être testé.`);
  }
}
console.log(`OK : ${labels.length} styles. Lancez « npm start ».`);
