// More escaped test subjects. Each is a Player subclass: shared health, eating,
// growth and weapons, plus its own body, movement tweaks and natural attack
// (weapon slot 1), all built on the pixel gore:
//   Eye     - flies; tendrils rip small chunks out of people very quickly.
//   Slime   - soft-body blob; whoever touches it gets stuck inside, and holding
//             LMB dissolves everything it's holding.
//   Crystal - heavy crawler on crystal legs; shards lodge in bodies, grow and
//             shatter the wound; hold-and-release stabs a crystal lance.
'use strict';

// Shared growth: size goes from 1 to maxSize as pixels are eaten.
function growCreature(c, maxSize, perSize) {
  const before = c.size;
  c.size = Math.min(maxSize, 1 + c.mass / perSize);
  c.applySize();
  if (Math.floor(before * 5) !== Math.floor(c.size * 5)) c.game.fx.text(c.x, c.y - 40, 'GROWING', '#ffb3b8');
}

// ================================================================== EYE
const TENDRILS = { name: 'TENDRILS', cool: 0, kind: 'tendrils' };
const EYE_C = {
  out: hexc('#3a1418'), sclera: hexc('#f1ece4'), shade: hexc('#cfc4b6'), vein: hexc('#c23b3b'), vein2: hexc('#e27a6e'),
  iris: hexc('#c9521b'), iris2: hexc('#f08a3a'), pupil: hexc('#120405'), lid: hexc('#7e2a36'),
};

