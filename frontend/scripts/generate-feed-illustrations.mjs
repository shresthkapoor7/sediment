// Generates the decorative topic illustrations in public/feed-illustrations.
// Every file shares one 360x200 (9:5) canvas with a 16px safe margin, one stroke weight,
// and the same three tones (solid, .4 secondary, .14 grid) so the set reads as one family.
// Run: node scripts/generate-feed-illustrations.mjs
import fs from "node:fs";

const OUT = new URL("../public/feed-illustrations/", import.meta.url).pathname;
const W = 360, H = 200;
const RAD = Math.PI / 180;

// ---------- helpers ----------
const fmt = n => String(Math.round(n * 10) / 10);
const cls = c => (c ? ` class="${c}"` : "");
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
const xy = p => `${fmt(p[0])} ${fmt(p[1])}`;
const ln = (x1, y1, x2, y2, c) => `<path${cls(c)} d="M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}"/>`;
const pl = (pts, c, close) => `<path${cls(c)} d="M${pts.map(xy).join("L")}${close ? "Z" : ""}"/>`;
const circ = (x, y, r, c, extra = "") => `<circle${cls(c)} cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}"${extra}/>`;
const dot = (x, y, r = 2.4, c = "f") => circ(x, y, r, c);
const rect = (x, y, w, h, r = 3, c, extra = "") => `<rect${cls(c)} x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${r}"${extra}/>`;
const ell = (cx, cy, rx, ry, rot = 0, c) => `<ellipse${cls(c)} cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"${rot ? ` transform="rotate(${rot} ${fmt(cx)} ${fmt(cy)})"` : ""}/>`;
const raw = (d, c) => `<path${cls(c)} d="${d}"/>`;
const plot = (fn, t0, t1, n, c) => pl(Array.from({ length: n + 1 }, (_, i) => fn(t0 + ((t1 - t0) * i) / n)), c);

function smooth(pts, closed = false, c) {
  const n = pts.length;
  const g = i => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${xy(pts[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    d += `C${fmt(p1[0] + (p2[0] - p0[0]) / 6)} ${fmt(p1[1] + (p2[1] - p0[1]) / 6)} ${fmt(p2[0] - (p3[0] - p1[0]) / 6)} ${fmt(p2[1] - (p3[1] - p1[1]) / 6)} ${xy(p2)}`;
  }
  return raw(d + (closed ? "Z" : ""), c);
}
const head = (x, y, ang, s = 7, c) => {
  const a = [x - s * Math.cos(ang - 0.45), y - s * Math.sin(ang - 0.45)], b = [x - s * Math.cos(ang + 0.45), y - s * Math.sin(ang + 0.45)];
  return raw(`M${xy(a)}L${fmt(x)} ${fmt(y)}L${xy(b)}`, c);
};
const arrow = (x1, y1, x2, y2, c, s = 7) => ln(x1, y1, x2, y2, c) + head(x2, y2, Math.atan2(y2 - y1, x2 - x1), s, c);
const edge = (a, b, ra = 0, rb = 0, c) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  return ln(a[0] + ux * ra, a[1] + uy * ra, b[0] - ux * rb, b[1] - uy * rb, c);
};
// two parallel rails between joints: reads as a mechanical link
const bar = (a, b, ra, rb, w = 4) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d, ux = -ny, uy = nx;
  return [-w, w].map(o => ln(a[0] + ux * ra + nx * o, a[1] + uy * ra + ny * o, b[0] - ux * rb + nx * o, b[1] - uy * rb + ny * o)).join("");
};
const axes = (x0, y0, x1, y1, c = "m") => arrow(x0, y0, x1, y0, c, 6) + arrow(x0, y0, x0, y1, c, 6);

// Marching squares -> chained polylines (one path per level).
function contour(field, x0, y0, x1, y1, nx, ny, level, skip) {
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const v = Array.from({ length: ny + 1 }, (_, j) => Array.from({ length: nx + 1 }, (_, i) => field(x0 + i * dx, y0 + j * dy)));
  const pts = new Map();
  const hE = (i, j) => { const k = `h${i},${j}`; if (!pts.has(k)) { const a = v[j][i], b = v[j][i + 1], t = (level - a) / (b - a); pts.set(k, [x0 + (i + t) * dx, y0 + j * dy]); } return k; };
  const vE = (i, j) => { const k = `v${i},${j}`; if (!pts.has(k)) { const a = v[j][i], b = v[j + 1][i], t = (level - a) / (b - a); pts.set(k, [x0 + i * dx, y0 + (j + t) * dy]); } return k; };
  const adj = new Map(), add = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const idx = (v[j][i] > level ? 8 : 0) | (v[j][i + 1] > level ? 4 : 0) | (v[j + 1][i + 1] > level ? 2 : 0) | (v[j + 1][i] > level ? 1 : 0);
    const T = () => hE(i, j), R = () => vE(i + 1, j), B = () => hE(i, j + 1), L = () => vE(i, j);
    const segs = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]], 8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] }[idx] || [];
    for (const [a, b] of segs) { const ka = a(), kb = b(); if (skip && (skip(pts.get(ka)) || skip(pts.get(kb)))) continue; add(ka, kb); }
  }
  const used = new Set(), ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const paths = [];
  const walk = start => {
    const line = [start]; let cur = start;
    for (;;) { const nxt = (adj.get(cur) || []).find(n => !used.has(ek(cur, n))); if (!nxt) break; used.add(ek(cur, nxt)); line.push(nxt); cur = nxt; }
    if (line.length > 1) paths.push(line.map(k => pts.get(k)));
  };
  for (const [k, n] of adj) if (n.length === 1) walk(k);
  for (const k of adj.keys()) walk(k);
  return paths;
}

// ---------- the illustrations ----------
const A = {};

// -- machine learning
A["neural-networks"] = () => {
  const L = [3, 5, 5, 3], xs = [60, 140, 220, 300], N = L.map((n, l) => Array.from({ length: n }, (_, i) => [xs[l], 100 + (i - (n - 1) / 2) * 34]));
  const o = [];
  for (let l = 0; l < 3; l++) for (const a of N[l]) for (const b of N[l + 1]) o.push(edge(a, b, 7, 7, "m"));
  const path = [N[0][1], N[1][3], N[2][1], N[3][2]];
  for (let i = 0; i < 3; i++) o.push(edge(path[i], path[i + 1], 7, 7));
  for (const col of N) for (const p of col) o.push(circ(p[0], p[1], 7));
  for (const p of path) o.push(dot(p[0], p[1], 2.6));
  return o;
};
A["attention"] = () => {
  const r = rng(7), n = 8, step = 21, x0 = 124, y0 = 17, o = [];
  for (let i = 0; i < n; i++) {
    const w = 12 + Math.floor(r() * 22);
    o.push(ln(x0 - 14 - w, y0 + i * step + 9, x0 - 14, y0 + i * step + 9));
    for (let j = 0; j < n; j++) {
      o.push(rect(x0 + j * step, y0 + i * step, 19, 19, 3, "m"));
      if (j <= i) { const v = Math.min(1, 0.12 + (0.55 + r()) * Math.exp(-(i - j) / 2.4) * (i === j ? 1.1 : 0.7) + (r() > 0.86 ? 0.35 : 0)); o.push(rect(x0 + j * step, y0 + i * step, 19, 19, 3, "f", ` fill-opacity="${(v * 0.8).toFixed(2)}"`)); }
    }
  }
  return o;
};
A["latent-space"] = () => {
  const r = rng(11), o = [axes(36, 172, 332, 22)], clamp = (p) => [Math.max(46, Math.min(322, p[0])), Math.max(32, Math.min(164, p[1]))];
  o.push(smooth([[180, 24], [168, 72], [186, 122], [176, 170]], false, "m d"));
  for (let i = 0; i < 28; i++) { const p = clamp([112 + gauss(r) * 24, 118 + gauss(r) * 20]); o.push(dot(p[0], p[1], 2.8)); }
  for (let i = 0; i < 28; i++) { const p = clamp([248 + gauss(r) * 24, 84 + gauss(r) * 22]); o.push(circ(p[0], p[1], 2.8)); }
  return o;
};

