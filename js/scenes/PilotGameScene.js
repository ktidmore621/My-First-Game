/* ============================================================
   PilotGameScene.js — Pilot Mode Gameplay
   ============================================================
   Full Phaser Scene for Pilot Mode.

   Receives scene data:
     { mode: 'pilot' | 'gunner', plane: { ...planeConfig } }

   Systems:
     - InputSystem    → virtual thumbsticks + on-screen buttons
     - PlayerShip     → Phaser.GameObjects.Graphics + arcade physics
     - HealthSystem   → embedded inside PlayerShip
     - Projectile     → Phaser.GameObjects.Graphics + arcade physics;
                        pooled in three groups (player/enemy/missile)
     - EnemyManager   → OrcCannon + OrcSilo battlefield population
     - Arcade physics overlaps → 5 collision pairs (see _setupCollision)

   World layout:
     - World width:  BATTLEFIELD_W (4800 px), height: 540 px
     - Sky:          4-band flat background, setScrollFactor(0) — never scrolls
     - Ground:       Graphics spanning BATTLEFIELD_W — scrolls with camera
     - Camera:       follows PlayerShip with 0.1 lag; bounds clamped to world
     - HUD:          health bar + countdown timer, setScrollFactor(0) — fixed

   Collision pairs (all via physics.add.overlap):
     1. playerBolts  → orcCannons   → camera shake 150ms
     2. playerBolts  → orcSilos     → camera shake 150ms
     3. enemyBolts   → playerShip   → screen flash red
     4. missiles     → playerShip   → screen flash red + impact explosion
     5. playerBolts  → missiles     → particle burst at intercept point

   Game-over conditions (placeholder):
     - Ship health → 0       → 800 ms delay → back to MainMenuScene
     - 30-second timer fires  → 400 ms delay → back to MainMenuScene
   ============================================================ */

// Total pixel width of the scrolling battlefield
const BATTLEFIELD_W = 4800;

