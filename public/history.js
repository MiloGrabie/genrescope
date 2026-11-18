// Historique des analyses : stockage sur l'appareil + pile de cartes.
// Carte du dessus = analyse en direct ; derrière, les analyses passées (de la plus récente
// à la plus ancienne). Glisser à gauche ou toucher → la carte part à gauche et dévoile la
// suivante (plus ancienne) ; glisser à droite → la carte précédente revient de la gauche,
// sous le doigt. Clavier : → suivante, ← précédente, Début : retour au direct.

const KEY = 'history';
const MAX_ENTRIES = 500;   // ~300 octets par analyse : ~150 Ko au maximum, pas besoin de purge par date
const VISIBLE = 3;         // cartes dessinées dans la pile (la 1re + 2 qui dépassent)
const SWIPE_PX = 70;       // distance de glissement qui valide le changement de carte
const COLORS = ['var(--cyan)', 'var(--pink)', 'var(--green)'];

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list.filter((e) => e && e.id && Array.isArray(e.top) && e.top.length) : [];
  } catch { return []; }
}

function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}
/** « Aujourd'hui, 21:04 », « Hier, 21:04 », « Lundi, 21:04 » ou « 12 nov., 21:04 ». */
function when(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  let day;
  if (days === 0) day = 'Aujourd\'hui';
  else if (days === 1) day = 'Hier';
  else if (days < 7) day = d.toLocaleDateString('fr-FR', { weekday: 'long' });
  else day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
  return `${day[0].toUpperCase()}${day.slice(1)}, ${time}`;
}

/**
 * @param {{ root: HTMLElement, liveCard: HTMLElement, onShow: (entry: object|null) => void,
 *           onDelete: (restore: () => void) => void }} opts
 */
