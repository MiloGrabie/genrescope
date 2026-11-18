// Catalogue des modèles. L'appli utilise DEFAULT_MODEL ; pour en tester un autre,
// change DEFAULT_MODEL ci-dessous.
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
