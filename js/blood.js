// Blood droplets. Each drop lands on exactly one pixel: a wall/floor pixel in
// the persistent decal layer, or a pixel of a body sprite (staining it).
// Also general effects (sparks, smoke, flashes, floating text).
'use strict';

const BLOOD_PX = ['#7a0008', '#8e0a10', '#a3101a', '#6a0006', '#b01822'].map((c) => hexc(c));

class BloodSystem {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.w * ART_TILE; this.canvas.height = map.h * ART_TILE;
    this.ctx = this.canvas.getContext('2d');
    this.drops = [];
    this.max = 2600;
    this.stainFn = null;   // (x, y, colour) => true if a body pixel was stained
  }

  spawn(x, y, vx, vy, size, col) {
    if (this.drops.length >= this.max) this.drops.shift();
    const bg = Math.random() < 0.25;
    this.drops.push({
      x, y, vx, vy, size: size || rand(1, 2.2), age: 0,
      life: bg ? rand(0.12, 0.55) : rand(1.5, 3.5),
      bg, col: col || pick(BLOOD_PX),
    });
  }

  spray(x, y, dx, dy, count, speed, spread, size) {
    const a0 = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const a = a0 + rand(-spread, spread);
      const s = speed * rand(0.35, 1.1);
      this.spawn(x + rand(-2, 2), y + rand(-2, 2), Math.cos(a) * s, Math.sin(a) * s, size);
    }
  }

  burst(x, y, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = speed * Math.sqrt(Math.random());
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s - speed * 0.3, rand(1, 2.5));
    }
  }

  update(dt) {
    const m = this.map;
    const keep = [];
    for (const d of this.drops) {
      d.age += dt;
      d.vy += 1350 * dt;
      d.vx *= 0.996;
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
      if (m.solidPx(nx, ny)) {
        // Find the exact surface pixel along the path.
        const n = Math.max(1, Math.ceil(Math.hypot(nx - d.x, ny - d.y) / (PX * 0.5)));
        for (let k = 1; k <= n; k++) {
          const sx = d.x + (nx - d.x) * k / n, sy = d.y + (ny - d.y) * k / n;
          if (m.solidPx(sx, sy)) { this.stamp(sx, sy, d); break; }
        }
        continue;
      }
      if (d.age > 0.12 && Math.random() < 0.5 && this.stainFn && this.stainFn(nx, ny, d.col)) continue;
      d.x = nx; d.y = ny;
      d.life -= dt;
      if (d.life <= 0) { if (d.bg) this.stamp(d.x, d.y, d); continue; }
      if (d.x < 0 || d.y < 0 || d.x > m.pw || d.y > m.ph) continue;
      keep.push(d);
    }
    this.drops = keep;
  }

  // Paint the pixel the drop landed on (plus a neighbour or two for big drops).
  stamp(x, y, d) {
    const g = this.ctx;
    const px = Math.floor(x / PX), py = Math.floor(y / PX);
    g.fillStyle = cssc(d.col);
    g.fillRect(px, py, 1, 1);
    if (d.size > 1.6) {
      const sx = Math.abs(d.vx) > Math.abs(d.vy) ? sign(d.vx) : 0, sy = sx ? 0 : sign(d.vy);
      g.fillRect(px - sx, py - sy, 1, 1);
      if (Math.random() < 0.3) g.fillRect(px + randi(-1, 1), py + randi(-1, 1), 1, 1);
    }
  }

  scorch(x, y) {
    const g = this.ctx;
    g.fillStyle = 'rgba(25,16,12,0.3)';
    g.fillRect(Math.floor(x / PX) + randi(-1, 0), Math.floor(y / PX) + randi(-1, 0), 2, 2);
  }

  renderDecals(ctx, view) {
    ctx.drawImage(this.canvas, -view.x0, -view.y0);
  }

  renderDrops(fb) {
    for (const d of this.drops) {
      const x = d.x / PX, y = d.y / PX;
      fb.put(x, y, d.col);
      if (d.size > 2 && Math.abs(d.vy) > 200) fb.put(x - d.vx * 0.004, y - d.vy * 0.004, d.col);
    }
  }
}

class FX {
  constructor() { this.list = []; this.texts = []; }

  spark(x, y, vx, vy, life, color) {
    this.list.push({ kind: 'spark', x, y, vx, vy, life, max: life, color: hexc(color || '#ffe9a8') });
  }
  sparks(x, y, dx, dy, n, speed, color) {
    const a0 = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const a = a0 + rand(-1, 1), s = speed * rand(0.3, 1);
      this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.12, 0.35), color);
    }
  }
  smoke(x, y, size) {
    this.list.push({ kind: 'smoke', x, y, vx: rand(-15, 15), vy: rand(-50, -20), life: rand(0.5, 1), max: 1, size: size || rand(0.8, 1.6) });
  }
  flash(x, y, r, color) {
    this.list.push({ kind: 'flash', x, y, r, life: 0.07, max: 0.07, color: hexc(color || '#fff0c8') });
  }
  text(x, y, str, color) {
    this.texts.push({ x, y, str, color: color || '#fff', life: 1.4, max: 1.4 });
  }

  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      if (p.kind === 'spark') { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      else if (p.kind === 'smoke') { p.x += p.vx * dt; p.y += p.vy * dt; p.size += 1.5 * dt; }
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 30 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  render(fb) {
    const smokeC = hexc('#6a6a6a');
    for (const p of this.list) {
      const a = clamp(p.life / p.max, 0, 1);
      const x = p.x / PX, y = p.y / PX;
      if (p.kind === 'spark') {
        fb.line(x, y, x - p.vx * 0.012, y - p.vy * 0.012, p.color);
      } else if (p.kind === 'smoke') {
        const r = p.size, r2 = r * r;
        for (let yy = Math.floor(y - r); yy <= y + r; yy++)
          for (let xx = Math.floor(x - r); xx <= x + r; xx++)
            if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r2) fb.blend(xx, yy, smokeC, a * 0.25);
      } else if (p.kind === 'flash') {
        const r = p.r / PX;
        for (let yy = Math.floor(y - r); yy <= y + r; yy++)
          for (let xx = Math.floor(x - r); xx <= x + r; xx++)
            if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r) fb.blend(xx, yy, p.color, a * 0.8);
      }
    }
  }

  renderText(ctx, view) {
    for (const t of this.texts) {
      if (t.life < t.max * 0.25 && Math.floor(t.life * 20) % 2) continue;   // blink out
      const w = textWidth(t.str);
      pixelTextShadow(ctx, t.str, Math.round(t.x / PX - view.x0 - w / 2), Math.round(t.y / PX - view.y0), t.color);
    }
  }
}
