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
     - Collision → 3 arcade overlaps + manual bolt-vs-enemy checks

   World layout:
     - World width:  BATTLEFIELD_W (4800 px), height: 540 px
     - Sky:          4-band flat background, setScrollFactor(0) — never scrolls
     - Ground:       Graphics spanning BATTLEFIELD_W — scrolls with camera
     - Camera:       follows PlayerShip with 0.1 lag; bounds clamped to world
     - HUD:          health bar + countdown timer, setScrollFactor(0) — fixed

   Collision pairs:
     1. playerBolts  → orcCannons   → manual AABB (camera shake)
     2. playerBolts  → orcSilos     → manual AABB (camera shake)
     3. enemyBolts   → playerShip   → physics.add.overlap (screen flash red)
     4. missiles     → playerShip   → physics.add.overlap (flash + explosion)
     5. playerBolts  → missiles     → physics.add.overlap (intercept burst)

   Game-over conditions (placeholder):
     - Ship health → 0       → 800 ms delay → back to MainMenuScene
     - 30-second timer fires  → 400 ms delay → back to MainMenuScene
   ============================================================ */

// Total pixel width of the scrolling battlefield
const BATTLEFIELD_W = 4800;

// Enemy X positions (match EnemyManager._generateBattlefield) used to flatten
// terrain under each structure before TerrainSystem.buildFeatures() is called.
const ENEMY_CANNON_XS = [600, 1100, 1500, 1950, 2350, 2700, 3300, 3650, 4300, 4550];
const ENEMY_SILO_XS   = [900, 1900, 2900, 4050];
const CANNON_FOOTPRINT = 80;   // world-px width of one OrcCannon structure
const SILO_FOOTPRINT   = 280;  // world-px width of one OrcSilo (including perimeter)
const CANNON_FLAT_HALF = 60;   // half of flat zone under cannons  (±60 px, 120 px total)
const SILO_FLAT_HALF   = 170;  // half of flat zone under silos    (±170 px, 340 px total)
const TERRAIN_BLEND_W  = 20;   // blend fringe on each flat-zone edge

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
    data = data || {};
    this._mode = data.mode || 'pilot';
    this._planeConfig = data.plane || {
      speed: 160,
      durability: 100,
      weaponSize: 1,
      maneuverability: 1,
      color: 0x00aaff
    };
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create() {
    this.add.rectangle(480, 270, 960, 540, 0x000011)
      .setScrollFactor(0).setDepth(998);
    this.add.text(480, 270, 'LOADING...', {
      fontSize: '28px', fill: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(999);

    const W = 960;
    const H = 540;
    const initErrors = [];

    // ---- Physics world bounds ----
    this.physics.world.setBounds(0, 0, BATTLEFIELD_W, H);

    // ---- Visuals (build order matters — lower depth = drawn first) ----
    this._buildSky(W, H);      // depth 0 — fixed, never scrolls

    // ---- Terrain system ----
    try {
      this._terrain = new TerrainSystem(this, BATTLEFIELD_W);

      ENEMY_CANNON_XS.forEach(x =>
        this._terrain.flattenZone(x + CANNON_FOOTPRINT / 2, CANNON_FLAT_HALF, TERRAIN_BLEND_W)
      );
      ENEMY_SILO_XS.forEach(x =>
        this._terrain.flattenZone(x + SILO_FOOTPRINT / 2, SILO_FLAT_HALF, TERRAIN_BLEND_W)
      );

      this._terrain.buildFeatures();
      this._terrain.build();
    } catch(e) { initErrors.push('TerrainSystem: ' + e.message); }

    // ---- Lighting system (depth 30–31, screen space) ----
    try {
      this._lighting = new LightingSystem(this);
      const featurePos = this._terrain.getFeaturePositions();
      this._lighting.setVoidheartPositions(featurePos.veins);
      this._lighting.setPoolPositions(featurePos.pools);
    } catch(e) { initErrors.push('LightingSystem: ' + e.message); }

    // ---- Projectile groups ----
    try {
      this.playerBolts = this.physics.add.group({
        classType:       Projectile,
        maxSize:         30,
        runChildUpdate:  true,
      });

      this.enemyBolts = this.physics.add.group({
        classType:       Projectile,
        maxSize:         50,
        runChildUpdate:  true,
      });

      this.missiles = this.physics.add.group({
        classType:       Projectile,
        maxSize:         8,
        runChildUpdate:  true,
      });
    } catch(e) { initErrors.push('ProjectileGroups: ' + e.message); }

    // ---- Player ship ----
    try {
      this._ship = new PlayerShip(this, 120, H / 2, this._planeConfig);
      this._ship.setDepth(10);

      this._aimLineGfx = this.add.graphics().setDepth(35);

      this._ship.on('destroyed', () => this._triggerGameOver('defeated'));
    } catch(e) { initErrors.push('PlayerShip: ' + e.message); }

    // ---- Camera ----
    try {
      this.cameras.main.setBounds(0, 0, BATTLEFIELD_W, H);
      this.cameras.main.startFollow(this._ship, true, 0.1, 0.1);
      this.cameras.main.setZoom(1.0);
    } catch(e) { initErrors.push('Camera: ' + e.message); }

    // ---- Input system ----
    try {
      this._input = new InputSystem(this);
      this._input.weaponSelectBtn.setVisible(false);
      this._input.evadeBtn.setVisible(false);
      this._input.fireBtn.setVisible(true);
    } catch(e) { initErrors.push('InputSystem: ' + e.message); }

    // ---- HUD (fixed to viewport) ----
    try {
      this._buildHUD(W, H);
    } catch(e) { initErrors.push('setupHUD: ' + e.message); }

    // ---- Sound system (stub — no audio assets yet) ----
    try {
      this._sound = new SoundSystem(this);
    } catch(e) { initErrors.push('SoundSystem: ' + e.message); }

    // ---- Enemy population ----
    try {
      const groundY = Math.floor(H * 0.72);
      this._enemyManager = new EnemyManager(
        this, groundY, this.enemyBolts, this.missiles
      );
    } catch(e) { initErrors.push('EnemyManager: ' + e.message); }

    // ---- Phaser effects ----
    try {
      this._buildEffects();
    } catch(e) { initErrors.push('buildEffects: ' + e.message); }

    // ---- Arcade physics collision pairs ----
    try {
      this._setupCollision();
    } catch(e) { initErrors.push('setupCollision: ' + e.message); }

    // ---- Game state ----
    this._elapsed      = 0;
    this._missionTime  = 30;   // seconds; placeholder mission length
    this._gameOver     = false;
    this._trauma       = 0;    // camera shake trauma value (0–1)
    this._fireCooldown = 0;    // seconds until next shot is allowed

    // ---- Init error display (on-screen, no console needed) ----
    if (initErrors.length > 0) {
      this.add.rectangle(480, 270, 900, 400, 0x000000, 0.9)
        .setScrollFactor(0).setDepth(1000);
      this.add.text(480, 100, 'INIT ERRORS:', {
        fontSize: '18px', fill: '#ff0000'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
      initErrors.forEach((err, i) => {
        this.add.text(480, 140 + (i * 35), err, {
          fontSize: '13px', fill: '#ffff00',
          wordWrap: { width: 860 }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
      });
    }
  }

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(time, delta) {
    if (this._gameOver) return;

    this._input.update();

    const dt = delta / 1000;
    this._elapsed += dt;

    // Terrain animated overlay + parallax scrolling + dust particles
    this._terrain.update(time, delta);

    // ---- Missile exhaust glow — add a light source per active missile ----
    this.missiles.getChildren().forEach(m => {
      if (m.active) this._lighting.addMissileExhaust(m.x, m.y);
    });

    // ---- Lighting layer (always after game objects update, before HUD) ----
    this._lighting.update(time, delta);

    // ---- Enemy bolts that reach the ground: spawn dirt impact burst ----
    // horizonY sits at 72% of 540 = ~388 px; add terrain max-dip of 22 px.
    const groundImpactY = Math.floor(540 * 0.72) + 22;
    this.enemyBolts.getChildren().forEach(bolt => {
      if (!bolt.active) return;
      if (bolt.y >= groundImpactY) {
        this._terrain.spawnImpact(bolt.x, bolt.y);
        bolt.kill();
      }
    });

    // Ship movement + effects
    this._ship.update(this._input, dt);

    // ---- FIRE player bolt ----
    // Right stick deflection > 0.1 triggers continuous fire (rate-limited);
    // the FIRE button also fires on each press.
    this._fireCooldown = Math.max(0, this._fireCooldown - dt);
    const aimMag = Math.hypot(this._input.rightStick.x, this._input.rightStick.y);
    if ((aimMag > 0.1 || this._input.firePressed) && this._fireCooldown <= 0) {
      this._firePlayerBolt();
      this._fireCooldown = 0.15;
      this._ship._fireFeedbackFrame = true;
    }

    // Update all enemies (OrcCannons + OrcSilos via EnemyManager)
    this._enemyManager.update(
      time,
      delta,
      this._ship.x,                  // player world X
      this._ship.y,                  // player screen Y
      this.cameras.main.scrollX      // camera left-edge world X
    );

    // Manual bolt-vs-enemy overlap checks (replaces static group pairs)
    this._checkBoltEnemyOverlaps();

    // Update on-screen HUD
    this._updateHUD();

    // Camera trauma — continuous shake that decays over time
    this._updateTrauma(dt);

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

    // Determine aim direction: right stick if deflected, else ship velocity direction
    const aim    = this._input.rightStick;
    const aimMag = Math.hypot(aim.x, aim.y);
    let angle;
    if (aimMag > 0.1) {
      angle = Math.atan2(aim.y, aim.x);
    } else {
      const vx  = this._ship.body.velocity.x;
      const vy  = this._ship.body.velocity.y;
      const spd = Math.sqrt(vx * vx + vy * vy);
      angle = spd > 15 ? Math.atan2(vy, vx) : 0;
    }

    const bvx = Math.cos(angle) * BOLT_SPEED;
    const bvy = Math.sin(angle) * BOLT_SPEED;

    // Spawn bolt at the ship's rotated nose tip (half-width = 32 px)
    const shipRad = Phaser.Math.DegToRad(this._ship.angle);
    const noseX   = this._ship.x + Math.cos(shipRad) * 32;
    const noseY   = this._ship.y + Math.sin(shipRad) * 32;

    bolt.fire(noseX, noseY, bvx, bvy, BOLT_DAMAGE, this._planeConfig.color, angle);

    // ---- Muzzle flash — particle burst at the bolt spawn point ----
    if (this._muzzleEmitter) {
      this._muzzleEmitter.setPosition(noseX, noseY);
      this._muzzleEmitter.explode(6);
    }

    // Muzzle light bloom
    this._lighting.addMuzzleFlash(noseX, noseY);
    this._sound.fireWeapon();
  }

  // ==========================================================
  // COLLISION SETUP — Phaser arcade physics overlaps
  //
  // Called once from create(). All five pairs are registered here
  // so they run automatically every physics step (no per-frame calls).
  // ==========================================================

  _setupCollision() {
    // Pairs 1 & 2 (player bolts vs cannons/silos) are handled by
    // _checkBoltEnemyOverlaps() each frame — plain arrays instead of
    // static groups to avoid the getTopLeft() crash on Graphics objects.

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
  // MANUAL BOLT-vs-ENEMY OVERLAP — replaces static group pairs
  //
  // Called every frame from update(). Tests each active player
  // bolt against all live cannons and silos using simple AABB
  // distance checks matching the original static body sizes.
  // ==========================================================

  _checkBoltEnemyOverlaps() {
    if (!this.playerBolts) return;
    const bolts   = this.playerBolts.getChildren();
    const cannons = this._enemyManager.getCannons();
    const silos   = this._enemyManager.getSilos();

    bolts.forEach(bolt => {
      if (!bolt.active || !bolt.body || !bolt.body.enable) return;
      const bx = bolt.x;
      const by = bolt.y;

      cannons.forEach(cannon => {
        if (!cannon.health || !cannon.health.isAlive()) return;
        const dx = Math.abs(bx - cannon.x);
        const dy = Math.abs(by - cannon.y);
        if (dx < 28 && dy < 150) {
          this._onBoltHitCannon(bolt, cannon);
        }
      });

      silos.forEach(silo => {
        if (!silo.health || !silo.health.isAlive()) return;
        const dx = Math.abs(bx - silo.x);
        const dy = Math.abs(by - silo.y);
        if (dx < 60 && dy < 180) {
          this._onBoltHitSilo(bolt, silo);
        }
      });
    });
  }

  // ==========================================================
  // COLLISION CALLBACKS
  // ==========================================================

  // Pair 1 — player bolt hits OrcCannon structure
  _onBoltHitCannon(bolt, cannon) {
    window._ipcfHitCount = (window._ipcfHitCount || 0) + 1;
    if (!cannon.health || !cannon.health.isAlive()) return;

    bolt.kill();
    cannon.health.takeDamage(BOLT_DAMAGE);

    // Trauma-based shake on every hit
    this._addTrauma(0.10);
    this._sound.enemyHit(cannon.x, cannon.y);

    // Small impact spark burst at the hit point
    if (this._impactEmitter) {
      this._impactEmitter.setPosition(cannon.x, cannon.y);
      this._impactEmitter.explode(8);
    }

    // Large explosion effects when the cannon is destroyed
    if (!cannon.health.isAlive()) {
      this._lighting.addExplosionLight(cannon.x, cannon.y);
      this._triggerExplosionZoom();
      this._sound.explosion(cannon.x, cannon.y);
      if (this._explosionEmitter) {
        this._explosionEmitter.setPosition(cannon.x, cannon.y);
        this._explosionEmitter.explode(30);
      }
    }
  }

  // Pair 2 — player bolt hits OrcSilo structure
  _onBoltHitSilo(bolt, silo) {
    window._ipcfHitCount = (window._ipcfHitCount || 0) + 1;
    if (!silo.health || !silo.health.isAlive()) return;

    bolt.kill();
    silo.health.takeDamage(BOLT_DAMAGE);

    this._addTrauma(0.10);
    this._sound.enemyHit(silo.x, silo.y);

    if (this._impactEmitter) {
      this._impactEmitter.setPosition(silo.x, silo.y);
      this._impactEmitter.explode(8);
    }

    if (!silo.health.isAlive()) {
      this._lighting.addExplosionLight(silo.x, silo.y);
      this._triggerExplosionZoom();
      this._sound.explosion(silo.x, silo.y);
      if (this._explosionEmitter) {
        this._explosionEmitter.setPosition(silo.x, silo.y);
        this._explosionEmitter.explode(40);  // bigger structure → bigger blast
      }
    }
  }

  // Pair 3 — enemy bolt hits player ship
  _onEnemyBoltHitPlayer(bolt, ship) {
    if (!this._ship || !this._ship.health.isAlive()) return;
    if (ship._invincible) return; // spawn invincibility still active

    bolt.kill();
    ship.takeDamage(1);

    this._addTrauma(0.25);
    this._sound.playerHit();
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

    this._addTrauma(0.70);
    this._lighting.addExplosionLight(ship.x, ship.y);
    this._triggerExplosionZoom();
    this._sound.explosion(ship.x, ship.y);
    this._sound.playerHit();

    if (this._explosionEmitter) {
      this._explosionEmitter.setPosition(ship.x, ship.y);
      this._explosionEmitter.explode(25);
    }

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

    this._addTrauma(0.15);

    // Phaser particle burst at the interception point
    if (interceptPos && this._interceptEmitter) {
      this._interceptEmitter.setPosition(interceptPos.x, interceptPos.y);
      this._interceptEmitter.explode(12);
    }

    // Light flash at intercept point
    if (interceptPos) {
      this._lighting.addExplosionLight(interceptPos.x, interceptPos.y);
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
      tint:     [this._planeConfig.color, 0xffffff],
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

    // ---- Impact sparks — small burst on every structure hit ----
    this._impactEmitter = this.add.particles(0, 0, 'ship_trail', {
      speed:    { min: 40,  max: 160 },
      scale:    { start: 1.2, end: 0 },
      alpha:    { start: 1.0, end: 0 },
      tint:     [0xff8800, 0xffcc00, 0xffffff],
      lifespan: 200,
      quantity: 0,
      emitting: false,
      blendMode: 'ADD',
    }).setDepth(18).setScrollFactor(1);

    // ---- Voidheart explosion — large burst on enemy destruction ----
    // Two tint groups: purplish-red for Voidheart ore, gold for shrapnel
    this._explosionEmitter = this.add.particles(0, 0, 'ship_trail', {
      speed:    { min: 60,  max: 300 },
      scale:    { start: 2.0, end: 0 },
      alpha:    { start: 1.0, end: 0 },
      tint:     [0xaa2060, 0xc8901a, 0xff4400, 0xffffff],
      lifespan: 600,
      quantity: 0,
      emitting: false,
      blendMode: 'ADD',
      gravityY:  80,
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
  // GROUND — replaced by TerrainSystem (see js/systems/TerrainSystem.js)
  //
  // TerrainSystem.build() creates:
  //   depth 0.5  — far parallax hills  (TileSprite)
  //   depth 0.7  — near parallax hills (TileSprite)
  //   depth 1    — static ground       (Image from offscreen canvas)
  //   depth 1.5  — animated overlay    (Graphics, redrawn each frame)
  // ==========================================================

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

    // ---- Aim line — red dashed line from ship nose in aim direction ----
    // World-space so it scrolls with the camera and sits just below the ship.
    if (!this._aimLineGfx) return;
    this._aimLineGfx.clear();

    const aim    = this._input.rightStick;
    const aMag   = Math.hypot(aim.x, aim.y);
    let aimAngle;
    if (aMag > 0.1) {
      aimAngle = Math.atan2(aim.y, aim.x);
    } else {
      const vx  = this._ship.body.velocity.x;
      const vy  = this._ship.body.velocity.y;
      const spd = Math.sqrt(vx * vx + vy * vy);
      aimAngle = spd > 15 ? Math.atan2(vy, vx) : 0;
    }

    const shipRad = Phaser.Math.DegToRad(this._ship.angle);
    const noseX   = this._ship.x + Math.cos(shipRad) * 32;
    const noseY   = this._ship.y + Math.sin(shipRad) * 32;

    // Draw dashed line: 8px dash / 5px gap, 120px total
    // Active aim (right stick deflected) = 3px full alpha; passive direction = 2px dim
    const DASH  = 8;
    const GAP   = 5;
    const TOTAL = 120;
    const aimWidth = aMag > 0.1 ? 3 : 2;
    const aimAlpha = aMag > 0.1 ? 1.0 : 0.6;
    this._aimLineGfx.lineStyle(aimWidth, 0xff4400, aimAlpha);
    let d = 0;
    let drawSeg = true;
    while (d < TOTAL) {
      const segLen = Math.min(drawSeg ? DASH : GAP, TOTAL - d);
      if (drawSeg) {
        const x1 = noseX + Math.cos(aimAngle) * d;
        const y1 = noseY + Math.sin(aimAngle) * d;
        const x2 = noseX + Math.cos(aimAngle) * (d + segLen);
        const y2 = noseY + Math.sin(aimAngle) * (d + segLen);
        this._aimLineGfx.beginPath();
        this._aimLineGfx.moveTo(x1, y1);
        this._aimLineGfx.lineTo(x2, y2);
        this._aimLineGfx.strokePath();
      }
      d += segLen;
      drawSeg = !drawSeg;
    }
  }

  // ==========================================================
  // CAMERA TRAUMA — continuous shake that decays over time
  //
  // addTrauma(amount)   — 0–1; clamps to [0,1]; stacks additively
  // _updateTrauma(dt)   — call every frame; drives follow offset + decay
  // ==========================================================

  _addTrauma(amount) {
    this._trauma = Math.min(1.0, this._trauma + amount);
  }

  _updateTrauma(dt) {
    if (this._trauma <= 0) {
      this._trauma = 0;
      this.cameras.main.setFollowOffset(0, 0);
      return;
    }

    // Intensity scales as trauma² for a natural, graduated feel
    const intensity = this._trauma * this._trauma * 18; // px
    const ox = (Math.random() * 2 - 1) * intensity;
    const oy = (Math.random() * 2 - 1) * intensity;
    this.cameras.main.setFollowOffset(ox, oy);

    // Decay rate: 2.0 units per second — fully settled in ~0.5 s after a hard hit
    this._trauma = Math.max(0, this._trauma - dt * 2.0);
  }

  // ==========================================================
  // EXPLOSION ZOOM — brief 1.1× zoom on large explosions
  // ==========================================================

  _triggerExplosionZoom() {
    // Kill any pending zoom tween so a rapid sequence doesn't compound
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({
      targets:  this.cameras.main,
      zoom:     1.1,
      duration: 120,
      ease:     'Power2',
      onComplete: () => {
        this.tweens.add({
          targets:  this.cameras.main,
          zoom:     1.0,
          duration: 500,
          ease:     'Power2',
        });
      },
    });
  }

  // ==========================================================
  // GAME OVER
  // ==========================================================

  _triggerGameOver(result) {
    if (this._gameOver) return;
    this._gameOver = true;

    const score = Math.floor(this._elapsed * 10);

    if (result === 'defeated') {
      // Slow zoom in to 1.3× then fade to black — cinematic death sequence
      this.tweens.add({
        targets:  this.cameras.main,
        zoom:     1.3,
        duration: 900,
        ease:     'Power2',
      });
      this.cameras.main.fade(900, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this._cleanup();
        this.scene.start('GameOverScene', { result: 'defeated', score, plane: this._planeConfig });
      });
    } else {
      // Victory — short delay then transition (no death animation needed)
      this.time.delayedCall(400, () => {
        this._cleanup();
        this.scene.start('GameOverScene', { result: 'victory', score, plane: this._planeConfig });
      });
    }
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
    if (this._lighting) {
      this._lighting.destroy();
      this._lighting = null;
    }
    if (this._aimLineGfx) {
      this._aimLineGfx.destroy();
      this._aimLineGfx = null;
    }
  }

  // Called by Phaser when the scene stops (via scene.start/stop)
  shutdown() {
    this._cleanup();
  }
}
