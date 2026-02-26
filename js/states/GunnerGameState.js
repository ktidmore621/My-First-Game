/* ============================================================
   GunnerGameState.js
   ============================================================
   The main gameplay screen for GUNNER MODE.

   The player controls a ground-based anti-aircraft gun and
   must shoot down incoming enemy planes.

   CURRENT STATE (foundation):
     - Rotating gun barrel controlled by the right stick
     - Aim dotted line extending from the gun barrel
     - FIRE button placeholder
     - Gun health bar using HealthSystem
     - Auto-transitions to GameOverState after 30 seconds

   WHAT TO BUILD NEXT HERE:
     - Enemy planes that fly across the sky
     - Bullet projectiles fired from the gun
     - Collision detection (bullet hits plane)
     - Multiple gun types / upgrades
     - Wave system (harder waves over time)
   ============================================================ */

class GunnerGameState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;

    // The gun's aim angle in radians.
    // -π/4 ≈ 45 degrees upward-right — a natural starting position.
    this._aimAngle = -Math.PI / 4;

    // The gun emplacement has its own health — enemies can destroy it
    this._gunHealth = new HealthSystem(150);
    this._gunHealth.onDeath(() => {
      if (!this._gameOverPending) {
        this._gameOverPending = true;
        this._gameData.result = 'defeated';
        this._gameData.score  = Math.floor(this._elapsedTime * 8);
        setTimeout(() => {
          this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
        }, 800);
      }
    });

    this._elapsedTime    = 0;
    this._gameOverPending = false;

    this._W = 960;
    this._H = 540;

    // Gun emplacement position (center-bottom of screen)
    this._gunX = this._W / 2;
    this._gunY = this._H * 0.72 - 5;
  }

  enter() {
    console.log('[State] Gunner Mode');
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    this._elapsedTime += dt;

    // --- Right stick controls aim angle ---
    const rx = this._input.rightStick.x;
    const ry = this._input.rightStick.y;
    if (Math.hypot(rx, ry) > 0.1) {
      this._aimAngle = Math.atan2(ry, rx);
    }

    // Clamp aim: only allow firing upward (into the sky)
    // Prevents the gun from pointing into the ground
    if (this._aimAngle > -0.05 && this._aimAngle < Math.PI + 0.05) {
      // If pointing downward, snap to nearest upward direction
      this._aimAngle = this._aimAngle > Math.PI / 2 ? -0.05 : -(Math.PI - 0.05);
    }

    // --- FIRE button tap ---
    // Region: bottom-right corner. Replace with actual projectile firing logic.
    if (this._input.wasTappedInRegion(820, 450, 130, 70)) {
      console.log('[Input] FIRE tapped at angle:', (this._aimAngle * 180 / Math.PI).toFixed(1), '°');
      // TODO: spawn a bullet entity traveling in this._aimAngle direction
    }

    // --- Placeholder: back to menu ---
    if (this._input.wasTappedInRegion(15, 15, 110, 42)) {
      this._sm.change(new MainMenuState(this._sm, this._input, this._gameData));
      this._input.clearTaps();
      return;
    }

    // --- Placeholder: auto game-over at 30s ---
    if (this._elapsedTime > 30 && !this._gameOverPending) {
      this._gameOverPending = true;
      this._gameData.score  = Math.floor(this._elapsedTime * 8);
      this._gameData.result = 'survived';
      this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render(ctx) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // --- Sky ---
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.72);
    sky.addColorStop(0, '#07101f');
    sky.addColorStop(1, '#1a3a6a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.72);

    // --- Ground ---
    ctx.fillStyle = '#1e3310';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    // Horizon
    ctx.strokeStyle = '#2e4a1e';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.72);
    ctx.lineTo(W, H * 0.72);
    ctx.stroke();

    // --- Placeholder: enemy plane flight paths ---
    ctx.fillStyle   = 'rgba(255, 200, 80, 0.3)';
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.2)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 120); ctx.lineTo(W, 120); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(W, 200); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,200,80,0.5)';
    ctx.font      = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('← Enemy flight paths (placeholder)', 20, 115);

    // --- Aim line extending from the gun barrel ---
    ctx.save();
    ctx.translate(this._gunX, this._gunY - 12);
    ctx.rotate(this._aimAngle);
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.45)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.moveTo(55, 0);
    ctx.lineTo(500, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // --- Gun emplacement ---
    this._renderGun(ctx);

    // --- HUD ---
    this._renderHUD(ctx);

    // --- Virtual controls ---
    this._input.renderSticks(ctx);

    // --- FIRE button ---
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = '#7b0000';
    ctx.fillRect(820, 450, 130, 70);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth   = 2;
    ctx.strokeRect(820, 450, 130, 70);
    ctx.fillStyle   = '#ffffff';
    ctx.font        = 'bold 26px Arial';
    ctx.textAlign   = 'center';
    ctx.fillText('FIRE', 885, 492);

    // Back button
    ctx.fillStyle   = '#1e2e3e';
    ctx.fillRect(15, 15, 110, 42);
    ctx.strokeStyle = '#3a5a7a';
    ctx.lineWidth   = 1;
    ctx.strokeRect(15, 15, 110, 42);
    ctx.fillStyle   = '#8aaabb';
    ctx.font        = '17px Arial';
    ctx.textAlign   = 'center';
    ctx.fillText('← Back', 70, 41);
  }

  // Draw the gun turret graphic
  _renderGun(ctx) {
    const gx = this._gunX;
    const gy = this._gunY;

    // Sandbag base
    ctx.fillStyle = '#5d4a2a';
    ctx.fillRect(gx - 45, gy - 10, 90, 20);
    ctx.strokeStyle = '#3a2e1a';
    ctx.lineWidth   = 1;
    ctx.strokeRect(gx - 45, gy - 10, 90, 20);

    // Turret body
    ctx.fillStyle = '#546e7a';
    ctx.beginPath();
    ctx.arc(gx, gy - 12, 22, Math.PI, 0); // Top half circle
    ctx.fill();
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(gx, gy - 12, 22, Math.PI, 0);
    ctx.stroke();

    // Rotating barrel
    ctx.save();
    ctx.translate(gx, gy - 12);
    ctx.rotate(this._aimAngle);
    ctx.fillStyle = '#78909c';
    ctx.fillRect(0, -5, 55, 10);  // Barrel rectangle
    ctx.fillStyle = '#546e7a';
    ctx.fillRect(0, -3, 10, 6);   // Breech block
    ctx.restore();
  }

  _renderHUD(ctx) {
    const W = ctx.canvas.width;

    // Gun health bar
    ctx.fillStyle = '#aaccdd';
    ctx.font      = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('GUN', 12, 24);
    this._gunHealth.renderBar(ctx, 50, 10, 180, 18);

    // Mode label
    ctx.fillStyle = '#f06292';
    ctx.font      = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🎯  GUNNER MODE', W / 2, 24);

    // Timer
    ctx.fillStyle = '#aaaaaa';
    ctx.font      = '14px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('T+' + Math.floor(this._elapsedTime) + 's', W - 12, 24);

    // Aim angle readout (helpful during development)
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Aim: ' + (this._aimAngle * 180 / Math.PI).toFixed(0) + '°', 12, 44);
  }
}
