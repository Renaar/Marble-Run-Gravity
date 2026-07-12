'use strict';

/* =====================================================================
 * Banque d'éléments du parcours.
 *
 * Chaque élément est décrit par :
 *  - polylines(el) : liste de polylignes de collision en coordonnées
 *    locales (y vers le bas). Une polyligne marquée `rotating: true`
 *    tourne autour de l'origine locale selon el.theta (roue, bascule).
 *  - circles(el)   : colliders circulaires statiques optionnels.
 *  - draw(ctx, el) : dessin en espace local (le contexte est déjà
 *    translaté / tourné / miroité par le moteur de rendu).
 *  - dynamic       : l'élément possède un degré de liberté en rotation
 *    (theta / omega), entraîné par les impacts des billes.
 * ===================================================================== */

const TAU = Math.PI * 2;
const MARBLE_R = 9;

const COL = {
  rail: '#2b2724',
  railHi: '#4a443f',
  orange: '#d3752b',
  orangeHi: '#e89a55',
  orangeDark: '#9c5517',
  mount: '#c6cad1',
  mountEdge: '#8d939c',
  gold: '#e0a927',
  goldDark: '#a97e14',
};

/* ---------- petits utilitaires géométriques ---------- */

function rotPt(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function arcPts(cx, cy, R, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return pts;
}

/* ---------- aides au dessin ---------- */

function strokePolyline(ctx, pts, color, w) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/* Support hexagonal gris, comme les aimants du jeu d'origine. */
function drawMount(ctx, x, y, r = 7) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * TAU / 6;
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = COL.mount;
  ctx.fill();
  ctx.strokeStyle = COL.mountEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2.2, 0, TAU);
  ctx.fillStyle = COL.mountEdge;
  ctx.fill();
}

function drawRailWithMounts(ctx, pts, color = COL.rail, w = 6) {
  drawMount(ctx, pts[0].x, pts[0].y);
  drawMount(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y);
  strokePolyline(ctx, pts, color, w);
}

/* =====================================================================
 * Définitions
 * ===================================================================== */

