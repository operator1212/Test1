// Pixel ragdolls. Every body piece is a small pixel bitmap riding on a
// two-particle "bone". Pixels can be burned away one at a time; when a piece
// falls apart into separate islands each island becomes its own physics body,
// so any part can be cut off at any pixel. Blood stains individual pixels.
'use strict';

// Particle roles. B = limb drawn behind the torso, F = in front.
const R = { PELVIS: 0, NECK: 1, HEAD: 2, ELBOW_B: 3, HAND_B: 4, ELBOW_F: 5, HAND_F: 6, KNEE_B: 7, FOOT_B: 8, KNEE_F: 9, FOOT_F: 10 };
const LEG_ROLES = new Set([R.KNEE_B, R.FOOT_B, R.KNEE_F, R.FOOT_F]);

// Rest pose in art pixels, facing right, origin between the feet on the ground.
const REST_ART = [
  [0, -19], [0, -31], [0, -37],
  [-1.5, -24.5], [-1, -18.5], [1.5, -24.5], [2.5, -18.5],
  [-1.5, -10.5], [-2, -2], [1.5, -10.5], [2, -2],
];
const RAG_REST = REST_ART.map(([x, y]) => [x * PX, y * PX]);
const RAG_RADIUS = [11, 11, 14, 7, 7, 7, 7, 7, 6, 7, 6];
const RAG_IMASS = [0.5, 0.6, 0.9, 1, 1, 1, 1, 0.9, 1, 0.9, 1];
const HEAD_R_ART = 5.5;

// [name, parent role, child role, draw order]
const PIECE_DEFS = [
  ['upperArmB', R.NECK, R.ELBOW_B, 0], ['forearmB', R.ELBOW_B, R.HAND_B, 0],
  ['thighB', R.PELVIS, R.KNEE_B, 1], ['shinB', R.KNEE_B, R.FOOT_B, 1],
  ['torso', R.PELVIS, R.NECK, 2],
  ['thighF', R.PELVIS, R.KNEE_F, 3], ['shinF', R.KNEE_F, R.FOOT_F, 3],
  ['head', R.NECK, R.HEAD, 4],
  ['upperArmF', R.NECK, R.ELBOW_F, 5], ['forearmF', R.ELBOW_F, R.HAND_F, 5],
];

// Soft constraints that keep the body from folding into itself: [a, b, len|null(rest), stiffness, minOnly]
const RAG_STABS = [
  [R.HEAD, R.PELVIS, null, 0.5, false],
  [R.KNEE_B, R.NECK, 30, 1, true], [R.KNEE_F, R.NECK, 30, 1, true],
  [R.FOOT_B, R.PELVIS, 18, 1, true], [R.FOOT_F, R.PELVIS, 18, 1, true],
  [R.HAND_B, R.NECK, 12, 1, true], [R.HAND_F, R.NECK, 12, 1, true],
  [R.KNEE_B, R.KNEE_F, 5, 0.5, true],
];

const STYLES = {
  guard: {
    skin: '#e2a57b', hand: '#3a3f4a', shirt: '#38568a', sleeve: '#38568a', sleeve2: '#38568a',
    pants: '#26324d', boots: '#15171c', belt: '#141518', helmet: '#2b313d', visor: '#5cc8f2', badge: '#f2c230',
  },
  scientist: {
    skin: '#f0c29a', hand: '#f0c29a', shirt: '#eef2f6', sleeve: '#eef2f6', sleeve2: '#eef2f6',
    pants: '#44607a', boots: '#2c2c2c', hair: '#6b4a2f', goggles: '#9fe0ff', coat: true,
  },
  subject: {
    skin: '#9aa4ae', hand: '#9aa4ae', shirt: '#a3cbd0', sleeve: '#9aa4ae', sleeve2: '#9aa4ae',
    pants: '#9aa4ae', boots: '#848d98', vein: '#a4283a',
  },
};

const FLESH = ['#9a0f1a', '#b3172a', '#860b15', '#a8121f'].map((c) => hexc(c));
const BONE = hexc('#ebe3d0'), BONE_D = hexc('#d2c6ab');
const BRAIN = [hexc('#e39aa8'), hexc('#cf7d8f')];