class Eye extends Player {
  static creatureName = 'EYE';
  static weaponList = [TENDRILS, ...WEAPONS];
  static hasTentacle = false;
  static rideH = 30;

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = 1;
    this.look = { x: 1, y: 0 };
    this.tendrils = [];
    this.nerve = [];
    this.blinkT = rand(2, 5); this.blink = 0;
    this.veins = [];
    for (let v = 0; v < 7; v++) {
      const a0 = rand(0, TAU), line = [];
      let a = a0, r = 0.98;
      for (let k = 0; k < 4; k++) { line.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); a += rand(-0.25, 0.25); r -= rand(0.08, 0.14); }
      this.veins.push(line);
    }
    this.applySize();
    for (let i = 0; i < 8; i++) this.nerve.push({ x: this.x, y: this.y + i * 5 });
  }

  eyeR() { return 7 * this.size; }
  applySize() {
    this.coreR = this.eyeR() * PX * 0.9;
    this.maxHp = Math.round(80 + (this.size - 1) * 100);
    const n = 3 + Math.floor((this.size - 1) * 3);
    while (this.tendrils.length < n) this.tendrils.push({ x: this.x, y: this.y, q: null, idx: -1, rip: 0, ph: rand(0, 6) });
  }
  grow() { growCreature(this, 2.2, 900); }
  buildPieces() { this.pieces = []; }

  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { return { x: this.x + this.aim.x * this.eyeR() * PX * 0.5, y: this.y + this.eyeR() * PX + 8 }; }
  muzzle() { const h = this.gunHand(); return { x: h.x + this.aim.x * 8, y: h.y + this.aim.y * 8 }; }
  box() { const r = this.eyeR() * PX + 6; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) { const r = this.eyeR() * PX; return !this.dead && dist2(x, y, this.x, this.y) < r * r; }

  pushBodies(npcs) {
    if (this.dead) return;
    const R = this.eyeR() * PX;
    for (const npc of npcs) for (const p of npc.rag.parts) {
      if (p.pin || p.held) continue;
      const r = R + p.r, d2 = dist2(p.x, p.y, this.x, this.y);
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1;
      p.x += (p.x - this.x) / d * (r - d) * 0.5; p.y += (p.y - this.y) / d * (r - d) * 0.5;
    }
  }

  respawn() { super.respawn(); this.mass = 0; this.size = 1; this.applySize(); this.hp = this.maxHp; }

  // Free flight with a gentle bob. Shift dashes.
  move(dt) {
    const map = this.game.map;
    const ix = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
    const iy = (Input.down('KeyS') || Input.down('ArrowDown') ? 1 : 0) - (Input.down('KeyW') || Input.down('ArrowUp') || Input.down('Space') ? 1 : 0);
    const il = Math.hypot(ix, iy);
    this.dashCool -= dt;
    if ((Input.hit('ShiftLeft') || Input.hit('ShiftRight')) && this.dashCool <= 0) {
      const d = il ? { x: ix / il, y: iy / il } : this.aim;
      this.dashDx = d.x; this.dashDy = d.y; this.dashT = 0.18; this.dashCool = 0.45;
      this.rammed.clear();
      Sfx.dash();
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDx * 900; this.vy = this.dashDy * 900;
      this.trail.push({ x: this.x, y: this.y, t: 0.22 });
    } else {
      const sp = 235 + 30 * (this.size - 1);
      this.vx = approach(this.vx, il ? ix / il * sp : 0, 1300 * dt);
      this.vy = approach(this.vy, il ? iy / il * sp : 0, 1300 * dt);
      this.vy += Math.sin(this.t * 2.6) * 22 * dt;
    }
    for (const tr of this.trail) tr.t -= dt;
    this.trail = this.trail.filter((tr) => tr.t > 0);
    this.grip = 0; this.onGround = false; this.up = { x: 0, y: -1 };
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) * dt / 6));
    const c = { x: this.x, y: this.y, r: this.coreR };
    for (let i = 0; i < steps; i++) {
      c.x += this.vx * dt / steps; c.y += this.vy * dt / steps;
      const n = map.pushCircle(c);
      if (n) { const vn = this.vx * n.x + this.vy * n.y; if (vn < 0) { this.vx -= n.x * vn; this.vy -= n.y * vn; } }
    }
    this.x = c.x; this.y = c.y;
  }

  // Pick a random body pixel of someone in front of us, within reach.
  pickPixel(reach) {
    const cands = [];
    for (const npc of this.game.npcs) for (const q of npc.rag.pieces) {
      const dx = q.bc.x - this.x, dy = q.bc.y - this.y, d = Math.hypot(dx, dy);
      if (d > reach + q.bc.r || q.count <= 0) continue;
      if (d > 20 && (dx * this.aim.x + dy * this.aim.y) / d < 0.35) continue;
      cands.push(q);
    }
    if (!cands.length) return null;
    const q = pick(cands), F = q.frame();
    for (let k = 0; k < 16; k++) {
      const idx = randi(0, q.col.length - 1);
      if (!q.col[idx]) continue;
      const [x, y] = q.cellWorld(idx, F);
      if (dist(x, y, this.x, this.y) < reach) return { q, idx, x, y };
    }
    return null;
  }

  // Hold LMB: tendrils lash out and tear small chunks off whatever you aim at.
  natural(dt, held) {
    const g = this.game, R = this.eyeR() * PX, reach = 100 + 45 * (this.size - 1);
    for (const T of this.tendrils) {
      T.ph += dt * 9; T.rip -= dt;
      let tgt = null;
      if (held) {
        if (T.q && T.q.owner.pieces.includes(T.q) && T.q.col[T.idx]) {
          const [x, y] = T.q.cellWorld(T.idx, T.q.frame());
          if (dist(x, y, this.x, this.y) < reach * 1.15) tgt = { x, y };
        }
        if (!tgt) {
          T.q = null;
          const pk = this.pickPixel(reach);
          if (pk) { T.q = pk.q; T.idx = pk.idx; tgt = pk; }
        }
      }
      if (!tgt) {
        // Idle: tendrils float around the eye.
        const out = held ? 1.8 : 0.9;
        const tx = this.x + this.aim.x * R * out + Math.cos(T.ph) * 6, ty = this.y + this.aim.y * R * out + Math.sin(T.ph * 1.3) * 6 + (held ? 0 : R * 0.6);
        const k = 1 - Math.exp(-dt * 10);
        T.x = lerp(T.x, tx, k); T.y = lerp(T.y, ty, k);
        continue;
      }
      const d = dist(T.x, T.y, tgt.x, tgt.y), step = 1200 * dt;
      if (d > step) { T.x += (tgt.x - T.x) / d * step; T.y += (tgt.y - T.y) / d * step; }
      else { T.x = tgt.x; T.y = tgt.y; }
      if (d < 6 && T.rip <= 0) {
        T.rip = 0.1;
        const removed = g.burnAt(T.x, T.y, 1.3, 1, 0.1, 'tendril', 0.45, T.x - this.x, T.y - this.y);
        if (removed) {
          // The torn-off bits get pulled back into the eye.
          for (let k = 0; k < Math.min(5, removed); k++) {
            g.blood.spawn(T.x, T.y, (this.x - T.x) * 2.5 + rand(-60, 60), (this.y - T.y) * 2.5 + rand(-60, 60), 2, pick(FLESH));
          }
          this.feed(removed * 0.8);
          if (Math.random() < 0.5) Sfx.bite();
        }
        T.q = null;
      }
    }
  }

  computePose(dt) {
    if (!this.nerve) return;
    const k = dt ? 1 - Math.exp(-dt * 12) : 1;
    this.look = norm(lerp(this.look.x, this.aim.x, k), lerp(this.look.y, this.aim.y, k));
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = rand(2.5, 6); }
    this.blink = Math.max(0, this.blink - dt * 7);
    // Optic nerve trails behind the eye.
    const sp = Math.hypot(this.vx, this.vy);
    const back = sp > 40 ? norm(-this.vx, -this.vy) : { x: 0, y: 1 };
    const R = this.eyeR() * PX;
    let prev = { x: this.x + back.x * R * 0.9, y: this.y + back.y * R * 0.9 };
    for (let i = 0; i < this.nerve.length; i++) {
      const n = this.nerve[i];
      n.y += dt * 40;
      const d = dist(n.x, n.y, prev.x, prev.y) || 1, sp2 = 4.5 * this.size;
      n.x = prev.x + (n.x - prev.x) / d * sp2; n.y = prev.y + (n.y - prev.y) / d * sp2;
      prev = n;
    }
  }

  render(fb) {
    if (this.dead) return;
    const cx = this.x / PX, cy = this.y / PX, r = this.eyeR(), z = this.size;
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, r, DASH_GHOST);
    // Optic nerve.
    const nv = this.nerve;
    for (let i = nv.length - 1; i >= 0; i--) fb.disc(nv[i].x / PX, nv[i].y / PX, lerp(1.8, 0.7, i / nv.length) * z, TENT_OUT);
    for (let i = nv.length - 1; i >= 0; i--) fb.put(nv[i].x / PX, nv[i].y / PX, TENT_MID);
    // Tendrils (behind the eyeball).
    for (const T of this.tendrils) {
      const tx = T.x / PX, ty = T.y / PX;
      const d = dist(cx, cy, tx, ty) || 1, ux = (tx - cx) / d, uy = (ty - cy) / d;
      const N = Math.max(3, Math.ceil(d));
      for (let s = 0; s <= N; s++) {
        const f = s / N, w = Math.sin(f * 9 - T.ph) * 1.2 * Math.sin(Math.PI * f);
        const x = cx + ux * d * f - uy * w, y = cy + uy * d * f + ux * w;
        fb.put(x, y, s % 3 ? TENT_OUT : TENT_MID);
      }
      fb.put(tx, ty, TENT_CLAW);
    }
    // Gun hangs from a nerve under the eye.
    if (this.wkind() !== 'tendrils') {
      const h = this.gunHand();
      fb.line(cx, cy + r * 0.7, h.x / PX, h.y / PX, TENT_OUT);
      this.renderGun(fb, h);
    }
    // Eyeball.
    fb.disc(cx, cy, r + 1, EYE_C.out);
    fb.disc(cx, cy, r, EYE_C.shade);
    fb.disc(cx - r * 0.12, cy - r * 0.15, r * 0.84, EYE_C.sclera);
    for (const line of this.veins) {
      for (let k = 0; k < line.length - 1; k++) {
        fb.line(cx + line[k].x * r, cy + line[k].y * r, cx + line[k + 1].x * r, cy + line[k + 1].y * r, k ? EYE_C.vein2 : EYE_C.vein);
      }
    }
    const ix = cx + this.look.x * r * 0.4, iy = cy + this.look.y * r * 0.4;
    fb.disc(ix, iy, r * 0.48, EYE_C.iris);
    fb.disc(ix - 0.5, iy - 0.5, r * 0.36, EYE_C.iris2);
    fb.disc(ix, iy, r * 0.2 + (this.jawOpen ? 0.5 : 0), EYE_C.pupil);
    fb.put(cx - r * 0.38, cy - r * 0.42, hexc('#ffffff'));
    fb.put(cx - r * 0.38 + 1, cy - r * 0.42, hexc('#ffffff'));
    if (this.blink > 0) {
      const lid = r * 2 * Math.min(1, this.blink * 1.4);
      for (let y = Math.floor(cy - r); y < cy - r + lid; y++) {
        const hw = Math.sqrt(Math.max(0, r * r - (y + 0.5 - cy) ** 2));
        fb.line(cx - hw, y, cx + hw, y, EYE_C.lid);
      }
    }
    if (this.hurtT > 0) fb.disc(cx, cy, r, HURT_TINT);
  }
}

