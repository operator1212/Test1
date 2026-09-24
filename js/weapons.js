// Projectiles and powers: harpoon spikes, the flesh tentacle, bullets/pellets,
// bouncing saw blades and bile bombs. The laser beam lives in game.js.
'use strict';

const HARPOON_SPEED = 1650;
const TENTACLE_SPEED = 2100;
const TENTACLE_RANGE = 620;
const LASER_RANGE = 1100;

const SPIKE_DARK = hexc('#2a2e35'), SPIKE_LIGHT = hexc('#8e98a6'), SPIKE_TIP = hexc('#e6ebf2');
const TENT_OUT = hexc('#22030a'), TENT_MID = hexc('#7a1426'), TENT_HI = hexc('#c9495c'), TENT_CLAW = hexc('#efe3cf');
const BULLET_C = hexc('#ffe7a0'), PELLET_C = hexc('#ffd27a');
const SAW_DARK = hexc('#3a4048'), SAW_MID = hexc('#9aa4b2'), SAW_HI = hexc('#e8edf4');
const BILE_C = hexc('#8fe03a'), BILE_D = hexc('#3f7a14'), BILE_PX = ['#7fd13b', '#9be84f', '#5fa82a'].map((c) => hexc(c));

// ------------------------------------------------------------------ harpoon
class Spike {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.ang = Math.atan2(vy, vx);
    this.state = 'fly';          // fly | stuck | lodged | dead
    this.carried = [];
    this.rags = new Set();
    this.age = 0;
    this.normal = null;
    this.host = null;            // particle a lodged spike rides on
  }

  update(dt, game) {
    this.age += dt;
    if (this.state === 'lodged') {
      const h = this.host;
      if (!h.rag || !h.rag.parts.includes(h)) { this.state = 'dead'; return; }
      this.x = h.x + this.ox; this.y = h.y + this.oy;
      return;
    }
    if (this.state !== 'fly') return;
    const carrying = this.carried.length > 0;
    // A body on the shaft is heavy: gravity and drag bleed off the speed.
    this.vy += (carrying ? 1100 : 380) * dt;
    if (carrying) { const k = Math.exp(-dt * 4); this.vx *= k; this.vy *= k; }
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (carrying && sp < 520) { this.lodge(); return; }
    const dx = this.vx / sp, dy = this.vy / sp;
    this.ang = Math.atan2(dy, dx);
    let rem = sp * dt;
    while (rem > 0) {
      const st = Math.min(8, rem); rem -= st;
      const nx = this.x + dx * st, ny = this.y + dy * st;
      if (game.map.solidPx(nx, ny)) { this.embed(game, dx, dy); return; }
      if (this.carried.length < 3) {
        const h = game.hitPieces(this.x, this.y, nx, ny, this.rags, 0);
        if (h) this.impale(game, h, dx, dy);
      }
      this.x = nx; this.y = ny;
      if (this.x < -50 || this.y < -50 || this.x > game.map.pw + 50 || this.y > game.map.ph + 50) { this.state = 'dead'; return; }
    }
    this.placeCarried(dx, dy);
  }

  impale(game, h, dx, dy) {
    const p = h.particle;
    if (p.pin || p.held) return;
    p.held = true;
    this.carried.push(p);
    this.rags.add(p.rag);
    // Momentum is shared with the body: a whole person soaks up a lot of it.
    const k = this.carried.length === 1 ? 0.5 : 0.75;
    this.vx *= k; this.vy *= k;
    if (h.npc.main.has(p)) h.npc.onImpaled(p, dx, dy, h.piece, h.idx);
    game.blood.spray(p.x, p.y, dx, dy, 22, 480, 0.35);
    game.blood.spray(p.x, p.y, -dx, -dy, 10, 220, 0.6);
    game.shake(1.5);
    Sfx.squelch();
  }

  placeCarried(dx, dy) {
    for (let i = 0; i < this.carried.length; i++) {
      const p = this.carried[i];
      const x = this.x - dx * (12 + i * 11), y = this.y - dy * (12 + i * 11);
      p.x = x; p.y = y;
      p.px = x - this.vx * DT; p.py = y - this.vy * DT;
    }
  }

  // Too slow to reach a wall: the spike stays stuck in the body.
  lodge() {
    const host = this.carried[0];
    for (const p of this.carried) {
      p.held = false;
      p.px = p.x - (p.x - p.px) * 0.5; p.py = p.y - (p.y - p.py) * 0.5;
    }
    this.carried = [];
    this.state = 'lodged';
    this.host = host;
    this.ox = this.x - host.x; this.oy = this.y - host.y;
  }

  embed(game, dx, dy) {
    const m = game.map;
    let sx = this.x, sy = this.y;
    for (let k = 0; k < 10 && !m.solidPx(sx + dx, sy + dy); k++) { sx += dx; sy += dy; }
    const t0x = Math.floor(sx / TILE), t1x = Math.floor((sx + dx * 2) / TILE);
    this.normal = t0x !== t1x ? { x: -sign(dx), y: 0 } : { x: 0, y: -sign(dy) };
    this.x = sx + dx * 14; this.y = sy + dy * 14;
    this.state = 'stuck';
    for (let i = 0; i < this.carried.length; i++) {
      const p = this.carried[i];
      p.held = false;
      p.pin = { x: sx - dx * (5 + i * 11), y: sy - dy * (5 + i * 11) };
      p.x = p.px = p.pin.x; p.y = p.py = p.pin.y;
    }
    Sfx.thunk();
    game.shake(this.carried.length ? 2 : 1);
    game.fx.sparks(sx, sy, -dx, -dy, 8, 380);
    game.onSpikeStuck(this);
  }

  release() {
    for (const p of this.carried) { p.pin = null; p.held = false; }
    this.carried = [];
  }

  render(fb) {
    const dx = Math.cos(this.ang), dy = Math.sin(this.ang);
    const tx = this.x / PX, ty = this.y / PX;
    const bx = tx - dx * 17, by = ty - dy * 17;
    const nx = -dy, ny = dx;
    fb.line(bx + nx * 0.6, by + ny * 0.6, tx - dx * 3 + nx * 0.6, ty - dy * 3 + ny * 0.6, SPIKE_DARK);
    fb.line(bx, by, tx - dx * 3, ty - dy * 3, SPIKE_LIGHT);
    fb.line(tx - dx * 3, ty - dy * 3, tx, ty, SPIKE_TIP);
    fb.put(tx - dx * 3 + nx * 1.6, ty - dy * 3 + ny * 1.6, SPIKE_TIP);
    fb.put(tx - dx * 3 - nx * 1.6, ty - dy * 3 - ny * 1.6, SPIKE_TIP);
    fb.put(bx + nx * 1.2, by + ny * 1.2, SPIKE_DARK);
    fb.put(bx - nx * 1.2, by - ny * 1.2, SPIKE_DARK);
  }
}