// Player bolt constants
const BOLT_SPEED   = 500;  // px/s rightward
const BOLT_DAMAGE  = 1;    // HP per hit on OrcCannon (6-hp enemy)

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

    // ---- Projectile groups ----
    // All three groups share classType: Projectile so group.get() constructs
    // new instances on demand (up to maxSize), and runChildUpdate: true means
    // each active Projectile's preUpdate() is called automatically each frame.

    // Player's PX-9 plasma bolts — IPDF elongated bolt sprite
    this.playerBolts = this.add.group({
      classType:       Projectile,
      maxSize:         30,
      runChildUpdate:  true,
    });

    // OrcCannon orc plasma orbs — 6×6 magenta square sprite
    this.enemyBolts = this.add.group({
      classType:       Projectile,
      maxSize:         50,   // 10 cannons × 5 bolts each
      runChildUpdate:  true,
    });

    // OrcSilo missile physics proxies — invisible bodies for overlap only
    this.missiles = this.add.group({
      classType:       Projectile,
      maxSize:         8,    // 4 silos × 2 missiles each
      runChildUpdate:  true,
    });

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
    this._input.fireBtn.setVisible(true);

    // ---- HUD (fixed to viewport) ----
    this._buildHUD(W, H);

    // ---- Enemy population ----
    // EnemyManager creates all OrcCannon / OrcSilo instances at their
    // battlefield world positions.  They register themselves with the scene
    // via scene.add.existing(), so Phaser renders them automatically.
    // Both bolt groups are passed so enemies can acquire Projectile slots.
    const groundY = Math.floor(H * 0.72); // matches _buildGround horizonY
    this._enemyManager = new EnemyManager(
      this, groundY, this.enemyBolts, this.missiles
    );

    // ---- Phaser effects ----
    this._buildEffects();

    // ---- Arcade physics collision pairs ----
    this._setupCollision();

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

    // ---- FIRE player bolt ----
    if (this._input.firePressed) {
      this._firePlayerBolt();
    }

    // Update all enemies (OrcCannons + OrcSilos via EnemyManager)
    this._enemyManager.update(
      time,
      delta,
      this._ship.x,                  // player world X
      this._ship.y,                  // player screen Y
      this.cameras.main.scrollX      // camera left-edge world X
    );

    // Update on-screen HUD
    this._updateHUD();

    // Placeholder win condition: mission clock expires
    if (this._elapsed >= this._missionTime) {
      this._triggerGameOver('victory');
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // FIRE PLAYER BOLT
  // ==========================================================

  _firePlayerBolt() {
    const bolt = this.playerBolts.get();
    if (!bolt) return; // pool full — shot dropped

    // Fire rightward from the ship's nose at BOLT_SPEED px/s
    const angle = 0; // pointing right
    bolt.fire(
      this._ship.x + 34,  // nose tip: ship origin + half-width
      this._ship.y,
      BOLT_SPEED,
      0,
      BOLT_DAMAGE,
      this._planeConf.color,
      angle
    );

    // ---- Muzzle flash — particle burst at the bolt spawn point ----
    if (this._muzzleEmitter) {
      this._muzzleEmitter.setPosition(this._ship.x + 34, this._ship.y);
      this._muzzleEmitter.explode(6);
    }
  }

  // ==========================================================
  // COLLISION SETUP — Phaser arcade physics overlaps
  //
  // Called once from create(). All five pairs are registered here
  // so they run automatically every physics step (no per-frame calls).
  // ==========================================================

  _setupCollision() {
    // ---- Pair 1: player bolts hitting OrcCannon structures ----
    // getCannons() returns all live cannon instances — each has a static
    // arcade body matching its structure hitbox (set up in OrcCannon ctor).
    this.physics.add.overlap(
      this.playerBolts,
      this._enemyManager.getCannons(),
      this._onBoltHitCannon,
      null,
      this
    );

    // ---- Pair 2: player bolts hitting OrcSilo structures ----
    this.physics.add.overlap(
      this.playerBolts,
      this._enemyManager.getSilos(),
      this._onBoltHitSilo,
      null,
      this
    );

    // ---- Pair 3: enemy plasma orbs hitting the player ----
    this.physics.add.overlap(
      this.enemyBolts,
      this._ship,
      this._onEnemyBoltHitPlayer,
      null,
      this
    );

    // ---- Pair 4: homing missiles hitting the player ----
    this.physics.add.overlap(
      this.missiles,
      this._ship,
      this._onMissileHitPlayer,
      null,
      this
    );

    // ---- Pair 5: player bolts intercepting in-flight missiles ----
    this.physics.add.overlap(
      this.playerBolts,
      this.missiles,
      this._onBoltInterceptMissile,
      null,
      this
    );
  }

  // ==========================================================
  // COLLISION CALLBACKS
  // ==========================================================

  // Pair 1 — player bolt hits OrcCannon structure
  _onBoltHitCannon(bolt, cannon) {
    if (!cannon.health || !cannon.health.isAlive()) return;

    bolt.kill();
    cannon.health.takeDamage(BOLT_DAMAGE);

    // Phaser camera shake: 150ms feedback on structure hit
    this.cameras.main.shake(150, 0.008);
  }

  // Pair 2 — player bolt hits OrcSilo structure
  _onBoltHitSilo(bolt, silo) {
    if (!silo.health || !silo.health.isAlive()) return;

    bolt.kill();
    silo.health.takeDamage(BOLT_DAMAGE);

    this.cameras.main.shake(150, 0.008);
  }

  // Pair 3 — enemy bolt hits player ship
  _onEnemyBoltHitPlayer(bolt, ship) {
    if (ship._invincible) return; // spawn invincibility still active

    bolt.kill();
    ship.takeDamage(1);

    // Screen flash red at low alpha — Phaser camera flash effect
    this.cameras.main.flash(200, 255, 0, 0, false);
  }

  // Pair 4 — homing missile hits player ship
  _onMissileHitPlayer(proxy, ship) {
    if (ship._invincible) return;

    // Ask the owning silo to run the impact explosion and deactivate the slot
    if (proxy._missileOwner) {
      proxy._missileOwner.detonateMissileProxy(proxy);
    } else {
      proxy.kill();
    }

    ship.takeDamage(25); // missiles deal heavy damage

    // Screen flash red — more intense than a bolt hit
    this.cameras.main.flash(300, 255, 0, 0, false);
  }

  // Pair 5 — player bolt intercepts a homing missile mid-air
  _onBoltInterceptMissile(bolt, proxy) {
    bolt.kill();

    let interceptPos = null;
    if (proxy._missileOwner) {
      // hitMissileProxy applies one hit; returns position only when destroyed
      interceptPos = proxy._missileOwner.hitMissileProxy(proxy);
    }

    // Phaser particle burst at the interception point
    if (interceptPos && this._interceptEmitter) {
      this._interceptEmitter.setPosition(interceptPos.x, interceptPos.y);
      this._interceptEmitter.explode(12);
    }
  }

  // ==========================================================
  // EFFECTS — particle emitters and the damage flash overlay
  // Called once from create()
  // ==========================================================

  _buildEffects() {
    // Ensure the shared ship-trail texture exists (PlayerShip creates it,
    // but we guard here in case the order changes)
    if (!this.textures.exists('ship_trail')) {
      const pg = this.make.graphics({ x: 0, y: 0, add: false });
      pg.fillStyle(0xffffff, 1);
      pg.fillRect(0, 0, 2, 2);
      pg.generateTexture('ship_trail', 2, 2);
      pg.destroy();
    }

    // ---- Muzzle flash — burst at the ship's nose on each shot ----
    this._muzzleEmitter = this.add.particles(0, 0, 'ship_trail', {
      speed:    { min: 60,  max: 180 },
      scale:    { start: 1.0, end: 0 },
      alpha:    { start: 1.0, end: 0 },
      tint:     [this._planeConf.color, 0xffffff],
      lifespan: 150,
      quantity: 0,       // burst mode — explode() fires manually
      emitting: false,
      blendMode: 'ADD',
    }).setDepth(15).setScrollFactor(1);

    // ---- Missile intercept burst — particle explosion when missile is shot ----
    this._interceptEmitter = this.add.particles(0, 0, 'ship_trail', {
      speed:    { min: 80,  max: 250 },
      scale:    { start: 1.5, end: 0 },
      alpha:    { start: 1.0, end: 0 },
      tint:     [0xff40ff, 0xff8800, 0xffffff],
      lifespan: 300,
      quantity: 0,
      emitting: false,
      blendMode: 'ADD',
    }).setDepth(20).setScrollFactor(1);
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
