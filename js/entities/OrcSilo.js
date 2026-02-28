/* ============================================================
   OrcSilo.js
   ============================================================
   An orc Voidheart missile silo — a partially buried launch
   installation embedded in the alien terrain. Only the top
   28 px are visible above the surface; the bulk of the
   structure is underground, feeding on deep ore veins.

   Visual design: wide, low, and imposing — entirely fillRect,
   no arcs, no gradients. Layers from ground up:

     Alien soil  → disturbed ejecta ring around the pad edges
     Collar      → 120×6 px reinforced concrete pad, flush with
                   the ground; expansion joints, bolt rings, and
                   three Voidheart conduit access ports
     Rim         → 120×22 px heavy armored above-ground section;
                   warning diagonals, exposed hydraulics, conduit
                   lines up each side, orc paw emblem, vent ports
     Hatch       → two 44 px-wide armored halves that slide apart
                   horizontally during wind-up, exposing the deep
                   dark missile tube below
     Operators   → two orc facility technicians standing beside
                   the concrete collar (one holds a datapad, the
                   other signals the launch with a raised arm)

   All dimensions are set so the structure reads as a massive
   subterranean installation with only the cap above grade.

   ----------------------------------------------------------------
   DIMENSIONS (above-ground)
   ----------------------------------------------------------------
   Overall width  : 120 px (x = −60 … +60 relative to centre)
   Concrete collar: 120 × 6 px  (y = −6 … 0)
   Armored rim    : 120 × 22 px (y = −28 … −6)
   Total above ground: 28 px

   Hatch doors    : two 58 × 20 px armored panels (Session 2)
                    Left: x = −58 … 0, Right: x = 0 … +58
                    Flush on rim top (y = −28 … −8); slide apart
                    on opening. Each panel: concrete outer skin,
                    3 steel reinforcement strips, 4 bolt rings,
                    hydraulic arm mounts, center-seam warning stripes.

   Perimeter fence: 280 px wide (x = −140 … +140)
                    4 concrete posts at x = −140, −68, +68, +140
                    Two fence sections: −140 to −68, +68 to +140
                    Upper/lower rails, 6 px-spaced pickets, razor wire.
                    Warning beacons: one per post (gold slow / red fast).

   ----------------------------------------------------------------
   HEALTH & DAMAGE STATES
   ----------------------------------------------------------------
   10 hit points (HealthSystem). Progressive visual damage:
     After hit 2 : zigzag crack on the rim left panel
     After hit 4 : scorch marks appear on the concrete collar
     After hit 6 : second crack on rim right panel + bent panel
     After hit 8 : conduit damage — erratic sparking on both
                   side conduit lines
     After hit 10: death — 4-frame pixel art explosion sequence

   ----------------------------------------------------------------
   WIND-UP STATE MACHINE
   ----------------------------------------------------------------
   States: 'idle' → 'windup' → 'firing' (looping) → 'dead'

   idle    The silo is dormant. Conduit glow dim. Warning beacons
           blink slow gold (~1.2 Hz).
           Transition: player enters 500 px horizontal range.

   windup  Hatch slides open over 2.5 s with quadratic ease-in
           (starts almost imperceptible, accelerates — mechanical
           weight). Conduit cells pulse violently.
           At 0.5 s  : steam/hydraulic vapor burst at centre seam.
           At ~1.0 s : silo shaft interior becomes visible.
           At 2.5 s  : doors fully open, missile nose rises; first
                       missile fired → firing state.
           Warning beacons switch to rapid red blink (~6 Hz).
           If player leaves range before 2.5 s: back to idle,
           hatch closes.

   firing  Silo fires one missile every 2.5 seconds.
           Warning beacons remain rapid red.
           If player leaves range: back to idle, hatch closes.

   dead    Death animation running. Missiles in flight continue
           but the silo no longer updates or fires.

   ----------------------------------------------------------------
   COLLISION HELPERS (called from PilotGameState each frame)
   ----------------------------------------------------------------
   getStructureHitbox()
     Returns { x, y, w, h } in world-space X, screen-space Y.
     Used by PilotGameState to test player projectile hits.
     Covers the full 120 × 28 px above-ground structure.

   checkMissilesHitPlayer(playerWorldX, playerY, hitW, hitH)
     Tests each active missile against the player's hitbox.
     Returns true on the first hit; deactivates that missile.
   ============================================================ */

// Tunable per level — increase gradually as difficulty scales
const MISSILE_SPEED = 120;             // world-space pixels per second
// Tunable per level — increase gradually as difficulty scales
const MISSILE_TURN_RATE = 30;          // degrees per second homing turn rate
// Tunable per level — increase gradually as difficulty scales
const MISSILE_TRACKING_DURATION = 4;  // seconds before missile flies ballistic

// Player bolt → missile hitbox (forgiveness — larger than visual for easier interception)
const MISSILE_SHOOT_HITBOX_W  = 20;  // player projectile vs missile: width
const MISSILE_SHOOT_HITBOX_H  = 32;  // player projectile vs missile: height
// Missile → player hitbox (damage — kept tight for fairness)
const MISSILE_DAMAGE_HITBOX_W = 10;  // missile vs player: width
const MISSILE_DAMAGE_HITBOX_H = 21;  // missile vs player: height

class OrcSilo extends Phaser.GameObjects.Graphics {

  // scene        : the Phaser.Scene that owns this object
  // worldX       : world-space X centre of the structure
  // groundY      : screen-space Y of the ground surface (constant; camera.scrollY = 0)
  // missileGroup : Phaser.GameObjects.Group of Projectile instances used as
  //               physics proxies for arcade overlap on homing missiles.
  //               OrcSilo keeps its own homing + rendering logic; this group
  //               provides the physics bodies needed for collision callbacks.
  constructor(scene, worldX, groundY, missileGroup = null) {
    super(scene);

    // Store scene reference for Phaser API calls
    this._scene = scene;

    // Phaser world position — camera handles screen offset automatically.
    // this.x = worldX  replaces the old this.worldX
    // this.y = groundY replaces the old this._groundY
    this.x = worldX;
    this.y = groundY;

    // Register with scene display list
    scene.add.existing(this);
    this.setDepth(5); // below PlayerShip (depth 10), above ground (depth 1)

    // ---- Arcade physics static body for player-bolt overlap detection ----
    // offset(-60, -180) aligns the body top-left to (worldX-60, groundY-180).
    scene.physics.add.existing(this, true);   // true = static body
    this.body.setSize(120, 180); // Hitbox covers full structure height — 180px from ground up to top of rim and fence
    this.body.setOffset(-60, -180);

    // ---- Shared missile group (Phaser physics proxies for collision) ----
    // OrcSilo fires invisible Projectile proxies into this group and keeps
    // their physics bodies positioned to match missile world positions.
    this._missileGroup = missileGroup;

    // ---- Health: 10 hit points ----
    this.health    = new HealthSystem(10);
    this._hitCount = 0;

    // ---- Wind-up state machine ----
    this._state        = 'idle';  // 'idle' | 'windup' | 'firing' | 'dead'
    this._windupTimer  = 0;       // accumulates 0 → 1.5 s during windup phase
    this._fireCooldown = 0;       // counts down 2.5 → 0 s between shots
    this._pulseT       = 0;       // ever-incrementing time for glow oscillation

    // Hatch open amount: 0 = fully closed, 1 = fully open.
    // Updated each frame based on current state (eased over 2.5 s).
    this._hatchOpen = 0;

    // ---- Steam burst (fires once at 0.5 s into windup) ----
    // Each particle: { x, y, vx, vy, age }; cleared after 0.3 s.
    this._steamFired     = false;
    this._steamParticles = [];
    this._steamTimer     = 0;

    // ---- Warning light beacons — driven by Phaser.Time events ----
    // Four posts (indices 0–3), each with an independent blink state and timer.
    // Phaser.Time.addEvent gives precise, decoupled timing vs. the old sine-wave
    // approach. Staggered start delays replace the old _lightPhases offsets.
    // IDLE:  0.625 Hz → 800 ms period    ALERT: 3.333 Hz → 150 ms period
    this._beaconLit    = [false, false, false, false];
    this._beaconAlert  = false;  // tracks current mode to detect state changes
    const idleStagger  = [0, 200, 400, 600]; // ms start offsets per post
    this._beaconTimers = idleStagger.map((startAt, i) =>
      scene.time.addEvent({
        delay:   800,
        startAt,
        callback: () => { this._beaconLit[i] = !this._beaconLit[i]; },
        loop:    true,
      })
    );

    // ---- Last-known player position — used by _renderMissiles for proximity glow ----
    this._lastPlayerWorldX = worldX;
    this._lastPlayerY      = groundY - 150; // reasonable default until first frame

    // ---- Outgoing missiles — pool of 2 in-flight ----
    // Each slot: { active, worldX, y, originY, heading, age, velocityX, velocityY, hits, hitFlashTimer, phaserProxy }
    // worldX/heading are world-space; heading in radians (-π/2 = pointing up); age in seconds.
    // hits: damage taken from player projectiles (6 = destroyed mid-air).
    // hitFlashTimer: counts down from 2/60 s to 0 — draws a white flash overlay.
    // phaserProxy: Projectile instance used as an invisible arcade physics body for
    //             overlap detection; null when missile is inactive.
    // Pool size = max concurrent missiles. Increase for higher difficulty levels
    this._missiles = Array.from({ length: 2 }, () => ({
      active: false, worldX: 0, y: 0, originY: 0,
      heading: -Math.PI / 2, age: 0,
      velocityX: 0, velocityY: 0,
      hits: 0, hitFlashTimer: 0,
      phaserProxy: null,
    }));

    // ---- Mid-air missile explosions — spawned when a missile is shot down ----
    // Each entry: { worldX, y, timer, fragments[], sparks[] }
    this._midairExplosions = [];

    // ---- Launch smoke — spawned when a missile fires, rises over 2 s ----
    // Each puff: { wx (world-space X), y (screen-space), w, h, vx, vy, age, color }
    this._launchSmoke = [];

    // ---- Impact explosion pool — 3 pre-allocated slots, reused on each hit ----
    // Triggered when a missile reaches the player.
    // Each slot: { active, worldX, y, timer, fragments[], sparks[], smoke[] }
    this._impactExplosions = Array.from({ length: 3 }, () => ({
      active: false, worldX: 0, y: 0, timer: 0,
      // 8 Voidheart burst fragments (Frame 2)
      fragments: Array.from({ length: 8 }, () => ({
        x: 0, y: 0, vx: 0, vy: 0, w: 3, h: 3, color: '#aa0060',
      })),
      // 4 gold spark pixels (Frame 3)
      sparks: Array.from({ length: 4 }, () => ({
        x: 0, y: 0, vx: 0, vy: 0, color: '#ffd700',
      })),
      // 4 dark purple smoke puffs (Frame 4)
      smoke: Array.from({ length: 4 }, () => ({
        x: 0, y: 0, vx: 0, vy: 0, w: 10, h: 10, color: '#2a0040',
      })),
    }));

    // ---- In-flight missile smoke trail particles ----
    // Each puff: { worldX, y, age } — 2×2 dark-grey px spawned at flame tip each frame
    this._smokeTrailParticles = [];

    // ---- Damage-state rendering flags ----
    this._crackLeft      = false; // zigzag on rim left section after hit 2
    this._scorchVisible  = false; // scorch marks on collar after hit 4
    this._crackRight     = false; // zigzag on rim right section after hit 6
    this._panelDamage    = false; // bent centre-right armor panel after hit 6
    this._conduitDamage  = false; // erratic sparks on side conduits after hit 8

    // ---- Death / explosion animation ----
    this._dying           = false;
    this._dead            = false;
    this._deathTimer      = 0;
    this._burstFragments  = [];
    this._sparkPixels     = [];
    this._goldDebris      = [];
    this._smokeParticles  = [];
    this._smokeGoldSparks = [];

    // ---- Callback: track hit count for progressive damage visuals ----
    this.health.onDamage(() => {
      this._hitCount++;
      if (this._hitCount >= 2) this._crackLeft     = true;
      if (this._hitCount >= 4) this._scorchVisible  = true;
      if (this._hitCount >= 6) { this._crackRight = true; this._panelDamage = true; }
      if (this._hitCount >= 8) this._conduitDamage  = true;
    });

    // ---- Callback: trigger explosion animation on death ----
    this.health.onDeath(() => {
      this._state      = 'dead';
      this._dying      = true;
      this._deathTimer = 0;
      this._spawnDebris();
      // Clean up beacon timers — silo is gone
      this._beaconTimers.forEach(t => scene.time.removeEvent(t));
      this._beaconTimers = [];
      // Disable structure physics body so player bolts stop overlapping it
      if (this.body) this.body.enable = false;
    });
  }

  // Convenience — PilotGameState skips update/render when this returns false
  isAlive() { return !this._dead; }

  // ================================================================
  // UPDATE — called every frame from EnemyManager.update()
  //
  // time          : Phaser scene time in milliseconds (ignored here)
  // delta         : Phaser frame delta in milliseconds — divide by 1000
  // playerWorldX  : player's current world-space X position
  // playerY       : player's current screen-space Y position
  // cameraScrollX : camera.scrollX — used for viewport-based trigger range
  // ================================================================