// ------------------------------------------------------------------ tentacle
// Latch onto terrain to zip/swing, or grab a body and whip it around: the
// held part follows the cursor, so you can swing, slam and throw people.
class Tentacle {
  constructor(player) {
    this.pl = player;
    this.state = 'idle';         // idle | out | attached | retract
    this.tip = { x: 0, y: 0 };
    this.dir = { x: 1, y: 0 };
    this.anchor = null;          // fixed world point
    this.target = null;          // particle
    this.npc = null;
    this.len = 0;
    this.t = 0;
  }

  origin() { return this.pl.shoulder(); }
  attached() { return this.state === 'attached'; }
  attachedFixed() { return this.state === 'attached' && (this.anchor || (this.target && this.target.pin)); }
  holding() { return this.state === 'attached' && this.target && !this.target.pin; }
  point() { return this.anchor || this.target; }

  fire(dx, dy) {
    if (this.state !== 'idle') return;
    const o = this.origin();
    this.tip = { x: o.x, y: o.y };
    this.dir = { x: dx, y: dy };
    this.state = 'out';
    Sfx.whip();
  }

  release(throwIt) {
    if (this.npc) { this.npc.grabbed = false; this.npc.knock(1.2); }
    if (throwIt && this.target && !this.target.pin) {
      // A flick on release: exaggerate the current swing velocity.
      const p = this.target;
      p.impulse(p.vx * 0.35, p.vy * 0.35);
    }
    this.npc = null; this.target = null; this.anchor = null;
    if (this.state !== 'idle') this.state = 'retract';
  }

