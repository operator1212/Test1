// Test dummies and scientists: an "active ragdoll" that is pulled toward an
// animated pose while conscious, and goes fully limp when hurt, grabbed or dead.
'use strict';

const GUARD_LINES = ['Hi!', 'Hello there.', 'Test dummy online.', ':)', 'Nice day in the lab.'];
const SCI_SPOT_LINES = ['SUBJECT 09 IS LOOSE!', 'Oh no. Oh no no no.', 'Security?! SECURITY!', 'It got out!'];
const SCI_COWER_LINES = ['Please! I have a family!', 'I was just following protocol!', 'Stay back!'];
const PAIN_LINES = ['AAAGH!', 'MY LEG!', 'Get it out!', 'HELP ME!', 'Nnngh!'];

class NPC {
  constructor(game, type, x, groundY) {
    this.game = game;
    this.type = type;                  // 'guard' | 'scientist'
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.rag = new Ragdoll(x, groundY, this.facing, type);
    this.rag.onSever = (bone, a, c, cause) => this.onSever(bone, a, c, cause);
    this.maxHp = type === 'scientist' ? 80 : 100;
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
    this.wounds = [];
    this.bubble = null;
    this.grabbed = false;
    this.struggleT = 0;
    this.killedBy = null;
    this.main = this.rag.component(this.rag.pelvis);
    this.sawPlayerT = 0;
    this.lastHitBy = null;
  }

  say(text, time = 2.2) { this.bubble = { text, t: time }; }