// ------------------------------------------------------------ sprite generation
function roundRect(u, v, u0, u1, hw, rc) {
  const av = Math.abs(v);
  if (u < u0 || u > u1 || av > hw) return false;
  if ((u < u0 + rc || u > u1 - rc) && av > hw - rc) {
    const cu = u < u0 + rc ? u0 + rc : u1 - rc;
    return (u - cu) ** 2 + (av - (hw - rc)) ** 2 <= rc * rc;
  }
  return true;
}

function shapeColor(kind, u, v, len, S, style) {
  const cap = (r, u0 = 0, u1 = len) => { const cu = clamp(u, u0, u1); return (u - cu) ** 2 + v * v <= r * r; };
  const side = (t) => (v > t ? 0.84 : 1);
  switch (kind) {
    case 'upperArm':
      return cap(1.9) ? { c: S.sleeve, k: side(0.8) } : null;
    case 'forearm':
      if ((u - len) ** 2 + v * v <= 2.2 * 2.2) return { c: S.hand, k: side(1) };
      return cap(1.7) ? { c: S.sleeve2, k: side(0.8) } : null;
    case 'thigh':
      return cap(2.3) ? { c: S.pants, k: side(1) } : null;
    case 'shin':
      // Foot points to local -v, which is "forward" for a limb hanging down.
      if (u >= len - 1.5 && u <= len + 1.8 && v >= -4.8 && v <= 1.8 && !(u > len + 1 && v < -4)) return { c: S.boots, k: 1 };
      return cap(2.0) ? { c: u > len - 3 ? S.boots : S.pants, k: side(0.8) } : null;
    case 'torso': {
      const u0 = S.coat ? -5 : -1.5, u1 = len + 0.8;
      const f = (u - u0) / (u1 - u0);
      const hw = S.coat ? lerp(4.9, 4.6, f) : lerp(4.1, 4.6, f);
      if (!roundRect(u, v, u0, u1, hw, 2)) return null;
      let c = S.shirt;
      const k = v < -2.6 ? 0.88 : 1;
      if (style === 'guard') {
        if (u < 0.3) c = S.pants;
        else if (u < 1.6) c = S.belt;
        if (u > len - 4.2 && u < len - 2.6 && v > 1.2 && v < 3) c = S.badge;
      } else if (style === 'scientist') {
        if (v > 0 && v < 1.1 && u > len * 0.3) c = '#c5ced8';
        if (u > len - 1 && Math.abs(v) < 1.5) c = '#7fa6c9';
        if (u > len * 0.3 && u < len * 0.3 + 1.3 && v > 1.6 && v < 3.6) c = '#c5ced8';
      } else if (style === 'subject') {
        if (u < 0.4) c = S.skin;
        if (Math.random() < 0.06) c = '#8a4a52';
      }
      return { c, k };
    }
    case 'head': {
      const du = u - len;
      const inHead = du * du + v * v <= HEAD_R_ART * HEAD_R_ART;
      const inNeck = u >= -0.5 && u <= len && Math.abs(v) <= 1.6;
      if (style === 'guard' && du >= 0.3 && du <= 1.5 && v >= 0 && v <= 7) return { c: S.helmet, k: 1 };
      if (!inHead && !inNeck) return null;
      let c = S.skin, k = v < -3 ? 0.9 : 1, glow = false;
      if (inHead) {
        if (style === 'guard') {
          if (du > 1.5) c = S.helmet;
          else if (du > -1.2 && v > 0.8) c = S.visor;
          if (du < -2.2 && du > -3.4 && v > 2.2 && v < 4.2) c = '#8a4636';
        } else if (style === 'scientist') {
          if (du > -1.2 && du < 0.8) c = v > 1.3 ? S.goggles : '#3b3f46';
          if ((du > 2.2 && v < 4) || (du > 0 && v < -2.8)) c = S.hair;
          if (du < -2.2 && du > -3.4 && v > 2.2 && v < 4.2) c = '#9a5040';
        } else {
          if (du > -0.8 && du < 1.2 && v > 2 && v < 4.4) { c = '#ffe14a'; glow = true; }
          if (du < -2.2 && du > -3.2 && v > 1.5 && v < 5) c = '#3b0006';
          if (du > 2.6 && v < -0.5) c = '#b03a4c';
          else if (!glow && Math.random() < 0.05) c = S.vein;
        }
      }
      return { c, k, glow };
    }
  }
  return null;
}

