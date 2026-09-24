// The Worm: a segmented escapee. The head is the adhesive core (so it moves
// over anything); the body is laid along the exact path the head travelled,
// pressed flat against the surface it was on, so the whole worm flows over
// corners, up walls and across ceilings.
//
// Its natural attack is its mouth: hold LMB to open the jaws, release to snap
// them shut and tear out a chunk. It grows as it eats: longer, thicker, a bigger
// bite; once big enough, opening the jaws on someone catches them, and you can
// carry them in your mouth before biting down.
'use strict';

const BITE = { name: 'BITE', cool: 0, kind: 'bite' };
const WORM_C = {
  out: hexc('#24080f'), dark: hexc('#5e1d2c'), mid: hexc('#9c3f52'), light: hexc('#d27684'),
  belly: hexc('#e2ab9c'), jaw: hexc('#efe0c4'), jawD: hexc('#a8987c'), eye: hexc('#ffe14a'), mouth: hexc('#30000a'),
};
const WORM_HEAD_R = 4.4;        // art px at size 1
const WORM_SPACING = 7.5;       // world units between segments at size 1
const WORM_MAX_SIZE = 2.4;
const WORM_CATCH_SIZE = 1.6;    // big enough to hold a whole person in the jaws

class Worm extends Player {
  static rideH = 14;
  static weaponList = [BITE, ...WEAPONS];
  static creatureName = 'WORM';
  static hasTentacle = false;

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = 1;
    this.segN = 12;
    this.path = [];             // head history, newest first: {x, y, ux, uy}
    this.segs = [];
    this.jaw = 0;               // 0 closed .. 1 wide open
    this.chompCool = 0;
    this.caught = null;         // { npc, p } held in the mouth
    this.headDir = { x: 1, y: 0 };
    this.hump = 0;
    this.applySize();
    this.resetBody();
  }

  applySize() {
    const s = this.size;
    this.coreR = WORM_HEAD_R * PX * s * 0.85;
    this.rideH = Math.max(this.coreR + 3, WORM_HEAD_R * PX * s + 2);
    this.spacing = WORM_SPACING * Math.pow(s, 0.7);
    this.maxHp = Math.round(100 + (s - 1) * 90);
    this.segN = Math.min(22, 12 + Math.floor(this.mass / 260));
  }

  grow(px) {
    const before = this.size;
    this.mass += px;
    this.size = Math.min(WORM_MAX_SIZE, 1 + this.mass / 900);
    this.applySize();
    if (Math.floor(before * 5) !== Math.floor(this.size * 5)) {
      this.game.fx.text(this.x, this.y - 40, this.size >= WORM_CATCH_SIZE && before < WORM_CATCH_SIZE ? 'BIG ENOUGH TO SWALLOW' : 'GROWING', '#ffb3b8');
    }
  }

  resetBody() {
    this.path = [{ x: this.x, y: this.y, ux: 0, uy: -1 }];
    this.segs = [];
    for (let i = 0; i < this.segN; i++) this.segs.push({ x: this.x - i * this.spacing, y: this.y, ux: 0, uy: -1 });
  }

  buildPieces() { this.pieces = []; }

  headR() { return WORM_HEAD_R * this.size; }
  segR(i) {
    const f = i / Math.max(1, this.segs.length - 1);
    return (lerp(3.7, 1.5, f) + Math.sin(f * Math.PI) * 0.4) * this.size;
  }

  get cx() { return this.segs && this.segs.length ? this.segs[Math.min(2, this.segs.length - 1)].x : this.x; }
  get cy() { return this.segs && this.segs.length ? this.segs[Math.min(2, this.segs.length - 1)].y : this.y; }

  mouth() {
    const r = (this.headR() + 1.5) * PX;
    return { x: this.x + this.headDir.x * r, y: this.y + this.headDir.y * r };
  }
  mouthR() { return (2.2 + (this.size - 1) * 3.2) * PX; }
  shoulder() { return { x: this.x, y: this.y }; }
  muzzle() { const m = this.mouth(); return { x: m.x + this.aim.x * 2 * PX, y: m.y + this.aim.y * 2 * PX }; }
  ropeOrigin() { return this.mouth(); }

  box() {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of this.segs) { l = Math.min(l, p.x); r = Math.max(r, p.x); t = Math.min(t, p.y); b = Math.max(b, p.y); }
    const pad = this.headR() * PX + 4;
    return [l - pad, t - pad, r + pad, b + pad];
  }

  hitTest(x, y) {
    if (this.dead) return false;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i], r = (i === 0 ? this.headR() : this.segR(i)) * PX;
      if (dist2(x, y, s.x, s.y) < r * r) return true;
    }
    return false;
  }

  pushBodies(npcs) {
    if (this.dead) return;
    const held = this.caught ? this.caught.npc : null;
    for (const npc of npcs) {
      if (npc === held) continue;
      for (const p of npc.rag.parts) {
        if (p.pin || p.held) continue;
        for (let i = 0; i < this.segs.length; i += 2) {
          const s = this.segs[i], r = this.segR(i) * PX + p.r;
          const d2 = dist2(p.x, p.y, s.x, s.y);
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2) || 1;
          p.x += (p.x - s.x) / d * (r - d) * 0.5; p.y += (p.y - s.y) / d * (r - d) * 0.5;
        }
      }
    }
  }

  respawn() {
    this.dropCaught();
    super.respawn();
    this.mass = 0; this.size = 1;
    this.applySize();
    this.hp = this.maxHp;
    this.resetBody();
  }

  die() {
    const g = this.game;
    this.dropCaught();
    super.die();
    for (const s of this.segs) {
      g.blood.burst(s.x, s.y, 8, 380);
      for (let k = 0; k < 6; k++) g.blood.spawn(s.x, s.y, rand(-380, 380), rand(-500, 0), 2.5, pick([WORM_C.mid, WORM_C.dark, WORM_C.belly]));
    }
  }

  dropCaught() {
    if (!this.caught) return;
    const { npc } = this.caught;
    npc.grabbed = false;
    if (npc.alive) npc.knock(1.5);
    this.caught = null;
  }

  // ---------------------------------------------------------------- bite
  // Hold: jaws open (big worms catch whoever is in them). Release: snap shut.
  natural(dt, held, pressed, released) {
    this.chompCool -= dt;
    this.snapT = this.snapT || 0;
    this.jaw = this.snapT > 0 ? this.jaw : held ? Math.min(1, this.jaw + dt * 7) : Math.max(0, this.jaw - dt * 14);
    const g = this.game, m = this.mouth();
    if (this.caught) {
      const { npc, p } = this.caught;
      if (!npc.rag.parts.includes(p) || p.pin) this.dropCaught();
      else {
        // Carry them in the jaws, still kicking.
        let dx = (m.x - p.x) * 0.35, dy = (m.y - p.y) * 0.35;
        const dl = Math.hypot(dx, dy);
        if (dl > 20) { dx *= 20 / dl; dy *= 20 / dl; }
        p.x += dx; p.y += dy;
        npc.grabbed = true;
        npc.stun = Math.max(npc.stun, 0.5);
      }
    }
    if (held && this.jaw > 0.5 && !this.caught && this.size >= WORM_CATCH_SIZE) {
      const hit = this.partNear(m, this.headR() * PX * 1.6 + 14);
      if (hit && (!hit.npc.alive || hit.npc.main.has(hit.p))) {
        this.caught = hit;
        hit.npc.grabbed = true;
        if (hit.npc.alive) hit.npc.say(pick(['NO NO NO', 'LET GO!', 'AAAAH!']), 1.2);
        Sfx.latch();
      }
    }
    if (released && this.chompCool <= 0 && this.snapT <= 0) {
      // Lunge first; the jaws close a beat later, once the head has arrived.
      const lunge = this.caught ? 150 : 520;
      this.vx += this.aim.x * lunge; this.vy += this.aim.y * lunge;
      this.detachT = 0.12;
      this.snapT = 0.09;
      Sfx.whip();
    }
    if (this.snapT > 0) { this.snapT -= dt; if (this.snapT <= 0) this.chomp(); }
  }

  partNear(m, r) {
    let best = null, bd = r * r;
    for (const npc of this.game.npcs) for (const p of npc.rag.parts) {
      const d = dist2(m.x, m.y, p.x, p.y);
      if (d < bd && !p.pin) { bd = d; best = { npc, p }; }
    }
    return best;
  }

  chomp() {
    const g = this.game;
    this.chompCool = 0.3;
    this.biteT = 0.15;
    this.jaw = 0;
    const m = this.mouth();
    const centres = [m];
    const crushed = this.caught && this.caught.npc.rag.parts.includes(this.caught.p) ? this.caught.npc : null;
    if (crushed) centres.push({ x: this.caught.p.x, y: this.caught.p.y });
    const R = this.mouthR() / PX;
    let ate = 0;
    const hurt = new Map();
    for (const npc of g.npcs) {
      const rag = npc.rag;
      rag.resetZones();
      for (const c of centres) for (const q of rag.pieces.slice()) {
        if (!rag.pieces.includes(q)) continue;
        if (dist(c.x, c.y, q.bc.x, q.bc.y) > q.bc.r + R * PX) continue;
        const [gi, gj] = q.toGrid(c.x, c.y, q.frame());
        if (gi < -R || gj < -R || gi > q.w + R || gj > q.h + R) continue;
        const living = npc.alive && npc.main.has(q.a);
        const removed = rag.burn(q, gi, gj, R, 1, 0.05);
        if (!removed) continue;
        ate += removed;
        if (living) hurt.set(npc, (hurt.get(npc) || 0) + removed);
        g.blood.spray(c.x, c.y, -this.aim.x, -this.aim.y - 0.4, 6 + removed, 320, 1.1);
      }
      const n = hurt.get(npc);
      if (n) {
        npc.addBleed(n);
        // Biting down on someone held in the jaws is a crushing, usually fatal bite.
        npc.damage(n * 0.7 + 10 * this.size + (npc === crushed ? 45 * this.size : 0), 'bite');
        npc.applyZones(rag.zoneHits, 'bite', m.x, m.y);
        npc.hitReact(this.aim.x, this.aim.y, 1.2);
        if (npc.alive && !npc.bubble) npc.say(pick(PAIN_LINES), 1.2);
      }
    }
    this.dropCaught();
    Sfx.bite();
    if (ate) {
      if (ate > 40) Sfx.rip();
      g.shake(Math.min(3, ate / 25));
      this.heal(ate * 0.25);
      this.grow(ate);
      if (this.hp > this.maxHp) this.hp = this.maxHp;
    }
  }

  // ---------------------------------------------------------------- body
  computePose(dt) {
    if (!this.segs) return;
    const sp = Math.hypot(this.vx, this.vy);
    // Head faces where you aim when the mouth or a gun is in use, else where it's going.
    const aiming = this.jaw > 0.05 || this.wkind() !== 'bite';
    const want = aiming ? this.aim : sp > 30 ? norm(this.vx, this.vy) : this.headDir;
    const k = dt ? 1 - Math.exp(-dt * 14) : 1;
    this.headDir = norm(lerp(this.headDir.x, want.x, k), lerp(this.headDir.y, want.y, k));
    this.flip = this.headDir.x < 0 ? -1 : 1;
    this.hump += sp * (dt || 0) * 0.05;

    // Record where the head has been (with the surface normal there).
    const up = this.grip > 0.25 ? this.up : { x: 0, y: -1 };
    const P = this.path;
    if (!P.length || dist(P[0].x, P[0].y, this.x, this.y) > 1.5) P.unshift({ x: this.x, y: this.y, ux: up.x, uy: up.y });
    else { P[0].x = this.x; P[0].y = this.y; }

    // Lay the segments along that path, pressed down onto the surface.
    while (this.segs.length < this.segN) { const t = this.segs[this.segs.length - 1]; this.segs.push({ ...t }); }
    const hr = this.headR();
    let seg = 0, acc = 0;
    for (let i = 0; i < P.length - 1 && seg < this.segs.length; i++) {
      const a = P[i], b = P[i + 1];
      const L = dist(a.x, a.y, b.x, b.y);
      while (seg < this.segs.length && acc + L >= seg * this.spacing) {
        const t = L > 0 ? (seg * this.spacing - acc) / L : 0;
        const ux = lerp(a.ux, b.ux, t), uy = lerp(a.uy, b.uy, t);
        const sink = (hr - this.segR(seg)) * PX * (seg > 0 ? 1 : 0);
        const S = this.segs[seg];
        S.x = lerp(a.x, b.x, t) - ux * sink; S.y = lerp(a.y, b.y, t) - uy * sink;
        S.ux = ux; S.uy = uy;
        seg++;
      }
      acc += L;
    }
    // Path too short (just spawned): trail the rest straight behind.
    if (seg === 0) { const S0 = this.segs[0]; S0.x = this.x; S0.y = this.y; S0.ux = up.x; S0.uy = up.y; seg = 1; }
    for (; seg < this.segs.length; seg++) {
      const pr = this.segs[seg - 1];
      this.segs[seg].x = pr.x - this.flip * this.spacing; this.segs[seg].y = pr.y; this.segs[seg].ux = 0; this.segs[seg].uy = -1;
    }
    if (acc > this.spacing * (this.segs.length + 4)) P.length = Math.min(P.length, P.length - 1);
    while (P.length > 400) P.pop();
  }

  render(fb) {
    if (this.dead) return;
    const S = this.segs, n = S.length;
    const sp = Math.min(1, Math.hypot(this.vx, this.vy) / 200);
    const pts = S.map((s, i) => {
      const h = i > 0 ? Math.max(0, Math.sin(this.hump - i * 0.7)) * 1.4 * sp * this.size : 0;
      return { x: s.x / PX + s.ux * h, y: s.y / PX + s.uy * h, r: i === 0 ? this.headR() : this.segR(i), nx: s.ux, ny: s.uy };
    });
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, this.headR(), DASH_GHOST);
    // Outline, then flesh, then belly/highlight, tail to head.
    for (let i = n - 1; i >= 0; i--) fb.disc(pts[i].x, pts[i].y, pts[i].r + 1, WORM_C.out);
    for (let i = n - 1; i >= 0; i--) {
      const p = pts[i];
      fb.disc(p.x, p.y, p.r, i % 2 ? WORM_C.mid : WORM_C.dark);
      fb.disc(p.x - p.nx * p.r * 0.45, p.y - p.ny * p.r * 0.45, p.r * 0.5, WORM_C.belly);
      fb.disc(p.x + p.nx * p.r * 0.45, p.y + p.ny * p.r * 0.45, p.r * 0.3, WORM_C.light);
    }
    // Head: jaws (open while LMB is held), mouth, eye cluster.
    const h = pts[0], d = this.headDir, z = this.size;
    const px = -d.y, py = d.x;
    const fx = h.x + d.x * h.r * 0.7, fy = h.y + d.y * h.r * 0.7;
    if (this.jaw > 0.1) fb.disc(fx + d.x, fy + d.y, (1 + this.jaw * 1.8) * z, WORM_C.mouth);
    const spread = 0.25 + this.jaw * 0.85 - (this.biteT > 0 ? 0.2 : 0);
    const jl = 4 * z;
    for (const sg of [-1, 1]) {
      const ang = Math.atan2(d.y, d.x) + sg * spread;
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const bx = fx + px * sg * 1.2 * z, by = fy + py * sg * 1.2 * z;
      const tx = bx + ax * jl, ty = by + ay * jl;
      fb.line(bx, by, tx, ty, WORM_C.jaw);
      fb.line(bx + px * sg * 0.8, by + py * sg * 0.8, tx - ax * 0.5, ty - ay * 0.5, WORM_C.jawD);
      if (z > 1.4) fb.line(bx + px * sg * 1.6, by + py * sg * 1.6, tx - ax, ty - ay, WORM_C.jawD);
      fb.put(tx - px * sg, ty - py * sg, WORM_C.jaw);
      // Teeth along the inside of each mandible.
      for (let t = 1; t < jl - 1; t += 2) fb.put(bx + ax * t - px * sg, by + ay * t - py * sg, WORM_C.jaw);
    }
    const up = { x: h.nx, y: h.ny };
    for (let e = 0; e < 3; e++) {
      const o = 1.8 * z + (e === 1 ? 0.8 : 0);
      fb.put(h.x + up.x * o + d.x * (e - 1) * 1.3 * z, h.y + up.y * o + d.y * (e - 1) * 1.3 * z, WORM_C.eye);
    }
    if (this.hurtT > 0) for (const p of pts) fb.disc(p.x, p.y, p.r, HURT_TINT);
    this.renderGun(fb, this.mouth());
  }
}
