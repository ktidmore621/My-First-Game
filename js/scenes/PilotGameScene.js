/* ============================================================
   PilotGameScene.js — Pilot Mode Gameplay
   ============================================================
   Full Phaser Scene for Pilot Mode.

   Receives scene data:
     { mode: 'pilot' | 'gunner', plane: { ...planeConfig } }

   Systems:
     - InputSystem  → virtual thumbsticks + on-screen buttons
     - PlayerShip   → Phaser.GameObjects.Graphics + arcade physics
     - HealthSystem → embedded inside PlayerShip

   World layout:
     - World width:  BATTLEFIELD_W (4800 px), height: 540 px
     - Sky:          4-band flat background, setScrollFactor(0) — never scrolls
     - Ground:       Graphics spanning BATTLEFIELD_W — scrolls with camera
     - Camera:       follows PlayerShip with 0.1 lag; bounds clamped to world
     - HUD:          health bar + countdown timer, setScrollFactor(0) — fixed

   Game-over conditions (placeholder):
     - Ship health → 0       → 800 ms delay → back to MainMenuScene
     - 30-second timer fires  → 400 ms delay → back to MainMenuScene
   ============================================================ */

// Total pixel width of the scrolling battlefield
const BATTLEFIELD_W = 4800;

class PilotGameScene extends Phaser.Scene {

  constructor() {
    super({ key: 'PilotGameScene' });
  }

  // ==========================================================
  // INIT — called before create(); receives transition data
  // ==========================================================

  init(data) {
    this._mode      = (data && data.mode)  ? data.mode  : 'pilot';
    // Default to Fighter stats if no plane was passed
    this._planeConf = (data && data.plane) ? data.plane : {
      id: 'fighter', name: 'Fighter', color: 0x42a5f5,
      speed: 82, durability: 55, weaponSize: 65, maneuverability: 90,
    };
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create() {
    const W = 960;
    const H = 540;

    // ---- Physics world bounds ----
    // The ship's body.setCollideWorldBounds() keeps it within this rectangle
    this.physics.world.setBounds(0, 0, BATTLEFIELD_W, H);

    // ---- Visuals (build order matters — lower depth = drawn first) ----
    this._buildSky(W, H);      // depth 0 — fixed, never scrolls
    this._buildGround(H);      // depth 1 — scrolls with camera

    // ---- Player ship ----
    // Spawns near the left edge, vertically centred
    this._ship = new PlayerShip(this, 120, H / 2, this._planeConf);
    this._ship.setDepth(10);

    // When the ship's HealthSystem hits zero it emits 'destroyed'
    this._ship.on('destroyed', () => this._triggerGameOver('defeated'));

    // ---- Camera ----
    // Clamp camera to the world rectangle so it never shows void
    this.cameras.main.setBounds(0, 0, BATTLEFIELD_W, H);
    // Follow with gentle lag (0.1 lerp) for a smooth cockpit feel
    this.cameras.main.startFollow(this._ship, true, 0.1, 0.1);
    // Slight zoom ramp will be driven by combat events in a future session
    this.cameras.main.setZoom(1.0);

    // ---- Input system ----
    this._input = new InputSystem(this);
    // Pilot mode only needs the FIRE button; hide the others
    this._input.weaponSelectBtn.setVisible(false);
    this._input.evadeBtn.setVisible(false);
    // FIRE is shown but currently a stub
    this._input.fireBtn.setVisible(true);

    // ---- HUD (fixed to viewport) ----
    this._buildHUD(W, H);

    // ---- Enemy population ----
    // EnemyManager creates all OrcCannon / OrcSilo instances at their
    // battlefield world positions.  They register themselves with the scene
    // via scene.add.existing(), so Phaser renders them automatically.
    const groundY = Math.floor(H * 0.72); // matches _buildGround horizonY
    this._enemyManager = new EnemyManager(this, groundY);

    // ---- Game state ----
    this._elapsed      = 0;
    this._missionTime  = 30;   // seconds; placeholder mission length
    this._gameOver     = false;
  }

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(time, delta) {
    if (this._gameOver) return;

    this._input.update();

    const dt = delta / 1000;
    this._elapsed += dt;

    // Ship movement + effects
    this._ship.update(this._input);

    // FIRE stub — log to console until projectiles are wired up
    if (this._input.firePressed) {
      console.log('[PilotGameScene] FIRE pressed — projectiles not yet implemented');
    }

    // Update all enemies (OrcCannons + OrcSilos via EnemyManager)
    this._enemyManager.update(
      time,
      delta,
      this._ship.x,                  // player world X
      this._ship.y,                  // player screen Y
      this.cameras.main.scrollX      // camera left-edge world X
    );

    // Check enemy fire hitting the player ship
    // Ship hitbox: 40×18 px (tight inner box, not the full visual triangle)
    if (this._enemyManager.checkEnemyFireHitPlayer(
      this._ship.x, this._ship.y, 40, 18
    )) {
      this._ship.health.takeDamage(1);
    }

    // Update on-screen HUD
    this._updateHUD();

    // Placeholder win condition: mission clock expires
    if (this._elapsed >= this._missionTime) {
      this._triggerGameOver('victory');
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // SKY — fixed background (setScrollFactor 0, depth 0)
  // 4-band flat fills matching the Visual Style Guide palette.
  // Only needs to cover the 960×540 viewport since it never scrolls.
  // ==========================================================

  _buildSky(W, H) {
    const horizonY = Math.floor(H * 0.72);
    const sky = this.add.graphics().setScrollFactor(0).setDepth(0);

    // Band 1 — deep space black-blue at the top
    sky.fillStyle(0x07101f);
    sky.fillRect(0, 0, W, Math.floor(horizonY * 0.35));

    // Band 2
    sky.fillStyle(0x0d1e38);
    sky.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));

    // Band 3
    sky.fillStyle(0x122848);
    sky.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));

