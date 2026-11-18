// Génère les icônes PNG de l'appli (sans dépendance) : carte rose penchée,
// bordure et ombre noires, barres d'égaliseur. Usage : node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

const CREAM = [0xff, 0xf4, 0xe0], INK = [0x11, 0x11, 0x11], PINK = [0xff, 0x6b, 0x9d];
const ANGLE = (-4 * Math.PI) / 180;

/** Couleur d'un point (coordonnées dans un repère 512×512). */
function colorAt(x, y) {
  // repère tourné centré sur l'icône
  const rot = (px, py) => {
    const dx = px - 256, dy = py - 256;
    return [dx * Math.cos(-ANGLE) - dy * Math.sin(-ANGLE), dx * Math.sin(-ANGLE) + dy * Math.cos(-ANGLE)];
  };
  const [u, v] = rot(x, y);
  const H = 150, BORDER = 14, SHADOW = 18;
  const inCard = Math.abs(u) <= H && Math.abs(v) <= H;
  if (inCard) {
    if (H - Math.abs(u) < BORDER || H - Math.abs(v) < BORDER) return INK;
    // barres d'égaliseur
    const bars = [0.45, 0.8, 1, 0.6, 0.35], bw = 30, gap = 18;
    const total = bars.length * bw + (bars.length - 1) * gap;
    const base = 90, maxH = 170;
    for (let i = 0; i < bars.length; i++) {
      const x0 = -total / 2 + i * (bw + gap);
      if (u >= x0 && u <= x0 + bw && v <= base && v >= base - bars[i] * maxH) return INK;
    }
    return PINK;
  }
  if (u - SHADOW >= -H && u - SHADOW <= H && v - SHADOW >= -H && v - SHADOW <= H) return INK;
  return CREAM;
}

function png(size) {
  const SS = 4; // suréchantillonnage pour l'anticrénelage
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(((x + (sx + 0.5) / SS) * 512) / size, ((y + (sy + 0.5) / SS) * 512) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [512, 192, 180]) {
  writeFileSync(new URL(`icon-${size}.png`, dir), png(size));
  console.log(`icon-${size}.png`);
}