// -- language
A["language"] = () => {
  const ws = [38, 26, 46, 30, 50, 34], gap = 14, total = ws.reduce((a, b) => a + b, 0) + gap * 5, o = [];
  let x = (W - total) / 2; const cx = [];
  ws.forEach(w => { o.push(rect(x, 126, w, 22, 5)); o.push(ln(x + w / 2 - 8, 160, x + w / 2 + 8, 160, "m")); cx.push(x + w / 2); x += w + gap; });
  for (const [a, b, h] of [[2, 1, 34], [1, 0, 30], [2, 4, 74], [4, 3, 34], [4, 5, 34]]) {
    o.push(raw(`M${fmt(cx[a])} 124C${fmt(cx[a])} ${124 - h * 1.35} ${fmt(cx[b])} ${124 - h * 1.35} ${fmt(cx[b])} 124`, "m"));
    o.push(head(cx[b], 125, Math.PI / 2, 5));
  }
  return o;
};
A["token-sequence"] = () => {
  const o = [], xs = [24, 70, 116, 162];
  xs.forEach((x, i) => { o.push(rect(x, 80, 38, 40, 6)); o.push(ln(x + 11, 100, x + 27, 100, "m")); if (i) o.push(arrow(xs[i - 1] + 38, 100, x, 100, "m", 5)); });
  o.push(rect(208, 80, 38, 40, 6, "d")); o.push(arrow(200, 100, 208, 100, "m", 5)); o.push(arrow(246, 100, 276, 100));
  [60, 40, 26, 16, 9].forEach((w, i) => o.push(rect(284, 68 + i * 14, w, 8, 3, "f", ' fill-opacity=".8"')));
  return o;
};
A["syntax-tree"] = () => {
  const leaves = [56, 116, 200, 260, 316].map(x => [x, 158]), np1 = [86, 108], np2 = [288, 108], vp = [244, 70], root = [165, 32], o = [];
  [[root, np1], [root, vp], [vp, np2], [np1, leaves[0]], [np1, leaves[1]], [vp, leaves[2]], [np2, leaves[3]], [np2, leaves[4]]].forEach(([a, b]) => o.push(edge(a, b, 5, b[1] === 158 ? 0 : 5)));
  [root, np1, np2, vp].forEach(p => o.push(circ(p[0], p[1], 5)));
  leaves.forEach(p => o.push(rect(p[0] - 20, 158, 40, 14, 4)));
  return o;
};

// -- robotics
A["robot-arm"] = () => {
  const j0 = [96, 150], link = (p, a, l) => [p[0] + l * Math.cos(a * RAD), p[1] + l * Math.sin(a * RAD)];
  const arm = (angs, cl) => { const j1 = link(j0, angs[0], 78), j2 = link(j1, angs[1], 80), e = link(j2, angs[2], 52); return { j1, j2, e }; };
  const g = arm([-80, -40, 10]), a = arm([-62, -22, 28]), o = [];
  o.push(ln(40, 176, 330, 176, "m"), rect(70, 164, 52, 12, 3), ln(96, 164, 96, 157));
  o.push(bar(j0, g.j1, 6, 6, 3).replace(/<path/g, '<path class="m"'), bar(g.j1, g.j2, 6, 6, 3).replace(/<path/g, '<path class="m"'), bar(g.j2, g.e, 6, 2, 3).replace(/<path/g, '<path class="m"'));
  o.push(smooth([g.e, [250, 36], [270, 60], [a.e[0], a.e[1] - 2]], false, "m d"));
  o.push(bar(j0, a.j1, 6, 6), bar(a.j1, a.j2, 6, 6), bar(a.j2, a.e, 6, 2));
  [j0, a.j1, a.j2].forEach(p => { o.push(circ(p[0], p[1], 6)); o.push(dot(p[0], p[1], 2)); });
  const ang = 28 * RAD, ex = a.e[0], ey = a.e[1], nx = -Math.sin(ang), ny = Math.cos(ang);
  o.push(pl([[ex + nx * 9 + Math.cos(ang) * 14, ey + ny * 9 + Math.sin(ang) * 14], [ex + nx * 9, ey + ny * 9], [ex - nx * 9, ey - ny * 9], [ex - nx * 9 + Math.cos(ang) * 14, ey - ny * 9 + Math.sin(ang) * 14]]));
  o.push(circ(ex + Math.cos(ang) * 26, ey + Math.sin(ang) * 26 + 0, 7, "m"));
  return o;
};
A["robotics"] = () => {
  const c = [100, 100], o = [], walls = [[22, 178], [22, 22]];
  const circles = [[236, 66, 20], [226, 142, 16]];
  const cast = a => {
    const dx = Math.cos(a), dy = Math.sin(a); let t = Infinity;
    if (dx > 0) t = Math.min(t, (318 - c[0]) / dx);
    if (dy > 0) t = Math.min(t, (178 - c[1]) / dy);
    if (dy < 0) t = Math.min(t, (22 - c[1]) / dy);
    for (const [cx, cy, r] of circles) { const fx = c[0] - cx, fy = c[1] - cy, b = fx * dx + fy * dy, d = b * b - (fx * fx + fy * fy - r * r); if (d > 0) { const s = -b - Math.sqrt(d); if (s > 0) t = Math.min(t, s); } }
    return t;
  };
  void walls;
  circles.forEach(([x, y, r]) => o.push(circ(x, y, r, "m")));
  o.push(rect(318, 22, 1, 156, 0, "m"));
  for (let i = 0; i <= 26; i++) { const a = (-72 + i * (144 / 26)) * RAD, t = cast(a); o.push(ln(c[0] + 24 * Math.cos(a), c[1] + 24 * Math.sin(a), c[0] + t * Math.cos(a), c[1] + t * Math.sin(a), "m")); o.push(dot(c[0] + t * Math.cos(a), c[1] + t * Math.sin(a), 1.9)); }
  o.push(rect(c[0] - 22, c[1] - 16, 44, 32, 8), rect(c[0] - 12, c[1] - 24, 22, 6, 2), rect(c[0] - 12, c[1] + 18, 22, 6, 2), arrow(c[0] - 2, c[1], c[0] + 18, c[1], undefined, 5));
  return o;
};
A["navigation"] = () => {
  const cols = 16, rows = 9, cs = 19, x0 = 28, y0 = 14, o = [];
  let grid, path;
  for (let seed = 3; !path; seed++) {
    const r = rng(seed); grid = Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => (i > 0 && i < cols - 1 && r() < 0.2 ? 1 : 0)));
    const prev = new Map(), q = [[0, 4]]; prev.set("0,4", null);
    while (q.length) { const [i, j] = q.shift(); if (i === 15 && j === 4) break; for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const a = i + di, b = j + dj, k = `${a},${b}`; if (a < 0 || b < 0 || a >= cols || b >= rows || grid[b][a] || prev.has(k)) continue; prev.set(k, [i, j]); q.push([a, b]); } }
    if (prev.has("15,4")) { const p = []; let cur = [15, 4]; while (cur) { p.push(cur); cur = prev.get(`${cur[0]},${cur[1]}`); } if (p.length > 22) path = p.reverse(); }
  }
  for (let j = 0; j <= rows; j++) o.push(ln(x0, y0 + j * cs, x0 + cols * cs, y0 + j * cs, "g"));
  for (let i = 0; i <= cols; i++) o.push(ln(x0 + i * cs, y0, x0 + i * cs, y0 + rows * cs, "g"));
  grid.forEach((row, j) => row.forEach((v, i) => v && o.push(rect(x0 + i * cs + 1, y0 + j * cs + 1, cs - 2, cs - 2, 2, "f", ' fill-opacity=".2"'))));
  const P = path.map(([i, j]) => [x0 + (i + 0.5) * cs, y0 + (j + 0.5) * cs]);
  o.push(pl(P)); o.push(circ(P[0][0], P[0][1], 5.5)); o.push(dot(P[0][0], P[0][1], 2)); o.push(circ(P.at(-1)[0], P.at(-1)[1], 5.5)); o.push(dot(P.at(-1)[0], P.at(-1)[1], 2.4));
  return o;
};

