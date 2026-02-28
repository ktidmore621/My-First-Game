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

  // scene   : active Phaser.Scene (PilotGameScene)
  // groundY : screen-space Y of the ground surface (Math.floor(H * 0.72))
  constructor(scene, groundY) {
    this._scene   = scene;
    this._groundY = groundY;
    this._enemies = []; // mixed OrcCannon | OrcSilo array

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
    const cannonXs = [600, 1100, 1500, 1950, 2350, 2700, 3300, 3650, 4300, 4550];
    cannonXs.forEach(worldX => {
      this._enemies.push(new OrcCannon(this._scene, worldX, H));
    });

    // ---- OrcSilo positions ----
    const siloXs = [900, 1900, 2900, 4050];
    siloXs.forEach(worldX => {
      this._enemies.push(new OrcSilo(this._scene, worldX, H));
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

  // Tests enemy fire (bolts / missiles) against the player's hitbox.
  // Returns true on the first hit so the caller can apply damage once.
  //
  // playerWorldX, playerY : centre of player hitbox in world/screen space
  // hitW, hitH            : full hitbox dimensions in pixels
  checkEnemyFireHitPlayer(playerWorldX, playerY, hitW, hitH) {
    for (const e of this._enemies) {
      if (!e.isAlive()) continue;
      if (e instanceof OrcCannon) {
        if (e.checkBoltsHitPlayer(playerWorldX, playerY, hitW, hitH)) return true;
      } else if (e instanceof OrcSilo) {
        if (e.checkMissilesHitPlayer(playerWorldX, playerY, hitW, hitH)) return true;
      }
    }
    return false;
  }

  // Tests a player projectile against all living enemy structures.
  // Called once per projectile that was just fired.
  // projectile : { worldX, y, active } object with a deactivate() method.
  // Returns true if the projectile hit something and should be consumed.
  checkPlayerProjectileHitEnemy(projectile) {
    for (const e of this._enemies) {
      if (!e.isAlive()) continue;
      const hb = e.getStructureHitbox();
      // AABB: projectile point vs structure rectangle
      if (projectile.worldX >= hb.x && projectile.worldX <= hb.x + hb.w &&
          projectile.y      >= hb.y && projectile.y      <= hb.y + hb.h) {
        e.health.takeDamage(1);
        return true;
      }
    }
    return false;
  }

  // Expose the enemy array for any future systems (e.g. score counting).
  getEnemies() { return this._enemies; }
}
