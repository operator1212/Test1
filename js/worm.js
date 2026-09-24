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

const SWALLOW = { name: 'SWALLOW', cool: 0, kind: 'swallow' };
const WORM_C = {
  out: hexc('#24080f'), dark: hexc('#5e1d2c'), mid: hexc('#9c3f52'), light: hexc('#d27684'),
  belly: hexc('#e2ab9c'), jaw: hexc('#efe0c4'), jawD: hexc('#a8987c'), eye: hexc('#ffe14a'), mouth: hexc('#30000a'),
  gum: hexc('#c9566a'), throat: hexc('#5a0f1f'), tooth: hexc('#fff4de'),
};
const WORM_HEAD_R = 4.4;        // art px at size 1
const WORM_SPACING = 7.5;       // world units between segments at size 1
const WORM_SIZE = 1.35;         // fixed for now (growth is off)
const GULP_TIME = 0.8;          // a victim must be held inside this long before digesting

class Worm extends Player {
  static rideH = 14;
  static weaponList = [SWALLOW, ...WEAPONS];
  static creatureName = 'WORM';
  static hasTentacle = false;
  static help = [['LMB HOLD', 'OPEN MOUTH, SWALLOW WHOEVER'], ['RELEASE', 'DIGEST (TOO SOON: SPITS OUT)']];

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.size = WORM_SIZE;
    this.segN = 12;
    this.gulp = null;           // { npc, t, map: [{ p, seg }] } someone inside the body
    this.digestT = 0;
    this.bulge = [];
    this.path = [];             // head history, newest first: {x, y, ux, uy}
    this.segs = [];
    this.jaw = 0;               // 0 closed .. 1 wide open
    this.chompCool = 0;
    this.headDir = { x: 1, y: 0 };
    this.hump = 0;
    this.applySize();
    this.hp = this.maxHp;
    this.resetBody();
  }

  applySize() {
    const s = this.size;
    this.coreR = WORM_HEAD_R * PX * s * 0.85;
    this.rideH = Math.max(this.coreR + 3, WORM_HEAD_R * PX * s + 2);
    this.spacing = WORM_SPACING * Math.pow(s, 0.7);
    this.maxHp = 130;
    this.segN = 12;
  }

  // Growth is off for now: eating only heals.
  grow() {}

  resetBody() {
    this.path = [{ x: this.x, y: this.y, ux: 0, uy: -1, air: false }];
    this.segs = [];
    for (let i = 0; i < this.segN; i++) this.segs.push({ x: this.x - i * this.spacing, y: this.y, ux: 0, uy: -1, vx: 0, vy: 0 });
  }

  buildPieces() { this.pieces = []; }

  headR() { return WORM_HEAD_R * this.size; }
  segR(i) {
    const f = i / Math.max(1, this.segs.length - 1);
    return (lerp(3.7, 1.5, f) + Math.sin(f * Math.PI) * 0.4) * this.size * (1 + (this.bulge[i] || 0) * 0.8);
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
    const held = this.gulp ? this.gulp.npc : null;
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
    this.spit(false);
    super.respawn();
    this.applySize();
    this.hp = this.maxHp;
    this.resetBody();
  }

  die() {
    const g = this.game;
    this.spit(false);
    super.die();
    for (const s of this.segs) {
      g.blood.burst(s.x, s.y, 8, 380);
      for (let k = 0; k < 6; k++) g.blood.spawn(s.x, s.y, rand(-380, 380), rand(-500, 0), 2.5, pick([WORM_C.mid, WORM_C.dark, WORM_C.belly]));
    }
  }

  // ---------------------------------------------------------------- swallow
  // Hold LMB: the mouth opens and slows you down. Anyone who gets in it is
  // pulled inside the body (the worm covers them, bulging). Keep holding for
  // GULP_TIME, then release to digest them. Release too early and you spit them
  // out. With nobody inside, releasing just snaps the jaws.
  natural(dt, held, pressed, released) {
    const g = this.game, m = this.mouth();
    this.chompCool -= dt;
    this.digestT -= dt;
    const canOpen = this.digestT <= 0;
    this.jaw = held && canOpen ? Math.min(1, this.jaw + dt * 5) : Math.max(0, this.jaw - dt * 12);
    this.moveSpeed = held && canOpen ? (this.gulp ? MOVE_SPEED * 0.45 : MOVE_SPEED * 0.7) : MOVE_SPEED * 0.95;

    if (held && canOpen && !this.gulp && this.jaw > 0.6) {
      const hit = this.victimNear(m, WORM_HEAD_R * this.size * PX * 1.4 + 8);
      if (hit) this.startGulp(hit);
    }
    if (this.gulp) {
      const G = this.gulp;
      G.t += dt;
      if (!G.npc.rag.pieces.length) { this.gulp = null; }
      else {
        // Pull every part of them inside, spread along the front of the body.
        const pull = G.t < 0.2 ? 0.12 : 0.28;
        for (const e of G.map) {
          if (!G.npc.rag.parts.includes(e.p) || e.p.pin) continue;
          const sg = this.segs[Math.min(e.seg, this.segs.length - 1)];
          e.p.x = lerp(e.p.x, sg.x, pull); e.p.y = lerp(e.p.y, sg.y, pull);
          e.p.px = lerp(e.p.px, e.p.x, 0.5); e.p.py = lerp(e.p.py, e.p.y, 0.5);
        }
        G.npc.grabbed = true;
        G.npc.stun = Math.max(G.npc.stun, 0.4);
        if (!held) this.finishGulp(G.t >= GULP_TIME);
      }
    } else if (released && this.chompCool <= 0 && canOpen) {
      // Empty snap: a small bite.
      this.chompCool = 0.6;
      this.biteT = 0.15;
      this.vx += this.aim.x * 200; this.vy += this.aim.y * 200;
      const removed = g.burnAt(m.x + this.headDir.x * 6, m.y + this.headDir.y * 6, 1.8, 1, 0.05, 'bite', 0.25, this.aim.x, this.aim.y);
      if (removed) { this.feed(removed * 0.5); g.blood.spray(m.x, m.y, -this.aim.x, -this.aim.y, 4 + removed, 260, 1); }
      Sfx.bite();
    }
  }

  victimNear(m, r) {
    let best = null, bd = r * r;
    for (const npc of this.game.npcs) {
      if (!npc.rag.pieces.length) continue;
      for (const p of npc.rag.parts) {
        if (p.pin) continue;
        const d = dist2(m.x, m.y, p.x, p.y);
        if (d < bd) { bd = d; best = npc; }
      }
    }
    return best;
  }

  startGulp(npc) {
    const m = this.mouth();
    // Nearest parts go deepest first... actually the head end goes in first.
    const parts = npc.rag.parts.filter((p) => !p.pin).sort((a, b) => dist2(a.x, a.y, m.x, m.y) - dist2(b.x, b.y, m.x, m.y));
    const K = Math.min(this.segs.length - 2, 6);
    this.gulp = { npc, t: 0, map: parts.map((p, i) => ({ p, seg: 1 + Math.floor(i / Math.max(1, parts.length) * K) })) };
    npc.grabbed = true;
    if (npc.alive) npc.say(pick(['NO NO NO', 'HELP!!', 'AAAAAH!']), 1.2);
    Sfx.squelch();
  }

  finishGulp(digest) {
    const G = this.gulp, g = this.game;
    this.gulp = null;
    const npc = G.npc;
    npc.grabbed = false;
    const m = this.mouth();
    if (digest) {
      // Gone: killed and digested.
      if (npc.alive) { npc.lastHitBy = 'swallowed'; npc.die('swallowed'); }
      npc.rag.pieces = [];
      npc.rag.refreshTopology('eaten', m.x, m.y);
      for (const s of g.spikes) if (s.state === 'lodged' && s.host.rag === npc.rag) s.state = 'dead';
      g.blood.spray(m.x, m.y, this.headDir.x, this.headDir.y - 0.5, 40, 380, 0.7);
      g.fx.text(m.x, m.y - 30, 'DIGESTED', '#ff5a64');
      this.heal(30);
      this.digestT = 2;
      this.biteT = 0.3;
      Sfx.bite(); Sfx.rip();
      g.shake(2);
    } else {
      // Spat out, hurt but alive.
      for (const p of npc.rag.parts) p.impulse(this.headDir.x * 420 + rand(-80, 80), this.headDir.y * 420 - 150);
      if (npc.alive) { npc.damage(15, 'bite'); npc.knock(1.5); }
      g.blood.spray(m.x, m.y, this.headDir.x, this.headDir.y, 12, 300, 0.6);
      Sfx.squelch();
    }
  }

  spit(hurt) { if (this.gulp) this.finishGulp(false); }

  // ---------------------------------------------------------------- body
  computePose(dt) {
    if (!this.segs) return;
    // Bulge where a swallowed victim sits.
    for (let i = 0; i < this.segN; i++) {
      const want = this.gulp && this.gulp.map.some((e) => e.seg === i) ? 1 : 0;
      this.bulge[i] = lerp(this.bulge[i] || 0, want, dt ? 1 - Math.exp(-dt * 6) : 1);
    }
    const sp = Math.hypot(this.vx, this.vy);
    // Head faces where you aim when the mouth or a gun is in use, else where it's going.
    const aiming = this.jaw > 0.05 || this.wkind() !== 'bite';
    const want = aiming ? this.aim : sp > 30 ? norm(this.vx, this.vy) : this.headDir;
    const k = dt ? 1 - Math.exp(-dt * 14) : 1;
    this.headDir = norm(lerp(this.headDir.x, want.x, k), lerp(this.headDir.y, want.y, k));
    this.flip = this.headDir.x < 0 ? -1 : 1;
    this.hump += sp * (dt || 0) * 0.05;

    // Record where the head has been (with the surface normal there, and
    // whether it was actually on a surface or flying through the air).
    const onSurf = this.grip > 0.25;
    const up = onSurf ? this.up : { x: 0, y: -1 };
    const P = this.path;
    if (!P.length || dist(P[0].x, P[0].y, this.x, this.y) > 1.5) P.unshift({ x: this.x, y: this.y, ux: up.x, uy: up.y, air: !onSurf });
    else { P[0].x = this.x; P[0].y = this.y; P[0].air = !onSurf; }

    while (this.segs.length < this.segN) { const t = this.segs[this.segs.length - 1]; this.segs.push({ ...t, vx: 0, vy: 0 }); }
    const hr = this.headR();
    const S = this.segs;
    S[0].x = this.x; S[0].y = this.y; S[0].ux = up.x; S[0].uy = up.y;
    // Where each segment would sit along the path (null if the path is too short).
    const targets = new Array(S.length).fill(null);
    let seg = 1, acc = 0;
    for (let i = 0; i < P.length - 1 && seg < S.length; i++) {
      const a = P[i], b = P[i + 1];
      const L = dist(a.x, a.y, b.x, b.y);
      while (seg < S.length && acc + L >= seg * this.spacing) {
        const t = L > 0 ? (seg * this.spacing - acc) / L : 0;
        const ux = lerp(a.ux, b.ux, t), uy = lerp(a.uy, b.uy, t);
        const sink = (hr - this.segR(seg)) * PX;
        targets[seg] = { x: lerp(a.x, b.x, t) - ux * sink, y: lerp(a.y, b.y, t) - uy * sink, ux, uy, air: a.air || b.air };
        seg++;
      }
      acc += L;
    }
    const map = this.game.map;
    const kf = dt ? 1 - Math.exp(-dt * 22) : 1;
    for (let i = 1; i < S.length; i++) {
      const s = S[i], T = targets[i], prev = S[i - 1];
      if (T && !T.air) {
        // On a surface: hug the path (easing back if it had fallen off it).
        s.x = lerp(s.x, T.x, kf); s.y = lerp(s.y, T.y, kf);
        s.ux = T.ux; s.uy = T.uy; s.vx = 0; s.vy = 0;
      } else if (dt) {
        // Unsupported: fall, trail behind the segment in front, land on things.
        s.vy = (s.vy || 0) + GRAVITY * 0.8 * dt;
        s.vx = (s.vx || 0) * 0.98;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const c = { x: s.x, y: s.y, r: this.segR(i) * PX };
        const nrm = map.pushCircle(c);
        if (nrm) { s.vx *= 0.7; if (nrm.y < -0.5) s.vy = Math.min(s.vy, 0); s.ux = nrm.x; s.uy = nrm.y; }
        else { s.ux = 0; s.uy = -1; }
        s.x = c.x; s.y = c.y;
      }
      // Chain: never further than one spacing from the segment in front.
      const d = dist(prev.x, prev.y, s.x, s.y);
      if (d > this.spacing) {
        const k = (d - this.spacing) / d;
        s.x -= (s.x - prev.x) * k; s.y -= (s.y - prev.y) * k;
      }
    }
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
    // Head: a round lamprey maw that opens into pink flesh ringed with teeth.
    const h = pts[0], d = this.headDir, z = this.size;
    const px = -d.y, py = d.x;
    const fx = h.x + d.x * h.r * 0.55, fy = h.y + d.y * h.r * 0.55;
    const open = this.jaw;
    if (open > 0.05) {
      const mr = h.r * (0.35 + open * 0.55);
      fb.disc(fx, fy, mr + 1, WORM_C.out);
      fb.disc(fx, fy, mr, WORM_C.gum);
      fb.disc(fx + d.x * mr * 0.25, fy + d.y * mr * 0.25, mr * 0.55, WORM_C.throat);
      const nT = 10;
      for (let k = 0; k < nT; k++) {
        const a = k / nT * TAU + this.t * 0.5;
        fb.put(fx + Math.cos(a) * mr * 0.85, fy + Math.sin(a) * mr * 0.85, WORM_C.tooth);
        if (open > 0.6) fb.put(fx + Math.cos(a + 0.3) * mr * 0.55, fy + Math.sin(a + 0.3) * mr * 0.55, WORM_C.tooth);
      }
      // Lips peel back into four flaps.
      for (let k = 0; k < 4; k++) {
        const a = Math.atan2(d.y, d.x) + (k - 1.5) * (0.5 + open * 0.5);
        const lx = fx + Math.cos(a) * mr, ly = fy + Math.sin(a) * mr;
        fb.line(lx, ly, lx + Math.cos(a) * 2.5 * z * open, ly + Math.sin(a) * 2.5 * z * open, WORM_C.dark);
      }
    } else {
      // Closed: a puckered slit with a couple of fangs showing.
      fb.line(fx - px * 1.5 * z, fy - py * 1.5 * z, fx + px * 1.5 * z, fy + py * 1.5 * z, WORM_C.out);
      fb.put(fx + d.x - px, fy + d.y - py, WORM_C.tooth); fb.put(fx + d.x + px, fy + d.y + py, WORM_C.tooth);
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