// -- vision
A["vision"] = () => {
  const o = [rect(36, 20, 288, 160, 8)], box = (x0, y0, x1, y1, k = 11) => raw(`M${x0} ${y0 + k}V${y0}H${x0 + k}M${x1 - k} ${y0}H${x1}V${y0 + k}M${x1} ${y1 - k}V${y1}H${x1 - k}M${x0 + k} ${y1}H${x0}V${y1 - k}`);
  o.push(ln(36, 150, 324, 150, "m"));
  o.push(circ(112, 102, 22, "m"), pl([[204, 150], [204, 108], [236, 82], [268, 108], [268, 150]], "m", true));
  o.push(box(76, 66, 148, 138), box(192, 60, 280, 150)); // detections
  o.push(rect(76, 54, 40, 10, 3, "f", ' fill-opacity=".3"'), rect(192, 48, 52, 10, 3, "f", ' fill-opacity=".3"'));
  return o;
};
A["feature-map"] = () => {
  const o = [], c = 15, ix = 26, iy = 47;
  for (let k = 0; k <= 7; k++) { o.push(ln(ix, iy + k * c, ix + 7 * c, iy + k * c, "m"), ln(ix + k * c, iy, ix + k * c, iy + 7 * c, "m")); }
  o.push(rect(ix + 2 * c, iy + c, 3 * c, 3 * c, 1, "t", ' fill-opacity=".18"'));
  const ox = 176, oy = 62;
  for (let k = 0; k <= 5; k++) { o.push(ln(ox, oy + k * c, ox + 5 * c, oy + k * c, "m"), ln(ox + k * c, oy, ox + k * c, oy + 5 * c, "m")); }
  o.push(rect(ox + 2 * c, oy + c, c, c, 1, "f", ' fill-opacity=".7"'));
  o.push(ln(ix + 5 * c, iy + c, ox + 2 * c, oy + c, "m d"), ln(ix + 5 * c, iy + 4 * c, ox + 2 * c, oy + 2 * c, "m d"));
  o.push(arrow(146, 100, 168, 100, "m", 5), arrow(262, 100, 280, 100, "m", 5));
  for (let i = 0; i < 4; i++) o.push(rect(284 + i * 9, 78 + (3 - i) * 9, 36, 36, 4));
  return o;
};
A["image-patches"] = () => {
  const o = [rect(28, 50, 100, 100, 4)], g = 25;
  for (let k = 1; k < 4; k++) o.push(ln(28 + k * g, 50, 28 + k * g, 150, "m"), ln(28, 50 + k * g, 128, 50 + k * g, "m"));
  o.push(circ(98, 76, 9, "m"), pl([[28, 138], [56, 108], [74, 124], [102, 98], [128, 130]], "m"));
  o.push(rect(28 + g, 50 + 2 * g, g, g, 0, "f", ' fill-opacity=".3"'), rect(28 + g, 50 + 2 * g, g, g, 0));
  o.push(arrow(136, 100, 164, 100, "m", 5));
  for (let i = 0; i < 6; i++) { const x = 172 + i * 28; o.push(rect(x, 88, 22, 24, 4, i === 0 ? "d" : i === 3 ? "f" : "", i === 3 ? ' fill-opacity=".3"' : "")); if (i === 3) o.push(rect(x, 88, 22, 24, 4)); o.push(ln(x + 5, 100, x + 17, 100, "m")); }
  return o;
};

// -- reinforcement learning
A["reinforcement"] = () => {
  const o = [rect(120, 24, 120, 50, 8), rect(120, 126, 120, 50, 8)];
  [[150, 49], [180, 37], [180, 61], [210, 49]].forEach(p => o.push(dot(p[0], p[1], 3)));
  o.push(edge([150, 49], [180, 37], 3, 3, "m"), edge([150, 49], [180, 61], 3, 3, "m"), edge([180, 37], [210, 49], 3, 3, "m"), edge([180, 61], [210, 49], 3, 3, "m"));
  for (let k = 0; k < 4; k++) o.push(ln(150, 138 + k * 8, 210, 138 + k * 8, "g"));
  for (let k = 0; k < 4; k++) o.push(ln(150 + k * 20, 138, 150 + k * 20, 162, "g"));
  o.push(rect(170, 146, 20, 8, 2, "f", ' fill-opacity=".6"'));
  o.push(raw("M240 49H296V151H246"), head(240, 151, Math.PI), raw("M120 151H64V49H114"), head(120, 49, 0));
  o.push(ln(180, 126, 180, 80, "m d"), head(180, 76, -Math.PI / 2, 6, "m"));
  return o;
};
A["decision-tree"] = () => {
  const root = [180, 28], L1 = [[96, 78], [180, 78], [264, 78]], L2 = [[60, 128], [120, 128], [150, 128], [210, 128], [240, 128], [300, 128]], o = [];
  const kids = [[0, 1], [2, 3], [4, 5]];
  L1.forEach(p => o.push(edge(root, p, 8, 6, p === L1[1] ? "" : "m")));
  kids.forEach((ks, i) => ks.forEach(k => o.push(edge(L1[i], L2[k], 6, 5, i === 1 && k === 3 ? "" : "m"))));
  const leaf = [222, 174];
  o.push(edge(L2[3], leaf, 5, 3, "m d"), rect(leaf[0] - 4, leaf[1] - 4, 8, 8, 1, "f"));
  o.push(circ(root[0], root[1], 8)); L1.forEach((p, i) => o.push(circ(p[0], p[1], i === 1 ? 7 : 5.5))); L2.forEach((p, i) => o.push(circ(p[0], p[1], i === 3 ? 6 : 4.5)));
  o.push(dot(root[0], root[1], 3), dot(L1[1][0], L1[1][1], 2.6), dot(L2[3][0], L2[3][1], 2.4));
  o.push(raw("M246 168C290 168 300 120 278 40", "m d"), head(278, 40, -Math.PI / 2 - 0.2, 5, "m"));
  return o;
};
A["reward-landscape"] = () => {
  const f = (x, y) => Math.exp(-((x - 236) ** 2 / (2 * 46 ** 2) + (y - 82) ** 2 / (2 * 32 ** 2))) + 0.7 * Math.exp(-((x - 100) ** 2 / (2 * 40 ** 2) + (y - 124) ** 2 / (2 * 36 ** 2)));
  const o = [];
  for (let l = 2; l <= 9; l++) contour(f, 18, 14, 342, 186, 80, 43, l * 0.1).forEach(p => o.push(smooth(p.length > 3 ? p.filter((_, i) => i % 2 === 0 || i === p.length - 1) : p, false, l % 3 === 0 ? "" : "m")));
  let p = [304, 164]; const trail = [p];
  for (let i = 0; i < 9; i++) { const e = 1, gx = (f(p[0] + e, p[1]) - f(p[0] - e, p[1])), gy = (f(p[0], p[1] + e) - f(p[0], p[1] - e)), m = Math.hypot(gx, gy) || 1; p = [p[0] + (gx / m) * 13, p[1] + (gy / m) * 13]; trail.push(p); }
  o.push(pl(trail)); trail.forEach((q, i) => o.push(dot(q[0], q[1], i === 0 || i === trail.length - 1 ? 3.6 : 2)));
  return o;
};

