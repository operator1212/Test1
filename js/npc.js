// Guards and scientists: an "active ragdoll" pulled toward an animated pose
// while conscious, fully limp when hurt, grabbed or dead.
'use strict';

const GUARD_LINES = ['HALT!', 'Hey. You.', 'Stay in your cell.', 'Uh... Subject 09?', 'Nice day in the lab.'];
const SCI_SPOT_LINES = ['SUBJECT 09 IS LOOSE!', 'Oh no. Oh no no no.', 'SECURITY!!', 'It got out!'];
const SCI_COWER_LINES = ['Please! I have a family!', 'I was following protocol!', 'Stay back!'];
const PAIN_LINES = ['AAAGH!', 'MY LEG!', 'Get it out!', 'HELP ME!', 'Nnngh!'];
const SOLDIER_LINES = ['CONTAINMENT BREACH!', 'Target sighted!', 'Put it down!', 'Open fire!'];
const DOWNED_LINES = ['help... me...', 'I cant feel my legs', 'mom...', 'so cold...'];
const MAX_HP = { guard: 100, scientist: 80, soldier: 120 };

class NPC {
  constructor(game, type, x, groundY) {
    this.game = game;
    this.type = type;                  // 'guard' | 'scientist' | 'soldier'
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.rag = new Ragdoll(x, groundY, this.facing, type);
    this.rag.game = game;
    this.rag.npc = this;
    this.rag.onChange = (kind, cx, cy) => this.onTopology(kind, cx, cy);
    this.rag.onImpact = (p, speed, n) => this.onImpact(p, speed, n);
    this.maxHp = MAX_HP[type] || 100;
    this.hp = this.maxHp;
    this.alive = true;
    this.stun = 0;
    this.drive = 1;                    // 0 = limp, 1 = fully animated
    this.rootX = x;
    this.groundY = groundY;
    this.t = rand(0, 10);
    this.mode = type === 'scientist' ? 'patrol' : 'idle';
    this.modeT = rand(2, 5);
    this.walkPhase = 0;
    this.speed = 0;
    this.flinch = 0;
    this.bleedRate = 0;
    this.bubble = null;
    this.grabbed = false;
    this.struggleT = 0;
    this.killedBy = null;
    this.lastHitBy = null;
    this.sawPlayerT = 0;
    this.textT = 0;
    this.main = this.rag.component(this.rag.pelvis);
    this.downed = false;               // alive but can't get up (spine, heart, blood loss)
    this.zoneShown = new Set();
    this.gunCool = rand(0.5, 1.5);
    this.aimAng = 0;
    this.impactT = 0;
  }

  say(text, time = 2.2) { this.bubble = { text, t: time }; }

  legsIntact() {
    const m = this.main, J = this.rag.joint;
    return m.has(J[R.KNEE_B]) && m.has(J[R.FOOT_B]) && m.has(J[R.KNEE_F]) && m.has(J[R.FOOT_F]);
  }

