// Guards and scientists: an "active ragdoll" pulled toward an animated pose
// while conscious, fully limp when hurt, grabbed or dead.
'use strict';

const GUARD_LINES = ['HALT!', 'Hey. You.', 'Stay in your cell.', 'Uh... Subject 09?', 'Nice day in the lab.'];
const SCI_SPOT_LINES = ['SUBJECT 09 IS LOOSE!', 'Oh no. Oh no no no.', 'SECURITY!!', 'It got out!'];
const SCI_COWER_LINES = ['Please! I have a family!', 'I was following protocol!', 'Stay back!'];
const PAIN_LINES = ['AAAGH!', 'MY LEG!', 'Get it out!', 'HELP ME!', 'Nnngh!'];
const SOLDIER_LINES = ['CONTAINMENT BREACH!', 'Target sighted!', 'Put it down!', 'Open fire!'];
const DOWNED_LINES = ['help... me...', 'I cant feel my legs', 'mom...', 'so cold...'];
const LEGLESS_LINES = ['MY LEGS!', 'WHERE ARE MY LEGS', 'no no no no', 'I have to get out...'];
const DAZED_LINES = ['wh... what?', 'who turned off the...', 'mmh... mom?', 'the floor is... moving'];
const CLUTCH_LINES = ['*gurgle*', 'hhk... hhk...', 'can\'t... breathe'];
const NIBBLE_CAUSES = new Set(['tendril', 'swarm', 'acid']);
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
    this.nibbled = 0;          // vital zones already wounded by creature nibbles
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
    // Reaction layer (euphoria-lite): stagger | clutch | dazed, plus crawl when downed.
    this.react = null;
    this.crawling = false;
    this.legsLost = false;
    this.paralysed = false;
    this.brainLost = 0; this.brainRolled = false; this.brainSurvives = false;
    this.dyingT = 0; this.dyingDur = 1; this.dyingStyle = 'buckle'; this.dieVel = 0;
    this.twitchT = 0;
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

  // style: 'buckle' | 'clutch' | 'back' | 'rigid' (headshot) | 'headless'
  die(cause, style) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.killedBy = cause;
    this.bubble = null;
    this.react = null;
    // Stay up for a moment and go down with some drama, if we were standing.
    const standing = this.drive > 0.4 && !this.downed && this.stun <= 0 && this.legsIntact() && !this.grabbed &&
      !this.rag.parts.some((p) => (p.pin || p.held) && this.main.has(p));
    if (standing) {
      this.dyingStyle = style || pick(['buckle', 'buckle', 'clutch', 'back']);
      this.dyingDur = this.dyingStyle === 'rigid' ? 0.45 : this.dyingStyle === 'headless' ? rand(0.7, 1.3) : rand(1.1, 2.1);
      this.dyingT = this.dyingDur;
      this.dieVel = (this.dyingStyle === 'back' ? -1 : 1) * this.facing * rand(10, 30);
    } else {
      this.drive = 0;
      this.twitchT = rand(1, 2.5);
    }
    this.game.onNpcDeath(this, cause);
  }

  updateDead(dt) {
    if (this.dyingT > 0) {
      this.dyingT -= dt;
      const lost = !this.legsIntact() || this.grabbed || this.rag.parts.some((p) => (p.pin || p.held) && this.main.has(p));
      if (lost || this.dyingT <= 0) { this.dyingT = 0; this.drive = 0; this.twitchT = rand(1.5, 3); return; }
      const f = 1 - this.dyingT / this.dyingDur;
      this.drive = Math.pow(1 - f, 0.7) * (this.dyingStyle === 'rigid' ? 1 : 0.85);
      if (this.pathClear(sign(this.dieVel))) this.rootX += this.dieVel * dt;
      this.poseDrive(this.pose(f));
      return;
    }
    // Post-mortem twitches.
    if (this.twitchT > 0) {
      this.twitchT -= dt;
      if (Math.random() < dt * 5 * (this.twitchT / 3)) {
        const cand = this.rag.parts.filter((p) => this.main.has(p) && !p.pin && !p.held && (p.role === R.HAND_F || p.role === R.HAND_B || p.role === R.FOOT_F || p.role === R.FOOT_B));
        if (cand.length) pick(cand).impulse(rand(-90, 90), rand(-120, 20));
      }
    }
  }

  knock(stun) {
    this.stun = Math.max(this.stun, stun);
    this.drive = 0;
  }

  // Ordinary wounds bleed, but cap out; vital zones (heart, arteries) add on top directly.
  addBleed(pixels) { this.woundBleed = Math.min(4, (this.woundBleed || 0) + pixels * 0.2); }

  // Fatal areas: brain = instant, heart = fast bleed-out, spine = paralysed,
  // arteries (neck, thigh) = heavy bleeding.
  applyZones(mask, cause, x, y, brainCount) {
    if (!mask || !this.alive) return;
    const g = this.game;
    this.lastHitBy = cause;
    const label = (t, c) => { if (!this.zoneShown.has(t)) { this.zoneShown.add(t); g.fx.text(x, y - 16, t, c); } };
    // Creature nibbles (a pixel or two at a time) wound vitals rather than
    // instantly killing: it takes a real chunk of brain, and the heart bleeds slower.
    const nibble = NIBBLE_CAUSES.has(cause);
    // ...and each vital bleeds once, not again for every bite.
    const fresh = nibble ? mask & ~this.nibbled : mask;
    if (nibble) this.nibbled |= mask;
    if (mask & (1 << Z_BRAIN)) {
      // A graze (a few brain pixels) is sometimes survivable: dazed and stumbling.
      this.brainLost += brainCount != null ? brainCount : Math.max(1, this.rag.zoneCount[Z_BRAIN]);
      if (nibble && this.brainLost < 8) {
        label('HEAD WOUND', '#ffcf6a');
        this.bleedRate += 1;
        this.damage(4, cause);
        if (this.alive && !this.downed && (!this.react || this.react.kind !== 'dazed')) {
          this.react = { kind: 'dazed', t: rand(4, 7), wander: this.facing, turnT: 1 };
          this.say(pick(DAZED_LINES), 2);
        }
        return;
      }
      const minor = this.brainLost <= 3;
      if (!this.brainRolled) { this.brainRolled = true; this.brainSurvives = minor && Math.random() < 0.35; }
      if (this.brainSurvives && minor) {
        label('HEAD WOUND', '#ffcf6a');
        this.bleedRate += 3;
        this.damage(25, cause);
        if (this.alive && !this.downed && (!this.react || this.react.kind !== 'dazed')) {
          this.react = { kind: 'dazed', t: rand(7, 12), wander: this.facing, turnT: 1 };
          this.knock(1.2);
          this.say(pick(DAZED_LINES), 2);
        }
        return;
      }
      label('HEADSHOT', '#ff4050');
      this.die(cause, 'rigid');
      return;
    }
    if (fresh & (1 << Z_HEART)) {
      label('HEART HIT', '#ff4050');
      this.bleedRate += nibble ? 6 : 30;
      this.goDown();
    }
    if (fresh & (1 << Z_SPINE)) {
      label('SPINE SEVERED', '#ffcf6a');
      this.paralysed = true;
      this.goDown();
    }
    if (fresh & (1 << Z_ARTERY)) {
      label('ARTERY', '#ff7a7a');
      this.bleedRate += nibble ? 3 : 9;
    }
    if ((fresh & (1 << Z_NECK)) && this.alive) {
      label('THROAT', '#ff7a7a');
      this.bleedRate += nibble ? 5 : 14;
      // Sometimes they stay on their feet clutching their throat until they drop.
      if (!this.downed && Math.random() < 0.5 && (!this.react || this.react.kind !== 'clutch')) {
        this.react = { kind: 'clutch', t: rand(3, 6), wander: this.facing, turnT: 0.8 };
        this.say(pick(CLUTCH_LINES), 2);
      }
      for (const q of this.rag.pieces) if (q.name === 'head' && this.main.has(q.a)) q.bleed = 1;
    }
  }

  goDown() {
    if (!this.alive || this.downed) return;
    this.downed = true;
    this.react = null;
    this.crawling = Math.random() < 0.45;
    this.knock(2);
    if (!this.bubble) this.say(pick(DOWNED_LINES), 2);
  }

  // Euphoria-lite hit reaction: stumble with the hit, lean, windmill; big hits floor them.
  hitReact(dx, dy, strength) {
    if (!this.alive || this.downed || this.drive < 0.5 || this.stun > 0) return;
    if (this.react && this.react.kind === 'stagger') { this.react.t += 0.2; this.react.v += sign(dx) * strength * 60; return; }
    this.react = {
      kind: 'stagger', t: Math.min(1.1, 0.4 + strength * 0.35), v: sign(dx) * (60 + strength * 140),
      fall: Math.min(0.65, strength * 0.28), prev: this.react,
    };
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
        this.rag.resetZones();
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
      let mask = 0, brain = 0;
      for (let j = Math.floor(hgj - 1.5); j <= hgj + 1.5; j++)
        for (let i = Math.floor(hgi - 1.5); i <= hgi + 1.5; i++) {
          if (i < 0 || j < 0 || i >= piece.w || j >= piece.h) continue;
          const z = piece.col[j * piece.w + i] ? piece.zone[j * piece.w + i] : 0;
          if (z) mask |= 1 << z;
          if (z === Z_BRAIN) brain++;
        }
      this.addBleed(piece.exposeNear(x, y, 1.3));
      this.applyZones(mask, 'harpoon', x, y, brain);
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
    if (!this.main.has(r.head) || !this.main.has(r.pelvis) || !this.main.has(r.joint[R.NECK])) {
      this.die(this.lastHitBy || kind, 'headless');
      return;
    }
    if (lost && this.alive) {
      const legGone = !this.legsIntact() && !this.legsLost;
      this.damage(legGone ? 10 : 20, this.lastHitBy || kind);
      this.knock(legGone ? 1.2 : 3);
      if (legGone && this.alive) {
        // Lost a leg: crawl away, lie there, or go into shock and bleed out.
        this.legsLost = true;
        this.downed = true;
        this.react = null;
        const roll = Math.random();
        this.crawling = roll < 0.6;
        if (roll > 0.8) { this.bleedRate += 6; this.say('...', 1.5); }
        else this.say(pick(LEGLESS_LINES), 2);
      } else if (this.alive) this.say('AAAAAAAAH!', 1.5);
    }
  }

  headIntact() {
    let n = 0, o = 0;
    for (const q of this.rag.pieces) if (q.name === 'head' && this.main.has(q.a)) { n += q.count; o = q.origCount; }
    return o === 0 || n > o * 0.8;
  }

  seesPlayer(range) {
    const pl = this.game.player;
    if (pl.dead || pl.hidden) return false;
    const h = this.rag.head;
    const px = pl.cx, py = pl.cy;
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
    if (!this.alive) { this.updateDead(dt); return; }
    // Downed from wounds = bleeding out; a pure spine injury just paralyses.
    if (this.downed && this.hp < this.maxHp * 0.25) this.bleedRate = Math.max(this.bleedRate, this.legsLost ? 0.8 : 1.8);
    const bleed = this.bleedRate + (this.woundBleed || 0);
    if (bleed > 0) {
      this.damage(bleed * dt, this.lastHitBy || 'bleeding');
      this.bleedRate *= Math.exp(-dt * (this.downed ? 0.03 : 0.15));
      this.woundBleed = (this.woundBleed || 0) * Math.exp(-dt * 0.1);
    }
    if (!this.alive) return;
    if (!this.main.has(r.head) || !this.headIntact()) { this.die(this.lastHitBy || 'trauma'); return; }

    this.stun -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 2);
    if (this.hp < this.maxHp * 0.25 && !this.downed) this.goDown();
    const pinned = r.parts.some((p) => p.pin && this.main.has(p));
    if (pinned) { this.drive = 0; this.struggle(this.downed ? dt * 0.3 : dt); return; }
    const held = r.parts.some((p) => p.held && this.main.has(p));
    if (this.stun > 0 || this.grabbed || held) {
      this.drive = 0;
      if (this.grabbed || held) this.struggle(dt * 0.5);
      return;
    }
    if (this.downed || !this.legsIntact()) {
      if (this.crawling) this.crawl(dt); else { this.drive = 0; this.writhe(dt); }
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

    if (this.react) this.updateReact(dt);
    else if (this.type === 'scientist') this.thinkScientist(dt);
    else if (this.type === 'soldier') this.thinkSoldier(dt);
    else this.thinkGuard(dt);
    if (!this.alive || this.stun > 0) return;

    this.moveRoot(dt);
    this.poseDrive(this.pose());

    // Knocked over by a big shove.
    const tx = this.rootX, ty = this.groundY + RAG_REST[R.PELVIS][1];
    if (this.drive > 0.5 && dist(pel.x, pel.y, tx, ty) > 42) this.knock(1.5);
    r.flip = this.facing;
  }

  updateReact(dt) {
    const re = this.react;
    re.t -= dt;
    this.speed = 0;
    if (re.kind === 'stagger') {
      // Stumble in the direction of the hit; the root is moved directly.
      if (this.pathClear(sign(re.v))) this.rootX += re.v * dt;
      re.v *= Math.exp(-dt * 4);
      this.drive = Math.min(this.drive, 0.75);
      if (re.t <= 0) {
        this.react = re.prev && re.prev.t > 0 ? re.prev : null;
        if (Math.random() < re.fall) this.knock(rand(1.2, 2));
      }
      return;
    }
    // Clutching throat / dazed: aimless shuffling.
    re.turnT -= dt;
    if (re.turnT <= 0) { re.turnT = rand(0.6, 1.8); re.wander = Math.random() < 0.5 ? -1 : 1; }
    this.facing = re.wander;
    this.speed = re.kind === 'clutch' ? 22 : 30;
    this.drive = Math.min(this.drive, re.kind === 'dazed' ? 0.6 : 0.7);
    if (re.kind === 'dazed' && Math.random() < dt * 0.25) { this.knock(rand(1, 2)); return; }
    if (re.kind === 'dazed' && Math.random() < dt * 0.15 && !this.bubble) this.say(pick(DAZED_LINES), 2);
    if (re.t <= 0) {
      this.react = null;
      if (re.kind === 'clutch') this.goDown();
      else if (this.type === 'scientist') this.mode = 'patrol';
    }
  }

  // Legless or badly hurt: drag the body along the floor with the arms.
  crawl(dt) {
    const pel = this.rag.pelvis;
    if (this.drive <= 0) {
      const g = this.game.map.groundBelow(pel.x, pel.y - 4, 150);
      if (g === null) return;
      this.rootX = pel.x; this.groundY = g;
      this.drive = 0.001;
    }
    const pl = this.game.player;
    this.facing = pl.x < this.rootX ? 1 : -1;       // away from the monster
    this.drive = Math.min(0.55, this.drive + dt * 0.5);
    const ph = this.t * 3;
    const pull = Math.max(0, -Math.sin(ph));
    const ax = this.rootX + this.facing * 26;
    if (!this.game.map.solidPx(ax, this.groundY - 10)) this.rootX += this.facing * 20 * pull * dt;
    const g = this.game.map.groundBelow(this.rootX, this.groundY - 24, 60);
    if (g !== null) this.groundY = g;
    if (Math.random() < dt * 0.12 && !this.bubble) this.say(pick(this.legsLost ? LEGLESS_LINES : DOWNED_LINES), 2);
    this.poseDrive(this.crawlPose(ph), 0.6);
    this.rag.flip = this.facing;
  }

  crawlPose(ph) {
    const P = REST_ART.map((o) => [o[0], o[1]]);
    P[R.PELVIS] = [-6, -3.5]; P[R.NECK] = [6, -5]; P[R.HEAD] = [11, -8];
    const s = Math.sin(ph), c = Math.cos(ph);
    P[R.ELBOW_F] = [9.5 + s, -4.5]; P[R.HAND_F] = [13 + 3 * s, -1.5 - Math.max(0, c) * 2.5];
    P[R.ELBOW_B] = [9.5 - s, -4.5]; P[R.HAND_B] = [13 - 3 * s, -1.5 - Math.max(0, -c) * 2.5];
    P[R.KNEE_F] = [-13, -3]; P[R.FOOT_F] = [-20, -2];
    P[R.KNEE_B] = [-13, -2.5]; P[R.FOOT_B] = [-20, -1.5];
    return P;
  }

  // Guards wave until they spot the creature, then charge in with a stun baton.
  thinkGuard(dt) {
    const pl = this.game.player;
    const sees = this.seesPlayer(420);
    if (sees) this.sawPlayerT = 4; else this.sawPlayerT -= dt;
    this.speed = 0;
    this.swingT = (this.swingT || 0) - dt;
    if (this.mode === 'idle') {
      if (Math.abs(pl.x - this.rootX) < 900) this.facing = pl.x < this.rootX ? -1 : 1;
      if (sees) { this.mode = 'attack'; this.say(pick(['CONTAINMENT BREACH!', 'GET BACK IN YOUR CELL!', 'I GOT IT!']), 1.6); }
      return;
    }
    if (this.sawPlayerT <= 0) { this.mode = 'idle'; this.windup = 0; return; }
    const dx = pl.cx - this.rootX, adx = Math.abs(dx);
    this.facing = dx < 0 ? -1 : 1;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.swingT = 1.0;
        // Swing lands if the creature is still in reach.
        const ddx = (pl.cx - this.rootX) * this.facing;
        if (ddx > -15 && ddx < 80 && Math.abs(pl.cy - (this.groundY - 45)) < 70 && this.armed() && !pl.hidden) {
          pl.hurt(12, this.facing, -0.3, pl.cx, pl.cy);
          pl.vx += this.facing * 260; pl.vy -= 140;
          Sfx.thunk();
          this.game.fx.sparks(pl.cx, pl.cy, this.facing, -0.5, 6, 260, '#9fd0ff');
        }
      }
      return;
    }
    if (adx > 40) this.speed = 125;
    if (adx < 60 && Math.abs(pl.cy - (this.groundY - 60)) < 90 && this.swingT <= 0 && this.armed()) this.windup = 0.3;
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
      this.aimAng = Math.atan2(pl.cy - N.y, (pl.cx - N.x) * this.facing);
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

  // Target pose in art pixels, facing right. dying = progress 0..1 of a death.
  pose(dying) {
    const P = REST_ART.map((o) => [o[0], o[1]]);
    const t = this.t;
    if (dying != null) return this.dyingPose(P, dying);
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
    if (this.type === 'guard' && this.mode === 'attack') {
      // Baton raised on the windup, swung down after.
      if (this.windup > 0) { P[R.ELBOW_F] = [3, -35]; P[R.HAND_F] = [-1, -41]; }
      else if (this.swingT > 0.7) { P[R.ELBOW_F] = [6, -26]; P[R.HAND_F] = [11, -22]; }
      else { P[R.ELBOW_F] = [4, -25]; P[R.HAND_F] = [8, -28]; }
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
    const re = this.react;
    if (re && re.kind === 'stagger') {
      // Upper body thrown with the hit, arms windmilling for balance.
      const lean = sign(re.v) * this.facing * Math.min(1, Math.abs(re.v) / 150);
      P[R.NECK][0] += lean * 2.5; P[R.HEAD][0] += lean * 4; P[R.HEAD][1] += 0.5;
      const w = t * 14;
      P[R.ELBOW_F] = [3 - lean * 2, -30]; P[R.HAND_F] = [4 + Math.cos(w) * 3, -34 + Math.sin(w) * 3];
      P[R.ELBOW_B] = [-3 - lean * 2, -29]; P[R.HAND_B] = [-4 - Math.cos(w) * 3, -33 - Math.sin(w) * 3];
      P[R.KNEE_F][0] += lean; P[R.PELVIS][1] += 1;
    } else if (re && re.kind === 'clutch') {
      P[R.ELBOW_F] = [4, -26]; P[R.HAND_F] = [2.5, -31];
      P[R.ELBOW_B] = [3, -25.5]; P[R.HAND_B] = [1.5, -30.5];
      P[R.NECK][0] += 1.5; P[R.HEAD] = [3 + Math.sin(t * 9) * 0.6, -35.5];
      P[R.PELVIS][1] += 1; P[R.KNEE_F][0] += 1;
    } else if (re && re.kind === 'dazed') {
      const l = Math.sin(t * 1.7);
      P[R.NECK][0] += l * 1.2; P[R.HEAD][0] += l * 2.8; P[R.HEAD][1] += 1 + Math.abs(l);
      P[R.HAND_F][0] += 2 + Math.sin(t * 2.3) * 1.5; P[R.HAND_B][0] -= 2;
      P[R.PELVIS][1] += 0.8 + Math.sin(t * 3.1) * 0.5;
    }
    if (this.flinch > 0) for (const p of P) { p[0] += rand(-0.3, 0.3) * this.flinch; p[1] += rand(-0.3, 0.3) * this.flinch; }
    return P;
  }

  dyingPose(P, f) {
    const e = f * f;
    const st = this.dyingStyle;
    if (st === 'buckle' || st === 'headless') {
      P[R.PELVIS] = [1.5 * e, -19 + 10 * e]; P[R.KNEE_F] = [4 * e + 1.5, -10.5 + 5 * e]; P[R.KNEE_B] = [3 * e - 1.5, -10.5 + 5 * e];
      P[R.NECK] = [3 * e, -31 + 12 * e]; P[R.HEAD] = [6 * e, -37 + 14 * e];
      P[R.ELBOW_F] = [3 * e, -24 + 10 * e]; P[R.HAND_F] = [4 * e, -18 + 12 * e];
      if (st === 'headless') { P[R.HAND_F] = [2 + Math.sin(this.t * 20) * 2, -30]; P[R.HAND_B] = [-2, -29 + Math.cos(this.t * 17) * 2]; }
    } else if (st === 'clutch') {
      P[R.PELVIS] = [0, -19 + 8 * e]; P[R.KNEE_F] = [3 * e + 1.5, -10.5 + 4 * e]; P[R.KNEE_B] = [2 * e - 1.5, -10.5 + 4 * e];
      P[R.NECK] = [2 * e, -31 + 9 * e]; P[R.HEAD] = [4 * e, -37 + 10 * e];
      P[R.ELBOW_F] = [4, -24 + 8 * e]; P[R.HAND_F] = [2, -26 + 8 * e];
      P[R.ELBOW_B] = [3, -23 + 8 * e]; P[R.HAND_B] = [1.5, -25.5 + 8 * e];
    } else if (st === 'back') {
      P[R.PELVIS] = [-2 * e, -19 + 4 * e]; P[R.NECK] = [-6 * e, -31 + 5 * e]; P[R.HEAD] = [-9 * e, -37 + 5 * e];
      P[R.ELBOW_F] = [2, -32]; P[R.HAND_F] = [4, -37 + 3 * e];
      P[R.ELBOW_B] = [-3, -31]; P[R.HAND_B] = [-5, -36 + 3 * e];
    } else {
      // rigid: locked up, head snapped back.
      P[R.HEAD][0] -= 2; P[R.NECK][0] -= 0.5;
      P[R.HAND_F] = [4, -22]; P[R.HAND_B] = [-3, -22];
    }
    return P;
  }

  poseDrive(P, kScale = 1) {
    const k = 0.2 * kScale * this.drive * (1 - this.flinch * 0.6);
    const skipLegs = this.paralysed || this.legsLost;
    for (const p of this.rag.parts) {
      if (p.role < 0 || p.pin || p.held || !this.main.has(p)) continue;
      if (skipLegs && this.crawling && p.role >= R.KNEE_B) continue;
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
    if (this.type === 'guard' && this.mode === 'attack' && this.main.has(this.rag.joint[R.HAND_F]) && this.alive) {
      const H = this.rag.joint[R.HAND_F], E = this.rag.joint[R.ELBOW_F];
      const d = dist(E.x, E.y, H.x, H.y) || 1;
      const ux = (H.x - E.x) / d, uy = (H.y - E.y) / d;
      fb.line(H.x / PX, H.y / PX, H.x / PX + ux * 6, H.y / PX + uy * 6, PISTOL_C);
      if (this.windup > 0) fb.put(H.x / PX + ux * 6, H.y / PX + uy * 6, hexc('#9fd0ff'));
    }
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