  update(time, delta, playerWorldX, playerY, cameraScrollX) {
    const dt = delta / 1000;
    if (this._dead) return;

    // Cache player position each frame so _renderMissiles can access it
    this._lastPlayerWorldX = playerWorldX;
    this._lastPlayerY      = playerY;

    this._pulseT += dt;

    // Always update mid-air explosions, even while the silo is dying
    this._updateMidairExplosions(dt);
    this._updateLaunchSmoke(dt);
    this._updateSmokeTrail(dt);
    this._updateImpactExplosions(dt);

    if (this._dying) {
      this._updateExplosion(dt);
      return;
    }

    // ---- Advance in-flight missiles with homing logic ----
    // Phaser.Math.Angle.Between computes the angle from missile to player cleanly.
    // Phaser.Math.Angle.RotateTo steps toward that target angle by at most
    // (MISSILE_TURN_RATE * dt) radians, automatically taking the shortest arc.
    const trackRateRad = (MISSILE_TURN_RATE * Math.PI / 180); // deg/s → rad/s
    this._missiles.forEach(m => {
      if (!m.active) return;
      m.age += dt;

      // Countdown the 2-frame hit-flash overlay
      m.hitFlashTimer = Math.max(0, m.hitFlashTimer - dt);

      // Homing phase: steer heading toward player while tracking window is open
      if (m.age < MISSILE_TRACKING_DURATION) {
        // Phaser utility: angle (radians) from missile world position to player
        const targetAngle = Phaser.Math.Angle.Between(
          m.worldX, m.y, playerWorldX, playerY
        );
        // Phaser utility: rotate current heading toward target by max step (rad)
        // Takes the shortest path and wraps correctly — replaces manual delta/wrap code
        m.heading = Phaser.Math.Angle.RotateTo(m.heading, targetAngle, trackRateRad * dt);
      }

      // Velocity always derived from current heading — ballistic after tracking ends
      m.velocityX = Math.cos(m.heading) * MISSILE_SPEED;
      m.velocityY = Math.sin(m.heading) * MISSILE_SPEED;

      m.worldX += m.velocityX * dt;
      m.y      += m.velocityY * dt;

      // Spawn 4 smoke trail particles at the outer-flame tip each frame.
      // Tip is 40 px behind the missile centre (body tail +12 px, outer flame +28 px).
      // nx/ny: unit vector pointing forward; tip is in the opposite direction.
      const nx = m.velocityX / MISSILE_SPEED;  // cos(heading)
      const ny = m.velocityY / MISSILE_SPEED;  // sin(heading)
      const tipWX = m.worldX - nx * 40;
      const tipSY = m.y      - ny * 40;
      this._smokeTrailParticles.push(
        { worldX: tipWX - 1, y: tipSY - 1, age: 0 },
        { worldX: tipWX + 1, y: tipSY,     age: 0 },
        { worldX: tipWX,     y: tipSY + 1, age: 0 },
        { worldX: tipWX - 1, y: tipSY + 1, age: 0 },
      );

      // Deactivate after max flight time or if well off-screen vertically
      if (m.age > MISSILE_TRACKING_DURATION * 3 || m.y < -200) {
        m.active = false;
        if (m.phaserProxy) { m.phaserProxy.kill(); m.phaserProxy = null; }
      } else if (m.phaserProxy) {
        // Sync the invisible physics proxy to keep arcade overlap in the right place
        m.phaserProxy.syncProxy(m.worldX, m.y);
      }
    });

    // ---- Detection: silo enters the visible camera viewport (right edge + 100 px buffer) ----
    // Triggers as soon as the silo scrolls onto screen rather than at an
    // arbitrary fixed distance — the sequence now starts while the silo
    // is still just beyond the right edge, so the hatch is visibly opening
    // the moment the structure fully enters view.
    const inRange = this.x <= cameraScrollX + 960 + 100;

    // Sync warning beacon blink rate to current alert state (idle vs. windup/firing).
    // _updateBeaconAlert() only acts when the state actually changes.
    this._updateBeaconAlert(inRange && this._state !== 'idle');

    // ---- Hatch animation ----
    // Closes gradually in idle (at 2 units/s), tracks wind-up progress
    // with a quadratic ease-in over 2.5 s (starts near-imperceptibly slow,
    // accelerates — suggests enormous mechanical weight).
    // Stays fully open during firing.
    if (this._state === 'idle') {
      this._hatchOpen = Math.max(0, this._hatchOpen - dt * 2);
    } else if (this._state === 'windup') {
      // 0.8 s pre-open delay: hatch stays sealed while hydraulics pressurise.
      // After the delay the doors open with a quadratic ease-in over the
      // remaining 1.7 s, reaching fully open exactly when firing begins at 2.5 s.
      const PRE_OPEN_DELAY = 0.8;
      if (this._windupTimer < PRE_OPEN_DELAY) {
        this._hatchOpen = 0;
      } else {
        const p = Math.min(1.0, (this._windupTimer - PRE_OPEN_DELAY) / (2.5 - PRE_OPEN_DELAY));
        this._hatchOpen = p * p; // quadratic ease-in
      }
    } else if (this._state === 'firing') {
      this._hatchOpen = 1.0;
    }

    // ---- Steam burst — fires once at 0.5 s into windup ----
    if (this._state === 'windup' && this._windupTimer >= 0.5 && !this._steamFired) {
      this._steamFired   = true;
      this._steamTimer   = 0;
      // 4 bright white 1 px particles scattered at the center seam
      this._steamParticles = [
        { x:  -3, y: -28, vx:  -22, vy: -55, age: 0 },
        { x:   0, y: -28, vx:   18, vy: -60, age: 0 },
        { x:   3, y: -28, vx:   -8, vy: -48, age: 0 },
        { x:  -1, y: -28, vx:   28, vy: -52, age: 0 },
      ];
    }
    if (this._steamParticles.length > 0) {
      this._steamTimer += dt;
      this._steamParticles.forEach(p => {
        p.age += dt;
        p.x   += p.vx * dt;
        p.y   += p.vy * dt;
      });
      if (this._steamTimer > 0.28) this._steamParticles = [];
    }

    // ================================================================
    // STATE MACHINE
    // ================================================================
    switch (this._state) {

      case 'idle':
        if (inRange) {
          this._state          = 'windup';
          this._windupTimer    = 0;
          this._steamFired     = false;   // reset steam so it fires on next windup
          this._steamParticles = [];
        }
        break;

      case 'windup':
        if (!inRange) {
          this._state          = 'idle';
          this._windupTimer    = 0;
          this._steamFired     = false;
          this._steamParticles = [];
          break;
        }
        this._windupTimer += dt;
        if (this._windupTimer >= 3.0) {
          this._fireMissile(playerWorldX, playerY);
          this._state        = 'firing';
          this._fireCooldown = 12.0; // Launch cycle — reduce for higher difficulty levels
        }
        break;

      case 'firing':
        if (!inRange) {
          this._state        = 'idle';
          this._windupTimer  = 0;
          this._fireCooldown = 0;
          break;
        }
        this._fireCooldown -= dt;
        if (this._fireCooldown <= 0) {
          this._fireMissile(playerWorldX, playerY);
          this._fireCooldown = 12.0;
        }
        break;

      // 'dead' is handled via _dying / _dead above; no switch case needed
    }
  }

  // ================================================================
  // RENDERCANVAS — Phaser Canvas renderer hook.
  //
  // Overrides Phaser.GameObjects.Graphics.renderCanvas so we can use
  // the raw Canvas 2D API (enabling ctx.save/translate/restore) instead
  // of Phaser's command-buffer system. Phaser calls this automatically.
  //
  // renderer : Phaser.Renderer.Canvas.CanvasRenderer
  // src      : this game object
  // camera   : the active Phaser.Cameras.Scene2D.Camera
  // ================================================================

  renderCanvas(renderer, src, camera) {
    if (this._dead) return;

    const ctx = renderer.currentContext;
    const cameraScrollX = camera.scrollX;

    // World-space effects must render even when the silo structure is off-screen.
    // They are drawn first, before the culling guard, so missiles in flight,
    // launch smoke, and impact explosions remain visible after the silo scrolls
    // past the left edge of the camera viewport.
    this._renderMissiles(ctx, cameraScrollX);
    this._renderLaunchSmoke(ctx, cameraScrollX);
    this._renderImpactExplosions(ctx, cameraScrollX);

    // World → screen X; camera.scrollY is always 0 in this scene.
    const screenX = Math.round(this.x - cameraScrollX);
    // Cull structures entirely off-screen (120 px wide, 30 px tall)
    if (screenX < -140 || screenX > 1100) return;

    ctx.save();
    ctx.translate(screenX, this.y);

    if (this._dying) {
      this._renderExplosion(ctx);
      ctx.restore();
      return;
    }

    // ---- Conduit / power cell glow intensity ----
    // idle:   very dim — slow background flicker
    // windup: full-contrast oscillation 0.0→1.0→0.0→1.0 over 1.5 s
    // firing: bright, fast pulse — active danger
    let glow;
    if (this._state === 'windup') {
      glow = Math.abs(Math.sin((this._windupTimer / 1.5) * Math.PI * 2));
    } else if (this._state === 'firing') {
      glow = 0.6 + 0.4 * Math.abs(Math.sin(this._pulseT * Math.PI * 1.2));
    } else {
      glow = 0.08 + 0.04 * Math.abs(Math.sin(this._pulseT * 0.5));
    }

    this._renderPerimeterFence(ctx);
    this._renderPitCollar(ctx, glow);
    this._renderSiloBody(ctx, glow, this._hatchOpen);
    this._renderOrcOperators(ctx);
    this._renderDamageOverlays(ctx);
    this._renderSteamBurst(ctx);

    ctx.restore();
  }

  // ================================================================
  // COLLISION HELPERS — called from PilotGameState each frame
  // ================================================================

  // Returns the structure's axis-aligned bounding box.
  // x, w are world-space; y, h are screen-space.
  // Covers the full 120 × 28 px above-ground structure.
  getStructureHitbox() {
    return {
      x: this.x - 60,    // world-space left edge  (120 px wide)
      y: this.y - 28,    // screen-space top edge  (28 px tall)
      w: 120,
      h: 28,
    };
  }

  // checkMissilesHitPlayer removed — replaced by Phaser arcade overlap in PilotGameScene:
  //   this.physics.add.overlap(missiles, playerShip, onMissileHitPlayer)
  // The physics proxy stored in m.phaserProxy (synced to m.worldX/y each frame)
  // is what the overlap detects.

  // checkProjectilesHitMissiles removed — replaced by Phaser arcade overlap pair 5 in
  // PilotGameScene:
  //   this.physics.add.overlap(playerBolts, missiles, onBoltInterceptMissile)
  // The overlap callback calls hitMissileProxy(proxy) below.

  // ----------------------------------------------------------------
  // detonateMissileProxy — called by PilotGameScene when a missile proxy
  // overlaps the player ship (arcade overlap pair 4).
  //
  // Triggers the impact explosion visual at the missile's last position
  // and deactivates both the internal slot and the physics proxy.
  // ----------------------------------------------------------------
  detonateMissileProxy(proxy) {
    const m = this._missiles.find(ms => ms.phaserProxy === proxy);
    if (!m || !m.active) return;
    this._spawnImpactExplosion(m.worldX, m.y);
    m.active = false;
    if (m.phaserProxy) { m.phaserProxy.kill(); m.phaserProxy = null; }
  }

  // ----------------------------------------------------------------
  // hitMissileProxy — called by PilotGameScene when a player bolt
  // overlaps an in-flight missile proxy (arcade overlap pair 5).
  //
  // proxy  : the Projectile proxy that was overlapped
  //
  // Applies one hit to the missile slot that owns this proxy.
  // 6 hits destroy the missile with a mid-air explosion.
  // Returns the missile worldX/y so the scene can spawn a particle burst.
  // ----------------------------------------------------------------
  hitMissileProxy(proxy) {
    const m = this._missiles.find(ms => ms.phaserProxy === proxy);
    if (!m || !m.active) return null;

    m.hits++;
    m.hitFlashTimer = 2 / 60; // 2-frame white-fill flash overlay
    if (m.hits >= 6) {
      const pos = { x: m.worldX, y: m.y };
      this._spawnMidairExplosion(m.worldX, m.y);
      m.active = false;
      if (m.phaserProxy) { m.phaserProxy.kill(); m.phaserProxy = null; }
      return pos; // caller uses this to place a Phaser particle burst
    }
    return null;
  }

  // ================================================================
  // PRIVATE — FIRING
  // ================================================================

  // Acquire an inactive missile slot and fire it straight upward from
  // the silo hatch. The missile does not track — it travels at a fixed
  // 250 px/s in the negative-Y direction (upward in screen space).
  _fireMissile(targetWorldX, targetY) { // eslint-disable-line no-unused-vars
    // With a 2-slot pool, this naturally enforces the max-2 limit —
    // if both missiles are in flight, find() returns undefined and we bail out.
    const m = this._missiles.find(m => !m.active);
    if (!m) return; // both slots in-flight — launch suppressed

    // Launch point: centre of silo at the top of the rim
    const tipWorldX = this.x;
    const tipY      = this.y - 28; // top of the armored rim

    m.active        = true;
    m.worldX        = tipWorldX;
    m.y             = tipY;
    m.originY       = tipY;
    m.heading       = -Math.PI / 2; // launch straight up; homing steers from there
    m.age           = 0;
    m.velocityX     = 0;
    m.velocityY     = -MISSILE_SPEED;
    m.hits          = 0;
    m.hitFlashTimer = 0;

    // Activate an invisible physics proxy for arcade overlap detection.
    // MISSILE_DAMAGE_HITBOX_W/H are the tight hitbox constants at the top of this file.
    if (this._missileGroup) {
      const proxy = this._missileGroup.get();
      if (proxy) {
        proxy.activateProxy(tipWorldX, tipY, MISSILE_DAMAGE_HITBOX_W, MISSILE_DAMAGE_HITBOX_H);
        // Back-reference so the overlap callback can find this silo from the proxy
        proxy._missileOwner = this;
        m.phaserProxy = proxy;
      }
    }

    // Spawn rising smoke column at the silo opening
    this._spawnLaunchSmoke();
  }

  // ================================================================
  // PRIVATE — DEATH EXPLOSION
  // ================================================================

