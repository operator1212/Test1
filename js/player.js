// Subject 09: the escaped lab experiment. Platformer body + tentacle grapple,
// harpoon launcher and a stolen prototype laser.
'use strict';

const RUN_SPEED = 265;
const JUMP_V = 650;
const WEAPONS = ['HARPOON', 'PROTOTYPE LASER'];

function approach(v, target, amount) {
  return v < target ? Math.min(target, v + amount) : Math.max(target, v - amount);
}

class Player {
  constructor(game, x, y) {
    this.game = game;
    this.x = x; this.y = y;          // x = centre, y = feet
    this.vx = 0; this.vy = 0;
    this.w = 22; this.h = 108;
    this.onGround = false;
    this.coyote = 0; this.jumpBuf = 0; this.jumping = false;
    this.facing = 1;
    this.aim = { x: 1, y: 0 };
    this.weapon = 0;
    this.cool = 0;
    this.heat = 0; this.overheat = false; this.firingLaser = false;
    this.recoil = 0;
    this.runPhase = 0;
    this.t = 0;
    this.tentacle = new Tentacle(this);
    this.flip = 1;
    this.pts = RAG_REST.map(([ox, oy]) => ({ x: x + ox, y: y + oy }));
    this.pieces = PIECE_DEFS.map(([name, a, b, z]) => {
      const len = dist(RAG_REST[a][0], RAG_REST[a][1], RAG_REST[b][0], RAG_REST[b][1]) / PX;
      return new Piece(this, name, this.pts[a], this.pts[b], genSprite(name, len, 'subject'), z);
    });
    this.pieces.sort((p, q) => p.z - q.z);
  }

  shoulder() { return { x: this.x, y: this.y + RAG_REST[R.NECK][1] }; }

  muzzle() {
    const s = this.shoulder();
    let len = 13 * PX;
    const r = this.game.map.raycast(s.x, s.y, this.aim.x, this.aim.y, len);
    if (r.hit) len = Math.max(0, r.dist - 3);
    return { x: s.x + this.aim.x * len, y: s.y + this.aim.y * len };
  }

  box() { return [this.x - this.w / 2, this.y - this.h, this.x + this.w / 2, this.y]; }

  moveX(dx) {
    if (!dx) return false;
    this.x += dx;
    const [l, t, r, b] = this.box();
    if (!this.game.map.boxSolid(l, t, r, b)) return false;
    if (dx > 0) this.x = Math.floor(r / TILE) * TILE - this.w / 2 - 0.001;
    else this.x = (Math.floor(l / TILE) + 1) * TILE + this.w / 2 + 0.001;
    return true;
  }

  moveY(dy) {
    if (!dy) return false;
    this.y += dy;
    const [l, t, r, b] = this.box();
    if (!this.game.map.boxSolid(l, t, r, b)) return false;
    if (dy > 0) this.y = Math.floor(b / TILE) * TILE - 0.001;
    else this.y = (Math.floor(t / TILE) + 1) * TILE + this.h + 0.001;
    return true;
  }

