// Small math helpers shared by every module.
'use strict';

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sign(v) { return v < 0 ? -1 : 1; }
function dist(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
function dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

// Closest point on segment AB to P. Returns { t, x, y, d2 }.
function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { t, x, y, d2: dist2(px, py, x, y) };
}

// Closest points between segments P1P2 and Q1Q2 (Ericson, RTCD 5.1.9).
// Returns { s, t, d2 } where s is the parameter on P and t on Q.
function segSegClosest(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y) {
  const d1x = p2x - p1x, d1y = p2y - p1y;
  const d2x = q2x - q1x, d2y = q2y - q1y;
  const rx = p1x - q1x, ry = p1y - q1y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-9;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const cx1 = p1x + d1x * s, cy1 = p1y + d1y * s;
  const cx2 = q1x + d2x * t, cy2 = q1y + d2y * t;
  return { s, t, d2: dist2(cx1, cy1, cx2, cy2) };
}