// ================================================================== SLIME
const DISSOLVE = { name: 'DISSOLVE', cool: 0, kind: 'dissolve' };
const SLIME_C = { fill: hexc('#5fd35a'), rim: hexc('#1f6b2a'), hi: hexc('#d9ffc8'), eye: hexc('#0e2a10'), bubble: hexc('#b6f5a3') };

class Slime extends Player {
  static creatureName = 'SLIME';
  static weaponList = [DISSOLVE, ...WEAPONS];
  static hasTentacle = false;
  static rideH = 16;

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = 1;
    this.stuck = new Map();       // particle -> { npc, ox, oy }
    this.N = 18;
    this.applySize();
    this.blob = [];
    const R = this.R();
    for (let i = 0; i < this.N; i++) {
      const a = i / this.N * TAU;
      const bx = this.x + Math.cos(a) * R, by = this.y + Math.sin(a) * R;
      this.blob.push({ x: bx, y: by, px: bx, py: by });
    }
    this.dissolveT = 0;
    this.bubbles = [0, 1, 2, 3].map(() => ({ a: rand(0, TAU), r: rand(0.1, 0.6), s: rand(0.3, 0.8) }));
  }

  R() { return 11 * this.size * PX; }
  applySize() {
    const R = this.R();
    this.coreR = R * 0.42;
    this.rideH = Math.max(this.coreR + 3, R * 0.62);
    this.maxHp = Math.round(110 + (this.size - 1) * 110);
    this.moveSpeed = 225;
    this.capacity = Math.floor(9 + (this.size - 1) * 16);
  }
  grow() { growCreature(this, 2.2, 900); }
  buildPieces() { this.pieces = []; }

  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  muzzle() { const R = this.R(); return { x: this.x + this.aim.x * R, y: this.y + this.aim.y * R }; }
  box() { const r = this.R() + 4; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) { const r = this.R() * 0.9; return !this.dead && dist2(x, y, this.x, this.y) < r * r; }

  pushBodies(npcs) {
    if (this.dead || this.stuck.size < this.capacity) return;   // (not full: they get engulfed instead)
    const R = this.R();
    for (const npc of npcs) for (const p of npc.rag.parts) {
      if (p.pin || p.held || this.stuck.has(p)) continue;
      const r = R + p.r, d2 = dist2(p.x, p.y, this.x, this.y);
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1;
      p.x += (p.x - this.x) / d * (r - d) * 0.5; p.y += (p.y - this.y) / d * (r - d) * 0.5;
    }
  }

  releaseAll(fling) {
    for (const [p, s] of this.stuck) {
      s.npc.grabbed = false;
      if (s.npc.alive) s.npc.knock(1.5);
      if (fling) p.impulse(this.aim.x * 700 + rand(-80, 80), this.aim.y * 700 - 120);
    }
    this.stuck.clear();
  }

  respawn() { this.releaseAll(false); super.respawn(); this.mass = 0; this.size = 1; this.applySize(); this.hp = this.maxHp; }
  die() { this.releaseAll(false); super.die(); for (let k = 0; k < 40; k++) this.game.blood.spawn(this.x, this.y, rand(-400, 400), rand(-500, 0), 2.5, SLIME_C.fill); }

  // Engulf on contact; hold LMB to dissolve; E spits everything out.
  natural(dt, held) {
    const g = this.game, R = this.R();
    for (const npc of g.npcs) {
      if (this.stuck.size >= this.capacity) break;
      for (const p of npc.rag.parts) {
        if (p.pin || this.stuck.has(p) || this.stuck.size >= this.capacity) continue;
        if (dist2(p.x, p.y, this.x, this.y) > (R * 0.85) ** 2) continue;
        const first = ![...this.stuck.values()].some((s) => s.npc === npc);
        this.stuck.set(p, { npc, ox: (p.x - this.x) * 0.6, oy: (p.y - this.y) * 0.6 });
        npc.grabbed = true;
        if (first) { Sfx.squelch(); if (npc.alive) npc.say(pick(["IT'S GOT ME", 'I CANT MOVE', 'GET IT OFF']), 1.5); }
      }
    }
    // Held things drift inside the goo; struggling barely moves them.
    for (const [p, s] of this.stuck) {
      if (!s.npc.rag.parts.includes(p) || p.pin) { this.stuck.delete(p); continue; }
      const tx = this.x + s.ox, ty = this.y + s.oy;
      p.x = lerp(p.x, tx, 0.12); p.y = lerp(p.y, ty, 0.12);
      p.px = lerp(p.px, p.x, 0.6); p.py = lerp(p.py, p.y, 0.6);
      s.npc.grabbed = true;
      s.npc.stun = Math.max(s.npc.stun, 0.3);
    }
    if (Input.hit('KeyE') && this.stuck.size) { this.releaseAll(true); Sfx.squelch(); }
    // Dissolve.
    this.dissolveT -= dt;
    if (held && this.stuck.size && this.dissolveT <= 0) {
      this.dissolveT = 0.06;
      const parts = [...this.stuck.keys()];
      let total = 0;
      for (let k = 0; k < Math.min(3, parts.length); k++) {
        const p = pick(parts);
        total += g.burnAt(p.x + rand(-4, 4), p.y + rand(-4, 4), 1.6, 0.7, 0.35, 'acid', 0.55);
      }
      if (total) {
        this.feed(total * 0.9);
        if (Math.random() < 0.4) g.fx.spark(this.x + rand(-R, R) * 0.5, this.y + rand(-R, R) * 0.5, rand(-20, 20), -60, 0.4, '#b6f5a3');
        if (Math.random() < 0.15) Sfx.squelch();
      }
    }
  }

  computePose(dt) {
    if (!this.blob || !dt) return;
    const map = this.game.map, R = this.R();
    for (let i = 0; i < this.blob.length; i++) {
      const p = this.blob[i], a = i / this.blob.length * TAU;
      const tx = this.x + Math.cos(a) * R, ty = this.y + Math.sin(a) * R * 0.92;
      const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + 900 * dt * dt;
      p.x += (tx - p.x) * 0.16; p.y += (ty - p.y) * 0.16;
      const c = { x: p.x, y: p.y, r: 2 };
      map.pushCircle(c);
      p.x = c.x; p.y = c.y;
    }
    for (const b of this.bubbles) { b.r -= dt * b.s * 0.3; if (b.r < 0.05) { b.r = rand(0.5, 0.8); b.a = rand(0, TAU); } }
  }

  render(fb) {
    if (this.dead) return;
    const R = this.R(), cx = this.x / PX, cy = this.y / PX;
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, R / PX * 0.8, DASH_GHOST);
    // The gun floats inside the goo (drawn first so the goo tints it).
    if (this.wkind() !== 'dissolve') this.renderGun(fb, { x: this.x + this.aim.x * R * 0.35, y: this.y + this.aim.y * R * 0.35 });
    const poly = this.blob.map((p) => ({ x: p.x / PX, y: p.y / PX }));
    fillPoly(fb, poly, SLIME_C.fill, 0.55);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      fb.line(a.x, a.y, b.x, b.y, SLIME_C.rim);
    }
    // Highlight on the upper-left of the rim.
    for (let i = 0; i < poly.length; i++) {
      const a = i / poly.length * TAU;
      if (Math.cos(a) < -0.2 && Math.sin(a) < -0.2) fb.put(lerp(cx, poly[i].x, 0.78), lerp(cy, poly[i].y, 0.78), SLIME_C.hi);
    }
    for (const b of this.bubbles) {
      const r0 = R / PX * 0.8;
      fb.blend(cx + Math.cos(b.a) * r0 * b.r, cy - Math.abs(Math.sin(b.a)) * r0 * (1 - b.r), SLIME_C.bubble, 0.8);
    }
    // Two beady eyes looking where you aim.
    const ex = cx + this.aim.x * R / PX * 0.3, ey = cy + this.aim.y * R / PX * 0.3 - 1;
    fb.put(ex - 1.5, ey, SLIME_C.eye); fb.put(ex + 1.5, ey, SLIME_C.eye);
    fb.put(ex - 1.5, ey - 1, SLIME_C.eye); fb.put(ex + 1.5, ey - 1, SLIME_C.eye);
    if (this.hurtT > 0) fillPoly(fb, poly, HURT_TINT, 0.35);
  }
}

