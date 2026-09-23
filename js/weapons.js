// Harpoon spikes (impale + pin to walls), the flesh tentacle grapple, and the
// prototype laser beam.
'use strict';

const HARPOON_SPEED = 1650;
const TENTACLE_SPEED = 2100;
const TENTACLE_RANGE = 620;
const LASER_RANGE = 1100;

class Spike {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.ang = Math.atan2(vy, vx);
    this.state = 'fly';          // fly | stuck | dead
    this.carried = [];
    this.rags = new Set();
    this.age = 0;
    this.normal = null;
  }

  update(dt, game) {
    this.age += dt;
    if (this.state !== 'fly') return;
    this.vy += 380 * dt;
    let sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const dx = this.vx / sp, dy = this.vy / sp;
    this.ang = Math.atan2(dy, dx);
    let rem = sp * dt;
    while (rem > 0) {
      const st = Math.min(8, rem); rem -= st;
      const nx = this.x + dx * st, ny = this.y + dy * st;
      if (game.map.solidPx(nx, ny)) { this.embed(game, dx, dy); return; }
      if (this.carried.length < 3) {
        const h = game.hitBones(this.x, this.y, nx, ny, 3, this.rags);
        if (h) this.impale(game, h, dx, dy);
      }
      this.x = nx; this.y = ny;
      if (this.x < -50 || this.y < -50 || this.x > game.map.pw + 50 || this.y > game.map.ph + 50) { this.state = 'dead'; return; }
    }
    this.placeCarried(dx, dy);
  }

  impale(game, h, dx, dy) {
    const p = h.particle;
    if (p.pin || p.held) return;
    p.held = true;
    this.carried.push(p);
    this.rags.add(p.rag);
    this.vx *= 0.72; this.vy *= 0.72;
    h.npc.onImpaled(p, dx, dy);
    game.blood.spray(p.x, p.y, dx, dy, 22, 480, 0.35);
    game.blood.spray(p.x, p.y, -dx, -dy, 10, 220, 0.6);
    game.shake(4);
    Sfx.squelch();
  }

  placeCarried(dx, dy) {
    for (let i = 0; i < this.carried.length; i++) {
      const p = this.carried[i];
      const x = this.x - dx * (12 + i * 11), y = this.y - dy * (12 + i * 11);
      p.x = x; p.y = y;
      p.px = x - this.vx * DT * 0.8; p.py = y - this.vy * DT * 0.8;
    }
  }

  embed(game, dx, dy) {
    const m = game.map;
    let sx = this.x, sy = this.y;
    for (let k = 0; k < 10 && !m.solidPx(sx + dx, sy + dy); k++) { sx += dx; sy += dy; }
    const t0x = Math.floor(sx / TILE), t1x = Math.floor((sx + dx * 2) / TILE);
    this.normal = t0x !== t1x ? { x: -sign(dx), y: 0 } : { x: 0, y: -sign(dy) };
    this.x = sx + dx * 14; this.y = sy + dy * 14;
    this.state = 'stuck';
    for (let i = 0; i < this.carried.length; i++) {
      const p = this.carried[i];
      p.held = false;
      p.pin = { x: sx - dx * (5 + i * 11), y: sy - dy * (5 + i * 11) };
      p.x = p.px = p.pin.x; p.y = p.py = p.pin.y;
    }
    Sfx.thunk();
    game.shake(this.carried.length ? 5 : 2);
    game.fx.sparks(sx, sy, -dx, -dy, 8, 380);
    game.onSpikeStuck(this);
  }

  release() {
    for (const p of this.carried) { p.pin = null; p.held = false; }
    this.carried = [];
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.ang);
    ctx.fillStyle = '#3d434d';
    ctx.fillRect(-46, -2.5, 40, 5);
    ctx.fillStyle = '#a9b2bf';
    ctx.fillRect(-46, -2.5, 40, 1.5);
    ctx.fillStyle = '#2a2e35';
    ctx.fillRect(-48, -4, 5, 8);
    ctx.fillStyle = '#d7dce4';
    ctx.beginPath();
    ctx.moveTo(2, 0); ctx.lineTo(-10, -6); ctx.lineTo(-7, 0); ctx.lineTo(-10, 6); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2a2e35'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
}

class Tentacle {
  constructor(player) {
    this.pl = player;
    this.state = 'idle';         // idle | out | attached | retract
    this.tip = { x: 0, y: 0 };
    this.dir = { x: 1, y: 0 };
    this.anchor = null;          // fixed world point
    this.target = null;          // particle
    this.npc = null;
    this.len = 0;
    this.t = 0;
  }

  origin() { return this.pl.shoulder(); }
  attached() { return this.state === 'attached'; }
  attachedFixed() { return this.state === 'attached' && (this.anchor || (this.target && this.target.pin)); }
  point() { return this.anchor || this.target; }

