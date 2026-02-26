/* ============================================================
   MainMenuState.js
   ============================================================
   The first screen the player sees.

   Contains:
     - Game title and subtitle
     - "PILOT MODE" button  → navigate to plane selection
     - "GUNNER MODE" button → jump straight into gunner gameplay
     - A simple sky/ground background

   TRANSITIONS:
     PILOT MODE  → PlaneSelectState
     GUNNER MODE → GunnerGameState
   ============================================================ */

class MainMenuState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;
  }

  enter() {
    console.log('[State] Main Menu');
  }

  exit() {}

  // ==========================================================
  // UPDATE — handle button taps
  // ==========================================================

  update(dt) {
    const W = 960, H = 540;

    // "PILOT MODE" button region (centered, upper-mid screen)
    if (this._input.wasTappedInRegion(W / 2 - 200, 185, 400, 65)) {
      this._gameData.mode = 'pilot';
      this._sm.change(new PlaneSelectState(this._sm, this._input, this._gameData));
      this._input.clearTaps();
      return;
    }

    // "GUNNER MODE" button region
    if (this._input.wasTappedInRegion(W / 2 - 200, 275, 400, 65)) {
      this._gameData.mode = 'gunner';
      this._sm.change(new GunnerGameState(this._sm, this._input, this._gameData));
      this._input.clearTaps();
      return;
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER — draw the main menu screen
  // ==========================================================

  render(ctx) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // --- Background: sky gradient + ground strip ---
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.72);
    sky.addColorStop(0, '#07101f');
    sky.addColorStop(1, '#103a6a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Distant horizon glow
    const glow = ctx.createLinearGradient(0, H * 0.55, 0, H * 0.72);
    glow.addColorStop(0, 'rgba(255, 160, 60, 0)');
    glow.addColorStop(1, 'rgba(255, 120, 30, 0.25)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, H * 0.55, W, H * 0.17);

    // Ground
    ctx.fillStyle = '#1e3310';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    // Stars (simple dots)
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const stars = [
      [80,40],[200,20],[350,55],[500,15],[650,40],[780,25],
      [900,50],[130,80],[420,30],[710,70],[860,35],[50,100],
    ];
    stars.forEach(([sx, sy]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // --- Title ---
    ctx.textAlign = 'center';

    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur  = 28;
    ctx.fillStyle   = '#ffffff';
    ctx.font        = 'bold 68px Arial';
    ctx.fillText('MY FIRST GAME', W / 2, 115);

    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#7ec8e3';
    ctx.font        = '21px Arial';
    ctx.fillText('A Survival Flight Game', W / 2, 152);

    // --- Buttons ---
    _drawButton(ctx, W / 2 - 200, 185, 400, 65, 'PILOT MODE',  '#0d47a1', '#42a5f5');
    _drawButton(ctx, W / 2 - 200, 275, 400, 65, 'GUNNER MODE', '#880e4f', '#f06292');

    // --- Footer hint ---
    ctx.fillStyle = '#4a6070';
    ctx.font      = '15px Arial';
    ctx.fillText('Tap a mode to begin', W / 2, 395);

    // Version tag (bottom-right)
    ctx.fillStyle   = '#2a3a4a';
    ctx.textAlign   = 'right';
    ctx.font        = '13px Arial';
    ctx.fillText('v0.1.0-foundation', W - 12, H - 10);
  }
}

/* ============================================================
   SHARED HELPER — draw a simple button rectangle with a label.
   Defined outside the class so any state file can call it.

   (In a larger project this would live in a shared ui.js utility file.)
   ============================================================ */
function _drawButton(ctx, x, y, w, h, label, bgColor, borderColor) {
  // Background fill
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);

  // Border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth   = 2.5;
  ctx.strokeRect(x, y, w, h);

  // Label
  ctx.fillStyle   = '#ffffff';
  ctx.font        = 'bold 26px Arial';
  ctx.textAlign   = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 9);
}