const DEFS = {

  /* ------------------------------------------------ Lanceur -------- */
  lanceur: {
    label: 'Lanceur',
    selR: 40,
    preview: 0.72,
    spawn: { x: 0, y: -16 },
    polylines() {
      /* l'ouverture doit dépasser 2 × (rayon de bille + demi-épaisseur
         de rail) = 24 px pour laisser passer les billes */
      return [
        { pts: [{ x: -28, y: -32 }, { x: -14, y: 8 }], rest: 0.1, fric: 0.002 },
        { pts: [{ x: 28, y: -32 }, { x: 14, y: 8 }], rest: 0.1, fric: 0.002 },
      ];
    },
    draw(ctx, el) {
      ctx.fillStyle = 'rgba(211,117,43,0.10)';
      ctx.beginPath();
      ctx.moveTo(-28, -32); ctx.lineTo(-14, 8);
      ctx.lineTo(14, 8); ctx.lineTo(28, -32);
      ctx.closePath();
      ctx.fill();
      strokePolyline(ctx, [{ x: -28, y: -32 }, { x: -14, y: 8 }], COL.orange, 5);
      strokePolyline(ctx, [{ x: 28, y: -32 }, { x: 14, y: 8 }], COL.orange, 5);
      /* flèche vers le bas */
      ctx.strokeStyle = 'rgba(43,39,36,0.35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 14); ctx.lineTo(0, 28);
      ctx.moveTo(-5, 22); ctx.lineTo(0, 28); ctx.lineTo(5, 22);
      ctx.stroke();
      /* bille fantôme dans la trémie */
      ctx.beginPath();
      ctx.arc(0, -14, MARBLE_R, 0, TAU);
      ctx.strokeStyle = 'rgba(47,111,214,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    },
  },

  /* ------------------------------------------------ Rails ---------- */
  rail: {
    label: 'Rail',
    selR: 80,
    preview: 0.52,
    defaultAngle: 0.14,
    polylines() {
      return [{ pts: [{ x: -70, y: 0 }, { x: 70, y: 0 }], rest: 0.12, fric: 0.0012 }];
    },
    draw(ctx) {
      drawRailWithMounts(ctx, [{ x: -70, y: 0 }, { x: 70, y: 0 }]);
    },
  },

  'rail-long': {
    label: 'Rail long',
    selR: 130,
    preview: 0.34,
    defaultAngle: 0.14,
    polylines() {
      return [{ pts: [{ x: -120, y: 0 }, { x: 120, y: 0 }], rest: 0.12, fric: 0.0012 }];
    },
    draw(ctx) {
      drawMount(ctx, 0, 0);
      drawRailWithMounts(ctx, [{ x: -120, y: 0 }, { x: 120, y: 0 }]);
    },
  },

  /* ------------------------------------------------ Virage --------- */
  virage: {
    label: 'Virage',
    selR: 95,
    preview: 0.44,
    polylines() {
      /* quart de cercle : réceptionne une chute et renvoie vers la droite */
      return [{ pts: arcPts(40, -40, 80, Math.PI, Math.PI / 2, 14), rest: 0.08, fric: 0.001 }];
    },
    draw(ctx) {
      const pts = arcPts(40, -40, 80, Math.PI, Math.PI / 2, 20);
      drawMount(ctx, pts[0].x, pts[0].y);
      drawMount(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y);
      strokePolyline(ctx, pts, COL.orange, 7);
      strokePolyline(ctx, pts, COL.orangeHi, 2.5);
    },
  },

  /* ------------------------------------------------ Demi-lune ------ */
  demilune: {
    label: 'Demi-lune',
    selR: 70,
    preview: 0.55,
    polylines() {
      /* demi-cercle en U : la bille oscille comme dans un half-pipe */
      return [{ pts: arcPts(0, -22, 58, Math.PI, 0, 18), rest: 0.08, fric: 0.001 }];
    },
    draw(ctx) {
      const pts = arcPts(0, -22, 58, Math.PI, 0, 24);
      drawMount(ctx, pts[0].x, pts[0].y);
      drawMount(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y);
      strokePolyline(ctx, pts, COL.orange, 7);
      strokePolyline(ctx, pts, COL.orangeHi, 2.5);
    },
  },

  /* ------------------------------------------------ Escalier ------- */
  escalier: {
    label: 'Escalier',
    selR: 95,
    preview: 0.42,
    polylines() {
      const pts = [];
      let x = -80, y = -35;
      pts.push({ x, y });
      for (let i = 0; i < 5; i++) {
        x += 32; pts.push({ x, y });
        y += 14; pts.push({ x, y });
      }
      return [{ pts, rest: 0.28, fric: 0.002 }];
    },
    draw(ctx, el) {
      const pts = DEFS.escalier.polylines(el)[0].pts;
      drawMount(ctx, pts[0].x, pts[0].y);
      drawMount(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y);
      strokePolyline(ctx, pts, COL.rail, 5);
    },
  },

  /* ------------------------------------------------ Entonnoir ------ */
  entonnoir: {
    label: 'Entonnoir',
    selR: 65,
    preview: 0.52,
    polylines() {
      return [
        { pts: [{ x: -54, y: -42 }, { x: -15, y: 22 }, { x: -15, y: 42 }], rest: 0.1, fric: 0.002 },
        { pts: [{ x: 54, y: -42 }, { x: 15, y: 22 }, { x: 15, y: 42 }], rest: 0.1, fric: 0.002 },
      ];
    },
    draw(ctx) {
      ctx.fillStyle = 'rgba(211,117,43,0.10)';
      ctx.beginPath();
      ctx.moveTo(-54, -42); ctx.lineTo(-15, 22); ctx.lineTo(-15, 42);
      ctx.lineTo(15, 42); ctx.lineTo(15, 22); ctx.lineTo(54, -42);
      ctx.closePath();
      ctx.fill();
      strokePolyline(ctx, [{ x: -54, y: -42 }, { x: -15, y: 22 }, { x: -15, y: 42 }], COL.orange, 6);
      strokePolyline(ctx, [{ x: 54, y: -42 }, { x: 15, y: 22 }, { x: 15, y: 42 }], COL.orange, 6);
      /* bandeaux décoratifs comme sur l'entonnoir du jeu d'origine */
      ctx.strokeStyle = COL.orangeDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-40, -22); ctx.lineTo(40, -22);
      ctx.moveTo(-29, -4); ctx.lineTo(29, -4);
      ctx.stroke();
    },
  },

  /* ------------------------------------------------ Roue ----------- */
  roue: {
    label: 'Roue',
    selR: 66,
    preview: 0.6,
    dynamic: true,
    inertia: 25000,
    damping: 0.9995,
    maxOmega: 4,
    polylines() {
      const out = [];
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3;
        const pts = [{ x: 6, y: 0 }, { x: 52, y: 0 }, { x: 52, y: -16 }].map(p => rotPt(p, a));
        out.push({ pts, rotating: true, rest: 0.15, fric: 0.008 });
      }
      return out;
    },
    circles() {
      return [{ x: 0, y: 0, r: 11, rest: 0.3 }];
    },
    draw(ctx, el) {
      ctx.save();
      ctx.rotate(el.theta);
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.rotate(k * TAU / 3);
        strokePolyline(ctx, [{ x: 6, y: 0 }, { x: 52, y: 0 }], COL.orange, 7);
        strokePolyline(ctx, [{ x: 52, y: 0 }, { x: 52, y: -16 }], COL.orange, 5);
        strokePolyline(ctx, [{ x: 10, y: 0 }, { x: 48, y: 0 }], COL.orangeHi, 2);
        ctx.restore();
      }
      ctx.restore();
      /* moyeu */
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, TAU);
      ctx.fillStyle = COL.mount;
      ctx.fill();
      ctx.strokeStyle = COL.mountEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, TAU);
      ctx.fillStyle = COL.mountEdge;
      ctx.fill();
    },
  },

  /* ------------------------------------------------ Bascule -------- */
  bascule: {
    label: 'Bascule',
    selR: 88,
    preview: 0.48,
    dynamic: true,
    inertia: 30000,
    damping: 0.999,
    maxOmega: 3,
    limits: [-0.38, 0.38],
    polylines() {
      return [
        { pts: [{ x: -78, y: 0 }, { x: 78, y: 0 }], rotating: true, rest: 0.1, fric: 0.003 },
        { pts: [{ x: -78, y: 0 }, { x: -78, y: -12 }], rotating: true, rest: 0.1, fric: 0.003 },
        { pts: [{ x: 78, y: 0 }, { x: 78, y: -12 }], rotating: true, rest: 0.1, fric: 0.003 },
      ];
    },
    circles() {
      return [{ x: 0, y: 10, r: 6, rest: 0.2 }];
    },
    draw(ctx, el) {
      /* pied */
      ctx.beginPath();
      ctx.moveTo(0, 2); ctx.lineTo(-12, 22); ctx.lineTo(12, 22);
      ctx.closePath();
      ctx.fillStyle = COL.mount;
      ctx.fill();
      ctx.strokeStyle = COL.mountEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      /* planche */
      ctx.save();
      ctx.rotate(el.theta);
      strokePolyline(ctx, [{ x: -78, y: 0 }, { x: 78, y: 0 }], COL.orange, 7);
      strokePolyline(ctx, [{ x: -78, y: 0 }, { x: -78, y: -12 }], COL.orange, 5);
      strokePolyline(ctx, [{ x: 78, y: 0 }, { x: 78, y: -12 }], COL.orange, 5);
      ctx.restore();
      /* axe */
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, TAU);
      ctx.fillStyle = COL.mountEdge;
      ctx.fill();
    },
  },

  /* ------------------------------------------------ Trampoline ----- */
  bumper: {
    label: 'Trampoline',
    selR: 42,
    preview: 0.8,
    polylines() {
      return [{ pts: [{ x: -28, y: 0 }, { x: 28, y: 0 }], rest: 0.9, fric: 0, boost: 420 }];
    },
    draw(ctx) {
      drawMount(ctx, -28, 8);
      drawMount(ctx, 28, 8);
      strokePolyline(ctx, [{ x: -28, y: 8 }, { x: 28, y: 8 }], COL.rail, 4);
      /* ressorts */
      ctx.strokeStyle = COL.mountEdge;
      ctx.lineWidth = 2;
      for (const sx of [-16, 0, 16]) {
        ctx.beginPath();
        ctx.moveTo(sx, 8);
        ctx.lineTo(sx - 3, 5); ctx.lineTo(sx + 3, 2); ctx.lineTo(sx, 0);
        ctx.stroke();
      }
      strokePolyline(ctx, [{ x: -28, y: 0 }, { x: 28, y: 0 }], COL.orange, 6);
    },
  },

  /* ------------------------------------------------ Cloche --------- */
  cloche: {
    label: 'Cloche',
    selR: 38,
    preview: 0.85,
    /* la cloche ne bloque pas les billes : elle tinte à leur passage */
    bellSensor: { x: 0, y: 10, r: 18 },
    draw(ctx, el) {
      /* potence */
      strokePolyline(ctx, [{ x: 0, y: -28 }, { x: 0, y: -8 }], COL.rail, 3);
      drawMount(ctx, 0, -28, 6);
      /* cloche dorée, se balançant après un impact */
      ctx.save();
      if (el.ring > 0) {
        const t = 1 - el.ring / 0.5;
        ctx.translate(0, -6);
        ctx.rotate(Math.sin(t * 22) * 0.4 * (el.ring / 0.5));
        ctx.translate(0, 6);
      }
      ctx.beginPath();
      ctx.arc(0, 8, 12, Math.PI, 0);
      ctx.lineTo(15, 16);
      ctx.quadraticCurveTo(0, 20, -15, 16);
      ctx.closePath();
      ctx.fillStyle = COL.gold;
      ctx.fill();
      ctx.strokeStyle = COL.goldDark;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 20, 3, 0, TAU);
      ctx.fillStyle = COL.goldDark;
      ctx.fill();
      ctx.restore();
      /* onde sonore lors d'un impact */
      if (el.ring > 0) {
        const t = 1 - el.ring / 0.5;
        ctx.beginPath();
        ctx.arc(0, 10, 16 + t * 26, 0, TAU);
        ctx.strokeStyle = `rgba(224,169,39,${(1 - t) * 0.8})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    },
  },

  /* ------------------------------------------------ Panier --------- */
  panier: {
    label: 'Panier',
    selR: 58,
    preview: 0.58,
    sensor: { x0: -38, x1: 38, y0: -30, y1: 24 },
    polylines() {
      return [{
        pts: [{ x: -42, y: -34 }, { x: -42, y: 26 }, { x: 42, y: 26 }, { x: 42, y: -34 }],
        rest: 0.2, fric: 0.02,
      }];
    },
    draw(ctx) {
      ctx.fillStyle = 'rgba(43,39,36,0.06)';
      ctx.fillRect(-42, -34, 84, 60);
      const pts = [{ x: -42, y: -34 }, { x: -42, y: 26 }, { x: 42, y: 26 }, { x: 42, y: -34 }];
      strokePolyline(ctx, pts, COL.rail, 6);
      drawMount(ctx, -42, -34);
      drawMount(ctx, 42, -34);
      /* drapeau d'arrivée */
      ctx.fillStyle = COL.gold;
      ctx.beginPath();
      ctx.moveTo(42, -34); ctx.lineTo(62, -28); ctx.lineTo(42, -22);
      ctx.closePath();
      ctx.fill();
    },
  },
};

/* Ordre d'affichage dans la palette */
const PALETTE_ORDER = [
  'lanceur', 'rail', 'rail-long', 'virage', 'demilune', 'escalier',
  'entonnoir', 'roue', 'bascule', 'bumper', 'cloche', 'panier',
];

/* ---------- transformations locales <-> monde ---------- */

function localToWorld(el, p, theta) {
  let x = p.x, y = p.y;
  if (theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    const nx = x * c - y * s, ny = x * s + y * c;
    x = nx; y = ny;
  }
  if (el.flip) x = -x;
  const c = Math.cos(el.angle), s = Math.sin(el.angle);
  return { x: el.x + x * c - y * s, y: el.y + x * s + y * c };
}

function worldToLocal(el, wx, wy) {
  const dx = wx - el.x, dy = wy - el.y;
  const c = Math.cos(-el.angle), s = Math.sin(-el.angle);
  let x = dx * c - dy * s, y = dx * s + dy * c;
  if (el.flip) x = -x;
  return { x, y };
}
