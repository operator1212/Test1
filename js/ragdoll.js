// Ragdoll skeleton, dismemberment and the shiny chrome "icon man" renderer
// (round floating head, rounded body, chunky mitten limbs).
'use strict';

// Particle roles. B = limb drawn behind the torso, F = in front.
const R = { PELVIS: 0, NECK: 1, HEAD: 2, ELBOW_B: 3, HAND_B: 4, ELBOW_F: 5, HAND_F: 6, KNEE_B: 7, FOOT_B: 8, KNEE_F: 9, FOOT_F: 10 };
const LEG_ROLES = new Set([R.KNEE_B, R.FOOT_B, R.KNEE_F, R.FOOT_F]);

// Rest pose, facing right, relative to the point between the feet on the ground.
const RAG_REST = [
  [0, -38], [0, -62], [0, -97],
  [-13, -50], [-16, -35], [13, -50], [16, -35],
  [-6, -21], [-7, -6], [6, -21], [7, -6],
];
const RAG_RADIUS = [11, 11, 14, 7, 7, 7, 7, 7, 6, 7, 6];
const RAG_IMASS = [0.5, 0.6, 0.9, 1, 1, 1, 1, 0.9, 1, 0.9, 1];
const HEAD_R = 15.5;

// [parent, child, name, kind, parentRadius, childRadius, hp]
const RAG_BONES = [
  [R.PELVIS, R.NECK, 'torso', 'torso', 15, 18, 170],
  [R.NECK, R.HEAD, 'neck', 'neck', 0, 0, 60],
  [R.NECK, R.ELBOW_B, 'upperArmB', 'limb', 8.5, 8, 55],
  [R.ELBOW_B, R.HAND_B, 'forearmB', 'limb', 8, 9, 45],
  [R.NECK, R.ELBOW_F, 'upperArmF', 'limb', 8.5, 8, 55],
  [R.ELBOW_F, R.HAND_F, 'forearmF', 'limb', 8, 9, 45],
  [R.PELVIS, R.KNEE_B, 'thighB', 'limb', 10, 8.5, 70],
  [R.KNEE_B, R.FOOT_B, 'shinB', 'limb', 8.5, 9, 60],
  [R.PELVIS, R.KNEE_F, 'thighF', 'limb', 10, 8.5, 70],
  [R.KNEE_F, R.FOOT_F, 'shinF', 'limb', 8.5, 9, 60],
];

// Soft constraints that keep the body from folding into itself: [a, b, len|null(rest), stiffness, minOnly]
const RAG_STABS = [
  [R.HEAD, R.PELVIS, null, 0.5, false],
  [R.KNEE_B, R.NECK, 30, 1, true], [R.KNEE_F, R.NECK, 30, 1, true],
  [R.FOOT_B, R.PELVIS, 18, 1, true], [R.FOOT_F, R.PELVIS, 18, 1, true],
  [R.HAND_B, R.NECK, 12, 1, true], [R.HAND_F, R.NECK, 12, 1, true],
  [R.KNEE_B, R.KNEE_F, 5, 0.5, true],
];

const DRAW_ORDER = ['upperArmB', 'forearmB', 'thighB', 'shinB', 'torso', '#coat', 'thighF', 'shinF', '#head', 'upperArmF', 'forearmF'];

const PALETTES = {
  guard:     { dark: '#1d1d22', mid: '#5f6069', light: '#b9bac4', spec: '#ffffff', line: '#101014' },
  scientist: { dark: '#4e5560', mid: '#9ea7b3', light: '#e4e9f0', spec: '#ffffff', line: '#2a2f38' },
  subject:   { dark: '#16040a', mid: '#57101c', light: '#b23846', spec: '#ffb3b8', line: '#070003' },
};