  damage(amount, cause) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastHitBy = cause;
    if (this.hp <= 0) this.die(cause);
  }

  die(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.drive = 0;
    this.killedBy = cause;
    this.bubble = null;
    this.game.onNpcDeath(this, cause);
  }

  knock(stun) {
    this.stun = Math.max(this.stun, stun);
    this.drive = 0;
  }

  addBleed(pixels) { this.bleedRate += pixels * 0.35; }

  // Fatal areas: brain = instant, heart = fast bleed-out, spine = paralysed,
  // arteries (neck, thigh) = heavy bleeding.
  applyZones(mask, cause, x, y) {
    if (!mask || !this.alive) return;
    const g = this.game;
    this.lastHitBy = cause;
    const label = (t, c) => { if (!this.zoneShown.has(t)) { this.zoneShown.add(t); g.fx.text(x, y - 16, t, c); } };
    if (mask & (1 << Z_BRAIN)) {
      label('HEADSHOT', '#ff4050');
      this.die(cause);
      return;
    }
    if (mask & (1 << Z_HEART)) {
      label('HEART HIT', '#ff4050');
      this.bleedRate += 30;
      this.goDown();
    }
    if (mask & (1 << Z_SPINE)) {
      label('SPINE SEVERED', '#ffcf6a');
      this.paralysed = true;
      this.goDown();
    }
    if (mask & (1 << Z_ARTERY)) {
      label('ARTERY', '#ff7a7a');
      this.bleedRate += 9;
    }
  }

  goDown() {
    if (!this.alive) return;
    this.downed = true;
    this.knock(2);
    if (!this.bubble) this.say(pick(DOWNED_LINES), 2);
  }

  // Slammed into something hard (thrown, rammed, fell).
  onImpact(p, speed, n) {
    if (this.impactT > 0 || !this.game) return;
    this.impactT = 0.12;
    const g = this.game;
    const k = speed - 600;
    if (speed > 800) {
      g.blood.spray(p.x, p.y, n ? n.x : 0, n ? n.y : -1, Math.min(24, k / 25), 250, 1.1);
      for (const q of this.rag.pieces) if (q.a === p || q.b === p) this.addBleed(q.exposeNear(p.x - (n ? n.x : 0) * p.r, p.y - (n ? n.y : 0) * p.r, speed > 1300 ? 1.8 : 1));
      Sfx.thunk();
    }
    if (speed > 1350) {
      // Hard enough to burst tissue.
      const q = this.rag.pieces.find((q) => q.a === p || q.b === p);
      if (q) {
        const [gi, gj] = q.toGrid(p.x, p.y, q.frame());
        this.rag.zoneHits = 0;
        this.rag.burn(q, gi, gj, 1.6, 0.6, 0.1);
        this.applyZones(this.rag.zoneHits, 'slam', p.x, p.y);
      }
    }
    if (p.role === R.HEAD && speed > 1150 && this.alive) {
      g.fx.text(p.x, p.y - 16, 'SKULL CRACKED', '#ff4050');
      this.die('slam');
    }
    if (!this.alive) return;
    this.knock(Math.min(3, 0.8 + k / 500));
    this.damage(k * 0.05, 'slam');
  }

  onImpaled(p, dx, dy, piece, idx) {
    this.knock(3);
    this.damage(22, 'harpoon');
    if (piece && idx >= 0) {
      const F = piece.frame();
      const [x, y] = piece.cellWorld(idx, F);
      // The spike tears through a small area: any vital zone there counts.
      const [hgi, hgj] = piece.toGrid(x, y, F);
      let mask = 0;
      for (let j = Math.floor(hgj - 1.5); j <= hgj + 1.5; j++)
        for (let i = Math.floor(hgi - 1.5); i <= hgi + 1.5; i++)
          if (i >= 0 && j >= 0 && i < piece.w && j < piece.h && piece.col[j * piece.w + i] && piece.zone[j * piece.w + i]) mask |= 1 << piece.zone[j * piece.w + i];
      this.addBleed(piece.exposeNear(x, y, 1.3));
      this.applyZones(mask, 'harpoon', x, y);
      // Splash the surrounding pixels with blood.
      const [gi, gj] = piece.toGrid(x, y, F);
      for (let k = 0; k < 10; k++) {
        const i = Math.floor(gi + rand(-2.5, 2.5)), j = Math.floor(gj + rand(-2.5, 2.5));
        if (i >= 0 && j >= 0 && i < piece.w && j < piece.h) piece.stain(j * piece.w + i, pick(BLOOD_PX), 0.7);
      }
    }
    if (this.alive && !this.downed && Math.random() < 0.8) this.say(pick(PAIN_LINES), 1.6);
    Sfx.scream();
  }

  // Called by the ragdoll whenever pieces split or tear apart.
  onTopology(kind, x, y) {
    const r = this.rag;
    const before = this.main.size;
    this.main = r.component(r.pelvis);
    const lost = this.main.size < before;
    const g = this.game;
    if (lost && this.textT <= 0) {
      this.textT = 0.5;
      const headGone = !this.main.has(r.head);
      g.fx.text(x, y - 20, headGone ? (this.main.has(r.joint[R.NECK]) ? 'DECAPITATED' : 'BISECTED') : 'SEVERED', '#ff4050');
      g.shake(2);
      Sfx.rip();
    }
    if (!this.main.has(r.head)) { this.die(this.lastHitBy || kind); return; }
    if (!this.main.has(r.pelvis) || !this.main.has(r.joint[R.NECK])) { this.die(this.lastHitBy || kind); return; }
    if (lost && this.alive) {
      this.damage(25, this.lastHitBy || kind);
      this.knock(4);
      if (this.alive) this.say('AAAAAAAAH!', 1.5);
    }
  }

  headIntact() {
    let n = 0, o = 0;
    for (const q of this.rag.pieces) if (q.name === 'head' && this.main.has(q.a)) { n += q.count; o = q.origCount; }
    return o === 0 || n > o * 0.8;
  }

  seesPlayer(range) {
    const pl = this.game.player;
    const h = this.rag.head;
    const px = pl.x, py = pl.y - 60;
    const d = dist(h.x, h.y, px, py);
    if (d > range) return false;
    return !this.game.map.raycast(h.x, h.y, (px - h.x) / d, (py - h.y) / d, d).hit;
  }

  // -------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    this.textT -= dt;
    this.impactT -= dt;
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
    const r = this.rag;
    if (!this.alive) return;
    // Downed from wounds = bleeding out; a pure spine injury just paralyses.
    if (this.downed && this.hp < this.maxHp * 0.25) this.bleedRate = Math.max(this.bleedRate, 1.8);
    if (this.bleedRate > 0) {
      this.damage(this.bleedRate * dt, this.lastHitBy || 'bleeding');
      this.bleedRate *= Math.exp(-dt * (this.downed ? 0.03 : 0.15));
    }
    if (!this.alive) return;
    if (!this.main.has(r.head) || !this.headIntact()) { this.die(this.lastHitBy || 'trauma'); return; }

    this.stun -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 2);
    if (this.hp < this.maxHp * 0.25 && !this.downed) this.goDown();
    const pinned = r.parts.some((p) => p.pin && this.main.has(p));
    if (pinned) { this.drive = 0; this.struggle(this.downed ? dt * 0.3 : dt); return; }
    const held = r.parts.some((p) => p.held && this.main.has(p));
    if (this.stun > 0 || this.grabbed || held || this.downed || !this.legsIntact()) {
      this.drive = 0;
      if (this.grabbed || held) this.struggle(dt * 0.5);
      else if (this.downed) this.writhe(dt);
      return;
    }

    const pel = r.pelvis;
    if (this.drive <= 0) {
      // Try to get back up where we lie.
      const g = this.game.map.groundBelow(pel.x, pel.y - 4, 150);
      if (g === null) { this.stun = 0.25; return; }
      this.rootX = pel.x;
      this.groundY = g;
      this.facing = this.game.player.x < pel.x ? -1 : 1;
      this.drive = 0.001;
      if (this.mode === 'idle' && Math.random() < 0.5) this.say(pick(['Ow.', 'Ouch...', 'Why?']), 1.5);
    }
    this.drive = Math.min(1, this.drive + dt * 0.9);

    if (this.type === 'scientist') this.thinkScientist(dt);
    else if (this.type === 'soldier') this.thinkSoldier(dt);
    else this.thinkGuard(dt);

    this.moveRoot(dt);
    this.poseDrive(this.pose());

    // Knocked over by a big shove.
    const tx = this.rootX, ty = this.groundY + RAG_REST[R.PELVIS][1];
    if (this.drive > 0.5 && dist(pel.x, pel.y, tx, ty) > 42) this.knock(1.5);
    r.flip = this.facing;
  }

  thinkGuard(dt) {
    const pl = this.game.player;
    if (Math.abs(pl.x - this.rootX) < 900) this.facing = pl.x < this.rootX ? -1 : 1;
    this.speed = 0;
    this.modeT -= dt;
    if (this.modeT <= 0) {
      this.modeT = rand(5, 10);
      if (this.seesPlayer(420) && Math.random() < 0.6) this.say(pick(GUARD_LINES));
    }
  }

  armed() {
    const J = this.rag.joint;
    return this.main.has(J[R.HAND_F]) && this.main.has(J[R.ELBOW_F]);
  }

  thinkSoldier(dt) {
    const pl = this.game.player;
    const sees = !pl.dead && this.seesPlayer(560);
    this.speed = 0;
    this.gunCool -= dt;
    if (sees) {
      if (this.mode !== 'attack') { this.mode = 'attack'; this.say(pick(SOLDIER_LINES), 1.6); this.gunCool = Math.max(this.gunCool, 0.5); }
      this.sawPlayerT = 3;
      this.facing = pl.x < this.rootX ? -1 : 1;
      const N = this.rag.joint[R.NECK];
      this.aimAng = Math.atan2(pl.y - 60 - N.y, (pl.x - N.x) * this.facing);
      const d = Math.abs(pl.x - this.rootX);
      if (d < 140 && this.pathClear(-this.facing)) { this.speed = 60; this.backing = true; }
      else this.backing = false;
      if (this.gunCool <= 0 && this.armed()) {
        this.gunCool = rand(0.55, 0.95);
        this.game.npcShoot(this);
      }
    } else {
      this.sawPlayerT -= dt;
      this.backing = false;
      if (this.sawPlayerT <= 0) this.mode = 'idle';
    }
  }

  thinkScientist(dt) {
    const pl = this.game.player;
    const sees = this.seesPlayer(360);
    if (sees) this.sawPlayerT = 4; else this.sawPlayerT -= dt;
    this.modeT -= dt;
    if (this.mode === 'patrol') {
      this.speed = 42;
      if (this.modeT <= 0) { this.mode = 'pause'; this.modeT = rand(1.5, 3); }
      if (!this.pathClear(this.facing)) this.facing *= -1;
      if (sees) { this.mode = 'flee'; this.say(pick(SCI_SPOT_LINES)); Sfx.scream(); }
    } else if (this.mode === 'pause') {
      this.speed = 0;
      if (this.modeT <= 0) { this.mode = 'patrol'; this.modeT = rand(3, 6); if (Math.random() < 0.5) this.facing *= -1; }
      if (sees) { this.mode = 'flee'; this.say(pick(SCI_SPOT_LINES)); Sfx.scream(); }
    } else if (this.mode === 'flee' || this.mode === 'cower') {
      const away = pl.x < this.rootX ? 1 : -1;
      if (this.pathClear(away)) { this.mode = 'flee'; this.facing = away; this.speed = 150; }
      else {
        if (this.mode !== 'cower') this.say(pick(SCI_COWER_LINES));
        this.mode = 'cower'; this.speed = 0; this.facing = -away;
      }
      if (this.sawPlayerT <= 0) { this.mode = 'patrol'; this.modeT = rand(3, 6); this.say('...is it gone?'); }
    }
  }

  pathClear(dir) {
    const m = this.game.map;
    const ax = this.rootX + dir * 22;
    if (m.solidPx(ax, this.groundY - 20) || m.solidPx(ax, this.groundY - 60) || m.solidPx(ax, this.groundY - 100)) return false;
    const g = m.groundBelow(ax, this.groundY - 24, 60);
    return g !== null && Math.abs(g - this.groundY) <= 4;
  }

  moveRoot(dt) {
    const dir = this.backing ? -this.facing : this.facing;
    if (this.speed > 0 && this.pathClear(dir)) {
      this.rootX += dir * this.speed * dt * this.drive;
      this.walkPhase += dt * this.speed * 0.075;
    } else {
      this.walkPhase *= 0.9;
    }
    const g = this.game.map.groundBelow(this.rootX, this.groundY - 24, 60);
    if (g !== null) this.groundY = g;
  }

  // Target pose in art pixels, facing right.
  pose() {
    const P = REST_ART.map((o) => [o[0], o[1]]);
    const t = this.t;
    P[R.HEAD][0] += Math.sin(t * 1.3) * 0.4;
    P[R.HEAD][1] += Math.sin(t * 2.1) * 0.3;
    if (this.speed > 0) {
      const ph = this.walkPhase, run = this.speed > 100;
      const stride = run ? 5 : 3.5, liftH = run ? 3.5 : 2;
      for (const [k, f, p] of [[R.KNEE_F, R.FOOT_F, ph], [R.KNEE_B, R.FOOT_B, ph + Math.PI]]) {
        const fx = Math.sin(p) * stride, lift = Math.max(0, Math.cos(p)) * liftH;
        P[f] = [fx, -2 - lift];
        P[k] = [fx * 0.5 + 1.5, -10.5 - lift * 0.5];
      }
      P[R.PELVIS][1] -= Math.abs(Math.cos(ph)) * 0.6;
      P[R.NECK][0] += run ? 2 : 0.5;
      P[R.HEAD][0] += run ? 3 : 0.8;
      const sw = Math.sin(ph) * 2.5;
      P[R.ELBOW_F] = [1.5 - sw * 0.6, -24.5]; P[R.HAND_F] = [2.5 - sw, -18.5];
      P[R.ELBOW_B] = [-1.5 + sw * 0.6, -24.5]; P[R.HAND_B] = [-1 + sw, -18.5];
    }
    if (this.type === 'guard' && this.mode === 'idle') {
      // Hand raised in a wave.
      const w = Math.sin(t * 7) * 1.3;
      P[R.ELBOW_F] = [5.5, -27]; P[R.HAND_F] = [7 + w, -33.5];
    }
    if (this.type === 'soldier' && this.mode === 'attack') {
      // Both hands on the pistol, pointed at the player.
      const ca = Math.cos(this.aimAng), sa = Math.sin(this.aimAng);
      const N = P[R.NECK];
      P[R.ELBOW_F] = [N[0] + ca * 5.5, N[1] + sa * 5.5 + 1];
      P[R.HAND_F] = [N[0] + ca * 11, N[1] + sa * 11];
      P[R.ELBOW_B] = [N[0] + ca * 4.5, N[1] + sa * 4.5 + 2];
      P[R.HAND_B] = [N[0] + ca * 9.5, N[1] + sa * 9.5 + 0.5];
    }
    if (this.type === 'scientist' && this.mode === 'flee') {
      const j = Math.sin(t * 25) * 0.8;
      P[R.ELBOW_F] = [3, -36]; P[R.HAND_F] = [3.5 + j, -42];
      P[R.ELBOW_B] = [-2, -36]; P[R.HAND_B] = [-1.5 - j, -42];
    }
    if (this.type === 'scientist' && this.mode === 'cower') {
      const j = Math.sin(t * 30) * 0.5;
      P[R.PELVIS] = [-1, -9.5]; P[R.NECK] = [2 + j, -21]; P[R.HEAD] = [4.5 + j, -26.5];
      P[R.KNEE_F] = [4, -6]; P[R.FOOT_F] = [1, -2];
      P[R.KNEE_B] = [3, -5.5]; P[R.FOOT_B] = [-3, -2];
      P[R.ELBOW_F] = [5.5, -24]; P[R.HAND_F] = [5, -30];
      P[R.ELBOW_B] = [4, -25]; P[R.HAND_B] = [2, -31];
    }
    if (this.flinch > 0) for (const p of P) { p[0] += rand(-0.3, 0.3) * this.flinch; p[1] += rand(-0.3, 0.3) * this.flinch; }
    return P;
  }

  poseDrive(P) {
    const k = 0.2 * this.drive * (1 - this.flinch * 0.6);
    for (const p of this.rag.parts) {
      if (p.role < 0 || p.pin || p.held || !this.main.has(p)) continue;
      const o = P[p.role];
      const tx = this.rootX + o[0] * PX * this.facing, ty = this.groundY + o[1] * PX;
      const dx = (tx - p.x) * k, dy = (ty - p.y) * k;
      p.x += dx; p.y += dy;
      p.px += dx * 0.85; p.py += dy * 0.85;
    }
  }

  // Downed: weak twitching and moaning while bleeding out.
  writhe(dt) {
    this.struggleT -= dt;
    if (this.struggleT > 0) return;
    this.struggleT = rand(0.3, 0.9);
    const free = this.rag.parts.filter((p) => !p.pin && !p.held && this.main.has(p) && p.role >= 0 && (!this.paralysed || p.role < R.KNEE_B));
    if (free.length) { const p = pick(free); p.impulse(rand(-1, 1) * 120, rand(-1, 0.2) * 120); }
    if (Math.random() < 0.08 && !this.bubble) this.say(pick(DOWNED_LINES), 2);
  }

  // Flailing while nailed to something.
  struggle(dt) {
    this.struggleT -= dt;
    if (this.struggleT > 0) return;
    this.struggleT = rand(0.07, 0.22);
    const free = this.rag.parts.filter((p) => !p.pin && !p.held && this.main.has(p) && p.role >= 0);
    if (!free.length) return;
    const p = pick(free);
    const s = p.role === R.HEAD || p.role === R.NECK ? 160 : 380;
    p.impulse(rand(-1, 1) * s, rand(-1, 0.4) * s);
    if (Math.random() < 0.03 && !this.bubble) this.say(pick(PAIN_LINES), 1.4);
  }

  render(fb) {
    this.rag.render(fb);
    if (this.type === 'soldier' && this.main.has(this.rag.joint[R.HAND_F])) {
      // Pistol in the front hand, pointing along the forearm.
      const H = this.rag.joint[R.HAND_F], E = this.rag.joint[R.ELBOW_F];
      const d = dist(E.x, E.y, H.x, H.y) || 1;
      const ux = (H.x - E.x) / d, uy = (H.y - E.y) / d;
      const x = H.x / PX, y = H.y / PX;
      fb.line(x, y, x + ux * 4, y + uy * 4, PISTOL_C);
      fb.put(x - uy * this.facing, y + ux * this.facing, PISTOL_C);
    }
  }

  renderBubble(ctx, view) {
    if (!this.bubble || !this.alive) return;
    const h = this.rag.head;
    const text = this.bubble.text.toUpperCase();
    const w = textWidth(text) + 6;
    const hx = Math.round(h.x / PX) - view.x0, hy = Math.round(h.y / PX) - view.y0;
    const x = Math.round(hx - w / 2), y = hy - 20;
    ctx.fillStyle = '#1f2a44'; ctx.fillRect(x - 1, y - 1, w + 2, 11);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = '#1f2a44'; ctx.fillRect(hx - 1, y + 10, 3, 1); ctx.fillRect(hx, y + 11, 1, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - 1, y + 9, 3, 1); ctx.fillRect(hx, y + 10, 1, 1);
    pixelText(ctx, text, x + 3, y + 2, '#1b2233');
  }
}

const PISTOL_C = hexc('#16181c');
