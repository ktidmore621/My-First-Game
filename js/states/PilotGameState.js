/* ============================================================
   PilotGameState.js
   ============================================================
   The main gameplay screen for PILOT MODE.

   Left stick = movement (all directions). Right stick = weapon aim.
   HUD shows health bar, mode label, and elapsed time.

   ----------------------------------------------------------------
   CAMERA & WORLD OFFSET SYSTEM
   ----------------------------------------------------------------
   The battlefield is a wide fixed arena — 5× the canvas width
   (4800px). The player has a world-space position (_worldX) that
   tracks where they are inside that arena.

   Each frame, the CAMERA OFFSET (_cameraX) is computed so the
   player stays horizontally centred on screen:

       _cameraX = clamp(_worldX − W/2,  0,  BATTLEFIELD_W − W)

   The player's SCREEN X is then derived from the two world values:

       player.x = _worldX − _cameraX

   While the player is away from both battlefield edges, _cameraX
   tracks _worldX exactly and player.x stays at W/2 (≈ 480) — the
   world moves, the ship holds still. Near either edge, the camera
   clamp kicks in; the player drifts toward the edge of the screen,
   making the boundary feel solid. A darkening vignette reinforces
   the wall (see _drawBoundaryIndicator).

   The ground and all world objects are drawn using _cameraX as
   their scroll offset:
     - Moving right  → _worldX grows → _cameraX grows → ground
       shifts left.
     - Moving left   → _cameraX shrinks → ground shifts right.
     - Holding still → _cameraX constant → world holds still.

   Vertical movement (up/down) is screen-space only — the camera
   does not pan vertically.

   ----------------------------------------------------------------
   BACKGROUND SYSTEM
   ----------------------------------------------------------------
   The sky is flat horizontal colour bands — it never scrolls.
   The ground is a single tiled layer (960px wide) drawn at an
   offset of (_cameraX % TILE_W), creating seamless looping that
   responds to actual player movement rather than a fixed clock.

   VISUAL STYLE (see Visual Style Guide in CLAUDE.md):
     - ctx.imageSmoothingEnabled = false at the top of render()
     - Sky: four flat colour bands, no createLinearGradient
     - Ground base: three flat colour bands, no createLinearGradient
     - Ground features: fillRect only — no ellipse() or arc()

   WHAT TO BUILD NEXT:
     - Parallax mid-ground and far-hill layers for depth
     - Enemy objects with world-space positions that scroll with ground
     - Bullet / projectile firing from the aim direction
     - Collision detection (AABB)
     - Real mission objectives replacing the 30-second placeholder
   ============================================================ */

// ================================================================
// LEVEL CONFIGURATION
// ================================================================
// Battlefield generation parameters for Level 1.
// Pass a different config object to _generateBattlefield() for later
// levels — count, spacing, and zone sizes all scale with difficulty.
const LEVEL_1_CONFIG = {
  level:             1,
  battlefieldWidth:  5000,
  minEnemies:        6,
  maxEnemies:        8,
  guaranteedCannons: 3,
  guaranteedSilos:   2,
  minSpacing:        280,
  safeZoneStart:     800,
  safeZoneEnd:       500,
};

