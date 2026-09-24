// World container: fixed-step simulation, camera, objectives, pixel rendering + HUD.
'use strict';

const ART_VIEW_H = 270;
const KILL_SLOW_TIME = 0.6;
const CREATURES = () => [Player, Worm, Eye, Slime, Crystal];      // target vertical resolution in art pixels
const SOLVER_ITERS = 8;

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.map = new TileMap(TEST_MAP);
    this.map.buildLayer();
    this.blood = new BloodSystem(this.map);
    this.blood.stainFn = (x, y, c) => this.stainAt(x, y, c);
    this.fx = new FX();
    this.npcs = [];
    this.spikes = [];
    this.shots = [];         // bullets, saws, bombs
    this.messages = [];
    this.time = 0;
    this.timeScale = 1;
    this.slowPulse = 0;       // real seconds left of the kill slow-down
    this.focus = 1;           // slow-motion meter (0..1)
    this.shakeAmt = 0;
    this.showHelp = true;
    this.shakeOn = true;
    this.laser = null;
    this.objectives = [
      { id: 'pin', text: "HARPOON A GUARD'S LEG TO A WALL", done: false },
      { id: 'laser', text: 'KILL THE SCIENTIST WITH THE LASER', done: false },
    ];
    this.complete = false;
    this.lo = document.createElement('canvas');
    this.loCtx = this.lo.getContext('2d');
    this.fb = new FrameBuffer();
    this.view = { s: 1, w: 1, h: 1, x0: 0, y0: 0 };

    for (const s of this.map.spawns) {
      if (s.type === 'P') this.spawn = { x: s.x, y: s.y - 0.01 };
      else this.spawnNPC({ S: 'scientist', A: 'soldier' }[s.type] || 'guard', s.x, s.y);
    }
    this.player = new Player(this, this.spawn.x, this.spawn.y);
    this.cam = { x: this.spawn.x, y: this.spawn.y - 200 };
    this.resize();
    this.message('SUBJECT 09 - ESCAPE TEST IN PROGRESS', '#9fd0ff');
  }

  spawnNPC(type, x, groundY) {
    const n = new NPC(this, type, x, groundY);
    this.npcs.push(n);
    return n;
  }

  // Integer upscale so every art pixel is a clean square on screen.
  resize() {
    const W = this.canvas.width, H = this.canvas.height;
    const s = Math.max(1, Math.round(H / ART_VIEW_H));
    const v = this.view;
    v.s = s; v.w = Math.ceil(W / s); v.h = Math.ceil(H / s);
    this.lo.width = v.w; this.lo.height = v.h;
    this.fb.resize(v.w, v.h);
  }

  mouseWorld() {
    const v = this.view;
    return { x: (Input.mouse.x / v.s + v.x0) * PX, y: (Input.mouse.y / v.s + v.y0) * PX };
  }

  shake(a) { if (this.shakeOn) this.shakeAmt = Math.min(3, this.shakeAmt + a * 0.3); }

  message(text, color) {
    this.messages.push({ text: text.toUpperCase(), color: color || '#fff', t: 3 });
    if (this.messages.length > 4) this.messages.shift();
  }

  // Pixel-precise: first body pixel crossed by the segment. Optional pad
  // (world units) also tests two parallel segments for fat projectiles.
  hitPieces(x0, y0, x1, y1, exclude, pad) {
    let best = null;
    const test = (ax, ay, bx, by) => {
      for (const npc of this.npcs) {
        const rag = npc.rag;
        if (exclude && exclude.has(rag)) continue;
        for (const q of rag.pieces) {
          const r = q.rayHit(ax, ay, bx, by);
          if (r && (!best || r.t < best.t)) best = { t: r.t, idx: r.idx, piece: q, npc, x: ax + (bx - ax) * r.t, y: ay + (by - ay) * r.t };
        }
      }
    };
    test(x0, y0, x1, y1);
    if (pad) {
      const d = dist(x0, y0, x1, y1) || 1;
      const nx = -(y1 - y0) / d * pad, ny = (x1 - x0) / d * pad;
      test(x0 + nx, y0 + ny, x1 + nx, y1 + ny);
      test(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
    }
    if (best) {
      const q = best.piece;
      best.particle = dist2(best.x, best.y, q.a.x, q.a.y) < dist2(best.x, best.y, q.b.x, q.b.y) ? q.a : q.b;
    }
    return best;
  }

  // A blood drop at (x, y): stain the body pixel there, if any.
  stainAt(x, y, c) {
    for (const npc of this.npcs) {
      const p = npc.rag.pelvis;
      if (Math.abs(x - p.x) > 260 || Math.abs(y - p.y) > 260) continue;
      const h = npc.rag.pieceAt(x, y);
      if (h) { h.piece.stain(h.idx, c, 0.45); return true; }
    }
    const pl = this.player;
    if (!pl.dead && dist(x, y, pl.cx, pl.cy) < 80) {
      for (let k = pl.pieces.length - 1; k >= 0; k--) {
        const idx = pl.pieces[k].cellAt(x, y);
        if (idx >= 0) { pl.pieces[k].stain(idx, c, 0.5); return true; }
      }
    }
    return false;
  }

  // ------------------------------------------------------------ events
  onSpikeStuck(spike) {
    if (!spike.carried.length) return;
    const wall = spike.normal && spike.normal.x !== 0;
    for (const p of spike.carried) {
      const npc = this.npcs.find((n) => n.rag === p.rag);
      if (!npc) continue;
      const isLeg = LEG_ROLES.has(p.role) || npc.rag.pieces.some((q) => (q.a === p || q.b === p) && q.leg);
      this.blood.spray(p.x, p.y, spike.normal.x, spike.normal.y, 14, 260, 0.9);
      if (isLeg && wall && npc.type === 'guard') {
        this.fx.text(p.x, p.y - 20, 'LEG PINNED!', '#ffd84a');
        this.completeObjective('pin');
      } else {
        this.fx.text(p.x, p.y - 20, 'PINNED', '#ffd84a');
        if (isLeg && !wall && npc.type === 'guard' && !this.objectives[0].done) this.message('Pinned to the floor - try a WALL', '#ffcf6a');
      }
    }
  }

  // Time scale for this frame: the F toggle times a brief eased slow-down after
  // killing someone who was attacking you.
  frameTimeScale(realDt) {
    // Slow motion burns focus; it refills slowly (and from kills) when off.
    if (this.timeScale < 1) {
      this.focus -= realDt * 0.22;
      if (this.focus <= 0) { this.focus = 0; this.timeScale = 1; this.message('FOCUS EMPTY', '#ff8a3a'); }
    } else this.focus = Math.min(1, this.focus + realDt * 0.05);
    let k = 1;
    if (this.slowPulse > 0) {
      this.slowPulse = Math.max(0, this.slowPulse - realDt);
      const f = this.slowPulse / KILL_SLOW_TIME;
      k = 1 - 0.78 * f * f;
    }
    return this.timeScale * k;
  }

  onNpcDeath(npc, cause) {
    const h = npc.rag.head;
    this.focus = Math.min(1, this.focus + 0.15);
    if (npc.type === 'soldier' && (npc.mode === 'attack' || this.time - (npc.lastShotT || -99) < 4)) {
      this.slowPulse = KILL_SLOW_TIME;
      Sfx.tone(180, 60, 0.4, 0.3, 'sine');
    }
    this.fx.text(h.x, h.y - 30, npc.type === 'scientist' ? 'SCIENTIST KILLED' : 'GUARD DOWN', '#ff5a64');
    if (npc.type === 'scientist' && cause === 'laser') this.completeObjective('laser');
    else if (npc.type === 'scientist' && !this.objectives[1].done) this.message('Scientist died - but not by laser. R resets', '#ffcf6a');
  }

  completeObjective(id) {
    const o = this.objectives.find((q) => q.id === id);
    if (!o || o.done) return;
    o.done = true;
    this.message('OBJECTIVE COMPLETE', '#7dff9a');
    Sfx.tone(520, 1040, 0.25, 0.2, 'triangle');
    if (this.objectives.every((q) => q.done)) {
      this.complete = true;
      this.message('TEST COMPLETE - PRESS R TO RUN IT AGAIN', '#7dff9a');
    }
  }

  // ------------------------------------------------------------ simulation
  step(dt) {
    this.time += dt;
    const I = Input;
    if (I.hit('KeyH')) this.showHelp = !this.showHelp;
    if (I.hit('KeyF')) {
      if (this.timeScale < 1) this.timeScale = 1;
      else if (this.focus > 0.1) this.timeScale = 0.3;
      else { Sfx.denied(); this.message('FOCUS EMPTY', '#ff8a3a'); }
    }
    if (I.hit('KeyG')) this.spawnAtCursor('guard');
    if (I.hit('KeyT')) this.spawnAtCursor('scientist');
    if (I.hit('KeyY')) this.spawnAtCursor('soldier');
    if (I.hit('KeyK')) { this.player.god = !this.player.god; this.message(this.player.god ? 'GOD MODE ON' : 'GOD MODE OFF'); }
    if (I.hit('KeyO')) { this.shakeOn = !this.shakeOn; this.shakeAmt = 0; this.message(this.shakeOn ? 'SCREEN SHAKE ON' : 'SCREEN SHAKE OFF'); }
    if (I.hit('KeyX')) this.clearSpikes();
    if (I.hit('Tab')) this.switchCreature();

    this.player.update(dt);
    for (const n of this.npcs) n.update(dt);
    for (const n of this.npcs) n.rag.integrate();
    for (const s of this.spikes) s.update(dt, this);
    this.spikes = this.spikes.filter((s) => s.state !== 'dead');
    this.limitSpikes();
    for (const s of this.shots) s.update(dt, this);
    this.shots = this.shots.filter((s) => s.state !== 'dead');
    this.dashRam();

    for (let it = 0; it < SOLVER_ITERS; it++) {
      const last = it === SOLVER_ITERS - 1;
      for (const n of this.npcs) n.rag.solve(this.map, last);
      if (it === 0) this.collideBodies();
    }
    this.player.pushBodies(this.npcs);
    for (const n of this.npcs) n.rag.post(dt);

    this.updateLaser(dt);
    this.blood.update(dt);
    this.fx.update(dt);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    this.updateCamera(dt);
  }

  collideBodies() {
    const n = this.npcs;
    for (let i = 0; i < n.length; i++) {
      const A = n[i].rag.parts;
      const pa = n[i].rag.pelvis;
      for (let j = i + 1; j < n.length; j++) {
        const pb = n[j].rag.pelvis;
        if (Math.abs(pa.x - pb.x) > 260 || Math.abs(pa.y - pb.y) > 260) continue;
        const B = n[j].rag.parts;
        for (const a of A) for (const b of B) collidePair(a, b);
      }
    }
  }

  limitSpikes() {
    const lodged = this.spikes.filter((s) => s.state === 'lodged');
    if (lodged.length > 30) lodged[0].state = 'dead';
    const stuck = this.spikes.filter((s) => s.state === 'stuck');
    if (stuck.length <= 40) return;
    const old = stuck[0];
    old.release();
    old.state = 'dead';
    this.spikes = this.spikes.filter((s) => s !== old);
  }

  // Swap the escaped test subject in place (keeps health and momentum).
  switchCreature() {
    const old = this.player;
    if (old.dead) return;
    old.tentacle.release(false);
    Sfx.laserOn(false);
    const list = CREATURES();
    const C = list[(list.indexOf(old.constructor) + 1) % list.length];
    const p = new C(this, old.x, old.y + old.rideH);
    p.hp = old.hp; p.god = old.god; p.vx = old.vx; p.vy = old.vy;
    p.up = { ...old.up };
    this.player = p;
    this.fx.flash(p.x, p.y, 60, '#ff9aa0');
    this.blood.burst(p.x, p.y, 30, 300);
    this.message(p.creature, '#ffb3b8');
    Sfx.squelch();
  }

  clearSpikes() {
    for (const s of this.spikes) s.release();
    this.spikes = [];
    this.message('Harpoons cleared');
  }

  spawnAtCursor(type) {
    const m = this.mouseWorld();
    const g = this.map.groundBelow(m.x, m.y, 800);
    if (g === null) { Sfx.denied(); return; }
    this.spawnNPC(type, m.x, g);
    this.fx.text(m.x, g - 130, '+ ' + type.toUpperCase(), '#9fd0ff');
  }

  // Rip pixels out of any body at a world point (creature attacks). radius in
  // art px. Returns the number of pixels removed; living victims take damage,
  // bleed, get their vital zones checked and react to the hit.
  burnAt(x, y, radius, prob, char, cause, dmgPerPx, dx = 0, dy = 0) {
    let total = 0;
    for (const npc of this.npcs) {
      const rag = npc.rag;
      rag.resetZones();
      let hurt = 0;
      for (const q of rag.pieces.slice()) {
        if (!rag.pieces.includes(q)) continue;
        if (dist(x, y, q.bc.x, q.bc.y) > q.bc.r + radius * PX) continue;
        const [gi, gj] = q.toGrid(x, y, q.frame());
        if (gi < -radius || gj < -radius || gi > q.w + radius || gj > q.h + radius) continue;
        const living = npc.alive && npc.main.has(q.a);
        const removed = rag.burn(q, gi, gj, radius, prob, char);
        if (!removed) continue;
        total += removed;
        if (living) hurt += removed;
      }
      if (hurt && npc.alive) {
        npc.addBleed(hurt);
        npc.damage(hurt * dmgPerPx, cause);
        npc.applyZones(rag.zoneHits, cause, x, y);
        if (dx || dy) npc.hitReact(dx, dy, 0.4);
      }
    }
    return total;
  }

  // Shared hit resolution for bullets/pellets: punch a hole (and a short
  // channel along the travel direction), bleed, vital zones, knockback.
  woundAt(h, o) {
    const npc = h.npc, rag = npc.rag, q = h.piece;
    const F = q.frame();
    const [gi, gj] = q.toGrid(h.x + o.dx * PX * 0.4, h.y + o.dy * PX * 0.4, F);
    rag.resetZones();
    let removed = rag.burn(q, gi, gj, o.radius, 1, 0.25);
    if (o.drill && rag.pieces.includes(q)) {
      const [di, dj] = q.toGrid(h.x + o.dx * PX * o.drill, h.y + o.dy * PX * o.drill, F);
      removed += rag.burn(q, di, dj, o.radius * 0.8, 1, 0.25);
    }
    h.particle.impulse(o.dx * o.push, o.dy * o.push);
    this.blood.spray(h.x, h.y, o.dx, o.dy, 6, 380, 0.35);
    this.blood.spray(h.x, h.y, -o.dx, -o.dy, 3, 160, 0.7);
    const living = npc.alive && npc.main.has(h.particle);
    if (living) {
      npc.addBleed(removed);
      npc.damage(o.dmg, o.cause);
      npc.flinch = 1;
      npc.applyZones(rag.zoneHits, o.cause, h.x, h.y);
      npc.hitReact(o.dx, o.dy, o.dmg / 8);
    }
    return removed;
  }

  explosion(x, y, R) {
    Sfx.boom();
    this.shake(4);
    this.fx.flash(x, y, R * 0.9, '#d8ff9a');
    this.fx.sparks(x, y, 0, -1, 16, 520, '#c8ff7a');
    for (let k = 0; k < 6; k++) this.fx.smoke(x + rand(-20, 20), y + rand(-20, 20), rand(2, 3.5));
    for (let k = 0; k < 60; k++) {
      const a = rand(0, TAU), s = rand(150, 700);
      this.blood.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s - 200, rand(1.5, 2.5), pick(BILE_PX));
    }
    for (const npc of this.npcs) {
      const rag = npc.rag;
      rag.resetZones();
      let removed = 0;
      for (const q of rag.pieces.slice()) {
        if (!rag.pieces.includes(q)) continue;
        if (dist(x, y, q.bc.x, q.bc.y) > R * 0.35 + q.bc.r) continue;
        const [gi, gj] = q.toGrid(x, y, q.frame());
        removed += rag.burn(q, gi, gj, R * 0.3 / PX, 0.5, 0.55);
      }
      for (const p of rag.parts) {
        const d = dist(p.x, p.y, x, y) || 1;
        if (d > R * 1.7) continue;
        const f = 1 - d / (R * 1.7);
        p.impulse((p.x - x) / d * 1500 * f, ((p.y - y) / d * 1500 - 500) * f);
      }
      const dp = dist(x, y, rag.pelvis.x, rag.pelvis.y - 30);
      if (npc.alive && dp < R * 1.7) {
        npc.knock(3);
        npc.addBleed(removed);
        npc.damage(Math.max(0, 1 - dp / (R * 1.3)) * 110, 'bomb');
        npc.applyZones(rag.zoneHits, 'bomb', x, y);
      }
    }
    const pl = this.player;
    const d = dist(x, y, pl.cx, pl.cy) || 1;
    if (d < R * 1.4 && !pl.dead) {
      const f = 1 - d / (R * 1.4);
      pl.vx += (pl.cx - x) / d * 900 * f;
      pl.vy += ((pl.cy - y) / d * 900 - 350) * f;
      pl.detachT = 0.25;
      pl.hurt(28 * f, 0, 0, pl.cx, pl.cy);
    }
  }

  npcShoot(npc) {
    const H = npc.rag.joint[R.HAND_F], pl = this.player;
    const tx = pl.cx, ty = pl.cy;
    const a = Math.atan2(ty - H.y, tx - H.x) + rand(-0.06, 0.06);
    const sp = 950;
    const mx = H.x + Math.cos(a) * 12, my = H.y + Math.sin(a) * 12;
    this.shots.push(new Bullet(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, 'npc', 9, 'bullet', npc.rag));
    npc.lastShotT = this.time;
    this.fx.flash(mx, my, 14, '#ffe7a0');
    Sfx.pistol();
  }

  // Dashing through people bowls them over.
  dashRam() {
    const pl = this.player;
    if (pl.dashT <= 0) return;
    const [l, t, r, b] = pl.box();
    for (const npc of this.npcs) {
      if (pl.rammed.has(npc)) continue;
      const hit = npc.rag.parts.some((p) => p.x > l - 8 && p.x < r + 8 && p.y > t && p.y < b);
      if (!hit) continue;
      pl.rammed.add(npc);
      for (const p of npc.rag.parts) if (npc.main.has(p)) p.impulse(pl.dashDx * 700, pl.dashDy * 700 - 250);
      if (npc.alive) { npc.knock(2); npc.damage(8, 'dash'); }
      Sfx.thunk();
      this.shake(1.5);
    }
  }

  // The prototype laser burns away the exact pixels it touches.
  updateLaser(dt) {
    const pl = this.player;
    this.laser = null;
    if (!pl.firingLaser) return;
    const o = pl.muzzle();
    const a = pl.aim;
    const ray = this.map.raycast(o.x, o.y, a.x, a.y, LASER_RANGE);
    const h = this.hitPieces(o.x, o.y, ray.x, ray.y, null, 0);
    if (h) {
      this.laser = { x0: o.x, y0: o.y, x1: h.x, y1: h.y, hit: true };
      const npc = h.npc, q = h.piece;
      const F = q.frame();
      const [gi, gj] = q.toGrid(h.x + a.x * PX * 0.4, h.y + a.y * PX * 0.4, F);
      // Scorch the surface around the entry point.
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(gi + rand(-2, 2)), j = Math.floor(gj + rand(-2, 2));
        if (i >= 0 && j >= 0 && i < q.w && j < q.h && q.col[j * q.w + i]) q.col[j * q.w + i] = mixc(q.col[j * q.w + i], C_BLACK, 0.12);
      }
      h.particle.impulse(a.x * 25, a.y * 25);
      const living = npc.alive && npc.main.has(h.particle);
      if (living) { npc.flinch = Math.max(npc.flinch, 0.5); npc.lastHitBy = 'laser'; }
      npc.rag.resetZones();
      // Burn at the entry pixel and drill a little deeper along the beam.
      const [di, dj] = q.toGrid(h.x + a.x * PX * 1.8, h.y + a.y * PX * 1.8, F);
      let removed = npc.rag.burn(q, gi, gj, 1.5, Math.min(1, dt * 45), 0.45);
      if (npc.rag.pieces.includes(q)) removed += npc.rag.burn(q, di, dj, 1.1, Math.min(1, dt * 30), 0.45);
      if (removed) {
        if (living) npc.addBleed(removed);
        this.blood.spray(h.x, h.y, -a.x, -a.y - 0.3, removed + 1, 300, 0.8);
      }
      if (living) {
        npc.applyZones(npc.rag.zoneHits, 'laser', h.x, h.y);
        npc.damage(110 * dt, 'laser');
        if (Math.random() < dt * 3 && npc.alive) npc.say(pick(['AAAAAH!', 'IT BURNS!', 'NO NO NO']), 1);
      }
      if (Math.random() < 0.4) this.fx.smoke(h.x, h.y);
      if (Math.random() < 0.5) this.fx.sparks(h.x, h.y, -a.x, -a.y, 1, 250, '#ffb070');
    } else {
      this.laser = { x0: o.x, y0: o.y, x1: ray.x, y1: ray.y, hit: ray.hit };
      if (ray.hit) {
        if (Math.random() < 0.3) this.blood.scorch(ray.x - a.x, ray.y - a.y);
        if (Math.random() < 0.6) this.fx.sparks(ray.x, ray.y, ray.nx, ray.ny, 1, 300, '#ffd0f0');
        if (Math.random() < 0.15) this.fx.smoke(ray.x, ray.y);
      }
    }
  }

  updateCamera(dt) {
    const pl = this.player, c = this.cam, v = this.view;
    const m = this.mouseWorld();
    const tx = pl.x + clamp(m.x - pl.x, -500, 500) * 0.22;
    const ty = pl.y - 20 + clamp(m.y - pl.y, -400, 400) * 0.18;
    c.x = lerp(c.x, tx, 1 - Math.exp(-dt * 7));
    c.y = lerp(c.y, ty, 1 - Math.exp(-dt * 7));
    const hw = v.w * PX / 2, hh = v.h * PX / 2;
    c.x = this.map.pw > hw * 2 ? clamp(c.x, hw, this.map.pw - hw) : this.map.pw / 2;
    c.y = this.map.ph > hh * 2 ? clamp(c.y, hh, this.map.ph - hh) : this.map.ph / 2;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 12);
  }

  // ------------------------------------------------------------ rendering
  render(mainCtx) {
    const v = this.view, g = this.loCtx, fb = this.fb;
    const sh = Math.round(this.shakeAmt);
    v.x0 = Math.round(this.cam.x / PX - v.w / 2) + (sh ? randi(-sh, sh) : 0);
    v.y0 = Math.round(this.cam.y / PX - v.h / 2) + (sh ? randi(-sh, sh) : 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0c0e12';
    g.fillRect(0, 0, v.w, v.h);
    g.drawImage(this.map.layer, -v.x0, -v.y0);
    this.blood.renderDecals(g, v);

    fb.ox = v.x0; fb.oy = v.y0;
    fb.clear();
    for (const n of this.npcs) if (!n.alive) n.render(fb);
    for (const n of this.npcs) if (n.alive) n.render(fb);
    this.player.tentacle.render(fb);
    this.player.render(fb);
    for (const s of this.spikes) s.render(fb);
    for (const s of this.shots) s.render(fb);
    this.renderLaser(fb);
    this.blood.renderDrops(fb);
    this.fx.render(fb);
    fb.present(g);

    for (const n of this.npcs) n.renderBubble(g, v);
    this.fx.renderText(g, v);
    this.renderHUD(g);

    mainCtx.imageSmoothingEnabled = false;
    mainCtx.drawImage(this.lo, 0, 0, v.w * v.s, v.h * v.s);
  }

  renderLaser(fb) {
    const l = this.laser;
    if (!l) return;
    const x0 = l.x0 / PX, y0 = l.y0 / PX, x1 = l.x1 / PX, y1 = l.y1 / PX;
    const d = dist(x0, y0, x1, y1) || 1;
    const ux = (x1 - x0) / d, uy = (y1 - y0) / d, nx = -uy, ny = ux;
    const pink = LASER_PINK, flick = Math.random() < 0.5;
    for (let k = 0; k <= d; k++) {
      const x = x0 + ux * k, y = y0 + uy * k;
      fb.blend(x + nx * 2, y + ny * 2, pink, flick ? 0.25 : 0.15);
      fb.blend(x - nx * 2, y - ny * 2, pink, flick ? 0.25 : 0.15);
      fb.blend(x + nx, y + ny, pink, 0.75);
      fb.blend(x - nx, y - ny, pink, 0.75);
    }
    fb.line(x0, y0, x1, y1, LASER_CORE);
    if (l.hit) {
      const r = flick ? 3 : 2.2;
      for (let yy = Math.floor(y1 - r); yy <= y1 + r; yy++)
        for (let xx = Math.floor(x1 - r); xx <= x1 + r; xx++)
          if ((xx + 0.5 - x1) ** 2 + (yy + 0.5 - y1) ** 2 <= r * r) fb.blend(xx, yy, LASER_CORE, 0.7);
    }
  }

  renderHUD(g) {
    const v = this.view, W = v.w, H = v.h;
    const panel = (x, y, w, h, bg = 'rgba(12,20,38,0.82)') => {
      g.fillStyle = bg; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(159,194,255,0.35)'; g.fillRect(x, y, w, 1);
    };

    // Objectives.
    const ow = 150;
    panel(4, 4, ow, 12 + this.objectives.length * 9);
    pixelText(g, 'TEST CHAMBER 00', 8, 7, '#9fc2ff');
    this.objectives.forEach((o, i) => {
      const y = 16 + i * 9;
      g.fillStyle = o.done ? '#7dff9a' : '#c9d6ee';
      g.fillRect(8, y, 5, 5);
      g.fillStyle = 'rgba(12,20,38,1)';
      if (!o.done) g.fillRect(9, y + 1, 3, 3);
      pixelText(g, o.text, 16, y, o.done ? '#7dff9a' : '#ffffff');
    });

    // Health.
    const pl = this.player;
    panel(4, 38, 90, 10);
    g.fillStyle = '#3a0c12'; g.fillRect(7, 41, 84, 4);
    g.fillStyle = pl.god ? '#ffe36b' : pl.hp > 35 ? '#e8414f' : (Math.floor(this.time * 6) % 2 ? '#ff8a8a' : '#e8414f');
    g.fillRect(7, 41, Math.round(84 * clamp(pl.hp / pl.maxHp, 0, 1)), 4);
    pixelText(g, pl.god ? 'GOD' : String(Math.ceil(pl.hp)), 97, 40, '#ffffff');
    pixelText(g, pl.creature, 116, 40, '#ffb3b8');
    panel(4, 50, 90, 8);
    g.fillStyle = '#10243a'; g.fillRect(7, 53, 84, 2);
    g.fillStyle = this.timeScale < 1 ? '#ffd84a' : '#7fb8ff';
    g.fillRect(7, 53, Math.round(84 * this.focus), 2);
    pixelText(g, 'FOCUS', 97, 51, this.timeScale < 1 ? '#ffd84a' : '#9fc2ff');

    // Weapons.
    pl.weapons.forEach((wpn, i) => {
      const x = 4 + i * 47, y = H - 20;
      panel(x, y, 44, 16, pl.weapon === i ? 'rgba(47,95,191,0.92)' : 'rgba(12,20,38,0.78)');
      pixelText(g, (i + 1) + ' ' + wpn.name, x + 3, y + 3, '#ffffff');
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 3, y + 11, 38, 2);
      if (wpn.kind === 'laser') {
        g.fillStyle = pl.overheat ? '#ff3b2f' : `hsl(${lerp(190, 10, pl.heat)},100%,60%)`;
        g.fillRect(x + 3, y + 11, Math.round(38 * pl.heat), 2);
      } else {
        const r = pl.weapon === i ? clamp(1 - pl.cool / wpn.cool, 0, 1) : 1;
        g.fillStyle = '#d7dce4'; g.fillRect(x + 3, y + 11, Math.round(38 * r), 2);
      }
    });
    const ax = 4 + pl.weapons.length * 47;
    panel(ax, H - 20, 76, 16);
    const tn = pl.tentacle;
    const ts = !pl.hasTentacle ? 'NO GRAPPLE' : tn.state === 'attached' ? (tn.eating ? 'EATING' : tn.holding() ? 'HOLD - E RIP/EAT' : 'LATCHED') : 'RMB TENTACLE';
    pixelText(g, ts, ax + 3, H - 17, '#ffb3b8');
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(ax + 3, H - 9, 70, 2);
    g.fillStyle = '#7fe0ff'; g.fillRect(ax + 3, H - 9, Math.round(70 * clamp(1 - pl.dashCool / 0.5, 0, 1)), 2);
    if (this.timeScale < 1) pixelTextShadow(g, 'SLOW-MO', ax + 82, H - 14, '#ffd84a');

    // Messages.
    const nm = this.messages.length;
    this.messages.forEach((m, i) => {
      if (m.t < 0.6 && Math.floor(m.t * 16) % 2) return;
      const w = textWidth(m.text);
      pixelTextShadow(g, m.text, Math.round(W / 2 - w / 2), H - 34 - (nm - 1 - i) * 9, m.color);
    });

    // Help.
    if (this.showHelp) {
      const lines = [
        ['WASD', 'MOVE ALONG FLOORS, WALLS, CEILINGS'], ['INTO A WALL', 'RUNS UP IT AND OVER THE TOP'],
        ['AWAY', 'PUSH OFF A WALL/CEILING TO LET GO'], ['SPACE', 'LEAP OFF WHATEVER YOU HOLD'],
        ['SHIFT', 'DASH (+ WASD DIRECTION), RAMS'],
        ['LMB', 'FIRE / CREATURE ATTACK (SLOT 1)'], ['RMB HOLD', 'SWING ON WALLS, GRAB BODIES'],
        ['SWINGING', 'FLICK MOUSE, A/D PUMP, W/S ROPE'],
        ['E / HOLD E', 'RIP OFF / EAT WHAT YOU HOLD'], ['1-5 Q WHEEL', 'SWITCH WEAPON'], ['F', 'SLOW MOTION (USES FOCUS)'],
        ['TAB', 'SWITCH CREATURE'], ['G T Y', 'SPAWN GUARD / SCIENTIST / SOLDIER'], ['K / O', 'GOD MODE / SCREEN SHAKE'],
        ['X / R', 'CLEAR HARPOONS / RESET'], ['H', 'HIDE HELP'],
      ];
      const bw = 192, x = W - bw - 4;
      panel(x, 4, bw, 6 + lines.length * 8);
      lines.forEach(([k, d], i) => {
        pixelText(g, k, x + 4, 8 + i * 8, '#9fc2ff');
        pixelText(g, d, x + 52, 8 + i * 8, '#ffffff');
      });
    } else {
      pixelText(g, 'H: HELP', W - 32, 6, 'rgba(255,255,255,0.7)');
    }

    // Crosshair.
    const mx = Math.floor(Input.mouse.x / v.s), my = Math.floor(Input.mouse.y / v.s);
    const col = pl.wkind() === 'laser' ? '#ff5c8a' : '#ffffff';
    for (const [c, o] of [['#000000', 1], [col, 0]]) {
      g.fillStyle = c;
      g.fillRect(mx - 5 + o, my + o, 3, 1); g.fillRect(mx + 3 + o, my + o, 3, 1);
      g.fillRect(mx + o, my - 5 + o, 1, 3); g.fillRect(mx + o, my + 3 + o, 1, 3);
      g.fillRect(mx + o, my + o, 1, 1);
    }
  }
}

const LASER_PINK = hexc('#ff3c78'), LASER_CORE = hexc('#ffffff');
