// More escaped test subjects. Each is a Player subclass: shared health, eating
// and stolen guns, plus its own procedural body and natural attack (slot 1),
// all built on the pixel gore. Nobody grows for now.
//   Eye     - flies; two tendrils tear small chunks out of people. Fragile.
//   Slime   - a real particle fluid. Rolls over someone to engulf them, holds
//             LMB to dissolve them. RMB melts into a hidden puddle that flows
//             and drips off ledges.
//   Crystal - a walking geode. Throws crystal spears that impale and pin
//             (hold to charge a harder throw). Slow and armoured.
//   Swarm   - dozens of individual flies. Hold LMB and they strip pixels off
//             whatever is under the cursor, one bite at a time.
'use strict';

// Shove loose ragdoll parts out of a circle.
function pushFromCircle(npcs, x, y, R, skip) {
  for (const npc of npcs) {
    if (npc === skip) continue;
    for (const p of npc.rag.parts) {
      if (p.pin || p.held) continue;
      const r = R + p.r, d2 = dist2(p.x, p.y, x, y);
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1;
      p.x += (p.x - x) / d * (r - d) * 0.5; p.y += (p.y - y) / d * (r - d) * 0.5;
    }
  }
}

// A random filled body pixel of `q` within `reach` of (x, y), or null.
function pixelNear(q, x, y, reach, tries = 16) {
  const F = q.frame();
  for (let k = 0; k < tries; k++) {
    const idx = randi(0, q.col.length - 1);
    if (!q.col[idx]) continue;
    const [px, py] = q.cellWorld(idx, F);
    if (dist2(px, py, x, y) < reach * reach) return { q, idx, x: px, y: py };
  }
  return null;
}

// ================================================================== EYE
const TENDRILS = { name: 'TENDRILS', cool: 0, kind: 'tendrils' };
const EYE_C = {
  out: hexc('#3a1418'), sclera: hexc('#f1ece4'), shade: hexc('#cfc4b6'), vein: hexc('#c23b3b'), vein2: hexc('#e27a6e'),
  iris: hexc('#c9521b'), iris2: hexc('#f08a3a'), pupil: hexc('#120405'), lid: hexc('#7e2a36'),
};
const EYE_REACH = 85;          // tendril reach (world units)
const EYE_RIP_EVERY = 0.3;     // seconds between bites, per tendril

