/* ============================================================
   EnemyManager.js — Procedural Battlefield & Enemy Lifecycle
   ============================================================
   Owns the complete enemy population for a PILOT MODE mission:

   - Procedurally generates OrcCannon and OrcSilo emplacements
     across the 4800 px battlefield on construction.
   - Drives each enemy's update() each frame (forwarding Phaser
     time/delta and the player's current world position).
   - Provides collision helpers used by PilotGameScene to test
     enemy fire against the player ship.
   - render() is a no-op: enemies are Phaser.GameObjects.Graphics
     instances registered with the scene, so Phaser's own render
     loop draws them automatically at the correct world depth.

   Enemy world positions are chosen to give the player time to
   react to each new threat as it scrolls onto screen:

     OrcCannons : short-range plasma bolts, active when player
                  is within 400 world-space pixels.
     OrcSilos   : long-range homing missiles, active when the
                  silo enters the camera viewport.

   ============================================================ */

class EnemyManager {

  // scene        : active Phaser.Scene (PilotGameScene)
  // groundY      : screen-space Y of the ground surface (Math.floor(H * 0.72))
  // enemyBolts   : Phaser.GameObjects.Group (classType: Projectile) — OrcCannons
  //               fire orc plasma orbs into this shared pool
  // missiles     : Phaser.GameObjects.Group (classType: Projectile) — OrcSilos
  //               activate invisible physics proxies from this pool for overlap
  constructor(scene, groundY, enemyBolts = null, missiles = null) {
    this._scene      = scene;
    this._groundY    = groundY;
    this._enemies    = []; // mixed OrcCannon | OrcSilo array
    this._enemyBolts = enemyBolts;
    this._missiles   = missiles;

    // Create the shared 3×3 white pixel texture used by Phaser particle
    // emitters in OrcSilo (missile trail + impact bursts).
    // Only generated once per game; subsequent constructions are no-ops.
    this._ensureParticleTexture();

    this._generateBattlefield();
  }

  // ================================================================
  // PARTICLE TEXTURE
  // Phaser particle emitters need a texture. We generate a 3×3 white
  // square once and cache it as 'voidheart_particle' in the texture
  // manager. OrcSilo emitters then tint it at runtime.
  // ================================================================

  _ensureParticleTexture() {
    if (this._scene.textures.exists('voidheart_particle')) return;
    const g = this._scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 3, 3);
    g.generateTexture('voidheart_particle', 3, 3);
    g.destroy();
  }

  // ================================================================
  // BATTLEFIELD GENERATION
  // Spawns cannons and silos at hand-crafted world-space X positions
  // spread across the 4800 px battlefield. Positions are staggered so
  // the player always has time to react between threats.
  //
  // Layout overview (world X):
  //   ~600   — first cannon (warm-up, no silo surprise yet)
  //   ~900   — first silo  (introduces the missile mechanic)
  //   ~1300  — two cannons (flanking pair)
  //   ~1900  — silo + cannon combo
  //   ~2400  — dense cannon cluster (mid-game pressure)
  //   ~2900  — silo (second silo encounter)
  //   ~3300–3600 — two more cannons
  //   ~4000  — final silo
  //   ~4300–4500 — two closing cannons
  // ================================================================

  _generateBattlefield() {
    const H = this._groundY; // shorthand

    // ---- OrcCannon positions ----
    // Pass the shared enemyBolts group so each cannon fires Projectile orbs
    // into the Phaser physics pool (enabling arcade overlap in PilotGameScene).
    const cannonXs = [600, 1100, 1500, 1950, 2350, 2700, 3300, 3650, 4300, 4550];
    cannonXs.forEach(worldX => {
      this._enemies.push(new OrcCannon(this._scene, worldX, H, this._enemyBolts));
    });

    // ---- OrcSilo positions ----
    // Pass the shared missiles group so each silo activates invisible physics
    // proxies (enabling arcade overlap in PilotGameScene).
    const siloXs = [900, 1900, 2900, 4050];
    siloXs.forEach(worldX => {
      this._enemies.push(new OrcSilo(this._scene, worldX, H, this._missiles));
    });
  }

  // ================================================================
  // UPDATE — called from PilotGameScene.update() each frame.
  //
  // time         : Phaser scene time in ms (passed through to enemies)
  // delta        : Phaser frame delta in ms
  // playerWorldX : player ship's world-space X centre
  // playerY      : player ship's screen-space Y centre
  // cameraScrollX: camera.scrollX — used by OrcSilo for range detection
  // ================================================================

  update(time, delta, playerWorldX, playerY, cameraScrollX) {
    // Remove fully dead enemies so their update is never called again.
    // Their Phaser game objects have already been cleaned up internally.
    this._enemies = this._enemies.filter(e => e.isAlive());

    this._enemies.forEach(e => {
      if (e instanceof OrcCannon) {
        e.update(time, delta, playerWorldX, playerY);
      } else if (e instanceof OrcSilo) {
        e.update(time, delta, playerWorldX, playerY, cameraScrollX);
      }
    });
  }

  // ================================================================
  // RENDER — no-op.
  // OrcCannon and OrcSilo are Phaser.GameObjects.Graphics instances
  // registered with scene.add.existing(). Phaser's display list
  // renders them automatically via their renderCanvas() override.
  // ================================================================

  render() {}

  // ================================================================
  // COLLISION HELPERS — called from PilotGameScene each frame.
  // ================================================================

  // checkEnemyFireHitPlayer removed — replaced by Phaser arcade overlaps in
  // PilotGameScene (overlap pairs 3 and 4):
  //   this.physics.add.overlap(enemyBolts, playerShip, onEnemyBoltHitPlayer)
  //   this.physics.add.overlap(missiles,   playerShip, onMissileHitPlayer)

  // checkPlayerProjectileHitEnemy removed — replaced by Phaser arcade overlaps in
  // PilotGameScene (overlap pairs 1 and 2):
  //   this.physics.add.overlap(playerBolts, orcCannons, onBoltHitCannon)
  //   this.physics.add.overlap(playerBolts, orcSilos,   onBoltHitSilo)

  // Returns all live OrcCannon instances — used by PilotGameScene to register
  // arcade physics overlaps against the static structure physics bodies.
  getCannons() {
    return this._enemies.filter(e => e instanceof OrcCannon);
  }

  // Returns all live OrcSilo instances — same purpose as getCannons().
  getSilos() {
    return this._enemies.filter(e => e instanceof OrcSilo);
  }

  // Expose the enemy array for any future systems (e.g. score counting).
  getEnemies() { return this._enemies; }
}