  // Pre-generate all particle data for the 4-frame explosion.
  // All positions are relative to (screenX, groundY) — the same
  // coordinate origin used by _renderStructure.
  // Explosion centre: approx x=0, y=−14 (mid-hatch level).
  _spawnDebris() {

    // ---- Frame 2: Voidheart burst — 22 mixed-size fragments ----
    // Wider velocity spread than OrcCannon because the silo is a
    // larger structure with more stored propellant energy.
    this._burstFragments = [
      // 2×2 fast light scatter
      { x: 0, y: -14, w: 2, h: 2, vx: -260, vy: -300, color: '#6a0040' },
      { x: 0, y: -14, w: 2, h: 2, vx:  280, vy: -280, color: '#ff40cc' },
      { x: 0, y: -14, w: 2, h: 2, vx: -200, vy: -260, color: '#8a6820' },
      { x: 0, y: -14, w: 2, h: 2, vx:  220, vy: -320, color: '#6a0040' },
      { x: 0, y: -14, w: 2, h: 2, vx: -100, vy: -340, color: '#aa2040' },
      { x: 0, y: -14, w: 2, h: 2, vx:  120, vy: -355, color: '#cc4020' },
      // 3×3 medium fragments
      { x: 0, y: -14, w: 3, h: 3, vx: -170, vy: -220, color: '#aa0060' },
      { x: 0, y: -14, w: 3, h: 3, vx:  190, vy: -240, color: '#ff40cc' },
      { x: 0, y: -14, w: 3, h: 3, vx: -100, vy: -280, color: '#7a5818' },
      { x: 0, y: -14, w: 3, h: 3, vx:  120, vy: -200, color: '#aa0060' },
      { x: 0, y: -14, w: 3, h: 3, vx: -280, vy: -150, color: '#cc20a0' },
      { x: 0, y: -14, w: 3, h: 3, vx:   80, vy: -330, color: '#8a6820' },
      { x: 0, y: -14, w: 3, h: 3, vx: -240, vy: -180, color: '#880050' },
      { x: 0, y: -14, w: 3, h: 3, vx:  300, vy: -125, color: '#cc2080' },
      // 4×4 heavy chunks
      { x: 0, y: -14, w: 4, h: 4, vx: -210, vy: -180, color: '#880050' },
      { x: 0, y: -14, w: 4, h: 4, vx:  230, vy: -160, color: '#ff60d0' },
      { x: 0, y: -14, w: 4, h: 4, vx:  -60, vy: -310, color: '#9a7020' },
      { x: 0, y: -14, w: 4, h: 4, vx:  280, vy: -190, color: '#660040' },
      { x: 0, y: -14, w: 4, h: 4, vx: -320, vy: -140, color: '#7a0030' },
      { x: 0, y: -14, w: 4, h: 4, vx:  100, vy: -290, color: '#aa8020' },
      // 6×4 large armored plate chunks — from the heavy rim panels
      { x: 0, y: -14, w: 6, h: 4, vx: -140, vy: -220, color: '#3a3020' },
      { x: 0, y: -14, w: 6, h: 4, vx:  160, vy: -200, color: '#2e2820' },
    ];

    // ---- Frame 2: spark pixels — 14 bright 1 px sparks ----
    this._sparkPixels = [
      { x: 0, y: -14, vx: -340, vy: -380, color: '#ffffff' },
      { x: 0, y: -14, vx:  360, vy: -350, color: '#ffff00' },
      { x: 0, y: -14, vx: -300, vy: -410, color: '#ffffff' },
      { x: 0, y: -14, vx:  320, vy: -390, color: '#ffff44' },
      { x: 0, y: -14, vx: -110, vy: -430, color: '#ffffff' },
      { x: 0, y: -14, vx:  130, vy: -420, color: '#ffff00' },
      { x: 0, y: -14, vx: -380, vy: -220, color: '#ffff44' },
      { x: 0, y: -14, vx:  400, vy: -210, color: '#ffffff' },
      { x: 0, y: -14, vx:  -70, vy: -450, color: '#ffff00' },
      { x: 0, y: -14, vx:  180, vy: -340, color: '#ffffff' },
      { x: 0, y: -14, vx: -250, vy: -400, color: '#ffff44' },
      { x: 0, y: -14, vx:  270, vy: -380, color: '#ffffff' },
      { x: 0, y: -14, vx: -420, vy: -180, color: '#ffff00' },
      { x: 0, y: -14, vx:  440, vy: -160, color: '#ffffff' },
    ];

    // ---- Frame 3: gold scatter — 16 tiny 2×2 px Voidheart ore fragments ----
    this._goldDebris = [
      { x: 0, y: -14, w: 2, h: 2, vx: -300, vy: -330, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx:  320, vy: -350, color: '#ffff44' },
      { x: 0, y: -14, w: 2, h: 2, vx: -250, vy: -380, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx:  270, vy: -400, color: '#ffb800' },
      { x: 0, y: -14, w: 2, h: 2, vx: -140, vy: -410, color: '#ffff44' },
      { x: 0, y: -14, w: 2, h: 2, vx:  160, vy: -430, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx: -360, vy: -250, color: '#ffb800' },
      { x: 0, y: -14, w: 2, h: 2, vx:  380, vy: -230, color: '#ffff44' },
      { x: 0, y: -14, w: 2, h: 2, vx:  -50, vy: -450, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx:   70, vy: -470, color: '#ffff00' },
      { x: 0, y: -14, w: 2, h: 2, vx: -210, vy: -290, color: '#e8c000' },
      { x: 0, y: -14, w: 2, h: 2, vx:  220, vy: -310, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx: -400, vy: -180, color: '#ffb800' },
      { x: 0, y: -14, w: 2, h: 2, vx:  420, vy: -160, color: '#ffd700' },
      { x: 0, y: -14, w: 2, h: 2, vx: -320, vy: -130, color: '#e8c000' },
      { x: 0, y: -14, w: 2, h: 2, vx:  340, vy: -150, color: '#ffff44' },
    ];

    // ---- Frame 4: smoke linger — 14 dark purple + deep grey rectangles ----
    // Larger and more numerous than OrcCannon smoke — silo is a bigger structure.
    this._smokeParticles = [
      { x: -30, y: -14, w: 18, h: 12, vy:  -55, color: '#2a0040' },
      { x:  12, y: -20, w: 14, h: 16, vy:  -45, color: '#383838' },
      { x:  -6, y: -28, w: 20, h: 10, vy:  -65, color: '#1a0030' },
      { x:  20, y: -12, w: 10, h: 18, vy:  -40, color: '#441060' },
      { x: -20, y:  -8, w: 16, h: 14, vy:  -50, color: '#282828' },
      { x:   6, y: -32, w: 18, h: 10, vy:  -70, color: '#380850' },
      { x: -28, y: -18, w: 10, h: 16, vy:  -35, color: '#1a1a1a' },
      { x:  24, y: -24, w: 16, h: 12, vy:  -60, color: '#441060' },
      { x: -10, y: -22, w: 12, h: 14, vy:  -48, color: '#2a0040' },
      { x:  32, y: -10, w: 10, h: 10, vy:  -38, color: '#333333' },
      { x: -40, y: -16, w: 14, h: 10, vy:  -42, color: '#2a0040' },
      { x:  38, y: -20, w: 12, h: 12, vy:  -52, color: '#441060' },
      { x:   0, y: -30, w: 20, h:  8, vy:  -72, color: '#1a0030' },
      { x: -18, y: -26, w: 10, h: 10, vy:  -36, color: '#383838' },
    ];

    // ---- Frame 4: lingering gold sparks through the smoke column ----
    this._smokeGoldSparks = [
      { x: 0, y: -14, vx:  -90, vy: -190, color: '#ffd700' },
      { x: 0, y: -14, vx:  100, vy: -210, color: '#ffff44' },
      { x: 0, y: -14, vx:  -40, vy: -170, color: '#ffb800' },
      { x: 0, y: -14, vx:   60, vy: -200, color: '#ffd700' },
      { x: 0, y: -14, vx: -120, vy: -150, color: '#ffff00' },
      { x: 0, y: -14, vx:  130, vy: -165, color: '#ffd700' },
      { x: 0, y: -14, vx:  -70, vy: -220, color: '#ffff44' },
    ];
  }

  // Spawns a small Voidheart explosion at (worldX, y) when a missile is
  // shot down. Fragments and sparks share the same palette as the main
  // silo explosion so they feel like the same weapon system.
  _spawnMidairExplosion(worldX, y) {
    this._midairExplosions.push({
      worldX, y, timer: 0,
      fragments: [
        { x: 0, y: 0, vx: -160, vy: -180, w: 3, h: 3, color: '#aa0060' },
        { x: 0, y: 0, vx:  180, vy: -200, w: 3, h: 3, color: '#ff40cc' },
        { x: 0, y: 0, vx:  -70, vy: -220, w: 2, h: 2, color: '#cc20a0' },
        { x: 0, y: 0, vx:   80, vy: -210, w: 2, h: 2, color: '#880050' },
        { x: 0, y: 0, vx: -200, vy: -130, w: 2, h: 2, color: '#6a0040' },
        { x: 0, y: 0, vx:  210, vy: -140, w: 2, h: 2, color: '#3a3028' },
      ],
      sparks: [
        { x: 0, y: 0, vx: -240, vy: -250, color: '#ffffff' },
        { x: 0, y: 0, vx:  260, vy: -240, color: '#ffff00' },
        { x: 0, y: 0, vx:  -50, vy: -270, color: '#ffffff' },
        { x: 0, y: 0, vx:   70, vy: -260, color: '#ffff44' },
      ],
    });
  }

  // ================================================================
  // PRIVATE — LAUNCH SMOKE
  // ================================================================

  // Spawns 6 smoke puffs at the silo opening each time a missile fires.
  // Puffs rise slowly and drift left/right, fading over 2 s.
  // Stored in world-space so they stay fixed as the camera scrolls.
  _spawnLaunchSmoke() {
    const ox = this.x;            // silo centre (world-space)
    const oy = this.y - 28;       // screen-space Y of the silo opening

    console.log('[OrcSilo] Launch smoke spawned at worldX:', ox, '— missile firing');

    // 6 puffs — varied sizes (8–16 px), drift (-8…+8 px/s), rise (-18…-32 px/s)
    this._launchSmoke.push(
      { wx: ox -  8, y: oy,     w: 14, h: 14, vx: -6, vy: -24, color: '#4a4a4a', age: 0 },
      { wx: ox +  6, y: oy,     w: 16, h: 10, vx:  7, vy: -20, color: '#cccccc', age: 0 },
      { wx: ox -  2, y: oy,     w:  8, h:  8, vx:  3, vy: -32, color: '#555555', age: 0 },
      { wx: ox + 12, y: oy - 4, w: 12, h: 12, vx: -8, vy: -18, color: '#aaaaaa', age: 0 },
      { wx: ox - 14, y: oy - 2, w: 10, h: 10, vx:  5, vy: -26, color: '#333333', age: 0 },
      { wx: ox +  2, y: oy,     w: 16, h:  8, vx: -2, vy: -22, color: '#888888', age: 0 },
    );
  }

  // Advances launch smoke particles; removes those older than 2 s.
  _updateLaunchSmoke(dt) {
    this._launchSmoke.forEach(p => {
      p.age += dt;
      p.wx  += p.vx * dt;
      p.y   += p.vy * dt;
    });
    this._launchSmoke = this._launchSmoke.filter(p => p.age < 2.0);
  }

  // Advances missile smoke trail particles; removes those older than 0.4 s.
  // Particles drift upward ~18 px/s in screen space so they linger visibly
  // behind the missile path after it has moved on.
  _updateSmokeTrail(dt) {
    this._smokeTrailParticles.forEach(p => {
      p.age += dt;
      p.y   -= 18 * dt;  // drift upward in screen space
    });
    this._smokeTrailParticles = this._smokeTrailParticles.filter(p => p.age < 0.4);
  }

  // Renders launch smoke puffs in world-space (screen X = wx - cameraX).
  // Quadratic alpha fade so puffs tail off gently.
  _renderLaunchSmoke(ctx, cameraScrollX) {
    if (this._launchSmoke.length === 0) return;
    this._launchSmoke.forEach(p => {
      const alpha = Math.max(0, 1.0 - p.age / 2.0);
      ctx.globalAlpha = alpha * alpha;   // quadratic fade
      ctx.fillStyle   = p.color;
      const sx = Math.round(p.wx - cameraScrollX) - Math.round(p.w / 2);
      const sy = Math.round(p.y)                  - Math.round(p.h / 2);
      ctx.fillRect(sx, sy, p.w, p.h);
    });
    ctx.globalAlpha = 1.0;
  }

  // ================================================================
  // PRIVATE — MISSILE IMPACT EXPLOSION
  // ================================================================