  fire(dx, dy) {
    if (this.state !== 'idle') return;
    const o = this.origin();
    this.tip = { x: o.x, y: o.y };
    this.dir = { x: dx, y: dy };
    this.state = 'out';
    Sfx.whip();
  }

  release() {
    if (this.npc) { this.npc.grabbed = false; this.npc.knock(1.2); }
    this.npc = null; this.target = null; this.anchor = null;
    if (this.state !== 'idle') this.state = 'retract';
  }

  update(dt, game) {
    this.t += dt;
    const o = this.origin();
    if (this.state === 'out') {
      if (!Input.mouse.down[2]) { this.state = 'retract'; return; }
      const step = TENTACLE_SPEED * dt;
      const d = this.dir;
      const ray = game.map.raycast(this.tip.x, this.tip.y, d.x, d.y, step);
      const h = game.hitBones(this.tip.x, this.tip.y, ray.x, ray.y, 5, null);
      if (h) {
        this.target = h.particle; this.npc = h.npc;
        this.npc.grabbed = true; this.npc.knock(1);
        this.state = 'attached';
        this.len = dist(o.x, o.y, this.target.x, this.target.y);
        game.blood.spray(h.particle.x, h.particle.y, -d.x, -d.y, 8, 200, 0.8);
        Sfx.latch();
      } else if (ray.hit) {
        this.anchor = { x: ray.x - d.x, y: ray.y - d.y };
        this.state = 'attached';
        this.len = dist(o.x, o.y, this.anchor.x, this.anchor.y);
        game.fx.sparks(ray.x, ray.y, ray.nx, ray.ny, 4, 200, '#ff9aa0');
        Sfx.latch();
      } else {
        this.tip.x = ray.x; this.tip.y = ray.y;
        if (dist(o.x, o.y, this.tip.x, this.tip.y) > TENTACLE_RANGE) this.state = 'retract';
      }
    } else if (this.state === 'attached') {
      if (!Input.mouse.down[2]) { this.release(); return; }
      const minLen = this.anchor ? 28 : 40;
      this.len = Math.max(minLen, this.len - (this.anchor ? 820 : 950) * dt);
      const p = this.point();
      this.tip.x = p.x; this.tip.y = p.y;
      if (this.npc) { this.npc.grabbed = true; this.npc.stun = Math.max(this.npc.stun, 1); }
    } else if (this.state === 'retract') {
      const d = dist(this.tip.x, this.tip.y, o.x, o.y);
      const step = 2800 * dt;
      if (d <= step) { this.state = 'idle'; return; }
      this.tip.x += (o.x - this.tip.x) / d * step;
      this.tip.y += (o.y - this.tip.y) / d * step;
    }
  }

  // Rope constraint between the player and whatever the tentacle holds.
  applyRope() {
    if (this.state !== 'attached') return;
    const pl = this.pl;
    const o = this.origin();
    const a = this.point();
    const d = dist(o.x, o.y, a.x, a.y);
    if (d <= this.len || d < 1e-3) return;
    const nx = (a.x - o.x) / d, ny = (a.y - o.y) / d;
    const excess = d - this.len;
    const fixed = this.attachedFixed();
    const share = fixed ? 1 : 0.1;
    pl.moveBy(nx * excess * share, ny * excess * share);
    if (fixed) {
      const vr = pl.vx * nx + pl.vy * ny;       // negative = moving away from anchor
      if (vr < 0) { pl.vx -= nx * vr; pl.vy -= ny * vr; }
    } else {
      const m = Math.min(14, excess * (1 - share));
      this.target.x -= nx * m; this.target.y -= ny * m;
    }
  }

  render(ctx) {
    if (this.state === 'idle') return;
    const o = this.origin();
    const tx = this.tip.x, ty = this.tip.y;
    const d = dist(o.x, o.y, tx, ty) || 1;
    const ux = (tx - o.x) / d, uy = (ty - o.y) / d;
    const nx = -uy, ny = ux;
    const N = 20;
    const amp = this.state === 'attached' ? 1.5 : 7;
    const slack = this.state === 'attached' ? Math.max(0, this.len - d) : 0;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const env = Math.sin(Math.PI * f);
      const w = Math.sin(f * 14 - this.t * 22) * amp * env;
      pts.push({ x: o.x + ux * d * f + nx * w, y: o.y + uy * d * f + ny * w + slack * 0.6 * env });
    }
    const layer = (col, scale) => {
      ctx.strokeStyle = col; ctx.lineCap = 'round';
      for (let i = 0; i < N; i++) {
        ctx.lineWidth = lerp(9, 3.5, i / N) * scale;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
      }
    };
    layer('#1f0208', 1.25);
    layer('#6e1222', 1);
    layer('#b83a4c', 0.35);
    // Hooked bone claw on the tip.
    const ang = Math.atan2(ty - pts[N - 1].y, tx - pts[N - 1].x);
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(ang);
    ctx.fillStyle = '#efe3cf'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(4, s * 9, 9, s * 3); ctx.lineTo(3, s * 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    ctx.lineCap = 'butt';
  }
}
