'use strict';

/* =====================================================================
 * Moteur du jeu : monde, physique, rendu, sons.
 *
 * Le monde a une taille fixe (WORLD_W × WORLD_H) et le canvas est mis
 * à l'échelle pour l'afficher en entier, ce qui rend les sauvegardes
 * indépendantes de la taille de l'écran.
 * ===================================================================== */

const WORLD_W = 1280;
const WORLD_H = 760;
const GRAVITY = 1500;          // px/s²
const MAX_SPEED = 1500;        // vitesse max d'une bille
const SUBSTEPS = 4;            // sous-pas physiques par image
const RAIL_HALF_THICK = 3;     // demi-épaisseur des rails pour la collision
const MAX_MARBLES = 80;
const TRAIL_MAX_POINTS = 600;   // par bille
const TRAIL_MAX_DEAD = 40;      // traces conservées après disparition
const HUE_STEP = 137.508;       // angle d'or : couleurs successives bien distinctes

/* ------------------------------------------------------------------ */
/* Sons (WebAudio, généré à la volée : aucun fichier nécessaire)      */
/* ------------------------------------------------------------------ */

const SFX = {
  ctx: null,
  muted: false,
  lastTick: 0,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  beep(freq, dur, type = 'sine', gain = 0.12, when = 0) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  warp() {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t0);
    osc.frequency.exponentialRampToValueAtTime(950, t0 + 0.18);
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  },

  pop()   { this.beep(340, 0.08, 'triangle', 0.15); },
  click() { this.beep(820, 0.04, 'square', 0.05); },
  ding()  { this.beep(1568, 0.5, 'sine', 0.14); this.beep(2349, 0.6, 'sine', 0.08); },
  score() { this.beep(660, 0.12, 'triangle', 0.12); this.beep(880, 0.14, 'triangle', 0.12, 0.09); this.beep(1320, 0.2, 'triangle', 0.12, 0.18); },

  tick(strength) {
    const now = performance.now();
    if (now - this.lastTick < 40) return;
    this.lastTick = now;
    this.beep(150 + Math.min(strength, 600) / 3, 0.03, 'triangle', 0.05);
  },
};