function innerColor(kind, u, v, len) {
  const fl = pick(FLESH);
  const av = Math.abs(v);
  switch (kind) {
    case 'head': {
      const d = Math.hypot(u - len, v);
      if (d > HEAD_R_ART) return av < 0.9 ? BONE : fl;
      if (d > 3.9) return BONE;
      return pick(BRAIN);
    }
    case 'torso':
      if (av < 0.9 && u > 0 && u < len) return BONE;
      if (u > len * 0.35 && u < len - 0.8 && Math.floor(u) % 2 === 0 && av < 3.5) return BONE_D;
      return fl;
    case 'forearm':
      if (u > len - 1.2) return fl;
      return av < 0.9 && u > 0 ? BONE : fl;
    case 'shin':
      if (u > len - 1) return fl;
      return av < 0.9 && u > 0 ? BONE : fl;
    default:
      return av < 0.9 && u > 0 && u < len ? BONE : fl;
  }
}

// Build the bitmap for one body piece. Local coords: u runs from the parent
// joint (u = 0) toward the child joint (u = len), v is perpendicular.
function genSprite(name, len, style) {
  const S = STYLES[style];
  const kind = name.replace(/[BF]$/, '');
  let b;
  switch (kind) {
    case 'torso': b = [S.coat ? -6 : -2.5, len + 1.5, -5.5, 5.5]; break;
    case 'head': b = [-1, len + 7, -7, 8]; break;
    case 'upperArm': b = [-2.5, len + 2.5, -2.5, 2.5]; break;
    case 'forearm': b = [-2.5, len + 3, -3, 3]; break;
    case 'thigh': b = [-3, len + 3, -3, 3]; break;
    default: b = [-3, len + 3, -5.5, 3]; break;
  }
  const ox = -Math.floor(b[0]), oy = -Math.floor(b[2]);
  const w = Math.ceil(b[1]) + ox, h = Math.ceil(b[3]) + oy;
  const col = new Uint32Array(w * h), inner = new Uint32Array(w * h), glow = new Uint8Array(w * h);
  const kk = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i + 0.5 - ox, v = j + 0.5 - oy;
    const r = shapeColor(kind, u, v, len, S, style);
    if (!r) continue;
    const idx = j * w + i;
    col[idx] = hexc(r.c);
    kk[idx] = r.k;
    if (r.glow) glow[idx] = 1;
    inner[idx] = innerColor(kind, u, v, len);
  }
  // Dark outline on the silhouette, light shading on one side.
  const out = new Uint32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const idx = j * w + i;
    if (!col[idx]) continue;
    const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1 ||
      !col[idx - 1] || !col[idx + 1] || !col[idx - w] || !col[idx + w];
    out[idx] = glow[idx] ? col[idx] : edge ? shade(col[idx], 0.55) : shade(col[idx], kk[idx]);
  }
  return { w, h, ox, oy, col: out, inner };
}

// ------------------------------------------------------------ pieces
class Piece {
  constructor(owner, name, a, b, spr, z) {
    this.owner = owner; this.name = name; this.a = a; this.b = b; this.z = z;
    this.w = spr.w; this.h = spr.h; this.ox = spr.ox; this.oy = spr.oy;
    this.col = spr.col; this.inner = spr.inner;
    this.exposed = spr.exposed || new Uint8Array(spr.w * spr.h);
    this.len = spr.len != null ? spr.len : dist(a.x, a.y, b.x, b.y);
    this.k = 1; this.min = false;
    this.count = 0;
    for (let i = 0; i < this.col.length; i++) if (this.col[i]) this.count++;
    this.origCount = spr.origCount || this.count;
    this.wounds = spr.wounds || [];
    this.bleed = spr.bleed || 0;
    this.bleedAcc = 0;
    this.strain = 0;
    this.leg = /^(thigh|shin)/.test(name);
    this.bc = { x: 0, y: 0, r: 0 };
    this.updateBounds();
  }