// -- graphs
A["graphs"] = () => {
  const N = { h: [180, 100, 11], a: [90, 58, 6], b: [56, 118, 8], c: [124, 158, 6], d: [250, 150, 7], e: [304, 100, 8], f: [262, 46, 6], g: [186, 34, 5], i: [128, 96, 5], l1: [26, 76, 3], l2: [334, 60, 3], l3: [330, 150, 3], l4: [60, 168, 3] }, o = [];
  [["h", "a"], ["h", "c"], ["h", "d"], ["h", "f"], ["h", "g"], ["h", "i"], ["a", "b"], ["b", "c"], ["d", "e"], ["f", "e"], ["a", "g"], ["b", "l1"], ["e", "l2"], ["e", "l3"], ["c", "l4"], ["i", "b"]].forEach(([a, b]) => o.push(edge(N[a], N[b], N[a][2], N[b][2], b.startsWith("l") || a === "i" || b === "i" ? "m" : "")));
  Object.values(N).forEach(([x, y, r]) => o.push(r <= 3 ? dot(x, y, r) : circ(x, y, r)));
  o.push(dot(180, 100, 3.5));
  return o;
};
A["network-clusters"] = () => {
  const r = rng(21), cl = [[92, 104, 9, 40, 40], [250, 66, 8, 44, 32], [240, 148, 7, 42, 26]], o = [], groups = [];
  cl.forEach(([cx, cy, n, rx, ry]) => { const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r() * 0.5, d = 0.45 + r() * 0.55; return [cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d]; }); groups.push(pts); o.push(ell(cx, cy, rx + 16, ry + 16, 0, "m d")); });
  groups.forEach(pts => pts.forEach((p, i) => [...pts].filter(q => q !== p).sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1])).slice(0, 2).forEach(q => i < pts.indexOf(q) + 9 && o.push(edge(p, q, 3, 3)))));
  [[0, 1], [0, 2], [1, 2]].forEach(([a, b], k) => o.push(edge(groups[a][k], groups[b][k + 1], 3, 3, "m")));
  groups.flat().forEach(p => o.push(dot(p[0], p[1], 3.2)));
  return o;
};
A["graph-paths"] = () => {
  const r = rng(5), P = Array.from({ length: 4 }, (_, j) => Array.from({ length: 6 }, (_, i) => [48 + i * 53 + (r() - 0.5) * 14, 34 + j * 44 + (r() - 0.5) * 14])), o = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) { if (i < 5 && r() < 0.85) o.push(edge(P[j][i], P[j][i + 1], 4, 4, "m")); if (j < 3 && r() < 0.85) o.push(edge(P[j][i], P[j + 1][i], 4, 4, "m")); if (i < 5 && j < 3 && r() < 0.2) o.push(edge(P[j][i], P[j + 1][i + 1], 4, 4, "m")); }
  const path = [[0, 3], [1, 3], [1, 2], [2, 2], [3, 2], [3, 1], [4, 1], [4, 0], [5, 0]].map(([i, j]) => P[j][i]);
  for (let k = 0; k < path.length - 1; k++) o.push(edge(path[k], path[k + 1], 4, 4), edge(path[k], path[k + 1], 4, 4));
  P.flat().forEach(p => o.push(circ(p[0], p[1], 4, "m")));
  path.forEach(p => o.push(dot(p[0], p[1], 4)));
  o.push(circ(path[0][0], path[0][1], 9), circ(path.at(-1)[0], path.at(-1)[1], 9));
  return o;
};

// -- neuroscience
A["neuroscience"] = () => {
  const r = rng(9), soma = [120, 100], o = [];
  const branch = (x, y, a, l, d) => { const x2 = x + l * Math.cos(a * RAD), y2 = y + l * Math.sin(a * RAD); o.push(ln(x, y, x2, y2)); if (d > 0) { branch(x2, y2, a - 22 - r() * 16, l * 0.72, d - 1); branch(x2, y2, a + 22 + r() * 16, l * 0.72, d - 1); } };
  [[150, 34], [188, 32], [214, 34], [236, 30], [128, 30]].forEach(([a, l]) => branch(soma[0] + 15 * Math.cos(a * RAD), soma[1] + 15 * Math.sin(a * RAD), a, l, a > 180 && a < 240 ? 2 : 3));
  o.push(circ(soma[0], soma[1], 15), circ(soma[0] + 2, soma[1] - 1, 5, "m"));
  o.push(ln(soma[0] + 15, 100, 306, 100));
  [152, 192, 232, 272].forEach(x => o.push(rect(x - (x > 270 ? 8 : 0), 92, x > 270 ? 24 : 32, 16, 8)));
  [[334, 66], [338, 100], [334, 134]].forEach(([x, y]) => { o.push(edge([306, 100], [x, y], 0, 4)); o.push(circ(x, y, 3.5)); });
  return o;
};
A["synapses"] = () => {
  const o = [raw("M70 22H290V62Q290 84 262 84H98Q70 84 70 62Z")], yb = x => { const t = (x - 30) / 300; return (1 - t) ** 2 * 134 + 2 * (1 - t) * t * 108 + t * t * 134; };
  [[108, 46], [150, 40], [198, 48], [244, 42]].forEach(([x, y]) => { o.push(circ(x, y, 9)); o.push(dot(x - 2, y, 1.5), dot(x + 3, y - 2, 1.5), dot(x + 1, y + 3, 1.5)); });
  [[134, 74], [182, 74], [236, 74]].forEach(([x, y]) => { o.push(circ(x, y, 8, "m")); o.push(dot(x, y, 1.5)); });
  const r = rng(4); for (let i = 0; i < 16; i++) o.push(dot(104 + r() * 160, 92 + r() * 22, 1.7));
  o.push(raw("M30 190V138Q180 108 330 134V190"));
  [86, 128, 172, 214, 258].forEach(x => { const y = yb(x); o.push(raw(`M${x} ${fmt(y)}V${fmt(y - 7)}M${x - 5} ${fmt(y - 15)}L${x} ${fmt(y - 7)}L${x + 5} ${fmt(y - 15)}`)); });
  o.push(arrow(150, 92, 150, 104, "m", 4), arrow(218, 92, 218, 104, "m", 4));
  return o;
};
A["brain-waves"] = () => {
  const ch = [x => 7 * Math.sin(x / 5.2) + 2 * Math.sin(x / 1.7), x => 4 * Math.sin(x / 2.2) + 3 * Math.sin(x / 3.7 + 1) + Math.sin(x / 1.3), x => 9 * Math.sin(x / 18) + 3 * Math.sin(x / 7 + 2), x => 12 * Math.exp(-(((x - 214) / 36) ** 2)) * Math.sin(x / 2.6) + 2 * Math.sin(x / 9)], o = [];
  ch.forEach((fn, k) => { const y = 38 + k * 42; o.push(dot(20, y, 2.4)); o.push(plot(x => [x, y - fn(x)], 36, 332, 296)); });
  o.push(ln(250, 16, 250, 184, "m d"));
  return o;
};

