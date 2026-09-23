// Tile map: collision, ray casts and a pre-rendered static layer.
'use strict';

const TILE = 32;

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
  buildLayer() {
    const c = document.createElement('canvas');
    c.width = this.pw; c.height = this.ph;
    const g = c.getContext('2d');
    this._drawBackdrop(g);
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.tile(tx, ty);
        if (t === 1) this._drawWall(g, tx, ty);
        else if (t === 2) this._drawGirder(g, tx, ty);
      }
    this._drawLights(g);
    this.layer = c;
  }

  _drawBackdrop(g) {
    const grad = g.createLinearGradient(0, 0, 0, this.ph);
    grad.addColorStop(0, '#f3f6fb');
    grad.addColorStop(1, '#d9e1ee');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.pw, this.ph);
    // Wall panels.
    g.strokeStyle = 'rgba(150,165,190,0.35)';
    g.lineWidth = 2;
    for (let x = 0; x < this.pw; x += 96) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, this.ph); g.stroke(); }
    for (let y = 48; y < this.ph; y += 160) { g.beginPath(); g.moveTo(0, y); g.lineTo(this.pw, y); g.stroke(); }
    // The blue trim stripes of a clean, early-2000s lab.
    const stripe = (y, h, col) => { g.fillStyle = col; g.fillRect(0, y, this.pw, h); };
    stripe(TILE * 16 + 6, 7, '#5f8ee6'); stripe(TILE * 16 + 15, 2, '#a9c1f0');
    stripe(TILE * 7 + 4, 3, '#a9c1f0');
    // Observation windows.
    const windows = [[8, 3, 6, 4], [24, 3, 8, 4], [56, 11, 4, 3], [68, 6, 8, 4]];
    for (const [wx, wy, ww, wh] of windows) {
      const x = wx * TILE, y = wy * TILE, w = ww * TILE, h = wh * TILE;
      g.fillStyle = '#9fb0c8'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
      const wg = g.createLinearGradient(x, y, x + w, y + h);
      wg.addColorStop(0, '#2d4468'); wg.addColorStop(0.5, '#4d6f9f'); wg.addColorStop(1, '#253a5a');
      g.fillStyle = wg; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.35, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x - w * 0.1 + w * 0.0, y + h); g.closePath(); g.fill();
      g.strokeStyle = '#7e8fa8'; g.lineWidth = 3;
      for (let k = 1; k < ww / 2; k++) { g.beginPath(); g.moveTo(x + k * 64, y); g.lineTo(x + k * 64, y + h); g.stroke(); }
    }
    // Signage.
    g.font = 'bold 22px "Trebuchet MS", Verdana, sans-serif';
    g.textBaseline = 'middle';
    const sign = (x, y, text, bg, fg) => {
      const w = g.measureText(text).width + 24;
      g.fillStyle = bg; g.fillRect(x, y, w, 34);
      g.fillStyle = fg; g.fillText(text, x + 12, y + 18);
    };
    sign(3 * TILE, 9 * TILE, 'TEST CHAMBER 00', '#2f5fbf', '#ffffff');
    sign(44 * TILE, 12 * TILE, 'CAUTION: SUBJECT 09 NOT CONTAINED', '#f2c230', '#1b1b1b');
    sign(68 * TILE, 11 * TILE + 16, 'OBSERVATION', '#2f5fbf', '#ffffff');
    // Biohazard-ish marks.
    for (const [bx, by] of [[14, 15], [49, 16], [30, 6]]) {
      const x = bx * TILE, y = by * TILE;
      g.fillStyle = '#f2c230';
      g.beginPath(); g.moveTo(x, y - 24); g.lineTo(x + 26, y + 20); g.lineTo(x - 26, y + 20); g.closePath(); g.fill();
      g.fillStyle = '#1b1b1b'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
      g.fillText('!', x, y + 6); g.textAlign = 'left';
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
    const x = tx * TILE, y = ty * TILE;
    const e = this._exposed(tx, ty);
    const edge = e.up || e.down || e.left || e.right;
    g.fillStyle = edge ? '#e6ebf2' : '#cdd4df';
    g.fillRect(x, y, TILE, TILE);
    if (!edge) {
      g.fillStyle = 'rgba(120,135,160,0.18)';
      if (tx % 4 === 0) g.fillRect(x, y, 1, TILE);
      if (ty % 3 === 0) g.fillRect(x, y, TILE, 1);
      return;
    }
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(x + 3, y + 3, TILE - 6, 2);
    g.fillStyle = '#8d99ad';
    if (e.left) g.fillRect(x, y, 3, TILE);
    if (e.right) g.fillRect(x + TILE - 3, y, 3, TILE);
    if (e.down) g.fillRect(x, y + TILE - 3, TILE, 3);
    if (e.up) {
      g.fillStyle = '#ffffff'; g.fillRect(x, y, TILE, 2);
      g.fillStyle = '#4b7bd6'; g.fillRect(x, y + 2, TILE, 5);
      g.fillStyle = '#2d58ad'; g.fillRect(x, y + 7, TILE, 1);
    }
  }

  _drawGirder(g, tx, ty) {
    const x = tx * TILE, y = ty * TILE;
    g.fillStyle = '#7f8999';
    g.fillRect(x, y + 2, TILE, TILE - 4);
    g.fillStyle = '#b6bfcc'; g.fillRect(x, y, TILE, 5);
    g.fillStyle = '#566070'; g.fillRect(x, y + TILE - 5, TILE, 5);
    g.strokeStyle = '#5c6676'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + 2, y + 6); g.lineTo(x + TILE - 2, y + TILE - 6);
    g.moveTo(x + TILE - 2, y + 6); g.lineTo(x + 2, y + TILE - 6);
    g.stroke();
    g.fillStyle = '#d6dce5';
    g.fillRect(x + 4, y + 8, 3, 3); g.fillRect(x + TILE - 7, y + 8, 3, 3);
  }

  _drawLights(g) {
    for (let tx = 2; tx < this.w - 2; tx += 7) {
      for (let ty = 1; ty < this.h; ty++) {
        if (this.solid(tx, ty - 1) && !this.solid(tx, ty) && this.solid(tx + 1, ty - 1) && !this.solid(tx + 1, ty)) {
          const x = tx * TILE, y = ty * TILE;
          const glow = g.createRadialGradient(x + TILE, y, 4, x + TILE, y, 150);
          glow.addColorStop(0, 'rgba(255,255,245,0.55)');
          glow.addColorStop(1, 'rgba(255,255,245,0)');
          g.fillStyle = glow;
          g.fillRect(x + TILE - 150, y, 300, 150);
          g.fillStyle = '#9aa5b6'; g.fillRect(x + 4, y, TILE * 2 - 8, 8);
          g.fillStyle = '#ffffff'; g.fillRect(x + 8, y + 7, TILE * 2 - 16, 4);
          break;
        }
      }
    }
  }
}
