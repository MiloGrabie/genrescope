// Historique des analyses : stockage sur l'appareil + pile de cartes.
// Carte du dessus = analyse en direct ; derrière, les analyses passées (de la plus récente
// à la plus ancienne). Glisser à gauche ou toucher → carte suivante (plus ancienne),
// glisser à droite → carte précédente. Clavier : ← → et Début.

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

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  let text;
  if (s < 60) text = 'à l\'instant';
  else if (s < 3600) text = rtf.format(-Math.round(s / 60), 'minute');
  else if (s < 86400) text = rtf.format(-Math.round(s / 3600), 'hour');
  else text = rtf.format(-Math.round(s / 86400), 'day');
  return text[0].toUpperCase() + text.slice(1);
}
function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
}
function when(t) {
  return new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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

  function build(entry) {
    const el = document.createElement('section');
    el.className = 'result card past';
    const [best] = entry.top;
    el.innerHTML = `
      <div class="card-top"><p class="family"></p><span class="count"></span>
        <button class="del" type="button" aria-label="Supprimer cette analyse" title="Supprimer">×</button></div>
      <p class="style"></p>
      <p class="when"></p>
      <p class="status"></p>`;
    el.querySelector('.family').textContent = best.genre;
    el.querySelector('.style').textContent = best.style;
    el.querySelector('.when').textContent = when(entry.start);
    el.querySelector('.del').addEventListener('click', () => remove(entry));
    return el;
  }

  /** Place les cartes visibles dans la pile. `enter` : direction d'arrivée de la nouvelle carte du dessus. */
  function layout(enter = 0) {
    const all = keys();
    index = Math.min(Math.max(index, 0), all.length - 1);
    const visible = all.slice(index, index + VISIBLE);
    for (const [key, el] of cards) {
      if (visible.includes(key) || el.classList.contains('leaving')) continue;
      el.remove();
      if (key !== 'live') cards.delete(key);
    }
    visible.forEach((key, depth) => {
      let el = cards.get(key);
      if (!el) { el = build(entryOf(key)); cards.set(key, el); }
      el.classList.remove('leaving');
      const isNew = !el.isConnected;
      el.dataset.depth = depth;
      el.style.zIndex = String(VISIBLE - depth);
      el.inert = depth > 0;
      if (isNew) {
        root.append(el);
        if (depth === 0 && enter) {
          // Arrive de l'extérieur de l'écran puis glisse à sa place
          el.style.transition = 'none';
          el.style.transform = `translateX(${enter * 120}%) rotate(${enter * 10}deg)`;
          void el.offsetWidth;
          el.style.transition = '';
        }
      }
      el.style.transform = '';
      const count = el.querySelector('.count');
      count.textContent = all.length > 1 ? `${index + depth + 1} / ${all.length}` : '';
      const entry = entryOf(key);
      // Couleurs en alternance : deux cartes voisines ne se ressemblent jamais
      if (entry) el.style.setProperty('--card-bg', COLORS[(index + depth - 1) % COLORS.length]);
      if (entry) el.querySelector('.status').textContent = `${ago(entry.end)} · écouté ${duration(entry.end - entry.start)}`;
    });
    root.classList.toggle('has-history', all.length > 1);
    onShow(entryOf(visible[0]));
  }

  /** Fait sortir la carte du dessus de l'écran (dir : -1 gauche, 1 droite). */
  function throwOut(dir) {
    const key = keys()[index];
    const el = cards.get(key);
    if (!el) return;
    el.classList.add('leaving');
    el.inert = true;
    el.style.transform = `translateX(${dir * 130}%) rotate(${dir * 14}deg)`;
    const done = () => {
      if (!el.classList.contains('leaving')) return; // revenue dans la pile entre-temps
      el.classList.remove('leaving');
      el.style.transform = '';
      el.remove();
      if (key !== 'live' && cards.get(key) === el) cards.delete(key);
    };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400); // au cas où la transition n'a pas lieu (animations réduites)
  }

  function next(dir = -1) {
    const total = keys().length;
    if (total < 2) return;
    throwOut(dir);
    if (index < total - 1) { index++; layout(); } else { index = 0; layout(-dir); } // fin : retour au direct
  }
  function prev() {
    if (index === 0) { snapBack(); return; }
    const el = front();
    index--;
    layout(1);
    if (el) el.style.transform = '';
  }
  function snapBack() {
    const el = front();
    if (el) { el.style.transition = ''; el.style.transform = ''; }
  }

  function remove(entry) {
    const pos = history.indexOf(entry);
    if (pos < 0) return;
    throwOut(-1);
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
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const el = front();
    if (!el || e.button > 0 || !el.contains(e.target) || e.target.closest('button, a')) return;
    drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, moving: false };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8 || keys().length < 2) return;
      drag.moving = true;
      root.setPointerCapture(e.pointerId);
      drag.el.style.transition = 'none';
    }
    // À la carte en direct, glisser à droite résiste (rien avant elle)
    drag.dx = index === 0 && dx > 0 ? dx * 0.25 : dx;
    drag.el.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 18}deg)`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, dx, moving, t } = drag;
    drag = null;
    el.style.transition = '';
    if (e.type === 'pointercancel') { snapBack(); return; }
    if (!moving) { next(-1); return; } // simple toucher
    const fast = Math.abs(dx) / (performance.now() - t) > 0.5 && Math.abs(dx) > 30;
    if (dx < 0 && (dx < -SWIPE_PX || fast)) next(-1);
    else if (dx > 0 && index > 0 && (dx > SWIPE_PX || fast)) prev();
    else snapBack();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    if (e.key === 'ArrowRight') next(-1);
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Home' && index) { index = 0; layout(1); }
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
    goLive() { if (index !== 0) { throwOut(-1); index = 0; layout(1); } },
    isLive: () => index === 0,
  };
}
