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
    this.w = 24; this.h = 100;
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
    this.pts = RAG_REST.map(() => ({ x: 0, y: 0 }));
    this.bones = RAG_BONES.map(([a, b, name, kind, ra, rb]) => ({ a: this.pts[a], b: this.pts[b], name, kind, ra, rb, blood: 0, char: 0 }));
  }

  shoulder() { return { x: this.x, y: this.y - 62 }; }

  muzzle() {
    const s = this.shoulder();
    let len = 38;
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
  computePose() {
    const f = this.facing;
    const P = RAG_REST.map((o) => [o[0], o[1]]);
    const t = this.t;
    const running = this.onGround && Math.abs(this.vx) > 20;
    if (running) {
      const ph = this.runPhase;
      for (const [k, ft, p] of [[R.KNEE_F, R.FOOT_F, ph], [R.KNEE_B, R.FOOT_B, ph + Math.PI]]) {
        const fx = Math.sin(p) * 14 * sign(this.vx) * f, lift = Math.max(0, Math.cos(p)) * 11;
        P[ft] = [fx, -5 - lift];
        P[k] = [fx * 0.5 + 5, -21 - lift * 0.6];
      }
      P[R.PELVIS][1] -= Math.abs(Math.cos(ph)) * 2;
      P[R.NECK][0] += 4; P[R.HEAD][0] += 6;
    } else if (!this.onGround) {
      if (this.tentacle.attachedFixed()) {
        P[R.KNEE_F] = [3, -19]; P[R.FOOT_F] = [1, -4]; P[R.KNEE_B] = [-2, -20]; P[R.FOOT_B] = [-5, -6];
      } else {
        P[R.KNEE_F] = [9, -27]; P[R.FOOT_F] = [2, -13]; P[R.KNEE_B] = [4, -24]; P[R.FOOT_B] = [-6, -11];
      }
    } else {
      P[R.NECK][1] += Math.sin(t * 2.2) * 0.8;
      P[R.HEAD][1] += Math.sin(t * 2.2 - 0.4) * 1.1;
    }
    const pts = this.pts;
    for (let i = 0; i < pts.length; i++) { pts[i].x = this.x + P[i][0] * f; pts[i].y = this.y + P[i][1]; }
    // Front arm aims the gun.
    const N = pts[R.NECK];
    const a = this.aim, rc = this.recoil * 6;
    pts[R.ELBOW_F].x = N.x + a.x * 14 - a.y * 3 * f; pts[R.ELBOW_F].y = N.y + a.y * 14 + 4;
    pts[R.HAND_F].x = N.x + a.x * (29 - rc); pts[R.HAND_F].y = N.y + a.y * (29 - rc);
    // Back arm reaches toward whatever the tentacle is doing.
    const tn = this.tentacle;
    if (tn.state !== 'idle') {
      const d = dist(N.x, N.y, tn.tip.x, tn.tip.y) || 1;
      const ux = (tn.tip.x - N.x) / d, uy = (tn.tip.y - N.y) / d;
      pts[R.ELBOW_B].x = N.x + ux * 14; pts[R.ELBOW_B].y = N.y + uy * 14 + 3;
      pts[R.HAND_B].x = N.x + ux * 27; pts[R.HAND_B].y = N.y + uy * 27;
    } else if (running) {
      const sw = Math.sin(this.runPhase) * 8;
      pts[R.ELBOW_B].x = N.x - f * 2 + sw * 0.5; pts[R.ELBOW_B].y = N.y + 15;
      pts[R.HAND_B].x = N.x + sw; pts[R.HAND_B].y = N.y + 28;
    }
    return Math.atan2(a.y, Math.abs(a.x)) * 0.35 * f;
  }

  render(ctx) {
    const headAngle = this.computePose();
    const pts = this.pts, f = this.facing;
    // Writhing tendrils on the back.
    const N = pts[R.NECK], Pl = pts[R.PELVIS];
    for (let i = 0; i < 4; i++) {
      const k = 0.15 + i * 0.22;
      let x = lerp(N.x, Pl.x, k) - f * 8, y = lerp(N.y, Pl.y, k);
      let ang = Math.atan2(-0.6 + i * 0.35, -f) + Math.sin(this.t * 3 + i * 1.7) * 0.4;
      const segs = 6, len = 24 - i * 2;
      for (let sgi = 0; sgi < segs; sgi++) {
        ang += Math.sin(this.t * 4 + i + sgi * 0.8) * 0.22;
        const nx = x + Math.cos(ang) * len / segs * 1.4, ny = y + Math.sin(ang) * len / segs * 1.4;
        ctx.strokeStyle = sgi % 2 ? '#4a0815' : '#2a030b';
        ctx.lineWidth = lerp(6, 1.5, sgi / segs); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
    }
    ctx.lineCap = 'butt';
    drawFigure(ctx, this.bones, pts[R.HEAD], headAngle, f, PALETTES.subject, 'subject', null, [], 0, 0);
    this.renderGun(ctx);
  }

  renderGun(ctx) {
    const h = this.pts[R.HAND_F];
    const ang = Math.atan2(this.aim.y, this.aim.x);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ang);
    if (this.aim.x < 0) ctx.scale(1, -1);
    if (this.weapon === 0) {
      ctx.fillStyle = '#2f343c'; ctx.fillRect(-8, -5, 30, 10);
      ctx.fillStyle = '#6b7482'; ctx.fillRect(-8, -5, 30, 3);
      ctx.fillStyle = '#1d2026'; ctx.fillRect(20, -3.5, 10, 7);
      ctx.fillStyle = '#23262c'; ctx.fillRect(-4, 4, 6, 8);
      if (this.cool <= 0) {
        ctx.fillStyle = '#d7dce4';
        ctx.beginPath(); ctx.moveTo(38, 0); ctx.lineTo(29, -4.5); ctx.lineTo(29, 4.5); ctx.closePath(); ctx.fill();
      }
    } else {
      const heatCol = this.overheat ? '#ff3b2f' : `hsl(${lerp(190, 10, this.heat)},100%,60%)`;
      ctx.fillStyle = '#e8edf4'; ctx.strokeStyle = '#4a5566'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(-8, -6, 32, 12, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3d6fd6'; ctx.fillRect(-4, -1, 22, 2);
      ctx.fillStyle = '#23262c'; ctx.fillRect(-3, 5, 6, 8);
      ctx.shadowColor = heatCol; ctx.shadowBlur = 8; ctx.fillStyle = heatCol;
      for (let i = 0; i < 3; i++) ctx.fillRect(4 + i * 6, -8, 3, 16);
      ctx.beginPath(); ctx.arc(27, 0, this.firingLaser ? 4.5 : 3, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}