class PilotGameState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;

    // The player's plane (set in PlaneSelectState; fall back to default)
    this._player = gameData.selectedPlane || new Plane({
      id: 'default', name: 'Fighter',
      speed: 70, durability: 80, weaponSize: 60, maneuverability: 70,
      x: 480, y: 270,
    });

    // Aim angle in radians (0 = pointing right)
    this._aimAngle = 0;

    this._elapsedTime     = 0;
    this._gameOverPending = false;

    this._W = 960;
    this._H = 540;

    // ================================================================
    // CAMERA & WORLD OFFSET SYSTEM
    // ================================================================

    // _BATTLEFIELD_W is assigned by _generateBattlefield() below via the
    // level config. Declared first so all downstream code can reference it.
    this._BATTLEFIELD_W = 0; // overwritten immediately by _generateBattlefield

    // _worldX: player's current X position in world space (pixels).
    //   Range: [player.width/2 … BATTLEFIELD_W − player.width/2]
    //   Starts at 250 — safely inside safeZoneStart (800 px), well
    //   clear of the first procedurally placed enemy.
    this._worldX = 250; // safe spawn: 250 px inside the battlefield

    // _cameraX: world-space X of the screen's left edge (pixels).
    //   Computed every frame in update(). Range: [0 … BATTLEFIELD_W − W].
    //   While the player is mid-field, this equals _worldX − W/2.
    //   Near the left/right battlefield edge it clamps so we never
    //   render outside the arena.
    this._cameraX = 0;

    // ---- Ground tile setup ----
    // Tile width = canvas width. Two tiles drawn side-by-side, shifted by
    // (_cameraX % TILE_W), create seamless looping. See _drawGround().
    this._TILE_W = 960;

    // ================================================================
    // PROCEDURAL BATTLEFIELD GENERATION
    // ================================================================
    // Generates enemy layout and terrain seed fresh each time a level
    // loads. Sets this._BATTLEFIELD_W, this._enemies, this._terrainSeed.
    this._generateBattlefield(LEVEL_1_CONFIG);

    // Build the ground detail tile using this run's terrain seed.
    // Same seed always yields the same tile layout — consistent mid-run.
    this._groundFeatures = _buildGroundFeatures(this._terrainSeed);

    // Register death callback
    this._player.health.onDeath(() => {
      if (!this._gameOverPending) {
        this._gameOverPending = true;
        this._gameData.score  = Math.floor(this._elapsedTime * 10);
        this._gameData.result = 'defeated';
        setTimeout(() => {
          this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
        }, 800);
      }
    });

    // ================================================================
    // PX-9 RAPID PLASMA ARRAY — PROJECTILE POOL
    // ================================================================
    // Pre-allocate 30 Projectile slots once and reuse them throughout
    // the game session. No new objects are created during gameplay.
    // See Projectile.js for the full pooling design rationale.
    this._projectilePool = [];
    for (let i = 0; i < 30; i++) {
      this._projectilePool.push(new Projectile());
    }

    // Fire interval in seconds: 8 shots/sec = 0.125 s between shots.
    // A named constant makes tuning easy — one number to change.
    this._FIRE_INTERVAL = 1 / 8;

    // Counts down from _FIRE_INTERVAL to 0. When it reaches 0 the next
    // right-stick push fires a shot. Initialised to 0 so the very first
    // stick push fires immediately without waiting a full interval.
    this._fireCooldown = 0;

    // Muzzle flash timer: non-zero while the firing flash should be drawn.
    // Duration = 2 frames at 60 fps (≈ 33 ms) — a brief bright flicker.
    this._MUZZLE_FLASH_DURATION = 2 / 60;
    this._muzzleFlashTimer      = 0;

    // ================================================================
    // SPAWN INVINCIBILITY
    // ================================================================
    // 2-second grace period after spawn: player cannot take damage.
    // A 2 Hz pulsing 1px cyan outline confirms the shield is active.
    this._spawnInvincible = true;
    this._invincibleTimer = 2.0; // seconds of invincibility remaining
    this._invinciblePulse = 0;   // time accumulator driving the shimmer pulse

    // ================================================================
    // TARGET DIRECTION ARROW
    // ================================================================
    // Time accumulator for the 0.6-second size-pulse on the arrow
    // that appears when no threats remain ahead in the direction of travel.
    this._arrowPulseT = 0;
  }

  // ================================================================
  // PROCEDURAL BATTLEFIELD GENERATION
  // ================================================================
  // Populates this._BATTLEFIELD_W, this._enemies, and this._terrainSeed
  // from the provided level config. Called once from the constructor.
  //
  // Enemy count:  random integer in [config.minEnemies, config.maxEnemies].
  // Type mix:     guaranteed cannons + guaranteed silos placed first; any
  //               remaining slots filled at 60 % cannon / 40 % silo.
  // Order:        the full type list is Fisher-Yates shuffled so the
  //               arrangement is different every run.
  // Spacing:      each enemy is preceded by a random gap in the range
  //               [minSpacing, minSpacing × 2.2] world-px.
  // Placement stops early if the next enemy would fall inside the right
  // safe zone (last config.safeZoneEnd px of the battlefield).
  _generateBattlefield(config) {
    // Step 1 — Battlefield width comes directly from config
    this._BATTLEFIELD_W = config.battlefieldWidth;

    // Step 2 — Determine total enemy count and build the type list
    const totalEnemies = config.minEnemies +
      Math.floor(Math.random() * (config.maxEnemies - config.minEnemies + 1));

    // Guaranteed units first; extra slots filled at 60/40 cannon-to-silo ratio
    const extraSlots = Math.max(0, totalEnemies - config.guaranteedCannons - config.guaranteedSilos);
    const types      = [];
    for (let i = 0; i < config.guaranteedCannons; i++) types.push('cannon');
    for (let i = 0; i < config.guaranteedSilos;   i++) types.push('silo');
    for (let i = 0; i < extraSlots; i++) {
      types.push(Math.random() < 0.6 ? 'cannon' : 'silo');
    }

    // Fisher-Yates shuffle — randomise placement order each run
    for (let i = types.length - 1; i > 0; i--) {
      const j   = Math.floor(Math.random() * (i + 1));
      const tmp = types[i]; types[i] = types[j]; types[j] = tmp;
    }

    // Step 3 — Terrain seed and height map generated BEFORE enemy placement
    // so each enemy receives a terrain-accurate ground anchor Y.
    this._terrainSeed    = Math.random() * 1000;
    this._terrainHeights = this._buildTerrainHeights();

    // Step 4 — Place enemies with guaranteed minimum spacing
    const CANNON_FOOTPRINT = 80;   // world-px width of one OrcCannon structure
    const SILO_FOOTPRINT   = 280;  // world-px width of one OrcSilo including perimeter
    const baseGroundY      = Math.round(this._H * 0.72);
    const rightBound       = config.battlefieldWidth - config.safeZoneEnd;

    let cursor    = config.safeZoneStart;
    this._enemies = [];

    for (const type of types) {
      const footprint = type === 'cannon' ? CANNON_FOOTPRINT : SILO_FOOTPRINT;
      // Random gap before this enemy: [minSpacing, minSpacing × 2.2]
      const jitter   = config.minSpacing +
        Math.random() * (config.minSpacing * 2.2 - config.minSpacing);
      const position = cursor + jitter;

      // Honour right-edge safe zone — stop early if needed
      if (position + footprint > rightBound) break;

      // Anchor each enemy to the terrain surface at its world-space centre
      const midX    = position + footprint / 2;
      const enemyGY = Math.round(baseGroundY - this._getTerrainHeightAt(midX));

      this._enemies.push(
        type === 'cannon'
          ? new OrcCannon(position, enemyGY)
          : new OrcSilo(position, enemyGY)
      );
      cursor = position + footprint; // advance past this structure
    }

    // Step 5 — Console report for verification
    const typeList = this._enemies.map(e => e.constructor.name).join(', ');
    console.log(
      `[Battlefield] Generated ${this._enemies.length} enemies across ${this._BATTLEFIELD_W}px battlefield`
    );
    console.log(`[Battlefield] Terrain seed: ${this._terrainSeed.toFixed(1)} | Placement: ${typeList}`);
    console.log(`[Battlefield] Terrain heights: ${this._terrainHeights.length} samples every 32 px | range −14…+10 px`);
  }

  // ================================================================
  // TERRAIN HEIGHT MAP
  // ================================================================

  // Builds the terrain height array — one sample every 32 world-px across
  // the full battlefield. For a 5000 px arena that is 157 samples
  // (positions 0, 32, 64 … 4992). Heights range from −14 to +10 px
  // relative to the baseline horizonY (positive = raised, negative = dipped).
  //
  // The seeded-random formula mirrors _buildGroundFeatures so both systems
  // share a single reproducible seed. Two smoothing passes convert the raw
  // noise into gentle rolling hills.
  _buildTerrainHeights() {
    const STEP  = 32;
    const count = Math.floor(this._BATTLEFIELD_W / STEP) + 1; // 157 for 5000 px
    const seed  = this._terrainSeed;

    // Seeded random — identical formula to _buildGroundFeatures for consistency
    let _n = 0;
    const sr  = () => ((Math.sin(seed + _n++) * 9301 + 49297) % 233280) / 233280;
    // Normalise the [~0.1715, ~0.2512] output range to [0, 1]
    const srf = () => Math.max(0, Math.min(1, (sr() - 0.1715) / (0.2512 - 0.1715)));

    // Raw heights: map [0, 1] → [−14, +10]  (24 px total range)
    const heights = new Array(count);
    for (let i = 0; i < count; i++) {
      heights[i] = srf() * 24 - 14;
    }

    // Smooth twice: each value becomes a weighted average of itself and its
    // two neighbours, converting jagged noise into gentle rolling hills.
    //   height[i] = height[i−1] × 0.25 + height[i] × 0.50 + height[i+1] × 0.25
    for (let pass = 0; pass < 2; pass++) {
      const smoothed = heights.slice(); // copy before modifying in place
      for (let i = 1; i < count - 1; i++) {
        smoothed[i] = heights[i - 1] * 0.25 + heights[i] * 0.5 + heights[i + 1] * 0.25;
      }
      for (let i = 0; i < count; i++) heights[i] = smoothed[i];
    }

    return heights;
  }

  // Returns the interpolated terrain height (px) at any world-space X.
  // Linear interpolation between the two nearest 32 px sample points gives
  // smooth height transitions with no visible stepping even at 4 px columns.
  // Clamped at both ends so querying outside [0, BATTLEFIELD_W] is safe.
  _getTerrainHeightAt(worldX) {
    const STEP = 32;
    const raw  = worldX / STEP;
    const i0   = Math.max(0, Math.min(Math.floor(raw), this._terrainHeights.length - 1));
    const i1   = Math.min(i0 + 1, this._terrainHeights.length - 1);
    const t    = raw - Math.floor(raw);
    return this._terrainHeights[i0] + (this._terrainHeights[i1] - this._terrainHeights[i0]) * t;
  }

  enter() {
    console.log('[State] Pilot Mode — plane:', this._player.name,
      '| battlefield:', this._BATTLEFIELD_W, 'px wide',
      '| starting worldX:', Math.round(this._worldX));
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    this._elapsedTime += dt;

    // ---- Spawn invincibility countdown ----
    // Ticks down for 2 seconds after entering the state. While active the
    // player cannot take damage. _invinciblePulse drives the shimmer render.
    if (this._spawnInvincible) {
      this._invincibleTimer -= dt;
      this._invinciblePulse += dt;
      if (this._invincibleTimer <= 0) this._spawnInvincible = false;
    }

    // ---- Target arrow pulse accumulator ----
    this._arrowPulseT += dt;

    // ---- Player movement ----
    // velocityX moves the player through WORLD space (drives _worldX).
    // velocityY moves the player through SCREEN space (drives player.y).
    // Both are driven by the left thumbstick.
    const maxSpeed = (this._player.speed          / 100) * 220;
    const turnRate = (this._player.maneuverability / 100) * 10 + 4;

    if (this._input.leftStick.active) {
      // Smooth velocity toward the stick target using turnRate as a lerp speed
      this._player.velocityX += (this._input.leftStick.x * maxSpeed - this._player.velocityX) * turnRate * dt;
      this._player.velocityY += (this._input.leftStick.y * maxSpeed - this._player.velocityY) * turnRate * dt;

      // Rotate the plane to face its direction of travel when moving fast enough
      const spd = Math.hypot(this._player.velocityX, this._player.velocityY);
      if (spd > 15) {
        this._player.angle = Math.atan2(this._player.velocityY, this._player.velocityX);
      }
    } else {
      // Decelerate naturally when no stick input
      this._player.velocityX *= 0.88;
      this._player.velocityY *= 0.88;
    }

    // ---- Horizontal: advance the player through world space ----
    // _worldX is the authoritative position. The screen X is derived
    // later from _worldX and _cameraX — the player never flies to the
    // edge of the canvas under normal conditions.
    this._worldX += this._player.velocityX * dt;

    // Hard boundary: clamp to the battlefield edges so the player cannot
    // fly off the left or right end of the arena.
    const hw = this._player.width  / 2;
    this._worldX = Math.max(hw, Math.min(this._BATTLEFIELD_W - hw, this._worldX));

    // ---- Vertical: move the player within screen space ----
    // The camera does not pan vertically, so player.y is screen-space only.
    this._player.y += this._player.velocityY * dt;
    const hh = this._player.height / 2;
    this._player.y = Math.max(hh + 30, Math.min(this._H - hh - 30, this._player.y));

    // ---- Update camera offset ----
    // The camera tries to keep the player at the horizontal mid-point of the
    // screen. It is clamped so it never shows area outside the battlefield:
    //   Left clamp  (_cameraX >= 0):              don't reveal left of arena
    //   Right clamp (_cameraX <= BATTLEFIELD_W−W): don't reveal right of arena
    this._cameraX = Math.max(
      0,
      Math.min(this._BATTLEFIELD_W - this._W, this._worldX - this._W / 2)
    );

    // Derive the player's SCREEN X from world position and camera offset.
    // In the middle of the battlefield this equals W/2 (480px) — centred.
    // Near a battlefield edge the camera clamps and the player drifts
    // toward the screen edge, making the wall feel solid.
    this._player.x = this._worldX - this._cameraX;

    // ---- Aim ----
    if (this._input.rightStick.active) {
      const rx = this._input.rightStick.x;
      const ry = this._input.rightStick.y;
      if (Math.hypot(rx, ry) > 0.1) {
        this._aimAngle = Math.atan2(ry, rx);
      }
    }

    // ---- PX-9 Rapid Plasma Array: firing ----
    // Advance both the fire-rate cooldown and the muzzle-flash timer each frame.
    this._fireCooldown     = Math.max(0, this._fireCooldown     - dt);
    this._muzzleFlashTimer = Math.max(0, this._muzzleFlashTimer - dt);

    // Fire automatically while the right stick is pushed past the aim deadzone
    // and the cooldown has elapsed — produces ~8 shots per second.
    if (this._input.rightStick.active) {
      const rx = this._input.rightStick.x;
      const ry = this._input.rightStick.y;
      if (Math.hypot(rx, ry) > 0.1 && this._fireCooldown <= 0) {
        this._fireProjectile();
        this._fireCooldown = this._FIRE_INTERVAL;
      }
    }

    // ---- Update projectile pool ----
    // Move each active projectile forward and recycle any that have left
    // the visible area. Bounds: off-screen horizontally (with 60px margin),
    // or more than one full screen height above or below the ship.
    this._projectilePool.forEach(p => {
      if (!p.active) return;
      p.update(dt);
      const screenX  = p.worldX - this._cameraX;
      const offSideX = screenX < -60 || screenX > this._W + 60;
      const offSideY = Math.abs(p.y - this._player.y) > this._H;
      if (offSideX || offSideY) p.deactivate();
    });

    // ================================================================
    // GROUND ENEMIES — UPDATE & COLLISION DETECTION
    // ================================================================
    // Single loop over this._enemies covers all ground entity types.
    // Future enemy types just get pushed into this._enemies — nothing
    // else needs to change.

    // Player hitbox: intentionally ~80% of the visual ship size (64×28 px)
    // so that near-misses feel fair — a bolt clipping the wing tip does not
    // register as a hit. The rectangle is centred on (this._worldX, player.y).
    //   Left edge  = this._worldX - PLAYER_HIT_W / 2
    //   Right edge = this._worldX + PLAYER_HIT_W / 2
    //   Top edge   = this._player.y - PLAYER_HIT_H / 2
    //   Bottom edge= this._player.y + PLAYER_HIT_H / 2
    const PLAYER_HIT_W = 50; // ≈ 78% of visual width  (64 px)
    const PLAYER_HIT_H = 22; // ≈ 79% of visual height (28 px)

    this._enemies.forEach(enemy => {
      if (!enemy.isAlive()) return;

      // All enemy types receive the same four arguments; OrcCannon ignores
      // the fourth (cameraX) — extra args are silently dropped by JS.
      enemy.update(dt, this._worldX, this._player.y, this._cameraX);

      // Spawn invincibility blocks all incoming damage for the first 2 seconds.
      if (this._player.isAlive() && !this._spawnInvincible) {
        // ---- OrcCannon: plasma bolt → player ----
        // 10 damage per bolt. Scout (38 HP) down in 4 hits; Bomber (95 HP) in 10.
        if (typeof enemy.checkBoltsHitPlayer === 'function') {
          if (enemy.checkBoltsHitPlayer(this._worldX, this._player.y, PLAYER_HIT_W, PLAYER_HIT_H)) {
            this._player.health.takeDamage(10);
          }
        }

        // ---- OrcSilo: homing missile → player ----
        // 25 damage per missile — heavier warhead than a plasma bolt.
        if (typeof enemy.checkMissilesHitPlayer === 'function') {
          if (enemy.checkMissilesHitPlayer(this._worldX, this._player.y, PLAYER_HIT_W, PLAYER_HIT_H)) {
            this._player.health.takeDamage(25);
          }
        }
      }
    });

    // ---- Player bolt → any ground enemy structure (AABB, unified) ----
    // getStructureHitbox() is defined on all ground entity types.
    // Coordinate spaces: hb.x/w → world-space; hb.y/h → screen-space.
    // 1 damage per bolt; bolt consumed on contact.
    this._projectilePool.forEach(p => {
      if (!p.active) return;
      this._enemies.forEach(enemy => {
        if (!enemy.isAlive()) return;
        const hb = enemy.getStructureHitbox();
        if (p.worldX > hb.x && p.worldX < hb.x + hb.w &&
            p.y      > hb.y && p.y      < hb.y + hb.h) {
          enemy.health.takeDamage(1);
          p.deactivate();
        }
      });
    });

    // ---- Player bolt → active OrcSilo missile (shootdown) ----
    // Missile hitbox: 10×21 px centred on missile world position.
    // 6 hits destroy the missile mid-air (triggers a small explosion).
    // Each hit triggers a 2-frame white flash on the missile sprite.
    // The check is delegated to OrcSilo so it can manage missile health
    // and spawn the mid-air explosion without exposing internal state.
    this._enemies.forEach(enemy => {
      if (!enemy.isAlive()) return;
      if (typeof enemy.checkProjectilesHitMissiles === 'function') {
        enemy.checkProjectilesHitMissiles(this._projectilePool);
      }
    });

    // ---- Button placeholders ----
    if (this._input.wasTappedInRegion(820, 460, 130, 58)) {
      console.log('[Input] Weapon Select tapped — implement weapon cycling here');
    }
    if (this._input.wasTappedInRegion(680, 460, 130, 58)) {
      console.log('[Input] Evade tapped — implement defensive maneuver here');
    }

    // Win condition will be added later — triggered when all objectives are destroyed

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render(ctx) {
    ctx.imageSmoothingEnabled = false; // pixel-art style — no interpolation (Visual Style Guide rule 2)
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // Draw back-to-front so later layers paint over earlier ones
    this._drawSky(ctx, W, H);
    this._drawGround(ctx, W, H);

    // Subtle darkening at the screen edge when the player is near a
    // battlefield boundary — signals the hard wall before they hit it
    this._drawBoundaryIndicator(ctx, W, H);

    // All ground enemies — drawn after the ground and before the player ship
    // so the plane flies visually in front of all structures.
    // Each entity handles its own screen-cull and render.
    this._enemies.forEach(enemy => enemy.render(ctx, this._cameraX));

    // Aim indicator line from the plane nose (right-stick active only)
    if (this._input.rightStick.active) {
      ctx.save();
      ctx.translate(this._player.x, this._player.y);
      ctx.rotate(this._aimAngle);
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.55)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(this._player.width / 2, 0);
      ctx.lineTo(this._player.width / 2 + 180, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    this._player.render(ctx);
    if (this._spawnInvincible) this._renderShieldShimmer(ctx); // 2-second grace shimmer
    this._renderProjectiles(ctx);    // plasma bolts drawn in front of the ship
    this._renderMuzzleFlash(ctx);    // brief firing flash on top of world-space objects
    this._renderTargetArrow(ctx);    // directional arrow when no threats lie ahead
    this._renderHUD(ctx);
    this._input.renderSticks(ctx);

    _drawHUDButton(ctx, 820, 460, 130, 58, 'WEAPON\nSELECT', '#1a2a3a', '#4488aa');
    _drawHUDButton(ctx, 680, 460, 130, 58, 'EVADE',           '#2a1a3a', '#aa44aa');
  }

  // ==========================================================
  // BOUNDARY INDICATOR
  // ==========================================================

  // Draws a dark vignette strip at the left or right screen edge when the
  // player approaches a battlefield boundary. The overlay fades in over the
  // last FADE_DIST world-pixels before the wall, reaching max alpha (0.5)
  // exactly at the hard boundary clamp.
  _drawBoundaryIndicator(ctx, W, H) {
    const FADE_DIST  = 300; // world-px from boundary where fade begins
    const VIGNETTE_W = 120; // screen-px width of the darkened edge strip

    // How far the player's hull edge is from each battlefield boundary
    const distLeft  = this._worldX - (this._player.width / 2);
    const distRight = (this._BATTLEFIELD_W - this._player.width / 2) - this._worldX;

    if (distLeft < FADE_DIST) {
      const alpha = (1 - distLeft / FADE_DIST) * 0.5;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, VIGNETTE_W, H);
    }

    if (distRight < FADE_DIST) {
      const alpha = (1 - distRight / FADE_DIST) * 0.5;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
      ctx.fillRect(W - VIGNETTE_W, 0, VIGNETTE_W, H);
    }
  }

  // ==========================================================
  // BACKGROUND: SKY (static)
  // ==========================================================

  // The sky is a fixed set of flat colour bands — it never scrolls.
  // Hard-edged horizontal strips step from deep navy at the top down to
  // a hazy blue near the horizon. No gradients (Visual Style Guide rule 1).
  _drawSky(ctx, W, H) {
    const horizonY = Math.floor(H * 0.72);

    // Flat banded sky — four distinct colour strips
    ctx.fillStyle = '#07101f';                                               // Deep navy (zenith)
    ctx.fillRect(0, 0, W, Math.floor(horizonY * 0.35));

    ctx.fillStyle = '#0d1e38';                                               // Dark blue (upper-mid)
    ctx.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));

    ctx.fillStyle = '#122848';                                               // Steel blue (lower-mid)
    ctx.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));

    ctx.fillStyle = '#1e3a52';                                               // Hazy blue (near horizon)
    ctx.fillRect(0, Math.floor(horizonY * 0.85), W, horizonY - Math.floor(horizonY * 0.85));

    // Warm amber strip at the horizon — distant fires, flat solid colour
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(0, horizonY - 8, W, 8);

    // Stars as 2×2 pixel squares — no arc(), no anti-aliasing (Visual Style Guide rule 4)
    ctx.fillStyle = '#c8d8e8';
    [
      [44, 12], [148, 28], [268, 10], [400, 22],
      [520, 8 ], [640, 32], [760, 18], [880, 8 ],
      [100, 52], [340, 44], [590, 48], [820, 38],
    ].forEach(([sx, sy]) => {
      ctx.fillRect(sx, sy, 2, 2);
    });
  }

  // ==========================================================
  // BACKGROUND: GROUND (camera-driven scrolling)
  // ==========================================================

  // The ground tiles scroll in response to _cameraX — the world-space X
  // of the screen's left edge. This means the ground holds perfectly still
  // when the player holds still, and moves at exactly the player's speed
  // when flying left or right.
  //
  // HOW CAMERA-DRIVEN TILING WORKS:
  //   _cameraX represents how many world-pixels we've scrolled from the
  //   left edge of the battlefield. We take shift = _cameraX % TILE_W
  //   (always 0–959) and draw tiles starting at x = -shift:
  //     tile at x = -shift          (left tile, partially off-screen left)
  //     tile at x = -shift + 960    (right tile, fills the remainder)
  //   Together they cover the full 960px canvas every frame.
  //   As _cameraX grows (moving right) shift grows, tiles march leftward.
  //   When _cameraX stops changing the tiles lock in place.
  _drawGround(ctx, W, H) {
    const horizonY = Math.floor(H * 0.72);
    const groundH  = H - horizonY;
    const STEP     = 4; // screen-pixel column width for terrain profile rendering

    // Sky extension: fills the 16 px buffer below the sky baseline.
    // Terrain can dip up to 14 px below horizonY; without this fill a gap
    // would appear between the flat sky bands and a dipped terrain surface.
    ctx.fillStyle = '#1e3a52'; // horizon sky colour — matches _drawSky bottom band
    ctx.fillRect(0, horizonY, W, 16);

    // Precompute the two upper band heights (proportions match the original flat layout)
    const bandA = Math.floor(groundH * 0.30); // sandy top   (30 %)
    const bandB = Math.floor(groundH * 0.40); // mid earth   (40 %)
    // Dark base occupies the remaining 30 % — drawn per column to canvas bottom

    // Render the ground column by column following the seeded terrain height profile.
    // _getTerrainHeightAt() linearly interpolates between 32 px samples so there
    // is no visible stepping even at 4 px column width.
    for (let sx = 0; sx < W; sx += STEP) {
      const worldX   = sx + this._cameraX;
      const height   = this._getTerrainHeightAt(worldX);
      const surfaceY = Math.round(horizonY - height);

      // Sandy top band
      ctx.fillStyle = '#4a3820';
      ctx.fillRect(sx, surfaceY, STEP, bandA);

      // Mid earth band
      ctx.fillStyle = '#3c2e16';
      ctx.fillRect(sx, surfaceY + bandA, STEP, bandB);

      // Dark base — extends flush to the canvas bottom regardless of terrain height
      ctx.fillStyle = '#2a2010';
      ctx.fillRect(sx, surfaceY + bandA + bandB, STEP, H - (surfaceY + bandA + bandB));

      // Exposed rock face: where adjacent 32 px terrain samples differ by more
      // than 6 px the slope is steep enough to reveal exposed rock — draw a
      // 4 px darker band just below the surface edge line.
      const si = Math.floor(worldX / 32);
      if (si > 0 && si < this._terrainHeights.length) {
        const hDiff = Math.abs(
          this._terrainHeights[si] - this._terrainHeights[Math.max(0, si - 1)]
        );
        if (hDiff > 6) {
          ctx.fillStyle = '#1a0e06'; // exposed rock — darker than sandy surface
          ctx.fillRect(sx, surfaceY + 2, STEP, 4);
        }
      }

      // Terrain surface edge — 2 px bright seam at the ground top
      ctx.fillStyle = '#5e4a28';
      ctx.fillRect(sx, surfaceY, STEP, 2);
    }

    // Ground detail features — tile-based, camera-driven (same tiling as before).
    // _drawGroundTile now adjusts each feature's Y to the local terrain surface.
    const shift = this._cameraX % this._TILE_W;
    for (let tileX = -shift; tileX < W; tileX += this._TILE_W) {
      this._drawGroundTile(ctx, tileX, horizonY, groundH);
    }
  }

  // Draws one full tile of ground detail at the given x position.
  // Called once or twice per frame (for the two side-by-side tiles).
  //
  // Each feature's Y is now computed from the terrain surface at its world X
  // so features sit naturally on hills and in valleys rather than at a fixed
  // horizon baseline. World X = tileX + f.x + _cameraX.
  _drawGroundTile(ctx, tileX, horizonY, groundH) {
    this._groundFeatures.forEach(f => {
      // Resolve the feature's world-space X for this tile copy and look up
      // the interpolated terrain height at that position.
      const worldX   = tileX + f.x + this._cameraX;
      const tHeight  = this._getTerrainHeightAt(worldX);
      const surfaceY = horizonY - tHeight;
      // f.y = 0 → right at terrain surface; f.y = 1 → bottom of ground area
      f.draw(ctx, tileX + f.x, surfaceY + f.y * groundH, f);
    });
  }

  // ==========================================================
  // HUD
  // ==========================================================

  _renderHUD(ctx) {
    const W = ctx.canvas.width;

    ctx.fillStyle = '#aaccdd';
    ctx.font      = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('HULL', 12, 24);
    this._player.health.renderBar(ctx, 55, 10, 180, 18);

    ctx.fillStyle = '#5bc8f5';
    ctx.font      = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('✈  PILOT MODE', W / 2, 24);

    ctx.fillStyle = '#aaaaaa';
    ctx.font      = '14px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('T+' + Math.floor(this._elapsedTime) + 's', W - 12, 24);
  }

  // ================================================================
  // PX-9 RAPID PLASMA ARRAY — FIRING
  // ================================================================

  // Acquire the first inactive slot from the pool, configure it, and
  // mark it active. If all 30 slots are in flight the shot is dropped
  // silently — frame rate stays smooth and no new objects are allocated.
  _fireProjectile() {
    // Linear scan is negligible overhead at a pool size of 30
    let proj = null;
    for (let i = 0; i < this._projectilePool.length; i++) {
      if (!this._projectilePool[i].active) {
        proj = this._projectilePool[i];
        break;
      }
    }
    if (!proj) return; // pool exhausted — shot dropped this frame

    const SPEED  = 600; // px/s in the aim direction

    // Damage scales lightly with the plane's weaponSize stat (range 10–20)
    const DAMAGE = 10 + Math.round(this._player.weaponSize / 10);

    // Nose position in world/screen space.
    // The bolt spawns at the tip of the ship along the aim direction —
    // offset is half the plane's width from the plane's centre point.
    const noseOffsetX = Math.cos(this._aimAngle) * (this._player.width  / 2);
    const noseOffsetY = Math.sin(this._aimAngle) * (this._player.width  / 2);

    proj.fire(
      this._worldX   + noseOffsetX,         // world-space X origin
      this._player.y + noseOffsetY,         // screen-space Y origin
      Math.cos(this._aimAngle) * SPEED,     // world-space X velocity
      Math.sin(this._aimAngle) * SPEED,     // screen-space Y velocity
      DAMAGE,
      this._player.color,
      this._aimAngle
    );

    // Kick off the 2-frame muzzle flash
    this._muzzleFlashTimer = this._MUZZLE_FLASH_DURATION;
  }

  // ================================================================
  // PX-9 RAPID PLASMA ARRAY — RENDERING
  // ================================================================

  // Render all active projectiles by converting each bolt's worldX to
  // screen space via the current camera offset. Inactive slots are
  // skipped inside Projectile.render() — no filtering needed here.
  _renderProjectiles(ctx) {
    this._projectilePool.forEach(p => p.render(ctx, this._cameraX));
  }

  // Draw a brief pixel-art muzzle flash at the plane's nose each time
  // a shot is fired. Two visual layers — an outer colour burst and a
  // white core — simulate a plasma discharge without blur or gradients
  // (Visual Style Guide rule 1: no smooth effects on solid objects).
  //
  // The flash lasts _MUZZLE_FLASH_DURATION seconds. t = 1→0 as it fades:
  //   t = 1 (first frame):  large bright burst, full alpha
  //   t → 0 (second frame): smaller, fades out
  _renderMuzzleFlash(ctx) {
    if (this._muzzleFlashTimer <= 0) return;

    const t     = this._muzzleFlashTimer / this._MUZZLE_FLASH_DURATION; // 1 → 0
    const noseX = Math.round(this._player.x + Math.cos(this._aimAngle) * (this._player.width  / 2));
    const noseY = Math.round(this._player.y + Math.sin(this._aimAngle) * (this._player.width  / 2));

    ctx.save();
    ctx.globalAlpha = t;

    // Outer burst square — ship color, size steps from 12×12 down to 6×6
    const sz = Math.round(6 + t * 6);
    ctx.fillStyle = this._player.color;
    ctx.fillRect(noseX - sz, noseY - sz, sz * 2, sz * 2);

    // Bright white core — fixed 4×4 pixels at the flash centre
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(noseX - 2, noseY - 2, 4, 4);

    ctx.restore();
  }

  // ================================================================
  // SPAWN SHIELD SHIMMER
  // ================================================================

  // Draws a 1 px bright-cyan outline around the player ship while spawn
  // invincibility is active. Pulses at 2 Hz (twice per second) by
  // oscillating globalAlpha between 0.5 and 1.0 using a sine wave.
  // Matches the ship's rotation so it always hugs the hull outline.
  _renderShieldShimmer(ctx) {
    const alpha = 0.75 + 0.25 * Math.sin(this._invinciblePulse * Math.PI * 4); // 2 Hz
    const pw    = this._player.width  + 4; // 4 px wider than the visual hull
    const ph    = this._player.height + 4;

    ctx.save();
    ctx.translate(this._player.x, this._player.y);
    ctx.rotate(this._player.angle || 0);
    ctx.globalAlpha  = alpha;
    ctx.strokeStyle  = '#80ffff'; // bright cyan — unmistakable shield tint
    ctx.lineWidth    = 1;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    ctx.restore();
  }

  // ================================================================
  // TARGET DIRECTION ARROW
  // ================================================================

  // Shows a pulsing red arrow on the screen edge when the player is
  // moving away from all remaining alive enemies. The arrow points back
  // toward the threat cluster so the player knows where to turn.
  //
  // Trigger condition:
  //   • Player is moving right (velocityX > 5): all alive enemies have
  //     worldX < player worldX → show left-pointing arrow on left edge.
  //   • Player is moving left  (velocityX < −5): all alive enemies have
  //     worldX > player worldX → show right-pointing arrow on right edge.
  //
  // Size pulses 100 %→120 % on a 0.6-second cycle to draw the eye.
  _renderTargetArrow(ctx) {
    const aliveEnemies = this._enemies.filter(e => e.isAlive());
    if (aliveEnemies.length === 0) return; // all dead — mission clear, no arrow

    const vx          = this._player.velocityX;
    const facingRight = vx > 5;
    const facingLeft  = vx < -5;
    if (!facingRight && !facingLeft) return; // hovering — no movement direction

    // Determine arrow direction (toward remaining enemies)
    let arrowDir = null;
    if (facingRight) {
      const hasEnemyAhead = aliveEnemies.some(e => e.worldX > this._worldX);
      if (!hasEnemyAhead) arrowDir = 'left'; // all enemies behind — point left
    } else {
      const hasEnemyAhead = aliveEnemies.some(e => e.worldX < this._worldX);
      if (!hasEnemyAhead) arrowDir = 'right'; // all enemies behind — point right
    }
    if (!arrowDir) return; // threats are still ahead — arrow not needed

    // Size pulse: 1.0 → 1.2 on a 0.6-second sine cycle
    const scale = 1.0 + 0.1 * (1.0 + Math.sin(this._arrowPulseT * (Math.PI * 2 / 0.6)));
    const aw    = Math.round(24 * scale); // arrow bounding-box width
    const ah    = Math.round(32 * scale); // arrow bounding-box height
    const halfH = Math.floor(ah / 2);
    const midY  = Math.round(this._H / 2);
    const PAD   = 8; // px from screen edge to near side of arrow

    ctx.save();

    if (arrowDir === 'left') {
      // Left-pointing triangle: tip at left, flat base at right.
      // bx = world x of the arrow's left (tip) edge.
      const bx = PAD;

      // Dark red 1 px outline — draw rows slightly outside the fill shape
      ctx.fillStyle = '#8b0000';
      for (let row = -1; row <= ah; row++) {
        const dist = Math.abs(row - halfH + 0.5) / (halfH + 0.5);
        const w    = Math.max(2, Math.round((aw + 2) * (1.0 - Math.min(1, dist))));
        ctx.fillRect(bx + aw + 1 - w, midY - halfH - 1 + row, w, 1);
      }

      // Bright red fill — right-aligned rows taper to a point at the left
      ctx.fillStyle = '#ff2020';
      for (let row = 0; row < ah; row++) {
        const dist = Math.abs(row - halfH + 0.5) / halfH;
        const w    = Math.max(1, Math.round(aw * (1.0 - Math.min(1, dist))));
        ctx.fillRect(bx + aw - w, midY - halfH + row, w, 1);
      }

      // Pixel-art "TARGETS" label centred above the arrow
      _drawPixelText(ctx, bx + aw / 2, midY - halfH - 16, 'TARGETS', '#ff2020');

    } else {
      // Right-pointing triangle: flat base at left, tip at right.
      // bx = world x of the arrow's left (base) edge.
      const bx = this._W - PAD - aw;

      // Dark red 1 px outline
      ctx.fillStyle = '#8b0000';
      for (let row = -1; row <= ah; row++) {
        const dist = Math.abs(row - halfH + 0.5) / (halfH + 0.5);
        const w    = Math.max(2, Math.round((aw + 2) * (1.0 - Math.min(1, dist))));
        ctx.fillRect(bx - 1, midY - halfH - 1 + row, w, 1);
      }

      // Bright red fill — left-aligned rows taper to a point at the right
      ctx.fillStyle = '#ff2020';
      for (let row = 0; row < ah; row++) {
        const dist = Math.abs(row - halfH + 0.5) / halfH;
        const w    = Math.max(1, Math.round(aw * (1.0 - Math.min(1, dist))));
        ctx.fillRect(bx, midY - halfH + row, w, 1);
      }

      // Pixel-art "TARGETS" label centred above the arrow
      _drawPixelText(ctx, bx + aw / 2, midY - halfH - 16, 'TARGETS', '#ff2020');
    }

    ctx.restore();
  }
}