/* ------------------------------------------------------------------ */
/* Jeu                                                                */
/* ------------------------------------------------------------------ */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.elements = [];
    this.marbles = [];
    this.effects = [];        // petits "+1" flottants
    this.selected = null;
    this.playing = true;
    this.autoDrop = false;
    this.autoTimer = 0;
    this.score = 0;
    this.nextId = 1;
    this.marbleSeq = 0;       // numéro de bille, pour la couleur
    this.showTrails = false;
    this.deadTrails = [];     // traces des billes disparues
    this.onScore = null;      // callback UI
    this.onEdit = null;       // callback sauvegarde auto

    /* transformation monde -> écran */
    this.view = { scale: 1, ox: 0, oy: 0 };
  }

  /* ---------------- gestion des éléments ---------------- */

  addElement(type, x, y, angle, flip) {
    const def = DEFS[type];
    if (!def) return null;
    const el = {
      id: this.nextId++,
      type,
      x, y,
      angle: angle !== undefined ? angle : (def.defaultAngle || 0),
      flip: !!flip,
      theta: 0,
      omega: 0,
      inertia: def.inertia || 1,
      ring: 0,
    };
    if (def.init) def.init(el);
    this.elements.push(el);
    return el;
  }

  removeElement(el) {
    const i = this.elements.indexOf(el);
    if (i >= 0) this.elements.splice(i, 1);
    if (this.selected === el) this.selected = null;
    this.edited();
  }

  clearElements() {
    this.elements = [];
    this.selected = null;
    this.edited();
  }

  edited() {
    if (this.onEdit) this.onEdit();
  }

  serialize() {
    return this.elements.map(el => [el.type, Math.round(el.x), Math.round(el.y),
      +el.angle.toFixed(3), el.flip ? 1 : 0]);
  }

  load(data) {
    this.elements = [];
    this.marbles = [];
    this.selected = null;
    for (const [type, x, y, angle, flip] of data) {
      if (DEFS[type]) this.addElement(type, x, y, angle || 0, !!flip);
    }
  }

  /* ---------------- billes ---------------- */

  spawnMarble(x, y, vx = 0, vy = 0) {
    if (this.marbles.length >= MAX_MARBLES) this.retireMarble(this.marbles.shift());
    const hue = Math.round((this.marbleSeq++ * HUE_STEP) % 360);
    this.marbles.push({
      x, y, vx, vy,
      r: MARBLE_R,
      color: `hsl(${hue}, 72%, 50%)`,
      colorDark: `hsl(${hue}, 80%, 28%)`,
      colorLight: `hsl(${hue}, 65%, 88%)`,
      scored: false,
      held: false,
      portalCd: 0,
      trail: [],
    });
    SFX.pop();
  }

  /* conserve la trace d'une bille qui quitte le plateau */
  retireMarble(m) {
    if (m && m.trail.length > 1) {
      this.deadTrails.push({ color: m.color, pts: m.trail });
      if (this.deadTrails.length > TRAIL_MAX_DEAD) this.deadTrails.shift();
    }
  }

  dropFromLaunchers() {
    const launchers = this.elements.filter(e => e.type === 'lanceur');
    if (launchers.length === 0) {
      this.spawnMarble(WORLD_W / 2, 30);
      return;
    }
    for (const el of launchers) {
      const p = localToWorld(el, DEFS.lanceur.spawn, 0);
      this.spawnMarble(p.x, p.y);
    }
  }

  clearMarbles() {
    for (const m of this.marbles) {
      if (!m.held) this.retireMarble(m);
    }
    this.marbles = this.marbles.filter(m => m.held);
  }

  clearTrails() {
    this.deadTrails = [];
    for (const m of this.marbles) {
      m.trail = [];
      m.lastTrailX = undefined;
    }
  }

  /* ---------------- physique ---------------- */

  step(dt) {
    if (this.playing) {
      if (this.autoDrop) {
        this.autoTimer += dt;
        if (this.autoTimer >= 2.0) {
          this.autoTimer = 0;
          this.dropFromLaunchers();
        }
      }
      const h = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) this.substep(h);
      this.checkSwitches();
      this.checkPortals(dt);
      this.checkBells();
      this.checkScoring();
      this.recordTrails();
      this.despawn();
    }
    /* effets visuels */
    for (const el of this.elements) if (el.ring > 0) el.ring -= dt;
    for (const fx of this.effects) fx.t -= dt;
    this.effects = this.effects.filter(fx => fx.t > 0);
  }

  substep(h) {
    /* intégration des billes */
    for (const m of this.marbles) {
      if (m.held) continue;
      m.vy += GRAVITY * h;
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > MAX_SPEED) { m.vx *= MAX_SPEED / sp; m.vy *= MAX_SPEED / sp; }
      m.x += m.vx * h;
      m.y += m.vy * h;
    }

    /* colliders du monde pour ce sous-pas */
    const segs = [];
    const circles = [];
    const EPS = 0.001;
    for (const el of this.elements) {
      const def = DEFS[el.type];
      if (def.polylines) {
        for (const poly of def.polylines(el)) {
          const theta = poly.rotating ? el.theta : 0;
          let prev = null, prevD = null;
          for (const p of poly.pts) {
            const w = localToWorld(el, p, theta);
            let d = null;
            if (poly.rotating) {
              const w2 = localToWorld(el, p, theta + EPS);
              d = { x: (w2.x - w.x) / EPS, y: (w2.y - w.y) / EPS };
            }
            if (prev) {
              segs.push({
                ax: prev.x, ay: prev.y, bx: w.x, by: w.y,
                dax: prevD ? prevD.x : 0, day: prevD ? prevD.y : 0,
                dbx: d ? d.x : 0, dby: d ? d.y : 0,
                rest: poly.rest, fric: poly.fric,
                boost: poly.boost || 0,
                belt: poly.belt || 0,
                rotating: !!poly.rotating,
                el,
              });
            }
            prev = w; prevD = d;
          }
        }
      }
      if (def.circles) {
        for (const c of def.circles(el)) {
          const w = localToWorld(el, c, 0);
          circles.push({ x: w.x, y: w.y, r: c.r, rest: c.rest, bell: !!c.bell, el });
        }
      }
    }

    /* collisions bille <-> décor */
    for (const m of this.marbles) {
      if (m.held) continue;

      for (const seg of segs) {
        const R = m.r + RAIL_HALF_THICK;
        /* rejet rapide par boîte englobante */
        if (m.x < Math.min(seg.ax, seg.bx) - R || m.x > Math.max(seg.ax, seg.bx) + R ||
            m.y < Math.min(seg.ay, seg.by) - R || m.y > Math.max(seg.ay, seg.by) + R) continue;

        const abx = seg.bx - seg.ax, aby = seg.by - seg.ay;
        const len2 = abx * abx + aby * aby;
        if (len2 === 0) continue;
        let t = ((m.x - seg.ax) * abx + (m.y - seg.ay) * aby) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = seg.ax + abx * t, qy = seg.ay + aby * t;
        let nx = m.x - qx, ny = m.y - qy;
        const d2 = nx * nx + ny * ny;
        if (d2 >= R * R) continue;

        let dist = Math.sqrt(d2);
        if (dist < 1e-6) {
          /* bille exactement sur le segment : normale perpendiculaire */
          const len = Math.sqrt(len2);
          nx = aby / len; ny = -abx / len;
          if (nx * m.vx + ny * m.vy > 0) { nx = -nx; ny = -ny; }
          dist = 1e-6;
        } else {
          nx /= dist; ny /= dist;
        }

        /* correction de position */
        const pen = R - dist;
        m.x += nx * pen;
        m.y += ny * pen;

        /* vitesse de surface (segments en rotation ou tapis roulants) */
        let svx = 0, svy = 0, dpx = 0, dpy = 0;
        if (seg.rotating) {
          dpx = seg.dax + (seg.dbx - seg.dax) * t;
          dpy = seg.day + (seg.dby - seg.day) * t;
          svx = dpx * seg.el.omega;
          svy = dpy * seg.el.omega;
        } else if (seg.belt) {
          const len = Math.sqrt(len2);
          svx = abx / len * seg.belt;
          svy = aby / len * seg.belt;
        }

        const rvx = m.vx - svx, rvy = m.vy - svy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          let rest = seg.rest;
          if (-vn < 60) rest = 0;               // pas de rebond à faible vitesse
          let outN = -vn * rest;
          if (seg.boost && -vn > 40) outN = Math.max(outN, seg.boost);
          const vtx = rvx - vn * nx, vty = rvy - vn * ny;
          const f = 1 - seg.fric;
          const nvx = vtx * f + nx * outN + svx;
          const nvy = vty * f + ny * outN + svy;
          const impX = nvx - m.vx, impY = nvy - m.vy;
          m.vx = nvx;
          m.vy = nvy;

          /* couple transmis à l'élément (approche coordonnée généralisée :
             tau = -impulsion · dP/dtheta) ; les éléments motorisés ne
             sont pas ralentis par les impacts */
          if (seg.rotating && !DEFS[seg.el.type].motor) {
            const def = DEFS[seg.el.type];
            const tau = -(impX * dpx + impY * dpy);
            seg.el.omega += tau / seg.el.inertia;
            if (def.maxOmega) {
              if (seg.el.omega > def.maxOmega) seg.el.omega = def.maxOmega;
              if (seg.el.omega < -def.maxOmega) seg.el.omega = -def.maxOmega;
            }
          }
          if (-vn > 260) SFX.tick(-vn);
        }
      }

      /* colliders circulaires (cloche, moyeux, pivots) */
      for (const c of circles) {
        const R = m.r + c.r;
        let nx = m.x - c.x, ny = m.y - c.y;
        const d2 = nx * nx + ny * ny;
        if (d2 >= R * R || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        nx /= dist; ny /= dist;
        m.x += nx * (R - dist);
        m.y += ny * (R - dist);
        const vn = m.vx * nx + m.vy * ny;
        if (vn < 0) {
          const rest = -vn < 60 ? 0 : c.rest;
          m.vx -= (1 + rest) * vn * nx;
          m.vy -= (1 + rest) * vn * ny;
          if (-vn > 260) SFX.tick(-vn);
        }
      }
    }

    /* collisions bille <-> bille */
    for (let i = 0; i < this.marbles.length; i++) {
      const a = this.marbles[i];
      for (let j = i + 1; j < this.marbles.length; j++) {
        const b = this.marbles[j];
        if (a.held && b.held) continue;
        let nx = b.x - a.x, ny = b.y - a.y;
        const R = a.r + b.r;
        const d2 = nx * nx + ny * ny;
        if (d2 >= R * R || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        nx /= dist; ny /= dist;
        const pen = R - dist;
        if (a.held) { b.x += nx * pen; b.y += ny * pen; }
        else if (b.held) { a.x -= nx * pen; a.y -= ny * pen; }
        else {
          a.x -= nx * pen / 2; a.y -= ny * pen / 2;
          b.x += nx * pen / 2; b.y += ny * pen / 2;
        }
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const rest = -vn < 60 ? 0 : 0.35;
          const jimp = -(1 + rest) * vn / 2;
          if (!a.held) { a.vx -= jimp * nx; a.vy -= jimp * ny; }
          if (!b.held) { b.vx += jimp * nx; b.vy += jimp * ny; }
        }
      }
    }

    /* intégration des éléments dynamiques (roue, bascule, hélice) */
    for (const el of this.elements) {
      const def = DEFS[el.type];
      if (!def.dynamic) continue;
      if (def.motor) {
        el.omega = def.motor;
        el.theta += el.omega * h;
        continue;
      }
      el.theta += el.omega * h;
      el.omega *= def.damping || 0.999;
      if (def.limits) {
        if (el.theta < def.limits[0]) { el.theta = def.limits[0]; el.omega *= -0.2; }
        if (el.theta > def.limits[1]) { el.theta = def.limits[1]; el.omega *= -0.2; }
      }
    }
  }

  checkSwitches() {
    for (const el of this.elements) {
      const zone = DEFS[el.type].switchZone;
      if (!zone) continue;
      let count = 0;
      for (const m of this.marbles) {
        const p = worldToLocal(el, m.x, m.y);
        if (Math.abs(p.x) < zone.x && p.y > zone.y0 && p.y < zone.y1) count++;
      }
      /* la langue change de côté quand la dernière bille est sortie */
      if (el.swWas > 0 && count === 0) {
        el.dir = -el.dir;
        SFX.click();
      }
      el.swWas = count;
    }
  }

  checkPortals(dt) {
    const portals = this.elements.filter(e => DEFS[e.type].portal);
    portals.forEach((p, i) => {
      p.pairIndex = i >> 1;
      p.pairActive = (i ^ 1) < portals.length;
    });
    for (const m of this.marbles) {
      if (m.portalCd > 0) m.portalCd -= dt;
    }
    for (let i = 0; i + 1 < portals.length; i += 2) {
      for (const m of this.marbles) {
        if (m.held || m.portalCd > 0) continue;
        for (let k = 0; k < 2; k++) {
          const from = portals[i + k], to = portals[i + 1 - k];
          if (Math.hypot(m.x - from.x, m.y - from.y) < DEFS.portail.sensorR + m.r) {
            m.x = to.x;
            m.y = to.y;
            m.portalCd = 0.5;      // évite l'aller-retour instantané
            m.trail.push(null);    // coupe la trace pendant la téléportation
            m.lastTrailX = undefined;
            SFX.warp();
            break;
          }
        }
      }
    }
  }

  checkBells() {
    for (const el of this.elements) {
      const sensor = DEFS[el.type].bellSensor;
      if (!sensor || el.ring > 0) continue;
      const c = localToWorld(el, sensor, 0);
      for (const m of this.marbles) {
        if (Math.hypot(m.x - c.x, m.y - c.y) < sensor.r + m.r &&
            Math.hypot(m.vx, m.vy) > 100) {
          el.ring = 0.5;
          el.dings = (el.dings || 0) + 1;
          SFX.ding();
          break;
        }
      }
    }
  }

  checkScoring() {
    const baskets = this.elements.filter(e => e.type === 'panier');
    if (baskets.length === 0) return;
    for (const m of this.marbles) {
      if (m.scored) continue;
      for (const el of baskets) {
        const p = worldToLocal(el, m.x, m.y);
        const s = DEFS.panier.sensor;
        if (p.x > s.x0 && p.x < s.x1 && p.y > s.y0 && p.y < s.y1 &&
            Math.hypot(m.vx, m.vy) < 120) {
          m.scored = true;
          this.score++;
          this.effects.push({ x: m.x, y: m.y - 20, t: 1.2, text: '+1' });
          SFX.score();
          if (this.onScore) this.onScore(this.score);
          break;
        }
      }
    }
  }

  recordTrails() {
    /* on mémorise toujours la trajectoire : activer l'affichage plus
       tard montre aussi le passé récent */
    for (const m of this.marbles) {
      if (m.lastTrailX === undefined ||
          Math.hypot(m.x - m.lastTrailX, m.y - m.lastTrailY) > 7) {
        m.trail.push([m.x, m.y]);
        m.lastTrailX = m.x;
        m.lastTrailY = m.y;
        if (m.trail.length > TRAIL_MAX_POINTS) m.trail.shift();
      }
    }
  }

  despawn() {
    const keep = [];
    for (const m of this.marbles) {
      if (m.held || (m.y < WORLD_H + 80 && m.x > -80 && m.x < WORLD_W + 80)) {
        keep.push(m);
      } else {
        this.retireMarble(m);
      }
    }
    this.marbles = keep;
  }

  /* ---------------- vue / rendu ---------------- */

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    this.view.scale = scale;
    this.view.ox = (rect.width - WORLD_W * scale) / 2;
    this.view.oy = (rect.height - WORLD_H * scale) / 2;
    this.dpr = dpr;
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.view.ox) / this.view.scale,
      y: (sy - this.view.oy) / this.view.scale,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.view.scale + this.view.ox,
      y: wy * this.view.scale + this.view.oy,
    };
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { scale, ox, oy } = this.view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#e9e6e0';
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    /* plateau blanc quadrillé */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = 'rgba(140,150,160,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); }
    for (let y = 0; y <= WORLD_H; y += 32) { ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); }
    ctx.stroke();
    ctx.strokeStyle = '#c9c4bb';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    /* éléments */
    for (const el of this.elements) {
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.rotate(el.angle);
      if (el.flip) ctx.scale(-1, 1);
      DEFS[el.type].draw(ctx, el);
      ctx.restore();

      if (el === this.selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(211,117,43,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.arc(el.x, el.y, (DEFS[el.type].selR || 50) + 8, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* traces des trajectoires */
    if (this.showTrails) {
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.5;
      for (const tr of this.deadTrails) strokeTrail(ctx, tr.pts, tr.color);
      for (const m of this.marbles) strokeTrail(ctx, m.trail, m.color);
      ctx.restore();
    }

    /* billes */
    for (const m of this.marbles) {
      ctx.beginPath();
      ctx.arc(m.x, m.y + 2, m.r, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fill();
      const g = ctx.createRadialGradient(m.x - 3, m.y - 3, 1, m.x, m.y, m.r);
      g.addColorStop(0, m.colorLight);
      g.addColorStop(0.35, m.color);
      g.addColorStop(1, m.colorDark);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(m.x - 3.2, m.y - 3.5, 2.2, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
    }

    /* effets "+1" */
    for (const fx of this.effects) {
      const a = Math.min(1, fx.t);
      ctx.fillStyle = `rgba(211,117,43,${a})`;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fx.text, fx.x, fx.y - (1.2 - fx.t) * 34);
    }
  }

  /* ---------------- sélection / interactions ---------------- */

  hitTestElement(wx, wy) {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      const def = DEFS[el.type];
      if (Math.hypot(wx - el.x, wy - el.y) < 26) return el;
      if (def.polylines) {
        for (const poly of def.polylines(el)) {
          const theta = poly.rotating ? el.theta : 0;
          let prev = null;
          for (const p of poly.pts) {
            const w = localToWorld(el, p, theta);
            if (prev && distToSegment(wx, wy, prev.x, prev.y, w.x, w.y) < 14) return el;
            prev = w;
          }
        }
      }
      if (def.circles) {
        for (const c of def.circles(el)) {
          const w = localToWorld(el, c, 0);
          if (Math.hypot(wx - w.x, wy - w.y) < c.r + 8) return el;
        }
      }
    }
    return null;
  }

  hitTestMarble(wx, wy) {
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      if (Math.hypot(wx - m.x, wy - m.y) < m.r + 8) return m;
    }
    return null;
  }
}

/* trace une trajectoire ; les entrées null coupent le trait
   (téléportation par portail) */
function strokeTrail(ctx, pts, color) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    if (pen) ctx.lineTo(p[0], p[1]);
    else { ctx.moveTo(p[0], p[1]); pen = true; }
  }
  ctx.stroke();
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