    // Band 4 — lighter near horizon
    sky.fillStyle(0x1e3a52);
    sky.fillRect(0, Math.floor(horizonY * 0.85), W,
      horizonY - Math.floor(horizonY * 0.85));

    // Warm amber horizon strip
    sky.fillStyle(0x3a2010);
    sky.fillRect(0, horizonY - 8, W, 8);
  }

  // ==========================================================
  // GROUND — scrolling surface spanning full BATTLEFIELD_W
  // Flat fillRect shapes only — no ellipses (Visual Style Guide rule 4).
  // ==========================================================

  _buildGround(H) {
    const gfx      = this.add.graphics().setDepth(1);
    const horizonY = Math.floor(H * 0.72);
    const groundH  = H - horizonY;

    // ---- Base colour bands ----
    gfx.fillStyle(0x2a2010);
    gfx.fillRect(0, horizonY, BATTLEFIELD_W, Math.floor(groundH * 0.40));

    gfx.fillStyle(0x3c2e16);
    gfx.fillRect(0, horizonY + Math.floor(groundH * 0.40),
      BATTLEFIELD_W, Math.floor(groundH * 0.30));

    gfx.fillStyle(0x4a3820);
    gfx.fillRect(0, horizonY + Math.floor(groundH * 0.70),
      BATTLEFIELD_W, groundH - Math.floor(groundH * 0.70));

    // ---- Road strips ----
    const roadH  = 6;
    const roadY1 = horizonY + Math.floor(groundH * 0.25);
    const roadY2 = horizonY + Math.floor(groundH * 0.65);

    gfx.fillStyle(0x1a1a10);
    gfx.fillRect(0, roadY1, BATTLEFIELD_W, roadH);
    gfx.fillRect(0, roadY2, BATTLEFIELD_W, roadH);

    // Road centre-line dashes
    gfx.fillStyle(0x5a5030);
    for (let rx = 0; rx < BATTLEFIELD_W; rx += 80) {
      gfx.fillRect(rx, roadY1 + 2, 40, 2);
      gfx.fillRect(rx, roadY2 + 2, 40, 2);
    }

    // ---- Bomb craters — outer ejecta ring + inner pit ----
    const craterXs = [200, 480, 820, 1150, 1600, 2200, 2800, 3400, 3900, 4400];
    craterXs.forEach(cx => {
      gfx.fillStyle(0x1a150a);
      gfx.fillRect(cx - 20, horizonY + 4, 40, 10);   // sandy ejecta ring
      gfx.fillStyle(0x0d0a06);
      gfx.fillRect(cx - 12, horizonY + 5, 24,  8);   // inner dark pit
    });

    // ---- Scorched / burned patches ----
    gfx.fillStyle(0x1e1408);
    [600, 1400, 2100, 3000, 3800, 4200].forEach(px => {
      gfx.fillRect(px, horizonY + 2, 60, 14);
    });

    // ---- Sandy texture patches ----
    gfx.fillStyle(0x5e4a28);
    [350, 1100, 1950, 2700, 3600].forEach(px => {
      gfx.fillRect(px,      horizonY + 12, 55, 8);
      gfx.fillRect(px + 10, horizonY + 16, 35, 5);
    });

    // ---- Rubble piles (small rectangle clusters) ----
    gfx.fillStyle(0x5e4a28);
    [950, 1750, 2500, 3300].forEach(px => {
      gfx.fillRect(px,      horizonY + 8, 12, 6);
      gfx.fillRect(px +  8, horizonY + 6,  8, 4);
      gfx.fillRect(px + 14, horizonY + 9, 10, 5);
    });
  }

  // ==========================================================
  // HUD — viewport-fixed elements (setScrollFactor 0, depth 50+)
  // ==========================================================

  _buildHUD(W, H) {
    const depth = 50;

    // ---- Health bar ----
    // Dark background track
    const hpBg = this.add.graphics().setScrollFactor(0).setDepth(depth);
    hpBg.fillStyle(0x222222, 0.80);
    hpBg.fillRect(12, 12, 200, 14);
    hpBg.lineStyle(1, 0x445566);
    hpBg.strokeRect(12, 12, 200, 14);

    // Fill — redrawn each frame
    this._hudHealthFill = this.add.graphics().setScrollFactor(0).setDepth(depth + 1);

    // "HP" label
    this.add.text(16, 13, 'HP', {
      fontFamily: 'monospace',
      fontSize:   '11px',
      color:      '#aacccc',
    }).setScrollFactor(0).setDepth(depth + 2).setOrigin(0, 0);

    // ---- Mission timer (top-right) ----
    this._hudTimer = this.add.text(W - 12, 12, '0:30', {
      fontFamily: 'monospace',
      fontSize:   '18px',
      color:      '#ffffff',
    }).setScrollFactor(0).setDepth(depth + 2).setOrigin(1, 0);

    // ---- Back to menu (top-left, below health bar) ----
    const backBtn = this.add.text(12, 34, '← MENU', {
      fontFamily: 'monospace',
      fontSize:   '13px',
      color:      '#7a9ab0',
    }).setScrollFactor(0).setDepth(depth + 2).setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      this._cleanup();
      this.scene.start('MainMenuScene');
    });
  }

  _updateHUD() {
    // ---- Health bar fill ----
    const pct  = this._ship.health.getPercent();
    const barW = 200;
    const barH = 14;

    // Color transitions green → yellow → red as health drops
    const r = Math.min(255, Math.floor(510 * (1 - pct)));
    const g = Math.min(255, Math.floor(510 * pct));
    const fillColor = (r << 16) | (g << 8) | 0;

    this._hudHealthFill.clear();
    this._hudHealthFill.fillStyle(fillColor, 1);
    this._hudHealthFill.fillRect(12, 12, barW * pct, barH);

    // ---- Countdown timer ----
    const remaining = Math.max(0, Math.ceil(this._missionTime - this._elapsed));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    this._hudTimer.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
  }

  // ==========================================================
  // GAME OVER
  // ==========================================================

  _triggerGameOver(result) {
    if (this._gameOver) return;
    this._gameOver = true;

    // Slightly longer delay on defeat so the death animation can play
    const delay = result === 'defeated' ? 800 : 400;
    this.time.delayedCall(delay, () => {
      this._cleanup();
      // GameOverScene not yet built — return to main menu as placeholder
      this.scene.start('MainMenuScene');
    });
  }

  // ==========================================================
  // CLEANUP — tear down InputSystem before scene transition
  // Also called by the ← MENU button
  // ==========================================================

  _cleanup() {
    if (this._input) {
      this._input.destroy();
      this._input = null;
    }
  }

  // Called by Phaser when the scene stops (via scene.start/stop)
  shutdown() {
    this._cleanup();
  }
}
