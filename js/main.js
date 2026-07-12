'use strict';

/* =====================================================================
 * Point d'entrée : parcours de démonstration, sauvegarde automatique,
 * boucle de jeu.
 * ===================================================================== */

const SAVE_KEY = 'marblerun.course.v1';

/* Parcours de démonstration : lanceur -> rail -> escalier (avec cloche)
   -> virage -> rail -> entonnoir -> panier, plus quelques éléments
   à découvrir sur le côté. */
const DEMO_COURSE = [
  ['lanceur',   172,  70, 0, 0],
  ['cloche',    448, 198, 0, 0],
  ['rail-long', 285, 172, 0.13, 0],
  ['escalier',  480, 292, 0, 0],
  ['virage',    648, 418, 0, 0],
  ['rail-long', 832, 502, 0.12, 0],
  ['entonnoir', 1020, 585, 0, 0],
  ['panier',    1020, 700, 0, 0],
  ['demilune',  262, 490, 0, 0],
  ['roue',      430, 570, 0, 0],
  ['bascule',   640, 650, 0, 0],
  ['bumper',    850, 690, -0.08, 0],
];

(function main() {
  const canvas = document.getElementById('board');
  const game = new Game(canvas);
  window.game = game;                     // pratique pour déboguer / tester

  /* sauvegarde automatique du parcours */
  let saveTimer = null;
  game.onEdit = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize()));
      } catch (err) { /* stockage indisponible : tant pis */ }
    }, 300);
  };

  /* restauration : parcours sauvegardé, sinon démo */
  let restored = false;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        game.load(data);
        restored = true;
      }
    }
  } catch (err) { /* sauvegarde illisible : on repart de la démo */ }
  if (!restored) game.load(DEMO_COURSE);

  const ui = setupUI(game);

  game.resize();
  window.addEventListener('resize', () => game.resize());

  /* boucle de jeu */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    game.step(dt);
    game.render();
    ui.updateSelPanel();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* quelques billes de bienvenue */
  setTimeout(() => game.dropFromLaunchers(), 600);
})();