// -- genetics
A["genetics"] = () => {
  const o = [], f = x => 46 * Math.sin((2 * Math.PI * (x - 26)) / 104);
  for (let x = 34; x < 334; x += 8) { const d = Math.abs(2 * f(x)); if (d > 14) o.push(ln(x, 100 - f(x), x, 100 + f(x), "m")); }
  o.push(plot(x => [x, 100 + f(x)], 26, 334, 200), plot(x => [x, 100 - f(x)], 26, 334, 200));
  return o;
};
A["chromosomes"] = () => {
  const o = [], L = [132, 116, 100, 84, 66], fr = [0.5, 0.4, 0.32, 0.5, 0.26];
  L.forEach((l, i) => { const x = 50 + i * 65, top = 100 - l * fr[i]; [-6, 6].forEach(a => o.push(rect(x - 5.5, top, 11, l, 5.5, "", ` transform="rotate(${a} ${x} 100)"`))); o.push(dot(x, 100, 2.4)); });
  return o;
};
A["read-alignment"] = () => {
  const r = rng(12), rows = [], o = [rect(30, 22, 300, 9, 4)];
  for (let x = 40; x <= 320; x += 20) o.push(ln(x, 36, x, 40, "m"));
  const reads = Array.from({ length: 22 }, () => { const l = 46 + Math.floor(r() * 44), s = 30 + r() * (300 - l); return [s, s + l]; }).sort((a, b) => a[0] - b[0]);
  reads.forEach(rd => { let k = rows.findIndex(end => end + 6 < rd[0]); if (k < 0) k = rows.length; rows[k] = rd[1]; rd.row = k; });
  reads.forEach(rd => { if (rd.row < 6) { const y = 48 + rd.row * 14; o.push(rect(rd[0], y, rd[1] - rd[0], 8, 4, "m")); if (rd[0] < 176 && rd[1] > 176) o.push(dot(176, y + 4, 2.6)); } });
  o.push(ln(176, 16, 176, 142, "m d"));
  const bins = []; for (let x = 30; x < 330; x += 6) bins.push(reads.filter(rd => rd[0] <= x && rd[1] > x && rd.row < 6).length);
  let d = "M30 182"; bins.forEach((c, i) => { d += `V${182 - c * 7}H${36 + i * 6}`; }); o.push(raw(d + "V182", ""));
  return o;
};

// -- cells
A["cells"] = () => {
  const r = rng(3), pts = Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return [180 + Math.cos(a) * 146 * (1 + (r() - 0.5) * 0.1), 100 + Math.sin(a) * 78 * (1 + (r() - 0.5) * 0.1)]; });
  const o = [smooth(pts, true), circ(158, 98, 28), circ(166, 92, 8, "m"), circ(158, 98, 33, "m d")];
  [[258, 70, 28], [256, 134, -22], [92, 134, 8]].forEach(([x, y, a]) => { o.push(ell(x, y, 18, 9, a)); o.push(raw(`M${x - 11} ${y}l4 -5l4 8l4 -8l4 8l4 -5`, "m").replace("<path", `<path transform="rotate(${a} ${x} ${y})"`)); });
  o.push(smooth([[204, 84], [224, 90], [208, 100], [230, 108], [212, 118], [234, 124]], false, "m"));
  o.push(smooth([[88, 78], [112, 70]], false), smooth([[86, 86], [112, 78]], false), smooth([[88, 94], [112, 86]], false));
  [[300, 100], [292, 112], [128, 56], [210, 150], [182, 146], [120, 162]].forEach(([x, y]) => o.push(circ(x, y, 3.5, "m")));
  return o;
};
A["cell-division"] = () => {
  const o = [smooth([[52, 100], [70, 58], [126, 40], [168, 50], [180, 66], [192, 50], [234, 40], [290, 58], [308, 100], [290, 142], [234, 160], [192, 150], [180, 134], [168, 150], [126, 160], [70, 142]], true)];
  [[84, 1], [276, -1]].forEach(([px, s]) => { o.push(dot(px, 100, 3)); for (let k = -2; k <= 2; k++) { const y = 100 + k * 15, ax = 124 * (s === 1 ? 1 : 0) + 236 * (s === 1 ? 0 : 1); o.push(edge([px, 100], [ax, y], 3, 1, "m")); o.push(pl([[ax + s * 18, y - 8], [ax, y], [ax + s * 18, y + 8]])); } });
  o.push(ln(180, 70, 180, 130, "m d"));
  return o;
};
A["membrane"] = () => {
  const o = [];
  for (let x = 30; x <= 330; x += 13) {
    if (x > 146 && x < 214) continue;
    o.push(circ(x, 62, 5), circ(x, 138, 5));
    [-2.2, 2.2].forEach(dx => o.push(raw(`M${fmt(x + dx)} 67c-2 8 2 16 0 28`), raw(`M${fmt(x + dx)} 133c-2 -8 2 -16 0 -28`)));
  }
  o.push(rect(150, 48, 16, 104, 6), rect(194, 48, 16, 104, 6));
  o.push(arrow(180, 28, 180, 172, "m d", 6), circ(180, 40, 3.5), circ(180, 100, 3.5), circ(180, 158, 3.5));
  [[60, 26], [104, 34], [250, 28], [300, 36], [80, 170], [128, 164], [260, 172], [312, 160]].forEach(([x, y]) => o.push(circ(x, y, 3, "m")));
  return o;
};