  update(dt, game) {
    this.t += dt;
    const o = this.origin();
    if (this.target && (!this.target.rag || !this.target.rag.parts.includes(this.target))) this.release(false);
    if (this.state === 'out') {
      if (!Input.mouse.down[2]) { this.state = 'retract'; return; }
      const step = TENTACLE_SPEED * dt;
      const d = this.dir;
      const ray = game.map.raycast(this.tip.x, this.tip.y, d.x, d.y, step);
      const h = game.hitPieces(this.tip.x, this.tip.y, ray.x, ray.y, null, 7);
      if (h) {
        this.target = h.particle;
        this.npc = h.npc.main.has(h.particle) ? h.npc : null;
        if (this.npc) { this.npc.grabbed = true; this.npc.knock(1); }
        this.state = 'attached';
        this.len = dist(o.x, o.y, this.target.x, this.target.y);
        game.blood.spray(h.particle.x, h.particle.y, -d.x, -d.y, 8, 200, 0.8);
        Sfx.latch();
      } else if (ray.hit) {
        this.anchor = { x: ray.x - d.x, y: ray.y - d.y };
        this.state = 'attached';
        this.len = dist(o.x, o.y, this.anchor.x, this.anchor.y);
        game.fx.sparks(ray.x, ray.y, ray.nx, ray.ny, 4, 200, '#ff9aa0');
        Sfx.latch();
      } else {
        this.tip.x = ray.x; this.tip.y = ray.y;
        if (dist(o.x, o.y, this.tip.x, this.tip.y) > TENTACLE_RANGE) this.state = 'retract';
      }
    } else if (this.state === 'attached') {
      if (!Input.mouse.down[2]) { this.release(true); return; }
      if (this.anchor || this.target.pin) this.len = Math.max(28, this.len - 1100 * dt);
      else this.len = Math.max(95, this.len - 1500 * dt);
      const p = this.point();
      this.tip.x = p.x; this.tip.y = p.y;
      if (this.npc) { this.npc.grabbed = true; this.npc.stun = Math.max(this.npc.stun, 1); }
    } else if (this.state === 'retract') {
      const d = dist(this.tip.x, this.tip.y, o.x, o.y);
      const step = 2800 * dt;
      if (d <= step) { this.state = 'idle'; return; }
      this.tip.x += (o.x - this.tip.x) / d * step;
      this.tip.y += (o.y - this.tip.y) / d * step;
    }
  }

  // Terrain/pinned: a reeling rope that yanks you in. Held body: a stiff
  // spring pulling the grabbed part toward the cursor at arm's length.
  applyRope(game) {
    if (this.state !== 'attached') return;
    const pl = this.pl;
    const o = this.origin();
    if (this.holding()) {
      const m = game.mouseWorld();
      const md = dist(o.x, o.y, m.x, m.y) || 1;
      const reach = Math.min(this.len, Math.max(40, md));
      const tx = o.x + (m.x - o.x) / md * reach, ty = o.y + (m.y - o.y) / md * reach;
      const p = this.target;
      let dx = (tx - p.x) * 0.3, dy = (ty - p.y) * 0.3;
      const dl = Math.hypot(dx, dy);
      if (dl > 22) { dx *= 22 / dl; dy *= 22 / dl; }
      p.x += dx; p.y += dy;
      return;
    }
    const a = this.point();
    const d = dist(o.x, o.y, a.x, a.y);
    if (d < 1e-3) return;
    const nx = (a.x - o.x) / d, ny = (a.y - o.y) / d;
    // Zip: keep at least some speed toward the anchor while reeling.
    const toward = pl.vx * nx + pl.vy * ny;
    if (d > 60 && toward < 520) { pl.vx += nx * (520 - toward) * 0.2; pl.vy += ny * (520 - toward) * 0.2; }
    if (d <= this.len) return;
    const excess = d - this.len;
    pl.moveBy(nx * excess, ny * excess);
    const vr = pl.vx * nx + pl.vy * ny;       // negative = moving away from anchor
    if (vr < 0) { pl.vx -= nx * vr; pl.vy -= ny * vr; }
  }

