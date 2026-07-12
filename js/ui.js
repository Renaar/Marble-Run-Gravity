'use strict';

/* =====================================================================
 * Interface : palette, glisser-déposer, sélection, clavier, boutons.
 * ===================================================================== */

function setupUI(game) {
  const canvas = document.getElementById('board');
  const selpanel = document.getElementById('selpanel');
  const scoreVal = document.getElementById('scoreVal');

  /* état des interactions souris */
  const drag = {
    mode: null,        // 'new' | 'move' | 'marble'
    el: null,
    marble: null,
    offX: 0, offY: 0,
    lastX: 0, lastY: 0,
    lastT: 0,
  };

  /* ---------------- palette ---------------- */

  const cards = document.getElementById('cards');
  for (const type of PALETTE_ORDER) {
    const def = DEFS[type];
    const card = document.createElement('div');
    card.className = 'card';
    card.title = 'Glissez « ' + def.label + ' » sur le plateau';

    const cv = document.createElement('canvas');
    cv.width = 84;
    cv.height = 58;
    const cctx = cv.getContext('2d');
    cctx.translate(42, 30);
    const sc = def.preview || 0.45;
    cctx.scale(sc, sc);
    def.draw(cctx, { theta: 0.35, ring: 0, flip: false });

    const label = document.createElement('span');
    label.textContent = def.label;
    card.appendChild(cv);
    card.appendChild(label);
    cards.appendChild(card);

    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      SFX.ensure();
      const el = game.addElement(type, -500, -500);
      game.selected = el;
      drag.mode = 'new';
      drag.el = el;
      drag.offX = 0;
      drag.offY = 0;
      moveDraggedElement(e);
    });
  }

  /* ---------------- helpers ---------------- */

  function pointerWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return game.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  function pointerOnBoard(e) {
    const rect = canvas.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right &&
           e.clientY >= rect.top && e.clientY <= rect.bottom;
  }

  function clampToWorld(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function moveDraggedElement(e) {
    const p = pointerWorld(e);
    drag.el.x = clampToWorld(p.x - drag.offX, 10, WORLD_W - 10);
    drag.el.y = clampToWorld(p.y - drag.offY, 10, WORLD_H - 10);
  }

  /* ---------------- souris sur le plateau ---------------- */

  canvas.addEventListener('pointerdown', (e) => {
    SFX.ensure();
    if (drag.mode) return;
    const p = pointerWorld(e);

    const marble = game.hitTestMarble(p.x, p.y);
    if (marble) {
      drag.mode = 'marble';
      drag.marble = marble;
      marble.held = true;
      marble.vx = 0; marble.vy = 0;
      drag.lastX = p.x; drag.lastY = p.y;
      drag.lastT = performance.now();
      canvas.classList.add('grabbing');
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const el = game.hitTestElement(p.x, p.y);
    if (el) {
      game.selected = el;
      drag.mode = 'move';
      drag.el = el;
      drag.offX = p.x - el.x;
      drag.offY = p.y - el.y;
      canvas.classList.add('grabbing');
      canvas.setPointerCapture(e.pointerId);
    } else {
      game.selected = null;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag.mode) return;
    if (drag.mode === 'new' || drag.mode === 'move') {
      moveDraggedElement(e);
    } else if (drag.mode === 'marble') {
      const p = pointerWorld(e);
      const now = performance.now();
      const dt = Math.max(8, now - drag.lastT) / 1000;
      drag.marble.vx = (p.x - drag.lastX) / dt * 0.6;
      drag.marble.vy = (p.y - drag.lastY) / dt * 0.6;
      drag.marble.x = p.x;
      drag.marble.y = p.y;
      drag.lastX = p.x; drag.lastY = p.y;
      drag.lastT = now;
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag.mode) return;
    if (drag.mode === 'new' && !pointerOnBoard(e)) {
      game.removeElement(drag.el);          // lâché hors du plateau : annulé
    } else if (drag.mode === 'new' || drag.mode === 'move') {
      SFX.click();
      game.edited();
    } else if (drag.mode === 'marble') {
      drag.marble.held = false;
    }
    drag.mode = null;
    drag.el = null;
    drag.marble = null;
    canvas.classList.remove('grabbing');
  });

  canvas.addEventListener('dblclick', (e) => {
    const p = pointerWorld(e);
    if (!game.hitTestElement(p.x, p.y)) {
      game.spawnMarble(p.x, p.y);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    if (!game.selected) return;
    e.preventDefault();
    game.selected.angle += (e.deltaY > 0 ? 1 : -1) * 0.06;
    game.edited();
  }, { passive: false });

  /* ---------------- clavier ---------------- */

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const el = game.selected;
    const key = e.key.toLowerCase();

    if (el) {
      if (key === 'r') {
        el.angle += (e.shiftKey ? -1 : 1) * Math.PI / 12;
        game.edited();
        e.preventDefault();
      } else if (key === 'f') {
        el.flip = !el.flip;
        game.edited();
        e.preventDefault();
      } else if (key === 'delete' || key === 'backspace') {
        game.removeElement(el);
        e.preventDefault();
      } else if (key === 'escape') {
        game.selected = null;
      } else if (key.startsWith('arrow')) {
        const d = e.shiftKey ? 10 : 2;
        if (key === 'arrowleft') el.x -= d;
        if (key === 'arrowright') el.x += d;
        if (key === 'arrowup') el.y -= d;
        if (key === 'arrowdown') el.y += d;
        game.edited();
        e.preventDefault();
      }
    }
    if (key === ' ') {
      togglePlay();
      e.preventDefault();
    }
  });

  /* ---------------- panneau de sélection flottant ---------------- */

  selpanel.addEventListener('pointerdown', (e) => e.stopPropagation());
  selpanel.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    const el = game.selected;
    if (!act || !el) return;
    if (act === 'rotl') el.angle -= Math.PI / 12;
    if (act === 'rotr') el.angle += Math.PI / 12;
    if (act === 'flip') el.flip = !el.flip;
    if (act === 'del') game.removeElement(el);
    game.edited();
    SFX.click();
  });

  function updateSelPanel() {
    const el = game.selected;
    if (!el || drag.mode === 'new' || drag.mode === 'move') {
      selpanel.hidden = true;
      return;
    }
    selpanel.hidden = false;
    const r = (DEFS[el.type].selR || 50) + 16;
    const p = game.worldToScreen(el.x, el.y - r);
    selpanel.style.left = p.x + 'px';
    selpanel.style.top = Math.max(40, p.y) + 'px';
  }

  /* ---------------- barre d'outils ---------------- */

  const btnPlay = document.getElementById('btnPlay');
  function togglePlay() {
    game.playing = !game.playing;
    btnPlay.textContent = game.playing ? '⏸ Pause' : '▶ Reprendre';
    btnPlay.classList.toggle('accent', !game.playing);
  }
  btnPlay.addEventListener('click', () => { SFX.ensure(); togglePlay(); });

  document.getElementById('btnDrop').addEventListener('click', () => {
    SFX.ensure();
    game.dropFromLaunchers();
  });

  document.getElementById('chkAuto').addEventListener('change', (e) => {
    SFX.ensure();
    game.autoDrop = e.target.checked;
    game.autoTimer = 2;                    // première bille immédiate
  });

  document.getElementById('btnClearMarbles').addEventListener('click', () => {
    game.clearMarbles();
  });

  document.getElementById('btnDemo').addEventListener('click', () => {
    game.load(DEMO_COURSE);
    game.score = 0;
    scoreVal.textContent = '0';
    game.edited();
  });

  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (game.elements.length === 0 ||
        confirm('Vider entièrement le plateau ?')) {
      game.clearElements();
      game.clearMarbles();
    }
  });

  const btnMute = document.getElementById('btnMute');
  btnMute.addEventListener('click', () => {
    SFX.muted = !SFX.muted;
    btnMute.textContent = SFX.muted ? '🔇' : '🔊';
  });

  game.onScore = (score) => {
    scoreVal.textContent = String(score);
  };

  return { updateSelPanel };
}