// -- molecules
A["molecules"] = () => {
  const R = 36, c1 = [125, 100], c2 = [c1[0] + R * Math.sqrt(3), 100], V = c => Array.from({ length: 6 }, (_, k) => [c[0] + R * Math.cos((-90 + 60 * k) * RAD), c[1] + R * Math.sin((-90 + 60 * k) * RAD)]), v1 = V(c1), v2 = V(c2), o = [];
  const atoms = []; const out = (v, a, l) => [v[0] + l * Math.cos(a * RAD), v[1] + l * Math.sin(a * RAD)];
  const bond = (a, b, ra = 0, rb = 0) => o.push(edge(a, b, ra, rb));
  const dbl = (a, b, c) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = c[0] - mx, dy = c[1] - my, d = Math.hypot(dx, dy), ox = (dx / d) * 5, oy = (dy / d) * 5, sh = 0.16; o.push(ln(a[0] + ox + (b[0] - a[0]) * sh, a[1] + oy + (b[1] - a[1]) * sh, b[0] + ox - (b[0] - a[0]) * sh, b[1] + oy - (b[1] - a[1]) * sh, "m")); };
  const edgesOf = v => v.map((p, k) => [p, v[(k + 1) % 6]]);
  edgesOf(v1).forEach(([a, b]) => bond(a, b)); edgesOf(v2).forEach(([a, b], k) => k !== 4 && bond(a, b));
  [0, 2, 4].forEach(k => dbl(v1[k], v1[(k + 1) % 6], c1)); [0, 2].forEach(k => dbl(v2[k], v2[(k + 1) % 6], c2));
  const p1 = out(v2[1], -30, 34), p2 = out(p1, 30, 34), p3 = out(p2, -30, 34); bond(v2[1], p1); bond(p1, p2, 0, 8); bond(p2, p3, 8, 0); atoms.push([p2, 8]);
  const q1 = out(v1[5], 210, 34); bond(v1[5], q1, 0, 8); atoms.push([q1, 8]);
  const s1 = out(v2[3], 90, 34); o.push(edge(v2[3], s1, 0, 8), edge([v2[3][0] + 4, v2[3][1]], [s1[0] + 4, s1[1]], 0, 6, "m")); atoms.push([s1, 8]);
  const t1 = out(v1[4], 150, 34); bond(v1[4], t1);
  atoms.forEach(([p, r]) => { o.push(circ(p[0], p[1], r)); o.push(dot(p[0], p[1], 1.8)); });
  return o;
};
A["protein-fold"] = () => {
  const o = [plot(t => [26 + 3.4 * t + 12 * Math.cos(t), 106 + 30 * Math.sin(t)], 0, 11 * Math.PI, 330)];
  const sx = 26 + 3.4 * 11 * Math.PI - 12;
  const strand = (x0, x1, y) => { const dir = Math.sign(x1 - x0), tip = x1, nk = x1 - dir * 16; o.push(pl([[x0, y - 5], [nk, y - 5], [nk, y - 11], [tip, y], [nk, y + 11], [nk, y + 5], [x0, y + 5]], "", true)); };
  strand(214, 312, 50); strand(312, 214, 100); strand(214, 312, 150);
  o.push(smooth([[sx, 106], [158, 98], [182, 72], [214, 50]], false, "m"));
  o.push(raw("M312 50C336 50 336 100 312 100", "m"), raw("M214 100C190 100 190 150 214 150", "m"));
  return o;
};
A["crystal-lattice"] = () => {
  const s = 46, P = (i, j, k) => [109 + i * s + k * s * 0.55, 73 + j * s - k * s * 0.42], o = [];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const c = k === 0 ? "" : "m";
    if (i < 2) o.push(edge(P(i, j, k), P(i + 1, j, k), 4, 4, c));
    if (j < 2) o.push(edge(P(i, j, k), P(i, j + 1, k), 4, 4, c));
    if (k < 2) o.push(edge(P(i, j, k), P(i, j, k + 1), 4, 4, "m"));
  }
  for (let k = 2; k >= 0; k--) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const p = P(i, j, k); o.push((i + j + k) % 2 ? circ(p[0], p[1], 4.5, k ? "m" : "") : dot(p[0], p[1], 3.4, k ? "f m" : "f")); }
  return o;
};

// -- physics
A["quantum"] = () => {
  const R = 74, cx = 180, cy = 100, al = 28 * RAD, be = 22 * RAD;
  const proj = (x, y, z) => { const u = -x * Math.sin(al) + y * Math.cos(al), w = x * Math.cos(al) + y * Math.sin(al); return [cx + R * u, cy + R * (-z * Math.cos(be) + w * Math.sin(be)), w]; };
  const o = [circ(cx, cy, R)];
  const arc = (fn, c) => { const pts = Array.from({ length: 121 }, (_, i) => fn((i / 120) * 2 * Math.PI)); let seg = [pts[0]], front = pts[0][2] >= 0; const out = []; for (let i = 1; i < pts.length; i++) { const f = pts[i][2] >= 0; if (f !== front) { out.push([seg, front]); seg = [pts[i - 1]]; front = f; } seg.push(pts[i]); } out.push([seg, front]); out.forEach(([s, f]) => s.length > 1 && o.push(pl(s, f ? c : "m d"))); };
  arc(t => proj(Math.cos(t), Math.sin(t), 0), ""); arc(t => proj(Math.cos(t), 0, Math.sin(t)), "m");
  const z = proj(0, 0, 1.22), x = proj(1.3, 0, 0), y = proj(0, 1.3, 0);
  o.push(arrow(cx, cy, z[0], z[1], "m", 6), arrow(cx, cy, x[0], x[1], "m", 6), arrow(cx, cy, y[0], y[1], "m", 6));
  const th = 38 * RAD, ph = 62 * RAD, v = proj(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)), foot = proj(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), 0);
  o.push(ln(v[0], v[1], foot[0], foot[1], "m d"), ln(cx, cy, foot[0], foot[1], "m d"), arrow(cx, cy, v[0], v[1], "", 7), dot(v[0], v[1], 3.4));
  return o;
};
A["double-slit"] = () => {
  const o = [`<clipPath id="c"><rect x="121" y="12" width="190" height="176"/></clipPath>`];
  o.push(rect(115, 16, 6, 62, 0), rect(115, 90, 6, 20, 0), rect(115, 122, 6, 62, 0));
  [34, 58, 82].forEach(x => o.push(ln(x, 44, x, 156, "m")));
  o.push(arrow(34, 100, 104, 100, "m", 5));
  const g = [];
  [84, 116].forEach(sy => { for (let i = 0; i < 10; i++) g.push(circ(118, sy, 14 + i * 17, "m")); });
  o.push(`<g clip-path="url(#c)">${g.join("")}</g>`);
  o.push(ln(310, 16, 310, 184, "m"));
  o.push(plot(y => [314 + 28 * Math.cos((Math.PI * (y - 100)) / 26) ** 2 * Math.exp(-(((y - 100) / 72) ** 2)), y], 22, 178, 156));
  return o;
};
A["space"] = () => {
  const r = rng(17), o = [], tilt = -18 * RAD;
  const place = (x, y) => [180 + x * Math.cos(tilt) - y * 0.52 * Math.sin(tilt), 100 + x * Math.sin(tilt) + y * 0.52 * Math.cos(tilt)];
  for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 190; i++) {
    const t = 0.3 + (i / 190) * 8.7, rr = 8 + 17 * t + gauss(r) * (1.5 + t * 0.7), a = t + arm * Math.PI, p = place(rr * Math.cos(a), rr * Math.sin(a));
    if (p[0] > 22 && p[0] < 338 && p[1] > 16 && p[1] < 184) o.push(dot(p[0], p[1], r() > 0.85 ? 1.9 : 1.1));
  }
  for (let i = 0; i < 14; i++) { const p = place(gauss(r) * 9, gauss(r) * 9); o.push(dot(p[0], p[1], 1.3)); }
  o.push(ell(180, 100, 12, 6.2, -18));
  return o;
};
A["orbital-system"] = () => {
  const rot = -10, o = [], c = [180, 100], at = (a, b, t) => { const x = a * Math.cos(t), y = b * Math.sin(t); return [c[0] + x * Math.cos(rot * RAD) - y * Math.sin(rot * RAD), c[1] + x * Math.sin(rot * RAD) + y * Math.cos(rot * RAD)]; };
  [38, 66, 102, 140].forEach(a => o.push(ell(c[0], c[1], a, a * 0.42, rot, "m")));
  const r = rng(2); for (let i = 0; i < 46; i++) { const p = at(84 + gauss(r) * 2.4, 84 * 0.42 + gauss(r) * 1.4, r() * Math.PI * 2); o.push(dot(p[0], p[1], 1.1)); }
  o.push(circ(180, 100, 9), dot(180, 100, 3));
  [[38, 0.8, 3.4], [66, 3.6, 4.4], [102, 5.5, 6], [140, 2.2, 4.6]].forEach(([a, t, rd]) => { const p = at(a, a * 0.42, t); o.push(circ(p[0], p[1], rd)); if (a === 102) o.push(ell(p[0], p[1], rd * 2.1, rd * 0.7, rot - 10, "m")); });
  const m = at(66, 66 * 0.42, 3.6); o.push(dot(m[0] + 11, m[1] - 8, 1.6));
  return o;
};