  frame() {
    const a = this.a, b = this.b;
    let cx = b.x - a.x, cy = b.y - a.y;
    const L = Math.sqrt(cx * cx + cy * cy);
    if (L < 1e-6) { cx = 0; cy = -1; } else { cx /= L; cy /= L; }
    const f = this.owner.flip;
    return { ax: a.x, ay: a.y, cx, cy, nx: -cy * f, ny: cx * f };
  }

  framePrev() {
    const a = this.a, b = this.b;
    const ax = a.px ?? a.x, ay = a.py ?? a.y, bx = b.px ?? b.x, by = b.py ?? b.y;
    let cx = bx - ax, cy = by - ay;
    const L = Math.sqrt(cx * cx + cy * cy);
    if (L < 1e-6) { cx = 0; cy = -1; } else { cx /= L; cy /= L; }
    const f = this.owner.flip;
    return { ax, ay, cx, cy, nx: -cy * f, ny: cx * f };
  }

  localWorld(u, v, F) {   // u, v in art pixels relative to the frame origin
    return [F.ax + (F.cx * u + F.nx * v) * PX, F.ay + (F.cy * u + F.ny * v) * PX];
  }
  cellWorld(idx, F) {
    const i = idx % this.w, j = (idx / this.w) | 0;
    return this.localWorld(i + 0.5 - this.ox, j + 0.5 - this.oy, F);
  }
  toGrid(x, y, F) {
    const dx = x - F.ax, dy = y - F.ay;
    return [(dx * F.cx + dy * F.cy) / PX + this.ox, (dx * F.nx + dy * F.ny) / PX + this.oy];
  }
  cellAt(x, y, F) {
    const [gi, gj] = this.toGrid(x, y, F || this.frame());
    const i = Math.floor(gi), j = Math.floor(gj);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    const idx = j * this.w + i;
    return this.col[idx] ? idx : -1;
  }

  updateBounds() {
    const F = this.frame();
    const [x, y] = this.localWorld(this.w / 2 - this.ox, this.h / 2 - this.oy, F);
    this.bc.x = x; this.bc.y = y;
    this.bc.r = Math.hypot(this.w, this.h) * 0.5 * PX + 1;
  }

  // First filled pixel along a world segment (pixel-precise). Returns { t, idx } or null.
  rayHit(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) return null;
    const fx = x0 - this.bc.x, fy = y0 - this.bc.y, r = this.bc.r;
    const bq = fx * dx + fy * dy, cq = fx * fx + fy * fy - r * r;
    const disc = bq * bq - L2 * cq;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t0 = (-bq - sq) / L2, t1 = (-bq + sq) / L2;
    if (t1 < 0 || t0 > 1) return null;
    t0 = Math.max(0, t0); t1 = Math.min(1, t1);
    const F = this.frame();
    const [ai, aj] = this.toGrid(x0 + dx * t0, y0 + dy * t0, F);
    const [bi, bj] = this.toGrid(x0 + dx * t1, y0 + dy * t1, F);
    const n = Math.max(1, Math.ceil(Math.hypot(bi - ai, bj - aj) / 0.35));
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      const i = Math.floor(ai + (bi - ai) * s), j = Math.floor(aj + (bj - aj) * s);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const idx = j * this.w + i;
      if (this.col[idx]) return { t: t0 + (t1 - t0) * s, idx };
    }
    return null;
  }

  expose(idx, char) {
    if (!this.col[idx] || this.exposed[idx]) return;
    this.exposed[idx] = 1;
    this.col[idx] = char ? mixc(this.inner[idx], C_BLACK, char) : this.inner[idx];
    this.wounds.push(idx);
    this.bleed = 1;
  }

  // Expose all pixels within radius (art px) of a world point.
  exposeNear(x, y, radius) {
    const [gi, gj] = this.toGrid(x, y, this.frame());
    let n = 0;
    for (let j = Math.floor(gj - radius); j <= gj + radius; j++)
      for (let i = Math.floor(gi - radius); i <= gi + radius; i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        if ((i + 0.5 - gi) ** 2 + (j + 0.5 - gj) ** 2 > radius * radius) continue;
        const idx = j * this.w + i;
        if (this.col[idx] && !this.exposed[idx]) { this.expose(idx, 0); n++; }
      }
    return n;
  }

  stain(idx, c, amt) {
    if (this.col[idx]) this.col[idx] = mixc(this.col[idx], c, amt);
  }

  raster(fb) {
    const F = this.frame();
    const w = this.w, h = this.h, ox = this.ox, oy = this.oy, col = this.col;
    // Bounding box of the rotated bitmap, in art pixels.
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [gu, gv] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const [x, y] = this.localWorld(gu - ox, gv - oy, F);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const X0 = Math.max(Math.floor(minX / PX), fb.ox), X1 = Math.min(Math.ceil(maxX / PX), fb.ox + fb.w);
    const Y0 = Math.max(Math.floor(minY / PX), fb.oy), Y1 = Math.min(Math.ceil(maxY / PX), fb.oy + fb.h);
    const buf = fb.buf, fw = fb.w;
    // Nearest-neighbour inverse mapping: crisp, no holes, pixel-art rotation.
    for (let Y = Y0; Y < Y1; Y++) {
      const wy = (Y + 0.5) * PX - F.ay;
      const row = (Y - fb.oy) * fw - fb.ox;
      for (let X = X0; X < X1; X++) {
        const wx = (X + 0.5) * PX - F.ax;
        const gi = (wx * F.cx + wy * F.cy) / PX + ox;
        if (gi < 0 || gi >= w) continue;
        const gj = (wx * F.nx + wy * F.ny) / PX + oy;
        if (gj < 0 || gj >= h) continue;
        const c = col[(gj | 0) * w + (gi | 0)];
        if (c) buf[row + X] = c;
      }
    }
  }
}

