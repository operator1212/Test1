// Low-res pixel rendering helpers: packed colours, a software framebuffer
// for sprites/particles, and a tiny 3x5 bitmap font.
'use strict';

// Colours are packed as 0xAABBGGRR (little-endian ImageData order).
function rgba(r, g, b, a = 255) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function hexc(h, a = 255) {
  const n = parseInt(h.slice(1), 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}
function cR(c) { return c & 255; }
function cG(c) { return (c >>> 8) & 255; }
function cB(c) { return (c >>> 16) & 255; }
function mixc(c1, c2, t) {
  return rgba(
    Math.round(lerp(cR(c1), cR(c2), t)),
    Math.round(lerp(cG(c1), cG(c2), t)),
    Math.round(lerp(cB(c1), cB(c2), t)));
}
function shade(c, k) {
  return rgba(clamp(Math.round(cR(c) * k), 0, 255), clamp(Math.round(cG(c) * k), 0, 255), clamp(Math.round(cB(c) * k), 0, 255));
}
function cssc(c) { return `rgb(${cR(c)},${cG(c)},${cB(c)})`; }
const C_BLACK = rgba(0, 0, 0);

// Framebuffer in "art space" (1 unit = 1 screen pixel before upscaling).
class FrameBuffer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.h = 0;
    this.ox = 0; this.oy = 0;   // art-space coordinate of the top-left pixel
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  clear() { this.buf.fill(0); }

  put(x, y, c) {
    x = Math.floor(x) - this.ox; y = Math.floor(y) - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = c;
  }

  // Alpha blend over whatever is in the buffer (transparent pixels take the colour).
  blend(x, y, c, a) {
    x = Math.floor(x) - this.ox; y = Math.floor(y) - this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x, d = this.buf[i];
    if ((d >>> 24) === 0) { this.buf[i] = ((Math.round(a * 255) << 24) | (c & 0xffffff)) >>> 0; return; }
    this.buf[i] = mixc(d, c, a);
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      this.put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  disc(cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) this.put(x, y, c);
  }

  present(ctx) {
    this.ctx.putImageData(this.img, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
  }
}

// Fill a polygon given in art-space points (even-odd rule). alpha < 1 blends.
function fillPoly(fb, pts, c, alpha = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const n = pts.length;
  for (let y = Math.floor(y0); y <= y1; y++) {
    const py = y + 0.5;
    for (let x = Math.floor(x0); x <= x1; x++) {
      const px = x + 0.5;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (!inside) continue;
      if (alpha >= 1) fb.put(x, y, c); else fb.blend(x, y, c, alpha);
    }
  }
}

// ------------------------------------------------------------ 3x5 font
const FONT = {
  A: '.#.#.#####.##.#',
  B: '##.#.###.#.###.',
  C: '.###..#..#...##',
  D: '##.#.##.##.###.',
  E: '####..##.#..###',
  F: '####..##.#..#..',
  G: '.###..#.##.#.##',
  H: '#.##.#####.##.#',
  I: '###.#..#..#.###',
  J: '..#..#..##.#.#.',
  K: '#.##.###.#.##.#',
  L: '#..#..#..#..###',
  M: '#.########.##.#',
  N: '##.#.##.##.##.#',
  O: '.#.#.##.##.#.#.',
  P: '##.#.###.#..#..',
  Q: '.#.#.##.###..##',
  R: '##.#.###.#.##.#',
  S: '.###...#...###.',
  T: '###.#..#..#..#.',
  U: '#.##.##.##.####',
  V: '#.##.##.##.#.#.',
  W: '#.##.########.#',
  X: '#.##.#.#.#.##.#',
  Y: '#.##.#.#..#..#.',
  Z: '###..#.#.#..###',
  0: '####.##.##.####',
  1: '.#.##..#..#.###',
  2: '##...#.#.#..###',
  3: '##...#.#...###.',
  4: '#.##.####..#..#',
  5: '####..##...###.',
  6: '.###..####.####',
  7: '###..#.#..#..#.',
  8: '####.#####.####',
  9: '####.####..###.',
  '.': '.............#.',
  ',': '..........#.#..',
  ':': '....#.....#....',
  '!': '.#..#..#.....#.',
  '?': '##...#.#.....#.',
  '-': '......###......',
  '+': '....#.###.#....',
  '/': '..#..#.#.#..#..',
  '(': '.#.#..#..#...#.',
  ')': '.#...#..#..#.#.',
  "'": '.#..#..........',
  '%': '#.#..#.#.#..#.#',
  '>': '#...#...#.#.#..',
  '<': '..#.#.#...#...#',
  '=': '...###...###...',
  '_': '............###',
  '"': '#.##.#.........',
  '#': '#.#####.#####.#',
  '*': '#.#.#.#.#......',
  '·': '.......#.......',
  ' ': '...............',
};

function textWidth(str, scale = 1) { return str.length ? (str.length * 4 - 1) * scale : 0; }

function pixelText(ctx, str, x, y, color, scale = 1) {
  ctx.fillStyle = color;
  x = Math.round(x); y = Math.round(y);
  for (const ch0 of String(str)) {
    const ch = ch0 === '—' ? '-' : ch0.toUpperCase();
    const g = FONT[ch] || FONT['?'];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++)
        if (g[r * 3 + c] === '#') ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
    x += 4 * scale;
  }
}

function pixelTextShadow(ctx, str, x, y, color, scale = 1, shadow = '#000') {
  pixelText(ctx, str, x + scale, y + scale, shadow, scale);
  pixelText(ctx, str, x, y, color, scale);
}