class Ragdoll {
  constructor(x, groundY, facing, style) {
    this.style = style;
    this.pal = PALETTES[style] || PALETTES.guard;
    this.facing = facing;
    this.parts = RAG_REST.map((o, i) => {
      const p = new Particle(x + o[0] * facing, groundY + o[1], RAG_RADIUS[i], RAG_IMASS[i]);
      p.rag = this; p.role = i;
      p.hip = i === R.PELVIS;
      return p;
    });
    const P = this.parts;
    this.bones = RAG_BONES.map(([a, b, name, kind, ra, rb, hp]) => ({
      a: P[a], b: P[b], len: dist(P[a].x, P[a].y, P[b].x, P[b].y), k: 1, min: false,
      name, kind, ra, rb, hp, maxHp: hp, char: 0, blood: 0, strain: 0, broken: false,
    }));
    this.stabs = RAG_STABS.map(([a, b, len, k, min]) => ({
      a: P[a], b: P[b], len: len == null ? dist(P[a].x, P[a].y, P[b].x, P[b].y) : len, k, min,
    }));
    this.stumps = [];
    this.headAngle = 0;
    this.headSpin = 0;
    this.decapitated = false;
    this.onSever = null;    // callback(bone, parentSideParticle, childSideParticle, cause)
    this.damp = 0.995;
  }

  get head() { return this.parts[R.HEAD]; }
  get pelvis() { return this.parts[R.PELVIS]; }
  bone(name) { return this.bones.find((b) => b.name === name); }
  isBroken(name) { const b = this.bone(name); return !b || b.broken; }
  pinned() { return this.parts.some((p) => p.pin); }

  integrate() {
    for (const p of this.parts) integrateParticle(p, this.damp);
  }

  solve(map, last) {
    for (const c of this.bones) if (!c.broken) solveDist(c);
    for (const c of this.stabs) solveDist(c);
    for (const p of this.parts) collideParticle(p, map, last ? 0.12 : 0);
  }

  // Called once per step after solving: tearing, head orientation.
  post(dt) {
    for (const b of this.bones) {
      if (b.broken || b.cut) continue;
      const d = dist(b.a.x, b.a.y, b.b.x, b.b.y);
      const lim = b.kind === 'neck' ? 1.7 : b.kind === 'torso' ? 2.3 : 2.0;
      if (d > b.len * lim) b.strain += dt; else b.strain = Math.max(0, b.strain - dt * 0.5);
      if (b.strain > 0.07) this.sever(b, 'tear');
    }
    const h = this.head;
    if (!this.decapitated) {
      const n = this.parts[R.NECK];
      this.headAngle = Math.atan2(h.y - n.y, h.x - n.x) + Math.PI / 2;
    } else {
      if (h.contact) this.headSpin = (h.x - h.px) / HEAD_R;
      else this.headSpin *= 0.999;
      this.headAngle += this.headSpin;
    }
  }

