// Keyboard + mouse state. "pressed" flags are cleared after each physics step
// so a single press is consumed exactly once.
'use strict';

const Input = {
  keys: Object.create(null),
  pressed: Object.create(null),
  mouse: { x: 0, y: 0, down: [false, false, false], pressed: [false, false, false], released: [false, false, false] },
  wheel: 0,
  canvas: null,

  init(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.mouse.down = [false, false, false];
    });
    canvas.addEventListener('mousemove', (e) => this._move(e));
    canvas.addEventListener('mousedown', (e) => {
      this._move(e);
      if (e.button > 2) return;
      this.mouse.down[e.button] = true;
      this.mouse.pressed[e.button] = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.mouse.down[e.button] = false;
      this.mouse.released[e.button] = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  },

  _move(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = (e.clientX - r.left) * (this.canvas.width / r.width);
    this.mouse.y = (e.clientY - r.top) * (this.canvas.height / r.height);
  },

  down(code) { return !!this.keys[code]; },
  hit(code) { return !!this.pressed[code]; },

  endStep() {
    this.pressed = Object.create(null);
    this.mouse.pressed = [false, false, false];
    this.mouse.released = [false, false, false];
    this.wheel = 0;
  },
};