class Eye extends Player {
  static creatureName = 'EYE';
  static weaponList = [TENDRILS, ...WEAPONS];
  static hasTentacle = false;
  static rideH = 30;
  static dmgTaken = 1.3;       // a big soft eyeball: everything hurts it
  static help = [['LMB HOLD', 'TENDRILS TEAR CHUNKS (SLOW)'], ['WASD', 'FLY (TAKES 1.3X DAMAGE)']];

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = 1;
    this.look = { x: 1, y: 0 };
    this.attacking = false;
    this.tendrils = [0, 1].map(() => ({ x: this.x, y: this.y, q: null, idx: -1, rip: 0, ph: rand(0, 6) }));
    this.nerve = [];
    this.blinkT = rand(2, 5); this.blink = 0;
    this.veins = [];
    for (let v = 0; v < 7; v++) {
      const line = [];
      let a = rand(0, TAU), r = 0.98;
      for (let k = 0; k < 4; k++) { line.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); a += rand(-0.25, 0.25); r -= rand(0.08, 0.14); }
      this.veins.push(line);
    }
    this.coreR = this.eyeR() * PX * 0.9;
    this.maxHp = 70; this.hp = 70;
    for (let i = 0; i < 8; i++) this.nerve.push({ x: this.x, y: this.y + i * 5 });
  }

  eyeR() { return 7; }
  buildPieces() { this.pieces = []; }
  flySpeed() { return this.attacking ? 110 : 220; }

  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { return { x: this.x + this.aim.x * this.eyeR() * PX * 0.5, y: this.y + this.eyeR() * PX + 8 }; }
  muzzle() { const h = this.gunHand(); return { x: h.x + this.aim.x * 8, y: h.y + this.aim.y * 8 }; }
  box() { const r = this.eyeR() * PX + 6; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) { const r = this.eyeR() * PX; return !this.dead && dist2(x, y, this.x, this.y) < r * r; }
  pushBodies(npcs) { if (!this.dead) pushFromCircle(npcs, this.x, this.y, this.eyeR() * PX); }

  // Free flight with a gentle bob. Shift dashes. (The swarm flies the same way.)
  move(dt) {
    const map = this.game.map;
    const ix = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
    const iy = (Input.down('KeyS') || Input.down('ArrowDown') ? 1 : 0) - (Input.down('KeyW') || Input.down('ArrowUp') || Input.down('Space') ? 1 : 0);
    const il = Math.hypot(ix, iy);
    this.dashCool -= dt;
    if ((Input.hit('ShiftLeft') || Input.hit('ShiftRight')) && this.dashCool <= 0) {
      const d = il ? { x: ix / il, y: iy / il } : this.aim;
      this.dashDx = d.x; this.dashDy = d.y; this.dashT = 0.16; this.dashCool = 0.7;
      this.rammed.clear();
      Sfx.dash();
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDx * 850; this.vy = this.dashDy * 850;
      this.trail.push({ x: this.x, y: this.y, t: 0.22 });
    } else {
      const sp = this.flySpeed();
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

  // A random body pixel of someone in front of us, within reach.
  pickPixel(reach) {
    const cands = [];
    for (const npc of this.game.npcs) for (const q of npc.rag.pieces) {
      const dx = q.bc.x - this.x, dy = q.bc.y - this.y, d = Math.hypot(dx, dy);
      if (d > reach + q.bc.r || q.count <= 0) continue;
      if (d > 20 && (dx * this.aim.x + dy * this.aim.y) / d < 0.35) continue;
      cands.push(q);
    }
    return cands.length ? pixelNear(pick(cands), this.x, this.y, reach) : null;
  }

  // Hold LMB: two tendrils lash out and tear small chunks off whatever you aim
  // at. Slow while doing it, and the eye is fragile: pick your moment.
  natural(dt, held) {
    const g = this.game, R = this.eyeR() * PX;
    this.attacking = held;
    for (const T of this.tendrils) {
      T.ph += dt * 9; T.rip -= dt;
      let tgt = null;
      if (held) {
        if (T.q && T.q.owner.pieces.includes(T.q) && T.q.col[T.idx]) {
          const [x, y] = T.q.cellWorld(T.idx, T.q.frame());
          if (dist(x, y, this.x, this.y) < EYE_REACH * 1.15) tgt = { x, y };
        }
        if (!tgt) {
          T.q = null;
          const pk = this.pickPixel(EYE_REACH);
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
      const d = dist(T.x, T.y, tgt.x, tgt.y), step = 700 * dt;
      if (d > step) { T.x += (tgt.x - T.x) / d * step; T.y += (tgt.y - T.y) / d * step; }
      else { T.x = tgt.x; T.y = tgt.y; }
      if (d < 6 && T.rip <= 0) {
        T.rip = EYE_RIP_EVERY;
        const removed = g.burnAt(T.x, T.y, 0.8, 0.85, 0.1, 'tendril', 0.35, T.x - this.x, T.y - this.y);
        if (removed) {
          // The torn-off bits get pulled back into the eye.
          for (let k = 0; k < Math.min(4, removed); k++) {
            g.blood.spawn(T.x, T.y, (this.x - T.x) * 2.5 + rand(-60, 60), (this.y - T.y) * 2.5 + rand(-60, 60), 2, pick(FLESH));
          }
          this.feed(removed * 0.3);
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
    for (const n of this.nerve) {
      n.y += dt * 40;
      const d = dist(n.x, n.y, prev.x, prev.y) || 1;
      n.x = prev.x + (n.x - prev.x) / d * 4.5; n.y = prev.y + (n.y - prev.y) / d * 4.5;
      prev = n;
    }
  }

  render(fb) {
    if (this.dead) return;
    const cx = this.x / PX, cy = this.y / PX, r = this.eyeR();
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, r, DASH_GHOST);
    const nv = this.nerve;
    for (let i = nv.length - 1; i >= 0; i--) fb.disc(nv[i].x / PX, nv[i].y / PX, lerp(1.8, 0.7, i / nv.length), TENT_OUT);
    for (let i = nv.length - 1; i >= 0; i--) fb.put(nv[i].x / PX, nv[i].y / PX, TENT_MID);
    for (const T of this.tendrils) {
      const tx = T.x / PX, ty = T.y / PX;
      const d = dist(cx, cy, tx, ty) || 1, ux = (tx - cx) / d, uy = (ty - cy) / d;
      const N = Math.max(3, Math.ceil(d));
      for (let s = 0; s <= N; s++) {
        const f = s / N, w = Math.sin(f * 9 - T.ph) * 1.2 * Math.sin(Math.PI * f);
        fb.put(cx + ux * d * f - uy * w, cy + uy * d * f + ux * w, s % 3 ? TENT_OUT : TENT_MID);
      }
      fb.put(tx, ty, TENT_CLAW);
    }
    if (this.wkind() !== 'tendrils') {
      const h = this.gunHand();
      fb.line(cx, cy + r * 0.7, h.x / PX, h.y / PX, TENT_OUT);
      this.renderGun(fb, h);
    }
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
    fb.disc(ix, iy, r * 0.2 + (this.attacking ? 0.6 : 0), EYE_C.pupil);
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
// A blob of fluid particles. Solid: they're pulled toward the core (which
// crawls like every other creature) and cling to each other, so it wobbles,
// sags and drips. Liquid: the pull is gone and cohesion is weak, so it spreads
// into a puddle that flows along the floor and pours off ledges.
const DISSOLVE = { name: 'DISSOLVE', cool: 0, kind: 'dissolve' };
const SLIME_C = {
  fill: hexc('#5fd35a'), deep: hexc('#2f8f38'), rim: hexc('#1f6b2a'), hi: hexc('#d9ffc8'), eye: hexc('#0e2a10'),
  pool: hexc('#3e9c3f'), poolRim: hexc('#1d4f22'),
};
const SLIME_N = 90;                  // particles
const SLIME_PR = 4.5;                // particle collision radius (world)
const SLIME_REST = SLIME_PR * 1.7;   // preferred spacing
const SLIME_CELL = 11;               // spatial hash cell

class Slime extends Player {
  static creatureName = 'SLIME';
  static weaponList = [DISSOLVE, ...WEAPONS];
  static hasTentacle = false;
  static bleeds = false;
  static rideH = 24;
  static help = [['ROLL ONTO', 'ENGULF SOMEONE'], ['LMB HOLD', 'DISSOLVE THEM  (E SPITS OUT)'], ['RMB', 'MELT INTO A HIDDEN PUDDLE']];

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.maxHp = 130; this.hp = 130;
    this.moveSpeed = 210;
    this.coreR = 12;
    this.liquid = false;
    this.hidden = false;
    this.toggleCool = 0;
    this.victim = null;          // { npc, offs: Map(particle -> {ox, oy}), esc }
    this.dissolveT = 0;
    this.dripT = 0;
    this.flowX = 0;
    this.spawnGoo();
  }

  spawnGoo() {
    this.goo = [];
    const Rb = Math.sqrt(SLIME_N) * SLIME_REST * 0.5;
    for (let i = 0; i < SLIME_N; i++) {
      const r = Math.sqrt((i + 0.5) / SLIME_N) * Rb, a = i * 2.39996;
      const x = this.x + Math.cos(a) * r, y = this.y + Math.sin(a) * r;
      this.goo.push({ x, y, px: x, py: y, ground: false, free: 0, bub: Math.random() < 0.06 });
    }
  }

  rmbLabel() { return this.liquid ? 'HIDDEN - RMB' : 'RMB MELT'; }
  blobR() { return Math.sqrt(SLIME_N) * SLIME_REST * 0.5; }
  centroid() {
    let x = 0, y = 0;
    for (const p of this.goo) { x += p.x; y += p.y; }
    return { x: x / this.goo.length, y: y / this.goo.length };
  }

  buildPieces() { this.pieces = []; }
  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { const R = this.blobR() * 0.45; return { x: this.x + this.aim.x * R, y: this.y + this.aim.y * R }; }
  muzzle() { const R = this.blobR(); return { x: this.x + this.aim.x * R, y: this.y + this.aim.y * R }; }
  box() { const r = this.blobR() + 6; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) {
    if (this.dead || this.liquid) return false;           // a puddle can't be shot
    const r = this.blobR() * 0.85;
    return dist2(x, y, this.x, this.y) < r * r;
  }
  // Free: people walk (or get rolled) right into the goo. Full: others bounce off.
  pushBodies(npcs) {
    if (this.dead || this.liquid || !this.victim) return;
    pushFromCircle(npcs, this.x, this.y, this.blobR() * 0.7, this.victim.npc);
  }

  hurt(dmg, dx, dy, x, y) {
    const before = this.hp;
    super.hurt(dmg, dx, dy, x, y);
    if (this.hp < before) for (let k = 0; k < 5; k++) this.game.blood.spawn(x, y, -(dx || 0) * 200 + rand(-120, 120), -(dy || 0) * 200 + rand(-200, 40), 2, SLIME_C.fill);
  }

  respawn() {
    this.release(false);
    this.liquid = false; this.hidden = false; this.disarmed = false;
    super.respawn();
    this.spawnGoo();
  }

  die() {
    this.release(false);
    this.hidden = false;
    super.die();
    for (const p of this.goo) this.game.blood.spawn(p.x, p.y, rand(-300, 300), rand(-450, 0), 2.5, pick([SLIME_C.fill, SLIME_C.deep]));
  }

  release(fling) {
    const V = this.victim;
    if (!V) return;
    this.victim = null;
    V.npc.grabbed = false;
    if (V.npc.alive) V.npc.knock(1.2);
    if (fling) for (const p of V.offs.keys()) p.impulse(this.aim.x * 650 + rand(-60, 60), this.aim.y * 650 - 140);
  }

  setLiquid(on) {
    this.liquid = on; this.hidden = on; this.disarmed = on;
    this.toggleCool = 0.5;
    if (on) {
      this.release(false);
      this.game.fx.text(this.x, this.y - 30, 'MELT', '#9be89a');
    } else {
      // Pull back together around the puddle's centre.
      const c = this.centroid();
      const b = { x: c.x, y: c.y - 6, r: this.coreR };
      this.game.map.pushCircle(b);
      this.x = b.x; this.y = b.y; this.vx = this.vy = 0;
      this.up = { x: 0, y: -1 };
    }
    Sfx.squelch();
  }

  move(dt) {
    if (!this.liquid) {
      this.moveSpeed = this.victim ? (this.attacking ? 75 : 140) : 210;
      super.move(dt);
      return;
    }
    // Liquid: the puddle is the body. Left/right make it flow.
    const ix = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
    this.flowX = ix;
    // The core leads the flow sideways but can't wander off from the goo.
    const c = this.centroid(), ox = this.x, oy = this.y;
    this.x = lerp(this.x + ix * 120 * dt, c.x, 0.04);
    this.y = c.y;
    this.vx = (this.x - ox) / dt; this.vy = (this.y - oy) / dt;
    this.grip = 0; this.onGround = false;
  }

  // Solid: rolling over someone engulfs them; hold LMB to dissolve them, E to
  // spit them out. RMB toggles liquid.
  natural(dt, held) {
    const g = this.game;
    this.attacking = held;
    this.toggleCool -= dt;
    if (Input.mouse.pressed[2] && this.toggleCool <= 0) this.setLiquid(!this.liquid);
    if (this.liquid) return;

    // Engulf one person whose middle is inside the blob.
    if (!this.victim) {
      const R = this.blobR() * 0.8;
      for (const npc of g.npcs) {
        if (!npc.rag.pieces.length || !npc.rag.parts.some((p) => npc.main.has(p) && !p.pin && dist2(p.x, p.y, this.x, this.y) < R * R)) continue;
        const offs = new Map(), lim = this.blobR() * 0.45;
        for (const p of npc.rag.parts) {
          if (p.pin || dist2(p.x, p.y, this.x, this.y) > (this.blobR() * 1.6) ** 2) continue;
          const d = dist(p.x, p.y, this.x, this.y) || 1, k = Math.min(1, lim / d) * 0.8;
          offs.set(p, { ox: (p.x - this.x) * k, oy: (p.y - this.y) * k });
        }
        if (!offs.size) continue;
        this.victim = { npc, offs, esc: 0 };
        npc.grabbed = true;
        Sfx.squelch();
        if (npc.alive) npc.say(pick(["IT'S GOT ME", 'I CANT MOVE', 'GET IT OFF']), 1.5);
        break;
      }
    }
    const V = this.victim;
    if (!V) return;
    // The victim floats inside the goo; struggling works if you don't finish them.
    for (const [p, o] of V.offs) {
      if (!V.npc.rag.parts.includes(p) || p.pin) { V.offs.delete(p); continue; }
      const tx = this.x + o.ox, ty = this.y + o.oy;
      p.x = lerp(p.x, tx, 0.12); p.y = lerp(p.y, ty, 0.12);
      p.px = lerp(p.px, p.x, 0.6); p.py = lerp(p.py, p.y, 0.6);
    }
    V.npc.grabbed = true;
    if (V.npc.alive) {
      V.npc.stun = Math.max(V.npc.stun, 0.3);
      V.esc += dt * (held ? 0.08 : 0.2);
      if (V.esc >= 1) { V.npc.say('GOT FREE', 1.2); this.release(true); return; }
    }
    if (Input.hit('KeyE')) { this.release(true); Sfx.squelch(); return; }
    let left = 0;
    for (const q of V.npc.rag.pieces) left += q.count;
    if (!V.offs.size || left < 20) {
      // Nothing left worth holding: whatever remains melts away.
      if (left < 20) {
        V.npc.rag.pieces = [];
        V.npc.rag.refreshTopology('eaten', this.x, this.y);
        for (const s of g.spikes) if (s.state === 'lodged' && s.host.rag === V.npc.rag) s.state = 'dead';
        g.fx.text(this.x, this.y - 40, 'DISSOLVED', '#9be89a');
        this.heal(15);
      }
      this.release(false);
      return;
    }
    this.dissolveT -= dt;
    if (held && this.dissolveT <= 0) {
      this.dissolveT = 0.25;
      const qs = V.npc.rag.pieces.filter((q) => q.count > 0);
      const pk = qs.length && pixelNear(pick(qs), this.x, this.y, this.blobR() * 2);
      if (pk) {
        const n = g.burnAt(pk.x, pk.y, 1.0, 0.7, 0.35, 'acid', 0.25);
        if (n) {
          this.feed(n * 0.3);
          if (Math.random() < 0.4) g.fx.spark(pk.x, pk.y, rand(-20, 20), -60, 0.4, '#b6f5a3');
          if (Math.random() < 0.12) Sfx.squelch();
        }
      }
    }
  }

  // The fluid step (runs every tick).
  computePose(dt) {
    if (!this.goo || !dt) return;
    const map = this.game.map, goo = this.goo, liquid = this.liquid;
    const g2 = GRAVITY * dt * dt;
    const pull = liquid ? 0 : 0.045, coh = liquid ? 0.045 : 0.1;
    // Drip: now and then a low particle lets go for a moment.
    this.dripT -= dt;
    if (!liquid && this.dripT <= 0) {
      this.dripT = rand(0.25, 0.6);
      const p = pick(goo);
      if (p.y > this.y + this.blobR() * 0.3 && !p.ground) p.free = rand(0.5, 0.9);
    }
    for (const p of goo) {
      let vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
      if (p.ground) vx *= liquid ? 0.93 : 0.85;
      if (liquid && p.ground) vx += (this.flowX * 130 * dt - vx) * 0.12;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + g2;
      p.free -= dt;
      // Liquid: only a gentle sideways pull keeps the puddle together.
      if (liquid) p.x += (this.x - p.x) * 0.0025;
      if (pull && p.free <= 0) {
        const dx = this.x - p.x, dy = this.y - p.y, d = Math.hypot(dx, dy);
        p.x += dx * pull; p.y += dy * pull;
        // Stragglers stuck behind geometry seep back home.
        p.lost = d > this.blobR() * 1.6 ? (p.lost || 0) + dt : 0;
        if (p.lost > 0.8 || d > 250) { p.x = p.px = this.x + rand(-6, 6); p.y = p.py = this.y + rand(-6, 6); p.lost = 0; }
      }
    }
    // Pressure and cohesion between neighbours.
    const grid = new Map(), key = (i, j) => (i + 4096) * 8192 + (j + 4096);
    for (const p of goo) {
      const k = key(Math.floor(p.x / SLIME_CELL), Math.floor(p.y / SLIME_CELL));
      let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(p);
    }
    const R2 = SLIME_REST * 2;
    for (const p of goo) {
      const gi = Math.floor(p.x / SLIME_CELL), gj = Math.floor(p.y / SLIME_CELL);
      for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) {
        const b = grid.get(key(i, j));
        if (!b) continue;
        for (const q of b) {
          if (q === p || q.x < p.x || (q.x === p.x && q.y <= p.y)) continue;   // each pair once
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 > R2 * R2 || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const c = coh * (p.free > 0 || q.free > 0 ? 0.35 : 1);
          const m = d < SLIME_REST ? (SLIME_REST - d) * 0.25 : -(d - SLIME_REST) * c * 0.5;
          const ux = dx / d * m, uy = dy / d * m;
          p.x -= ux; p.y -= uy; q.x += ux; q.y += uy;
        }
      }
    }
    const c = { x: 0, y: 0, r: SLIME_PR };
    for (const p of goo) {
      c.x = p.x; c.y = p.y;
      const n = map.pushCircle(c);
      p.ground = !!n;
      p.x = c.x; p.y = c.y;
    }
  }

  render(fb) {
    if (this.dead) return;
    const liquid = this.liquid;
    if (!liquid && this.wkind() !== 'dissolve') this.renderGun(fb, this.gunHand());
    // Rasterise the particles into a mask, then shade it as one body.
    const rr = liquid ? 2.3 : 2.9;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.goo) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const ax = Math.floor(x0 / PX - rr) - 1, ay = Math.floor(y0 / PX - rr) - 1;
    const W = Math.ceil(x1 / PX + rr) + 2 - ax, H = Math.ceil(y1 / PX + rr) + 2 - ay;
    if (W > 600 || H > 600) return;
    const mask = new Uint8Array(W * H), r2 = rr * rr;
    for (const p of this.goo) {
      const cx = p.x / PX - ax, cy = p.y / PX - ay;
      for (let y = Math.max(0, Math.floor(cy - rr)); y <= Math.min(H - 1, cy + rr); y++)
        for (let x = Math.max(0, Math.floor(cx - rr)); x <= Math.min(W - 1, cx + rr); x++)
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) mask[y * W + x] = 1;
    }
    const fill = liquid ? SLIME_C.pool : SLIME_C.fill, rim = liquid ? SLIME_C.poolRim : SLIME_C.rim;
    const alpha = liquid ? 0.8 : 0.6, hurt = this.hurtT > 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const up = y > 0 && mask[(y - 1) * W + x], dn = y < H - 1 && mask[(y + 1) * W + x];
      const lf = x > 0 && mask[y * W + x - 1], rt = x < W - 1 && mask[y * W + x + 1];
      if (!up || !dn || !lf || !rt) fb.put(ax + x, ay + y, !up && !liquid && (y + ay) * PX < this.y ? SLIME_C.hi : rim);
      else fb.blend(ax + x, ay + y, hurt ? HURT_TINT : (y > 1 && !mask[(y - 2) * W + x] ? SLIME_C.hi : fill), hurt ? 0.5 : alpha);
    }
    for (const p of this.goo) if (p.bub && !liquid) fb.blend(p.x / PX, p.y / PX, SLIME_C.hi, 0.6);
    if (!liquid) {
      // Two beady eyes looking where you aim.
      const ex = this.x / PX + this.aim.x * 4, ey = this.y / PX + this.aim.y * 3 - 3;
      for (const s of [-1.5, 1.5]) { fb.put(ex + s, ey, SLIME_C.eye); fb.put(ex + s, ey - 1, SLIME_C.eye); }
    }
  }
}

// ================================================================== CRYSTAL
// A geode on four stubby rock legs: a lumpy stone shell, hollow inside and
// lined with amethyst, cracked open toward where it's aiming. It grows crystal
// spears in the hollow and throws them. They impale and pin like harpoons.
const SPEAR = { name: 'SPEAR', cool: 0, kind: 'spear' };
const GEO_C = {
  rock: hexc('#463f4f'), rockHi: hexc('#6a6178'), rockLo: hexc('#221e28'), gold: hexc('#e0b84a'),
  cavity: hexc('#1e1030'), ame: hexc('#8b5cd6'), ameHi: hexc('#c9a2ff'), ameLo: hexc('#4d2a8a'), ice: hexc('#bfe9ff'), glow: hexc('#f3ecff'),
};
const GEO_R = 11;                     // shell radius (art px)
const SPEAR_SPEED = [1250, 1900];     // tap .. full charge
const SPEAR_CHARGE = 0.8;             // seconds to full charge
const SPEAR_BONUS = 25;               // extra damage at full charge

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

class CrystalSpear extends Spike {
  constructor(x, y, vx, vy, bonus) {
    super(x, y, vx, vy);
    this.bonus = bonus;
  }

  impale(game, h, dx, dy) {
    const wasAlive = h.npc.alive;
    super.impale(game, h, dx, dy);
    if (this.bonus > 0 && wasAlive) h.npc.damage(this.bonus, 'crystal');
    game.fx.sparks(h.x, h.y, dx, dy, 4, 220, '#c9a2ff');
  }

  embed(game, dx, dy) {
    super.embed(game, dx, dy);
    game.fx.sparks(this.x, this.y, -dx, -dy, 5, 260, '#c9a2ff');
  }

  render(fb) {
    const dx = Math.cos(this.ang), dy = Math.sin(this.ang);
    const tx = this.x / PX, ty = this.y / PX;
    drawCrystal(fb, tx - dx * 18, ty - dy * 18, dx, dy, 18, 4, GEO_C.ameLo, GEO_C.ame, GEO_C.glow);
    fb.line(tx - dx * 14, ty - dy * 14, tx - dx * 3, ty - dy * 3, GEO_C.ameHi);
    fb.put(tx - dx * 6, ty - dy * 6, GEO_C.ice);
  }
}

class Crystal extends Player {
  static creatureName = 'CRYSTAL';
  static weaponList = [SPEAR, ...WEAPONS];
  static hasTentacle = false;
  static bleeds = false;
  static dmgTaken = 0.75;       // stone shell
  static help = [['LMB', 'THROW CRYSTAL SPEAR (HOLD: CHARGE)'], ['', 'SLOW, TAKES 0.75X DAMAGE']];
  static rideH = 36;

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.maxHp = 160; this.hp = 160;
    this.moveSpeed = 190;
    this.coreR = 15;
    this.legs = [0, 1, 2, 3].map(() => ({ x, y: feetY, fx: x, fy: feetY, tx: x, ty: feetY, t: 1, planted: false }));
    // Lumpy shell outline (art px radii) and the crystals lining the hollow.
    this.shell = [];
    for (let i = 0; i < 18; i++) this.shell.push(GEO_R + rand(-1, 1) + (i % 4 === 0 ? 0.8 : 0));
    this.lining = [];
    for (let i = 0; i < 15; i++) this.lining.push({ a: i / 15 * TAU + rand(-0.1, 0.1), len: rand(3, 5.2), ice: Math.random() < 0.3 });
    this.flecks = [0, 1, 2, 3, 4].map(() => ({ a: rand(0, TAU), r: rand(0.8, 0.95) }));
    this.growths = [{ a: -0.4, len: 7, w: 3.2 }, { a: 0.02, len: 10, w: 4 }, { a: 0.42, len: 6, w: 2.8 }, { a: -0.85, len: 4, w: 2.2 }];
    this.holdT = 0; this.charge = 0; this.spearCool = 0; this.holding = false;
  }

  buildPieces() { this.pieces = []; }
  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { return { x: this.x + this.aim.x * GEO_R * 0.8 * PX, y: this.y + this.aim.y * GEO_R * 0.8 * PX }; }
  muzzle() { return { x: this.x + this.aim.x * (GEO_R + 2) * PX, y: this.y + this.aim.y * (GEO_R + 2) * PX }; }
  box() { const r = (GEO_R + 5) * PX; return [this.x - r, this.y - r, this.x + r, this.y + r]; }
  hitTest(x, y) { const r = GEO_R * PX; return !this.dead && dist2(x, y, this.x, this.y) < r * r; }
  pushBodies(npcs) { if (!this.dead) pushFromCircle(npcs, this.x, this.y, GEO_R * PX); }

  hurt(dmg, dx, dy, x, y) {
    const before = this.hp;
    super.hurt(dmg, dx, dy, x, y);
    if (this.hp < before) this.game.fx.sparks(x, y, -(dx || 0), -(dy || 1), 5, 240, pick(['#8b5cd6', '#524a5c', '#c9a2ff']));
  }

  die() {
    super.die();
    const g = this.game;
    for (let k = 0; k < 50; k++) g.blood.spawn(this.x, this.y, rand(-380, 380), rand(-520, 0), 2.5, pick([GEO_C.rock, GEO_C.rockHi, GEO_C.ame, GEO_C.ameHi, GEO_C.gold]));
    g.fx.sparks(this.x, this.y, 0, -1, 20, 420, '#c9a2ff');
  }

  // Tap LMB: throw a spear. Hold to grow it bigger and throw it harder.
  natural(dt, held, pressed, released) {
    this.spearCool -= dt;
    if (pressed && this.spearCool <= 0) { this.holding = true; this.holdT = 0; }
    if (!this.holding) { this.charge = 0; return; }
    if (held) { this.holdT += dt; this.charge = clamp(this.holdT / SPEAR_CHARGE, 0, 1); }
    if (released || !held) {
      this.throwSpear(this.charge);
      this.holding = false; this.holdT = 0; this.charge = 0;
    }
  }

  throwSpear(charge) {
    const g = this.game, m = this.muzzle(), a = this.aim;
    const sp = lerp(SPEAR_SPEED[0], SPEAR_SPEED[1], charge);
    g.spikes.push(new CrystalSpear(m.x, m.y, a.x * sp, a.y * sp, Math.round(SPEAR_BONUS * charge)));
    this.spearCool = 0.9;
    this.recoil = 1;
    this.vx -= a.x * 60 * (1 + charge);
    g.fx.sparks(m.x, m.y, a.x, a.y, 5 + Math.round(charge * 8), 300, '#c9a2ff');
    if (charge > 0.9) g.shake(1);
    Sfx.whip(); Sfx.clang();
  }

  computePose(dt) {
    if (!this.legs) return;
    const map = this.game.map;
    const grounded = this.grip > 0.25 && this.dashT <= 0;
    const u = grounded ? this.up : { x: 0, y: -1 };
    const t = { x: -u.y, y: u.x };
    const kb = dt ? 1 - Math.exp(-dt * 8) : 1;
    this.bodyUp = norm(lerp(this.bodyUp.x, u.x, kb), lerp(this.bodyUp.y, u.y, kb));
    const velT = this.vx * t.x + this.vy * t.y;
    const legLen = this.rideH * 1.8;
    const offs = [-11, -4, 4, 11];
    for (let k = 0; k < 4; k++) {
      const L = this.legs[k];
      const off = offs[k] * PX + clamp(velT * 0.04, -8, 8);
      const ox = this.x + t.x * off, oy = this.y + t.y * off;
      let tx, ty;
      if (grounded) {
        const r = map.raycast(ox, oy, -u.x, -u.y, legLen);
        if (r.hit) { tx = r.x; ty = r.y; } else { tx = ox - u.x * legLen * 0.8; ty = oy - u.y * legLen * 0.8; }
      } else { tx = ox - u.x * this.rideH * 0.9; ty = oy - u.y * this.rideH * 0.9; }
      this.stepLimb(L, tx, ty, grounded, 6 * PX, this.legs[(k + 2) % 4], dt, 6 + Math.abs(velT) / 50);
    }
  }

  render(fb) {
    if (this.dead) return;
    const cx = this.x / PX, cy = this.y / PX, b = this.bodyUp;
    const tx = -b.y, ty = b.x;
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, GEO_R, DASH_GHOST);
    // Stubby rock legs (two-bone, knees out).
    for (let k = 0; k < 4; k++) {
      const L = this.legs[k], side = k < 2 ? -1 : 1;
      const hx = cx + tx * side * (k % 3 === 0 ? 6.5 : 3) - b.x * 4, hy = cy + ty * side * (k % 3 === 0 ? 6.5 : 3) - b.y * 4;
      const j = ik2(hx, hy, L.x / PX, L.y / PX, 6, 6.5, tx * side + b.x, ty * side + b.y);
      for (const [dx, dy, c] of [[0, 0, GEO_C.rockLo], [1, 0, GEO_C.rock], [0, 1, GEO_C.rockLo]]) {
        fb.line(hx + dx, hy + dy, j.jx + dx, j.jy + dy, c);
        fb.line(j.jx + dx, j.jy + dy, j.ex + dx, j.ey + dy, c);
      }
      fb.put(j.jx, j.jy, GEO_C.rockHi);
      fb.put(j.ex, j.ey, GEO_C.gold);
    }
    // Crystal growths on top of the shell.
    const up = Math.atan2(b.y, b.x);
    for (const s of this.growths) {
      const a = up + s.a;
      drawCrystal(fb, cx + Math.cos(a) * (GEO_R - 2), cy + Math.sin(a) * (GEO_R - 2), Math.cos(a), Math.sin(a), s.len, s.w, GEO_C.ameLo, GEO_C.ame, GEO_C.glow);
    }
    // Shell, rotated with the body.
    const rot = up + Math.PI / 2, n = this.shell.length;
    const outer = this.shell.map((r, i) => { const a = rot + i / n * TAU; return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }; });
    fillPoly(fb, outer, GEO_C.rock);
    for (let i = 0; i < n; i++) {
      const p = outer[i], q = outer[(i + 1) % n];
      const lit = (p.y + q.y) / 2 < cy - 2 || (p.x + q.x) / 2 < cx - 3;
      fb.line(p.x, p.y, q.x, q.y, lit ? GEO_C.rockHi : GEO_C.rockLo);
    }
    for (const f of this.flecks) {
      const a = rot + f.a, r = GEO_R * f.r;
      fb.put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, GEO_C.gold);
    }
    // The hollow, cracked open toward the aim.
    const aimA = Math.atan2(this.aim.y, this.aim.x);
    const inner = this.shell.map((r, i) => { const a = rot + i / n * TAU; return { x: cx + Math.cos(a) * r * 0.66, y: cy + Math.sin(a) * r * 0.66 }; });
    fillPoly(fb, inner, GEO_C.cavity);
    const gap = 0.5;
    fillPoly(fb, [{ x: cx, y: cy }, { x: cx + Math.cos(aimA - gap) * (GEO_R + 1.5), y: cy + Math.sin(aimA - gap) * (GEO_R + 1.5) }, { x: cx + Math.cos(aimA + gap) * (GEO_R + 1.5), y: cy + Math.sin(aimA + gap) * (GEO_R + 1.5) }], GEO_C.cavity);
    // Crystal lining: points inward from the hollow's wall.
    for (const c of this.lining) {
      const a = rot + c.a;
      let da = Math.abs(((a - aimA) % TAU + TAU) % TAU); if (da > Math.PI) da = TAU - da;
      if (da < gap + 0.1) continue;
      const wx = cx + Math.cos(a) * GEO_R * 0.64, wy = cy + Math.sin(a) * GEO_R * 0.64;
      drawCrystal(fb, wx, wy, -Math.cos(a), -Math.sin(a), c.len, 2.4, c.ice ? GEO_C.ame : GEO_C.ameLo, c.ice ? GEO_C.ice : GEO_C.ameHi, 0);
    }
    // The next spear growing in the hollow.
    if (this.wkind() === 'spear') {
      const ready = this.spearCool <= 0, k = this.holding ? 0.45 + this.charge * 0.55 : ready ? 0.4 : 0.15;
      const len = 5 + 9 * k;
      drawCrystal(fb, cx - this.aim.x * 4, cy - this.aim.y * 4, this.aim.x, this.aim.y, len, 1.8 + k * 1.8, GEO_C.ame, GEO_C.ameHi, GEO_C.glow);
      if (this.charge > 0) {
        for (let i = 0; i < 5; i++) {
          const a = this.t * 7 + i * TAU / 5, r = 4 + 4 * (1 - this.charge);
          fb.blend(cx + Math.cos(a) * r, cy + Math.sin(a) * r, GEO_C.glow, 0.4 + this.charge * 0.5);
        }
      }
    } else {
      this.renderGun(fb, this.gunHand());
    }
    if (this.hurtT > 0) fillPoly(fb, outer, HURT_TINT, 0.35);
  }
}