// ================================================================== CRYSTAL
const SHARDS = { name: 'SHARDS', cool: 0, kind: 'shards' };
const CRY_C = { dark: hexc('#1d3f66'), mid: hexc('#3fa7d6'), light: hexc('#a9ecff'), glow: hexc('#effcff'), vio: hexc('#7b5cd6') };

// A faceted diamond from base toward a tip, in art px.
function drawCrystal(fb, bx, by, dx, dy, len, w, dark, light, tipC) {
  const px = -dy, py = dx;
  const mx = bx + dx * len * 0.35, my = by + dy * len * 0.35;
  const tip = { x: bx + dx * len, y: by + dy * len };
  const base = { x: bx - dx * 1.5, y: by - dy * 1.5 };
  fillPoly(fb, [base, { x: mx + px * w / 2, y: my + py * w / 2 }, tip, { x: mx, y: my }], light);
  fillPoly(fb, [base, { x: mx, y: my }, tip, { x: mx - px * w / 2, y: my - py * w / 2 }], dark);
  if (tipC) fb.put(tip.x, tip.y, tipC);
}

class CrystalShard {
  constructor(x, y, vx, vy, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size;
    this.state = 'fly';         // fly | stuck | lodged | dead
    this.life = 6; this.t = 0; this.stage = 0;
    this.host = null;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.state = 'dead'; return; }
    if (this.state === 'fly') {
      this.vy += 250 * dt;
      const sp = Math.hypot(this.vx, this.vy), dx = this.vx / sp, dy = this.vy / sp;
      let rem = sp * dt;
      while (rem > 0) {
        const st = Math.min(6, rem); rem -= st;
        const nx = this.x + dx * st, ny = this.y + dy * st;
        if (game.map.solidPx(nx, ny)) { this.state = 'stuck'; this.life = 3; game.fx.sparks(this.x, this.y, -dx, -dy, 4, 200, '#a9ecff'); Sfx.clang(); return; }
        const h = game.hitPieces(this.x, this.y, nx, ny, null, 0);
        if (h) {
          this.host = h.particle; this.ox = h.x - h.particle.x; this.oy = h.y - h.particle.y;
          this.state = 'lodged'; this.t = 0; this.life = 4;
          game.burnAt(h.x, h.y, 0.8, 1, 0.1, 'crystal', 0.6, dx, dy);
          game.blood.spray(h.x, h.y, dx, dy, 6, 260, 0.5);
          Sfx.squelch();
          return;
        }
        this.x = nx; this.y = ny;
      }
      return;
    }
    if (this.state !== 'lodged') return;
    const h = this.host;
    if (!h.rag || !h.rag.parts.includes(h)) { this.state = 'dead'; return; }
    this.x = h.x + this.ox; this.y = h.y + this.oy;
    this.t += dt;
    // Grow inside the wound, shoving flesh out; then shatter.
    if (this.t > 0.22 * (this.stage + 1)) {
      this.stage++;
      const r = 0.8 + this.stage * 0.55 * Math.sqrt(this.size);
      const removed = game.burnAt(this.x, this.y, r, 0.75, 0.15, 'crystal', 0.6);
      for (let k = 0; k < 3 + removed; k++) { const a = rand(0, TAU); game.blood.spawn(this.x, this.y, Math.cos(a) * 220, Math.sin(a) * 220 - 80, 2); }
      game.fx.sparks(this.x, this.y, 0, -1, 2, 120, '#a9ecff');
      Sfx.clang();
      if (this.stage >= 5) {
        game.burnAt(this.x, this.y, r + 1.2, 1, 0.1, 'crystal', 0.8);
        game.blood.burst(this.x, this.y, 30, 380);
        game.fx.sparks(this.x, this.y, 0, -1, 14, 420, '#a9ecff');
        Sfx.rip();
        this.state = 'dead';
      }
    }
  }

  render(fb) {
    const x = this.x / PX, y = this.y / PX;
    if (this.state === 'fly') {
      const d = norm(this.vx, this.vy);
      drawCrystal(fb, x - d.x * 3, y - d.y * 3, d.x, d.y, 4, 2, CRY_C.mid, CRY_C.light, CRY_C.glow);
      return;
    }
    const len = 2.5 + this.stage * 1.2 * Math.sqrt(this.size);
    for (let k = 0; k < 3 + Math.min(2, this.stage); k++) {
      const a = k * 2.1 + 0.4;
      drawCrystal(fb, x, y, Math.cos(a), Math.sin(a), len * (k === 0 ? 1 : 0.7), 1.6 + this.stage * 0.3, CRY_C.dark, CRY_C.light, k === 0 ? CRY_C.glow : 0);
    }
  }
}

