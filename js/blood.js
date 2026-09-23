// Blood droplets that splat into a persistent world-sized decal layer,
// plus general-purpose effects (sparks, smoke, floating text).
'use strict';

const BLOOD_COLORS = ['#7a0008', '#8e0a10', '#a3101a', '#6a0006', '#b01822'];

class BloodSystem {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = map.pw; this.canvas.height = map.ph;
    this.ctx = this.canvas.getContext('2d');
    this.drops = [];
    this.max = 2600;
  }

  spawn(x, y, vx, vy, size) {
    if (this.drops.length >= this.max) this.drops.shift();
    const bg = Math.random() < 0.28;
    this.drops.push({
      x, y, vx, vy, size: size || rand(1.5, 3.2),
      life: bg ? rand(0.12, 0.55) : rand(1.5, 3.5),
      bg, col: pick(BLOOD_COLORS),
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
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s - speed * 0.3, rand(1.5, 4));
    }
  }

  update(dt) {
    const m = this.map;
    const keep = [];
    for (const d of this.drops) {
      d.vy += 1350 * dt;
      d.vx *= 0.996;
      const nx = d.x + d.vx * dt, ny = d.y + d.vy * dt;
      if (m.solidPx(nx, ny)) {
        this.stamp(d.x, d.y, d.vx, d.vy, d.size, d.col, 0.9);
        continue;
      }
      d.x = nx; d.y = ny;
      d.life -= dt;
      if (d.life <= 0) {
        if (d.bg) this.stamp(d.x, d.y, d.vx, d.vy, d.size * 0.9, d.col, 0.75);
        continue;
      }
      if (d.x < 0 || d.y < 0 || d.x > m.pw || d.y > m.ph) continue;
      keep.push(d);
    }
    this.drops = keep;
  }

  stamp(x, y, vx, vy, size, col, alpha) {
    const g = this.ctx;
    const sp = Math.sqrt(vx * vx + vy * vy);
    const stretch = 1 + Math.min(2.5, sp / 350);
    g.globalAlpha = alpha;
    g.fillStyle = col;
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(vy, vx));
    g.beginPath(); g.ellipse(0, 0, size * stretch, size, 0, 0, TAU); g.fill();
    const n = randi(0, 3);
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(rand(0, size * stretch * 2.2), rand(-size * 1.5, size * 1.5), rand(0.5, size * 0.6), 0, TAU);
      g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  scorch(x, y, r) {
    const g = this.ctx;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(25,18,14,0.35)');
    grd.addColorStop(1, 'rgba(25,18,14,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  renderDecals(ctx, vx0, vy0, vx1, vy1) {
    const sx = clamp(Math.floor(vx0), 0, this.canvas.width), sy = clamp(Math.floor(vy0), 0, this.canvas.height);
    const sw = clamp(Math.ceil(vx1), 0, this.canvas.width) - sx, sh = clamp(Math.ceil(vy1), 0, this.canvas.height) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(this.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  }

  renderDrops(ctx) {
    for (const d of this.drops) {
      ctx.fillStyle = d.col;
      const s = d.size;
      ctx.fillRect(d.x - s * 0.5, d.y - s * 0.5, s, s);
    }
  }
}

class FX {
  constructor() { this.list = []; this.texts = []; }

  spark(x, y, vx, vy, life, color) {
    this.list.push({ kind: 'spark', x, y, vx, vy, life, max: life, color: color || '#ffe9a8' });
  }
  sparks(x, y, dx, dy, n, speed, color) {
    const a0 = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const a = a0 + rand(-1, 1), s = speed * rand(0.3, 1);
      this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.12, 0.35), color);
    }
  }
  smoke(x, y, size) {
    this.list.push({ kind: 'smoke', x, y, vx: rand(-15, 15), vy: rand(-50, -20), life: rand(0.6, 1.2), max: 1.2, size: size || rand(4, 8) });
  }
  flash(x, y, r, color) {
    this.list.push({ kind: 'flash', x, y, r, life: 0.07, max: 0.07, color: color || '255,240,200' });
  }
  text(x, y, str, color) {
    this.texts.push({ x, y, str, color: color || '#fff', life: 1.4, max: 1.4 });
  }

  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      if (p.kind === 'spark') { p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      else if (p.kind === 'smoke') { p.x += p.vx * dt; p.y += p.vy * dt; p.size += 14 * dt; }
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 30 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  render(ctx) {
    for (const p of this.list) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color; ctx.globalAlpha = a; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#5a5a5a';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      } else if (p.kind === 'flash') {
        ctx.globalAlpha = a;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(${p.color},0.9)`); g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 15px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / t.max * 2, 0, 1);
      ctx.fillStyle = '#000'; ctx.fillText(t.str, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