// ================================================================== SWARM
// Not one body: dozens of flies, each with its own little steering. The core
// only says where the swarm wants to be. Health is the number of flies alive;
// bullets and swats kill individual flies, eating breeds new ones.
const DEVOUR = { name: 'DEVOUR', cool: 0, kind: 'devour' };
const FLY_MAX = 45;
const FLY_EAT = 0.8;          // seconds per bite, per fly
const SWARM_FOCUS = 40;       // flies feed within this radius of the cursor
const FLY_C = [hexc('#15140f'), hexc('#26241a'), hexc('#2f3a1c')];
const FLY_WING = hexc('#c8d4dc'), FLY_RED = hexc('#a3101a');

class Swarm extends Player {
  static creatureName = 'SWARM';
  static weaponList = [DEVOUR, ...WEAPONS];
  static hasTentacle = false;
  static bleeds = false;
  static rideH = 24;
  static help = [['LMB HOLD', 'FLIES EAT WHAT IS UNDER CURSOR'], ['', 'HEALTH = FLIES ALIVE']];

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.coreR = 6;
    this.attacking = false;
    this.flies = [];
    this.syncFlies();
  }

  // Health is flies: setting it breeds or drops flies to match.
  get hp() { return this._hp ?? 0; }
  set hp(v) { this._hp = clamp(v, 0, this.maxHp || 100); if (this.flies) this.syncFlies(); }
  syncFlies() {
    const want = Math.ceil(this._hp / this.maxHp * FLY_MAX - 1e-6);
    while (this.flies.length < want) {
      const src = this.flies.length ? pick(this.flies) : { x: this.x, y: this.y };
      this.flies.push({ x: src.x + rand(-3, 3), y: src.y + rand(-3, 3), vx: 0, vy: 0, ph: rand(0, 10), a: rand(0, TAU), w: rand(1.5, 3.5), r: rand(8, 26), q: null, idx: -1, npc: null, eat: 0 });
    }
    while (this.flies.length > want) this.killFly(randi(0, this.flies.length - 1), false);
  }
  killFly(i, sync = true) {
    const f = this.flies[i];
    this.flies.splice(i, 1);
    this.game.blood.spawn(f.x, f.y, rand(-40, 40), rand(-80, 0), 1, FLY_C[0]);
    if (sync) this._hp = Math.max(0, this._hp - this.maxHp / FLY_MAX);
  }

  buildPieces() { this.pieces = []; }
  flySpeed() { return this.attacking ? 150 : 200; }
  move(dt) { Eye.prototype.move.call(this, dt); }
  get cx() { return this.x; }
  get cy() { return this.y; }
  shoulder() { return { x: this.x, y: this.y }; }
  mouth() { return { x: this.x, y: this.y }; }
  ropeOrigin() { return this.shoulder(); }
  gunHand() { return { x: this.x + this.aim.x * 10, y: this.y + this.aim.y * 10 + 4 }; }
  muzzle() { const h = this.gunHand(); return { x: h.x + this.aim.x * 10, y: h.y + this.aim.y * 10 }; }
  box() {
    let l = this.x, t = this.y, r = this.x, b = this.y;
    for (const f of this.flies) { l = Math.min(l, f.x); r = Math.max(r, f.x); t = Math.min(t, f.y); b = Math.max(b, f.y); }
    return [l - 3, t - 3, r + 3, b + 3];
  }
  hitTest(x, y) {
    if (this.dead) return false;
    for (const f of this.flies) if (dist2(x, y, f.x, f.y) < 16) return true;
    return false;
  }
  pushBodies() {}
  computePose() {}

  // Only the flies near the hit die.
  hurt(dmg, dx, dy, x, y) {
    if (this.dead || this.god || this.dashT > 0 || dmg <= 0) return;
    const n = Math.max(1, Math.round(dmg / 5));
    const near = this.flies.map((f, i) => ({ i, d: dist2(f.x, f.y, x, y) })).filter((o) => o.d < 40 * 40).sort((a, b) => a.d - b.d);
    const kill = near.slice(0, n).map((o) => o.i).sort((a, b) => b - a);
    for (const i of kill) this.killFly(i);
    this.hurtT = 0.2; this.lastHurt = this.t;
    Sfx.hurt();
    if (this.flies.length < 5) this.die();
  }

  respawn() { this.flies = []; super.respawn(); this.syncFlies(); }
  die() {
    for (const f of this.flies) this.game.blood.spawn(f.x, f.y, rand(-120, 120), rand(-160, 0), 1, FLY_C[0]);
    this.flies = [];
    super.die();
  }

  // Hold LMB: flies peel off toward the cursor and each one eats pixels off
  // whoever is there, one at a time. Conscious victims swat them.
  natural(dt, held) {
    const g = this.game, map = g.map;
    this.attacking = held;
    const m = g.mouseWorld();
    const cands = [];
    if (held) {
      for (const npc of g.npcs) for (const q of npc.rag.pieces) {
        if (q.count <= 0) continue;
        if (dist(q.bc.x, q.bc.y, m.x, m.y) > SWARM_FOCUS + q.bc.r || dist(q.bc.x, q.bc.y, this.x, this.y) > 240 + q.bc.r) continue;
        cands.push({ q, npc });
      }
    }
    const gunOut = this.wkind() !== 'devour', h = gunOut ? this.gunHand() : null;
    let acquired = 0;
    for (let i = this.flies.length - 1; i >= 0; i--) {
      const f = this.flies[i];
      f.ph += dt * 40;
      let tx, ty, max = 260;
      if (held) {
        if (f.q && !(f.q.owner.pieces.includes(f.q) && f.q.col[f.idx])) {
          // Pixel gone: try another one on the same piece.
          const pk = f.q.owner.pieces.includes(f.q) && f.q.count > 0 ? pixelNear(f.q, m.x, m.y, SWARM_FOCUS, 6) : null;
          if (pk) f.idx = pk.idx; else f.q = null;
        }
        if (!f.q && cands.length && acquired < 6) {
          acquired++;
          const c = pick(cands), pk = pixelNear(c.q, m.x, m.y, SWARM_FOCUS, 8);
          if (pk) { f.q = pk.q; f.idx = pk.idx; f.npc = c.npc; f.eat = rand(-0.4, 0); }
        }
      } else f.q = null;
      if (f.q) {
        [tx, ty] = f.q.cellWorld(f.idx, f.q.frame());
        max = 420;
      } else if (held) {
        tx = m.x + Math.cos(this.t * f.w + f.a) * f.r * 0.8; ty = m.y + Math.sin(this.t * f.w * 1.3 + f.a) * f.r * 0.6;
        if (dist(tx, ty, this.x, this.y) > 240) { const d = norm(tx - this.x, ty - this.y); tx = this.x + d.x * 240; ty = this.y + d.y * 240; }
      } else {
        const ox = h && i % 2 ? h.x : this.x, oy = h && i % 2 ? h.y : this.y, s = h && i % 2 ? 0.45 : 1;
        tx = ox + Math.cos(this.t * f.w + f.a) * f.r * s; ty = oy + Math.sin(this.t * f.w * 1.3 + f.a) * f.r * 0.7 * s;
      }
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      if (f.q && d < 3.5) {
        // Latched on and chewing.
        f.x = tx + rand(-0.8, 0.8); f.y = ty + rand(-0.8, 0.8); f.vx = f.vy = 0;
        f.eat += dt;
        if (f.eat >= FLY_EAT) {
          f.eat = 0;
          const n = g.burnAt(tx, ty, 0.3, 1, 0.1, 'swarm', 0.1);
          if (n) { this.feed(n * 0.15); if (Math.random() < 0.15) g.blood.spawn(tx, ty, rand(-60, 60), rand(-80, 0), 1); }
        }
        // A conscious victim swats one fly every so often.
        const v = f.npc;
        if (v && v.alive && !v.downed && g.time >= (v.swatAt || 0)) {
          v.swatAt = g.time + rand(0.35, 0.8);
          this.killFly(i);
          if (Math.random() < 0.3) v.say(pick(['GET OFF', 'AAGH', 'THEY BITE']), 1);
          continue;
        }
        continue;
      }
      const sp = Math.min(max, d * 8);
      const k = Math.min(1, dt * 8);
      f.vx += (dx / d * sp - f.vx) * k + rand(-1, 1) * 900 * dt;
      f.vy += (dy / d * sp - f.vy) * k + rand(-1, 1) * 900 * dt;
      const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
      if (map.solidPx(nx, ny)) { f.vx *= -0.3; f.vy *= -0.3; } else { f.x = nx; f.y = ny; }
    }
    if (this.flies.length < 5) { this.die(); return; }
    // Keep a little space between flies.
    const F = this.flies;
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
      const a = F[i], b = F[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 > 9 || d2 < 1e-6 || a.q || b.q) continue;
      const d = Math.sqrt(d2), m2 = (3 - d) * 0.25;
      a.x -= dx / d * m2; a.y -= dy / d * m2; b.x += dx / d * m2; b.y += dy / d * m2;
    }
  }

  render(fb) {
    if (this.dead) return;
    if (this.wkind() !== 'devour') this.renderGun(fb, this.gunHand());
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i], x = f.x / PX, y = f.y / PX;
      fb.put(x, y, this.hurtT > 0 && i % 3 === 0 ? HURT_TINT : FLY_C[i % 3]);
      if (f.q) { if ((f.ph | 0) % 3 === 0) fb.put(x, y + 1, FLY_RED); }
      const w = (f.ph | 0) % 2;
      fb.blend(x - w, y - 1, FLY_WING, 0.5);
      if (!w) fb.blend(x + 1, y - 1, FLY_WING, 0.5);
    }
  }
}