  // Connected component (through unbroken bones) containing particle p.
  component(p) {
    const seen = new Set([p]);
    const stack = [p];
    while (stack.length) {
      const q = stack.pop();
      for (const b of this.bones) {
        if (b.broken) continue;
        const o = b.a === q ? b.b : b.b === q ? b.a : null;
        if (o && !seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    return seen;
  }

  neighbor(p) {
    for (const b of this.bones) {
      if (b.broken) continue;
      if (b.a === p) return b.b;
      if (b.b === p) return b.a;
    }
    return null;
  }

  // Cut a bone at its parent joint. The limb keeps its own copy of the joint
  // so it still renders whole; both ends get a bloody stump.
  sever(bone, cause) {
    if (bone.broken || bone.cut) return;
    bone.cut = true;
    const a = bone.a, b = bone.b;
    let childEnd;
    if (bone.kind === 'neck') {
      bone.broken = true;
      this.decapitated = true;
      this.headSpin = rand(-0.2, 0.2);
      childEnd = b;
      this.stumps.push({ p: a, r: 9, head: false });
      this.stumps.push({ p: b, r: 8, head: true });
    } else {
      const np = new Particle(a.x, a.y, Math.max(5, a.r * 0.8), a.im);
      np.px = a.px; np.py = a.py;
      np.rag = this; np.role = -1;
      np.hip = a.hip;
      this.parts.push(np);
      bone.a = np;
      childEnd = np;
      this.stumps.push({ p: a, r: bone.ra * 0.75, toward: b });
      this.stumps.push({ p: np, r: bone.ra * 0.85, toward: null });
    }
    // Drop soft constraints that now bridge two separate pieces.
    const side = this.component(b);
    this.stabs = this.stabs.filter((s) => side.has(s.a) === side.has(s.b));
    bone.hp = Math.max(bone.hp, 1);
    if (this.onSever) this.onSever(bone, a, childEnd, cause);
  }

  // ------------------------------------------------------------ rendering
  render(ctx) {
    drawFigure(ctx, this.bones, this.head, this.headAngle, this.facing, this.pal, this.style, this.stumps, this.parts, this.headBlood || 0);
  }
}

// --------------------------------------------------------------- drawing
function taperedCapsulePath(ctx, ax, ay, ra, bx, by, rb) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy);
  ctx.beginPath();
  if (L < Math.abs(ra - rb) + 0.5) {
    ctx.arc(ra > rb ? ax : bx, ra > rb ? ay : by, Math.max(ra, rb), 0, TAU);
    return;
  }
  const ang = Math.atan2(dy, dx);
  const phi = Math.asin(clamp((ra - rb) / L, -1, 1));
  ctx.arc(ax, ay, ra, ang + Math.PI / 2 + phi, ang + Math.PI * 1.5 - phi, false);
  ctx.arc(bx, by, rb, ang - Math.PI / 2 - phi, ang + Math.PI / 2 + phi, false);
  ctx.closePath();
}

// Chrome shading across a limb: bright specular streak on the lit side.
function chromeFill(ctx, ax, ay, bx, by, r, pal) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if (nx * -0.55 + ny * -0.83 < 0) { nx = -nx; ny = -ny; }   // light from upper-left
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const g = ctx.createLinearGradient(cx + nx * r, cy + ny * r, cx - nx * r, cy - ny * r);
  g.addColorStop(0, pal.mid);
  g.addColorStop(0.18, pal.light);
  g.addColorStop(0.3, pal.spec);
  g.addColorStop(0.42, pal.light);
  g.addColorStop(0.7, pal.mid);
  g.addColorStop(1, pal.dark);
  return g;
}

function drawBone(ctx, b, pal, radiusScale = 1) {
  const ra = b.ra * radiusScale, rb = b.rb * radiusScale;
  taperedCapsulePath(ctx, b.a.x, b.a.y, ra, b.b.x, b.b.y, rb);
  ctx.fillStyle = chromeFill(ctx, b.a.x, b.a.y, b.b.x, b.b.y, Math.max(ra, rb), pal);
  ctx.fill();
  if (b.blood > 0.02) { ctx.fillStyle = `rgba(120,0,6,${Math.min(0.75, b.blood)})`; ctx.fill(); }
  if (b.char > 0.02) { ctx.fillStyle = `rgba(22,12,6,${Math.min(0.85, b.char)})`; ctx.fill(); }
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = pal.line;
  ctx.stroke();
}

function drawHead(ctx, h, angle, facing, pal, style, blood, charred) {
  const r = HEAD_R;
  const g = ctx.createRadialGradient(h.x - r * 0.28, h.y - r * 0.36, 1, h.x, h.y, r);
  g.addColorStop(0, pal.spec);
  g.addColorStop(0.22, pal.light);
  g.addColorStop(0.62, pal.mid);
  g.addColorStop(1, pal.dark);
  ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU);
  ctx.fillStyle = g; ctx.fill();
  if (blood > 0.02) { ctx.fillStyle = `rgba(120,0,6,${Math.min(0.7, blood)})`; ctx.fill(); }
  if (charred > 0.02) { ctx.fillStyle = `rgba(22,12,6,${Math.min(0.85, charred)})`; ctx.fill(); }
  ctx.lineWidth = 1.6; ctx.strokeStyle = pal.line; ctx.stroke();

  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(angle);
  ctx.scale(facing, 1);
  if (style === 'scientist') {
    // Little round glasses.
    ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = 1.6;
    ctx.fillStyle = 'rgba(190,225,255,0.85)';
    ctx.beginPath(); ctx.arc(10, -1, 4.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5.8, -1); ctx.lineTo(-4, -3); ctx.stroke();
  } else if (style === 'subject') {
    // Glowing eye.
    ctx.shadowColor = '#ffcf33'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffe36b';
    ctx.beginPath(); ctx.ellipse(9, -2, 3.8, 2.6, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3b0006';
    ctx.beginPath(); ctx.arc(6, 8, 5, 0, Math.PI); ctx.fill();
  }
  ctx.restore();
}

