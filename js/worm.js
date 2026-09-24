// The Worm: a segmented escapee. The head is the adhesive core (so it crawls
// on anything), the body follows the head's path and drapes over edges. Its
// natural attack is its mouth: hold LMB to open the jaws and chew away whatever
// is in them, pixel by pixel. Guns are clamped in the jaws; the grapple is a
// tongue.
'use strict';

const BITE = { name: 'BITE', cool: 0, kind: 'bite' };
const WORM_C = {
  out: hexc('#24080f'), dark: hexc('#5e1d2c'), mid: hexc('#9c3f52'), light: hexc('#d27684'),
  belly: hexc('#e2ab9c'), jaw: hexc('#efe0c4'), jawD: hexc('#a8987c'), eye: hexc('#ffe14a'), mouth: hexc('#30000a'),
};
const WORM_HEAD_R = 4.4;        // art px
const WORM_SPACING = 7.5;       // world units between segments

class Worm extends Player {
  static rideH = 20;
  static weaponList = [BITE, ...WEAPONS];
  static creatureName = 'WORM';

  constructor(game, x, feetY) {
    super(game, x, feetY);
    this.segs = [];
    this.resetBody(12);
    this.jaw = 0;           // 0 closed .. 1 wide open
    this.chompT = 0;
    this.eaten = 0;
    this.headDir = { x: 1, y: 0 };
    this.hump = 0;
  }

  resetBody(n) {
    this.segs = [];
    for (let i = 0; i < n; i++) this.segs.push({ x: this.x - i * WORM_SPACING, y: this.y });
  }

  buildPieces() { this.pieces = []; }

  segR(i) {
    // Art-px radius: fat head end, tapering tail.
    const f = i / Math.max(1, this.segs.length - 1);
    return lerp(3.7, 1.5, f) + Math.sin(f * Math.PI) * 0.4;
  }

  get cx() { return this.segs && this.segs.length ? this.segs[Math.min(2, this.segs.length - 1)].x : this.x; }
  get cy() { return this.segs && this.segs.length ? this.segs[Math.min(2, this.segs.length - 1)].y : this.y; }

  mouth() {
    const r = (WORM_HEAD_R + 1.5) * PX;
    return { x: this.x + this.headDir.x * r, y: this.y + this.headDir.y * r };
  }
  shoulder() { return { x: this.x, y: this.y }; }
  muzzle() { const m = this.mouth(); return { x: m.x + this.aim.x * 2 * PX, y: m.y + this.aim.y * 2 * PX }; }
  ropeOrigin() { return this.mouth(); }

