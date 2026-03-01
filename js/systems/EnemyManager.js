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
    this._battlefieldW = 4800;

    // Seeded random — same seed → same layout within a session
    this._seed  = Math.random() * 1000;
    this._randN = 0;

    // Plain arrays of enemy instances — PilotGameScene performs manual
    // overlap checks each frame instead of using Phaser static groups
    // (which crash on Graphics objects due to missing getTopLeft()).
    this._cannonGroup = [];
    this._siloGroup   = [];

    // Create the shared 3×3 white pixel texture used by Phaser particle
    // emitters in OrcSilo (missile trail + impact bursts).
    // Only generated once per game; subsequent constructions are no-ops.
    this._ensureParticleTexture();

    this._generateBattlefield();
  }

  // Deterministic PRNG matching TerrainSystem's sine-hash approach.
  _seededRand() {
    return ((Math.sin(this._seed + this._randN++) * 9301 + 49297) % 233280) / 233280;
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
  // Procedural cursor-based placement: a guaranteed mix of silos and
  // cannons is shuffled, then additional cannons fill the remaining
  // battlefield.  A forward-marching cursor with per-enemy jitter
  // ensures every structure has at least MIN_GAP px of clear space
  // between adjacent footprint edges.
  // ================================================================

  _generateBattlefield() {
    const H = this._groundY;

    const CANNON_HALF     = 28;
    const SILO_HALF       = 140;
    const MIN_GAP         = 100;
    const SAFE_START      = 700;
    const BATTLEFIELD_END = this._battlefieldW - 500;

    // Guaranteed sequence: balanced silo/cannon mix
    const guaranteed = ['silo', 'cannon', 'silo', 'cannon', 'silo'];

    // Fisher-Yates shuffle using seeded random
    for (let i = guaranteed.length - 1; i > 0; i--) {
      const j = Math.floor(this._seededRand() * (i + 1));
      [guaranteed[i], guaranteed[j]] = [guaranteed[j], guaranteed[i]];
    }

    // Append additional cannons to fill the battlefield
    const order = [...guaranteed];
    const maxSlots = Math.ceil((BATTLEFIELD_END - SAFE_START) / 150);
    for (let i = 0; i < maxSlots; i++) {
      order.push('cannon');
    }

    // Cursor-based placement loop
    let cursor = SAFE_START;
    const placements = [];

    for (const type of order) {
      const half    = type === 'silo' ? SILO_HALF : CANNON_HALF;
      const centerX = cursor + half;
      const jitter  = 50 + Math.floor(this._seededRand() * 150);
      const pos     = centerX + jitter;

      cursor = pos + half + MIN_GAP;
      if (cursor > BATTLEFIELD_END) break;

      placements.push({ type, x: pos });
    }

    // Instantiate enemies at their procedural positions
    placements.forEach(p => {
      if (p.type === 'cannon') {
        const cannon = new OrcCannon(this._scene, p.x, H, this._enemyBolts);
        this._enemies.push(cannon);
        this._cannonGroup.push(cannon);
      } else {
        const silo = new OrcSilo(this._scene, p.x, H, this._missiles);
        this._enemies.push(silo);
        this._siloGroup.push(silo);
      }
    });

    console.log(`[EnemyManager] ${placements.length} enemies placed, cursor=${cursor}`);
    console.log('cannons=' + this._cannonGroup.length + ' silos=' + this._siloGroup.length);
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

  // Returns the plain array of all OrcCannon instances —
  // used by PilotGameScene for manual overlap checks each frame.
  getCannons() {
    return this._cannonGroup;
  }

  // Returns the plain array of all OrcSilo instances —
  // used by PilotGameScene for manual overlap checks each frame.
  getSilos() {
    return this._siloGroup;
  }

  // Expose the enemy array for any future systems (e.g. score counting).
  getEnemies() { return this._enemies; }
}