// ------------------------------------------------------------ ragdoll
class Ragdoll {
  constructor(x, groundY, facing, style) {
    this.style = style;
    this.flip = facing;
    this.game = null;
    this.onChange = null;
    this.joint = RAG_REST.map((o, i) => {
      const p = new Particle(x + o[0] * facing, groundY + o[1], RAG_RADIUS[i], RAG_IMASS[i]);
      p.rag = this; p.role = i;
      return p;
    });
    this.parts = this.joint.slice();
    const J = this.joint;
    this.pieces = PIECE_DEFS.map(([name, a, b, z]) => {
      const len = dist(J[a].x, J[a].y, J[b].x, J[b].y) / PX;
      return new Piece(this, name, J[a], J[b], genSprite(name, len, style), z);
    });
    this.stabs = RAG_STABS.map(([a, b, len, k, min]) => ({
      a: J[a], b: J[b], len: len == null ? dist(J[a].x, J[a].y, J[b].x, J[b].y) : len, k, min,
    }));
    this.damp = 0.995;
    this.t = 0;
  }

  get head() { return this.joint[R.HEAD]; }
  get pelvis() { return this.joint[R.PELVIS]; }
  pinned() { return this.parts.some((p) => p.pin); }

  integrate() { for (const p of this.parts) integrateParticle(p, this.damp); }

  solve(map, last) {
    for (const c of this.pieces) solveDist(c);
    for (const c of this.stabs) solveDist(c);
    for (const p of this.parts) collideParticle(p, map, last ? 0.12 : 0);
  }

  // Once per step after solving: tearing under tension, bounds, bleeding.
  post(dt) {
    this.t += dt;
    for (const q of this.pieces.slice()) {
      const d = dist(q.a.x, q.a.y, q.b.x, q.b.y);
      const lim = q.name === 'head' ? 1.7 : q.name === 'torso' ? 2.3 : 2.0;
      if (d > q.len * lim) q.strain += dt; else q.strain = Math.max(0, q.strain - dt * 0.5);
      if (q.strain > 0.07) { q.strain = 0; this.tear(q); }
    }
    for (const q of this.pieces) q.updateBounds();
    this.bleed(dt);
  }

  adjacency() {
    const adj = new Map();
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (const q of this.pieces) { link(q.a, q.b); link(q.b, q.a); }
    return adj;
  }