function drawCoat(ctx, bones) {
  const torso = bones.find((b) => b.name === 'torso');
  if (!torso || torso.broken) return;
  const p = torso.a, n = torso.b;
  const dx = p.x - n.x, dy = p.y - n.y;
  const ex = p.x + dx * 0.45, ey = p.y + dy * 0.45;
  const coat = { a: n, b: { x: ex, y: ey }, ra: 19.5, rb: 17, blood: torso.blood, char: torso.char };
  const pal = { dark: '#9aa3ae', mid: '#dfe4ea', light: '#f7f9fb', spec: '#ffffff', line: '#5d6570' };
  drawBone(ctx, coat, pal);
  // Lapel line.
  ctx.strokeStyle = 'rgba(80,90,105,0.7)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(n.x, n.y - 2); ctx.lineTo(lerp(n.x, ex, 0.8), lerp(n.y, ey, 0.8)); ctx.stroke();
}

function drawFigure(ctx, bones, head, headAngle, facing, pal, style, stumps, parts, headBlood, headChar) {
  const byName = {};
  for (const b of bones) (byName[b.name] = byName[b.name] || []).push(b);
  for (const key of DRAW_ORDER) {
    if (key === '#coat') { if (style === 'scientist') drawCoat(ctx, bones); continue; }
    if (key === '#head') {
      const nb = byName.neck && byName.neck[0];
      drawHead(ctx, head, headAngle, facing, pal, style, headBlood || (nb ? nb.blood : 0), headChar || (nb ? nb.char : 0));
      continue;
    }
    const list = byName[key];
    if (!list) continue;
    for (const b of list) {
      drawBone(ctx, b, pal);
      if (key === 'torso') {
        // Hip blobs so a halved lower body still looks finished.
        for (const p of parts) if (p.hip && p !== b.a) drawHipBlob(ctx, p, pal);
      }
    }
  }
  if (stumps) for (const s of stumps) drawStump(ctx, s, headAngle);
}

function drawHipBlob(ctx, p, pal) {
  const g = ctx.createRadialGradient(p.x - 5, p.y - 5, 1, p.x, p.y, 14);
  g.addColorStop(0, pal.light); g.addColorStop(0.6, pal.mid); g.addColorStop(1, pal.dark);
  ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, TAU);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = pal.line; ctx.stroke();
}

function drawStump(ctx, s, headAngle) {
  let x = s.p.x, y = s.p.y;
  if (s.head) { x -= Math.sin(headAngle) * 11; y += Math.cos(headAngle) * 11; }
  else if (s.toward) {
    const d = dist(x, y, s.toward.x, s.toward.y) || 1;
    x += (s.toward.x - x) / d * 3; y += (s.toward.y - y) / d * 3;
  }
  ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU);
  ctx.fillStyle = '#6d0008'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - s.r * 0.2, y - s.r * 0.2, s.r * 0.55, 0, TAU);
  ctx.fillStyle = '#b3141f'; ctx.fill();
  ctx.beginPath(); ctx.arc(x + s.r * 0.15, y + s.r * 0.1, s.r * 0.22, 0, TAU);
  ctx.fillStyle = '#f1e2d0'; ctx.fill();   // bone
}