  // E while holding: rip the grabbed part off, or devour a loose part/corpse.
  useE(game) {
    if (!this.holding() && !(this.state === 'attached' && this.target && this.target.pin)) return false;
    const p = this.target, rag = p.rag;
    const npc = rag.npc;
    const living = npc && npc.alive && npc.main.has(p);
    const d = dist(p.x, p.y, this.pl.x, this.pl.y - 60);
    if (living || d > 130) {
      // Rip: tear the piece that hangs off this particle.
      const piece = rag.pieces.find((q) => q.b === p) || rag.pieces.find((q) => q.a === p);
      if (!piece) return false;
      rag.tear(piece);
      if (npc && npc.alive) { npc.damage(20, 'rip'); npc.say('AAAAAAAAH!', 1.2); }
      game.shake(2);
      return true;
    }
    // Devour everything connected to the held part.
    const island = rag.component(p);
    let eaten = 0;
    rag.pieces = rag.pieces.filter((q) => {
      if (!island.has(q.a)) return true;
      eaten += q.count;
      const F = q.frame();
      for (let k = 0; k < 6; k++) {
        const idx = randi(0, q.col.length - 1);
        if (q.col[idx]) { const [x, y] = q.cellWorld(idx, F); game.blood.spawn(x, y, rand(-200, 200), rand(-300, 0), 2.5, q.col[idx]); }
      }
      return false;
    });
    for (const s of game.spikes) if (s.state === 'lodged' && island.has(s.host)) s.state = 'dead';
    for (const q of island) { q.pin = null; q.held = false; }
    rag.refreshTopology('eaten', p.x, p.y);
    game.blood.burst(p.x, p.y, 40, 350);
    const heal = Math.min(45, Math.round(eaten / 12));
    this.pl.heal(heal);
    game.fx.text(p.x, p.y - 20, '+' + heal + ' DEVOURED', '#9dff7a');
    Sfx.squelch(); Sfx.rip();
    this.release(false);
    return true;
  }

  render(fb) {
    if (this.state === 'idle') return;
    const o = this.origin();
    const tx = this.tip.x, ty = this.tip.y;
    const d = dist(o.x, o.y, tx, ty) || 1;
    const ux = (tx - o.x) / d, uy = (ty - o.y) / d;
    const nx = -uy, ny = ux;
    const N = Math.max(4, Math.ceil(d / PX));
    const amp = this.state === 'attached' ? 0.6 : 3;
    const slack = this.state === 'attached' && !this.holding() ? Math.max(0, this.len - d) : 0;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, env = Math.sin(Math.PI * f);
      const w = Math.sin(f * 14 - this.t * 22) * amp * env * PX;
      pts.push([(o.x + ux * d * f + nx * w) / PX, (o.y + uy * d * f + ny * w + slack * 0.6 * env) / PX]);
    }
    for (let i = 0; i <= N; i++) fb.disc(pts[i][0], pts[i][1], lerp(2.2, 1.3, i / N), TENT_OUT);
    for (let i = 0; i <= N; i++) fb.disc(pts[i][0], pts[i][1], lerp(1.3, 0.7, i / N), TENT_MID);
    for (let i = 0; i < N; i += 3) fb.put(pts[i][0] - 0.5, pts[i][1] - 0.5, TENT_HI);
    const [ex, ey] = pts[N];
    for (const sg of [-1, 1]) {
      fb.put(ex + ux * 1 + nx * sg * 1.5, ey + uy * 1 + ny * sg * 1.5, TENT_CLAW);
      fb.put(ex + ux * 2 + nx * sg * 1, ey + uy * 2 + ny * sg * 1, TENT_CLAW);
    }
  }
}

// ------------------------------------------------------------------ bullets
// Used by soldiers (at you) and the shotgun (pellets). Each one punches a
// small hole through the pixels it hits.
class Bullet {
  constructor(x, y, vx, vy, from, dmg, cause, shooter) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.from = from; this.dmg = dmg; this.cause = cause;
    this.exclude = shooter ? new Set([shooter]) : null;
    this.life = 1.2;
    this.state = 'fly';
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.state = 'dead'; return; }
    this.vy += 200 * dt;
    const sp = Math.hypot(this.vx, this.vy);
    const dx = this.vx / sp, dy = this.vy / sp;
    let rem = sp * dt;
    while (rem > 0) {
      const st = Math.min(6, rem); rem -= st;
      const nx = this.x + dx * st, ny = this.y + dy * st;
      if (game.map.solidPx(nx, ny)) {
        game.fx.sparks(this.x, this.y, -dx, -dy, 3, 250);
        game.blood.scorch(nx, ny);
        this.state = 'dead';
        return;
      }
      if (this.from === 'npc' && game.player.hitTest(nx, ny)) {
        game.player.hurt(this.dmg, dx, dy, nx, ny);
        this.state = 'dead';
        return;
      }
      const h = game.hitPieces(this.x, this.y, nx, ny, this.exclude, 0);
      if (h) {
        game.woundAt(h, { radius: 1.1, drill: 2.2, dx, dy, dmg: this.dmg, cause: this.cause, push: 170, stun: 0.6 });
        this.state = 'dead';
        return;
      }
      this.x = nx; this.y = ny;
    }
  }

  render(fb) {
    const x = this.x / PX, y = this.y / PX;
    fb.line(x, y, x - this.vx * 0.008, y - this.vy * 0.008, this.from === 'npc' ? BULLET_C : PELLET_C);
  }
}

