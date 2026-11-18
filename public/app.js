// Interface : capture micro, envoi au worker, lissage et affichage des styles.
const TOP_N = 5;
const SMOOTHING = 0.35;      // poids de la nouvelle prédiction (moyenne mobile exponentielle)
const MIN_CONFIDENCE = 0.08; // en dessous : « incertain »

// Pondération : un passage calme (break, intro) ou une analyse hésitante pèse moins.
const LOUDNESS_DECAY = 0.99;  // la référence de volume redescend de ~2,6 dB en 30 s
const FULL_WEIGHT_DB = -6;    // à -6 dB ou plus du volume de référence : poids plein
const ZERO_WEIGHT_DB = -15;   // à -15 dB ou moins : ignoré
const CONFIDENT = 0.3;        // activation max à partir de laquelle la confiance est pleine

const $ = (id) => document.getElementById(id);
const els = {
  family: $('family'), style: $('style'), status: $('status'),
  progress: $('progress'), progressBar: $('progressBar'),
  ranking: $('ranking'), viz: $('viz'), listen: $('listen'), listenLabel: $('listenLabel'),
};

let labels = [];
let smoothed = null;
let loudnessRef = 0; // volume de référence du morceau (pic avec décroissance lente)
let audio = null; // { ctx, stream, node, analyser, port, raf, wakeLock }

const worker = new Worker('./worker.js', { type: 'module' });
worker.onmessage = ({ data }) => {
  switch (data.type) {
    case 'progress':
      els.progressBar.style.width = `${Math.round(data.value * 100)}%`;
      els.status.textContent = `Chargement du modèle… ${Math.round(data.value * 100)} %`;
      break;
    case 'ready':
      els.progress.classList.add('hidden');
      els.status.textContent = 'Appuie sur « Écouter » près d\'une source musicale';
      els.listen.disabled = false;
      break;
    case 'silence':
      if (audio) {
        loudnessRef *= LOUDNESS_DECAY;
        els.status.textContent = smoothed
          ? 'Passage calme : résultat conservé'
          : 'Trop calme : approche le téléphone de la musique';
      }
      break;
    case 'prediction':
      if (audio) render(data.activations, data.rms, data.ms);
      break;
    case 'error':
      els.status.textContent = `Erreur : ${data.message}`;
      break;
  }
};

fetch('./models/labels.json').then((r) => r.json()).then((l) => { labels = l; });
worker.postMessage({ type: 'load' });

/** Poids (0 à 1) d'une analyse selon son volume relatif et la confiance du modèle. */
function weightOf(activations, rms) {
  loudnessRef = Math.max(rms, loudnessRef * LOUDNESS_DECAY);
  const db = 20 * Math.log10(rms / loudnessRef);
  const energy = Math.min(1, Math.max(0, (db - ZERO_WEIGHT_DB) / (FULL_WEIGHT_DB - ZERO_WEIGHT_DB)));
  let max = 0;
  for (const v of activations) if (v > max) max = v;
  const confidence = Math.min(1, Math.max(0.1, max / CONFIDENT));
  return energy * confidence;
}

function render(activations, rms, ms) {
  const weight = weightOf(activations, rms);
  if (!smoothed) smoothed = Float32Array.from(activations);
  else {
    const alpha = SMOOTHING * weight;
    for (let i = 0; i < smoothed.length; i++) smoothed[i] += alpha * (activations[i] - smoothed[i]);
  }

  const top = Array.from(smoothed, (v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, TOP_N);
  const [bestScore, bestIdx] = top[0];
  const best = labels[bestIdx];

  if (bestScore < MIN_CONFIDENCE) {
    els.family.textContent = '';
    els.style.textContent = 'Incertain…';
  } else {
    els.family.textContent = best.genre;
    els.style.textContent = best.style;
  }
  els.status.textContent = weight < 0.25
    ? 'Passage calme : résultat conservé'
    : `Analyse en direct · ${ms} ms`;

  // Activations indépendantes (sigmoïdes) : % = confiance du modèle, barre relative au 1er.
  els.ranking.replaceChildren(...top.map(([v, i]) => {
    const li = document.createElement('li');
    const pct = Math.round(v * 100);
    const width = Math.round((v / bestScore) * 100);
    li.innerHTML = `<span class="name"></span><span class="pct">${pct} %</span><div class="bar"><div style="width:${width}%"></div></div>`;
    li.querySelector('.name').append(labels[i].style, Object.assign(document.createElement('small'), { textContent: labels[i].genre }));
    return li;
  }));
}

async function start() {
  els.listen.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule('./capture-worklet.js');
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'capture', { numberOfOutputs: 0 });
    const analyser = Object.assign(ctx.createAnalyser(), { fftSize: 256, smoothingTimeConstant: 0.7 });
    source.connect(node);
    source.connect(analyser);
    await ctx.resume();

    const { port1, port2 } = new MessageChannel();
    node.port.postMessage({ port: port1 }, [port1]);
    worker.postMessage({ type: 'start', sampleRate: ctx.sampleRate, port: port2 }, [port2]);

    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* facultatif */ }

    audio = { ctx, stream, node, analyser, wakeLock, raf: 0 };
    smoothed = null;
    loudnessRef = 0;
    els.listen.setAttribute('aria-pressed', 'true');
    els.listenLabel.textContent = 'Arrêter';
    els.status.textContent = 'Écoute… premier résultat dans ~2 s';
    drawViz();
  } catch (err) {
    els.status.textContent = err.name === 'NotAllowedError'
      ? 'Accès au micro refusé : autorise-le dans les réglages du navigateur'
      : `Impossible d'accéder au micro : ${err.message}`;
  } finally {
    els.listen.disabled = false;
  }
}

function stop() {
  if (!audio) return;
  cancelAnimationFrame(audio.raf);
  audio.stream.getTracks().forEach((t) => t.stop());
  audio.node.disconnect();
  audio.ctx.close();
  audio.wakeLock?.release().catch(() => {});
  audio = null;
  els.listen.setAttribute('aria-pressed', 'false');
  els.listenLabel.textContent = 'Écouter';
  els.status.textContent = 'En pause';
  const c = els.viz.getContext('2d');
  c.clearRect(0, 0, els.viz.width, els.viz.height);
}

function drawViz() {
  const canvas = els.viz;
  const c = canvas.getContext('2d');
  const data = new Uint8Array(audio.analyser.frequencyBinCount);
  const loop = () => {
    if (!audio) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    audio.analyser.getByteFrequencyData(data);
    c.clearRect(0, 0, w, h);
    const bars = 48, gap = 2 * dpr, bw = (w - gap * (bars - 1)) / bars;
    c.fillStyle = '#111';
    for (let i = 0; i < bars; i++) {
      const v = data[Math.floor((i / bars) ** 1.6 * data.length)] / 255;
      const bh = Math.max(3 * dpr, v * (h - 8 * dpr));
      c.fillRect(i * (bw + gap), h - bh, bw, bh);
    }
    audio.raf = requestAnimationFrame(loop);
  };
  loop();
}

els.listen.addEventListener('click', () => (audio ? stop() : start()));
document.addEventListener('visibilitychange', () => {
  // Le wake lock est libéré quand l'onglet passe en arrière-plan : on le redemande au retour.
  if (audio && document.visibilityState === 'visible' && navigator.wakeLock) {
    navigator.wakeLock.request('screen').then((l) => { audio.wakeLock = l; }).catch(() => {});
  }
});