/* ============================================================
   GROUND FEATURE BUILDER
   ============================================================
   Returns an array of feature objects. Each object stores:
     x     — pixel position within the 960px tile (0–960)
     y     — fractional depth in the ground area (0 = horizon, 1 = bottom)
     draw  — function(ctx, px, py, self) that renders the feature

   Built once in the constructor and reused every frame.
   The draw functions use only ctx primitives — no images needed.
   ============================================================ */

function _buildGroundFeatures(seed = 0) {
  const features = [];

  // ---- Deterministic seeded random ----
  // Formula from spec: returns a float in approx [0.1715, 0.2512].
  // srf() normalises that to [0, 1] so it can drive position offsets.
  // Each call increments the internal counter so every feature gets a
  // unique value — same seed always produces the same tile layout.
  let _n = 0;
  const seededRand = (n) => ((Math.sin(seed + n) * 9301 + 49297) % 233280) / 233280;
  const sr  = () => seededRand(_n++);
  // Theoretical output range: min = 39996/233280 ≈ 0.1715, max = 58598/233280 ≈ 0.2512
  const srf = () => Math.max(0, Math.min(1, (sr() - 0.1715) / (0.2512 - 0.1715)));

  // ---- Roads ----
  // Each road spans the full 960px tile width — they appear as continuous
  // horizontal bands across the scrolling ground. Roads are fixed (no seed
  // variation) because they need to line up at tile seams.
  [[0.13], [0.52]].forEach(([yFrac]) => {
    features.push({
      x: 0, y: yFrac,
      draw(ctx, px, py) {
        // Dark asphalt strip
        ctx.fillStyle = 'rgba(30, 22, 14, 0.78)';
        ctx.fillRect(px, py - 5, 960, 10);
        // Faded centre-line dashes
        ctx.fillStyle = 'rgba(58, 48, 32, 0.55)';
        for (let mx = 0; mx < 960; mx += 60) {
          ctx.fillRect(px + mx, py - 1, 28, 2);
        }
      },
    });
  });

  // ---- Bomb craters ----
  // 8 craters spread across the tile. Base positions are evenly distributed;
  // seed varies each crater's exact x (±60 px), y (±0.10), and radius (±4).
  // Pixel-art style: flat ejecta ring + dark pit, no ellipses (Style Guide rule 4).
  [
    [75,  0.28, 14], [195, 0.65, 17], [330, 0.38, 11],
    [460, 0.72, 19], [560, 0.22, 13], [680, 0.58, 15],
    [790, 0.42, 12], [900, 0.75, 18],
  ].forEach(([bx, by, br]) => {
    const fx = Math.max(10,   Math.min(950,  Math.round(bx + srf() * 120 - 60)));
    const fy = Math.max(0.15, Math.min(0.85, by + srf() * 0.20 - 0.10));
    const r  = Math.max(9,    Math.min(22,   Math.round(br + srf() * 8   - 4)));
    features.push({
      x: fx, y: fy, r,
      draw(ctx, px, py, f) {
        // Sandy blast ring — flat rectangle (Visual Style Guide rule 4)
        const rw = Math.floor(f.r * 3.5);
        const rh = Math.floor(f.r * 0.88);
        ctx.fillStyle = '#644e26';
        ctx.fillRect(Math.floor(px - rw / 2), Math.floor(py - rh / 2), rw, rh);
        // Dark crater pit — smaller inner rectangle
        const pw = Math.floor(f.r * 2);
        const ph = Math.max(4, Math.floor(f.r * 0.5));
        ctx.fillStyle = '#100a04';
        ctx.fillRect(Math.floor(px - pw / 2), Math.floor(py - ph / 2), pw, ph);
      },
    });
  });

  // ---- Scorched / burned patches ----
  // Dark solid rectangles — napalm strikes, oil fires, vehicle burn-outs.
  // Seed varies position (±40 px, ±0.08) and size (±10 w, ±6 h).
  [
    [145, 0.44, 54, 24], [310, 0.78, 62, 28], [500, 0.30, 46, 20],
    [720, 0.62, 52, 24], [870, 0.48, 40, 18],
  ].forEach(([bx, by, bw, bh]) => {
    const fx = Math.max(40,   Math.min(920,  Math.round(bx + srf() * 80  - 40)));
    const fy = Math.max(0.20, Math.min(0.80, by + srf() * 0.16 - 0.08));
    const fw = Math.max(36,   Math.min(72,   Math.round(bw + srf() * 20  - 10)));
    const fh = Math.max(15,   Math.min(33,   Math.round(bh + srf() * 12  - 6)));
    features.push({
      x: fx, y: fy, w: fw, h: fh,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#0e0903';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ---- Sandy lighter patches ----
  // Flat tan rectangles to break up the uniform ground colour.
  // Seed varies position (±40 px, ±0.08) and size (±10 w, ±5 h).
  [
    [220, 0.55, 52, 22], [490, 0.20, 44, 18], [740, 0.80, 58, 26],
  ].forEach(([bx, by, bw, bh]) => {
    const fx = Math.max(40,   Math.min(920,  Math.round(bx + srf() * 80  - 40)));
    const fy = Math.max(0.15, Math.min(0.85, by + srf() * 0.16 - 0.08));
    const fw = Math.max(34,   Math.min(62,   Math.round(bw + srf() * 20  - 10)));
    const fh = Math.max(14,   Math.min(26,   Math.round(bh + srf() * 10  - 5)));
    features.push({
      x: fx, y: fy, w: fw, h: fh,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#695830';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ---- Rubble piles ----
  // Clusters of small rectangles simulating broken concrete and debris.
  // Seed varies position (±50 px, ±0.07).
  [
    [380, 0.48], [610, 0.33], [820, 0.68], [130, 0.82],
  ].forEach(([bx, by]) => {
    const fx = Math.max(30,   Math.min(930,  Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.25, Math.min(0.85, by + srf() * 0.14 - 0.07));
    features.push({
      x: fx, y: fy,
      draw(ctx, px, py) {
        ctx.fillStyle = '#38281a';
        ctx.fillRect(px - 9, py - 4, 7, 5);
        ctx.fillRect(px + 0, py - 6, 5, 5);
        ctx.fillRect(px + 6, py - 3, 8, 5);
        ctx.fillRect(px - 4, py + 1, 6, 3);
        ctx.fillRect(px + 10, py,    4, 6);
      },
    });
  });

  return features;
}

/* ============================================================
   LOCAL HELPERS
   ============================================================ */

function _drawPlaceholderEnemy(ctx, x, y, label) {
  ctx.fillStyle   = 'rgba(180, 40, 40, 0.55)';
  ctx.fillRect(x - 20, y, 40, 18);
  ctx.strokeStyle = '#ff5555';
  ctx.lineWidth   = 1;
  ctx.strokeRect(x - 20, y, 40, 18);
  ctx.fillStyle   = '#ffaaaa';
  ctx.font        = '11px Arial';
  ctx.textAlign   = 'center';
  ctx.fillText(label, x, y - 4);
}

/* ============================================================
   PIXEL FONT — fillRect lettering for in-world HUD labels
   ============================================================
   3×5 bitmap glyphs, scaled to 2×2 screen-px per dot.
   Each row is a 3-bit mask: bit 2 = left column, bit 0 = right column.
   Only characters used in this file are defined; extend as needed.
   ============================================================ */

function _drawPixelText(ctx, cx, cy, text, color) {
  const GLYPHS = {
    'T': [0b111, 0b010, 0b010, 0b010, 0b010],
    'A': [0b010, 0b101, 0b111, 0b101, 0b101],
    'R': [0b110, 0b101, 0b110, 0b110, 0b101],
    'G': [0b011, 0b100, 0b111, 0b101, 0b011],
    'E': [0b111, 0b100, 0b110, 0b100, 0b111],
    'S': [0b011, 0b100, 0b010, 0b001, 0b110],
  };

  const PX     = 2;                            // screen-px per font dot
  const GAP    = 1;                            // 1-px gap between characters
  const CHAR_W = 3 * PX + GAP;                // 7 px per glyph (incl. gap)
  const totalW = text.length * CHAR_W - GAP;  // gap not appended to last char

  let x = Math.round(cx - totalW / 2);
  ctx.fillStyle = color;

  for (const ch of text) {
    const rows = GLYPHS[ch];
    if (!rows) { x += CHAR_W; continue; }
    for (let row = 0; row < rows.length; row++) {
      const bits = rows[row];
      for (let col = 0; col < 3; col++) {
        if (bits & (1 << (2 - col))) {      // bit 2 = leftmost column
          ctx.fillRect(x + col * PX, cy + row * PX, PX, PX);
        }
      }
    }
    x += CHAR_W;
  }
}

function _drawHUDButton(ctx, x, y, w, h, label, bgColor, borderColor) {
  ctx.globalAlpha = 0.82;
  ctx.fillStyle   = bgColor;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 14px Arial';
  ctx.textAlign = 'center';

  const lines  = label.split('\n');
  const lineH  = 17;
  const startY = y + h / 2 - (lines.length - 1) * lineH / 2 + 5;
  lines.forEach((line, i) => ctx.fillText(line, x + w / 2, startY + i * lineH));
}
