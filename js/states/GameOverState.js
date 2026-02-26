/* ============================================================
   GameOverState.js
   ============================================================
   The screen shown at the end of any game session.

   Reads gameData.result to determine what to display:
     'victory'  → golden "VICTORY!" banner
     'defeated' → red "DEFEATED" banner
     'survived' → white "GAME OVER" banner (placeholder)

   Buttons:
     PLAY AGAIN  — restart from PilotGameState (pilot mode only)
     MAIN MENU   — return to main menu

   TRANSITIONS:
     PLAY AGAIN → PilotGameState (if mode === 'pilot')
                → GunnerGameState (if mode === 'gunner')
     MAIN MENU  → MainMenuState
   ============================================================ */

class GameOverState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;
  }

  enter() {
    console.log('[State] Game Over —', this._gameData.result, '| Score:', this._gameData.score);
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    const W = 960;

    // PLAY AGAIN button
    if (this._input.wasTappedInRegion(W / 2 - 130, 295, 260, 60)) {
      // Reset the plane health before replaying
      if (this._gameData.selectedPlane) {
        this._gameData.selectedPlane.reset(100, 270);
      }
      this._gameData.score  = 0;
      this._gameData.result = null;

      if (this._gameData.mode === 'pilot') {
        this._sm.change(new PilotGameState(this._sm, this._input, this._gameData));
      } else {
        this._sm.change(new GunnerGameState(this._sm, this._input, this._gameData));
      }
      this._input.clearTaps();
      return;
    }

    // MAIN MENU button
    if (this._input.wasTappedInRegion(W / 2 - 130, 375, 260, 60)) {
      this._gameData.score        = 0;
      this._gameData.result       = null;
      this._gameData.selectedPlane = null;
      this._sm.change(new MainMenuState(this._sm, this._input, this._gameData));
      this._input.clearTaps();
      return;
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render(ctx) {
    ctx.imageSmoothingEnabled = false; // pixel-art style — no interpolation (Visual Style Guide rule 2)
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // Semi-transparent dark overlay (game scene visible underneath if pushed, not changed)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillRect(0, 0, W, H);

    // --- Choose title + color based on result ---
    const result = this._gameData.result;
    let titleText, titleColor, glowColor;

    if (result === 'victory') {
      titleText  = 'VICTORY!';
      titleColor = '#ffd700';
      glowColor  = '#ffb300';
    } else if (result === 'defeated') {
      titleText  = 'DEFEATED';
      titleColor = '#ef5350';
      glowColor  = '#b71c1c';
    } else {
      titleText  = 'GAME OVER';
      titleColor = '#ffffff';
      glowColor  = '#4488aa';
    }

    // --- Title ---
    ctx.textAlign   = 'center';
    ctx.font        = 'bold 80px Arial';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur  = 30;
    ctx.fillStyle   = titleColor;
    ctx.fillText(titleText, W / 2, 155);
    ctx.shadowBlur  = 0;

    // --- Mode label ---
    const modeLabel = this._gameData.mode === 'gunner' ? 'Gunner Mode' : 'Pilot Mode';
    ctx.fillStyle = '#7090a0';
    ctx.font      = '20px Arial';
    ctx.fillText(modeLabel, W / 2, 195);

    // --- Plane used (pilot mode only) ---
    if (this._gameData.mode === 'pilot' && this._gameData.selectedPlane) {
      ctx.fillStyle = '#5a8090';
      ctx.font      = '17px Arial';
      ctx.fillText('Aircraft: ' + this._gameData.selectedPlane.name, W / 2, 222);
    }

    // --- Score ---
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 36px Arial';
    ctx.fillText('Score: ' + (this._gameData.score || 0), W / 2, 268);

    // --- PLAY AGAIN button ---
    _drawButton(ctx, W / 2 - 130, 295, 260, 60, 'PLAY AGAIN', '#0d47a1', '#42a5f5');

    // --- MAIN MENU button ---
    _drawButton(ctx, W / 2 - 130, 375, 260, 60, 'MAIN MENU', '#1e2e3e', '#4a6a7a');
  }
}
