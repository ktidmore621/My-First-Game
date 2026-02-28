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
    // The height getter lets features nudge toward terrain peaks/valleys.
    this._groundFeatures = _buildGroundFeatures(this._terrainSeed, x => this._getTerrainHeightAt(x));

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

    // ================================================================
    // PHASE 1 — Compute enemy X positions WITHOUT instantiating objects
    // ================================================================
    // Collect world-space geometry only. No OrcCannon or OrcSilo objects
    // are created yet — they need a ground-anchor Y that doesn't exist
    // until the terrain has been generated AND flattened.
    const CANNON_FOOTPRINT = 80;   // world-px width of one OrcCannon structure
    const SILO_FOOTPRINT   = 280;  // world-px width of one OrcSilo including perimeter
    const rightBound       = config.battlefieldWidth - config.safeZoneEnd;

    let cursor = config.safeZoneStart;
    const plans = []; // { type, position, footprint, midX }

    for (const type of types) {
      const footprint = type === 'cannon' ? CANNON_FOOTPRINT : SILO_FOOTPRINT;
      // Random gap before this enemy: [minSpacing, minSpacing × 2.2]
      const jitter   = config.minSpacing +
        Math.random() * (config.minSpacing * 2.2 - config.minSpacing);
      const position = cursor + jitter;

      // Honour right-edge safe zone — stop early if needed
      if (position + footprint > rightBound) break;

      const midX = position + footprint / 2;
      plans.push({ type, position, footprint, midX });
      cursor = position + footprint; // advance past this structure
    }

    // ================================================================
    // PHASE 2 — Generate terrain height map
    // ================================================================
    this._terrainSeed    = Math.random() * 1000;
    this._terrainHeights = this._buildTerrainHeights();

    // ================================================================
    // PHASE 3 — Flatten terrain under every planned structure
    // ================================================================
    // Flat zone widths (centred on midX of each structure):
    //   OrcCannon: 80 px footprint + 20 px margin each side = 120 px total (±60 px)
    //   OrcSilo  : 280 px perimeter + 30 px margin each side = 340 px total (±170 px)
    // A 20 px linear blend zone on each edge prevents a sharp cliff where
    // the flattened pad meets the surrounding natural terrain.
    //
    // Future ground features (add _flattenTerrainZone calls here when implemented):
    //   Excavation pit → halfFlat = 30 (60 px total), BLEND_W = 20
    //   Mining rig     → halfFlat = 25 (50 px total), BLEND_W = 20
    const CANNON_FLAT_HALF = 60;  // half of 120 px flat zone
    const SILO_FLAT_HALF   = 170; // half of 340 px flat zone
    const BLEND_W          = 20;  // blend fringe width on each edge (px)

    for (const plan of plans) {
      const halfFlat = plan.type === 'cannon' ? CANNON_FLAT_HALF : SILO_FLAT_HALF;
      this._flattenTerrainZone(plan.midX, halfFlat, BLEND_W);
    }

    // ================================================================
    // PHASE 4 — Instantiate enemy objects on the now-flattened terrain
    // ================================================================
    // The terrain under each structure is now guaranteed flat, so
    // _getTerrainHeightAt returns the same value across the full footprint.
    const baseGroundY = Math.round(this._H * 0.72);
    this._enemies = [];

    for (const plan of plans) {
      const enemyGY = Math.round(baseGroundY - this._getTerrainHeightAt(plan.midX));
      this._enemies.push(
        plan.type === 'cannon'
          ? new OrcCannon(plan.position, enemyGY)
          : new OrcSilo(plan.position, enemyGY)
      );
    }

    // Step 5 — Console report for verification
    const typeList = this._enemies.map(e => e.constructor.name).join(', ');
    console.log(
      `[Battlefield] Generated ${this._enemies.length} enemies across ${this._BATTLEFIELD_W}px battlefield`
    );
    console.log(`[Battlefield] Terrain seed: ${this._terrainSeed.toFixed(1)} | Placement: ${typeList}`);
    console.log(`[Battlefield] Terrain heights: ${this._terrainHeights.length} samples every 32 px | range −22…+16 px`);
    console.log(`[Battlefield] Flat zones: cannon ±${CANNON_FLAT_HALF} px, silo ±${SILO_FLAT_HALF} px, blend ${BLEND_W} px each edge`);
  }

  // ================================================================
  // TERRAIN HEIGHT MAP
  // ================================================================

  // Builds the terrain height array — one sample every 32 world-px across
  // the full battlefield. For a 5000 px arena that is 157 samples
  // (positions 0, 32, 64 … 4992). Heights are clamped to −22…+16 px
  // relative to the baseline horizonY (positive = raised, negative = dipped).
  //
  // Four sine-wave octaves are summed, each with a unique random phase offset
  // so no two runs ever produce the same landscape shape. One smoothing pass
  // removes sharp micro-transitions. Flat zones are injected afterward to
  // create natural plateaus and plains so the terrain doesn't undulate
  // constantly from one end of the battlefield to the other.
  _buildTerrainHeights() {
    const STEP  = 32;
    const count = Math.floor(this._BATTLEFIELD_W / STEP) + 1; // 157 for 5000 px
    const seed  = this._terrainSeed;

    // Seeded random — identical formula to _buildGroundFeatures for consistency
    let _n = 0;
    const sr  = () => ((Math.sin(seed + _n++) * 9301 + 49297) % 233280) / 233280;
    // Normalise the [~0.1715, ~0.2512] output range to [0, 1]
    const srf = () => Math.max(0, Math.min(1, (sr() - 0.1715) / (0.2512 - 0.1715)));

    // ---- Four unique phase offsets [0, 2π] ----
    // These are the key that breaks any regularity between octaves and between
    // runs. Same seed → same offsets → same landscape; different seed → new world.
    const TWO_PI = Math.PI * 2;
    const phase1 = srf() * TWO_PI; // octave 1 — broad landscape shapes
    const phase2 = srf() * TWO_PI; // octave 2 — rolling hills
    const phase3 = srf() * TWO_PI; // octave 3 — surface bumps
    const phase4 = srf() * TWO_PI; // octave 4 — micro texture

    // ---- Multi-octave noise ----
    //   Oct 1: 800 px cycle, 10 px amplitude → broad sweeping rises and valleys
    //   Oct 2: 300 px cycle,  5 px amplitude → rolling hills and plateaus
    //   Oct 3: 120 px cycle,  3 px amplitude → bumps and minor undulation
    //   Oct 4:  45 px cycle,  1 px amplitude → surface texture and noise
    const heights = new Array(count);
    for (let i = 0; i < count; i++) {
      const x    = i * STEP;
      const oct1 = 10 * Math.sin(x / 800  * TWO_PI + phase1);
      const oct2 =  5 * Math.sin(x / 300  * TWO_PI + phase2);
      const oct3 =  3 * Math.sin(x / 120  * TWO_PI + phase3);
      const oct4 =  1 * Math.sin(x / 45   * TWO_PI + phase4);
      heights[i] = oct1 + oct2 + oct3 + oct4;
    }

    // Single smoothing pass — multi-octave noise is already coherent, so one
    // pass is enough to remove the sharpest micro transitions without
    // softening the broad landscape shapes produced by the lower octaves.
    const smoothed = heights.slice();
    for (let i = 1; i < count - 1; i++) {
      smoothed[i] = heights[i - 1] * 0.25 + heights[i] * 0.5 + heights[i + 1] * 0.25;
    }
    for (let i = 0; i < count; i++) heights[i] = smoothed[i];

    // Clamp: keep all values within the permitted height range.
    for (let i = 0; i < count; i++) {
      heights[i] = Math.max(-22, Math.min(16, heights[i]));
    }

    // ---- Flat zone injection ----
    // 3–5 zones are flattened to their local mean height, creating natural
    // plateaus and plains so the terrain doesn't undulate wall-to-wall.
    // Each zone is 80–200 px wide at a random position across the battlefield.
    const zoneCount = 3 + Math.floor(srf() * 3); // 3, 4, or 5 flat zones
    for (let z = 0; z < zoneCount; z++) {
      const centerX = Math.round(srf() * this._BATTLEFIELD_W);
      const halfW   = Math.round((80 + srf() * 120) / 2); // half of an 80–200 px zone
      const i0 = Math.max(0,         Math.floor((centerX - halfW) / STEP));
      const i1 = Math.min(count - 1, Math.ceil( (centerX + halfW) / STEP));
      // Flatten to the mean — creates a plateau at whatever height that section sits
      let sum = 0;
      for (let i = i0; i <= i1; i++) sum += heights[i];
      const mean = sum / (i1 - i0 + 1);
      for (let i = i0; i <= i1; i++) heights[i] = mean;
    }

    return heights;
  }

  // ================================================================
  // TERRAIN FLATTENING
  // ================================================================

  // Flattens a zone of the terrain height map centred on worldX.
  //
  // Algorithm (three passes):
  //   1. Average  — compute the mean height of every sample inside the
  //                 flat zone [centerX − halfFlatWidth … centerX + halfFlatWidth].
  //   2. Flat set — force every sample in that range to the mean height.
  //   3. Blend    — on each edge, linearly interpolate the blendWidth-px
  //                 fringe from the original natural terrain back to the flat
  //                 mean, preventing a sharp cliff at the pad boundary.
  //
  // Called from _generateBattlefield() after the height map has been built
  // and before any enemy objects are constructed.
  _flattenTerrainZone(centerX, halfFlatWidth, blendWidth) {
    const STEP  = 32;
    const h     = this._terrainHeights;
    const count = h.length;

    const flatL = centerX - halfFlatWidth;
    const flatR = centerX + halfFlatWidth;

    // Sample index ranges for the flat zone and each blend fringe
    const iFlatL   = Math.max(0,         Math.ceil( flatL / STEP));
    const iFlatR   = Math.min(count - 1, Math.floor(flatR / STEP));
    const iBlendLL = Math.max(0,         Math.ceil( (flatL - blendWidth) / STEP));
    const iBlendRR = Math.min(count - 1, Math.floor((flatR + blendWidth) / STEP));

    // Pass 1 — average height across all samples in the flat zone
    let sum = 0, num = 0;
    for (let i = iFlatL; i <= iFlatR; i++) { sum += h[i]; num++; }
    if (num === 0) return; // zone too narrow for any 32 px sample — nothing to do
    const flatH = sum / num;

    // Snapshot original fringe heights BEFORE overwriting anything, so the
    // blend can still reference the untouched natural terrain values.
    const origL = [];
    const origR = [];
    for (let i = iBlendLL; i < iFlatL;      i++) origL.push(h[i]);
    for (let i = iFlatR + 1; i <= iBlendRR; i++) origR.push(h[i]);

    // Pass 2 — write the flat height across the structural footprint
    for (let i = iFlatL; i <= iFlatR; i++) h[i] = flatH;

    // Pass 3 — left blend fringe: natural terrain → flatH
    for (let i = iBlendLL; i < iFlatL; i++) {
      const t = Math.max(0, Math.min(1,
        ((i * STEP) - (flatL - blendWidth)) / blendWidth
      )); // 0 at blend start → 1 at flat zone edge
      h[i] = origL[i - iBlendLL] * (1 - t) + flatH * t;
    }

    // Pass 3 — right blend fringe: flatH → natural terrain
    for (let i = iFlatR + 1; i <= iBlendRR; i++) {
      const t = Math.max(0, Math.min(1,
        ((i * STEP) - flatR) / blendWidth
      )); // 0 at flat zone edge → 1 at blend end
      h[i] = flatH * (1 - t) + origR[i - iFlatR - 1] * t;
    }
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
    const STEP     = 2; // screen-pixel column width for terrain profile rendering

    // Sky extension: terrain can dip 16 px below horizonY; fill that buffer
    // with the bottom sky colour so no gap appears on downward slopes.
    ctx.fillStyle = '#1e3a52'; // matches _drawSky bottom band
    ctx.fillRect(0, horizonY, W, 18);

    // ---- Column-by-column terrain rendering ----
    // Each 2 px column is processed independently so the full terrain height
    // profile drives every visual layer — texture bands, cliff strata, horizon
    // transition, surface noise and scattered rocks all follow the height curve.
    for (let sx = 0; sx < W; sx += STEP) {
      const worldX      = sx + this._cameraX;
      const height      = this._getTerrainHeightAt(worldX);
      const surfaceY    = Math.round(horizonY - height);

      // Compare with the previous column to detect cliff faces (rising terrain).
      const prevHeight   = this._getTerrainHeightAt(worldX - STEP);
      const prevSurfaceY = Math.round(horizonY - prevHeight);
      // Positive when terrain just rose: the cliff height is the step up.
      const cliffH       = prevSurfaceY - surfaceY;

      // ---- GROUND BODY: 2 px horizontal bands from below horizon to canvas bottom ----
      // Alternates three tones creating a subtle geological layer feel.
      // The accent (deepest stratum) fires every 6 px suggesting compressed strata.
      const bodyStart = surfaceY + 12; // horizon transition occupies top 12 px
      for (let by = bodyStart; by < H; by += 2) {
        const bandY = by - bodyStart;
        if (bandY % 6 === 0) {
          ctx.fillStyle = '#1f1406'; // accent — deep stratum line
        } else if (Math.floor(bandY / 2) % 2 === 0) {
          ctx.fillStyle = '#2a1a0c'; // primary
        } else {
          ctx.fillStyle = '#251708'; // secondary
        }
        ctx.fillRect(sx, by, STEP, Math.min(2, H - by));
      }

      // ---- CLIFF FACE STRATA (exposed geology on raised sections) ----
      // Only rendered where the terrain has stepped upward relative to the
      // previous column — the vertical face of any raised section.
      if (cliffH > 3) {
        const cliffTop    = surfaceY;
        const cliffBottom = prevSurfaceY;

        // Top 4 px of cliff: surface soil layer
        ctx.fillStyle = '#2a1a0c';
        ctx.fillRect(sx, cliffTop, STEP, Math.min(4, cliffH));

        if (cliffH > 4) {
          // Next 6 px: compressed mid-layer with horizontal crack lines every 2 px
          const midStart = cliffTop + 4;
          const midH     = Math.min(6, cliffH - 4);
          ctx.fillStyle  = '#1a0e06';
          ctx.fillRect(sx, midStart, STEP, midH);
          ctx.fillStyle  = '#0d0804'; // crack lines — slightly darker
          for (let cy = midStart; cy < midStart + midH; cy += 2) {
            ctx.fillRect(sx, cy, STEP, 1);
          }
        }

        if (cliffH > 10) {
          // Remaining depth: deep bedrock with scattered Voidheart mineral pixels
          const bedStart = cliffTop + 10;
          const bedH     = cliffH - 10;
          ctx.fillStyle  = '#0d0804';
          ctx.fillRect(sx, bedStart, STEP, bedH);
          // Dark purple mineral flecks — deterministic from worldX so they
          // stay fixed to the terrain as the camera scrolls.
          const mHash = (worldX * 7 + 43) % 11;
          if (mHash < 2) {
            ctx.fillStyle = '#1a0814'; // Voidheart contamination
            ctx.fillRect(
              sx + (mHash % STEP),
              bedStart + Math.floor(bedH * 0.4),
              1, 1
            );
          }
        }

        // 2 px shadow band at the base of the raised section — anchors the cliff
        ctx.fillStyle = '#080604';
        ctx.fillRect(sx, cliffBottom, STEP, 2);
      }

      // ---- 5-LAYER HORIZON TRANSITION (follows terrain height exactly) ----
      // These bands sit at the very surface, overwriting any cliff strata at the
      // top so the surface edge always reads cleanly.
      let hy = surfaceY;
      ctx.fillStyle = '#4a3a20'; // Layer 1 — 1 px bright alien horizon glow
      ctx.fillRect(sx, hy, STEP, 1); hy += 1;
      ctx.fillStyle = '#3a2a14'; // Layer 2 — 2 px warm ridge tone
      ctx.fillRect(sx, hy, STEP, 2); hy += 2;
      ctx.fillStyle = '#2a1a0c'; // Layer 3 — 2 px mid surface
      ctx.fillRect(sx, hy, STEP, 2); hy += 2;
      ctx.fillStyle = '#1a0e06'; // Layer 4 — 3 px shadow band
      ctx.fillRect(sx, hy, STEP, 3); hy += 3;
      ctx.fillStyle = '#0d0804'; // Layer 5 — 4 px deep shadow
      ctx.fillRect(sx, hy, STEP, 4); // hy now == surfaceY + 12 == bodyStart

      // 1 px highlight at the very top of every raised section — the ridge
      // catches the alien light at a slightly warmer tone than flat ground.
      if (cliffH > 3) {
        ctx.fillStyle = '#3a2a14';
        ctx.fillRect(sx, surfaceY, STEP, 1);
      }

      // ---- SURFACE NOISE PASS ----
      // Every 2 px column: one 1×1 px fleck that is one tone lighter or darker
      // than its neighbours, creating micro-variation across the surface layer.
      const nHash = (worldX * 3 + 17) % 7;
      if (nHash < 3) {
        ctx.fillStyle = (nHash < 1) ? '#3a2a14' : '#1a0e06';
        ctx.fillRect(sx + 1, surfaceY + 6, 1, 1);
      }

      // ---- SCATTERED SURFACE ROCKS ----
      // 1×1 and 2×1 px pixels in grey-brown tones placed at deterministic but
      // varied intervals — they are world-space so they scroll correctly.
      const rHash = (worldX * 13 + 7) % 23;
      if (rHash < 4) {
        const rockColors = ['#3a2a1a', '#4a3a28', '#2a1e10'];
        ctx.fillStyle    = rockColors[rHash % 3];
        const ry         = surfaceY + 4 + (rHash % 4);
        if (rHash < 2) {
          ctx.fillRect(sx + 1, ry, 1, 1); // 1×1 rock
        } else {
          ctx.fillRect(sx,     ry, 2, 1); // 2×1 rock
        }
      }
    }

    // Ground detail features — tile-based, camera-driven.
    // _drawGroundTile adjusts each feature's Y to the local terrain surface.
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
      f.draw(ctx, tileX + f.x, surfaceY + f.y * groundH, f, this._elapsedTime);
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

function _buildGroundFeatures(seed = 0, getHeightAt = () => 0) {
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
  // 8 craters with full OrcCannon-density pixel detail: debris field, raised rim,
  // 4-layer interior, crack lines, Voidheart mineral contamination, and animated
  // Voidheart ore exposure on large craters (r ≥ 17).
  //
  // Per-crater debris is pre-computed using a position-keyed local RNG (dr) so
  // the shared seeded-random counter (_n) still advances exactly 3 times per
  // crater — preserving all other features' positions unchanged.
  //
  // The draw signature adds a 5th argument `t` (elapsed seconds) for animation.
  [
    [75,  0.28, 14], [195, 0.65, 17], [330, 0.38, 11],
    [460, 0.72, 19], [560, 0.22, 13], [680, 0.58, 15],
    [790, 0.42, 12], [900, 0.75, 18],
  ].forEach(([bx, by, br]) => {
    let fx = Math.max(10,   Math.min(950,  Math.round(bx + srf() * 120 - 60)));
    const fy = Math.max(0.15, Math.min(0.85, by + srf() * 0.20 - 0.10));
    const r  = Math.max(9,    Math.min(22,   Math.round(br + srf() * 8   - 4)));

    // Craters prefer low points — scan ±200 px at 32 px steps for the
    // deepest nearby valley and nudge the crater's tile position there.
    let _cBestH = getHeightAt(fx);
    for (let _sx = Math.max(10, fx - 200); _sx <= Math.min(950, fx + 200); _sx += 32) {
      const _h = getHeightAt(_sx);
      if (_h < _cBestH) { _cBestH = _h; fx = _sx; }
    }

    // Local RNG keyed to this crater's position — does NOT consume shared sr() slots.
    let _di = 0;
    const dr = () => {
      const v = ((Math.sin(fx * 17.3 + r * 53.7 + _di++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const W       = Math.floor(r * 3.5);           // outer width
    const H       = Math.max(8, Math.floor(r * 0.88)); // outer height, min 8
    const W2      = Math.floor(W / 2);
    const H2      = Math.floor(H / 2);
    const iW      = W - 6;                          // interior width (inside 3-px rim)
    const iH      = Math.max(2, H - 6);             // interior height
    const isLarge = r >= 17;
    const lightSide = dr() > 0.5 ? 1 : -1;         // which crater wall catches alien light

    // ---- Pre-compute outer debris — rock pixels (8-12 × 1px or 2px) ----
    const DEBRIS_COLORS = ['#3a2a1a', '#4a3822', '#2a1e12'];
    const debris = [];
    const numDebris = 8 + Math.floor(dr() * 5);
    for (let i = 0; i < numDebris; i++) {
      const ang = dr() * Math.PI * 2;
      const dist = 1.0 + dr() * 0.8;
      debris.push({
        dx:  Math.round(Math.cos(ang) * (W2 + dist * 6)),
        dy:  Math.round(Math.sin(ang) * (H2 + dist * 3)),
        w:   dr() > 0.5 ? 2 : 1,
        h:   dr() > 0.5 ? 2 : 1,
        col: DEBRIS_COLORS[Math.floor(dr() * 3)],
      });
    }

    // ---- Pre-compute displaced earth chunks — 4×3 px rectangles (3-4) ----
    const chunks = [];
    const numChunks = 3 + Math.floor(dr() * 2);
    for (let i = 0; i < numChunks; i++) {
      const ang   = dr() * Math.PI * 2;
      const pushF = 1.15 + dr() * 0.4;
      chunks.push({
        dx: Math.round(Math.cos(ang) * W2 * pushF) - 2,
        dy: Math.round(Math.sin(ang) * H2 * pushF) - 1,
      });
    }

    // ---- Pre-compute dust streaks — 4 directions, 1-px lines from rim ----
    const dL = 6 + Math.floor(dr() * 5);
    const dR = 6 + Math.floor(dr() * 5);
    const dU = 4 + Math.floor(dr() * 4);
    const dD = 4 + Math.floor(dr() * 4);
    const dusts = [
      { x: -(W2 + 2 + dL), y:  0,             w: dL, h: 1 }, // left
      { x:   W2 + 2,       y:  0,             w: dR, h: 1 }, // right
      { x:  0,             y: -(H2 + 2 + dU), w: 1, h: dU }, // up
      { x:  0,             y:   H2 + 2,       w: 1, h: dD }, // down
    ];

    // ---- Pre-compute crack lines — 1px horiz, every 3 rows inside interior ----
    const cracks = [];
    for (let row = 3; row < iH - 1; row += 3) {
      const maxCW    = Math.max(1, iW - 7);
      const crackW   = 3 + Math.floor(dr() * maxCW);
      const crackOff = Math.floor(dr() * Math.max(1, iW - crackW));
      cracks.push({ rx: crackOff, ry: row, len: crackW });
    }

    // ---- Pre-compute mineral pixels — dark purple Voidheart contamination ----
    const minerals = [];
    const numMin = 2 + Math.floor(dr() * 5);
    for (let i = 0; i < numMin; i++) {
      minerals.push({
        rx: Math.floor(dr() * Math.max(1, iW - 1)),
        ry: Math.floor(dr() * Math.max(1, iH - 1)),
      });
    }

    // ---- Pre-compute Voidheart cluster + gold veins (large craters only) ----
    const voidCluster = [];
    const goldVeins   = [];
    if (isLarge) {
      const numVoid = 6 + Math.floor(dr() * 3);
      for (let i = 0; i < numVoid; i++) {
        voidCluster.push({ dx: Math.floor(dr() * 9) - 4, dy: Math.floor(dr() * 5) - 2 });
      }
      const numGold = 2 + Math.floor(dr() * 2);
      for (let i = 0; i < numGold; i++) {
        goldVeins.push({ dx: Math.floor(dr() * 11) - 5, dy: Math.floor(dr() * 5) - 2 });
      }
    }

    features.push({
      x: fx, y: fy, r, W, H, W2, H2, iW, iH, isLarge, lightSide,
      debris, chunks, dusts, cracks, minerals, voidCluster, goldVeins,

      draw(ctx, px, py, f, t) {
        const cx = Math.floor(px);
        const cy = Math.floor(py);

        // === OUTER DEBRIS FIELD ===
        // Rock pixels (1×1 and 2×2 in varied earthy tones)
        for (const d of f.debris) {
          ctx.fillStyle = d.col;
          ctx.fillRect(cx + d.dx, cy + d.dy, d.w, d.h);
        }
        // Displaced earth chunks (4×3 in surface soil tone pushed outward from rim)
        ctx.fillStyle = '#4a3820';
        for (const c of f.chunks) {
          ctx.fillRect(cx + c.dx, cy + c.dy, 4, 3);
        }
        // Dust streaks — 1-px lines in 4 directions, slightly lighter than ground
        ctx.fillStyle = '#5e4a28';
        for (const d of f.dusts) {
          ctx.fillRect(cx + d.x, cy + d.y, d.w, d.h);
        }

        // === RAISED RIM ===
        // Outer rim base shadow — 1-px border where raised earth meets surface
        ctx.fillStyle = '#1a0e06';
        ctx.fillRect(cx - f.W2 - 1, cy - f.H2 - 1, f.W + 2, f.H + 2);
        // Raised rim body (3-px wide lip, displaced earth)
        ctx.fillStyle = '#3a2814';
        ctx.fillRect(cx - f.W2, cy - f.H2, f.W, f.H);
        // Inner rim edge highlight — 1-px catching alien light at the top+left boundary
        ctx.fillStyle = '#4a3820';
        ctx.fillRect(cx - f.W2 + 3, cy - f.H2 + 2, f.iW, 1); // top inner edge
        ctx.fillRect(cx - f.W2 + 2, cy - f.H2 + 3, 1, f.iH); // left inner edge

        // === CRATER INTERIOR — 4 DEPTH LAYERS ===
        // Drawn as nested inward rectangles; smaller craters only get 1-2 layers.
        ctx.fillStyle = '#1a0e08'; // outer interior — disturbed deep soil
        ctx.fillRect(cx - f.W2 + 3, cy - f.H2 + 3, f.iW, f.iH);
        if (f.iW > 4 && f.iH > 4) {
          ctx.fillStyle = '#120a06'; // mid interior — compressed impact zone
          ctx.fillRect(cx - f.W2 + 5, cy - f.H2 + 5, f.iW - 4, f.iH - 4);
        }
        if (f.iW > 8 && f.iH > 8) {
          ctx.fillStyle = '#0d0804'; // inner zone — deepest exposed rock
          ctx.fillRect(cx - f.W2 + 7, cy - f.H2 + 7, f.iW - 8, f.iH - 8);
        }
        if (f.iW > 12 && f.iH > 12) {
          ctx.fillStyle = '#080402'; // central pit — near-black deepest point
          ctx.fillRect(cx - f.W2 + 9, cy - f.H2 + 9, f.iW - 12, f.iH - 12);
        }

        // === CRATER WALL DETAIL ===
        const intL = cx - f.W2 + 3; // interior left (screen x)
        const intT = cy - f.H2 + 3; // interior top  (screen y)

        // Directional alien light — one wall is 1 tone lighter than the opposite
        ctx.fillStyle = '#241210';
        if (f.lightSide > 0) {
          ctx.fillRect(cx + f.W2 - 4, intT, 1, f.iH); // right wall lighter
        } else {
          ctx.fillRect(intL,           intT, 1, f.iH); // left wall lighter
        }
        // Horizontal crack lines every 3 rows (#0d0804 on the interior)
        ctx.fillStyle = '#0d0804';
        for (const crack of f.cracks) {
          ctx.fillRect(intL + crack.rx, intT + crack.ry, crack.len, 1);
        }
        // Mineral pixels — dark purple suggesting deep Voidheart contamination
        ctx.fillStyle = '#1a0018';
        for (const m of f.minerals) {
          ctx.fillRect(intL + m.rx, intT + m.ry, 1, 1);
        }

        // === VOIDHEART ORE EXPOSURE — large craters only, game-loop animated ===
        if (f.isLarge) {
          // Pulse between #6a0040 and #aa0060 over a 1.5-second cycle
          const pulse     = (Math.sin(t * (Math.PI * 2 / 1.5)) + 1) / 2;
          const voidColor = pulse > 0.5 ? '#aa0060' : '#6a0040';
          // Faint 1-px glow border around the cluster footprint
          ctx.fillStyle = '#2a0018';
          ctx.fillRect(cx - 5, cy - 3, 10, 6);
          // Gold vein pixels adjacent to ore cluster
          ctx.fillStyle = '#c8901a';
          for (const g of f.goldVeins) {
            ctx.fillRect(cx + g.dx, cy + g.dy, 1, 1);
          }
          // Voidheart ore cluster (pulsing color)
          ctx.fillStyle = voidColor;
          for (const v of f.voidCluster) {
            ctx.fillRect(cx + v.dx, cy + v.dy, 1, 1);
          }
        }
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

  // ---- Voidheart ore veins ----
  // Surface fractures where Voidheart ore runs close to the alien ground.
  // Each vein: a jagged main crack of 8-14 × 5px segments offset 1-2px
  // vertically between each step, rendered as 3 parallel offset rows
  // (dark border / main crack / animated pulsing core). Gold veining
  // appears at every 3rd segment; a 1px stain band flanks the crack on
  // each side. 2-3 branch cracks split off at ~30-45 degrees from the
  // main fracture. A soft glow rectangle is drawn before the crack and
  // widens at peak pulse brightness.
  //
  // Each vein consumes exactly 2 srf() calls (fx, fy). All other random
  // variation uses a local position-keyed RNG (vr) so the shared counter
  // (_n) stays predictable and existing feature positions are unchanged.
  [
    [100, 0.30], [280, 0.54], [450, 0.36], [630, 0.63], [810, 0.44],
  ].forEach(([bx, by]) => {
    const fx = Math.max(60, Math.min(900, Math.round(bx + srf() * 120 - 60)));
    const fy = Math.max(0.15, Math.min(0.75, by + srf() * 0.18 - 0.09));

    // Local RNG keyed to this vein — does NOT consume shared sr() slots.
    let _vi = 0;
    const vr = () => {
      const v = ((Math.sin(fx * 11.73 + fy * 83.17 + _vi++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const SEG_W   = 5;                          // horizontal px per segment
    const numSegs = 8 + Math.floor(vr() * 7);  // 8–14 segments

    // Jagged segments: y offset shifts ±1 or ±2 px between consecutive steps.
    const segments = [];
    let cumDY = 0;
    for (let i = 0; i < numSegs; i++) {
      const jump = vr() > 0.65 ? 2 : 1;
      cumDY += jump * (vr() > 0.5 ? 1 : -1);
      segments.push({ sx: i * SEG_W, dy: cumDY });
    }

    // Gold pixels: 2×1 px at every 3rd segment, placed adjacent to the crack.
    const goldPixels = [];
    for (let i = 2; i < numSegs; i += 3) {
      goldPixels.push({ sx: segments[i].sx, dy: segments[i].dy, side: vr() > 0.5 ? 1 : -1 });
    }

    // Branch cracks: 2-3 sub-fractures splitting off at 30-45 degrees.
    const numBranches = 2 + Math.floor(vr() * 2);
    const branches = [];
    for (let i = 0; i < numBranches; i++) {
      const segIdx = 1 + Math.floor(vr() * (numSegs - 2));
      const slope  = (0.55 + vr() * 0.45) * (vr() > 0.5 ? 1 : -1); // ≈ tan(29°–45°)
      branches.push({ segIdx, slope, len: 4 + Math.floor(vr() * 5) });
    }

    const midIdx = Math.floor(numSegs / 2);

    features.push({
      x: fx, y: fy,
      segments, goldPixels, branches, midIdx, SEG_W,

      draw(ctx, px, py, f, t) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);

        // 2-second pulse: 0 → 1 → 0 via sin (period = 2 s)
        const pulse   = (Math.sin(t * Math.PI) + 1) / 2;
        const coreCol = pulse > 0.5 ? '#cc0060' : '#6a0040';
        const glowW   = pulse > 0.82 ? 4 : 2;

        // === SURFACE GLOW — drawn first (behind the crack) ===
        // Covers a 3-segment span centred on the vein's midpoint.
        const midSeg = f.segments[f.midIdx];
        ctx.fillStyle = '#1a0018';
        ctx.fillRect(
          ox + midSeg.sx - glowW,
          oy + midSeg.dy - glowW,
          f.SEG_W * 3 + glowW * 2,
          3 + glowW * 2);

        // === SURFACE STAINING — 1px discoloration band on each side ===
        ctx.fillStyle = '#1a0818';
        for (const seg of f.segments) {
          ctx.fillRect(ox + seg.sx, oy + seg.dy - 1, f.SEG_W, 1); // above
          ctx.fillRect(ox + seg.sx, oy + seg.dy + 3, f.SEG_W, 1); // below core
        }

        // === 3-LAYER CRACK — outer dark border / main / animated core ===
        for (const seg of f.segments) {
          const sx = ox + seg.sx;
          const sy = oy + seg.dy;
          ctx.fillStyle = '#0d0804'; ctx.fillRect(sx, sy,     f.SEG_W, 1);
          ctx.fillStyle = '#1a0010'; ctx.fillRect(sx, sy + 1, f.SEG_W, 1);
          ctx.fillStyle = coreCol;   ctx.fillRect(sx, sy + 2, f.SEG_W, 1);
        }

        // === GOLD VEINING — 2×1 px at every 3rd segment ===
        ctx.fillStyle = '#c8901a';
        for (const g of f.goldPixels) {
          const gx = g.side > 0
            ? ox + g.sx + f.SEG_W      // right side of segment
            : ox + g.sx - 2;           // left side of segment
          ctx.fillRect(gx, oy + g.dy + 1, 2, 1);
        }

        // === BRANCH CRACKS — 1px wide, same color scheme, no animation ===
        for (const b of f.branches) {
          const startSeg = f.segments[b.segIdx];
          const bx0 = ox + startSeg.sx + Math.floor(f.SEG_W / 2);
          const by0 = oy + startSeg.dy + 1; // start at mid-crack row
          for (let i = 0; i < b.len; i++) {
            const bxi = bx0 + i;
            const byi = by0 + Math.round(i * b.slope);
            // Dark outer border on the far side of the slope direction
            ctx.fillStyle = '#0d0804';
            ctx.fillRect(bxi, byi - Math.sign(b.slope), 1, 1);
            ctx.fillStyle = '#1a0010';
            ctx.fillRect(bxi, byi, 1, 1);
          }
        }
      },
    });
  });

  // ---- Unsettling pools ----
  // Dark viscous liquid pooling in ground depressions.
  // Shape: 4-5 overlapping fillRect rectangles for an organic irregular
  // outline. Base colour #0a0014 (near-black purple), inner darkest zone
  // #060008, 1px edge border #1a0028.
  //
  // Surface: 6-8 highlight pixels #2a0040; the first 3 oscillate slowly
  // (sin-driven, ±1-3 px) suggesting movement on a viscous surface; the
  // first pixel additionally pulses to #4a0060 as if something stirs below.
  //
  // Second pool only: a partially submerged orc machine breaks the surface
  // (#1a1208 angular block, #3a1808 rust edge) with 3 single-pixel bubbles
  // rising upward at staggered phases.
  //
  // Each pool consumes exactly 2 srf() calls (fx, fy). All inner variation
  // uses a local position-keyed RNG (pr).
  [
    [360, 0.58, false],   // plain pool
    [720, 0.42, true],    // pool with submerged orc equipment
  ].forEach(([bx, by, hasEquip]) => {
    const fx = Math.max(60, Math.min(900, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.20, Math.min(0.75, by + srf() * 0.16 - 0.08));

    // Local RNG keyed to this pool.
    let _pi = 0;
    const pr = () => {
      const v = ((Math.sin(fx * 19.31 + fy * 61.73 + _pi++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const baseW = 30 + Math.floor(pr() * 18); // 30–47 px wide
    const baseH = 12 + Math.floor(pr() * 7);  // 12–18 px tall

    // 4-5 overlapping rects — centred on the feature position.
    const numRects = 4 + Math.floor(pr() * 2);
    const rects = [{ dx: 0, dy: 0, w: baseW, h: baseH }]; // base rect
    for (let i = 1; i < numRects; i++) {
      rects.push({
        dx: Math.floor((pr() - 0.5) * baseW * 0.5),
        dy: Math.floor((pr() - 0.5) * baseH * 0.4),
        w:  Math.floor(baseW * (0.35 + pr() * 0.45)),
        h:  Math.floor(baseH * (0.40 + pr() * 0.40)),
      });
    }

    const innerW = Math.floor(baseW * 0.45);
    const innerH = Math.floor(baseH * 0.45);

    // 6-8 surface highlight pixels; first 3 are animated, first is pulser.
    const numHL = 6 + Math.floor(pr() * 3);
    const highlights = [];
    for (let i = 0; i < numHL; i++) {
      highlights.push({
        bx:       Math.floor(pr() * (baseW - 6)) + 3, // 3 .. baseW-3
        by:       Math.floor(pr() * (baseH - 4)) + 2, // 2 .. baseH-2
        freqX:    0.12 + pr() * 0.20,                 // oscillation freq (cycles/s)
        freqY:    0.08 + pr() * 0.14,
        ampX:     1 + Math.floor(pr() * 3),            // 1-3 px amplitude
        ampY:     1 + Math.floor(pr() * 2),
        animated: i < 3,
        pulser:   i === 0,
      });
    }

    // Submerged orc equipment (second pool only).
    let equip = null;
    if (hasEquip) {
      const eW = 9  + Math.floor(pr() * 7);  // 9–15 px wide
      const eH = 5  + Math.floor(pr() * 4);  // 5–8 px tall
      equip = {
        eW, eH,
        edx: Math.floor((pr() - 0.5) * baseW * 0.4),  // center-offset in pool
        edy: -Math.floor(eH * 0.35),                   // breaks pool surface
        bubbles: [
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.00, speed: 3.5 + pr() * 2 },
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.33, speed: 2.8 + pr() * 2 },
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.67, speed: 4.2 + pr() * 2 },
        ],
      };
    }

    features.push({
      x: fx, y: fy,
      rects, innerW, innerH, baseW, baseH, highlights, equip,

      draw(ctx, px, py, f, t) {
        // Feature is centred on (px, py)
        const left = Math.floor(px - f.baseW / 2);
        const top  = Math.floor(py - f.baseH / 2);

        // === POOL BASE — 4-5 overlapping rects ===
        ctx.fillStyle = '#0a0014';
        for (const r of f.rects) {
          ctx.fillRect(left + r.dx, top + r.dy, r.w, r.h);
        }

        // Inner darkest zone (deepest center)
        ctx.fillStyle = '#060008';
        ctx.fillRect(
          left + Math.floor((f.baseW - f.innerW) / 2),
          top  + Math.floor((f.baseH - f.innerH) / 2),
          f.innerW, f.innerH);

        // 1px edge border on the base rect
        ctx.fillStyle = '#1a0028';
        ctx.fillRect(left,                top,                f.baseW, 1); // top
        ctx.fillRect(left,                top + f.baseH - 1, f.baseW, 1); // bottom
        ctx.fillRect(left,                top,                1, f.baseH); // left
        ctx.fillRect(left + f.baseW - 1, top,                1, f.baseH); // right

        // === SURFACE HIGHLIGHTS ===
        for (const h of f.highlights) {
          let hx = left + h.bx;
          let hy = top  + h.by;
          if (h.animated) {
            // Sin-driven drift — highlights appear to shift on the viscous surface
            hx += Math.round(Math.sin(t * h.freqX * Math.PI * 2) * h.ampX);
            hy += Math.round(Math.sin(t * h.freqY * Math.PI * 2) * h.ampY);
          }
          // Clamp inside pool interior
          hx = Math.max(left + 1, Math.min(left + f.baseW - 2, hx));
          hy = Math.max(top  + 1, Math.min(top  + f.baseH - 2, hy));

          let hCol = '#2a0040';
          if (h.pulser) {
            // Occasional brighter pulse as if something moves beneath
            const bright = (Math.sin(t * 0.71 * Math.PI * 2 + 1.57) + 1) / 2;
            hCol = bright > 0.88 ? '#4a0060' : '#2a0040';
          }
          ctx.fillStyle = hCol;
          ctx.fillRect(hx, hy, 1, 1);
        }

        // === SUBMERGED ORC EQUIPMENT (second pool only) ===
        if (f.equip) {
          const eq  = f.equip;
          const eqX = left + Math.floor(f.baseW / 2) + eq.edx - Math.floor(eq.eW / 2);
          const eqY = top  + Math.floor(f.baseH / 2) + eq.edy;

          // Dark angular machine silhouette breaking the pool surface
          ctx.fillStyle = '#1a1208';
          ctx.fillRect(eqX, eqY, eq.eW, eq.eH);
          // Rust highlight along the right edge
          ctx.fillStyle = '#3a1808';
          ctx.fillRect(eqX + eq.eW - 1, eqY, 1, eq.eH);

          // Bubbles: 3 × 1px rising upward from the equipment, staggered phases
          const RISE = 10; // px of total rise before wrapping
          ctx.fillStyle = '#2a0040';
          for (const b of eq.bubbles) {
            const riseAmt = ((t * b.speed + b.phase * RISE) % RISE + RISE) % RISE;
            ctx.fillRect(eqX + Math.floor(eq.eW / 2) + b.bdx, eqY - Math.floor(riseAmt), 1, 1);
          }
        }
      },
    });
  });

  // ================================================================
  // EXCAVATION PITS
  // ================================================================
  // 4 rectangular mining pits cut into the alien ground.
  // Each: 52×20 px. Reinforced dark-metal beam supports on each side,
  // exposed bedrock floor, floor debris (rocks + ore fragments),
  // broken orc support cable with frayed end, geological strata lines
  // on the pit walls, and warning stripes matching OrcSilo hazard markings.
  [
    [160, 0.10], [360, 0.38], [560, 0.15], [800, 0.48],
  ].forEach(([bx, by]) => {
    const fx = Math.max(30,   Math.min(920,  Math.round(bx + srf() * 80 - 40)));
    const fy = Math.max(0.05, Math.min(0.60, by + srf() * 0.12 - 0.06));

    // Local RNG keyed to this pit — does NOT consume shared sr() slots.
    let _ei = 0;
    const er = () => {
      const v = ((Math.sin(fx * 11.3 + fy * 59.7 + _ei++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const PIT_W  = 52;
    const PIT_D  = 20; // depth in pixels
    const BEAM_W = 4;  // metal support beam width each side

    // Floor debris: 3-4 rock pixels + 1-2 purplish-red ore fragments.
    // isOre flag set for the first 1-2 entries.
    const numDebris = 3 + Math.floor(er() * 2);
    const pitDebris = [];
    for (let i = 0; i < numDebris; i++) {
      const innerW = PIT_W - BEAM_W * 2 - 4;
      pitDebris.push({
        rx:    BEAM_W + 2 + Math.floor(er() * Math.max(1, innerW)),
        isOre: i < (1 + Math.floor(er() * 2)),
      });
    }

    // Broken support cable: diagonal 1px line across pit interior.
    const cabX1 = BEAM_W + 2 + Math.floor(er() * 8);
    const cabY1 = 2      + Math.floor(er() * 4);
    const cabX2 = BEAM_W + 10 + Math.floor(er() * 12);
    const cabY2 = PIT_D  - 6;

    features.push({
      x: fx, y: fy,
      PIT_W, PIT_D, BEAM_W, pitDebris, cabX1, cabY1, cabX2, cabY2,

      draw(ctx, px, py, f) {
        const lx = Math.floor(px - f.PIT_W / 2);
        const ty = Math.floor(py); // terrain surface = top rim of pit

        // === PIT WALL STRATA — 1px horizontal bands, 3 geological tones ===
        const strataTones = ['#1a0c06', '#160a04', '#1e1006'];
        for (let d = 0; d < f.PIT_D; d++) {
          ctx.fillStyle = strataTones[d % 3];
          ctx.fillRect(lx + f.BEAM_W, ty + d, f.PIT_W - f.BEAM_W * 2, 1);
        }

        // === PIT FLOOR — exposed bedrock, alternating 1px rows ===
        for (let row = 0; row < 4; row++) {
          ctx.fillStyle = row % 2 === 0 ? '#0d0804' : '#0a0602';
          ctx.fillRect(lx + f.BEAM_W, ty + f.PIT_D - 4 + row, f.PIT_W - f.BEAM_W * 2, 1);
        }

        // === FLOOR DEBRIS — rock pixels and purplish-red ore fragments ===
        for (const d of f.pitDebris) {
          ctx.fillStyle = d.isOre ? '#3a0828' : '#3a2a1a';
          ctx.fillRect(lx + d.rx, ty + f.PIT_D - 3, 2, 1);
        }

        // === BROKEN ORC SUPPORT CABLE — diagonal 1px line + frayed end ===
        ctx.fillStyle = '#2a2a2a';
        const cdx    = f.cabX2 - f.cabX1;
        const cdy    = f.cabY2 - f.cabY1;
        const cSteps = Math.max(Math.abs(cdx), Math.abs(cdy));
        for (let s = 0; s <= cSteps; s++) {
          ctx.fillRect(
            lx + Math.round(f.cabX1 + (s / cSteps) * cdx),
            ty + Math.round(f.cabY1 + (s / cSteps) * cdy),
            1, 1
          );
        }
        // Frayed end: 3 diverging 1px pixels at cable terminus
        ctx.fillRect(lx + f.cabX2 + 1, ty + f.cabY2 - 1, 1, 1);
        ctx.fillRect(lx + f.cabX2 + 2, ty + f.cabY2,     1, 1);
        ctx.fillRect(lx + f.cabX2 + 1, ty + f.cabY2 + 1, 1, 1);

        // === REINFORCED METAL BEAM SUPPORTS — left and right sides ===
        // Left beam
        ctx.fillStyle = '#1a1810'; // dark salvage metal body
        ctx.fillRect(lx, ty, f.BEAM_W, f.PIT_D);
        ctx.fillStyle = '#2e2c22'; // 1px highlight on outer (left) edge
        ctx.fillRect(lx, ty, 1, f.PIT_D);
        ctx.fillStyle = '#0c0a08'; // 1px shadow on inner (right) edge
        ctx.fillRect(lx + f.BEAM_W - 1, ty, 1, f.PIT_D);
        // Right beam
        ctx.fillStyle = '#1a1810';
        ctx.fillRect(lx + f.PIT_W - f.BEAM_W, ty, f.BEAM_W, f.PIT_D);
        ctx.fillStyle = '#2e2c22';
        ctx.fillRect(lx + f.PIT_W - f.BEAM_W, ty, 1, f.PIT_D);
        ctx.fillStyle = '#0c0a08';
        ctx.fillRect(lx + f.PIT_W - 1, ty, 1, f.PIT_D);

        // === WARNING MARKINGS on rim — alternating 2px dark-yellow and black ===
        // Matches OrcSilo hazard stripe palette (#886600 / #181410).
        for (let i = 0; i < f.PIT_W; i += 4) {
          ctx.fillStyle = '#886600';
          ctx.fillRect(lx + i,     ty - 2, 2, 2);
          ctx.fillStyle = '#181410';
          ctx.fillRect(lx + i + 2, ty - 2, 2, 2);
        }
      },
    });
  });

  // ================================================================
  // ABANDONED MINING RIGS
  // ================================================================
  // 3 derelict orc excavation machines left to rust.
  // Each: ~36×28 px. Squat junk-metal frame (dark salvage #1e1c14),
  // panel seams, OrcCannon-standard rivets, collapsed buckled panel,
  // L-shaped broken boom arm, animated spinning gear (game-loop driven),
  // Voidheart ore residue contamination, and orc scratch-mark glyph.
  [
    [240, 0.08], [490, 0.28], [730, 0.48],
  ].forEach(([bx, by]) => {
    const fx = Math.max(40,   Math.min(900,  Math.round(bx + srf() * 80 - 40)));
    const fy = Math.max(0.03, Math.min(0.60, by + srf() * 0.12 - 0.06));

    // Local RNG for per-rig variation — does NOT consume shared sr() slots.
    let _mi = 0;
    const mr = () => {
      const v = ((Math.sin(fx * 17.1 + fy * 43.9 + _mi++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const RIG_W = 36;
    const RIG_H = 28;
    // Which side holds the collapsed panel (alternates per rig)
    const collapseLeft = mr() > 0.5;
    // Gear position: on the non-collapsed side, near the top
    const gearOffX = collapseLeft ? RIG_W - 10 : 4;
    const gearOffY = -(RIG_H - 4); // y offset from base (near top of rig)

    features.push({
      x: fx, y: fy,
      RIG_W, RIG_H, collapseLeft, gearOffX, gearOffY,

      draw(ctx, px, py, f, t) {
        const lx  = Math.floor(px - f.RIG_W / 2);
        const bay = Math.floor(py); // base Y — terrain surface = bottom of rig

        // === MAIN BODY FRAME — dark salvage metal ===
        ctx.fillStyle = '#1e1c14';
        ctx.fillRect(lx, bay - f.RIG_H, f.RIG_W, f.RIG_H);
        // Top surface highlight
        ctx.fillStyle = '#32302a';
        ctx.fillRect(lx, bay - f.RIG_H, f.RIG_W, 1);
        // Base shadow row
        ctx.fillStyle = '#0a0a06';
        ctx.fillRect(lx, bay - 1, f.RIG_W, 1);
        // Right edge shadow
        ctx.fillStyle = '#0e0c08';
        ctx.fillRect(lx + f.RIG_W - 1, bay - f.RIG_H, 1, f.RIG_H);

        // === PANEL SEAMS — 1px divider lines creating structural sections ===
        ctx.fillStyle = '#0e0c08';
        ctx.fillRect(lx + 12, bay - f.RIG_H, 1, f.RIG_H); // left vertical seam
        ctx.fillRect(lx + 24, bay - f.RIG_H, 1, f.RIG_H); // right vertical seam
        ctx.fillRect(lx,      bay - 14,       f.RIG_W, 1); // horizontal mid seam
        ctx.fillRect(lx,      bay - 8,        f.RIG_W, 1); // horizontal lower seam

        // === RIVETS — 1×1 px bright highlight at panel junctions + 1px shadow below ===
        [[11, -15], [11, -7], [23, -15], [23, -7],
         [11, -(f.RIG_H - 1)], [23, -(f.RIG_H - 1)]].forEach(([rx, ry]) => {
          ctx.fillStyle = '#5a5848'; // rivet highlight
          ctx.fillRect(lx + rx, bay + ry,     1, 1);
          ctx.fillStyle = '#0a0806'; // rivet shadow beneath
          ctx.fillRect(lx + rx, bay + ry + 1, 1, 1);
        });

        // === COLLAPSED SECTION — panel offset 3px upward suggesting buckled metal ===
        const colX = f.collapseLeft ? lx : lx + f.RIG_W - 10;
        ctx.fillStyle = '#2a2820'; // buckled face catching more light
        ctx.fillRect(colX, bay - f.RIG_H - 3, 10, Math.floor(f.RIG_H / 2));
        ctx.fillStyle = '#0e0c08'; // seam lines bounding the collapsed panel
        ctx.fillRect(colX,     bay - f.RIG_H - 3, 1, Math.floor(f.RIG_H / 2));
        ctx.fillRect(colX + 9, bay - f.RIG_H - 3, 1, Math.floor(f.RIG_H / 2));

        // === MECHANICAL ARM / BOOM — L-shaped, partially broken ===
        const armBaseX = f.collapseLeft ? lx + f.RIG_W - 5 : lx + 2;
        const armTopY  = bay - f.RIG_H - 9;
        const armDir   = f.collapseLeft ? 1 : -1; // direction horizontal arm extends
        // Vertical section
        ctx.fillStyle = '#2a2820';
        ctx.fillRect(armBaseX, armTopY, 3, 12);
        ctx.fillStyle = '#3e3c30'; // left highlight edge
        ctx.fillRect(armBaseX, armTopY, 1, 12);
        // Horizontal arm extending from top of vertical section
        const hArmX = armBaseX + (armDir > 0 ? 3 : -9);
        ctx.fillStyle = '#2a2820';
        ctx.fillRect(hArmX, armTopY, 9, 3);
        ctx.fillStyle = '#3e3c30'; // top highlight edge
        ctx.fillRect(hArmX, armTopY, 9, 1);
        // Broken dangling end (2×5 px stub dropping from arm tip)
        const hangX = armBaseX + (armDir > 0 ? 11 : -10);
        ctx.fillStyle = '#1e1c14';
        ctx.fillRect(hangX, armTopY + 3, 2, 5);

        // === SPINNING GEAR — 6×6 px square, animated via game loop ===
        // Alternates between top/bottom and left/right notch pairs 3× per second.
        // t is this._elapsedTime fed through _drawGroundTile — game-loop driven.
        const gx       = lx + f.gearOffX;
        const gy       = bay + f.gearOffY;
        const gearFlip = Math.floor(t * 3) % 2; // 0 or 1
        // Gear body
        ctx.fillStyle = '#3a382c';
        ctx.fillRect(gx, gy, 6, 6);
        // Center cross-slot
        ctx.fillStyle = '#2a2820';
        ctx.fillRect(gx + 2, gy + 2, 2, 2);
        // Top-left highlight pixel
        ctx.fillStyle = '#4e4c40';
        ctx.fillRect(gx + 1, gy + 1, 1, 1);
        // Animated 1px notch pixels on alternating edges
        ctx.fillStyle = '#0e0c08';
        if (gearFlip === 0) {
          ctx.fillRect(gx + 2, gy,     2, 1); // top notch
          ctx.fillRect(gx + 2, gy + 5, 2, 1); // bottom notch
        } else {
          ctx.fillRect(gx,     gy + 2, 1, 2); // left notch
          ctx.fillRect(gx + 5, gy + 2, 1, 2); // right notch
        }

        // === VOIDHEART ORE RESIDUE — contamination on ore collection mechanism ===
        ctx.fillStyle = '#1a0018'; // outer contamination halo
        ctx.fillRect(lx + 14, bay - 7, 8, 5);
        ctx.fillStyle = '#2a0028'; // brighter inner core
        ctx.fillRect(lx + 16, bay - 6, 4, 3);
        // Pulsing ore pixel (1.8-second cycle)
        const oreP = (Math.sin(t * Math.PI * 2 / 1.8) + 1) / 2;
        ctx.fillStyle = oreP > 0.6 ? '#6a0040' : '#3a0020';
        ctx.fillRect(lx + 17, bay - 5, 2, 1);

        // === ORC GLYPH — scratch marks on panel (matches OrcCannon #6a5840 style) ===
        const glyX = f.collapseLeft ? lx + 26 : lx + 3;
        ctx.fillStyle = '#6a5840'; // worn scratch tone
        ctx.fillRect(glyX,     bay - 20, 1, 5); // vertical stroke
        ctx.fillRect(glyX - 1, bay - 20, 3, 1); // top horizontal tick
        ctx.fillRect(glyX - 1, bay - 17, 2, 1); // mid tick
      },
    });
  });

  // ================================================================
  // SCATTERED EQUIPMENT PIECES
  // ================================================================
  // 8 small props scattered across the mining zone:
  // 2 broken pipes, 2 ore containers, 2 orc helmets,
  // 1 broken surveying instrument, 1 discarded orc gauntlet.

  // ---- 2 broken pipes ----
  // Straight (18px) and L-shaped (14px + 10px drop). 2px thick,
  // 1px top highlight, 1px bottom shadow — dark salvage metal.
  [[115, 0.25, 'h'], [680, 0.44, 'L']].forEach(([bx, by, shape]) => {
    const fx = Math.max(20, Math.min(940, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.08, Math.min(0.65, by + srf() * 0.14 - 0.07));

    features.push({
      x: fx, y: fy, shape,

      draw(ctx, px, py, f) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        if (f.shape === 'h') {
          // Straight horizontal pipe, 18px long
          ctx.fillStyle = '#2a2820';
          ctx.fillRect(ox - 9, oy - 1, 18, 2);
          ctx.fillStyle = '#3e3c30'; // 1px top highlight
          ctx.fillRect(ox - 9, oy - 1, 18, 1);
          ctx.fillStyle = '#0e0c08'; // 1px bottom shadow
          ctx.fillRect(ox - 9, oy,     18, 1);
          ctx.fillStyle = '#0a0806'; // open end cap
          ctx.fillRect(ox + 8, oy - 1, 1,  2);
        } else {
          // L-shaped pipe: 14px horizontal + 10px vertical drop
          ctx.fillStyle = '#2a2820';
          ctx.fillRect(ox - 7, oy - 1, 14, 2); // horizontal arm
          ctx.fillStyle = '#3e3c30';
          ctx.fillRect(ox - 7, oy - 1, 14, 1);
          ctx.fillStyle = '#0e0c08';
          ctx.fillRect(ox - 7, oy,     14, 1);
          // Vertical arm drops from right end of horizontal
          ctx.fillStyle = '#2a2820';
          ctx.fillRect(ox + 5, oy - 1, 2, 10);
          ctx.fillStyle = '#3e3c30'; // left highlight
          ctx.fillRect(ox + 5, oy - 1, 1, 10);
          ctx.fillStyle = '#0e0c08'; // right shadow
          ctx.fillRect(ox + 6, oy - 1, 1, 10);
        }
      },
    });
  });

  // ---- 2 ore containers ----
  // 8×10px open-topped bins. Panel seam, edge highlights, and a
  // 2×2 px Voidheart ore cluster inside the open top with pulsing glow.
  [[290, 0.30], [745, 0.18]].forEach(([bx, by]) => {
    const fx = Math.max(20, Math.min(940, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.08, Math.min(0.65, by + srf() * 0.14 - 0.07));

    features.push({
      x: fx, y: fy,

      draw(ctx, px, py, f, t) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        // Bin body
        ctx.fillStyle = '#2a2418';
        ctx.fillRect(ox - 4, oy - 10, 8, 10);
        ctx.fillStyle = '#3a3228'; // left highlight edge
        ctx.fillRect(ox - 4, oy - 10, 1, 10);
        ctx.fillStyle = '#0e0c08'; // right shadow edge
        ctx.fillRect(ox + 3,  oy - 10, 1, 10);
        ctx.fillStyle = '#0e0c08'; // base
        ctx.fillRect(ox - 4, oy - 1, 8, 1);
        // Panel seam mid-height
        ctx.fillStyle = '#1a1810';
        ctx.fillRect(ox - 4, oy - 5, 8, 1);
        // Open top rim
        ctx.fillStyle = '#3a3228';
        ctx.fillRect(ox - 4, oy - 10, 8, 1);
        // Voidheart ore residue: 2×2 purplish cluster inside open top
        const oreP = (Math.sin(t * Math.PI * 2 / 2.2) + 1) / 2;
        ctx.fillStyle = oreP > 0.6 ? '#8a0050' : '#4a0030';
        ctx.fillRect(ox - 1, oy - 9, 2, 2);
        // Faint contamination glow border around ore
        ctx.fillStyle = '#1a0018';
        ctx.fillRect(ox - 2, oy - 10, 4, 1);
      },
    });
  });

  // ---- 2 discarded orc helmets ----
  // 10×8 px dome (lying on side). Orc green-grey armour with brass rim,
  // rank plume stub (3×2 px green tuft), and cracked visor (1px dark line).
  [[430, 0.22], [855, 0.40]].forEach(([bx, by]) => {
    const fx = Math.max(20, Math.min(940, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.08, Math.min(0.65, by + srf() * 0.14 - 0.07));

    features.push({
      x: fx, y: fy,

      draw(ctx, px, py) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        // Helmet dome
        ctx.fillStyle = '#2a3818'; // orc green-grey armour
        ctx.fillRect(ox - 5, oy - 8, 10, 7);
        ctx.fillStyle = '#3a4a24'; // top highlight
        ctx.fillRect(ox - 5, oy - 8, 10, 1);
        ctx.fillStyle = '#344422'; // left edge highlight
        ctx.fillRect(ox - 5, oy - 8, 1, 7);
        ctx.fillStyle = '#1a2410'; // depth shadow
        ctx.fillRect(ox - 5, oy - 2, 10, 1);
        // Brass rim at base
        ctx.fillStyle = '#6a5020';
        ctx.fillRect(ox - 5, oy - 1, 10, 1);
        // Rank plume stub: 3×2 px green tuft on top
        ctx.fillStyle = '#3a6020';
        ctx.fillRect(ox - 1, oy - 10, 3, 2);
        ctx.fillStyle = '#2a4a14'; // plume base shadow
        ctx.fillRect(ox,     oy - 9,  1, 1);
        // Cracked visor: 1px dark horizontal line across visor band
        ctx.fillStyle = '#0e1a08';
        ctx.fillRect(ox - 3, oy - 5, 7, 1);
        // Visor highlight above crack
        ctx.fillStyle = '#4a5830';
        ctx.fillRect(ox - 3, oy - 6, 7, 1);
      },
    });
  });

  // ---- 1 broken surveying instrument ----
  // Thin tripod: 3 diverging 1px legs from a central 2×2 px head.
  [[540, 0.35]].forEach(([bx, by]) => {
    const fx = Math.max(20, Math.min(940, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.08, Math.min(0.65, by + srf() * 0.14 - 0.07));

    features.push({
      x: fx, y: fy,

      draw(ctx, px, py) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        // Head: 2×2 px central piece
        ctx.fillStyle = '#4a4838';
        ctx.fillRect(ox - 1, oy - 6, 2, 2);
        // 1px dark border around head
        ctx.fillStyle = '#1a1810';
        ctx.fillRect(ox - 2, oy - 7, 4, 1); // top
        ctx.fillRect(ox - 2, oy - 4, 4, 1); // bottom
        ctx.fillRect(ox - 2, oy - 7, 1, 4); // left
        ctx.fillRect(ox + 1, oy - 7, 1, 4); // right
        // 3 tripod legs diverging as 1px diagonal lines from head base
        ctx.fillStyle = '#2a2820';
        for (let i = 0; i < 7; i++) {
          ctx.fillRect(ox - 1 - i, oy - 4 + i, 1, 1); // left leg
          ctx.fillRect(ox,          oy - 4 + i, 1, 1); // center leg (straight down)
          ctx.fillRect(ox + 1 + i, oy - 4 + i, 1, 1); // right leg
        }
      },
    });
  });

  // ---- 1 discarded orc gauntlet ----
  // 8×9 px armoured glove. Brass base with green knuckle plate,
  // fingers suggested by 3 horizontal 1px division lines, brass
  // knuckle highlight pixels.
  [[670, 0.52]].forEach(([bx, by]) => {
    const fx = Math.max(20, Math.min(940, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.08, Math.min(0.65, by + srf() * 0.14 - 0.07));

    features.push({
      x: fx, y: fy,

      draw(ctx, px, py) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        // Main glove body in brass
        ctx.fillStyle = '#3a3010';
        ctx.fillRect(ox - 4, oy - 10, 8, 9);
        ctx.fillStyle = '#5a4c20'; // top highlight
        ctx.fillRect(ox - 4, oy - 10, 8, 1);
        ctx.fillStyle = '#4a3e1a'; // left edge highlight
        ctx.fillRect(ox - 4, oy - 10, 1, 9);
        ctx.fillStyle = '#1a1608'; // right shadow
        ctx.fillRect(ox + 3, oy - 10, 1, 9);
        ctx.fillStyle = '#0e0c06'; // base rim
        ctx.fillRect(ox - 4, oy - 1, 8, 1);
        // Green armoured knuckle plate
        ctx.fillStyle = '#2a3818';
        ctx.fillRect(ox - 3, oy - 9, 6, 3);
        ctx.fillStyle = '#1e2a10'; // plate top edge
        ctx.fillRect(ox - 3, oy - 9, 6, 1);
        // Fingers suggested by 3 horizontal 1px division lines
        ctx.fillStyle = '#1a1a0e';
        ctx.fillRect(ox - 3, oy - 7, 6, 1); // finger division 1
        ctx.fillRect(ox - 3, oy - 5, 6, 1); // finger division 2
        ctx.fillRect(ox - 3, oy - 3, 6, 1); // finger division 3
        // Brass knuckle highlight pixels
        ctx.fillStyle = '#6a5820';
        ctx.fillRect(ox - 3, oy - 8, 1, 1);
        ctx.fillRect(ox - 1, oy - 8, 1, 1);
        ctx.fillRect(ox + 1, oy - 8, 1, 1);
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