// ------------------------------------------------------------------ saw blade
// Spinning disc that ricochets around and cuts through every pixel it touches.
class Saw {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.bounces = 5;
    this.state = 'fly';          // fly | stuck | dead
    this.spin = 0;
    this.life = 5;
    this.r = 3.3;                // cutting radius in art px
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.state = 'dead'; return; }
    if (this.state !== 'fly') return;
    this.spin += dt * 40;
    this.vy += 260 * dt;
    const sp = Math.hypot(this.vx, this.vy);
    const n = Math.max(1, Math.ceil(sp * dt / 5));
    const m = game.map;
    for (let k = 0; k < n; k++) {
      const nx = this.x + this.vx * dt / n, ny = this.y + this.vy * dt / n;
      if (m.solidPx(nx, ny)) {
        const hx = m.solidPx(nx, this.y), hy = m.solidPx(this.x, ny);
        if (hx || !hy) this.vx = -this.vx * 0.88;
        if (hy || !hx) this.vy = -this.vy * 0.88;
        this.bounces--;
        game.fx.sparks(this.x, this.y, -Math.sign(this.vx), -Math.sign(this.vy), 6, 320);
        Sfx.clang();
        if (this.bounces < 0 || Math.hypot(this.vx, this.vy) < 250) {
          // Bury itself in the wall.
          this.x = nx; this.y = ny;
          this.state = 'stuck'; this.life = 6;
          return;
        }
        continue;
      }
      this.x = nx; this.y = ny;
    }
    // Cut everything we overlap.
    let cutting = false;
    for (const npc of game.npcs) {
      const rag = npc.rag;
      for (const q of rag.pieces.slice()) {
        if (!rag.pieces.includes(q)) continue;
        if (dist(this.x, this.y, q.bc.x, q.bc.y) > q.bc.r + this.r * PX) continue;
        const [gi, gj] = q.toGrid(this.x, this.y, q.frame());
        if (gi < -this.r || gj < -this.r || gi > q.w + this.r || gj > q.h + this.r) continue;
        const living = npc.alive && npc.main.has(q.a);
        rag.zoneHits = 0;
        const removed = rag.burn(q, gi, gj, this.r, 1, 0.2);
        if (!removed) continue;
        cutting = true;
        if (living) {
          npc.addBleed(removed);
          npc.damage(removed * 1.2, 'saw');
          npc.knock(1);
          npc.applyZones(rag.zoneHits, 'saw', this.x, this.y);
        }
        game.blood.spray(this.x, this.y, -this.vy, this.vx, removed * 2, 380, 0.5);
      }
    }
    if (cutting) { this.vx *= 0.97; this.vy *= 0.97; if (Math.random() < 0.3) Sfx.grind(); }
  }

  render(fb) {
    const x = this.x / PX, y = this.y / PX;
    fb.disc(x, y, 3.2, SAW_DARK);
    fb.disc(x, y, 2.4, SAW_MID);
    fb.put(x, y, SAW_DARK);
    for (let k = 0; k < 8; k++) {
      const a = this.spin + k * TAU / 8;
      fb.put(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6, SAW_HI);
    }
  }
}

// ------------------------------------------------------------------ bile bomb
// Lobbed acid sac: bounces, then bursts, blowing chunks off anything nearby.
class Bomb {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.fuse = 1.3;
    this.state = 'fly';
    this.t = 0;
  }

  update(dt, game) {
    this.t += dt;
    this.fuse -= dt;
    if (this.fuse <= 0) { this.explode(game); return; }
    this.vy += 1300 * dt;
    const m = game.map;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    if (m.solidPx(nx, this.y)) this.vx = -this.vx * 0.45; else this.x = nx;
    if (m.solidPx(this.x, ny)) { this.vy = -this.vy * 0.45; this.vx *= 0.8; } else this.y = ny;
    if (this.t > 0.08 && game.hitPieces(this.x - this.vx * dt, this.y - this.vy * dt, this.x, this.y, null, 6)) this.explode(game);
  }

  explode(game) {
    this.state = 'dead';
    game.explosion(this.x, this.y, 95);
  }

  render(fb) {
    const x = this.x / PX, y = this.y / PX;
    const pulse = Math.sin(this.t * 30) > 0;
    fb.disc(x, y, 2.4, BILE_D);
    fb.disc(x, y, 1.6, pulse ? BILE_C : BILE_D);
    fb.put(x - 0.8, y - 0.8, hexc('#e6ffb0'));
  }
}