export function createStack({ root, liveCard, onShow, onDelete }) {
  let history = load(); // de la plus récente à la plus ancienne
  let liveId = null;    // analyse affichée par la carte en direct (pas de doublon dans la pile)
  let index = 0;        // position de la carte du dessus (0 = carte en direct)
  let dirty = false;    // modifications pas encore enregistrées
  const cards = new Map([['live', liveCard]]);
  liveCard.classList.add('card');

  const keys = () => ['live', ...history.filter((e) => e.id !== liveId).map((e) => String(e.id))];
  const entryOf = (key) => history.find((e) => String(e.id) === key) || null;
  const front = () => cards.get(keys()[index]);

  function save() {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX_ENTRIES))); } catch { /* stockage plein ou indisponible */ }
  }

  function cardFor(key) {
    let el = cards.get(key);
    if (el) return el;
    const entry = entryOf(key);
    el = document.createElement('section');
    el.className = 'result card past';
    el.innerHTML = `
      <div class="card-top"><p class="family"></p>
        <button class="del" type="button" aria-label="Supprimer cette analyse" title="Supprimer">×</button></div>
      <p class="style"></p>
      <p class="status"></p>`;
    el.querySelector('.family').textContent = entry.top[0].genre;
    el.querySelector('.style').textContent = entry.top[0].style;
    el.querySelector('.del').addEventListener('click', () => remove(entry));
    cards.set(key, el);
    return el;
  }

  /** Place les cartes visibles dans la pile. `enter` : côté d'où arrive la nouvelle carte du dessus. */
  function layout(enter = 0) {
    const all = keys();
    index = Math.min(Math.max(index, 0), all.length - 1);
    const visible = all.slice(index, index + VISIBLE);
    for (const [key, el] of cards) {
      if (visible.includes(key) || el.classList.contains('leaving') || el.classList.contains('incoming')) continue;
      el.remove();
      if (key !== 'live') cards.delete(key);
    }
    visible.forEach((key, depth) => {
      const el = cardFor(key);
      el.classList.remove('leaving', 'incoming');
      el.dataset.depth = depth;
      el.style.zIndex = String(VISIBLE - depth);
      el.inert = depth > 0;
      if (!el.isConnected) {
        root.append(el);
        if (depth === 0 && enter) {
          // Arrive de l'extérieur de l'écran puis glisse à sa place
          el.style.transition = 'none';
          el.style.transform = offscreen(enter);
          void el.offsetWidth;
        }
      }
      el.style.transition = '';
      el.style.transform = '';
      paint(el, key, index + depth);
    });
    root.classList.toggle('has-history', all.length > 1);
    onShow(entryOf(visible[0]));
  }

  /** Couleur (en alternance : deux cartes voisines ne se ressemblent jamais) et date. */
  function paint(el, key, pos) {
    const entry = entryOf(key);
    if (!entry) return;
    el.style.setProperty('--card-bg', COLORS[(pos - 1) % COLORS.length]);
    el.querySelector('.status').textContent = `${when(entry.start)} · écouté ${duration(entry.end - entry.start)}`;
  }

  const offscreen = (dir) => `translateX(${dir * 130}%) rotate(${dir * 14}deg)`;

  /** Fait sortir une carte de l'écran (dir : -1 gauche, 1 droite) puis la retire de la pile. */
  function throwOut(key, dir) {
    const el = cards.get(key);
    if (!el) return;
    el.classList.remove('incoming');
    el.classList.add('leaving');
    el.inert = true;
    el.style.transition = '';
    el.style.transform = offscreen(dir);
    const done = () => {
      if (!el.classList.contains('leaving')) return; // revenue dans la pile entre-temps
      el.classList.remove('leaving');
      el.remove();
      if (key !== 'live' && cards.get(key) === el) cards.delete(key);
    };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 450); // au cas où la transition n'a pas lieu (animations réduites)
  }

  /** Carte suivante (plus ancienne) ; après la dernière, retour au direct. */
  function next() {
    const all = keys();
    if (all.length < 2) return;
    throwOut(all[index], -1);
    if (index < all.length - 1) { index++; layout(); } else { index = 0; layout(-1); }
  }
  /** Carte précédente : revient de la gauche, là où elle était partie. */
  function prev() {
    if (index === 0) return;
    index--;
    layout(-1);
  }
  function goTo(i) {
    if (i === index) return;
    throwOut(keys()[index], -1);
    index = i;
    layout(-1);
  }

  function remove(entry) {
    const pos = history.indexOf(entry);
    if (pos < 0) return;
    throwOut(String(entry.id), -1);
    history.splice(pos, 1);
    dirty = true;
    save();
    layout();
    onDelete(() => {
      history.splice(Math.min(pos, history.length), 0, entry);
      dirty = true;
      save();
      layout();
    });
  }

  // --- Glisser / toucher -------------------------------------------------------
  // « push » : la carte du dessus suit le doigt vers la gauche (carte suivante).
  // « pull » : vers la droite, la carte précédente revient de la gauche sous le doigt ;
  //            la carte du dessus ne bouge pas.
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const el = front();
    if (!el || e.button > 0 || !el.contains(e.target) || e.target.closest('button, a')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, mode: null };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8 || keys().length < 2) return;
      try { root.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      if (dx > 0 && index > 0) {
        drag.mode = 'pull';
        drag.el = cardFor(keys()[index - 1]);
        paint(drag.el, keys()[index - 1], index - 1);
        drag.el.classList.remove('leaving');
        drag.el.classList.add('incoming');
        drag.el.dataset.depth = 0;
        drag.el.style.zIndex = String(VISIBLE + 1);
        if (!drag.el.isConnected) root.append(drag.el);
      } else {
        drag.mode = 'push';
        drag.el = front();
      }
      drag.el.style.transition = 'none';
    }
    if (drag.mode === 'pull') {
      // La carte part de hors écran (à gauche) et rejoint sa place quand le doigt a parcouru la largeur
      const w = root.offsetWidth * 1.3;
      drag.dx = Math.max(0, Math.min(dx, w));
      const x = drag.dx - w;
      drag.el.style.transform = `translateX(${x}px) rotate(${(x / w) * 14}deg)`;
    } else {
      // À la carte en direct, glisser à droite résiste (rien avant elle)
      drag.dx = index === 0 && dx > 0 ? dx * 0.25 : Math.min(dx, 40);
      drag.el.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 18}deg)`;
    }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, dx, mode, t } = drag;
    drag = null;
    if (!mode) { if (e.type === 'pointerup') next(); return; } // simple toucher
    const fast = Math.abs(dx) / (performance.now() - t) > 0.5 && Math.abs(dx) > 30;
    const ok = e.type === 'pointerup' && (Math.abs(dx) > SWIPE_PX || fast);
    if (mode === 'pull') {
      if (ok) prev();
      else throwOut(keys()[index - 1], -1); // repart à gauche
    } else if (ok && dx < 0) {
      next();
    } else {
      el.style.transition = '';
      el.style.transform = '';
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Home') goTo(0);
    else return;
    e.preventDefault();
  });

  // Historique modifié dans un autre onglet : on le recharge (sauf écoute en cours ici)
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || dirty || liveId) return;
    history = load();
    layout();
  });

  layout();

  return {
    save,
    /** Ajoute ou met à jour une analyse (la plus récente en tête). */
    upsert(entry) {
      const i = history.findIndex((e) => e.id === entry.id);
      if (i >= 0) history[i] = entry; else history.unshift(entry);
      dirty = true;
    },
    /** Analyse représentée par la carte en direct (null : nouvelle écoute). */
    setLive(id) { if (liveId !== id) { liveId = id; layout(); } },
    goLive: () => goTo(0),
    isLive: () => index === 0,
    /** Vrai s'il y a au moins une analyse passée derrière la carte en direct. */
    hasPast: () => keys().length > 1,
  };
}
