// Tile map: collision, ray casts and a pre-rendered static layer.
'use strict';

const TILE = 32;          // world units per tile (physics scale)
const ART_TILE = 12;      // screen pixels per tile (art scale)
const PX = TILE / ART_TILE;  // world units per art pixel

// Legend:  # lab wall   = steel girder   P player   G guard dummy   S scientist
const TEST_MAP = [
  '################################################################################',
  '#...................................................##...........###############',
  '#...................................................##...........###############',
  '#...................................................##...........###############',
  '#...................................................##...........###############',
  '#...................................................##.........................#',
  '#...................................................##.........................#',
  '#...................................................##.........................#',
  '#..............................................G....##.........................#',
  '#............................................======.##.........................#',
  '#..............................................................................#',
  '#..............................................................................#',
  '#======........................G...............................................#',
  '#.........................===========..........................................#',
  '#.......................................................................S......#',
  '#.......................................####.....................###############',
  '#.......................................####.....................###############',
  '#...................##..................####................##...###############',
  '#...................##...............##.####................####################',
  '#...P.............G.##...............##G####...............G####################',
  '################################################################################',
  '################################################################################',
  '################################################################################',
  '################################################################################',
];

class TileMap {
  constructor(rows) {
    this.h = rows.length;
    this.w = rows[0].length;
    this.pw = this.w * TILE;
    this.ph = this.h * TILE;
    this.tiles = new Uint8Array(this.w * this.h);
    this.spawns = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ch = rows[y][x] || '.';
        let t = 0;
        if (ch === '#') t = 1;
        else if (ch === '=') t = 2;
        else if (ch === 'P' || ch === 'G' || ch === 'S') {
          this.spawns.push({ type: ch, x: x * TILE + TILE / 2, y: (y + 1) * TILE });
        }
        this.tiles[y * this.w + x] = t;
      }
    }
    this.layer = null;
  }

  tile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 1;
    return this.tiles[ty * this.w + tx];
  }
  solid(tx, ty) { return this.tile(tx, ty) !== 0; }
  solidPx(x, y) { return this.solid(Math.floor(x / TILE), Math.floor(y / TILE)); }

  // First solid surface directly below (x, y), or null if none within maxDist.
  groundBelow(x, y, maxDist) {
    const tx = Math.floor(x / TILE);
    const ty0 = Math.floor(y / TILE);
    if (this.solid(tx, ty0)) return null;
    const ty1 = Math.floor((y + maxDist) / TILE);
    for (let ty = ty0 + 1; ty <= ty1; ty++) {
      if (this.solid(tx, ty)) return ty * TILE;
    }
    return null;
  }

  // DDA ray cast. (dx, dy) must be normalized.
  raycast(x0, y0, dx, dy, maxLen) {
    let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    if (this.solid(tx, ty)) return { hit: true, x: x0, y: y0, dist: 0, nx: -dx, ny: -dy, tx, ty };
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - x0) / dx : dx < 0 ? (tx * TILE - x0) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - y0) / dy : dy < 0 ? (ty * TILE - y0) / dy : Infinity;
    let t = 0, nx = 0, ny = 0;
    for (let i = 0; i < 512; i++) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; nx = -stepX; ny = 0; }
      else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; nx = 0; ny = -stepY; }
      if (t > maxLen) break;
      if (this.solid(tx, ty)) return { hit: true, x: x0 + dx * t, y: y0 + dy * t, dist: t, nx, ny, tx, ty };
    }
    return { hit: false, x: x0 + dx * maxLen, y: y0 + dy * maxLen, dist: maxLen, nx: 0, ny: 0 };
  }

  // Push a circle {x, y, r} out of solid tiles. Returns the last contact normal or null.
  pushCircle(p) {
    const r = p.r;
    let normal = null;
    const tx0 = Math.floor((p.x - r) / TILE), tx1 = Math.floor((p.x + r) / TILE);
    const ty0 = Math.floor((p.y - r) / TILE), ty1 = Math.floor((p.y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.solid(tx, ty)) continue;
        const left = tx * TILE, top = ty * TILE;
        const cx = clamp(p.x, left, left + TILE), cy = clamp(p.y, top, top + TILE);
        const dx = p.x - cx, dy = p.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          p.x += nx * (r - d); p.y += ny * (r - d);
          normal = { x: nx, y: ny };
        } else {
          // Center is inside the tile: leave through the nearest open face.
          const opts = [
            { d: p.x - left, nx: -1, ny: 0, open: !this.solid(tx - 1, ty) },
            { d: left + TILE - p.x, nx: 1, ny: 0, open: !this.solid(tx + 1, ty) },
            { d: p.y - top, nx: 0, ny: -1, open: !this.solid(tx, ty - 1) },
            { d: top + TILE - p.y, nx: 0, ny: 1, open: !this.solid(tx, ty + 1) },
          ];
          let best = null;
          for (const o of opts) {
            if (!best || (o.open && !best.open) || (o.open === best.open && o.d < best.d)) best = o;
          }
          p.x += best.nx * (best.d + r); p.y += best.ny * (best.d + r);
          normal = { x: best.nx, y: best.ny };
        }
      }
    }
    return normal;
  }

  // Does an axis-aligned box overlap any solid tile?
  boxSolid(x0, y0, x1, y1) {
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 0.001) / TILE);
    const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 0.001) / TILE);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (this.solid(tx, ty)) return true;
    return false;
  }

  // ---------------------------------------------------------------- rendering
  // Everything below draws at art resolution (1 unit = 1 pixel).
  buildLayer() {
    const A = ART_TILE;
    const c = document.createElement('canvas');
    c.width = this.w * A; c.height = this.h * A;
    const g = c.getContext('2d');
    this._drawBackdrop(g, c.width, c.height);
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.tile(tx, ty);
        if (t === 1) this._drawWall(g, tx, ty);
        else if (t === 2) this._drawGirder(g, tx, ty);
      }
    this._drawLights(g);
    this.layer = c;
  }

  _drawBackdrop(g, W, H) {
    const A = ART_TILE;
    g.fillStyle = '#e4e9f1'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#dce2eb'; g.fillRect(0, Math.floor(H * 0.55), W, H);
    // Grime speckle.
    g.fillStyle = '#d6dde8';
    for (let i = 0; i < W * H / 60; i++) g.fillRect(randi(0, W), randi(0, H), 1, 1);
    // Panels + rivets.
    g.fillStyle = '#cdd5e1';
    for (let x = 0; x < W; x += 36) g.fillRect(x, 0, 1, H);
    for (let y = 18; y < H; y += 60) g.fillRect(0, y, W, 1);
    g.fillStyle = '#b9c3d2';
    for (let x = 0; x < W; x += 36) for (let y = 18; y < H; y += 60) { g.fillRect(x + 3, y + 3, 1, 1); g.fillRect(x + 32, y + 3, 1, 1); }
    // Blue trim.
    g.fillStyle = '#5f8ee6'; g.fillRect(0, 16 * A + 3, W, 2);
    g.fillStyle = '#a9c1f0'; g.fillRect(0, 16 * A + 6, W, 1);
    g.fillStyle = '#a9c1f0'; g.fillRect(0, 7 * A + 2, W, 1);
    // Observation windows.
    for (const [wx, wy, ww, wh] of [[8, 3, 6, 4], [24, 3, 8, 4], [56, 11, 4, 3], [68, 6, 8, 4]]) {
      const x = wx * A, y = wy * A, w = ww * A, h = wh * A;
      g.fillStyle = '#8e9fb8'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle = '#2c4468'; g.fillRect(x, y, w, h);
      g.fillStyle = '#35517c'; g.fillRect(x, y + Math.floor(h / 2), w, Math.ceil(h / 2));
      g.fillStyle = '#4d6f9f';
      for (let k = 0; k < h; k++) { g.fillRect(x + 6 + k, y + h - 1 - k, 2, 1); g.fillRect(x + 12 + k, y + h - 1 - k, 1, 1); }
      g.fillStyle = '#7e8fa8';
      for (let k = 24; k < w; k += 24) g.fillRect(x + k, y, 1, h);
    }
    // Signs.
    const sign = (x, y, text, bg, fg) => {
      const w = textWidth(text) + 6;
      g.fillStyle = shadeCss(bg); g.fillRect(x, y + 1, w, 9);
      g.fillStyle = bg; g.fillRect(x, y, w, 9);
      pixelText(g, text, x + 3, y + 2, fg);
    };
    sign(3 * A, 9 * A, 'TEST CHAMBER 00', '#2f5fbf', '#ffffff');
    sign(44 * A, 12 * A, 'CAUTION: SUBJECT 09 NOT CONTAINED', '#f2c230', '#1b1b1b');
    sign(68 * A, 11 * A + 6, 'OBSERVATION', '#2f5fbf', '#ffffff');
    sign(14 * A, 13 * A, 'SPECIMEN TESTING', '#9fb0c8', '#1f2a3d');
    // Hazard triangles.
    for (const [bx, by] of [[14, 15], [49, 16], [30, 6]]) {
      const x = bx * A, y = by * A - 4;
      g.fillStyle = '#1b1b1b';
      for (let r = 0; r < 10; r++) g.fillRect(x - Math.floor(r * 0.55) - 1, y + r, Math.floor(r * 1.1) + 3, 1);
      g.fillStyle = '#f2c230';
      for (let r = 1; r < 9; r++) g.fillRect(x - Math.floor(r * 0.55), y + r, Math.floor(r * 1.1) + 1, 1);
      g.fillStyle = '#1b1b1b'; g.fillRect(x, y + 3, 1, 3); g.fillRect(x, y + 7, 1, 1);
    }
  }

  _exposed(tx, ty) {
    return {
      up: !this.solid(tx, ty - 1) && ty > 0,
      down: !this.solid(tx, ty + 1) && ty < this.h - 1,
      left: !this.solid(tx - 1, ty) && tx > 0,
      right: !this.solid(tx + 1, ty) && tx < this.w - 1,
    };
  }

  _drawWall(g, tx, ty) {
    const A = ART_TILE, x = tx * A, y = ty * A;
    const e = this._exposed(tx, ty);
    const edge = e.up || e.down || e.left || e.right;
    if (!edge) {
      g.fillStyle = '#c3ccd9'; g.fillRect(x, y, A, A);
      g.fillStyle = '#b5bfce';
      if (tx % 3 === 0) g.fillRect(x, y, 1, A);
      if (ty % 2 === 0) g.fillRect(x, y, A, 1);
      if ((tx * 7 + ty * 3) % 5 === 0) g.fillRect(x + 5, y + 5, 1, 1);
      return;
    }
    g.fillStyle = '#eef2f7'; g.fillRect(x, y, A, A);
    g.fillStyle = '#dfe5ee'; g.fillRect(x, y + 6, A, 6);
    g.fillStyle = '#ffffff'; g.fillRect(x + 1, y + 1, A - 2, 1);
    g.fillStyle = '#c9d1de'; g.fillRect(x + A - 1, y + 1, 1, A - 2);
    g.fillStyle = '#7f8ca2';
    if (e.left) g.fillRect(x, y, 1, A);
    if (e.right) g.fillRect(x + A - 1, y, 1, A);
    if (e.down) g.fillRect(x, y + A - 1, A, 1);
    if (e.up) {
      g.fillStyle = '#ffffff'; g.fillRect(x, y, A, 1);
      g.fillStyle = '#4b7bd6'; g.fillRect(x, y + 1, A, 2);
      g.fillStyle = '#2d58ad'; g.fillRect(x, y + 3, A, 1);
    }
  }

  _drawGirder(g, tx, ty) {
    const A = ART_TILE, x = tx * A, y = ty * A;
    g.fillStyle = '#7f8999'; g.fillRect(x, y + 1, A, A - 2);
    g.fillStyle = '#b6bfcc'; g.fillRect(x, y, A, 2);
    g.fillStyle = '#4d5666'; g.fillRect(x, y + A - 2, A, 2);
    g.fillStyle = '#5c6676';
    for (let k = 2; k < A - 2; k++) { g.fillRect(x + k, y + k, 1, 1); g.fillRect(x + A - 1 - k, y + k, 1, 1); }
    g.fillStyle = '#d6dce5'; g.fillRect(x + 1, y + 3, 1, 1); g.fillRect(x + A - 2, y + 3, 1, 1);
  }

  _drawLights(g) {
    const A = ART_TILE;
    for (let tx = 2; tx < this.w - 2; tx += 7) {
      for (let ty = 1; ty < this.h; ty++) {
        if (this.solid(tx, ty - 1) && !this.solid(tx, ty) && this.solid(tx + 1, ty - 1) && !this.solid(tx + 1, ty)) {
          const x = tx * A, y = ty * A;
          // Stepped pixel light cone.
          for (let k = 0; k < 4; k++) {
            g.fillStyle = `rgba(255,255,235,${0.12 - k * 0.025})`;
            const spread = 8 + k * 10, depth = 14 + k * 12;
            g.fillRect(x + A - spread, y + 3, spread * 2, depth);
          }
          g.fillStyle = '#8b96a8'; g.fillRect(x + 2, y, A * 2 - 4, 2);
          g.fillStyle = '#ffffff'; g.fillRect(x + 3, y + 2, A * 2 - 6, 1);
          break;
        }
      }
    }
  }
}

function shadeCss(hex) {
  const n = parseInt(hex.slice(1), 16);
  const k = 0.7;
  return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
}