class Crystal extends Player {
  static creatureName = 'CRYSTAL';
  static weaponList = [SHARDS, ...WEAPONS];
  static hasTentacle = false;
  static rideH = 34;

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = 1;
    this.legs = [0, 1, 2, 3].map(() => ({ x, y: feetY, fx: x, fy: feetY, tx: x, ty: feetY, t: 1, planted: false }));
    this.body = [
      { a: 0, len: 12, w: 5 }, { a: -0.55, len: 9, w: 3.5 }, { a: 0.6, len: 9.5, w: 3.5 },
      { a: -1.15, len: 6.5, w: 3 }, { a: 1.2, len: 7, w: 3 }, { a: -0.25, len: 7, w: 2.5 }, { a: 0.3, len: 6, w: 2.5 },
    ];
    this.holdT = 0; this.charge = 0; this.shardCool = 0; this.lance = null;
    this.applySize();
  }

  applySize() {
    this.rideH = 34 * Math.sqrt(this.size);
    this.coreR = 12 * Math.pow(this.size, 0.6);
    this.maxHp = Math.round(140 + (this.size - 1) * 110);
    this.moveSpeed = 205;
  }
  grow() { growCreature(this, 2.0, 1000); }
  buildPieces() { this.pieces = []; }

  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { return { x: this.x + this.aim.x * 9 * PX * Math.sqrt(this.size), y: this.y + this.aim.y * 9 * PX * Math.sqrt(this.size) }; }
  muzzle() { const h = this.gunHand(); return { x: h.x + this.aim.x * 6, y: h.y + this.aim.y * 6 }; }
  box() { const r = 12 * PX * this.size; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) { const r = 7 * PX * this.size; return !this.dead && dist2(x, y, this.x, this.y) < r * r; }

  pushBodies(npcs) {
    if (this.dead) return;
    const R = 7 * PX * this.size;
    for (const npc of npcs) for (const p of npc.rag.parts) {
      if (p.pin || p.held) continue;
      const r = R + p.r, d2 = dist2(p.x, p.y, this.x, this.y);
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1;
      p.x += (p.x - this.x) / d * (r - d) * 0.5; p.y += (p.y - this.y) / d * (r - d) * 0.5;
    }
  }

  respawn() { super.respawn(); this.mass = 0; this.size = 1; this.applySize(); this.hp = this.maxHp; }

  hurt(dmg, dx, dy, x, y) {
    const before = this.hp;
    super.hurt(dmg, dx, dy, x, y);
    // Armour chips off in sparkly bits.
    if (this.hp < before) this.game.fx.sparks(x, y, -(dx || 0), -(dy || 1), 6, 260, '#a9ecff');
  }

  // Tap LMB: shards. Hold and release: crystal lance.
  natural(dt, held, pressed, released) {
    this.shardCool -= dt;
    if (this.lance && (this.lance.t -= dt) <= 0) this.lance = null;
    if (pressed) this.holdT = 0;
    if (held) { this.holdT += dt; this.charge = clamp((this.holdT - 0.22) / 0.6, 0, 1); }
    if (released) {
      if (this.charge < 0.05) { if (this.shardCool <= 0) this.fireShards(); }
      else this.stab(this.charge);
      this.holdT = 0; this.charge = 0;
    }
  }

  fireShards() {
    const g = this.game, m = this.muzzle();
    this.shardCool = 0.35;
    const n = 3 + Math.floor((this.size - 1) * 2);
    const base = Math.atan2(this.aim.y, this.aim.x);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * 0.13 + rand(-0.03, 0.03);
      g.shots.push(new CrystalShard(m.x, m.y, Math.cos(a) * 1300, Math.sin(a) * 1300, this.size));
    }
    this.recoil = 1;
    Sfx.clang();
  }

  stab(charge) {
    const g = this.game, a = this.aim, map = g.map;
    const len = (90 + 80 * charge) * (0.8 + 0.2 * this.size);
    const x0 = this.x + a.x * 10, y0 = this.y + a.y * 10;
    let x1 = x0, y1 = y0, total = 0;
    for (let d = 0; d <= len; d += 3) {
      const x = x0 + a.x * d, y = y0 + a.y * d;
      if (map.solidPx(x, y)) break;
      x1 = x; y1 = y;
      total += g.burnAt(x, y, 0.9 + 0.35 * this.size, 1, 0.3, 'lance', 0.5, a.x, a.y);
    }
    // Shove everyone near the lance along it.
    for (const npc of g.npcs) for (const p of npc.rag.parts) {
      const c = closestOnSeg(p.x, p.y, x0, y0, x1, y1);
      if (c.d2 < 14 * 14 && !p.pin) p.impulse(a.x * 450, a.y * 450 - 60);
    }
    this.lance = { x0, y0, x1, y1, t: 0.3, max: 0.3 };
    if (total) { this.feed(total * 0.3); g.blood.spray(x1, y1, a.x, a.y, 10 + total, 360, 0.5); }
    g.shake(2);
    Sfx.rip(); Sfx.clang();
  }

  computePose(dt) {
    if (!this.legs) return;
    const map = this.game.map;
    const grounded = this.grip > 0.25 && this.dashT <= 0;
    const u = grounded ? this.up : { x: 0, y: -1 };
    const t = { x: -u.y, y: u.x };
    const kb = dt ? 1 - Math.exp(-dt * 10) : 1;
    this.bodyUp = norm(lerp(this.bodyUp.x, u.x, kb), lerp(this.bodyUp.y, u.y, kb));
    const velT = this.vx * t.x + this.vy * t.y;
    const legLen = this.rideH * 1.7;
    const offs = [-11, -4, 4, 11];
    for (let k = 0; k < 4; k++) {
      const L = this.legs[k];
      const off = offs[k] * PX * Math.sqrt(this.size) + clamp(velT * 0.05, -10, 10);
      const ox = this.x + t.x * off, oy = this.y + t.y * off;
      let tx, ty;
      if (grounded) {
        const r = map.raycast(ox, oy, -u.x, -u.y, legLen);
        if (r.hit) { tx = r.x; ty = r.y; } else { tx = ox - u.x * legLen * 0.8; ty = oy - u.y * legLen * 0.8; }
      } else { tx = ox - u.x * this.rideH * 0.8 + t.x * offs[k] * 0.5; ty = oy - u.y * this.rideH * 0.8 + t.y * offs[k] * 0.5; }
      this.stepLimb(L, tx, ty, grounded, 7 * PX, this.legs[(k + 2) % 4], dt, 7 + Math.abs(velT) / 45);
    }
  }

  render(fb) {
    if (this.dead) return;
    const cx = this.x / PX, cy = this.y / PX, z = Math.sqrt(this.size), b = this.bodyUp;
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, 6 * z, DASH_GHOST);
    // Crystal spike legs.
    for (const L of this.legs) {
      const fx = L.x / PX, fy = L.y / PX;
      fb.line(cx, cy, fx, fy, CRY_C.dark);
      fb.line(cx + 1, cy, fx + 0.5, fy, CRY_C.mid);
      fb.put(fx, fy, CRY_C.glow);
    }
    // Lance.
    if (this.lance) {
      const l = this.lance, k = l.t / l.max;
      const x0 = l.x0 / PX, y0 = l.y0 / PX, x1 = l.x1 / PX, y1 = l.y1 / PX;
      const d = norm(x1 - x0, y1 - y0), px = -d.y, py = d.x;
      fb.line(x0 + px, y0 + py, x1, y1, CRY_C.dark);
      fb.line(x0 - px, y0 - py, x1, y1, CRY_C.mid);
      fb.line(x0, y0, x1, y1, k > 0.5 ? CRY_C.glow : CRY_C.light);
    }
    // Body cluster, oriented to the surface.
    const ang0 = Math.atan2(b.y, b.x);
    for (const s of this.body) {
      const a = ang0 + s.a;
      drawCrystal(fb, cx - b.x * 2 * z, cy - b.y * 2 * z, Math.cos(a), Math.sin(a), s.len * z, s.w * z, CRY_C.dark, s.a === 0 ? CRY_C.light : CRY_C.mid, CRY_C.glow);
    }
    // Charging glow.
    if (this.charge > 0) {
      for (let k = 0; k < 6; k++) {
        const a = this.t * 6 + k * TAU / 6, r = 9 * z * (1 - this.charge * 0.5);
        fb.blend(cx + Math.cos(a) * r, cy + Math.sin(a) * r, CRY_C.glow, 0.5 + this.charge * 0.5);
      }
    }
    // Guns are grown onto a crystal arm.
    if (this.wkind() !== 'shards') {
      const h = this.gunHand();
      fb.line(cx, cy, h.x / PX, h.y / PX, CRY_C.mid);
      this.renderGun(fb, h);
    }
    if (this.hurtT > 0) fb.disc(cx, cy, 6 * z, HURT_TINT);
  }
}
