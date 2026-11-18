// Catalogue des modèles. Le premier est celui de tout le monde ; les autres ne sont
// accessibles que par le menu caché (7 tapes rapides sur le titre), choix mémorisé
// dans le navigateur uniquement : les autres utilisateurs ne sont pas affectés.
// Tous partagent la même entrée (mel 96 bandes de mel.js) et les 400 styles de labels.json.
export const MODELS = [
  {
    id: 'effnet',
    name: 'Discogs-EffNet',
    note: '17 Mo · fenêtre 2 s',
    file: './models/discogs-effnet-bsdynamic-1.onnx',
    bytes: 18027718,              // taille réelle (Content-Length faux si le serveur compresse)
    frames: 128,                  // ~2,06 s
    output: 'activations',
  },
  {
    id: 'maest-5s',
    name: 'MAEST 5 s',
    note: '330 Mo · fenêtre 5 s · lourd',
    file: './models/discogs-maest-5s-pw-2.onnx',
    bytes: 343373202,
    frames: 316,                  // ~5 s
    output: 'activations',        // sigmoïdes (la 1re sortie, « logits », n'est pas bornée)
    // Normalisation de TensorflowPredictMAEST (Essentia)
    norm: { mean: 2.06755686098554, scale: 1.268292820667291 * 2 },
  },
];

export const DEFAULT_MODEL = MODELS[0];
const KEY = 'model';

export function chosenModel() {
  try { return MODELS.find((m) => m.id === localStorage.getItem(KEY)) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function chooseModel(id) {
  try {
    if (id === DEFAULT_MODEL.id) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id);
  } catch { /* stockage indisponible */ }
}