  box() {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of this.segs) { l = Math.min(l, p.x); r = Math.max(r, p.x); t = Math.min(t, p.y); b = Math.max(b, p.y); }
    return [l - 12, t - 12, r + 12, b + 12];
  }

  hitTest(x, y) {
    if (this.dead) return false;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i], r = (i === 0 ? WORM_HEAD_R : this.segR(i)) * PX;
      if (dist2(x, y, s.x, s.y) < r * r) return true;
    }
    return false;
  }

  pushBodies(npcs) {
    if (this.dead) return;
    for (const npc of npcs) for (const p of npc.rag.parts) {
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

  respawn() {
    super.respawn();
    this.resetBody(12);
    this.eaten = 0;
  }

  die() {
    const g = this.game;
    super.die();
    for (const s of this.segs) g.blood.burst(s.x, s.y, 8, 380);
    for (const s of this.segs) for (let k = 0; k < 6; k++) g.blood.spawn(s.x, s.y, rand(-380, 380), rand(-500, 0), 2.5, pick([WORM_C.mid, WORM_C.dark, WORM_C.belly]));
  }

  // ---------------------------------------------------------------- bite
  natural(dt, held, pressed) {
    this.jaw = approach(this.jaw, held ? 1 : 0, dt * 9);
    this.chompT -= dt;
    if (pressed) {
      // Lunge at whatever you're biting toward.
      this.vx += this.aim.x * 430; this.vy += this.aim.y * 430;
      this.detachT = 0.12;
      Sfx.whip();
    }
    if (!held || this.jaw < 0.6 || this.chompT > 0) return;
    this.chompT = 0.09;
    const g = this.game, m = this.mouth();
    let ate = 0;
    for (const npc of g.npcs) {
      const rag = npc.rag;
      for (const q of rag.pieces.slice()) {
        if (!rag.pieces.includes(q)) continue;
        if (dist(m.x, m.y, q.bc.x, q.bc.y) > q.bc.r + 3 * PX) continue;
        const [gi, gj] = q.toGrid(m.x, m.y, q.frame());
        if (gi < -3 || gj < -3 || gi > q.w + 3 || gj > q.h + 3) continue;
        const living = npc.alive && npc.main.has(q.a);
        rag.resetZones();
        const removed = rag.burn(q, gi, gj, 2.6, 0.85, 0.05);
        if (!removed) continue;
        ate += removed;
        if (living) {
          npc.addBleed(removed);
          npc.damage(removed * 0.45, 'bite');
          npc.applyZones(rag.zoneHits, 'bite', m.x, m.y);
          npc.hitReact(this.aim.x, this.aim.y, 0.6);
          if (npc.alive && !npc.bubble && Math.random() < 0.3) npc.say(pick(PAIN_LINES), 1.2);
        }
        // The jaws hang on: drag the bitten part toward the mouth.
        const pp = dist2(m.x, m.y, q.a.x, q.a.y) < dist2(m.x, m.y, q.b.x, q.b.y) ? q.a : q.b;
        if (!pp.pin && rag.parts.includes(pp)) pp.impulse((m.x - pp.x) * 4, (m.y - pp.y) * 4);
        g.blood.spray(m.x, m.y, -this.aim.x, -this.aim.y - 0.3, 4 + removed, 280, 1.0);
      }
    }
    if (ate) {
      this.heal(ate * 0.2);
      this.biteT = 0.12;
      this.eaten += ate;
      Sfx.bite();
      // Grow a segment for every ~120 pixels eaten.
      while (this.eaten >= 120 && this.segs.length < 24) {
        this.eaten -= 120;
        const t = this.segs[this.segs.length - 1];
        this.segs.push({ x: t.x, y: t.y });
        g.fx.text(this.x, this.y - 30, 'GROWING', '#ffb3b8');
      }
    }
  }

  // ---------------------------------------------------------------- body
  computePose(dt) {
    if (!this.segs || !this.segs.length) return;
    const map = this.game.map;
    const sp = Math.hypot(this.vx, this.vy);
    // The head faces where you aim when the mouth or a gun is in use, else where it's going.
    const aiming = this.jaw > 0.05 || this.wkind() !== 'bite' || this.tentacle.state !== 'idle';
    const want = aiming ? this.aim : sp > 30 ? norm(this.vx, this.vy) : this.headDir;
    const k = dt ? 1 - Math.exp(-dt * 14) : 1;
    this.headDir = norm(lerp(this.headDir.x, want.x, k), lerp(this.headDir.y, want.y, k));
    this.flip = this.headDir.x < 0 ? -1 : 1;
    this.hump += sp * (dt || 0) * 0.05;

    const S = this.segs;
    S[0].x = this.x; S[0].y = this.y;
    // Follow the leader, sag with gravity, collide with the level.
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i];
      b.y += dt ? 90 * dt : 0;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      b.x = a.x + dx / d * WORM_SPACING; b.y = a.y + dy / d * WORM_SPACING;
      const c = { x: b.x, y: b.y, r: this.segR(i) * PX * 0.9 };
      map.pushCircle(c);
      b.x = c.x; b.y = c.y;
    }
  }

  render(fb) {
    if (this.dead) return;
    const S = this.segs, n = S.length;
    const sp = Math.min(1, Math.hypot(this.vx, this.vy) / 200);
    // Art-space points with a travelling hump wave along the body.
    const pts = S.map((s, i) => {
      const nb = S[Math.min(n - 1, i + 1)], pb = S[Math.max(0, i - 1)];
      const dx = pb.x - nb.x, dy = pb.y - nb.y, d = Math.hypot(dx, dy) || 1;
      let nx = -dy / d, ny = dx / d;
      if (nx * this.up.x + ny * this.up.y < 0) { nx = -nx; ny = -ny; }
      const h = i > 0 ? Math.max(0, Math.sin(this.hump - i * 0.7)) * 1.4 * sp : 0;
      return { x: s.x / PX + nx * h, y: s.y / PX + ny * h, r: i === 0 ? WORM_HEAD_R : this.segR(i), nx, ny };
    });
    // Dash afterimage.
    for (const tr of this.trail) fb.disc(tr.x / PX, tr.y / PX, WORM_HEAD_R, DASH_GHOST);
    // Outline, then flesh, then belly/highlight, back to front.
    for (let i = n - 1; i >= 0; i--) fb.disc(pts[i].x, pts[i].y, pts[i].r + 1, WORM_C.out);
    for (let i = n - 1; i >= 0; i--) {
      const p = pts[i];
      fb.disc(p.x, p.y, p.r, i % 2 ? WORM_C.mid : WORM_C.dark);
      fb.disc(p.x - p.nx * p.r * 0.45, p.y - p.ny * p.r * 0.45, p.r * 0.5, WORM_C.belly);
      fb.disc(p.x + p.nx * p.r * 0.45, p.y + p.ny * p.r * 0.45, p.r * 0.3, WORM_C.light);
    }
    // Head: jaws, mouth, eye cluster.
    const h = pts[0], d = this.headDir;
    const px = -d.y, py = d.x;                 // perpendicular
    const fx = h.x + d.x * h.r * 0.7, fy = h.y + d.y * h.r * 0.7;
    if (this.jaw > 0.1) fb.disc(fx, fy, 1 + this.jaw * 1.6, WORM_C.mouth);
    const spread = 0.35 + this.jaw * 0.75 + (this.biteT > 0 ? -0.25 : 0);
    for (const sg of [-1, 1]) {
      const ang = Math.atan2(d.y, d.x) + sg * spread;
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const bx = fx + px * sg * 1.2, by = fy + py * sg * 1.2;
      const tx = bx + ax * 4, ty = by + ay * 4;
      fb.line(bx, by, tx, ty, WORM_C.jaw);
      fb.line(bx + px * sg * 0.8, by + py * sg * 0.8, tx - ax * 0.5, ty - ay * 0.5, WORM_C.jawD);
      fb.put(tx - px * sg, ty - py * sg, WORM_C.jaw);   // inward hook
    }
    const up = { x: this.up.x, y: this.up.y };
    for (let e = 0; e < 3; e++) {
      const ex = h.x + up.x * (1.8 + (e === 1 ? 0.8 : 0)) + d.x * (e - 1) * 1.3;
      const ey = h.y + up.y * (1.8 + (e === 1 ? 0.8 : 0)) + d.y * (e - 1) * 1.3;
      fb.put(ex, ey, WORM_C.eye);
    }
    if (this.hurtT > 0) for (const p of pts) fb.disc(p.x, p.y, p.r, HURT_TINT);
    // Guns are clamped in the jaws.
    this.renderGun(fb, this.mouth());
  }
}