  // Activates the next free slot in the pre-allocated pool of 3.
  // Resets all particle positions and velocities from hardcoded config.
  // Called from detonateMissileProxy when a missile reaches the player.
  _spawnImpactExplosion(worldX, y) {
    const slot = this._impactExplosions.find(e => !e.active);
    if (!slot) return;   // pool exhausted — effect dropped silently

    slot.active = true;
    slot.worldX = worldX;
    slot.y      = y;
    slot.timer  = 0;

    // ---- Frame 2: 8 purplish-red and pink Voidheart fragments ----
    // Radiating outward at 120–200 px/s; sizes 3×3 to 5×5 px.
    const fragCfg = [
      { a: 0,                 spd: 160, w: 3, h: 3, c: '#aa0060' },
      { a: Math.PI / 4,       spd: 180, w: 4, h: 4, c: '#ff40cc' },
      { a: Math.PI / 2,       spd: 140, w: 3, h: 3, c: '#880050' },
      { a: 3 * Math.PI / 4,   spd: 200, w: 5, h: 5, c: '#cc20a0' },
      { a: Math.PI,           spd: 150, w: 4, h: 4, c: '#660040' },
      { a: 5 * Math.PI / 4,   spd: 190, w: 3, h: 3, c: '#ff60d0' },
      { a: 3 * Math.PI / 2,   spd: 130, w: 5, h: 5, c: '#7a0050' },
      { a: 7 * Math.PI / 4,   spd: 170, w: 4, h: 4, c: '#dd30b0' },
    ];
    slot.fragments.forEach((f, i) => {
      const c = fragCfg[i];
      f.x = 0;  f.y = 0;
      f.vx = Math.cos(c.a) * c.spd;
      f.vy = Math.sin(c.a) * c.spd;
      f.w  = c.w;  f.h = c.h;
      f.color = c.c;
    });

    // ---- Frame 3: 4 gold spark pixels scattering wider ----
    const sparkCfg = [
      { a: Math.PI * 0.15, spd: 250 },
      { a: Math.PI * 0.65, spd: 280 },
      { a: Math.PI * 1.15, spd: 260 },
      { a: Math.PI * 1.65, spd: 270 },
    ];
    slot.sparks.forEach((s, i) => {
      const c = sparkCfg[i];
      s.x = 0;  s.y = 0;
      s.vx = Math.cos(c.a) * c.spd;
      s.vy = Math.sin(c.a) * c.spd;
      s.color = '#ffd700';
    });

    // ---- Frame 4: 4 dark purple smoke puffs rising upward ----
    const smokeCfg = [
      { ox: -8, oy: -4, vx: -3, vy: -28, w: 12, h: 10, c: '#2a0040' },
      { ox:  6, oy: -2, vx:  4, vy: -24, w: 10, h: 12, c: '#441060' },
      { ox: -2, oy: -8, vx: -2, vy: -32, w: 14, h:  8, c: '#1a0030' },
      { ox: 10, oy: -6, vx:  3, vy: -20, w: 10, h: 10, c: '#380850' },
    ];
    slot.smoke.forEach((s, i) => {
      const c = smokeCfg[i];
      s.x = c.ox;  s.y = c.oy;
      s.vx = c.vx; s.vy = c.vy;
      s.w  = c.w;  s.h = c.h;
      s.color = c.c;
    });
  }

  // Advances all active impact explosions; deactivates those past 1.5 s.
  _updateImpactExplosions(dt) {
    this._impactExplosions.forEach(ex => {
      if (!ex.active) return;
      ex.timer += dt;

      ex.fragments.forEach(f => {
        f.x  += f.vx * dt;
        f.y  += f.vy * dt;
        f.vy += 80 * dt;   // gentle gravity
      });
      ex.sparks.forEach(s => {
        s.x  += s.vx * dt;
        s.y  += s.vy * dt;
        s.vy += 50 * dt;   // lighter drift
      });
      ex.smoke.forEach(s => {
        s.x += s.vx * dt;
        s.y += s.vy * dt;  // rises only — no gravity
      });

      if (ex.timer >= 1.5) ex.active = false;
    });
  }

  // Renders active impact explosions in world-space.
  // Explosion stays fixed at the impact point even as the camera moves.
  //
  // Frame 1 (0 – 2/60 s) : 40×40 bright white flash
  // Frame 2 (0 – 0.40 s) : 8 Voidheart burst fragments
  // Frame 3 (0.05 – 0.6 s): 4 gold spark pixels
  // Frame 4 (0.10 – 1.1 s): 4 dark-purple smoke puffs
  _renderImpactExplosions(ctx, cameraScrollX) {
    this._impactExplosions.forEach(ex => {
      if (!ex.active) return;

      const sx = Math.round(ex.worldX - cameraScrollX);
      const sy = Math.round(ex.y);
      const t  = ex.timer;

      // ---- Frame 1: 40×40 bright white flash — 2 render frames ----
      if (t < 2 / 60) {
        ctx.globalAlpha = 1.0;
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(sx - 20, sy - 20, 40, 40);
      }

      // ---- Frame 2: Voidheart burst fragments (0 → 0.40 s) ----
      if (t < 0.4) {
        const burstAlpha = t < 0.2 ? 1.0 : Math.max(0, 1.0 - (t - 0.2) / 0.2);
        ctx.globalAlpha  = burstAlpha;
        ex.fragments.forEach(f => {
          ctx.fillStyle = f.color;
          ctx.fillRect(Math.round(sx + f.x), Math.round(sy + f.y), f.w, f.h);
        });
      }

      // ---- Frame 3: gold sparks scattering wider (0.05 → 0.60 s) ----
      if (t >= 0.05 && t < 0.6) {
        const sparkAge   = t - 0.05;
        const sparkAlpha = sparkAge < 0.3 ? 1.0 : Math.max(0, 1.0 - (sparkAge - 0.3) / 0.25);
        ctx.globalAlpha  = sparkAlpha;
        ex.sparks.forEach(s => {
          ctx.fillStyle = s.color;
          ctx.fillRect(Math.round(sx + s.x), Math.round(sy + s.y), 1, 1);
        });
      }

      // ---- Frame 4: dark-purple smoke puffs rising (0.10 → 1.10 s) ----
      if (t >= 0.1 && t < 1.1) {
        const smokeAlpha = Math.max(0, 1.0 - (t - 0.1) / 1.0);
        ctx.globalAlpha  = smokeAlpha;
        ex.smoke.forEach(s => {
          ctx.fillStyle = s.color;
          ctx.fillRect(Math.round(sx + s.x), Math.round(sy + s.y), s.w, s.h);
        });
      }

      ctx.globalAlpha = 1.0;
    });
  }

  // Advances all active mid-air explosions and removes expired ones.
  // Called from update() before the dying-check so explosions continue
  // rendering even while the silo death animation is playing.
  _updateMidairExplosions(dt) {
    this._midairExplosions.forEach(ex => {
      ex.timer += dt;
      ex.fragments.forEach(f => {
        f.x  += f.vx * dt;
        f.y  += f.vy * dt;
        f.vy += 80 * dt; // gravity
      });
      ex.sparks.forEach(s => {
        s.x  += s.vx * dt;
        s.y  += s.vy * dt;
        s.vy += 50 * dt; // lighter drift
      });
    });
    this._midairExplosions = this._midairExplosions.filter(ex => ex.timer < 0.6);
  }

