# GenreScope (POC)

Détection **en direct** du sous-genre musical (400 styles Discogs) à partir du micro, entièrement dans le navigateur.

## Lancer

```powershell
npm install
npm run setup   # copie ONNX Runtime + télécharge le modèle (~18 Mo)
npm start       # http://localhost:5173
```

> Sur téléphone, le micro n'est autorisé qu'en **HTTPS**. L'adresse réseau local (`http://192.168…`) ne suffit pas :
> déployez le dossier `public/` sur un hébergement HTTPS (Netlify, GitHub Pages, Cloudflare Pages…) ou passez par un tunnel HTTPS.

## Fonctionnement

```
micro → AudioWorklet (capture-worklet.js) → Worker (worker.js)
      → rééchantillonnage 16 kHz → normalisation du niveau
      → spectrogramme mel 128×96 (mel.js) → Discogs-EffNet (ONNX, WASM)
      → 400 probabilités → lissage + top 5 (app.js)
```

- Une analyse par seconde, sur les ~2 dernières secondes d'audio.
- `mel.js` reproduit `TensorflowInputMusiCNN` d'Essentia sans dépendre d'Essentia (AGPL). Vérification : `node scripts/check-mel.mjs`.
- `node scripts/check-model.mjs` teste le modèle hors navigateur sur un beat synthétique.

## Licences

- Modèle **Discogs-EffNet** (MTG-UPF) : **CC BY-NC-SA 4.0**, usage non commercial uniquement. Il faudra le remplacer pour un usage commercial.
- ONNX Runtime Web : MIT. Essentia.js n'est utilisé que pour le script de vérification, pas dans l'app.