  legsIntact() {
    const r = this.rag;
    return ['thighB', 'shinB', 'thighF', 'shinF'].every((n) => {
      const b = r.bone(n); return b && !b.cut && this.main.has(b.b);
    });
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

  addWound(p, ref, rate, time, bleed) {
    this.wounds.push({ p, ref, rate, time, bleed, acc: 0 });
  }

  onImpaled(p, dx, dy) {
    this.knock(3);
    this.damage(28, 'harpoon');
    this.addWound(p, null, 14, 25, this.type === 'scientist' ? 2 : 2.5);
    for (const b of this.rag.bones) if (b.a === p || b.b === p) b.blood = Math.min(1, b.blood + 0.5);
    if (this.alive && Math.random() < 0.8) this.say(pick(PAIN_LINES), 1.6);
    Sfx.scream();
  }

  onSever(bone, a, childEnd, cause) {
    const g = this.game;
    g.blood.burst(a.x, a.y, 45, 420);
    this.addWound(a, this.rag.neighbor(a), 70, 3.5, 18);
    this.addWound(childEnd, bone.b, 45, 2.5, 0);
    bone.blood = Math.min(1, bone.blood + 0.6);
    Sfx.rip();
    g.shake(6);
    g.fx.text(a.x, a.y - 30, bone.kind === 'neck' ? 'DECAPITATED' : bone.kind === 'torso' ? 'BISECTED' : 'DISMEMBERED', '#ff4050');
    this.main = this.rag.component(this.rag.pelvis);
    if (bone.kind === 'neck' || bone.kind === 'torso') this.die(cause);
    else { this.damage(30, cause); this.knock(4); if (this.alive) this.say('AAAAAAAAH!', 1.5); }
  }

  seesPlayer(range) {
    const pl = this.game.player;
    const h = this.rag.head;
    const px = pl.x, py = pl.y - 55;
    const d = dist(h.x, h.y, px, py);
    if (d > range) return false;
    const r = this.game.map.raycast(h.x, h.y, (px - h.x) / d, (py - h.y) / d, d);
    return !r.hit;
  }

  // -------------------------------------------------------------- update
  update(dt) {
    this.t += dt;
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
    this.bleed(dt);
    const r = this.rag;
    if (!this.alive) return;
    if (r.decapitated || r.isBroken('torso')) { this.die(this.lastHitBy || 'trauma'); return; }

    this.stun -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 2);
    if (r.pinned()) { this.drive = 0; this.struggle(dt); return; }
    const held = r.parts.some((p) => p.held);
    if (this.stun > 0 || this.grabbed || held || !this.legsIntact()) {
      this.drive = 0;
      if (this.grabbed || held) this.struggle(dt * 0.5);
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
    else this.thinkGuard(dt);

    this.moveRoot(dt);
    this.poseDrive(this.pose());

    // Knocked over by a big shove.
    const tx = this.rootX, ty = this.groundY + RAG_REST[R.PELVIS][1];
    if (this.drive > 0.5 && dist(pel.x, pel.y, tx, ty) > 42) this.knock(1.5);
    r.facing = this.facing;
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
    if (m.solidPx(ax, this.groundY - 20) || m.solidPx(ax, this.groundY - 60) || m.solidPx(ax, this.groundY - 90)) return false;
    const g = m.groundBelow(ax, this.groundY - 24, 60);
    return g !== null && Math.abs(g - this.groundY) <= 4;
  }

  moveRoot(dt) {
    if (this.speed > 0 && this.pathClear(this.facing)) {
      this.rootX += this.facing * this.speed * dt * this.drive;
      this.walkPhase += dt * this.speed * 0.075;
    } else {
      this.walkPhase *= 0.9;
    }
    const g = this.game.map.groundBelow(this.rootX, this.groundY - 24, 60);
    if (g !== null) this.groundY = g;
  }

  pose() {
    const P = RAG_REST.map((o) => [o[0], o[1]]);
    const t = this.t;
    const moving = this.speed > 0;
    P[R.HEAD][0] += Math.sin(t * 1.3) * 1.2;
    P[R.HEAD][1] += Math.sin(t * 2.1) * 0.8;
    if (moving) {
      const ph = this.walkPhase;
      const legs = [[R.KNEE_F, R.FOOT_F, ph], [R.KNEE_B, R.FOOT_B, ph + Math.PI]];
      const stride = this.speed > 100 ? 13 : 9;
      for (const [k, f, p] of legs) {
        const fx = Math.sin(p) * stride, lift = Math.max(0, Math.cos(p)) * (this.speed > 100 ? 10 : 6);
        P[f][0] = fx; P[f][1] = -5 - lift;
        P[k][0] = fx * 0.5 + 4; P[k][1] = -20 - lift * 0.5;
      }
      P[R.PELVIS][1] += -Math.abs(Math.cos(ph)) * 1.5;
      P[R.NECK][0] += this.speed > 100 ? 5 : 1;
      P[R.HEAD][0] += this.speed > 100 ? 8 : 2;
      const sw = Math.sin(ph) * 7;
      P[R.ELBOW_F] = [3 - sw * 0.6, -47]; P[R.HAND_F] = [5 - sw, -33];
      P[R.ELBOW_B] = [-3 + sw * 0.6, -47]; P[R.HAND_B] = [-2 + sw, -33];
    }
    if (this.type === 'guard' && this.mode === 'idle') {
      // The classic raised-hand wave.
      const w = Math.sin(t * 7) * 5;
      P[R.ELBOW_F][0] = 23; P[R.ELBOW_F][1] = -68;
      P[R.HAND_F][0] = 27 + w; P[R.HAND_F][1] = -89;
    }
    if (this.type === 'scientist' && this.mode === 'flee') {
      const j = Math.sin(t * 25) * 2;
      P[R.ELBOW_F] = [9, -76]; P[R.HAND_F] = [8 + j, -94];
      P[R.ELBOW_B] = [-5, -76]; P[R.HAND_B] = [-2 - j, -95];
    }
    if (this.type === 'scientist' && this.mode === 'cower') {
      const j = Math.sin(t * 30) * 1.2;
      P[R.PELVIS] = [-4, -26]; P[R.NECK] = [4 + j, -48]; P[R.HEAD] = [10 + j, -72];
      P[R.KNEE_F] = [10, -16]; P[R.FOOT_F] = [2, -5];
      P[R.KNEE_B] = [6, -14]; P[R.FOOT_B] = [-8, -5];
      P[R.ELBOW_F] = [14, -62]; P[R.HAND_F] = [14, -78];
      P[R.ELBOW_B] = [10, -64]; P[R.HAND_B] = [6, -82];
    }
    if (this.flinch > 0) {
      for (const p of P) { p[0] += rand(-3, 3) * this.flinch; p[1] += rand(-3, 3) * this.flinch; }
    }
    return P;
  }

  poseDrive(P) {
    const k = 0.2 * this.drive * (1 - this.flinch * 0.6);
    for (const p of this.rag.parts) {
      if (p.role < 0 || p.pin || p.held || !this.main.has(p)) continue;
      const o = P[p.role];
      const tx = this.rootX + o[0] * this.facing, ty = this.groundY + o[1];
      const dx = (tx - p.x) * k, dy = (ty - p.y) * k;
      p.x += dx; p.y += dy;
      p.px += dx * 0.85; p.py += dy * 0.85;
    }
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

  bleed(dt) {
    const blood = this.game.blood;
    let loss = 0;
    for (const w of this.wounds) {
      w.time -= dt;
      const fade = clamp(w.time / 2, 0, 1);
      w.acc += w.rate * dt * fade;
      loss += w.bleed * fade;
      while (w.acc >= 1) {
        w.acc -= 1;
        const p = w.p;
        let dx = rand(-0.3, 0.3), dy = 1;
        let sp = rand(20, 80);
        if (w.ref) {
          const d = dist(w.ref.x, w.ref.y, p.x, p.y) || 1;
          dx = (p.x - w.ref.x) / d; dy = (p.y - w.ref.y) / d;
          sp = rand(120, 360) * (0.6 + 0.4 * Math.sin(this.t * 14) ** 2);   // pulsing arterial spray
        }
        blood.spray(p.x, p.y, dx, dy, 1, sp, 0.35);
      }
    }
    this.wounds = this.wounds.filter((w) => w.time > 0);
    if (this.alive && loss > 0) this.damage(loss * dt, this.lastHitBy || 'bleeding');
  }

  render(ctx) {
    this.rag.render(ctx);
  }

  renderBubble(ctx) {
    if (!this.bubble || !this.alive) return;
    const h = this.rag.head;
    ctx.font = 'bold 13px "Trebuchet MS", Verdana, sans-serif';
    const w = ctx.measureText(this.bubble.text).width + 14;
    const x = h.x - w / 2, y = h.y - 48;
    ctx.globalAlpha = clamp(this.bubble.t * 3, 0, 1);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b3a55'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 22, 8);
    ctx.moveTo(h.x - 5, y + 22); ctx.lineTo(h.x, y + 30); ctx.lineTo(h.x + 5, y + 22);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1b2233';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.bubble.text, x + 7, y + 11.5);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }
}