  component(p, adj) {
    adj = adj || this.adjacency();
    const seen = new Set([p]);
    const stack = [p];
    while (stack.length) {
      const q = stack.pop();
      for (const o of adj.get(q) || []) if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
    return seen;
  }

  newParticle(x, y, px, py) {
    const p = new Particle(x, y, 5, 1);
    p.px = px; p.py = py;
    p.rag = this; p.role = -1;
    this.parts.push(p);
    return p;
  }

  newParticleAt(piece, u, v, F, Fp) {
    const [x, y] = piece.localWorld(u, v, F);
    const [px, py] = piece.localWorld(u, v, Fp);
    return this.newParticle(x, y, px, py);
  }

  // Rip a piece off its parent joint (tentacle yanks, extreme stretching).
  tear(piece) {
    const a = piece.a;
    const np = this.newParticle(a.x, a.y, a.px, a.py);
    for (const q of this.pieces) if (q !== piece && (q.a === a || q.b === a)) q.exposeNear(a.x, a.y, 2.2);
    piece.a = np;
    piece.exposeNear(np.x, np.y, 2.4);
    if (this.game) {
      this.game.blood.burst(a.x, a.y, 40, 380);
      Sfx.rip();
    }
    this.refreshTopology('tear', a.x, a.y);
  }

  // Burn pixels away around grid cell (gi, gj). Returns number removed.
  burn(piece, gi, gj, radius, prob, char) {
    const removed = [];
    const { w, h, col } = piece;
    for (let j = Math.floor(gj - radius); j <= gj + radius; j++)
      for (let i = Math.floor(gi - radius); i <= gi + radius; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const idx = j * w + i;
        if (!col[idx] || (i + 0.5 - gi) ** 2 + (j + 0.5 - gj) ** 2 > radius * radius) continue;
        if (Math.random() < prob) { col[idx] = 0; removed.push(idx); }
      }
    if (!removed.length) return 0;
    piece.count -= removed.length;
    for (const idx of removed) {
      const i = idx % w, j = (idx / w) | 0;
      if (i > 0) piece.expose(idx - 1, char);
      if (i < w - 1) piece.expose(idx + 1, char);
      if (j > 0) piece.expose(idx - w, char);
      if (j < h - 1) piece.expose(idx + w, char);
    }
    this.checkSplit(piece);
    return removed.length;
  }

  // Flood-fill a piece; if it fell apart, each island becomes its own body.
  checkSplit(piece) {
    const { w, h, col } = piece;
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];
    for (let s = 0; s < w * h; s++) {
      if (!col[s] || label[s] >= 0) continue;
      const id = comps.length, list = [s];
      label[s] = id;
      for (let q = 0; q < list.length; q++) {
        const idx = list[q], i = idx % w, j = (idx / w) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if ((!di && !dj) || ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const n = nj * w + ni;
          if (col[n] && label[n] < 0) { label[n] = id; list.push(n); }
        }
      }
      comps.push(list);
    }
    if (comps.length === 1) return false;
    const F = piece.frame();
    const big = [];
    for (const c of comps) {
      if (c.length >= 4) { big.push(c); continue; }
      for (const idx of c) {          // crumbs become gore particles
        const [x, y] = piece.cellWorld(idx, F);
        if (this.game) this.game.blood.spawn(x, y, rand(-120, 120), rand(-200, 0), 2.5, piece.col[idx]);
        piece.col[idx] = 0;
      }
      piece.count -= c.length;
    }
    if (big.length === 0) { this.pieces = this.pieces.filter((q) => q !== piece); this.refreshTopology(); return true; }
    if (big.length === 1) return false;

    // Which island keeps each original joint?
    const lenG = piece.len / PX;
    const near = (c, gu, gv) => {
      let best = 1e9;
      for (const idx of c) {
        const u = (idx % w) + 0.5 - piece.ox, v = ((idx / w) | 0) + 0.5 - piece.oy;
        best = Math.min(best, (u - gu) ** 2 + (v - gv) ** 2);
      }
      return best;
    };
    let ca = -1, cb = -1, da = 6.5, db = 6.5;
    big.forEach((c, k) => {
      const x = near(c, 0, 0); if (x < da) { da = x; ca = k; }
      const y = near(c, lenG, 0); if (y < db) { db = y; cb = k; }
    });
    const Fp = piece.framePrev();
    const out = big.map((c, k) => {
      let umin = 1e9, umax = -1e9, vs = 0;
      for (const idx of c) {
        const u = (idx % w) + 0.5 - piece.ox, v = ((idx / w) | 0) + 0.5 - piece.oy;
        umin = Math.min(umin, u); umax = Math.max(umax, u); vs += v;
      }
      let pa, pb, u0 = 0, v0 = 0;
      if (k === ca && k === cb) { pa = piece.a; pb = piece.b; }
      else if (k === ca) { pa = piece.a; pb = this.newParticleAt(piece, Math.max(umax, 1.5), 0, F, Fp); }
      else if (k === cb) { u0 = Math.min(umin, lenG - 1.5); pa = this.newParticleAt(piece, u0, 0, F, Fp); pb = piece.b; }
      else {
        u0 = umin; v0 = vs / c.length;
        pa = this.newParticleAt(piece, u0, v0, F, Fp);
        pb = this.newParticleAt(piece, Math.max(umax, umin + 2), v0, F, Fp);
      }
      const colN = new Uint32Array(w * h), expN = new Uint8Array(w * h);
      for (const idx of c) { colN[idx] = col[idx]; expN[idx] = piece.exposed[idx]; }
      const len = pa === piece.a && pb === piece.b ? piece.len : dist(pa.x, pa.y, pb.x, pb.y);
      return new Piece(this, piece.name, pa, pb, {
        w, h, ox: piece.ox + u0, oy: piece.oy + v0, col: colN, inner: piece.inner, exposed: expN,
        wounds: piece.wounds.filter((idx) => colN[idx]), bleed: 1, len, origCount: piece.origCount,
      }, piece.z);
    });
    const at = this.pieces.indexOf(piece);
    this.pieces.splice(at, 1, ...out);
    this.refreshTopology('split', piece.bc.x, piece.bc.y);
    return true;
  }