// -- earth
A["climate"] = () => {
  const r = rng(6), o = [axes(36, 172, 336, 20)];
  [62, 102, 142].forEach(y => o.push(ln(36, y, 332, y, "g")));
  const raw0 = Array.from({ length: 43 }, () => (r() - 0.5) * 22), pts = Array.from({ length: 41 }, (_, i) => [48 + i * 7, 150 - i * 1.9 + (raw0[i] + raw0[i + 1] + raw0[i + 2]) / 3 - (i > 28 ? (i - 28) * 1.4 : 0)]);
  o.push(ln(48, 150, 328, 82, "m d"), pl(pts, ""), ...pts.filter((_, i) => i % 3 === 0).map(p => dot(p[0], p[1], 1.8)), circ(pts.at(-1)[0], pts.at(-1)[1], 6));
  return o;
};
A["atmosphere"] = () => {
  const o = [axes(50, 178, 336, 14, "m")];
  [120, 78, 44].forEach(y => o.push(ln(50, y, 330, y, "m d")));
  const prof = [[250, 176], [150, 120], [232, 78], [118, 44], [312, 16]];
  o.push(pl(prof), ...prof.map(p => dot(p[0], p[1], 3)), ln(40, 178, 334, 178));
  for (let x = 54; x < 330; x += 10) o.push(ln(x, 178, x - 5, 186, "m"));
  return o;
};
A["ocean"] = () => {
  const o = [ln(24, 40, 336, 40, "g"), plot(x => [x, 40 - 11 * Math.sin((2 * Math.PI * (x - 24)) / 104 + Math.PI / 2)], 24, 336, 156)];
  [76, 180, 284].forEach(x => { [[22, 10], [46, 7.2], [74, 4.8], [106, 3], [140, 1.8]].forEach(([d, r], i) => { o.push(circ(x, 40 + d, r, i ? "m" : "")); o.push(dot(x + r * Math.cos(0.9), 40 + d + r * Math.sin(0.9), 1.5)); }); o.push(ln(x, 40, x, 186, "g")); });
  return o;
};
A["fluid-flow"] = () => {
  const s = 39, cx = 180, cy = 100, Rc = 0.95, psi = (px, py) => { const x = (px - cx) / s, y = -(py - cy) / s; return y * (1 - (Rc * Rc) / (x * x + y * y + 1e-6)); };
  const o = [circ(cx, cy, Rc * s)];
  for (let l = -9; l <= 9; l++) { if (!l) continue; contour(psi, 20, 18, 340, 182, 160, 82, l * 0.28, p => Math.hypot(p[0] - cx, p[1] - cy) < Rc * s + 0.5).forEach(p => o.push(pl(p, "m"))); }
  o.push(ln(20, 100, cx - Rc * s, 100, "m"), ln(cx + Rc * s, 100, 340, 100, "m"));
  return o;
};

// -- energy
A["energy"] = () => {
  const o = [axes(44, 172, 336, 20)];
  [[44, 18, 100, 9, 0.96], [54, 30, 100, 7, 0.9], [64, 40, 100, 5.5, 0.82], [74, 52, 100, 4.5, 0.74]].forEach(([b, k, m, e, qm], i) => { const pts = []; for (let q = 0; q <= qm; q += 0.01) { const y = b + k * q + m * Math.pow(q / qm, e) * 0.9; if (y > 168) break; pts.push([56 + q * 270, y]); } o.push(pl(pts, i === 1 ? "" : "m"), dot(pts.at(-1)[0], pts.at(-1)[1], 2.4)); });
  [62, 102, 142].forEach(y => o.push(ln(44, y, 332, y, "g")));
  return o;
};
A["iv-curve"] = () => {
  const o = [axes(44, 172, 336, 20)], Voc = 262, a = 20, I = V => (1 - Math.exp((V - Voc) / a)) / (1 - Math.exp(-Voc / a));
  const iv = [], pv = []; let best = [0, 0];
  for (let V = 0; V <= Voc; V += 2) { const i = I(V), y = 172 - i * 120, p = V * i; iv.push([44 + V, y]); pv.push([44 + V, 172 - (p / Voc) * 128]); if (p > best[0]) best = [p, V]; }
  const mx = 44 + best[1], my = 172 - I(best[1]) * 120;
  o.push(pl(iv), pl(pv, "m d"), ln(44, my, mx, my, "m d"), ln(mx, my, mx, 172, "m d"), rect(mx - 3, my - 3, 6, 6, 1, "f"));
  return o;
};

// -- ecology & evolution
A["ecology"] = () => {
  const r = rng(8), lv = [[164, 5, 4], [124, 4, 6], [84, 3, 6.5], [40, 2, 7.5]], N = lv.map(([y, n, rd]) => Array.from({ length: n }, (_, i) => [44 + ((i + 0.5) / n) * 272 + (r() - 0.5) * 10, y, rd])), o = [];
  for (let l = 0; l < 3; l++) N[l + 1].forEach(top => { const near = [...N[l]].sort((a, b) => Math.abs(a[0] - top[0]) - Math.abs(b[0] - top[0])); near.slice(0, 2 + (r() > 0.6 ? 1 : 0)).forEach(b => o.push(edge(top, b, top[2], b[2], "m"))); });
  N.forEach((row, l) => row.forEach(p => o.push(l === 0 ? dot(p[0], p[1], 4.6) : circ(p[0], p[1], p[2]))));
  return o;
};
A["phylogeny"] = () => {
  const T = [[["a", "b"], ["c", ["d", "e"]]], [["f", "g"], "h"]], o = [];
  let leaf = 0; const ys = [];
  const lay = n => { if (typeof n === "string") { const y = 30 + (leaf++) * 18.6; ys.push(y); return { x: 300, y, h: 0 }; } const k = n.map(lay); const h = Math.max(...k.map(c => c.h)) + 1; const x = 300 - h * 54; o.push(ln(x, k[0].y, x, k.at(-1).y)); k.forEach(c => o.push(ln(x, c.y, c.x, c.y))); if (k.every(c => c.h === 0)) k.forEach(c => o.push(dot(c.x, c.y, 2.6))); return { x, y: (k[0].y + k.at(-1).y) / 2, h }; };
  const root = lay(T); o.push(ln(36, root.y, root.x, root.y));
  ys.forEach(y => o.push(dot(300, y, 2.6)));
  o.push(ln(80, 178, 134, 178, "m"), ln(80, 174, 80, 182, "m"), ln(134, 174, 134, 182, "m"));
  return o;
};

// -- mathematics
A["mathematics"] = () => {
  const f = u => 1.15 + 0.78 * Math.sin(u * 1.1) + 0.12 * Math.sin(u * 3), X = u => 40 + u * 50, Y = v => 168 - v * 58, o = [axes(40, 168, 336, 18)];
  for (let i = 0; i < 8; i++) { const u = 0.6 + i * 0.4; o.push(rect(X(u), Y(f(u)), 0.4 * 50, 168 - Y(f(u)), 0, "m")); }
  o.push(plot(u => [X(u), Y(f(u))], 0.1, 5.7, 120));
  const u0 = 4.7, d = (f(u0 + 0.01) - f(u0 - 0.01)) / 0.02, p = [X(u0), Y(f(u0))], k = 36;
  o.push(ln(p[0] - k, p[1] + d * 58 * (k / 50), p[0] + k, p[1] - d * 58 * (k / 50), "d"), dot(p[0], p[1], 3.4));
  return o;
};
A["parametric-curves"] = () => [rect(70, 22, 220, 156, 0, "g"), ln(180, 22, 180, 178, "g"), ln(70, 100, 290, 100, "g"), plot(t => [180 + 110 * Math.sin(3 * t + Math.PI / 2), 100 + 78 * Math.sin(2 * t)], 0, 2 * Math.PI, 260), dot(180 + 110 * Math.sin(3 * 1.1 + Math.PI / 2), 100 + 78 * Math.sin(2 * 1.1), 3.6)];

