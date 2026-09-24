// Subject 09: the escaped lab experiment.
//
// Movement is an "adhesive core": the body is a small round core that feels
// every surface around it and floats at leg height above whatever it's on.
// Floors, walls, ceilings and vents are all the same thing: input is projected
// along the surface, pushing into a wall runs you up it and over the top, and
// tight spaces make you crouch then crawl. Nothing is a canned animation: feet
// and hands plant on real surface points and step when they drift, knees and
// elbows are solved with IK, and the body tilts smoothly to the surface.
'use strict';

const MOVE_SPEED = 270;
const AIR_SPEED = 265;
const JUMP_V = 640;
const DASH_SPEED = 860;
const CORE_R = 15;              // collision radius of the core (≈ pelvis)
const REACH = 80;               // how far away a surface can be felt/gripped
const RIDE_H = 46;              // pelvis height above the surface when there's room
const SENSE_RAYS = 20;
const LEG_A = 8.6 * PX, LEG_B = 8.5 * PX, ARM_A = 6.7 * PX, ARM_B = 6.1 * PX;
const WEAPONS = [
  { name: 'HARPOON', cool: 0.42, kind: 'harpoon' },
  { name: 'LASER', cool: 0, kind: 'laser' },
  { name: 'SHOTGUN', cool: 0.75, kind: 'shotgun' },
  { name: 'SAW', cool: 0.55, kind: 'saw' },
  { name: 'BILE', cool: 0.9, kind: 'bile' },
];

// Weapon kinds that are a creature's own attack (slot 1) rather than a stolen gun.
const NATURAL_KINDS = new Set(['bite', 'tendrils', 'dissolve', 'shards']);

