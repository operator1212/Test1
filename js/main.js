// Boot: canvas sizing, title card, fixed-timestep loop.
'use strict';

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  Input.init(canvas);

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor((r.width || window.innerWidth) * dpr));
    canvas.height = Math.max(1, Math.floor((r.height || window.innerHeight) * dpr));
    if (game) game.resize();
  }
  let game = null;
  size();
  game = new Game(canvas);
  window.addEventListener('resize', size);
  window.game = game;   // handy for poking at things from the console

  let started = false;
  const title = document.getElementById('title');
  const begin = () => {
    if (started) return;
    started = true;
    Sfx.init();
    title.style.display = 'none';
    Input.endStep();
  };
  title.addEventListener('mousedown', (e) => { e.preventDefault(); begin(); });
  window.addEventListener('keydown', () => begin());

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (started) {
      if (Input.hit('KeyR')) {
        Sfx.laserOn(false);
        game = new Game(canvas);
        window.game = game;
        Input.endStep();
      }
      acc += real * game.timeScale;
      let steps = 0;
      while (acc >= DT && steps < 10) {
        game.step(DT);
        Input.endStep();
        acc -= DT;
        steps++;
      }
      if (steps >= 10) acc = 0;
    }
    game.render(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