  refreshTopology(kind, x, y) {
    const used = new Set();
    for (const q of this.pieces) { used.add(q.a); used.add(q.b); }
    this.parts = this.parts.filter((p) => used.has(p));
    const adj = this.adjacency();
    const comp = new Map();
    let id = 0;
    for (const p of this.parts) {
      if (comp.has(p)) continue;
      for (const q of this.component(p, adj)) comp.set(q, id);
      id++;
    }
    this.stabs = this.stabs.filter((s) => used.has(s.a) && used.has(s.b) && comp.get(s.a) === comp.get(s.b));
    if (this.onChange) this.onChange(kind, x, y);
  }

  bleed(dt) {
    if (!this.game) return;
    const blood = this.game.blood;
    for (const q of this.pieces) {
      if (q.bleed <= 0 || !q.wounds.length) continue;
      q.bleed = Math.max(0, q.bleed - dt * 0.09);
      q.bleedAcc += Math.min(30, 2 + q.wounds.length) * q.bleed * dt;
      if (q.bleedAcc < 1) continue;
      const F = q.frame();
      while (q.bleedAcc >= 1 && q.wounds.length) {
        q.bleedAcc -= 1;
        const k = Math.floor(Math.random() * q.wounds.length);
        const idx = q.wounds[k];
        if (!q.col[idx]) { q.wounds[k] = q.wounds[q.wounds.length - 1]; q.wounds.pop(); continue; }
        const [x, y] = q.cellWorld(idx, F);
        const d = dist(q.bc.x, q.bc.y, x, y) || 1;
        const pulse = 0.4 + 0.6 * Math.sin(this.t * 11) ** 2;
        blood.spray(x, y, (x - q.bc.x) / d, (y - q.bc.y) / d, 1, (40 + 260 * pulse) * q.bleed, 0.5);
      }
    }
  }

  // Blood / char a specific world point on whatever pixel is there.
  pieceAt(x, y) {
    for (let k = this.pieces.length - 1; k >= 0; k--) {
      const q = this.pieces[k];
      if (Math.abs(x - q.bc.x) > q.bc.r || Math.abs(y - q.bc.y) > q.bc.r) continue;
      const idx = q.cellAt(x, y);
      if (idx >= 0) return { piece: q, idx };
    }
    return null;
  }

  render(fb) {
    const sorted = this.pieces.slice().sort((p, q) => p.z - q.z);
    for (const q of sorted) q.raster(fb);
  }
}