  moveBy(dx, dy) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
    for (let i = 0; i < n; i++) {
      if (this.moveX(dx / n)) this.vx = 0;
      if (this.moveY(dy / n)) { if (dy > 0) this.onGround = true; this.vy = 0; }
    }
  }

  update(dt) {
    const g = this.game;
    this.t += dt;

    // Aim.
    const m = g.mouseWorld();
    const s = this.shoulder();
    const ad = dist(s.x, s.y, m.x, m.y) || 1;
    this.aim = { x: (m.x - s.x) / ad, y: (m.y - s.y) / ad };
    if (Math.abs(this.aim.x) > 0.05) this.facing = sign(this.aim.x);

    // Weapon select.
    if (Input.hit('Digit1')) this.weapon = 0;
    if (Input.hit('Digit2')) this.weapon = 1;
    if (Input.hit('KeyQ') || Input.wheel !== 0) this.weapon = 1 - this.weapon;

    // Horizontal movement.
    const left = Input.down('KeyA') || Input.down('ArrowLeft');
    const right = Input.down('KeyD') || Input.down('ArrowRight');
    const ax = (right ? 1 : 0) - (left ? 1 : 0);
    const roped = this.tentacle.attachedFixed();
    if (this.onGround) this.vx = approach(this.vx, ax * RUN_SPEED, (ax ? 2400 : 2800) * dt);
    else if (roped) this.vx += ax * 750 * dt;
    else if (ax !== 0) { if (ax * this.vx < RUN_SPEED) this.vx = approach(this.vx, ax * RUN_SPEED, 1500 * dt); }
    else this.vx *= Math.max(0, 1 - 1.2 * dt);

    this.vy = Math.min(this.vy + GRAVITY * dt, 1200);

    // Jumping (with coyote time + input buffer). Jumping off a grapple flings you.
    const jumpHeld = Input.down('Space') || Input.down('KeyW') || Input.down('ArrowUp');
    if (Input.hit('Space') || Input.hit('KeyW') || Input.hit('ArrowUp')) this.jumpBuf = 0.12;
    else this.jumpBuf -= dt;
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    if (this.jumpBuf > 0) {
      if (roped) {
        this.tentacle.release();
        this.vy = Math.min(this.vy, -560); this.vx += ax * 150;
        this.jumpBuf = 0;
      } else if (this.coyote > 0) {
        this.vy = -JUMP_V; this.coyote = 0; this.jumpBuf = 0; this.jumping = true;
      }
    }
    if (this.jumping && this.vy < 0 && !jumpHeld) { this.vy *= 0.5; this.jumping = false; }
    if (this.vy >= 0) this.jumping = false;

    // Integrate with tile collisions.
    this.onGround = false;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt / 8));
    for (let i = 0; i < n; i++) {
      if (this.moveX(this.vx * dt / n)) this.vx = 0;
      if (this.moveY(this.vy * dt / n)) { if (this.vy > 0) this.onGround = true; this.vy = 0; }
    }
    if (!this.onGround && this.vy >= 0) {
      const [l, , r, b] = this.box();
      if (g.map.boxSolid(l, b, r, b + 1.5)) this.onGround = true;
    }

    // Tentacle grapple.
    if (Input.mouse.pressed[2]) this.tentacle.fire(this.aim.x, this.aim.y);
    this.tentacle.update(dt, g);
    this.tentacle.applyRope();

    // Weapons.
    this.cool -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.firingLaser = false;
    if (this.weapon === 0) {
      if (Input.mouse.down[0] && this.cool <= 0) this.fireHarpoon();
      this.heat = Math.max(0, this.heat - 0.45 * dt);
    } else {
      if (Input.mouse.down[0] && !this.overheat) {
        this.firingLaser = true;
        this.heat += 0.3 * dt;
        if (this.heat >= 1) { this.heat = 1; this.overheat = true; Sfx.denied(); g.message('LASER OVERHEATED', '#ff8a3a'); }
      } else {
        this.heat = Math.max(0, this.heat - 0.45 * dt);
      }
      if (Input.mouse.pressed[0] && this.overheat) Sfx.denied();
    }
    if (this.overheat && this.heat < 0.3) this.overheat = false;
    Sfx.laserOn(this.firingLaser);

    if (this.onGround && Math.abs(this.vx) > 20) this.runPhase += Math.abs(this.vx) * dt * 0.05;

    if (this.y > g.map.ph + 300) { this.x = g.spawn.x; this.y = g.spawn.y; this.vx = this.vy = 0; }
  }

  fireHarpoon() {
    const g = this.game;
    const m = this.muzzle();
    g.spikes.push(new Spike(m.x, m.y, this.aim.x * HARPOON_SPEED, this.aim.y * HARPOON_SPEED));
    this.cool = 0.42;
    this.recoil = 1;
    this.vx -= this.aim.x * 40;
    g.shake(3);
    g.fx.flash(m.x, m.y, 26);
    g.fx.smoke(m.x, m.y, 4);
    Sfx.harpoon();
  }

  // Box vs loose ragdoll particles: the player shoves bodies around.
  pushBodies(npcs) {
    const [l, t, r, b] = this.box();
    for (const npc of npcs) for (const p of npc.rag.parts) {
      if (p.pin || p.held) continue;
      const cx = clamp(p.x, l, r), cy = clamp(p.y, t, b);
      const dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= p.r * p.r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x += dx / d * (p.r - d) * 0.5; p.y += dy / d * (p.r - d) * 0.5;
      } else {
        p.x += (p.x < this.x ? -1 : 1) * 2;
      }
      p.x += this.vx * DT * 0.3;
    }
  }

  // ------------------------------------------------------------ rendering
  // Pose the sprite puppet (art pixels, facing right, then mirrored).
  computePose() {
    const f = this.facing;
    this.flip = f;
    const P = REST_ART.map((o) => [o[0], o[1]]);
    const t = this.t;
    const running = this.onGround && Math.abs(this.vx) > 20;
    if (running) {
      const ph = this.runPhase;
      for (const [k, ft, p] of [[R.KNEE_F, R.FOOT_F, ph], [R.KNEE_B, R.FOOT_B, ph + Math.PI]]) {
        const fx = Math.sin(p) * 5 * sign(this.vx) * f, lift = Math.max(0, Math.cos(p)) * 3.5;
        P[ft] = [fx, -2 - lift];
        P[k] = [fx * 0.5 + 2, -10.5 - lift * 0.6];
      }
      P[R.PELVIS][1] -= Math.abs(Math.cos(ph)) * 0.8;
      P[R.NECK][0] += 1.5; P[R.HEAD][0] += 2.2;
    } else if (!this.onGround) {
      if (this.tentacle.attachedFixed()) {
        P[R.KNEE_F] = [1.5, -10]; P[R.FOOT_F] = [0.5, -1.5]; P[R.KNEE_B] = [-1, -10.5]; P[R.FOOT_B] = [-2, -2];
      } else {
        P[R.KNEE_F] = [4, -13]; P[R.FOOT_F] = [1, -6]; P[R.KNEE_B] = [2, -12]; P[R.FOOT_B] = [-2.5, -5];
      }
    } else {
      P[R.NECK][1] += Math.sin(t * 2.2) * 0.3;
      P[R.HEAD][1] += Math.sin(t * 2.2 - 0.4) * 0.4;
    }
    const pts = this.pts;
    for (let i = 0; i < pts.length; i++) { pts[i].x = this.x + P[i][0] * PX * f; pts[i].y = this.y + P[i][1] * PX; }
    // Front arm aims the gun.
    const N = pts[R.NECK];
    const a = this.aim, rc = this.recoil * 2 * PX;
    pts[R.ELBOW_F].x = N.x + a.x * 5.5 * PX; pts[R.ELBOW_F].y = N.y + a.y * 5.5 * PX + PX;
    pts[R.HAND_F].x = N.x + a.x * (11 * PX - rc); pts[R.HAND_F].y = N.y + a.y * (11 * PX - rc);
    // Back arm reaches toward whatever the tentacle is doing.
    const tn = this.tentacle;
    if (tn.state !== 'idle') {
      const d = dist(N.x, N.y, tn.tip.x, tn.tip.y) || 1;
      const ux = (tn.tip.x - N.x) / d, uy = (tn.tip.y - N.y) / d;
      pts[R.ELBOW_B].x = N.x + ux * 5.5 * PX; pts[R.ELBOW_B].y = N.y + uy * 5.5 * PX + PX;
      pts[R.HAND_B].x = N.x + ux * 11 * PX; pts[R.HAND_B].y = N.y + uy * 11 * PX;
    } else if (running) {
      const sw = Math.sin(this.runPhase) * 3 * PX;
      pts[R.ELBOW_B].x = N.x + sw * 0.5; pts[R.ELBOW_B].y = N.y + 6 * PX;
      pts[R.HAND_B].x = N.x + sw; pts[R.HAND_B].y = N.y + 12 * PX;
    }
    for (const q of this.pieces) q.updateBounds();
  }

  render(fb) {
    this.computePose();
    const pts = this.pts, f = this.facing;
    // Writhing tendrils out of the back.
    const N = pts[R.NECK], Pl = pts[R.PELVIS];
    for (let i = 0; i < 3; i++) {
      const k = 0.2 + i * 0.3;
      let x = lerp(N.x, Pl.x, k) / PX - f * 3, y = lerp(N.y, Pl.y, k) / PX;
      let ang = Math.atan2(-0.5 + i * 0.4, -f) + Math.sin(this.t * 3 + i * 1.7) * 0.4;
      for (let sgi = 0; sgi < 7; sgi++) {
        ang += Math.sin(this.t * 4 + i + sgi * 0.8) * 0.25;
        const nx = x + Math.cos(ang) * 1.2, ny = y + Math.sin(ang) * 1.2;
        fb.put(x, y, sgi < 3 ? TENT_OUT : TENT_MID);
        if (sgi < 3) fb.put(x, y + 1, TENT_OUT);
        x = nx; y = ny;
      }
      fb.put(x, y, TENT_HI);
    }
    for (const q of this.pieces) q.raster(fb);
    this.renderGun(fb);
  }

  renderGun(fb) {
    const h = this.pts[R.HAND_F];
    const a = this.aim;
    const x = h.x / PX, y = h.y / PX;
    const nx = -a.y, ny = a.x;
    if (this.weapon === 0) {
      fb.line(x - a.x * 2, y - a.y * 2, x + a.x * 7, y + a.y * 7, GUN_DARK);
      fb.line(x - a.x * 2 + nx * 0.9, y - a.y * 2 + ny * 0.9, x + a.x * 6 + nx * 0.9, y + a.y * 6 + ny * 0.9, GUN_MID);
      if (this.cool <= 0) fb.put(x + a.x * 8, y + a.y * 8, SPIKE_TIP);
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