function approach(v, target, amount) {
  return v < target ? Math.min(target, v + amount) : Math.max(target, v - amount);
}
function norm(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

// Two-bone IK: joint position for a limb from (ax,ay) to (bx,by), bending toward (bendX,bendY).
function ik2(ax, ay, bx, by, l1, l2, bendX, bendY) {
  let dx = bx - ax, dy = by - ay;
  let d = Math.hypot(dx, dy) || 1e-3;
  const maxD = l1 + l2 - 0.01;
  if (d > maxD) { bx = ax + dx / d * maxD; by = ay + dy / d * maxD; dx = bx - ax; dy = by - ay; d = maxD; }
  d = Math.max(d, Math.abs(l1 - l2) + 0.01);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  const px = -uy, py = ux;
  const sgn = px * bendX + py * bendY >= 0 ? 1 : -1;
  return { jx: ax + ux * a + px * h * sgn, jy: ay + uy * a + py * h * sgn, ex: bx, ey: by };
}

class Player {
  constructor(game, x, feetY) {
    this.game = game;
    // Creature subclasses override these with static fields.
    this.rideH = this.constructor.rideH || RIDE_H;
    this.x = x; this.y = feetY - this.rideH;   // the core, roughly the pelvis
    this.weapons = this.constructor.weaponList || WEAPONS;
    this.creature = this.constructor.creatureName || 'SUBJECT 09';
    this.hasTentacle = this.constructor.hasTentacle !== false;
    this.coreR = CORE_R;               // collision radius (creatures that grow enlarge it)
    this.mass = 0;                     // pixels eaten: creatures grow with it
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.aim = { x: 1, y: 0 };
    this.weapon = 0;
    this.cool = 0;
    this.heat = 0; this.overheat = false; this.firingLaser = false;
    this.recoil = 0;
    this.t = 0;
    this.maxHp = 100; this.hp = 100;
    this.god = false; this.dead = false; this.deadT = 0;
    this.hurtT = 0; this.lastHurt = -10;
    this.dashT = 0; this.dashCool = 0; this.airDashes = 1; this.dashDx = 1; this.dashDy = 0;
    this.rammed = new Set();
    this.trail = [];
    this.biteT = 0;
    // Adhesion state.
    this.up = { x: 0, y: -1 };       // smoothed surface normal (away from surface)
    this.bodyUp = { x: 0, y: -1 };   // smoothed visual body axis
    this.grip = 0;
    this.detachT = 0;
    this.lastGripT = 0;
    this.roomUp = 200;
    this.side = 1;                   // which way along the surface we face
    this.onGround = false;
    this.flickV = { x: 0, y: 0 };     // mouse velocity (world px/s) for grapple flicks
    this.lastMouse = null;
    this.tentacle = new Tentacle(this);
    this.flip = 1;
    this.pts = RAG_REST.map(([ox, oy]) => ({ x: x + ox, y: feetY + oy }));
    this.feet = [0, 1].map(() => ({ x: x, y: feetY, fx: x, fy: feetY, tx: x, ty: feetY, t: 1, planted: false }));
    this.hand = { x: x, y: feetY - 60, fx: 0, fy: 0, tx: 0, ty: 0, t: 1, planted: false };
    this.buildPieces();
    this.computePose(0);
  }

  buildPieces() {
    this.pieces = PIECE_DEFS.map(([name, a, b, z]) => {
      const len = dist(RAG_REST[a][0], RAG_REST[a][1], RAG_REST[b][0], RAG_REST[b][1]) / PX;
      return new Piece(this, name, this.pts[a], this.pts[b], genSprite(name, len, 'subject'), z);
    });
    this.pieces.sort((p, q) => p.z - q.z);
  }

  get cx() { return (this.pts[R.PELVIS].x + this.pts[R.NECK].x) / 2; }
  get cy() { return (this.pts[R.PELVIS].y + this.pts[R.NECK].y) / 2; }

  shoulder() { const n = this.pts[R.NECK]; return { x: n.x, y: n.y }; }

  mouth() {
    const h = this.pts[R.HEAD], t = { x: -this.bodyUp.y, y: this.bodyUp.x };
    return { x: h.x + t.x * this.side * 2 * PX, y: h.y + t.y * this.side * 2 * PX };
  }

  muzzle() {
    const s = this.shoulder();
    let len = 13 * PX;
    const r = this.game.map.raycast(s.x, s.y, this.aim.x, this.aim.y, len);
    if (r.hit) len = Math.max(0, r.dist - 3);
    return { x: s.x + this.aim.x * len, y: s.y + this.aim.y * len };
  }

  box() {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const p of this.pts) { l = Math.min(l, p.x); r = Math.max(r, p.x); t = Math.min(t, p.y); b = Math.max(b, p.y); }
    return [l - 8, t - 14, r + 8, b + 4];
  }

  // Pixel-precise: is there a body pixel of ours at (x, y)?
  hitTest(x, y) {
    if (this.dead || dist(x, y, this.cx, this.cy) > 80) return false;
    for (const q of this.pieces) if (q.cellAt(x, y) >= 0) return true;
    return false;
  }

  // Move the core with circle-vs-tile collision (used by the tentacle rope).
  moveBy(dx, dy) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
    const c = { x: this.x, y: this.y, r: this.coreR };
    for (let i = 0; i < n; i++) {
      c.x += dx / n; c.y += dy / n;
      const nrm = this.game.map.pushCircle(c);
      if (nrm) { const vn = this.vx * nrm.x + this.vy * nrm.y; if (vn < 0) { this.vx -= nrm.x * vn; this.vy -= nrm.y * vn; } }
    }
    this.x = c.x; this.y = c.y;
  }

  // Feel for surfaces all around the core.
  sense() {
    const m = this.game.map;
    let nx = 0, ny = 0, w = 0;
    for (let i = 0; i < SENSE_RAYS; i++) {
      const a = (i + 0.5) / SENSE_RAYS * TAU;
      const dx = Math.cos(a), dy = Math.sin(a);
      const r = m.raycast(this.x, this.y, dx, dy, REACH);
      if (!r.hit) continue;
      const k = 1 - r.dist / REACH;
      nx -= dx * k * k; ny -= dy * k * k; w += k * k;
    }
    const l = Math.hypot(nx, ny);
    return { n: l > 0.05 ? { x: nx / l, y: ny / l } : null, w };
  }

  hurt(dmg, dx, dy, x, y) {
    if (this.dead || this.god || this.dashT > 0 || dmg <= 0) return;
    this.hp -= dmg;
    this.hurtT = 0.2;
    this.lastHurt = this.t;
    const g = this.game;
    g.blood.spray(x, y, dx || 0, dy || -1, 8, 300, 0.6);
    // The wound shows up on the exact pixel that was hit.
    for (let k = this.pieces.length - 1; k >= 0; k--) {
      const q = this.pieces[k];
      if (q.cellAt(x, y) >= 0) { q.exposeNear(x, y, 1); break; }
    }
    Sfx.hurt();
    g.shake(1.5);
    if (this.hp <= 0) this.die();
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  die() {
    const g = this.game;
    this.dead = true;
    this.deadT = 2.5;
    this.hp = 0;
    this.tentacle.release(false);
    Sfx.laserOn(false);
    this.firingLaser = false;
    // Burst into pixels.
    for (const q of this.pieces) {
      const F = q.frame();
      for (let idx = 0; idx < q.col.length; idx++) {
        if (!q.col[idx] || Math.random() < 0.5) continue;
        const [x, y] = q.cellWorld(idx, F);
        g.blood.spawn(x, y, rand(-420, 420), rand(-620, 50), 2.5, q.col[idx]);
      }
    }
    g.blood.burst(this.cx, this.cy, 80, 500);
    Sfx.rip();
    g.message('SUBJECT 09 NEUTRALISED', '#ff5a64');
  }

  respawn() {
    const s = this.game.spawn;
    this.x = s.x; this.y = s.y - this.rideH; this.vx = this.vy = 0;
    this.hp = this.maxHp; this.dead = false;
    this.up = { x: 0, y: -1 }; this.bodyUp = { x: 0, y: -1 };
    for (const f of this.feet) f.planted = false;
    this.buildPieces();
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    this.t += dt;
    if (this.dead) {
      this.deadT -= dt;
      if (this.deadT <= 0) this.respawn();
      return;
    }
    this.hurtT -= dt;
    if (this.t - this.lastHurt > 5) this.heal(4 * dt);

    // Aim.
    const m = g.mouseWorld();
    const s = this.shoulder();
    const ad = dist(s.x, s.y, m.x, m.y) || 1;
    this.aim = { x: (m.x - s.x) / ad, y: (m.y - s.y) / ad };
    if (Math.abs(this.aim.x) > 0.05) this.facing = sign(this.aim.x);
    // Mouse velocity, for flicks while swinging.
    const mx = Input.mouse.x, my = Input.mouse.y, vs = g.view.s;
    if (this.lastMouse) {
      const fx = (mx - this.lastMouse.x) / vs * PX / dt, fy = (my - this.lastMouse.y) / vs * PX / dt;
      this.flickV.x = lerp(this.flickV.x, fx, 0.35); this.flickV.y = lerp(this.flickV.y, fy, 0.35);
    }
    this.lastMouse = { x: mx, y: my };

    // Weapon select.
    const nw = this.weapons.length;
    for (let i = 0; i < nw; i++) if (Input.hit('Digit' + (i + 1))) this.weapon = i;
    if (Input.hit('KeyQ')) this.weapon = (this.weapon + 1) % nw;
    if (Input.wheel) this.weapon = (this.weapon + (Input.wheel > 0 ? 1 : nw - 1)) % nw;

    this.move(dt);

    // Tentacle.
    if (this.hasTentacle) {
      if (Input.mouse.pressed[2]) this.tentacle.fire(this.aim.x, this.aim.y);
      this.tentacle.update(dt, g);
      this.tentacle.applyRope(g);
      this.tentacle.updateEat(dt, g, Input.down('KeyE'), Input.hit('KeyE'));
    }
    this.biteT -= dt;

    // Weapons.
    this.cool -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.firingLaser = false;
    const kind = this.wkind();
    const nat = NATURAL_KINDS.has(kind);
    this.natural(dt, nat && Input.mouse.down[0], nat && Input.mouse.pressed[0], nat && Input.mouse.released[0]);
    if (nat) {
      this.heat = Math.max(0, this.heat - 0.45 * dt);
    } else if (kind === 'laser') {
      if (Input.mouse.down[0] && !this.overheat) {
        this.firingLaser = true;
        this.heat += 0.3 * dt;
        if (this.heat >= 1) { this.heat = 1; this.overheat = true; Sfx.denied(); g.message('LASER OVERHEATED', '#ff8a3a'); }
      } else {
        this.heat = Math.max(0, this.heat - 0.45 * dt);
      }
      if (Input.mouse.pressed[0] && this.overheat) Sfx.denied();
    } else {
      this.heat = Math.max(0, this.heat - 0.45 * dt);
      if (Input.mouse.down[0] && this.cool <= 0) this.fire(kind);
    }
    if (this.overheat && this.heat < 0.3) this.overheat = false;
    Sfx.laserOn(this.firingLaser);

    this.computePose(dt);
    if (this.y > g.map.ph + 300) { this.respawn(); }
  }

  move(dt) {
    const map = this.game.map;
    const left = Input.down('KeyA') || Input.down('ArrowLeft');
    const right = Input.down('KeyD') || Input.down('ArrowRight');
    const upK = Input.down('KeyW') || Input.down('ArrowUp');
    const downK = Input.down('KeyS') || Input.down('ArrowDown');
    const ix = (right ? 1 : 0) - (left ? 1 : 0), iy = (downK ? 1 : 0) - (upK ? 1 : 0);
    const il = Math.hypot(ix, iy);
    const I = il ? { x: ix / il, y: iy / il } : { x: 0, y: 0 };
    const roped = this.tentacle.attachedFixed();

    this.detachT -= dt;
    this.dashCool -= dt;
    const sen = this.sense();
    let grip = sen.n ? clamp(sen.w * 2.6, 0, 1) : 0;
    if (this.detachT > 0 || this.dashT > 0) grip = 0;
    if (roped && this.tentacle.taut) grip = 0;
    // Push away from a wall/ceiling to let go of it.
    if (grip > 0 && il && sen.n.y > -0.7 && I.x * sen.n.x + I.y * sen.n.y > 0.6) { grip = 0; this.detachT = 0.15; }

    // Smoothly track the surface normal.
    const target = grip > 0.2 ? sen.n : { x: 0, y: -1 };
    let k = 1 - Math.exp(-dt * (grip > 0.2 ? 14 : 5));
    if (this.up.x * target.x + this.up.y * target.y < -0.2) k = 1;   // surface flipped (e.g. grabbed a ceiling)
    this.up = norm(lerp(this.up.x, target.x, k), lerp(this.up.y, target.y, k));
    this.grip = grip;
    if (grip > 0.3) { this.lastGripT = this.t; this.airDashes = 1; }
    const u = this.up, t = { x: -u.y, y: u.x };
    this.onGround = grip > 0.3 && u.y < -0.6;

    // Dash (Shift): burst in the held direction (or away from the surface / facing).
    if ((Input.hit('ShiftLeft') || Input.hit('ShiftRight')) && this.dashCool <= 0 && (grip > 0.3 || this.airDashes > 0)) {
      const d = il ? I : grip > 0.3 && u.y > -0.6 ? u : { x: this.facing, y: 0 };
      this.dashDx = d.x; this.dashDy = d.y;
      this.dashT = 0.16; this.dashCool = 0.5; this.detachT = 0.22;
      if (grip <= 0.3) this.airDashes--;
      this.rammed.clear();
      Sfx.dash();
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDx * DASH_SPEED; this.vy = this.dashDy * DASH_SPEED;
      this.trail.push({ x: this.x, y: this.y, t: 0.22 });
      if (this.dashT <= 0) { this.vx *= 0.55; this.vy *= 0.4; }
    } else {
      // Distance to the surface below us and to whatever is above.
      const rd = map.raycast(this.x, this.y, -u.x, -u.y, REACH * 1.6);
      const dS = rd.hit ? rd.dist : REACH * 1.6;
      const ru = map.raycast(this.x, this.y, u.x, u.y, 140);
      this.roomUp = ru.hit ? ru.dist : 140;
      const H = clamp((dS + this.roomUp) * 0.42, this.coreR + 3, this.rideH);
      // Ride spring: hold the core at leg height above the surface (critically damped).
      const vn = this.vx * u.x + this.vy * u.y;
      const acc = rd.hit && dS < REACH * 1.2 ? ((H - dS) * 380 - vn * 38) * grip : 0;
      this.vx += u.x * acc * dt; this.vy += u.y * acc * dt;
      // Gravity only for the part we're not holding on with.
      this.vy += GRAVITY * (1 - grip) * dt;
      this.vy = Math.min(this.vy, 1200);

      if (grip > 0.05) {
        // Move along the surface.
        let dir = 0;
        if (il) {
          const along = I.x * t.x + I.y * t.y;
          const into = I.x * u.x + I.y * u.y;
          if (Math.abs(along) > 0.25) dir = sign(along);
          else if (into < -0.5 && u.y > -0.7) {
            // Pushing straight into a wall or ceiling: run up it / along it.
            dir = Math.abs(t.y) > 0.2 ? sign(-t.y) : sign(t.x * this.facing) || 1;
          }
        }
        const vt = this.vx * t.x + this.vy * t.y;
        const nvt = approach(vt, dir * (this.moveSpeed || MOVE_SPEED), (dir ? 3000 : 2400) * dt * grip);
        this.vx += t.x * (nvt - vt); this.vy += t.y * (nvt - vt);
      }
      if (grip < 1) {
        // Air control for the rest.
        const ax = ix, air = 1 - grip;
        if (!(roped && this.tentacle.taut) && ax && ax * this.vx < AIR_SPEED) this.vx = approach(this.vx, ax * AIR_SPEED, 1500 * dt * air);
      }
    }

    // Jump: off whatever we're holding, along its normal. W also jumps off floors.
    const coyote = this.t - this.lastGripT < 0.12;
    const jump = Input.hit('Space') || ((Input.hit('KeyW') || Input.hit('ArrowUp')) && this.onGround);
    if (jump && roped) {
      this.tentacle.release(false);
      this.vy = Math.min(this.vy, -560); this.vx += ix * 150;
      this.detachT = 0.2;
    } else if (jump && (grip > 0.2 || coyote)) {
      const n = grip > 0.2 ? u : this.up;
      const vn = this.vx * n.x + this.vy * n.y;
      if (vn < 0) { this.vx -= n.x * vn; this.vy -= n.y * vn; }
      const lift = n.y > -0.6 ? 0.55 : 0;          // off walls/ceilings, add some upward kick
      this.vx += n.x * JUMP_V + ix * 140;
      this.vy += n.y * JUMP_V - lift * JUMP_V * 0.8;
      this.detachT = 0.2;
      this.lastGripT = -1;
      if (n.y > -0.6) Sfx.whip();
    }

    for (const tr of this.trail) tr.t -= dt;
    this.trail = this.trail.filter((tr) => tr.t > 0);

    // Integrate with circle collision.
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) * dt / 6));
    const c = { x: this.x, y: this.y, r: this.coreR };
    for (let i = 0; i < steps; i++) {
      c.x += this.vx * dt / steps; c.y += this.vy * dt / steps;
      const n = map.pushCircle(c);
      if (n) { const vn = this.vx * n.x + this.vy * n.y; if (vn < 0) { this.vx -= n.x * vn; this.vy -= n.y * vn; } }
    }
    this.x = c.x; this.y = c.y;
  }

  wkind() { return this.weapons[this.weapon].kind; }

  // Eating: heal and grow. Creatures that grow implement grow().
  feed(px) {
    this.mass += px;
    this.heal(px * 0.25);
    if (this.grow) this.grow();
  }

  // Natural (creature) attack; Subject 09 has none.
  natural() {}

  // Where the rope/tentacle comes out of the body.
  ropeOrigin() { return this.pts[R.HAND_B]; }

  fire(kind) {
    const g = this.game;
    const m = this.muzzle(), a = this.aim;
    this.cool = this.weapons[this.weapon].cool;
    this.recoil = 1;
    if (kind === 'harpoon') {
      g.spikes.push(new Spike(m.x, m.y, a.x * HARPOON_SPEED, a.y * HARPOON_SPEED));
      this.vx -= a.x * 40;
      g.shake(1);
      g.fx.flash(m.x, m.y, 26);
      g.fx.smoke(m.x, m.y);
      Sfx.harpoon();
    } else if (kind === 'shotgun') {
      const base = Math.atan2(a.y, a.x);
      // Devastating point blank, weak past ~12 tiles.
      for (let k = 0; k < 8; k++) {
        const ang = base + rand(-0.21, 0.21), sp = rand(1300, 1650);
        g.shots.push(new Bullet(m.x, m.y, Math.cos(ang) * sp, Math.sin(ang) * sp, 'player', 14, 'shotgun', null, 380));
      }
      // Big kick: aim down and fire to boost a jump.
      this.vx -= a.x * 360; this.vy -= a.y * 420; this.detachT = 0.15;
      g.shake(2);
      g.fx.flash(m.x, m.y, 34, '#ffd27a');
      for (let k = 0; k < 3; k++) g.fx.smoke(m.x, m.y);
      Sfx.shotgun();
    } else if (kind === 'saw') {
      g.shots.push(new Saw(m.x, m.y, a.x * 1050, a.y * 1050));
      Sfx.whip(); Sfx.clang();
    } else if (kind === 'bile') {
      g.shots.push(new Bomb(m.x, m.y, a.x * 720 + this.vx * 0.3, a.y * 720 - 120 + this.vy * 0.2));
      Sfx.squelch();
    }
  }

  // Box vs loose ragdoll particles: the player shoves bodies around.
  pushBodies(npcs) {
    if (this.dead) return;
    const P = this.pts[R.PELVIS], H = this.pts[R.HEAD];
    for (const npc of npcs) for (const p of npc.rag.parts) {
      if (p.pin || p.held) continue;
      const c = closestOnSeg(p.x, p.y, P.x, P.y, H.x, H.y);
      const r = 13 + p.r;
      if (c.d2 >= r * r) continue;
      const d = Math.sqrt(c.d2) || 1;
      const push = (r - d) * 0.5;
      p.x += (p.x - c.x) / d * push; p.y += (p.y - c.y) / d * push;
      p.x += this.vx * DT * 0.3; p.y += this.vy * DT * 0.3;
    }
  }

  // ------------------------------------------------------------ procedural body
  // Step a planted limb end toward (tx, ty) with a little arc along `up`.
  stepLimb(L, tx, ty, grounded, reach, other, dt, speed) {
    if (!grounded) {
      L.planted = false; L.t = 1;
      const k = 1 - Math.exp(-dt * 18);
      L.x = lerp(L.x, tx, k); L.y = lerp(L.y, ty, k);
      return;
    }
    if (!L.planted) { L.planted = true; L.t = 1; L.x = tx; L.y = ty; return; }
    if (L.t >= 1 && dist(L.x, L.y, tx, ty) > reach && (!other || other.t >= 1)) {
      L.fx = L.x; L.fy = L.y; L.tx = tx; L.ty = ty; L.t = 0;
    }
    if (L.t < 1) {
      // Keep re-aiming the step at the moving target.
      L.tx = lerp(L.tx, tx, 0.3); L.ty = lerp(L.ty, ty, 0.3);
      L.t = Math.min(1, L.t + dt * speed);
      const e = L.t * L.t * (3 - 2 * L.t);
      const lift = Math.sin(Math.PI * L.t) * 3 * PX;
      L.x = lerp(L.fx, L.tx, e) + this.up.x * lift;
      L.y = lerp(L.fy, L.ty, e) + this.up.y * lift;
    }
  }

  computePose(dt) {
    const map = this.game.map;
    const grounded = this.grip > 0.25 && this.dashT <= 0;
    const u = grounded ? this.up : { x: 0, y: -1 };
    const t = { x: -u.y, y: u.x };
    // Which way along the surface we face: movement first, else aim.
    const velT = this.vx * t.x + this.vy * t.y;
    const aimT = this.aim.x * t.x + this.aim.y * t.y;
    if (Math.abs(velT) > 60) this.side = sign(velT);
    else if (Math.abs(aimT) > 0.3) this.side = sign(aimT);
    const s = this.side;
    const fx = t.x * s, fy = t.y * s;           // forward along the surface
    this.flip = s;

    // Body axis: surface up; lean forward into a crawl when there's no headroom;
    // tilt with velocity in the air.
    let B = u;
    const need = 25 * PX;
    if (grounded && this.roomUp - 4 < need) {
      const th = Math.acos(clamp((this.roomUp - 4) / need, 0.05, 1));
      B = norm(u.x * Math.cos(th) + fx * Math.sin(th), u.y * Math.cos(th) + fy * Math.sin(th));
    } else if (!grounded) {
      const tn = this.tentacle;
      if (tn.swinging() && tn.taut) {
        const a = tn.point();
        B = norm(a.x - this.x, a.y - this.y);        // hang from the rope
      } else B = norm(this.vx * 0.0005, -1);
    }
    const kb = dt ? 1 - Math.exp(-dt * 12) : 1;
    this.bodyUp = norm(lerp(this.bodyUp.x, B.x, kb), lerp(this.bodyUp.y, B.y, kb));
    const b = this.bodyUp;
    const bt = { x: -b.y * s, y: b.x * s };     // body forward

    const P = this.pts;
    const pel = P[R.PELVIS], neck = P[R.NECK], head = P[R.HEAD];
    pel.x = this.x; pel.y = this.y;
    const bob = grounded ? Math.abs(Math.sin(this.t * 9)) * Math.min(1, Math.abs(velT) / 250) * 0.8 * PX : 0;
    neck.x = pel.x + b.x * (12 * PX + bob); neck.y = pel.y + b.y * (12 * PX + bob);
    const lunge = this.biteT > 0 ? 2 * PX : 0;
    head.x = neck.x + b.x * 6 * PX + bt.x * lunge; head.y = neck.y + b.y * 6 * PX + bt.y * lunge;

    // Legs: plant on the real surface under each hip, step when they drift.
    const legLen = LEG_A + LEG_B;
    const speed = Math.abs(velT);
    const stepSpeed = 7 + speed / 40;
    const lead = clamp(velT * 0.06, -10, 10);
    for (let k = 0; k < 2; k++) {
      const L = this.feet[k];
      const off = (k === 0 ? 2 : -2) * PX + lead * s * (grounded ? 1 : 0);
      const ox = pel.x + fx * off, oy = pel.y + fy * off;
      let tx, ty;
      if (grounded) {
        const r = map.raycast(ox, oy, -u.x, -u.y, legLen * 1.25);
        if (r.hit) { tx = r.x + u.x; ty = r.y + u.y; }
        else { tx = ox - u.x * legLen * 0.9; ty = oy - u.y * legLen * 0.9; }
      } else {
        // Tuck in the air.
        const tuck = this.vy < 0 ? 0.6 : 0.85;
        tx = pel.x - b.x * legLen * tuck + bt.x * (k === 0 ? 3 : -2) * PX;
        ty = pel.y - b.y * legLen * tuck + bt.y * (k === 0 ? 3 : -2) * PX;
      }
      this.stepLimb(L, tx, ty, grounded, 5.5 * PX, this.feet[1 - k], dt, stepSpeed);
      const knee = ik2(pel.x, pel.y, L.x, L.y, LEG_A, LEG_B, bt.x, bt.y);
      const [kr, fr] = k === 0 ? [R.KNEE_F, R.FOOT_F] : [R.KNEE_B, R.FOOT_B];
      P[kr].x = knee.jx; P[kr].y = knee.jy; P[fr].x = knee.ex; P[fr].y = knee.ey;
    }

    // Front arm aims the gun.
    const a = this.aim, rc = this.recoil * 2 * PX;
    const ha = ik2(neck.x, neck.y, neck.x + a.x * (11 * PX - rc), neck.y + a.y * (11 * PX - rc), ARM_A, ARM_B, -b.x, -b.y);
    P[R.ELBOW_F].x = ha.jx; P[R.ELBOW_F].y = ha.jy; P[R.HAND_F].x = ha.ex; P[R.HAND_F].y = ha.ey;

    // Back arm: tentacle > grabbing the wall/ceiling > swinging.
    const tn = this.tentacle, H = this.hand;
    let hx, hy, plant = false;
    if (tn.state !== 'idle') {
      const d = dist(neck.x, neck.y, tn.tip.x, tn.tip.y) || 1;
      hx = neck.x + (tn.tip.x - neck.x) / d * 11 * PX; hy = neck.y + (tn.tip.y - neck.y) / d * 11 * PX;
    } else if (grounded && u.y > -0.6) {
      const dir = norm(-u.x * 0.6 + fx, -u.y * 0.6 + fy);
      const r = map.raycast(neck.x, neck.y, dir.x, dir.y, 13 * PX);
      if (r.hit) { hx = r.x - dir.x; hy = r.y - dir.y; plant = true; }
    }
    if (hx === undefined) {
      const sw = grounded ? Math.sin(this.t * 9) * Math.min(1, speed / 250) * 3 * PX : 0;
      hx = neck.x - b.x * 11 * PX + bt.x * sw - bt.x * 1.5 * PX;
      hy = neck.y - b.y * 11 * PX + bt.y * sw - bt.y * 1.5 * PX;
    }
    this.stepLimb(H, hx, hy, plant, 5 * PX, null, dt, 10);
    const hb = ik2(neck.x, neck.y, H.x, H.y, ARM_A, ARM_B, -bt.x - b.x * 0.3, -bt.y - b.y * 0.3);
    P[R.ELBOW_B].x = hb.jx; P[R.ELBOW_B].y = hb.jy; P[R.HAND_B].x = hb.ex; P[R.HAND_B].y = hb.ey;

    for (const q of this.pieces) q.updateBounds();
  }

  render(fb) {
    if (this.dead) return;
    // Dash afterimages.
    for (const tr of this.trail) {
      for (const q of this.pieces) q.raster(fb, DASH_GHOST, tr.t * 2, tr.x - this.x, tr.y - this.y);
    }
    const pts = this.pts, b = this.bodyUp, s = this.side;
    const back = { x: b.y * s, y: -b.x * s };      // behind the body
    // Writhing tendrils out of the back.
    const N = pts[R.NECK], Pl = pts[R.PELVIS];
    for (let i = 0; i < 3; i++) {
      const k = 0.2 + i * 0.3;
      let x = lerp(N.x, Pl.x, k) / PX + back.x * 3, y = lerp(N.y, Pl.y, k) / PX + back.y * 3;
      let ang = Math.atan2(back.y + b.y * (0.5 - i * 0.4), back.x + b.x * (0.5 - i * 0.4)) + Math.sin(this.t * 3 + i * 1.7) * 0.4;
      for (let sgi = 0; sgi < 7; sgi++) {
        ang += Math.sin(this.t * 4 + i + sgi * 0.8) * 0.25;
        const nx = x + Math.cos(ang) * 1.2, ny = y + Math.sin(ang) * 1.2;
        fb.put(x, y, sgi < 3 ? TENT_OUT : TENT_MID);
        if (sgi < 3) fb.put(x - b.x, y - b.y, TENT_OUT);
        x = nx; y = ny;
      }
      fb.put(x, y, TENT_HI);
    }
    for (const q of this.pieces) q.raster(fb);
    if (this.hurtT > 0) for (const q of this.pieces) q.raster(fb, HURT_TINT, 0.6);
    else if (this.god) for (const q of this.pieces) if (Math.sin(this.t * 6) > 0.7) q.raster(fb, GOD_TINT, 0.25);
    this.renderGun(fb);
    if (this.biteT > 0) {
      const m = this.mouth(), mx = m.x / PX, my = m.y / PX;
      const f = { x: -b.y * s, y: b.x * s };
      fb.put(mx, my, JAW_C); fb.put(mx + f.x - b.x, my + f.y - b.y, JAW_C); fb.put(mx + f.x + b.x, my + f.y + b.y, JAW_C);
      fb.put(mx + f.x * 2 - b.x, my + f.y * 2 - b.y, TEETH_C); fb.put(mx + f.x * 2 + b.x, my + f.y * 2 + b.y, TEETH_C);
    }
  }

  renderGun(fb, hand) {
    const h = hand || this.pts[R.HAND_F];
    const a = this.aim;
    const x = h.x / PX, y = h.y / PX;
    const nx = -a.y, ny = a.x;
    const kind = this.wkind();
    if (NATURAL_KINDS.has(kind)) return;
    if (kind === 'harpoon') {
      fb.line(x - a.x * 2, y - a.y * 2, x + a.x * 7, y + a.y * 7, GUN_DARK);
      fb.line(x - a.x * 2 + nx * 0.9, y - a.y * 2 + ny * 0.9, x + a.x * 6 + nx * 0.9, y + a.y * 6 + ny * 0.9, GUN_MID);
      if (this.cool <= 0) fb.put(x + a.x * 8, y + a.y * 8, SPIKE_TIP);
    } else if (kind === 'shotgun') {
      fb.line(x - a.x * 3, y - a.y * 3, x + a.x * 8, y + a.y * 8, GUN_DARK);
      fb.line(x - a.x * 3 + nx * 0.9, y - a.y * 3 + ny * 0.9, x + a.x * 1 + nx * 0.9, y + a.y * 1 + ny * 0.9, STOCK_C);
      fb.line(x + a.x * 2 + nx * 0.9, y + a.y * 2 + ny * 0.9, x + a.x * 7 + nx * 0.9, y + a.y * 7 + ny * 0.9, GUN_MID);
    } else if (kind === 'saw') {
      fb.line(x - a.x * 2, y - a.y * 2, x + a.x * 5, y + a.y * 5, GUN_MID);
      fb.line(x - a.x * 2 + nx, y - a.y * 2 + ny, x + a.x * 5 + nx, y + a.y * 5 + ny, GUN_DARK);
      if (this.cool <= 0) {
        fb.disc(x + a.x * 8, y + a.y * 8, 2.2, SAW_DARK);
        fb.put(x + a.x * 8 + Math.cos(this.t * 30) * 2, y + a.y * 8 + Math.sin(this.t * 30) * 2, SAW_HI);
      }
    } else if (kind === 'bile') {
      fb.line(x - a.x * 2, y - a.y * 2, x + a.x * 6, y + a.y * 6, GUN_DARK);
      fb.disc(x + a.x * 2 - nx, y + a.y * 2 - ny, 1.6, this.cool <= 0 ? BILE_C : BILE_D);
    } else {
      const heat = this.overheat ? hexc('#ff3b2f') : mixc(hexc('#5ce1ff'), hexc('#ff5a2a'), this.heat);
      fb.line(x - a.x * 2, y - a.y * 2, x + a.x * 7, y + a.y * 7, GUN_WHITE);
      fb.line(x - a.x * 2 + nx * 0.9, y - a.y * 2 + ny * 0.9, x + a.x * 6 + nx * 0.9, y + a.y * 6 + ny * 0.9, GUN_EDGE);
      for (let k = 0; k < 3; k++) fb.put(x + a.x * (1 + k * 2) - nx * 0.9, y + a.y * (1 + k * 2) - ny * 0.9, heat);
      fb.put(x + a.x * 8, y + a.y * 8, this.firingLaser ? hexc('#ffffff') : heat);
    }
  }
}

const GUN_DARK = hexc('#23272e'), GUN_MID = hexc('#5d6674'), GUN_WHITE = hexc('#e8edf4'), GUN_EDGE = hexc('#4a5566');
const JAW_C = hexc('#3b0006'), TEETH_C = hexc('#f1e6cf');
const STOCK_C = hexc('#6b4226'), DASH_GHOST = hexc('#ff4f6d'), HURT_TINT = hexc('#ff2020'), GOD_TINT = hexc('#ffe36b');