// -- computing
A["computing"] = () => {
  const o = [rect(115, 38, 130, 124, 8)];
  for (let i = 0; i < 6; i++) { const x = 129 + i * 20.4; o.push(ln(x, 26, x, 38), ln(x, 162, x, 174)); }
  for (let i = 0; i < 5; i++) { const y = 52 + i * 24; o.push(ln(103, y, 115, y), ln(245, y, 257, y)); }
  [[126, 50], [184, 50], [126, 90], [184, 90]].forEach(([x, y]) => { o.push(rect(x, y, 50, 30, 4)); o.push(ln(x + 8, y + 15, x + 42, y + 15, "m")); });
  o.push(rect(126, 128, 108, 20, 4, "t", ' fill-opacity=".14"'), rect(126, 128, 108, 20, 4));
  return o;
};
A["circuit-board"] = () => {
  const o = [rect(148, 64, 64, 72, 4)];
  for (let i = 0; i < 5; i++) {
    const py = 74 + i * 13, ty = 28 + i * 36, dl = Math.abs(ty - py), dr = Math.abs((200 - ty) + 0 - 0);
    o.push(ln(140, py, 148, py, "")); o.push(ln(212, py, 220, py, ""));
    o.push(pl([[140, py], [132, py], [132 - dl, ty], [54 - (i % 2) * 8, ty]], ""));
    o.push(pl([[220, py], [228, py], [228 + dl, 200 - ty], [306 + (i % 2) * 8, 200 - ty]], ""));
    o.push(circ(54 - (i % 2) * 8, ty, 4), circ(306 + (i % 2) * 8, 200 - ty, 4)); void dr;
  }
  o.push(circ(113, 100, 2.6, "f"), circ(247, 100, 2.6, "f"), dot(180, 100, 3), circ(180, 100, 9, "m"));
  return o;
};

// -- security
A["security"] = () => {
  const s = 36, X = x => 180 + s * (x - 0.4), Y = y => 100 - s * y, c = x => x ** 3 - 2 * x + 2, x0 = -1.76, x1 = 2.05, o = [axes(40, 100, 336, 100 - 0, "m")];
  o.splice(0, 1, ln(30, 100, 336, 100, "g"), ln(X(0), 20, X(0), 182, "g"));
  const up = [], dn = []; for (let x = x0; x <= x1; x += 0.02) { const y = Math.sqrt(Math.max(c(x), 0)); up.push([X(x), Y(y)]); dn.push([X(x), Y(-y)]); }
  o.push(pl([...dn.reverse(), ...up]));
  const P = [-1.6, Math.sqrt(c(-1.6))], Q = [0.3, Math.sqrt(c(0.3))], m = (Q[1] - P[1]) / (Q[0] - P[0]), xr = m * m - P[0] - Q[0], yr = P[1] + m * (xr - P[0]);
  o.push(ln(X(-1.9), Y(P[1] + m * (-1.9 - P[0])), X(2.4), Y(P[1] + m * (2.4 - P[0])), "m d"), ln(X(xr), Y(yr), X(xr), Y(-yr), "m d"));
  [P, Q].forEach(p => o.push(dot(X(p[0]), Y(p[1]), 3.6))); o.push(circ(X(xr), Y(yr), 4)); o.push(dot(X(xr), Y(-yr), 3.6));
  return o;
};
A["merkle-tree"] = () => {
  const lv = [[30, 1], [74, 2], [118, 4], [162, 8]], pos = lv.map(([y, n]) => Array.from({ length: n }, (_, i) => [180 + (i - (n - 1) / 2) * (8 / n) * 38, y])), o = [], W2 = [22, 20, 18, 16];
  const auth = [[0, 0], [1, 1], [2, 2], [3, 5]];
  for (let l = 0; l < 3; l++) pos[l + 1].forEach((c, i) => { const p = pos[l][Math.floor(i / 2)], on = auth.some(([al, ai]) => al === l + 1 && ai === i) && auth.some(([al, ai]) => al === l && ai === Math.floor(i / 2)); o.push(ln(p[0], p[1] + 8, c[0], c[1] - 8, on ? "" : "m")); });
  pos.forEach((row, l) => row.forEach((p, i) => { const on = auth.some(([al, ai]) => al === l && ai === i); o.push(rect(p[0] - W2[l] / 2, p[1] - 8, W2[l], 16, 4, on ? "f" : "", on ? ' fill-opacity=".3"' : ""), on ? rect(p[0] - W2[l] / 2, p[1] - 8, W2[l], 16, 4) : ""); }));
  return o;
};

// -- medicine
A["medicine"] = () => {
  const o = [axes(44, 172, 336, 20)], S = (arr, x0, x1) => { const n = arr.length; let d = `M${x0} ${172 - arr[0] * 142}`; for (let i = 1; i < n; i++) { const x = x0 + (i * (x1 - x0)) / (n - 1); d += `H${fmt(x)}V${fmt(172 - arr[i] * 142)}`; } return d; };
  const a = [1, 0.95, 0.9, 0.85, 0.8, 0.74, 0.69, 0.64, 0.59, 0.55, 0.52, 0.5], b = [1, 0.9, 0.82, 0.72, 0.62, 0.52, 0.43, 0.36, 0.3, 0.25, 0.21, 0.19];
  o.push(ln(44, 101, 336, 101, "g"));
  o.push(raw(S(a.map(v => v + 0.045), 54, 324), "m d"), raw(S(a.map(v => v - 0.045), 54, 324), "m d"), raw(S(a, 54, 324)), raw(S(b, 54, 324), "m"));
  [[3, a], [6, a], [9, a], [4, b], [8, b]].forEach(([i, arr]) => { const x = 54 + i * 27.3 + 11, y = 172 - arr[i] * 142; o.push(ln(x, y - 4, x, y + 4, arr === a ? "" : "m")); });
  o.push(ln(54 + 5.3 * 27.3, 101, 54 + 5.3 * 27.3, 172, "m d"));
  return o;
};
A["heartbeat"] = () => {
  const o = [], x0 = 24, x1 = 336, y0 = 30, y1 = 170;
  for (let x = x0; x <= x1; x += 10) o.push(ln(x, y0, x, y1, x % 50 === 4 ? "m" : "g"));
  for (let y = y0; y <= y1; y += 10) o.push(ln(x0, y, x1, y, (y - y0) % 50 === 0 ? "m" : "g"));
  const g = (t, c, a, w) => a * Math.exp(-(((t - c) / w) ** 2)), beat = t => g(t, -34, 7, 8) + g(t, -9, -8, 2.2) + g(t, 0, 66, 2.6) + g(t, 7, -15, 2.8) + g(t, 36, 14, 11);
  o.push(plot(x => { let v = 0; for (const c of [66, 176, 286]) v += beat(x - c); return [x, 104 - v]; }, x0, x1, 312));
  return o;
};

// ---------- write ----------
const STYLE = `<style>path,rect,circle,ellipse{fill:none;stroke:#e4e4e4;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.f{fill:#e4e4e4;stroke:none}.t{fill:#e4e4e4;stroke:none}.m{opacity:.4}.g{opacity:.14}.d{stroke-dasharray:3 5}</style>`;
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".svg")) fs.unlinkSync(OUT + f);
for (const [id, make] of Object.entries(A)) {
  const body = make().filter(Boolean).join("");
  fs.writeFileSync(`${OUT}${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" fill="none">${STYLE}<g opacity=".9">${body}</g></svg>\n`);
}
console.log(`wrote ${Object.keys(A).length} illustrations`);
