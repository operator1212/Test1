// World container: fixed-step simulation, camera, objectives, pixel rendering + HUD.
'use strict';

const ART_VIEW_H = 270;      // target vertical resolution in art pixels
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
    this.messages = [];
    this.time = 0;
    this.timeScale = 1;
    this.shakeAmt = 0;
    this.showHelp = true;
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
      else this.spawnNPC(s.type === 'S' ? 'scientist' : 'guard', s.x, s.y);
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

  shake(a) { this.shakeAmt = Math.min(5, this.shakeAmt + a * 0.35); }

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
    if (Math.abs(x - pl.x) < 50 && y > pl.y - 130 && y < pl.y + 10) {
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

  onNpcDeath(npc, cause) {
    const h = npc.rag.head;
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
    if (I.hit('KeyF')) { this.timeScale = this.timeScale < 1 ? 1 : 0.3; this.message(this.timeScale < 1 ? 'SLOW MOTION' : 'NORMAL SPEED'); }
    if (I.hit('KeyG') || I.hit('KeyT')) this.spawnAtCursor(I.hit('KeyT') ? 'scientist' : 'guard');
    if (I.hit('KeyX')) this.clearSpikes();

    this.player.update(dt);
    for (const n of this.npcs) n.update(dt);
    for (const n of this.npcs) n.rag.integrate();
    for (const s of this.spikes) s.update(dt, this);
    this.spikes = this.spikes.filter((s) => s.state !== 'dead');
    this.limitSpikes();

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
    const stuck = this.spikes.filter((s) => s.state === 'stuck');
    if (stuck.length <= 40) return;
    const old = stuck[0];
    old.release();
    old.state = 'dead';
    this.spikes = this.spikes.filter((s) => s !== old);
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
    this.fx.text(m.x, g - 130, type === 'guard' ? '+ GUARD' : '+ SCIENTIST', '#9fd0ff');
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
    this.shake(0.4);
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
      npc.flinch = Math.max(npc.flinch, 0.5);
      npc.lastHitBy = 'laser';
      // Burn at the entry pixel and drill a little deeper along the beam.
      const [di, dj] = q.toGrid(h.x + a.x * PX * 1.8, h.y + a.y * PX * 1.8, F);
      let removed = npc.rag.burn(q, gi, gj, 1.5, Math.min(1, dt * 45), 0.45);
      if (npc.rag.pieces.includes(q)) removed += npc.rag.burn(q, di, dj, 1.1, Math.min(1, dt * 30), 0.45);
      if (removed) {
        npc.addBleed(removed);
        this.blood.spray(h.x, h.y, -a.x, -a.y - 0.3, removed + 1, 300, 0.8);
      }
      if (npc.alive) {
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
    const ty = pl.y - 70 + clamp(m.y - pl.y, -400, 400) * 0.18;
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

    // Weapons.
    const pl = this.player;
    ['1 HARPOON', '2 LASER'].forEach((name, i) => {
      const x = 4 + i * 62, y = H - 20;
      panel(x, y, 58, 16, pl.weapon === i ? 'rgba(47,95,191,0.92)' : 'rgba(12,20,38,0.78)');
      pixelText(g, name, x + 4, y + 3, '#ffffff');
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 4, y + 11, 50, 2);
      if (i === 0) {
        g.fillStyle = '#d7dce4'; g.fillRect(x + 4, y + 11, Math.round(50 * clamp(1 - pl.cool / 0.42, 0, 1)), 2);
      } else {
        g.fillStyle = pl.overheat ? '#ff3b2f' : `hsl(${lerp(190, 10, pl.heat)},100%,60%)`;
        g.fillRect(x + 4, y + 11, Math.round(50 * pl.heat), 2);
      }
    });
    panel(128, H - 20, 70, 16);
    pixelText(g, 'RMB TENTACLE', 132, H - 17, '#ffb3b8');
    const ts = pl.tentacle.state === 'attached' ? (pl.tentacle.npc ? 'HOLDING BODY' : 'LATCHED') : 'READY';
    pixelText(g, ts, 132, H - 10, '#c9d6ee');
    if (this.timeScale < 1) pixelTextShadow(g, 'SLOW-MO', 204, H - 14, '#ffd84a');

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
        ['A D', 'MOVE'], ['W SPACE', 'JUMP / LEAP OFF TENTACLE'], ['MOUSE', 'AIM'], ['LMB', 'FIRE WEAPON'],
        ['RMB HOLD', 'TENTACLE: LATCH, REEL, GRAB'], ['1 2 Q WHEEL', 'HARPOON / LASER'], ['F', 'SLOW MOTION'],
        ['G / T', 'SPAWN GUARD / SCIENTIST'], ['X', 'CLEAR HARPOONS'], ['R', 'RESET CHAMBER'], ['H', 'HIDE HELP'],
      ];
      const bw = 166, x = W - bw - 4;
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
    const col = pl.weapon === 0 ? '#ffffff' : '#ff5c8a';
    for (const [c, o] of [['#000000', 1], [col, 0]]) {
      g.fillStyle = c;
      g.fillRect(mx - 5 + o, my + o, 3, 1); g.fillRect(mx + 3 + o, my + o, 3, 1);
      g.fillRect(mx + o, my - 5 + o, 1, 3); g.fillRect(mx + o, my + 3 + o, 1, 3);
      g.fillRect(mx + o, my + o, 1, 1);
    }
  }
}

const LASER_PINK = hexc('#ff3c78'), LASER_CORE = hexc('#ffffff');
