// Verlet particles + distance constraints. Everything floppy in the game
// (ragdolls, severed limbs, heads) is built from these.
'use strict';

const GRAVITY = 1800;       // px/s^2
const DT = 1 / 120;         // fixed simulation step
const MAX_STEP = 20;        // max px a particle may travel per step (anti-tunnelling)

class Particle {
  constructor(x, y, r, im) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.r = r;
    this.im = im;           // inverse mass
    this.pin = null;        // {x, y} when nailed to the world
    this.held = false;      // true while a flying harpoon is carrying it
    this.contact = null;    // last collision normal
    this.rag = null;
    this.role = -1;         // index in the ragdoll rest pose (-1 for split-off copies)
  }

  get vx() { return (this.x - this.px) / DT; }
  get vy() { return (this.y - this.py) / DT; }

  impulse(vx, vy) {         // add velocity in px/s
    this.px -= vx * DT; this.py -= vy * DT;
  }

  weight() { return (this.pin || this.held) ? 0 : this.im; }
}

function integrateParticle(p, damp) {
  if (p.pin) {
    p.x = p.px = p.pin.x; p.y = p.py = p.pin.y;
    return;
  }
  if (p.held) return;
  let vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp;
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp > MAX_STEP) { vx *= MAX_STEP / sp; vy *= MAX_STEP / sp; }
  p.px = p.x; p.py = p.y;
  p.x += vx; p.y += vy + GRAVITY * DT * DT;
}

// Distance constraint. c = { a, b, len, k, min }
function solveDist(c) {
  const a = c.a, b = c.b;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  if (c.min && d >= c.len) return;
  const wa = a.weight(), wb = b.weight();
  const w = wa + wb;
  if (w === 0) return;
  const f = ((d - c.len) / d) * c.k / w;
  a.x += dx * f * wa; a.y += dy * f * wa;
  b.x -= dx * f * wb; b.y -= dy * f * wb;
}

function collideParticle(p, map, friction) {
  if (p.pin || p.held) return;
  const n = map.pushCircle(p);
  p.contact = n;
  if (n && friction > 0) {
    const vx = p.x - p.px, vy = p.y - p.py;
    const vn = vx * n.x + vy * n.y;
    const tx = (vx - n.x * vn) * (1 - friction), ty = (vy - n.y * vn) * (1 - friction);
    const keep = vn > 0 ? vn : 0;
    p.px = p.x - (tx + n.x * keep);
    p.py = p.y - (ty + n.y * keep);
  }
}

// Soft push between two particles of different bodies.
function collidePair(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const r = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || d2 < 1e-6) return;
  const d = Math.sqrt(d2);
  const wa = a.weight(), wb = b.weight(), w = wa + wb;
  if (w === 0) return;
  const f = ((r - d) / d) * 0.5 / w;
  a.x -= dx * f * wa; a.y -= dy * f * wa;
  b.x += dx * f * wb; b.y += dy * f * wb;
}