  _updateExplosion(dt) {
    this._deathTimer += dt;

    this._burstFragments.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 140 * dt; // gravity: 140 px/s²
    });

    this._sparkPixels.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 90 * dt;  // lighter — slower fall
    });

    this._goldDebris.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 200 * dt; // heaviest — falls fastest
    });

    this._smokeParticles.forEach(d => {
      d.y += d.vy * dt; // rises only, no gravity
    });

    this._smokeGoldSparks.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 45 * dt;  // slow ember drift
    });

    // Silo explosion lingers slightly longer than cannon (bigger structure)
    if (this._deathTimer >= 2.5) {
      this._dead = true;
    }
  }

  // ================================================================
  // PRIVATE — BEACON ALERT STATE
  // ================================================================

  // Called each frame to sync beacon blink speed to the current alert state.
  // Only rebuilds the Phaser timer events when the state actually changes,
  // preventing unnecessary object churn every frame.
  //
  // IDLE  : 0.625 Hz → 800 ms period  (slow gold blink)
  // ALERT : 3.333 Hz → 150 ms period  (fast red blink)
  _updateBeaconAlert(isAlert) {
    if (this._beaconAlert === isAlert) return; // no change — nothing to do
    this._beaconAlert = isAlert;

    const delay = isAlert ? 150 : 800;
    this._beaconTimers.forEach((timer, i) => {
      this._scene.time.removeEvent(timer);
      this._beaconTimers[i] = this._scene.time.addEvent({
        delay,
        callback: () => { this._beaconLit[i] = !this._beaconLit[i]; },
        loop: true,
      });
    });
  }

  // ================================================================
  // PRIVATE — RENDERING
  // ================================================================

  // ----------------------------------------------------------------
  // CONCRETE COLLAR PAD
  // Draws the wide reinforced surface ring around the silo mouth.
  // y = −6 to 0 (6 px above ground), x = −60 to +60 (120 px wide).
  // ----------------------------------------------------------------
  _renderPitCollar(ctx, glow) {

    // ---- Alien soil disturbance at pad edges ----
    // The ground was torn during installation — irregular ejecta ring
    ctx.fillStyle = '#3a2e14';
    ctx.fillRect(-68, -4, 8, 4);   // left disturbed earth band
    ctx.fillRect( 60, -4, 8, 4);   // right disturbed earth band
    ctx.fillStyle = '#2a2010';
    ctx.fillRect(-70, -2, 4, 2);   // outermost darker alien soil, left
    ctx.fillRect( 66, -2, 4, 2);   // outermost darker alien soil, right
    // Alien crystal / ore fragments in the disturbed soil (purplish tint)
    ctx.fillStyle = '#3a1030';
    ctx.fillRect(-65, -1, 2, 1);
    ctx.fillRect( 63, -1, 2, 1);
    ctx.fillStyle = '#2a0820';
    ctx.fillRect(-68, -3, 1, 1);
    ctx.fillRect( 67, -3, 1, 1);
    ctx.fillRect(-66, -4, 1, 1);
    ctx.fillRect( 65, -4, 1, 1);

    // ---- Concrete pad body ----
    ctx.fillStyle = '#7e7868';  // mid concrete
    ctx.fillRect(-60, -6, 120, 6);

    // Alternating 1 px texture rows — the slight tonal variation reads
    // as concrete aggregate without using any gradient
    ctx.fillStyle = '#898070';  // lighter row
    ctx.fillRect(-60, -6, 120, 1);
    ctx.fillStyle = '#706860';  // darker row
    ctx.fillRect(-60, -4, 120, 1);
    ctx.fillStyle = '#878068';  // lighter row
    ctx.fillRect(-60, -2, 120, 1);

    // ---- Expansion joint lines ----
    // Five vertical dark seams divide the collar into six sections,
    // suggesting the heavy reinforced concrete is poured in sections
    ctx.fillStyle = '#4e4840';
    ctx.fillRect(-40, -6, 1, 6);  // joint at −40
    ctx.fillRect(-20, -6, 1, 6);  // joint at −20
    ctx.fillRect(  0, -6, 1, 6);  // centre joint
    ctx.fillRect( 20, -6, 1, 6);  // joint at +20
    ctx.fillRect( 40, -6, 1, 6);  // joint at +40

    // Top edge recess — thin dark line where collar meets the rim base
    ctx.fillStyle = '#565048';
    ctx.fillRect(-60, -7, 120, 1);

    // ---- Heavy perimeter bolt heads — 2×2 dark squares ----
    // Spaced around both long edges of the collar
    const boltXs = [-56, -47, -36, -24, -12, 10, 22, 34, 46, 55];
    ctx.fillStyle = '#2a2820';  // bolt recess (dark socket)
    boltXs.forEach(bx => {
      ctx.fillRect(bx,  -6, 2, 2);  // top edge bolt
      ctx.fillRect(bx,  -2, 2, 2);  // bottom edge bolt
    });
    ctx.fillStyle = '#7a7060';  // bright bolt-head centre (polished top face)
    boltXs.forEach(bx => {
      ctx.fillRect(bx,  -6, 1, 1);
      ctx.fillRect(bx,  -2, 1, 1);
    });

    // ---- Voidheart Ore conduit access ports ----
    // Three 4×4 px recessed squares on the collar surface, each showing
    // a faint purplish-red glow from the ore conduits below.
    const pr = Math.round( 80 + glow * 120);  //  80 → 200
    const pb = Math.round( 60 + glow *  90);  //  60 → 150
    const portGlow = `rgb(${pr},0,${pb})`;

    // Port positions (centre X of each port)
    [-48, 0, 46].forEach(cx => {
      // Dark recessed outer frame
      ctx.fillStyle = '#1e1818';
      ctx.fillRect(cx - 3, -6, 6, 4);
      // Inner glow fill
      ctx.fillStyle = portGlow;
      ctx.fillRect(cx - 2, -5, 4, 2);
      // Conduit trace line running up from port to rim base
      ctx.fillStyle = '#440830';
      ctx.fillRect(cx - 1, -7, 2, 1);
    });
  }

  // ----------------------------------------------------------------
  // SILO RIM + HATCH
  // Draws the 120×22 px above-ground armored section and the two-part
  // sliding hatch on its top face.
  // y = −28 to −6 (rim body), hatch slides within y = −27 to −8.
  // ----------------------------------------------------------------
  _renderSiloBody(ctx, glow, hatchOpen) {

    // ---- Rim main body ----
    ctx.fillStyle = '#2c2822';
    ctx.fillRect(-60, -28, 120, 22);

    // Top face highlight — shows rim thickness / depth at top edge
    ctx.fillStyle = '#3c3830';
    ctx.fillRect(-60, -28, 120, 2);

    // Bottom shadow — transition into the collar
    ctx.fillStyle = '#1c1a16';
    ctx.fillRect(-60, -8, 120, 2);

    // ---- Horizontal armor panel seams ----
    ctx.fillStyle = '#181610';
    ctx.fillRect(-60, -22, 120, 1);  // upper panel seam
    ctx.fillRect(-60, -15, 120, 1);  // lower panel seam

    // ---- Vertical panel dividers ----
    ctx.fillStyle = '#181610';
    ctx.fillRect(-48, -28, 1, 22);   // outer-left divide
    ctx.fillRect(-12, -28, 1, 22);   // inner-left divide
    ctx.fillRect( 12, -28, 1, 22);   // inner-right divide
    ctx.fillRect( 48, -28, 1, 22);   // outer-right divide

    // Slightly lighter outer flanking panels — different plate material
    ctx.fillStyle = '#343028';
    ctx.fillRect(-60, -28, 12, 22);  // leftmost panel (x−60…−48)
    ctx.fillRect( 48, -28, 12, 22);  // rightmost panel (x+48…+60)

    // ---- Warning diagonal stripes on front face (centre section) ----
    // Alternating orc-red and dark bands suggest a hazard marking
    // spray-painted or stenciled across the launch aperture face.
    for (let i = 0; i < 8; i++) {
      const stripeX = -44 + i * 11;
      const color   = i % 2 === 0 ? '#8a1a00' : '#2a2418';
      for (let row = 0; row < 12; row++) {
        ctx.fillStyle = color;
        ctx.fillRect(stripeX + Math.floor(row * 0.5), -26 + row, 5, 1);
      }
    }

    // ---- Hydraulic piston mounts — exposed mechanisms on each side ----
    // These are the actuators that push the hatch doors outward.

    // Left hydraulic
    ctx.fillStyle = '#484040';   // housing body
    ctx.fillRect(-60, -27, 10, 18);
    ctx.fillStyle = '#6a6060';   // polished piston shaft
    ctx.fillRect(-57, -25,  4, 14);
    ctx.fillStyle = '#383030';   // housing division seams
    ctx.fillRect(-60, -22, 10,  1);
    ctx.fillRect(-60, -17, 10,  1);
    ctx.fillStyle = '#9a9080';   // piston tip bright highlight
    ctx.fillRect(-57, -25,  4,  1);
    ctx.fillStyle = '#b8a888';   // connection pin
    ctx.fillRect(-56, -11,  2,  2);
    ctx.fillStyle = '#786858';   // pin shadow pixel
    ctx.fillRect(-55, -12,  1,  1);

    // Right hydraulic (mirror)
    ctx.fillStyle = '#484040';
    ctx.fillRect( 50, -27, 10, 18);
    ctx.fillStyle = '#6a6060';
    ctx.fillRect( 53, -25,  4, 14);
    ctx.fillStyle = '#383030';
    ctx.fillRect( 50, -22, 10,  1);
    ctx.fillRect( 50, -17, 10,  1);
    ctx.fillStyle = '#9a9080';
    ctx.fillRect( 53, -25,  4,  1);
    ctx.fillStyle = '#b8a888';
    ctx.fillRect( 54, -11,  2,  2);
    ctx.fillStyle = '#786858';
    ctx.fillRect( 55, -12,  1,  1);

    // ---- Voidheart conduit lines running up both sides of the rim ----
    // Dark purple pipe body; one inner glow pixel animated by glow value.
    ctx.fillStyle = '#3a0828';   // pipe body
    ctx.fillRect(-64, -28,  4, 22);  // left conduit pipe
    ctx.fillRect( 60, -28,  4, 22);  // right conduit pipe

    const cr = Math.round(100 + glow * 100);  // 100 → 200
    const cb = Math.round( 80 + glow * 100);  //  80 → 180
    ctx.fillStyle = `rgb(${cr},0,${cb})`;
    ctx.fillRect(-62, -28, 1, 22);  // left inner glow strip
    ctx.fillRect( 61, -28, 1, 22);  // right inner glow strip

    // Conduit clamps — small brackets fixing the pipe to the rim face
    ctx.fillStyle = '#5a5040';
    ctx.fillRect(-65, -26, 6, 2);  // left top clamp
    ctx.fillRect(-65, -18, 6, 2);  // left mid clamp
    ctx.fillRect(-65, -10, 6, 2);  // left bottom clamp
    ctx.fillRect( 59, -26, 6, 2);  // right top clamp
    ctx.fillRect( 59, -18, 6, 2);  // right mid clamp
    ctx.fillRect( 59, -10, 6, 2);  // right bottom clamp

    // ---- Orc military paw emblem ----
    // Scratched / spray-painted onto the centre-left panel face.
    // Five toe shapes above a wide palm block — standard orc unit marking.
    ctx.fillStyle = '#6a2808';  // dark rusty orc marking
    // Palm block
    ctx.fillRect(-32, -20,  8,  6);
    // Five toes (varying heights, widest spread reads best at this scale)
    ctx.fillRect(-34, -26,  3,  6);  // leftmost toe
    ctx.fillRect(-30, -27,  3,  7);  // left-inner toe
    ctx.fillRect(-27, -28,  3,  8);  // centre toe (tallest)
    ctx.fillRect(-24, -27,  3,  7);  // right-inner toe
    ctx.fillRect(-21, -26,  3,  6);  // rightmost toe
    // Lighter highlight on outer edge of each toe — raised claw edge
    ctx.fillStyle = '#9a3810';
    ctx.fillRect(-34, -26, 1, 3);
    ctx.fillRect(-30, -27, 1, 3);
    ctx.fillRect(-27, -28, 1, 3);
    ctx.fillRect(-24, -27, 1, 3);
    ctx.fillRect(-21, -26, 1, 3);
    // Unit code scratch marks below the paw — 1 px dot clusters
    ctx.fillStyle = '#5a2008';
    ctx.fillRect(-32, -13, 1, 1);
    ctx.fillRect(-30, -13, 1, 1);
    ctx.fillRect(-28, -13, 1, 1);
    ctx.fillRect(-26, -13, 1, 1);
    ctx.fillRect(-24, -13, 1, 1);

    // ---- Ventilation ports along bottom edge of rim ----
    // Dark slots hint at the massive underground structure breathing below.
    ctx.fillStyle = '#0c0a08';   // very dark vent opening
    const ventXs = [-55, -44, -33, -22, -11, 0, 11, 22, 33, 44];
    ventXs.forEach(vx => {
      ctx.fillRect(vx, -9, 8, 2);   // vent slot
    });
    ctx.fillStyle = '#2e2c28';   // faint inner face — just visible depth
    ventXs.forEach(vx => {
      ctx.fillRect(vx, -9, 8, 1);   // top-of-slot face
    });

    // Rivet row along top edge of rim
    ctx.fillStyle = '#8a8070';
    const topRivets = [-57, -48, -36, -24, -12, 0, 12, 24, 36, 48, 57];
    topRivets.forEach(rx => {
      ctx.fillRect(rx, -28, 1, 1);
    });
    ctx.fillStyle = '#181610';
    topRivets.forEach(rx => {
      ctx.fillRect(rx, -27, 1, 1);
    });

    // Hatch doors and tube interior are now rendered by _renderHatch()
    this._renderHatch(ctx, glow, hatchOpen);

    // ================================================================
    // VOIDHEART ORE POWER CELL — 10×9 px on the right outer panel face
    // Animates the same way as OrcCannon's cell: dim idle, pulsing
    // windup, bright firing.
    // ================================================================
    let cellR, cellG, cellB;
    if (this._state === 'windup') {
      cellR = Math.round( 60 + glow * 195);  //  60 → 255
      cellG = Math.round(  0 + glow *  10);
      cellB = Math.round( 40 + glow * 215);  //  40 → 255
    } else {
      cellR = Math.round(140 + glow * 115);  // 140 → 255
      cellG = Math.round( 10 + glow *  30);
      cellB = Math.round(120 + glow * 135);  // 120 → 255
    }
    const cellColor = `rgb(${cellR},${cellG},${cellB})`;

    // Three-ring windup pulse — concentric bright rings radiate outward
    if (this._state === 'windup') {
      ctx.globalAlpha = glow;
      ctx.fillStyle = '#8030a0';
      ctx.fillRect( 49, -26, 12,  1);  // ring 1 top
      ctx.fillRect( 49, -17, 12,  1);  // ring 1 bottom
      ctx.fillRect( 49, -25,  1,  8);  // ring 1 left
      ctx.fillRect( 60, -25,  1,  8);  // ring 1 right
      ctx.globalAlpha = glow * 0.85;
      ctx.fillStyle = '#c02890';
      ctx.fillRect( 48, -27, 14,  1);  // ring 2 top
      ctx.fillRect( 48, -16, 14,  1);  // ring 2 bottom
      ctx.fillRect( 48, -26,  1, 10);  // ring 2 left
      ctx.fillRect( 61, -26,  1, 10);  // ring 2 right
      ctx.globalAlpha = glow * 0.70;
      ctx.fillStyle = '#ff60c0';
      ctx.fillRect( 47, -28, 16,  1);  // ring 3 top
      ctx.fillRect( 47, -15, 16,  1);  // ring 3 bottom
      ctx.fillRect( 47, -27,  1, 12);  // ring 3 left
      ctx.fillRect( 62, -27,  1, 12);  // ring 3 right
      ctx.globalAlpha = 1.0;
    }

    // Cell 2 px dark border background
    ctx.fillStyle = '#180820';
    ctx.fillRect( 50, -26, 10,  9);
    // Inner 6×5 bright core — carries the glow colour
    ctx.fillStyle = cellColor;
    ctx.fillRect( 52, -24,  6,  5);

    // Bright sparkle at high glow (> 50%)
    if (glow > 0.5) {
      ctx.globalAlpha = (glow - 0.5) * 2.0;
      ctx.fillStyle   = '#ffccff';
      ctx.fillRect( 53, -23,  4,  3);
      ctx.globalAlpha = 1.0;
    }

    // Two-frame white flash at the instant windup completes
    if (this._state === 'windup' && this._windupTimer >= 1.5 - (2 / 60)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect( 50, -26, 10,  9);
    }
  }

  // ----------------------------------------------------------------
  // HATCH DOORS — new heavy armored design (Session 2)
  // Two panels, each 58 × 20 px, sitting flush on top of the silo rim.
  //   Left  panel: x = −58 … 0    (closed), slides left to x = −118 … −60
  //   Right panel: x =   0 … +58  (closed), slides right to x = +60 … +118
  // maxSlide = 60 — when fully slid the inner edge clears the rim (±60).
  // Easing is applied by the caller via hatchOpen (quadratic ease-in).
  // ----------------------------------------------------------------
  _renderHatch(ctx, glow, hatchOpen) {
    const maxSlide = 60;
    const slideAmt = Math.round(hatchOpen * maxSlide);

    // ================================================================
    // TUBE INTERIOR — revealed as panels slide apart
    // Visible once slideAmt > 4; alpha fades in over 14 px of travel.
    // ================================================================
    if (slideAmt > 4) {
      const tubeAlpha = Math.min(1.0, (slideAmt - 4) / 14);
      ctx.globalAlpha = tubeAlpha;

      // Deep near-black shaft interior
      ctx.fillStyle = '#060404';
      ctx.fillRect(-52, -28, 104, 20);

      // Inner wall faces — left and right shaft walls with slight depth
      ctx.fillStyle = '#140a0c';
      ctx.fillRect(-52, -28,  4, 20);  // left wall face
      ctx.fillRect( 48, -28,  4, 20);  // right wall face
      ctx.fillRect(-52, -28, 104,  2); // top lip of shaft

      // Voidheart conduit glow lines running down the inner walls
      const gr = Math.round(50 + glow * 90);
      const gb = Math.round(30 + glow * 70);
      ctx.fillStyle = `rgb(${gr},0,${gb})`;
      ctx.fillRect(-50, -27, 1, 18);   // left conduit line
      ctx.fillRect( 49, -27, 1, 18);   // right conduit line
      ctx.fillStyle = `rgb(${Math.round(gr * 0.5)},0,${Math.round(gb * 0.5)})`;
      ctx.fillRect(-49, -27, 1, 18);   // left secondary glow
      ctx.fillRect( 48, -27, 1, 18);   // right secondary glow

      // Ambient glow rising from the ore reservoir far below
      const ag = Math.round(60 + glow * 110);
      const ab = Math.round(40 + glow *  90);
      ctx.fillStyle = `rgb(${ag},0,${ab})`;
      ctx.fillRect(-30, -10, 60, 3);   // glow band — wide floor wash
      ctx.fillStyle = `rgb(${Math.round(ag * 0.6)},0,${Math.round(ab * 0.6)})`;
      ctx.fillRect(-20, -11, 40, 1);   // faint upper edge of glow

      // ---- Silo opening smoke — propellant igniting underground ----
      // Small dark puffs inside the shaft visible while hatch is open.
      // Fade in once the doors have moved far enough to be plausible.
      if (slideAmt > 28) {
        const puffIntensity = Math.min(1.0, (slideAmt - 28) / 24);
        const flicker       = 0.6 + 0.4 * Math.abs(Math.sin(this._pulseT * 6.7));
        ctx.globalAlpha = tubeAlpha * puffIntensity * flicker * 0.55;
        ctx.fillStyle = '#2a1838';
        ctx.fillRect(-22, -24, 12, 7);   // left-inner puff
        ctx.fillRect(  8, -26, 10, 5);   // right-upper puff
        ctx.fillStyle = '#1a1028';
        ctx.fillRect( -8, -22, 16, 6);   // centre-low puff
        ctx.fillStyle = '#382848';
        ctx.fillRect(-16, -28,  9, 4);   // near-top left wisp
        ctx.globalAlpha = tubeAlpha;     // restore for subsequent draws
      }

      // ---- Missile nose emerging from shaft when hatch near fully open ----
      if (hatchOpen > 0.80) {
        const noseAlpha = Math.min(1.0, (hatchOpen - 0.80) / 0.20) * tubeAlpha;
        ctx.globalAlpha = noseAlpha;
        // Rise 0 → 14 px as hatch opens fully; noseY tracks the warhead base
        const rise = Math.round((hatchOpen - 0.80) / 0.20 * 14);
        const noseY = -8 - rise;       // starts near shaft floor, rises

        // ---- Thrust flame — 3-frame animated beneath the rising missile ----
        // Drawn before the warhead so the missile body paints over the flame base.
        // 14 px wide matching the warhead; flame sits just below the warhead bottom
        // at noseY+7, clamped so it stays inside the visible shaft (y ≥ −28).
        const flameBaseY  = Math.max(-26, noseY + 7);
        const thrustFrame = Math.floor(this._pulseT * 60) % 3;
        if (thrustFrame === 0) {
          ctx.fillStyle = '#ff8c00';
          ctx.fillRect(-7, flameBaseY,     14, 5);  // orange outer (14×5 px)
          ctx.fillStyle = '#ffff00';
          ctx.fillRect(-5, flameBaseY + 1, 10, 3);  // yellow mid  (10×3 px)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-2, flameBaseY + 2,  4, 2);  // white core   (4×2 px)
        } else if (thrustFrame === 1) {
          ctx.fillStyle = '#ffff00';
          ctx.fillRect(-7, flameBaseY,     14, 5);  // yellow outer
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-5, flameBaseY + 1, 10, 3);  // white mid
          ctx.fillStyle = '#ff8c00';
          ctx.fillRect(-2, flameBaseY + 2,  4, 2);  // orange core
        } else {
          ctx.fillStyle = '#ff8c00';
          ctx.fillRect(-7, flameBaseY,     14, 5);  // orange outer
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-5, flameBaseY + 1, 10, 3);  // white mid
          ctx.fillStyle = '#ffff44';
          ctx.fillRect(-2, flameBaseY + 2,  4, 2);  // bright-yellow core
        }

        // Voidheart warhead (14×12 px matching the in-flight missile)
        ctx.fillStyle = '#880050';
        ctx.fillRect(-7, noseY,      14, 7);  // warhead body (14×7 px)
        ctx.fillStyle = '#aa0060';
        ctx.fillRect(-4, noseY - 4,   8, 4);  // narrowing nose (8×4 px)
        ctx.fillStyle = '#cc20a0';
        ctx.fillRect(-1, noseY - 5,   2, 1);  // tip (2×1 px)
        // Side Voidheart flanges — 2 px each, outside the fuselage
        ctx.fillStyle = '#440030';
        ctx.fillRect(-9, noseY + 1,   2, 3);  // left flange
        ctx.fillRect( 7, noseY + 1,   2, 3);  // right flange
      }

      ctx.globalAlpha = 1.0;
    }

    // ================================================================
    // LEFT HATCH PANEL — 58 × 20 px, slides left as hatch opens
    // x = lx … lx+58   where lx = −58 − slideAmt
    // Panel is clipped out of view once its right edge passes x = −60.
    // ================================================================
    if (-58 - slideAmt + 58 > -62) {   // at least 2 px still on-screen
      const lx = -58 - slideAmt;

      // ---- Armored body layers ----
      // Base dark steel
      ctx.fillStyle = '#3a3630';
      ctx.fillRect(lx, -28, 58, 20);

      // Top face — concrete-like outer skin matching the collar
      ctx.fillStyle = '#7a7464';
      ctx.fillRect(lx, -28, 58, 4);
      ctx.fillStyle = '#898078';   // top texture row (lighter)
      ctx.fillRect(lx, -28, 58, 1);
      ctx.fillStyle = '#6e6860';   // second row (darker)
      ctx.fillRect(lx, -27, 58, 1);
      ctx.fillStyle = '#848070';   // third row (mid)
      ctx.fillRect(lx, -26, 58, 1);

      // Heavy steel reinforcement strips (horizontal bands)
      ctx.fillStyle = '#252220';   // dark recessed strip body
      ctx.fillRect(lx, -24, 58, 2);
      ctx.fillRect(lx, -20, 58, 2);
      ctx.fillRect(lx, -16, 58, 2);
      ctx.fillStyle = '#383430';   // top highlight of each strip
      ctx.fillRect(lx, -24, 58, 1);
      ctx.fillRect(lx, -20, 58, 1);
      ctx.fillRect(lx, -16, 58, 1);

      // Mid-panel fill between strips
      ctx.fillStyle = '#484440';
      ctx.fillRect(lx, -23, 58, 1);
      ctx.fillRect(lx, -22, 58, 2);
      ctx.fillRect(lx, -19, 58, 1);
      ctx.fillRect(lx, -18, 58, 2);
      ctx.fillRect(lx, -15, 58, 7);

      // ---- Hydraulic arm attachment points — outer left edge ----
      // Upper mount
      ctx.fillStyle = '#585048';
      ctx.fillRect(lx + 2, -27, 7,  8);   // housing block
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(lx + 3, -26, 5,  6);   // arm collar face
      ctx.fillStyle = '#3a3428';           // bolt recess
      ctx.fillRect(lx + 5, -24, 2,  2);
      ctx.fillStyle = '#9a8870';           // bolt highlight
      ctx.fillRect(lx + 5, -24, 1,  1);
      // Lower mount
      ctx.fillStyle = '#585048';
      ctx.fillRect(lx + 2, -17, 7,  8);
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(lx + 3, -16, 5,  6);
      ctx.fillStyle = '#3a3428';
      ctx.fillRect(lx + 5, -14, 2,  2);
      ctx.fillStyle = '#9a8870';
      ctx.fillRect(lx + 5, -14, 1,  1);

      // ---- Warning stripes along the center seam (inner right edge) ----
      // Alternating 2 px diagonal bands — dark yellow and near-black
      for (let row = 0; row < 20; row++) {
        const band  = Math.floor(row / 2) % 2;
        ctx.fillStyle = band === 0 ? '#886600' : '#181410';
        ctx.fillRect(lx + 50 + Math.floor(row * 0.4), -28 + row, 5, 1);
      }

      // ---- Thick center seam — right edge of left panel ----
      // 2 px dark gap
      ctx.fillStyle = '#141210';
      ctx.fillRect(lx + 56, -28, 2, 20);
      // 1 px bright edge highlight on the panel-facing side
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(lx + 55, -28, 1, 20);

      // ---- Four large recessed bolt rings (2 × 2 px with shadow) ----
      const leftBolts = [
        { bx: lx + 16, by: -25 },
        { bx: lx + 38, by: -25 },
        { bx: lx + 16, by: -13 },
        { bx: lx + 38, by: -13 },
      ];
      leftBolts.forEach(({ bx, by }) => {
        ctx.fillStyle = '#0e0c0a';   // deep recess shadow
        ctx.fillRect(bx - 1, by - 1, 4, 4);
        ctx.fillStyle = '#585048';   // bolt ring face
        ctx.fillRect(bx,     by,     2, 2);
        ctx.fillStyle = '#9a9080';   // top-left highlight pixel
        ctx.fillRect(bx,     by,     1, 1);
        ctx.fillStyle = '#0c0a08';   // bottom-right shadow pixel
        ctx.fillRect(bx + 1, by + 1, 1, 1);
      });
    }

    // ================================================================
    // RIGHT HATCH PANEL — 58 × 20 px, slides right as hatch opens
    // x = rx … rx+58   where rx = slideAmt
    // Panel is clipped out of view once its left edge passes x = +60.
    // ================================================================
    if (slideAmt < 62) {   // at least 2 px still visible
      const rx = slideAmt;

      // Base dark steel
      ctx.fillStyle = '#3a3630';
      ctx.fillRect(rx, -28, 58, 20);

      // Top face — concrete-like outer skin
      ctx.fillStyle = '#7a7464';
      ctx.fillRect(rx, -28, 58, 4);
      ctx.fillStyle = '#898078';
      ctx.fillRect(rx, -28, 58, 1);
      ctx.fillStyle = '#6e6860';
      ctx.fillRect(rx, -27, 58, 1);
      ctx.fillStyle = '#848070';
      ctx.fillRect(rx, -26, 58, 1);

      // Heavy steel reinforcement strips
      ctx.fillStyle = '#252220';
      ctx.fillRect(rx, -24, 58, 2);
      ctx.fillRect(rx, -20, 58, 2);
      ctx.fillRect(rx, -16, 58, 2);
      ctx.fillStyle = '#383430';
      ctx.fillRect(rx, -24, 58, 1);
      ctx.fillRect(rx, -20, 58, 1);
      ctx.fillRect(rx, -16, 58, 1);

      // Mid-panel fill
      ctx.fillStyle = '#484440';
      ctx.fillRect(rx, -23, 58, 1);
      ctx.fillRect(rx, -22, 58, 2);
      ctx.fillRect(rx, -19, 58, 1);
      ctx.fillRect(rx, -18, 58, 2);
      ctx.fillRect(rx, -15, 58, 7);

      // ---- Hydraulic arm attachment points — outer right edge ----
      // Upper mount
      ctx.fillStyle = '#585048';
      ctx.fillRect(rx + 49, -27, 7,  8);
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(rx + 50, -26, 5,  6);
      ctx.fillStyle = '#3a3428';
      ctx.fillRect(rx + 51, -24, 2,  2);
      ctx.fillStyle = '#9a8870';
      ctx.fillRect(rx + 52, -24, 1,  1);
      // Lower mount
      ctx.fillStyle = '#585048';
      ctx.fillRect(rx + 49, -17, 7,  8);
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(rx + 50, -16, 5,  6);
      ctx.fillStyle = '#3a3428';
      ctx.fillRect(rx + 51, -14, 2,  2);
      ctx.fillStyle = '#9a8870';
      ctx.fillRect(rx + 52, -14, 1,  1);

      // ---- Warning stripes along the center seam (inner left edge) ----
      for (let row = 0; row < 20; row++) {
        const band  = Math.floor(row / 2) % 2;
        ctx.fillStyle = band === 0 ? '#886600' : '#181410';
        ctx.fillRect(rx + 3 - Math.floor(row * 0.4), -28 + row, 5, 1);
      }

      // ---- Thick center seam — left edge of right panel ----
      ctx.fillStyle = '#141210';
      ctx.fillRect(rx,     -28, 2, 20);   // 2 px dark gap
      ctx.fillStyle = '#7a7060';
      ctx.fillRect(rx + 2, -28, 1, 20);   // 1 px bright edge highlight

      // ---- Four large recessed bolt rings ----
      const rightBolts = [
        { bx: rx + 18, by: -25 },
        { bx: rx + 40, by: -25 },
        { bx: rx + 18, by: -13 },
        { bx: rx + 40, by: -13 },
      ];
      rightBolts.forEach(({ bx, by }) => {
        ctx.fillStyle = '#0e0c0a';
        ctx.fillRect(bx - 1, by - 1, 4, 4);
        ctx.fillStyle = '#585048';
        ctx.fillRect(bx,     by,     2, 2);
        ctx.fillStyle = '#9a9080';
        ctx.fillRect(bx,     by,     1, 1);
        ctx.fillStyle = '#0c0a08';
        ctx.fillRect(bx + 1, by + 1, 1, 1);
      });
    }

    // ---- Centre lock mechanism — fades out as hatch begins to move ----
    if (slideAmt < 6) {
      ctx.globalAlpha = 1.0 - slideAmt / 6;
      ctx.fillStyle = '#4a4440';   // lock housing
      ctx.fillRect(-4, -28, 8, 20);
      ctx.fillStyle = '#8a7a60';   // lock plate face
      ctx.fillRect(-3, -22, 6,  4);
      ctx.fillStyle = '#c0a870';   // lock pin highlight
      ctx.fillRect(-1, -21, 2,  2);
      ctx.globalAlpha = 1.0;
    }
  }

  // ----------------------------------------------------------------
  // STEAM BURST — 4 bright white 1 px pixels scattered at the seam
  // Triggered once at 0.5 s into windup; cleared after 0.28 s.
  // Called after all structure layers so steam renders on top.
  // ----------------------------------------------------------------
  _renderSteamBurst(ctx) {
    if (this._steamParticles.length === 0) return;
    const maxAge = 0.28;
    this._steamParticles.forEach(p => {
      const lifeRatio = Math.max(0, 1.0 - p.age / maxAge);
      ctx.globalAlpha = lifeRatio * lifeRatio;  // fade out quickly
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    });
    ctx.globalAlpha = 1.0;
  }

  // ----------------------------------------------------------------
  // PERIMETER FENCE (Session 2)
  // A chain-link / rail fence enclosing 280 px around the silo centre.
  //
  // Post positions  (x = centre of each 6 px post):
  //   Outer left  : x = −140    Inner left  : x = −68
  //   Inner right : x = +68     Outer right : x = +140
  //
  // Fence left section  : x = −140 … −68  (rail + pickets)
  // Fence right section : x = +68  … +140 (rail + pickets)
  //
  // Each post: 6 × 32 px concrete (y = −32 … 0), pour-line seams,
  //   darker cap at top, razor wire zigzag extending 6 px above cap.
  // Two horizontal rails (2 px tall) connect each post pair:
  //   Upper rail: y = −24 … −22    Lower rail: y = −14 … −12
  // Vertical pickets: 1 px wide, spaced 6 px, between rail heights.
  // Razor wire coils on top rail: alternating bright/dark 2 px runs.
  // Warning beacons: 4 × 4 px housing + 2 × 2 px light on each post.
  // ----------------------------------------------------------------
  _renderPerimeterFence(ctx) {
    // Post X centres
    const posts = [-140, -68, 68, 140];

    // ================================================================
    // FENCE SECTIONS — rails + pickets between outer and inner posts
    // Left section: posts[0] to posts[1]; right: posts[2] to posts[3]
    // ================================================================
    const sections = [
      { x0: -140, x1: -68 },
      { x0:   68, x1: 140 },
    ];

    sections.forEach(({ x0, x1 }) => {
      const leftEdge  = x0 + 3;   // right edge of left post (post is 6 px wide, centred)
      const rightEdge = x1 - 3;   // left edge of right post

      // ---- Lower horizontal rail ----
      ctx.fillStyle = '#383430';   // dark metal body
      ctx.fillRect(leftEdge, -14, rightEdge - leftEdge, 2);
      ctx.fillStyle = '#585450';   // 1 px top-edge highlight
      ctx.fillRect(leftEdge, -14, rightEdge - leftEdge, 1);

      // ---- Upper horizontal rail ----
      ctx.fillStyle = '#383430';
      ctx.fillRect(leftEdge, -24, rightEdge - leftEdge, 2);
      ctx.fillStyle = '#585450';
      ctx.fillRect(leftEdge, -24, rightEdge - leftEdge, 1);

      // ---- Vertical pickets — 1 px wide, spaced 6 px apart ----
      ctx.fillStyle = '#2e2c28';
      for (let px = leftEdge + 3; px < rightEdge - 2; px += 6) {
        ctx.fillRect(px, -24, 1, 12);   // spans between upper and lower rails
      }

      // ---- Razor wire coils on top rail — alternating bright/dark 2 px runs ----
      let bright = true;
      for (let wx = leftEdge; wx < rightEdge; wx += 2) {
        ctx.fillStyle = bright ? '#c8c8c4' : '#484440';
        ctx.fillRect(wx, -25, 2, 1);    // wire coil run on top of upper rail
        bright = !bright;
      }
    });

    // ================================================================
    // POSTS — drawn after rails so posts overlap the rail ends cleanly
    // ================================================================
    posts.forEach((cx, i) => {
      const px = cx - 3;   // left edge of 6 px wide post

      // ---- Concrete post body ----
      ctx.fillStyle = '#8c8880';   // light grey concrete
      ctx.fillRect(px, -32, 6, 32);

      // Pour-line seams (horizontal every 8 px — concrete form joints)
      ctx.fillStyle = '#6e6c68';
      ctx.fillRect(px, -32, 6, 1);   // top form edge
      ctx.fillRect(px, -24, 6, 1);
      ctx.fillRect(px, -16, 6, 1);
      ctx.fillRect(px,  -8, 6, 1);

      // Side shadow — right edge slightly darker (depth)
      ctx.fillStyle = '#787470';
      ctx.fillRect(px + 5, -32, 1, 32);

      // Left highlight edge
      ctx.fillStyle = '#9e9c98';
      ctx.fillRect(px, -32, 1, 32);

      // ---- Darker cap on top of post ----
      ctx.fillStyle = '#606058';
      ctx.fillRect(px - 1, -32, 8, 3);   // cap slightly wider
      ctx.fillStyle = '#808078';
      ctx.fillRect(px - 1, -32, 8, 1);   // cap top highlight

      // ---- Razor wire zigzag extending 6 px above cap ----
      // A jagged 1 px line in bright silver drawn as a zigzag
      ctx.fillStyle = '#d0d0cc';
      for (let zy = -38; zy >= -38; zy--) { void zy; } // no-op loop guard
      // Three zigzag segments above the cap
      ctx.fillRect(cx - 2, -35, 1, 1);   // left zag
      ctx.fillRect(cx - 1, -36, 1, 1);
      ctx.fillRect(cx,     -37, 1, 1);   // centre peak
      ctx.fillRect(cx + 1, -36, 1, 1);
      ctx.fillRect(cx + 2, -35, 1, 1);   // right zag
      ctx.fillRect(cx - 2, -33, 1, 1);
      ctx.fillRect(cx - 1, -34, 1, 1);
      ctx.fillRect(cx + 1, -34, 1, 1);
      ctx.fillRect(cx + 2, -33, 1, 1);

      // ================================================================
      // WARNING BEACON — driven by Phaser.Time events (see _updateBeaconAlert)
      // IDLE = slow gold blink (0.625 Hz)   ALERT = fast red blink (3.333 Hz)
      // _beaconLit[i] is toggled by the timer; _beaconAlert tracks the mode.
      // ================================================================
      const isAlert = this._beaconAlert;
      const lit     = this._beaconLit[i];

      // 4 × 4 px dark metal housing (centred on post, above cap)
      ctx.fillStyle = '#2a2820';
      ctx.fillRect(cx - 2, -42, 4, 4);

      if (lit) {
        // Soft 1 px glow halo — slightly larger rect in dim gold/red
        const haloColor = isAlert ? '#602020' : '#5a4810';
        ctx.fillStyle   = haloColor;
        ctx.fillRect(cx - 3, -43, 6, 6);

        // 2 × 2 px bright light centre
        const lightColor = isAlert ? '#ff2020' : '#ffd040';
        ctx.fillStyle    = lightColor;
        ctx.fillRect(cx - 1, -41, 2, 2);
      } else {
        // Dim unlit state — warm dark amber / deep red tint
        ctx.fillStyle = isAlert ? '#280808' : '#2a1e04';
        ctx.fillRect(cx - 1, -41, 2, 2);
      }

      // Housing frame outline (drawn on top of glow/light)
      ctx.fillStyle = '#2a2820';
      ctx.fillRect(cx - 2, -42, 4, 1);   // top edge
      ctx.fillRect(cx - 2, -39, 4, 1);   // bottom edge
      ctx.fillRect(cx - 2, -42, 1, 4);   // left edge
      ctx.fillRect(cx + 1, -42, 1, 4);   // right edge
    });
  }

  // ----------------------------------------------------------------
  // ORC OPERATORS
  // Two facility technicians standing beside the concrete collar.
  // They are positioned just outside the collar edges (≈76 px from
  // centre), facing the silo, suggesting they are managing the launch.
  // Simplified figure vs. the cannon gunner — operator jumpsuits,
  // one holds a datapad, the other signals with a raised arm.
  // ----------------------------------------------------------------
  _renderOrcOperators(ctx) {

    // ---- LEFT OPERATOR — standing at roughly x = −76 ----
    const lx = -76;

    // Boots — dark leather soles
    ctx.fillStyle = '#1a1006';
    ctx.fillRect(lx - 4, -2, 4, 2);  // left boot
    ctx.fillRect(lx + 1, -2, 4, 2);  // right boot
    ctx.fillStyle = '#2e1c0a';
    ctx.fillRect(lx - 4, -2, 4, 1);  // boot highlight
    ctx.fillRect(lx + 1, -2, 4, 1);

    // Lower legs — olive-green utility jumpsuit
    ctx.fillStyle = '#2a4010';
    ctx.fillRect(lx - 4, -8, 4, 6);  // left leg
    ctx.fillRect(lx + 1, -8, 4, 6);  // right leg
    ctx.fillStyle = '#1e3008';        // inner shadow between legs
    ctx.fillRect(lx - 1, -8, 1, 6);
    ctx.fillRect(lx + 1, -8, 1, 6);

    // Torso — 9×10 px jumpsuit body
    ctx.fillStyle = '#283810';
    ctx.fillRect(lx - 4, -18, 9, 10);
    ctx.fillStyle = '#1e2c0a';        // chest panel seam
    ctx.fillRect(lx - 4, -14, 9,  1);
    ctx.fillStyle = '#384c1a';        // top-of-torso highlight
    ctx.fillRect(lx - 4, -18, 9,  2);

    // Right forearm — extends right toward the collar, holding datapad
    ctx.fillStyle = '#4a9420';        // orc skin
    ctx.fillRect(lx + 5, -16, 2,  8);
    // Datapad — small control device in the operator's right hand
    ctx.fillStyle = '#3a3828';        // device body
    ctx.fillRect(lx + 7, -17, 7,  5);
    ctx.fillStyle = '#80cc40';        // active screen glow (green display)
    ctx.fillRect(lx + 8, -16, 5,  3);
    ctx.fillStyle = '#60a020';        // screen data pixels
    ctx.fillRect(lx + 8, -16, 2,  1);
    ctx.fillRect(lx + 11,-14, 2,  1);

    // Left arm — resting at side
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(lx - 6, -16, 2,  8);

    // Head — blocky orc skull, 8×5 px
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(lx - 3, -22, 8,  5);
    // Operator helmet — dark armour cap
    ctx.fillStyle = '#2a2820';
    ctx.fillRect(lx - 3, -22, 8,  2);
    // Visor strip — dark blue tactical visor
    ctx.fillStyle = '#184888';
    ctx.fillRect(lx - 2, -22, 6,  1);
    // Eyes — bright yellow menace
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(lx - 2, -19, 2,  2);
    ctx.fillRect(lx + 2, -19, 2,  2);
    ctx.fillStyle = '#ffff88';        // inner glint pixel
    ctx.fillRect(lx - 2, -19, 1,  1);
    ctx.fillRect(lx + 2, -19, 1,  1);
    // Sneer and tusks
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(lx - 1, -17, 4,  1);
    ctx.fillStyle = '#d8c080';        // ivory tusks
    ctx.fillRect(lx - 1, -16, 1,  2);
    ctx.fillRect(lx + 2, -16, 1,  2);

    // Neon fur plume — rank indicator
    ctx.fillStyle = '#ff44cc';
    ctx.fillRect(lx - 1, -28, 1,  6);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(lx,     -27, 1,  5);
    ctx.fillStyle = '#cc44ff';
    ctx.fillRect(lx + 1, -28, 1,  6);
    ctx.fillStyle = '#ff44cc';
    ctx.fillRect(lx + 2, -26, 1,  4);
    ctx.fillStyle = '#ff88ff';
    ctx.fillRect(lx + 3, -27, 1,  5);

    // ---- RIGHT OPERATOR — standing at roughly x = +74 ----
    const rx = 74;

    // Boots
    ctx.fillStyle = '#1a1006';
    ctx.fillRect(rx - 4, -2, 4, 2);
    ctx.fillRect(rx + 1, -2, 4, 2);
    ctx.fillStyle = '#2e1c0a';
    ctx.fillRect(rx - 4, -2, 4, 1);
    ctx.fillRect(rx + 1, -2, 4, 1);

    // Lower legs
    ctx.fillStyle = '#2a4010';
    ctx.fillRect(rx - 4, -8, 4, 6);
    ctx.fillRect(rx + 1, -8, 4, 6);
    ctx.fillStyle = '#1e3008';
    ctx.fillRect(rx - 1, -8, 1, 6);
    ctx.fillRect(rx + 1, -8, 1, 6);

    // Torso
    ctx.fillStyle = '#283810';
    ctx.fillRect(rx - 5, -18, 9, 10);
    ctx.fillStyle = '#1e2c0a';
    ctx.fillRect(rx - 5, -14, 9,  1);
    ctx.fillStyle = '#384c1a';
    ctx.fillRect(rx - 5, -18, 9,  2);

    // Left forearm — holds a small comms/sensor device
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(rx - 7, -16, 2,  8);
    // Comms device
    ctx.fillStyle = '#4a4030';
    ctx.fillRect(rx - 12, -18, 6,  4);
    ctx.fillStyle = '#c08040';        // amber readout screen
    ctx.fillRect(rx - 11, -17, 4,  2);
    ctx.fillStyle = '#a06030';        // screen data pixel
    ctx.fillRect(rx - 11, -17, 2,  1);

    // Right arm raised — pointing toward the silo (signalling launch)
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(rx + 4, -18, 2,  6);  // upper arm
    ctx.fillRect(rx + 2, -20, 4,  2);  // angled forearm
    ctx.fillRect(rx + 1, -21, 1,  1);  // pointing finger pixel

    // Head
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(rx - 3, -22, 8,  5);
    ctx.fillStyle = '#2a2820';
    ctx.fillRect(rx - 3, -22, 8,  2);
    ctx.fillStyle = '#184888';
    ctx.fillRect(rx - 2, -22, 6,  1);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(rx - 2, -19, 2,  2);
    ctx.fillRect(rx + 2, -19, 2,  2);
    ctx.fillStyle = '#ffff88';
    ctx.fillRect(rx - 2, -19, 1,  1);
    ctx.fillRect(rx + 2, -19, 1,  1);
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(rx - 1, -17, 4,  1);
    ctx.fillStyle = '#d8c080';
    ctx.fillRect(rx - 1, -16, 1,  2);
    ctx.fillRect(rx + 2, -16, 1,  2);

    // Neon fur plume — slightly different colour arrangement from left operator
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(rx - 1, -27, 1,  5);
    ctx.fillStyle = '#cc44ff';
    ctx.fillRect(rx,     -28, 1,  6);
    ctx.fillStyle = '#ff44cc';
    ctx.fillRect(rx + 1, -27, 1,  5);
    ctx.fillStyle = '#ff88ff';
    ctx.fillRect(rx + 2, -26, 1,  4);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(rx + 3, -27, 1,  5);
  }

  // ----------------------------------------------------------------
  // DAMAGE OVERLAYS — drawn on top of the base structure each frame
  // ----------------------------------------------------------------
  _renderDamageOverlays(ctx) {

    // ---- Damage state 2: zigzag crack on rim left section ----
    if (this._crackLeft) {
      ctx.fillStyle = '#0a0806';
      ctx.fillRect(-44, -26, 2, 2);
      ctx.fillRect(-43, -22, 2, 2);
      ctx.fillRect(-44, -19, 2, 2);
      ctx.fillRect(-43, -15, 2, 2);
      ctx.fillRect(-44, -12, 2, 2);
      ctx.fillRect(-43, -10, 2, 2);
    }

    // ---- Damage state 4: scorch marks on concrete collar ----
    if (this._scorchVisible) {
      ctx.fillStyle = '#1e1610';  // dark char
      ctx.fillRect(-30, -5, 12, 4);   // left scorch patch
      ctx.fillRect( 18, -5, 12, 4);   // right scorch patch
      ctx.fillStyle = '#3a2a1a';  // lighter scorch edge
      ctx.fillRect(-29, -5, 10,  1);
      ctx.fillRect( 19, -5, 10,  1);
      // Burnt ore residue — warm orc-orange centre of each scorch
      ctx.fillStyle = '#6a2808';
      ctx.fillRect(-26, -5,  4,  2);
      ctx.fillRect( 22, -5,  4,  2);
    }

    // ---- Damage state 6: crack on rim right section ----
    if (this._crackRight) {
      ctx.fillStyle = '#0a0806';
      ctx.fillRect( 30, -25, 2, 2);
      ctx.fillRect( 31, -21, 2, 2);
      ctx.fillRect( 30, -17, 2, 2);
      ctx.fillRect( 31, -13, 2, 2);
      ctx.fillRect( 30, -10, 2, 2);
    }

    // ---- Damage state 6 (cont.): bent / deformed centre-right armor panel ----
    if (this._panelDamage) {
      // Slightly lighter lifted panel edge — bent metal reveals undersurface
      ctx.fillStyle = '#3a3428';
      ctx.fillRect( 12, -26, 10,  4);
      ctx.fillStyle = '#6a6050';  // bright highlight on bent leading edge
      ctx.fillRect( 12, -26, 10,  1);
      ctx.fillRect( 12, -26,  1,  4);
    }

    // ---- Damage state 8: erratic sparking on damaged conduit lines ----
    // Uses _pulseT with fast irregular thresholds so sparks feel random.
    if (this._conduitDamage) {
      // Left conduit spark — high frequency, irregular
      if (Math.sin(this._pulseT * 19.3) > 0.38) {
        ctx.fillStyle = '#ff80ff';
        ctx.fillRect(-64, -22, 2, 1);
        ctx.fillRect(-63, -23, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-64, -22, 1, 1);
      }
      // Right conduit spark — offset phase so both sides don't fire together
      if (Math.sin(this._pulseT * 23.7 + 1.8) > 0.45) {
        ctx.fillStyle = '#ff80ff';
        ctx.fillRect( 61, -18, 2, 1);
        ctx.fillRect( 62, -17, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect( 62, -18, 1, 1);
      }
    }
  }

  // ----------------------------------------------------------------
  // EXPLOSION ANIMATION — 4-frame sequence
  // ================================================================
  // Frame 1 (0.000–0.033 s): solid white flash over full bounding box
  // Frame 2 (0.033–0.700 s): 22 burst fragments + 14 spark pixels
  // Frame 3 (0.080–1.200 s): 16 gold/yellow 2×2 ore fragments
  // Frame 4 (0.250–2.250 s): 14 smoke rectangles + 7 gold sparks fade
  // ----------------------------------------------------------------
  _renderExplosion(ctx) {
    const t           = this._deathTimer;
    const FLASH_FRAMES = 2 / 60;

    // ---- Frame 1: Bright white flash — 2 render frames ----
    if (t < FLASH_FRAMES) {
      ctx.globalAlpha = 1.0;
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(-70, -40, 140, 50);  // larger than structure — blast expansion
      ctx.globalAlpha = 1.0;
      return;
    }

    // ---- Frame 2: Voidheart burst fragments + spark pixels ----
    if (t < 0.7) {
      const burstAlpha = t < 0.35 ? 1.0 : 1.0 - (t - 0.35) / 0.35;
      ctx.globalAlpha  = Math.max(0, burstAlpha);
      this._burstFragments.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      this._sparkPixels.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
      });
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 3: Gold scatter — ore energy dispersing ----
    if (t >= 0.08 && t < 1.2) {
      const goldAge   = t - 0.08;
      const goldAlpha = goldAge < 0.5 ? 1.0 : 1.0 - (goldAge - 0.5) / 0.62;
      ctx.globalAlpha = Math.max(0, goldAlpha);
      this._goldDebris.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 4: Smoke cloud + lingering gold embers ----
    if (t >= 0.25) {
      const smokeAlpha = Math.max(0, 1.0 - (t - 0.25) / 2.0);
      ctx.globalAlpha  = smokeAlpha;
      this._smokeParticles.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      this._smokeGoldSparks.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
      });
      ctx.globalAlpha = 1.0;
    }
  }

  // ----------------------------------------------------------------
  // MISSILE RENDERING — screen-space; called after ctx.restore()
  //
  // Each missile is drawn centered on its screen position, then rotated
  // to face its current direction of travel:
  //   angle = Math.atan2(velocityY, velocityX) + Math.PI/2
  //   (+PI/2 aligns the sprite's upward tip with the forward direction)
  //
  // Sprite layout (all coords relative to missile centre after transform):
  //   Tip      :  y = −18 … −17  (warhead point)
  //   Warhead  :  y = −17 … −6   (12 px, 14 px wide)
  //   Fuselage :  y = −6  … +12  (18 px, 10 px wide)
  //   Fins     :  y = +6  … +12  ( 6 px, extend to 14 px wide)
  //   Flame    :  y = +12 … +18  ( 6 px — always at the tail)
  //
  // The exhaust flame is always at the tail (positive-y end of the sprite),
  // so it stays visually behind the missile regardless of heading.
  //
  // Voidheart warhead glow pulses brighter as the missile closes on the
  // player — using _lastPlayerWorldX / _lastPlayerY stored during update().
  //
  // Hit flash: when hitFlashTimer > 0, a full-sprite white fillRect is
  // drawn on top (lasts 2 render frames ≈ 2/60 s).
  // ----------------------------------------------------------------
  _renderMissiles(ctx, cameraScrollX) {
    // ---- Missile smoke trail particles — rendered first so they appear behind sprites ----
    // 2×2 px dark-grey puffs that linger in world space after the missile passes.
    // Linear alpha fade over their 0.4 s lifetime.
    if (this._smokeTrailParticles.length > 0) {
      ctx.fillStyle = '#444444';
      this._smokeTrailParticles.forEach(p => {
        ctx.globalAlpha = Math.max(0, 1.0 - p.age / 0.4);
        ctx.fillRect(Math.round(p.worldX - cameraScrollX), Math.round(p.y), 2, 2);
      });
      ctx.globalAlpha = 1.0;
    }

    this._missiles.forEach(m => {
      if (!m.active) return;
      const sx = Math.round(m.worldX - cameraScrollX);
      const sy = Math.round(m.y);

      // Rotation angle: derive from velocity so it always matches actual travel direction.
      // math.atan2(vy, vx) gives the heading angle; +PI/2 rotates the upward-facing
      // sprite so its tip points in the direction of travel.
      const renderAngle = Math.atan2(m.velocityY, m.velocityX);

      // Proximity glow: distance from missile to player drives warhead pulse intensity.
      // Fully dim at ≥350 px; fully bright at 0 px (direct intercept).
      const pdx       = m.worldX - this._lastPlayerWorldX;
      const pdy       = m.y      - this._lastPlayerY;
      const dist      = Math.sqrt(pdx * pdx + pdy * pdy);
      const closeGlow = Math.max(0, 1.0 - dist / 350);
      const warpulse  = closeGlow * (0.5 + 0.5 * Math.abs(Math.sin(m.age * Math.PI * 4)));

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(renderAngle + Math.PI / 2);

      // ---- In-flight flame trail — 3-layer tapered flame, 2-frame flicker ----
      // Drawn before fins/body so the fuselage base paints over the flame root.
      // Flame always trails at local +y (the tail), opposite the warhead tip at −y.
      // Frame alternates each 60fps tick via missile age → slight length variation
      // creates a flicker without being distracting.
      const flameFrame = Math.floor(m.age * 60) % 2;

      // Layer 1 — Outer flame: deep orange #cc4400
      // 6 fillRect slices tapering from 10 px wide at base (y=+12) to 1 px at tip.
      // Full frame: 28 px long (tip at y=+40); short frame: 37 px → omit final slice.
      ctx.fillStyle = '#cc4400';
      ctx.fillRect(-5,  12, 10, 6);   // base slice — 10 px wide
      ctx.fillRect(-4,  18,  8, 5);   // slice 2    —  8 px wide
      ctx.fillRect(-3,  23,  6, 4);   // slice 3    —  6 px wide
      ctx.fillRect(-2,  27,  4, 4);   // slice 4    —  4 px wide
      ctx.fillRect(-1,  31,  2, 3);   // slice 5    —  2 px wide
      if (flameFrame === 0) {
        ctx.fillRect( 0,  34,  1, 6); // tip slice  —  1 px wide (full: y=40)
      } else {
        ctx.fillRect( 0,  34,  1, 3); // tip slice  —  1 px wide (short: y=37)
      }

      // Layer 2 — Mid flame: bright orange #ff6600
      // 5 slices tapering from 7 px wide at base to 1 px at tip.
      // Full frame: 20 px long (tip at y=+32); short frame drops last slice (y=+29).
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(-3,  12,  7, 6);   // base slice — 7 px wide
      ctx.fillRect(-2,  18,  5, 4);   // slice 2    — 5 px wide
      ctx.fillRect(-2,  22,  4, 4);   // slice 3    — 4 px wide
      ctx.fillRect(-1,  26,  2, 3);   // slice 4    — 2 px wide
      if (flameFrame === 0) {
        ctx.fillRect( 0,  29,  1, 3); // tip slice  — 1 px wide (full: y=32)
      } else {
        ctx.fillRect( 0,  29,  1, 1); // tip slice  — 1 px wide (short: y=30)
      }

      // Layer 3 — Inner core: bright yellow-white #ffee44
      // 4 slices tapering from 4 px wide at base to 1 px at tip.
      // Full frame: 14 px long (tip at y=+26); short frame: 12 px (tip at y=+24).
      ctx.fillStyle = '#ffee44';
      ctx.fillRect(-2,  12,  4, 5);   // base slice — 4 px wide
      ctx.fillRect(-1,  17,  3, 4);   // slice 2    — 3 px wide
      ctx.fillRect(-1,  21,  2, 3);   // slice 3    — 2 px wide
      if (flameFrame === 0) {
        ctx.fillRect( 0,  24,  1, 2); // tip slice  — 1 px wide (full: y=26)
      }
      // short frame: omit tip → core ends at y=+24

      // ---- Stabilizer fins — dark metal flanges bracketing the tail ----
      ctx.fillStyle = '#383028';
      ctx.fillRect(-7,  6, 2, 6);     // left fin  (2×6 px)
      ctx.fillRect( 5,  6, 2, 6);     // right fin (2×6 px)

      // ---- Fuselage — dark metal body with panel seam and depth highlight ----
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(-5, -6, 10, 18);   // main body (10×18 px)
      ctx.fillStyle = '#2e2820';
      ctx.fillRect(-5,  3, 10,  1);   // horizontal panel seam (near mid-body)
      ctx.fillStyle = '#6a6050';
      ctx.fillRect(-5, -6,  1, 18);   // left-edge highlight (depth)

      // ---- Orc military glyph — crude paw print on upper fuselage ----
      // Painted by an orc before loading — rough and slightly uneven.
      // Centred at approx (0, 0) in local sprite space, between warhead
      // base (y=−6) and stabiliser fins (y=+6). Rotates with the missile
      // so it always appears on the same side of the body.
      //
      // Base colour: dark green #1a4a00
      // Highlight:   brighter green #2a6a00, offset 1 px to the left (x−1)
      //              — suggests a thick brush stroke with light from the right.
      //
      // Design: wide 4×3 px palm + three 1×2 px finger marks spreading upward.
      //   Palm centre: x=−2…+2, y=0…+3
      //   Left finger : x=−3, y=−2…0  (leftmost, at standard height)
      //   Centre finger: x=−1, y=−3…−1 (tallest, 1 px higher)
      //   Right finger : x=+1, y=−2…0  (rightmost, at standard height)
      ctx.fillStyle = '#1a4a00';
      ctx.fillRect(-2,  0, 4, 3);   // palm block (4×3 px)
      ctx.fillRect(-3, -2, 1, 2);   // left finger   (1×2 px)
      ctx.fillRect(-1, -3, 1, 2);   // centre finger (1×2 px, 1 px higher)
      ctx.fillRect( 1, -2, 1, 2);   // right finger  (1×2 px)
      ctx.fillStyle = '#2a6a00';    // highlight — 1 px left offset
      ctx.fillRect(-3,  0, 4, 3);   // palm highlight
      ctx.fillRect(-4, -2, 1, 2);   // left finger highlight
      ctx.fillRect(-2, -3, 1, 2);   // centre finger highlight
      ctx.fillRect( 0, -2, 1, 2);   // right finger highlight

      // ---- Voidheart side-glow flanges — fuselage-to-warhead bracket ----
      ctx.fillStyle = '#440030';
      ctx.fillRect(-7, -8, 2, 5);     // left flange  (2×5 px)
      ctx.fillRect( 5, -8, 2, 5);     // right flange (2×5 px)

      // ---- Warhead — Voidheart-ore explosive tip (14×12 px total) ----
      ctx.fillStyle = '#880050';
      ctx.fillRect(-7, -13, 14, 7);   // warhead body    (14×7 px)
      ctx.fillStyle = '#aa0060';
      ctx.fillRect(-4, -17,  8, 4);   // narrowing nose  (8×4 px)
      ctx.fillStyle = '#cc20a0';
      ctx.fillRect(-1, -18,  2, 1);   // tip             (2×1 px)

      // ---- Proximity glow overlay — warhead brightens as missile closes in ----
      if (warpulse > 0.05) {
        ctx.globalAlpha = warpulse * 0.65;
        ctx.fillStyle   = '#ff80cc';
        ctx.fillRect(-7, -18, 14, 13); // covers warhead + nose area
        ctx.globalAlpha = 1.0;
      }

      // ---- Hit flash — 2-frame white fill over entire sprite ----
      if (m.hitFlashTimer > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-7, -18, 14, 36); // full sprite bounds: tip to flame bottom
      }

      ctx.restore();
    });

    // ---- Mid-air missile explosions (shot down by player) ----
    // Rendered in screen-space after all missile sprites so they draw on top.
    this._midairExplosions.forEach(ex => {
      const esx   = Math.round(ex.worldX - cameraScrollX);
      const alpha = ex.timer < 0.3 ? 1.0 : Math.max(0, 1.0 - (ex.timer - 0.3) / 0.3);
      ctx.globalAlpha = alpha;

      // Frame 1: bright white flash at the kill point (first 2 render frames)
      if (ex.timer < 2 / 60) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(esx - 12, Math.round(ex.y) - 12, 24, 24);
      }

      // Voidheart burst fragments
      ex.fragments.forEach(f => {
        ctx.fillStyle = f.color;
        ctx.fillRect(Math.round(esx + f.x), Math.round(ex.y + f.y), f.w, f.h);
      });

      // White/yellow sparks
      ex.sparks.forEach(s => {
        ctx.fillStyle = s.color;
        ctx.fillRect(Math.round(esx + s.x), Math.round(ex.y + s.y), 1, 1);
      });

      ctx.globalAlpha = 1.0;
    });
  }
}
