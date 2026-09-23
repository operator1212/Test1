// World container: fixed-step simulation, camera, objectives, rendering + HUD.
'use strict';

const VIEW_H = 720;          // world pixels visible vertically
const SOLVER_ITERS = 8;

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.map = new TileMap(TEST_MAP);
    this.map.buildLayer();
    this.blood = new BloodSystem(this.map);
    this.fx = new FX();
    this.npcs = [];
    this.spikes = [];
    this.messages = [];
    this.time = 0;
    this.timeScale = 1;
    this.shakeAmt = 0;
    this.showHelp = true;
    this.laser = null;        // current beam {x0, y0, x1, y1, hit}
    this.objectives = [
      { id: 'pin', text: "Harpoon a guard's LEG to a WALL", done: false },
      { id: 'laser', text: 'Kill the scientist with the PROTOTYPE LASER', done: false },
    ];
    this.complete = false;

    for (const s of this.map.spawns) {
      if (s.type === 'P') this.spawn = { x: s.x, y: s.y - 0.01 };
      else this.spawnNPC(s.type === 'S' ? 'scientist' : 'guard', s.x, s.y);
    }
    this.player = new Player(this, this.spawn.x, this.spawn.y);
    this.cam = { x: this.spawn.x, y: this.spawn.y - 200, zoom: 1 };
    this.resize();
    this.message('SUBJECT 09 — escape test in progress', '#9fd0ff');
  }

  spawnNPC(type, x, groundY) {
    const n = new NPC(this, type, x, groundY);
    this.npcs.push(n);
    return n;
  }

  resize() {
    this.cam.zoom = this.canvas.height / VIEW_H;
  }

  mouseWorld() {
    const c = this.cam, W = this.canvas.width, H = this.canvas.height;
    return { x: c.x + (Input.mouse.x - W / 2) / c.zoom, y: c.y + (Input.mouse.y - H / 2) / c.zoom };
  }

  shake(a) { this.shakeAmt = Math.min(14, this.shakeAmt + a); }

  message(text, color) {
    this.messages.push({ text, color: color || '#fff', t: 3 });
    if (this.messages.length > 4) this.messages.shift();
  }

  // Nearest ragdoll part crossed by segment (x0,y0)-(x1,y1).
  hitBones(x0, y0, x1, y1, pad, exclude) {
    let best = null;
    for (const npc of this.npcs) {
      const rag = npc.rag;
      if (exclude && exclude.has(rag)) continue;
      for (const b of rag.bones) {
        if (b.broken) continue;
        let s, px, py;
        if (b.kind === 'neck') {
          const h = b.b;
          const c = closestOnSeg(h.x, h.y, x0, y0, x1, y1);
          const rr = HEAD_R + pad;
          if (c.d2 > rr * rr) continue;
          s = c.t;
        } else {
          const r = Math.max(b.ra, b.rb) + pad;
          const c = segSegClosest(x0, y0, x1, y1, b.a.x, b.a.y, b.b.x, b.b.y);
          if (c.d2 > r * r) continue;
          s = c.s;
        }
        if (best && s >= best.s) continue;
        px = x0 + (x1 - x0) * s; py = y0 + (y1 - y0) * s;
        let particle;
        if (b.kind === 'neck') particle = b.b;
        else particle = dist2(px, py, b.a.x, b.a.y) < dist2(px, py, b.b.x, b.b.y) ? b.a : b.b;
        best = { s, x: px, y: py, npc, bone: b, particle };
      }
    }
    // Loose severed heads.
    for (const npc of this.npcs) {
      const rag = npc.rag;
      if (!rag.decapitated || (exclude && exclude.has(rag))) continue;
      const h = rag.head;
      const c = closestOnSeg(h.x, h.y, x0, y0, x1, y1);
      const rr = HEAD_R + pad;
      if (c.d2 <= rr * rr && (!best || c.t < best.s)) best = { s: c.t, x: c.x, y: c.y, npc, bone: null, particle: h };
    }
    return best;
  }

  // ------------------------------------------------------------ events
  onSpikeStuck(spike) {
    if (!spike.carried.length) return;
    const wall = spike.normal && spike.normal.x !== 0;
    for (const p of spike.carried) {
      const npc = this.npcs.find((n) => n.rag === p.rag);
      if (!npc) continue;
      const isLeg = LEG_ROLES.has(p.role) || this.isLegPiece(npc, p);
      this.blood.spray(p.x, p.y, spike.normal.x, spike.normal.y, 14, 260, 0.9);
      if (isLeg && wall && npc.type === 'guard') {
        this.fx.text(p.x, p.y - 20, 'LEG PINNED!', '#ffd84a');
        this.completeObjective('pin');
      } else {
        this.fx.text(p.x, p.y - 20, 'PINNED', '#ffd84a');
        if (isLeg && !wall && npc.type === 'guard' && !this.objectives[0].done) this.message('Pinned to the floor/ceiling — try a WALL', '#ffcf6a');
      }
    }
  }

  isLegPiece(npc, p) {
    return npc.rag.bones.some((b) => (b.a === p || b.b === p) && /^(thigh|shin)/.test(b.name));
  }

  onNpcDeath(npc, cause) {
    const h = npc.rag.head;
    this.fx.text(h.x, h.y - 30, npc.type === 'scientist' ? 'SCIENTIST KILLED' : 'DUMMY DESTROYED', '#ff5a64');
    if (npc.type === 'scientist' && cause === 'laser') this.completeObjective('laser');
    else if (npc.type === 'scientist' && !this.objectives[1].done) this.message('Scientist died — but not by the laser. (R to reset)', '#ffcf6a');
  }

  completeObjective(id) {
    const o = this.objectives.find((q) => q.id === id);
    if (!o || o.done) return;
    o.done = true;
    this.message('OBJECTIVE COMPLETE: ' + o.text, '#7dff9a');
    Sfx.tone(520, 1040, 0.25, 0.2, 'triangle');
    if (this.objectives.every((q) => q.done)) {
      this.complete = true;
      this.message('TEST COMPLETE — press R to run it again', '#7dff9a');
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
        if (Math.abs(pa.x - pb.x) > 220 || Math.abs(pa.y - pb.y) > 220) continue;
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
    this.fx.text(m.x, g - 110, type === 'guard' ? '+ DUMMY' : '+ SCIENTIST', '#9fd0ff');
  }

  updateLaser(dt) {
    const pl = this.player;
    this.laser = null;
    if (!pl.firingLaser) return;
    const o = pl.muzzle();
    const a = pl.aim;
    const ray = this.map.raycast(o.x, o.y, a.x, a.y, LASER_RANGE);
    const h = this.hitBones(o.x, o.y, ray.x, ray.y, 0, null);
    this.shake(0.6);
    if (h) {
      this.laser = { x0: o.x, y0: o.y, x1: h.x, y1: h.y, hit: true };
      const npc = h.npc;
      if (h.bone) {
        h.bone.hp -= 300 * dt;
        h.bone.char = Math.min(1, h.bone.char + dt * 1.6);
      }
      h.particle.impulse(a.x * 900 * dt * 20, a.y * 900 * dt * 20 - 40);
      npc.flinch = 1;
      if (npc.alive) {
        npc.damage(130 * dt, 'laser');
        if (Math.random() < dt * 3 && npc.alive) npc.say(pick(['AAAAAH!', 'IT BURNS!', 'NO NO NO']), 1);
      }
      if (Math.random() < 0.7) this.blood.spray(h.x, h.y, -a.x, -a.y - 0.3, 2, 320, 0.8);
      if (Math.random() < 0.4) this.fx.smoke(h.x, h.y, 3);
      if (Math.random() < 0.5) this.fx.sparks(h.x, h.y, -a.x, -a.y, 1, 250, '#ffb070');
      if (h.bone && h.bone.hp <= 0) npc.rag.sever(h.bone, 'laser');
    } else {
      this.laser = { x0: o.x, y0: o.y, x1: ray.x, y1: ray.y, hit: ray.hit };
      if (ray.hit) {
        if (Math.random() < 0.5) this.blood.scorch(ray.x, ray.y, 7);
        if (Math.random() < 0.6) this.fx.sparks(ray.x, ray.y, ray.nx, ray.ny, 1, 300, '#ffd0f0');
        if (Math.random() < 0.15) this.fx.smoke(ray.x, ray.y, 3);
      }
    }
  }

  updateCamera(dt) {
    const pl = this.player, c = this.cam;
    const m = this.mouseWorld();
    const tx = pl.x + clamp(m.x - pl.x, -500, 500) * 0.22;
    const ty = pl.y - 70 + clamp(m.y - pl.y, -400, 400) * 0.18;
    c.x = lerp(c.x, tx, 1 - Math.exp(-dt * 7));
    c.y = lerp(c.y, ty, 1 - Math.exp(-dt * 7));
    const hw = this.canvas.width / c.zoom / 2, hh = this.canvas.height / c.zoom / 2;
    c.x = this.map.pw > hw * 2 ? clamp(c.x, hw, this.map.pw - hw) : this.map.pw / 2;
    c.y = this.map.ph > hh * 2 ? clamp(c.y, hh, this.map.ph - hh) : this.map.ph / 2;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
  }

  // ------------------------------------------------------------ rendering
  render(ctx) {
    const W = this.canvas.width, H = this.canvas.height, c = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, W, H);
    const sx = rand(-1, 1) * this.shakeAmt, sy = rand(-1, 1) * this.shakeAmt;
    const z = c.zoom;
    ctx.setTransform(z, 0, 0, z, W / 2 - (c.x + sx) * z, H / 2 - (c.y + sy) * z);
    const vx0 = c.x - W / z / 2 - 20, vy0 = c.y - H / z / 2 - 20, vx1 = c.x + W / z / 2 + 20, vy1 = c.y + H / z / 2 + 20;

    const L = this.map.layer;
    const lx = clamp(Math.floor(vx0), 0, L.width), ly = clamp(Math.floor(vy0), 0, L.height);
    const lw = clamp(Math.ceil(vx1), 0, L.width) - lx, lh = clamp(Math.ceil(vy1), 0, L.height) - ly;
    if (lw > 0 && lh > 0) ctx.drawImage(L, lx, ly, lw, lh, lx, ly, lw, lh);
    this.blood.renderDecals(ctx, vx0, vy0, vx1, vy1);

    for (const n of this.npcs) if (!n.alive) n.render(ctx);
    for (const n of this.npcs) if (n.alive) n.render(ctx);
    this.player.tentacle.render(ctx);
    this.player.render(ctx);
    for (const s of this.spikes) s.render(ctx);
    this.renderLaser(ctx);
    this.blood.renderDrops(ctx);
    this.fx.render(ctx);
    for (const n of this.npcs) n.renderBubble(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderHUD(ctx);
  }

  renderLaser(ctx) {
    const l = this.laser;
    if (!l) return;
    const flick = rand(0.8, 1.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const pass = (w, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = w * flick;
      ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x1, l.y1); ctx.stroke();
    };
    pass(18, 'rgba(255,40,90,0.12)');
    pass(9, 'rgba(255,60,120,0.35)');
    pass(4, 'rgba(255,150,190,0.9)');
    pass(1.6, 'rgba(255,255,255,1)');
    for (const [x, y, r] of [[l.x0, l.y0, 14], [l.x1, l.y1, l.hit ? 22 : 0]]) {
      if (!r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * flick);
      g.addColorStop(0, 'rgba(255,230,240,0.9)'); g.addColorStop(1, 'rgba(255,40,100,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    }
    ctx.restore();
  }

  renderHUD(ctx) {
    const W = this.canvas.width, H = this.canvas.height;
    const s = Math.max(0.75, Math.min(1.6, H / 800));
    ctx.save();
    ctx.scale(s, s);
    const w = W / s, h = H / s;
    ctx.font = 'bold 14px "Trebuchet MS", Verdana, sans-serif';
    ctx.textBaseline = 'middle';

    // Objectives.
    ctx.fillStyle = 'rgba(12,20,38,0.78)';
    ctx.beginPath(); ctx.roundRect(14, 14, 400, 30 + this.objectives.length * 24, 8); ctx.fill();
    ctx.fillStyle = '#9fc2ff'; ctx.fillText('TEST CHAMBER 00  ·  OBJECTIVES', 26, 30);
    this.objectives.forEach((o, i) => {
      const y = 54 + i * 24;
      ctx.strokeStyle = o.done ? '#7dff9a' : '#c9d6ee'; ctx.lineWidth = 2;
      ctx.strokeRect(26, y - 7, 14, 14);
      if (o.done) {
        ctx.beginPath(); ctx.moveTo(29, y); ctx.lineTo(32, y + 4); ctx.lineTo(38, y - 5); ctx.stroke();
      }
      ctx.fillStyle = o.done ? '#7dff9a' : '#ffffff';
      ctx.fillText(o.text, 48, y);
    });

    // Weapons.
    const pl = this.player;
    WEAPONS.forEach((name, i) => {
      const x = 14 + i * 190, y = h - 58;
      ctx.fillStyle = pl.weapon === i ? 'rgba(47,95,191,0.92)' : 'rgba(12,20,38,0.7)';
      ctx.beginPath(); ctx.roundRect(x, y, 180, 44, 8); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${i + 1}  ${name}`, x + 12, y + 15);
      if (i === 0) {
        const r = clamp(1 - pl.cool / 0.42, 0, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x + 12, y + 29, 156, 6);
        ctx.fillStyle = '#d7dce4'; ctx.fillRect(x + 12, y + 29, 156 * r, 6);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x + 12, y + 29, 156, 6);
        ctx.fillStyle = pl.overheat ? '#ff3b2f' : `hsl(${lerp(190, 10, pl.heat)},100%,60%)`;
        ctx.fillRect(x + 12, y + 29, 156 * pl.heat, 6);
      }
    });
    ctx.fillStyle = 'rgba(12,20,38,0.7)';
    ctx.beginPath(); ctx.roundRect(394, h - 58, 180, 44, 8); ctx.fill();
    ctx.fillStyle = '#ffb3b8'; ctx.fillText('RMB  TENTACLE', 406, h - 43);
    ctx.fillStyle = '#c9d6ee'; ctx.font = '12px "Trebuchet MS", Verdana, sans-serif';
    ctx.fillText(pl.tentacle.state === 'attached' ? (pl.tentacle.npc ? 'holding body' : 'latched') : 'ready', 406, h - 25);
    if (this.timeScale < 1) { ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 14px "Trebuchet MS", Verdana, sans-serif'; ctx.fillText('SLOW-MO', 590, h - 36); }

    // Messages.
    ctx.font = 'bold 18px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    this.messages.forEach((m, i) => {
      ctx.globalAlpha = clamp(m.t, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(m.text, w / 2 + 2, 70 + i * 28 + 2);
      ctx.fillStyle = m.color; ctx.fillText(m.text, w / 2, 70 + i * 28);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    // Help.
    ctx.font = '13px "Trebuchet MS", Verdana, sans-serif';
    if (this.showHelp) {
      const lines = [
        ['A / D', 'move'], ['W / Space', 'jump (also: leap off tentacle)'],
        ['Mouse', 'aim'], ['LMB', 'fire weapon'], ['RMB (hold)', 'tentacle: latch + reel in / grab bodies'],
        ['1 / 2 / Q / wheel', 'harpoon / laser'], ['F', 'slow motion'], ['G / T', 'spawn dummy / scientist at cursor'],
        ['X', 'clear harpoons'], ['R', 'reset chamber'], ['H', 'hide this help'],
      ];
      const bw = 400, bh = 26 + lines.length * 19;
      const x = w - bw - 14, y = 14;
      ctx.fillStyle = 'rgba(12,20,38,0.78)';
      ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 8); ctx.fill();
      lines.forEach(([k, v], i) => {
        ctx.fillStyle = '#9fc2ff'; ctx.fillText(k, x + 12, y + 20 + i * 19);
        ctx.fillStyle = '#ffffff'; ctx.fillText(v, x + 140, y + 20 + i * 19);
      });
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('H: help', w - 70, 24);
    }
    ctx.restore();

    // Crosshair.
    const mx = Input.mouse.x, my = Input.mouse.y;
    const col = pl.weapon === 0 ? '#ffffff' : '#ff5c8a';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4;
    this.crosshair(ctx, mx, my);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    this.crosshair(ctx, mx, my);
  }

  crosshair(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.moveTo(x - 16, y); ctx.lineTo(x - 11, y);
    ctx.moveTo(x + 11, y); ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 11);
    ctx.moveTo(x, y + 11); ctx.lineTo(x, y + 16);
    ctx.stroke();
  }
}
