/* ============================================================
   main.js — Phaser Game Entry Point
   ============================================================
   Creates and starts the Phaser 3 game instance.

   Scene load order (scripts must be declared in index.html
   before this file):
     1. MainMenuScene   — title screen + mode selection
     2. PlaneSelectScene — aircraft chooser (Pilot path only)
     3. PilotGameScene  — gameplay (placeholder; full impl next session)

   Coordinate system: fixed 960 × 540 (16:9 landscape).
   Phaser's Scale.FIT mode handles CSS scaling to any screen.
   pixelArt: true keeps canvas sampling nearest-neighbour so
   all rendering stays crisp without per-render imageSmoothingEnabled calls.
   ============================================================ */

const config = {
  type: Phaser.AUTO,

  width:  960,
  height: 540,

  backgroundColor: '#000000',

  // Register scenes in start order — first in the array is launched first
  scene: [
    MainMenuScene,
    PlaneSelectScene,
    PilotGameScene,
    GameOverScene,
  ],

  // 4 active pointers required for simultaneous dual-stick + button touch
  input: {
    activePointers: 4,
  },

  // Responsive scaling: fill the screen while preserving 16:9 ratio
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  // Pixel-art rendering: disable smoothing at the WebGL/Canvas level
  render: {
    pixelArt:    true,
    antialias:   false,
    antialiasGL: false,
  },

  // Arcade physics — zero gravity; PlayerShip uses velocity + drag for flight
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug:   false,
    },
  },
};

window.game = new Phaser.Game(config);
