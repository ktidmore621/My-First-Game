/* ============================================================
   OrcCannon.js
   ============================================================
   An orc anti-aircraft plasma cannon emplacement — the first
   ground enemy in PILOT MODE.

   Visual design: a tall rickety tower of mismatched salvaged
   metal, drawn entirely with fillRect (no arcs, no gradients).
   Layers from bottom to top:
     Base     → wide dark iron plate bolted into the ground
     Legs     → two uneven salvaged struts rising from the base
     Platform → small rickety platform connecting the legs
     Orc      → blocky pixel-art gunner with brass augment
     Cannon   → chunky asymmetric hand-cranked gun barrel
     PowerCell→ Voidheart Ore cell mounted on the cannon body

   All dimensions are scaled 1.75× from the original design grid
   so the structure reads clearly at gameplay distances.

   ----------------------------------------------------------------
   HEALTH & DAMAGE STATES
   ----------------------------------------------------------------
   6 hit points (HealthSystem). Progressive visual damage:
     After hit 2: crack zigzag drawn on the left strut
     After hit 4: platform tilts 3 px to the right
     After hit 6: death — 4-frame pixel art explosion, then gone

   ----------------------------------------------------------------
   WIND-UP STATE MACHINE
   ----------------------------------------------------------------
   States: 'idle' → 'windup' → 'firing' (looping) → 'dead'

   idle    The cannon is dormant. Power cell glows dim.
           Transition: player enters 400 px horizontal range.

   windup  The cannon is charging. Power cell pulses violently
           between deep purplish-red and bright white-pink over
           0.75 seconds — impossible to miss.
           If player leaves range before 0.75 s: back to idle.
           After 0.75 s: fire first bolt → firing state.

   firing  Cannon fires one plasma bolt every 1.5 seconds.
           If player leaves range: back to idle, wind-up resets.

   dead    Death animation running. Bolts still in flight
           continue but the cannon no longer updates or fires.

   ----------------------------------------------------------------
   COLLISION HELPERS (called from PilotGameState each frame)
   ----------------------------------------------------------------
   getStructureHitbox()
     Returns { x, y, w, h } in world-space X, screen-space Y.
     Used by PilotGameState to test player projectile hits.

   checkBoltsHitPlayer(playerWorldX, playerY, hitW, hitH)
     Tests each active bolt against the player's hitbox.
     Returns true on the first hit; deactivates that bolt.
   ============================================================ */

class OrcCannon {

  constructor(worldX, groundY) {
    // World-space X centre of the structure (scrolls with the ground)
    this.worldX    = worldX;
    // Screen-space Y of the ground surface the structure sits on
    this._groundY  = groundY;

    // ---- Health: 6 hit points — destroyed by 6 direct PX-9 hits ----
    this.health    = new HealthSystem(6);
    this._hitCount = 0; // 0→1→…→5 as hits land; drives progressive damage render

    // ---- Wind-up state machine ----
    this._state        = 'idle';  // 'idle' | 'windup' | 'firing' | 'dead'
    this._windupTimer  = 0;       // accumulates 0→0.75s during windup phase
    this._fireCooldown = 0;       // counts down 1.5→0s between shots in firing
    this._pulseT       = 0;       // ever-incrementing time for glow oscillation

    // ---- Outgoing plasma bolts — small pool, max 5 in-flight ----
    // Each slot: { active, worldX, y, originY, velocityX, velocityY }
    // worldX is world-space (static — bolts fire straight up, no X drift).
    // y and velocityY are screen-space; originY records launch Y for culling.
    this._bolts = Array.from({ length: 5 }, () => ({
      active: false, worldX: 0, y: 0, originY: 0, velocityX: 0, velocityY: 0,
    }));

    // ---- Damage-state rendering flags ----
    this._crackVisible = false; // drawn on left strut after hit 2
    this._platformTilt = 0;    // 3px offset applied to platform + orc + cannon after hit 4

    // ---- Death / explosion animation ----
    this._dying           = false;
    this._dead            = false;
    this._deathTimer      = 0;
    // Five particle arrays populated by _spawnDebris() on death:
    this._burstFragments  = []; // frame 2: 12+ mixed-size Voidheart burst chunks
    this._sparkPixels     = []; // frame 2: 8+ fast 1px white/yellow sparks
    this._goldDebris      = []; // frame 3: 2×2 gold/yellow scatter (wider spread)
    this._smokeParticles  = []; // frame 4: dark purple + deep grey smoke rectangles
    this._smokeGoldSparks = []; // frame 4: lingering gold spark pixels in the smoke

    // ---- Callback: track hit count for progressive damage visuals ----
    this.health.onDamage(() => {
      this._hitCount++;
      if (this._hitCount >= 2) this._crackVisible = true;
      if (this._hitCount >= 4) this._platformTilt = 3;
    });

    // ---- Callback: trigger explosion animation on death ----
    this.health.onDeath(() => {
      this._state      = 'dead';
      this._dying      = true;
      this._deathTimer = 0;
      this._spawnDebris();
    });
  }

  // Convenience — PilotGameState skips update/render when this returns false
  isAlive() { return !this._dead; }

  // ================================================================
  // UPDATE — called every frame from PilotGameState.update()
  //
  // playerWorldX : player's current world-space X position
  // playerY      : player's current screen-space Y position
  // ================================================================

  update(dt, playerWorldX, playerY) {
    if (this._dead) return;

    // The pulse timer advances unconditionally — it drives the power cell
    // glow animation in all states, so it must never pause.
    this._pulseT += dt;

    if (this._dying) {
      this._updateExplosion(dt);
      return;
    }

    // ---- Advance in-flight bolts; cull any that have traveled too far ----
    this._bolts.forEach(b => {
      if (!b.active) return;
      b.worldX += b.velocityX * dt;
      b.y      += b.velocityY * dt;
      // Deactivate after 600px of travel from launch point.
      // Bolts fire straight up so only the Y axis needs measuring.
      if (Math.abs(b.y - b.originY) > 600) {
        b.active = false;
      }
    });

    // ---- Detection range: 400 horizontal world-space pixels ----
    // Measured on the X axis only — the cannon fires upward toward whatever
    // Y the player is at, so vertical distance doesn't affect lock-on.
    const inRange = Math.abs(playerWorldX - this.worldX) <= 400;

    // ================================================================
    // STATE MACHINE
    // ================================================================
    // idle    → windup  : player enters range
    // windup  → idle    : player leaves range before 0.75 s (resets)
    // windup  → firing  : 0.75 s elapses, fires first bolt
    // firing  → idle    : player leaves range (wind-up resets, cell dims)
    // firing  → firing  : fires bolt every 1.5 s while in range
    // any     → dead    : health.onDeath() callback above handles this
    // ================================================================

    switch (this._state) {

      case 'idle':
        if (inRange) {
          this._state       = 'windup';
          this._windupTimer = 0;
        }
        break;

      case 'windup':
        // Abort wind-up if player escapes detection range
        if (!inRange) {
          this._state       = 'idle';
          this._windupTimer = 0;
          break;
        }
        this._windupTimer += dt;
        // Full wind-up complete: fire first bolt and begin repeating cycle
        if (this._windupTimer >= 0.75) {
          this._fireBolt(playerWorldX, playerY);
          this._state        = 'firing';
          this._fireCooldown = 1.5;
        }
        break;

      case 'firing':
        // Player escaped — wind-up fully resets, power cell dims
        if (!inRange) {
          this._state        = 'idle';
          this._windupTimer  = 0;
          this._fireCooldown = 0;
          break;
        }
        this._fireCooldown -= dt;
        if (this._fireCooldown <= 0) {
          this._fireBolt(playerWorldX, playerY);
          this._fireCooldown = 1.5;
        }
        break;

      // 'dead' is handled via _dying / _dead above; no switch case needed
    }
  }

  // ================================================================
  // RENDER — called every frame from PilotGameState.render()
  //
  // cameraX : world-space X of the screen's left edge
  // ================================================================

  render(ctx, cameraX) {
    if (this._dead) return;

    const screenX = Math.round(this.worldX - cameraX);
    // Cull structures entirely off-screen (structure is ~56px wide, ~150px tall)
    if (screenX < -80 || screenX > 1040) return;

    ctx.save();
    ctx.translate(screenX, this._groundY);

    if (this._dying) {
      this._renderExplosion(ctx);
      ctx.restore();
      return;
    }

    // ---- Power cell glow intensity ----
    // idle:   very dim — slow background flicker, barely alive
    // windup: full-contrast oscillation 0.0→1.0→0.0→1.0 over 0.75 s —
    //         two violent flashes between deep purplish-red and white-pink
    // firing: bright, fast pulse — signals active danger
    let glow;
    if (this._state === 'windup') {
      // Two full oscillations across the 0.75 s wind-up window
      glow = Math.abs(Math.sin((this._windupTimer / 0.75) * Math.PI * 2));
    } else if (this._state === 'firing') {
      glow = 0.6 + 0.4 * Math.abs(Math.sin(this._pulseT * Math.PI * 1.4));
    } else {
      glow = 0.08 + 0.04 * Math.abs(Math.sin(this._pulseT * 0.5)); // idle flicker
    }

    this._renderStructure(ctx, glow);
    ctx.restore();

    // Enemy bolts render in screen space — after ctx.restore() so they
    // are not affected by the per-structure translate
    this._renderBolts(ctx, cameraX);
  }

  // ================================================================
  // COLLISION HELPERS — called from PilotGameState each frame
  // ================================================================

  // Returns the structure's axis-aligned bounding box.
  // x, w are world-space; y, h are screen-space.
  // PilotGameState uses this to test player projectile hits against the cannon.
  // Dimensions reflect the 1.75× scaled structure (~56 px wide, ~150 px tall).
  getStructureHitbox() {
    return {
      x: this.worldX - 28,   // world-space left edge  (56 px wide)
      y: this._groundY - 150, // screen-space top edge (150 px tall)
      w: 56,
      h: 150,
    };
  }

  // Tests all active bolts against a rectangular player hitbox.
  // The hitbox is deliberately SMALLER than the visual ship size so hits
  // feel fair — bullets that clip the wing don't count.
  // Returns true on the first impact; that bolt is deactivated (consumed).
  //
  // playerWorldX, playerY : centre of player hitbox in world/screen space
  // hitW, hitH            : full width and height of the hitbox
  checkBoltsHitPlayer(playerWorldX, playerY, hitW, hitH) {
    const px = playerWorldX - hitW / 2; // left edge of player hitbox
    const py = playerY      - hitH / 2; // top edge of player hitbox

    for (const b of this._bolts) {
      if (!b.active) continue;
      // Bolt AABB: 6×6 px centred on bolt position
      const bx = b.worldX - 3;
      const by = b.y      - 3;
      if (bx < px + hitW && bx + 6 > px &&
          by < py + hitH && by + 6 > py) {
        b.active = false; // bolt consumed on impact
        return true;
      }
    }
    return false;
  }

  // ================================================================
  // PRIVATE — FIRING
  // ================================================================

  // Acquire an inactive bolt slot and fire it straight upward from the
  // barrel tip. The bolt does not track — it travels at a fixed 300 px/s
  // in the negative-Y direction (upward in screen space), aimed to pass
  // through the player's altitude at the moment of firing.
  _fireBolt(targetWorldX, targetY) { // eslint-disable-line no-unused-vars
    const b = this._bolts.find(b => !b.active);
    if (!b) return; // all 5 slots in-flight — shot dropped silently

    // Barrel mouth: horizontally centred on the cannon, at the bore tip
    const tipWorldX = this.worldX;
    const tipY      = this._groundY - 149; // top of the cannon bore (scaled)

    const SPEED = 300; // world-space px/s — bolt travels straight upward

    b.active    = true;
    b.worldX    = tipWorldX; // fixed in world space — bolt has no X drift
    b.y         = tipY;
    b.originY   = tipY;      // reference point for the 600px travel-distance cull
    b.velocityX = 0;         // no horizontal component — straight up only
    b.velocityY = -SPEED;    // negative Y = upward in screen space
  }

  // ================================================================
  // PRIVATE — DEATH EXPLOSION
  // ================================================================

  // Pre-generate all particle data for the 4-frame explosion.
  // All positions are relative to (screenX, groundY) — i.e. the same
  // coordinate origin used by _renderStructure.
  // Cannon centre for explosion purposes: approx x=0, y=-120 (upper half).
  _spawnDebris() {

    // ---- Frame 2: Voidheart burst — 14 fragments in 2×2, 3×3, and 4×4 sizes ----
    // Colors: deep purplish-red, bright pink, dark brass-gold.
    // Each fragment starts at the cannon centre and flies radially outward.
    this._burstFragments = [
      // 2×2 fragments — fast, light, scatter to the edges
      { x: 0, y: -120, w: 2, h: 2, vx: -220, vy: -280, color: '#6a0040' },
      { x: 0, y: -120, w: 2, h: 2, vx:  240, vy: -260, color: '#ff40cc' },
      { x: 0, y: -120, w: 2, h: 2, vx: -180, vy: -240, color: '#8a6820' },
      { x: 0, y: -120, w: 2, h: 2, vx:  200, vy: -300, color: '#6a0040' },
      // 3×3 fragments — medium weight, mid-range scatter
      { x: 0, y: -120, w: 3, h: 3, vx: -150, vy: -200, color: '#aa0060' },
      { x: 0, y: -120, w: 3, h: 3, vx:  170, vy: -220, color: '#ff40cc' },
      { x: 0, y: -120, w: 3, h: 3, vx:  -80, vy: -260, color: '#7a5818' },
      { x: 0, y: -120, w: 3, h: 3, vx:  100, vy: -180, color: '#aa0060' },
      { x: 0, y: -120, w: 3, h: 3, vx: -250, vy: -130, color: '#cc20a0' },
      { x: 0, y: -120, w: 3, h: 3, vx:   60, vy: -310, color: '#8a6820' },
      // 4×4 fragments — heavier chunks, slower and closer to origin
      { x: 0, y: -120, w: 4, h: 4, vx: -190, vy: -160, color: '#880050' },
      { x: 0, y: -120, w: 4, h: 4, vx:  210, vy: -140, color: '#ff60d0' },
      { x: 0, y: -120, w: 4, h: 4, vx:  -40, vy: -290, color: '#9a7020' },
      { x: 0, y: -120, w: 4, h: 4, vx:  260, vy: -170, color: '#660040' },
    ];

    // ---- Frame 2: spark pixels — 10 single-pixel sparks, faster than fragments ----
    // Bright white and bright yellow; scatter further out due to lighter mass.
    // Some remain visible during the smoke phase as lingering hot embers.
    this._sparkPixels = [
      { x: 0, y: -120, vx: -310, vy: -350, color: '#ffffff' },
      { x: 0, y: -120, vx:  330, vy: -320, color: '#ffff00' },
      { x: 0, y: -120, vx: -280, vy: -380, color: '#ffffff' },
      { x: 0, y: -120, vx:  300, vy: -360, color: '#ffff44' },
      { x: 0, y: -120, vx:  -90, vy: -400, color: '#ffffff' },
      { x: 0, y: -120, vx:  110, vy: -390, color: '#ffff00' },
      { x: 0, y: -120, vx: -350, vy: -200, color: '#ffff44' },
      { x: 0, y: -120, vx:  370, vy: -190, color: '#ffffff' },
      { x: 0, y: -120, vx:  -50, vy: -420, color: '#ffff00' },
      { x: 0, y: -120, vx:  160, vy: -310, color: '#ffffff' },
    ];

    // ---- Frame 3: gold scatter — 12 tiny 2×2 px fragments ----
    // Wider velocity spread than burst: Voidheart Ore energy releasing outward.
    this._goldDebris = [
      { x: 0, y: -120, w: 2, h: 2, vx: -280, vy: -300, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:  300, vy: -320, color: '#ffff44' },
      { x: 0, y: -120, w: 2, h: 2, vx: -230, vy: -350, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:  250, vy: -370, color: '#ffb800' },
      { x: 0, y: -120, w: 2, h: 2, vx: -120, vy: -380, color: '#ffff44' },
      { x: 0, y: -120, w: 2, h: 2, vx:  140, vy: -400, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx: -340, vy: -230, color: '#ffb800' },
      { x: 0, y: -120, w: 2, h: 2, vx:  360, vy: -210, color: '#ffff44' },
      { x: 0, y: -120, w: 2, h: 2, vx:  -30, vy: -420, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:   50, vy: -440, color: '#ffff00' },
      { x: 0, y: -120, w: 2, h: 2, vx: -190, vy: -260, color: '#e8c000' },
      { x: 0, y: -120, w: 2, h: 2, vx:  200, vy: -280, color: '#ffd700' },
    ];

    // ---- Frame 4: smoke linger — 10 dark purple + deep grey rectangles ----
    // Varied sizes; no gravity — rise slowly on thermal heat, fade over 1.5 s.
    this._smokeParticles = [
      { x: -18, y: -120, w: 14, h: 10, vy: -52, color: '#2a0040' },
      { x:   8, y: -130, w: 10, h: 14, vy: -43, color: '#383838' },
      { x:  -4, y: -140, w: 16, h:  8, vy: -62, color: '#1a0030' },
      { x:  14, y: -110, w:  8, h: 16, vy: -38, color: '#441060' },
      { x: -14, y: -100, w: 12, h: 12, vy: -48, color: '#282828' },
      { x:   4, y: -145, w: 14, h:  8, vy: -68, color: '#380850' },
      { x: -22, y: -115, w:  8, h: 14, vy: -33, color: '#1a1a1a' },
      { x:  18, y: -125, w: 12, h: 10, vy: -58, color: '#441060' },
      { x:  -8, y: -135, w: 10, h: 12, vy: -45, color: '#2a0040' },
      { x:  26, y: -108, w:  8, h:  8, vy: -36, color: '#333333' },
    ];

    // ---- Frame 4: lingering gold sparks visible through the smoke ----
    // Slow drift — these are cooling embers still radiating Voidheart energy.
    this._smokeGoldSparks = [
      { x: 0, y: -120, vx:  -80, vy: -180, color: '#ffd700' },
      { x: 0, y: -120, vx:   90, vy: -200, color: '#ffff44' },
      { x: 0, y: -120, vx:  -30, vy: -160, color: '#ffb800' },
      { x: 0, y: -120, vx:   50, vy: -190, color: '#ffd700' },
      { x: 0, y: -120, vx: -110, vy: -140, color: '#ffff00' },
    ];
  }

  _updateExplosion(dt) {
    this._deathTimer += dt;

    // Burst fragments: gravity pulls them back down after arcing upward
    this._burstFragments.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 120 * dt; // gravity: 120 px/s² downward
    });

    // Spark pixels: lighter — less gravity, scatter further and stay up longer
    this._sparkPixels.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 80 * dt; // gravity: 80 px/s² (lighter than fragments)
    });

    // Gold debris: stronger gravity, scatter wide and fast
    this._goldDebris.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 180 * dt; // gravity: 180 px/s² downward
    });

    // Smoke: drifts upward only — no gravity, heat rises
    this._smokeParticles.forEach(d => {
      d.y += d.vy * dt;
    });

    // Smoke gold sparks: slow ember drift with very slight gravity
    this._smokeGoldSparks.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 40 * dt; // gravity: 40 px/s² — still rising through most of smoke phase
    });

    // Smoke (frame 4) finishes fading at t=1.75; fully done at t=2.0
    if (this._deathTimer >= 2.0) {
      this._dead = true;
    }
  }

  // ================================================================
  // PRIVATE — RENDERING
  // ================================================================

  // Draws the full cannon structure relative to ctx.translate(screenX, groundY).
  // All coordinates are offsets from that origin — negative Y = upward.
  // All dimensions are 1.75× the original design grid values.
  // glow : 0.0→1.0, drives the Voidheart power cell color
  _renderStructure(ctx, glow) {
    const t  = this._platformTilt; // 0 or 3 — shifts platform/orc/cannon right
    const ox = t;                  // orc X offset (tracks platform)
    const cx = t;                  // cannon X offset (tracks platform)

    // ----------------------------------------------------------------
    // BASE — wide dark iron plate, worn texture, bolt heads, rust stains
    // ----------------------------------------------------------------
    ctx.fillStyle = '#3a3838';
    ctx.fillRect(-28, -11, 56, 9);          // main plate body

    // Worn texture — alternating 1px rows across the plate middle
    ctx.fillStyle = '#3e3c3a';
    ctx.fillRect(-28, -10, 56, 1);          // slightly lighter row
    ctx.fillStyle = '#363432';
    ctx.fillRect(-28,  -8, 56, 1);          // slightly darker row
    ctx.fillStyle = '#3e3c3a';
    ctx.fillRect(-28,  -6, 56, 1);          // lighter row
    ctx.fillStyle = '#363432';
    ctx.fillRect(-28,  -4, 56, 1);          // darker row

    ctx.fillStyle = '#4a2a12';              // rust-brown top edge
    ctx.fillRect(-28, -11, 56, 2);
    ctx.fillStyle = '#5a3a1a';              // lighter rust bottom edge
    ctx.fillRect(-28,  -2, 56, 2);

    // Rust stains — scattered 1px pixels in rust-brown along both edges
    ctx.fillStyle = '#6b2c0c';
    ctx.fillRect(-27,  -3, 1, 1);
    ctx.fillRect(-20,  -3, 1, 1);
    ctx.fillRect( -9,  -3, 1, 1);
    ctx.fillRect(  5,  -3, 1, 1);
    ctx.fillRect( 18,  -3, 1, 1);
    ctx.fillRect( 25,  -3, 1, 1);
    ctx.fillRect(-26, -11, 1, 1);
    ctx.fillRect(-12, -11, 1, 1);
    ctx.fillRect(  7, -11, 1, 1);
    ctx.fillRect( 22, -11, 1, 1);

    // Existing bolt holes — two recessed dark squares
    ctx.fillStyle = '#222220';
    ctx.fillRect(-23,  -7,  4, 4);
    ctx.fillRect( 19,  -7,  4, 4);

    // Bolt heads at each corner — single bright grey pixel + dark shadow below
    ctx.fillStyle = '#909080';
    ctx.fillRect(-26, -10, 1, 1);           // top-left bolt head
    ctx.fillRect( 25, -10, 1, 1);           // top-right bolt head
    ctx.fillRect(-26,  -4, 1, 1);           // bottom-left bolt head
    ctx.fillRect( 25,  -4, 1, 1);           // bottom-right bolt head
    ctx.fillStyle = '#1e1c1a';
    ctx.fillRect(-26,  -9, 1, 1);           // TL shadow
    ctx.fillRect( 25,  -9, 1, 1);           // TR shadow
    ctx.fillRect(-26,  -3, 1, 1);           // BL shadow
    ctx.fillRect( 25,  -3, 1, 1);           // BR shadow

    // ----------------------------------------------------------------
    // TOWER LEGS — two mismatched salvaged struts; left is wider,
    // right shows more surface damage suggesting different scrap origins
    // ----------------------------------------------------------------
    ctx.fillStyle = '#2e2c22';
    ctx.fillRect(-22, -60,  8, 49); // left leg  — 8px wide (wider salvage piece)
    ctx.fillRect( 14, -56,  7, 46); // right leg — 7px wide, 46 px tall

    // Horizontal brace — single connecting bar for structural plausibility
    ctx.fillStyle = '#383630';
    ctx.fillRect(-14, -39, 28, 4);

    // Diagonal cross braces — rust-orange X between the legs suggesting
    // structural reinforcement bolted in after original construction
    ctx.fillStyle = '#b05818';
    for (let i = 0; i <= 26; i++) {
      ctx.fillRect(-13 + i, Math.round(-54 + i * 40 / 26), 1, 1); // \ diagonal
      ctx.fillRect(-13 + i, Math.round(-14 - i * 40 / 26), 1, 1); // / diagonal
    }

    // Panel seams — 1px vertical line dividing each strut into sections
    ctx.fillStyle = '#3e3c2e';                  // slightly lighter than leg body
    ctx.fillRect(-18, -60, 1, 49);              // left leg seam (centre column)
    ctx.fillRect( 17, -56, 1, 46);              // right leg seam (centre column)

    // Rivets — bright pixel + dark shadow pixel at regular intervals
    ctx.fillStyle = '#a09080';
    ctx.fillRect(-21, -55, 1, 1);               // left leg rivet 1
    ctx.fillRect(-21, -45, 1, 1);               // left leg rivet 2
    ctx.fillRect(-21, -35, 1, 1);               // left leg rivet 3
    ctx.fillRect(-21, -25, 1, 1);               // left leg rivet 4
    ctx.fillRect(-21, -15, 1, 1);               // left leg rivet 5
    ctx.fillRect( 20, -51, 1, 1);               // right leg rivet 1
    ctx.fillRect( 20, -41, 1, 1);               // right leg rivet 2
    ctx.fillRect( 20, -31, 1, 1);               // right leg rivet 3
    ctx.fillRect( 20, -21, 1, 1);               // right leg rivet 4
    ctx.fillStyle = '#181612';
    ctx.fillRect(-21, -54, 1, 1);               // left leg rivet shadow 1
    ctx.fillRect(-21, -44, 1, 1);               // left leg rivet shadow 2
    ctx.fillRect(-21, -34, 1, 1);               // left leg rivet shadow 3
    ctx.fillRect(-21, -24, 1, 1);               // left leg rivet shadow 4
    ctx.fillRect(-21, -14, 1, 1);               // left leg rivet shadow 5
    ctx.fillRect( 20, -50, 1, 1);               // right leg rivet shadow 1
    ctx.fillRect( 20, -40, 1, 1);               // right leg rivet shadow 2
    ctx.fillRect( 20, -30, 1, 1);               // right leg rivet shadow 3
    ctx.fillRect( 20, -20, 1, 1);               // right leg rivet shadow 4

    // Right leg surface damage — dark impact marks + rust bleed suggesting
    // heavier battlefield wear than the left leg
    ctx.fillStyle = '#1a180c';
    ctx.fillRect( 15, -49, 2, 1);               // impact mark
    ctx.fillRect( 16, -38, 2, 1);               // impact mark
    ctx.fillRect( 15, -27, 3, 1);               // impact mark (wider)
    ctx.fillStyle = '#5a3010';
    ctx.fillRect( 14, -50, 1, 1);               // rust bleed at impact
    ctx.fillRect( 17, -39, 1, 1);               // rust bleed at impact

    // Damage state 2: 2×2 px zigzag crack on the left strut
    if (this._crackVisible) {
      ctx.fillStyle = '#0e0a06';
      ctx.fillRect(-19, -53, 2, 2);
      ctx.fillRect(-18, -49, 2, 2);
      ctx.fillRect(-19, -46, 2, 2);
      ctx.fillRect(-18, -42, 2, 2);
      ctx.fillRect(-19, -39, 2, 2);
    }

    // ----------------------------------------------------------------
    // PLATFORM — rickety ledge connecting the two legs
    // Damage state 4: shifts 3 px right, simulating a buckled joint
    // ----------------------------------------------------------------
    ctx.fillStyle = '#585850';
    ctx.fillRect(-21 + t, -67, 42, 7);  // platform deck

    // Panel / plank lines — 1px horizontal seams in alternating tones
    ctx.fillStyle = '#474740';           // darker plank seam
    ctx.fillRect(-21 + t, -65, 42, 1);
    ctx.fillStyle = '#626258';           // lighter plank seam
    ctx.fillRect(-21 + t, -63, 42, 1);

    // Front lip edge — 1px brighter line along the bottom face suggesting
    // a metal rim that keeps the platform from flexing outward
    ctx.fillStyle = '#727062';
    ctx.fillRect(-21 + t, -61, 42, 1);

    // Corner bolt recesses — 3×3 dark squares at each corner
    ctx.fillStyle = '#2a2820';
    ctx.fillRect(-21 + t, -67, 3, 3);   // top-left
    ctx.fillRect( 18 + t, -67, 3, 3);   // top-right
    ctx.fillRect(-21 + t, -63, 3, 3);   // bottom-left
    ctx.fillRect( 18 + t, -63, 3, 3);   // bottom-right

    // Bolt heads — bright pixel + dark shadow at each corner and midpoint
    ctx.fillStyle = '#a09888';
    ctx.fillRect(-20 + t, -66, 1, 1);   // top-left bolt head
    ctx.fillRect( 19 + t, -66, 1, 1);   // top-right bolt head
    ctx.fillRect(-20 + t, -62, 1, 1);   // bottom-left bolt head
    ctx.fillRect( 19 + t, -62, 1, 1);   // bottom-right bolt head
    ctx.fillRect(  0 + t, -66, 1, 1);   // top-centre bolt head
    ctx.fillRect(  0 + t, -62, 1, 1);   // bottom-centre bolt head
    ctx.fillStyle = '#1a1810';
    ctx.fillRect(-20 + t, -65, 1, 1);   // TL shadow
    ctx.fillRect( 19 + t, -65, 1, 1);   // TR shadow
    ctx.fillRect(-20 + t, -61, 1, 1);   // BL shadow
    ctx.fillRect( 19 + t, -61, 1, 1);   // BR shadow
    ctx.fillRect(  0 + t, -65, 1, 1);   // TC shadow
    ctx.fillRect(  0 + t, -61, 1, 1);   // BC shadow

    // ----------------------------------------------------------------
    // ORC GUNNER — detailed 20×28 px pixel-art figure.
    // Stands on platform top (y=−67). Neon plume extends a further
    // 8 px upward; forearms reach up alongside the cannon barrel
    // to crank level. All pieces shift with platform tilt via ox.
    //
    // X span (body): ox−8 to ox+11   (~20 px)
    // Y span (body): −95 to −67      (28 px)
    // Y span (plume): −103 to −95    (+8 px extra)
    // Y span (arms):  up to −122     (alongside barrel)
    // ----------------------------------------------------------------

    // Boots — dark leather soles, 2 px tall × 4 px wide each
    ctx.fillStyle = '#1e1208';
    ctx.fillRect(-5 + ox, -69, 4, 2);   // left boot
    ctx.fillRect( 2 + ox, -69, 4, 2);   // right boot
    ctx.fillStyle = '#3a2010';           // toe-cap highlight (lighter edge)
    ctx.fillRect(-5 + ox, -69, 4, 1);
    ctx.fillRect( 2 + ox, -69, 4, 1);

    // Lower legs — dark-green pants, 5 px tall
    ctx.fillStyle = '#2e5e12';
    ctx.fillRect(-5 + ox, -74, 4, 5);   // left leg
    ctx.fillRect( 2 + ox, -74, 4, 5);   // right leg
    ctx.fillStyle = '#1e4008';           // inner-edge shadow for depth between legs
    ctx.fillRect(-2 + ox, -74, 1, 5);   // right shadow edge of left leg
    ctx.fillRect( 2 + ox, -74, 1, 5);   // left shadow edge of right leg

    // Torso — dark leather / metal-panel armour, 13 px wide × 14 px tall
    ctx.fillStyle = '#2a2018';           // dark charcoal-brown
    ctx.fillRect(-6 + ox, -88, 13, 14);
    // Top-face highlight — shows chest-plate thickness
    ctx.fillStyle = '#3a3020';
    ctx.fillRect(-6 + ox, -88, 13, 2);
    // Horizontal chest panel division lines (1 px each)
    ctx.fillStyle = '#1a1408';
    ctx.fillRect(-6 + ox, -83, 13, 1);  // upper chest seam
    ctx.fillRect(-6 + ox, -79, 13, 1);  // lower chest seam
    // Centre vertical seam — armour plate groove
    ctx.fillRect( 0 + ox, -88, 1, 14);

    // Left shoulder — bare green skin with visible muscle highlight
    ctx.fillStyle = '#4a9420';           // rich mid-green orc skin
    ctx.fillRect(-8 + ox, -88, 2, 11);  // upper-arm column
    ctx.fillStyle = '#6ab830';           // bright green muscle highlight (1 px strip)
    ctx.fillRect(-8 + ox, -85, 1, 4);   // outer-face highlight
    ctx.fillStyle = '#3a7a18';           // shadow where skin meets armour
    ctx.fillRect(-7 + ox, -88, 1, 11);  // inner shadow column

    // Right shoulder — brass mechanical augment, 5 px wide × 14 px tall
    ctx.fillStyle = '#7a5a18';           // base brass colour
    ctx.fillRect( 7 + ox, -91, 5, 14);  // augment block (taller than torso)
    // 1 px panel detail lines
    ctx.fillStyle = '#5a4010';
    ctx.fillRect( 7 + ox, -87, 5, 1);   // upper horizontal panel line
    ctx.fillRect( 7 + ox, -83, 5, 1);   // lower horizontal panel line
    ctx.fillRect( 9 + ox, -91, 1, 14);  // vertical panel divider
    // Bright 1 px highlight edge — polished metal facing the viewer
    ctx.fillStyle = '#c4a040';
    ctx.fillRect(11 + ox, -91, 1, 14);  // right face bright edge
    ctx.fillRect( 7 + ox, -91, 5, 1);   // top face bright edge
    // Raised centre panel detail
    ctx.fillStyle = '#9a7820';
    ctx.fillRect( 8 + ox, -90, 2, 5);

    // Head — blocky orc skull, 10 px wide × 7 px tall
    ctx.fillStyle = '#4a9420';           // rich mid-green orc skin
    ctx.fillRect(-5 + ox, -95, 10, 7);
    // Right-side shadow column (1 px darker green) — depth / jaw shadow
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect( 4 + ox, -95, 1, 7);
    // Helmet rim — top 2 rows recoloured as dark armour material
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(-5 + ox, -95, 10, 2);
    // Helmet brass rivets — 1 px at each side of the rim
    ctx.fillStyle = '#8a6a20';
    ctx.fillRect(-5 + ox, -94, 1, 1);   // left rivet
    ctx.fillRect( 3 + ox, -94, 1, 1);   // right rivet

    // Eyes — 2×2 px bright yellow, menacing
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(-3 + ox, -92, 2, 2);   // left eye
    ctx.fillRect( 1 + ox, -92, 2, 2);   // right eye
    // Inner highlight glint (top-left pixel of each eye)
    ctx.fillStyle = '#ffff88';
    ctx.fillRect(-3 + ox, -92, 1, 1);
    ctx.fillRect( 1 + ox, -92, 1, 1);

    // Mouth — 1 px dark sneer line across middle of lower face
    ctx.fillStyle = '#1a0a00';
    ctx.fillRect(-3 + ox, -90, 5, 1);   // orc sneer
    // Tusks — 1 px wide ivory pixels, 2 px extending down at each corner
    ctx.fillStyle = '#e8d090';           // ivory
    ctx.fillRect(-3 + ox, -89, 1, 2);   // left tusk
    ctx.fillRect( 2 + ox, -89, 1, 2);   // right tusk

    // Neon fur plume — individual 1 px wide strands at varied heights
    // Heights differ by 1–2 px for organic, non-blocky silhouette
    ctx.fillStyle = '#ff44cc';           // bright pink
    ctx.fillRect(-3 + ox, -103, 1, 8);  // strand 1 — tallest (8 px)
    ctx.fillStyle = '#ff00ff';           // hot magenta
    ctx.fillRect(-2 + ox, -101, 1, 6);  // strand 2 (6 px)
    ctx.fillStyle = '#cc44ff';           // pale purple
    ctx.fillRect(-1 + ox, -102, 1, 7);  // strand 3 (7 px)
    ctx.fillStyle = '#ff44cc';           // bright pink
    ctx.fillRect( 0 + ox, -103, 1, 8);  // strand 4 — tallest (8 px)
    ctx.fillStyle = '#ff88ff';           // light pink
    ctx.fillRect( 1 + ox, -100, 1, 5);  // strand 5 — shortest (5 px)
    ctx.fillStyle = '#ff00ff';           // hot magenta
    ctx.fillRect( 2 + ox, -102, 1, 7);  // strand 6 (7 px)
    ctx.fillStyle = '#cc44ff';           // pale purple
    ctx.fillRect( 3 + ox, -101, 1, 6);  // strand 7 (6 px)

    // Forearms gripping the crank handle.
    // Both arms extend up outside the cannon barrel so they read clearly
    // against the structure. Cannon barrel covers the gap between head
    // and fist naturally since it is drawn on top.

    // Left forearm — bare green skin, left of barrel
    ctx.fillStyle = '#4a9420';           // orc skin
    ctx.fillRect(-8 + ox, -122, 2, 34); // shaft from shoulder (y=−88) to fist top
    // Knuckle pixels — 1 px bright green highlights on left fist
    ctx.fillStyle = '#6ab830';
    ctx.fillRect(-8 + ox, -122, 2, 1);  // top knuckle row
    ctx.fillRect(-7 + ox, -121, 1, 1);  // secondary knuckle pixel

    // Right forearm — brass-augmented arm, right of barrel, reaching to crank
    ctx.fillStyle = '#7a5a18';           // brass/metal
    ctx.fillRect( 8 + ox, -124, 3, 36); // shaft from shoulder (y=−88) to fist top
    // Horizontal fist section extending right toward the crank grip
    ctx.fillRect( 8 + ox, -124, 5, 3);  // fist/hand wrapping over crank arm
    // Knuckle highlight on right fist — polished metal augment
    ctx.fillStyle = '#c4a040';
    ctx.fillRect( 8 + ox, -124, 5, 1);  // bright top-of-fist edge
    ctx.fillRect(12 + ox, -124, 1, 3);  // right grip highlight

    // ----------------------------------------------------------------
    // CANNON — chunky hand-cranked barrel, asymmetric and improvised.
    // Shifts with platform via cx.
    // ----------------------------------------------------------------

    // Cannon body — thick base block mounted behind the barrel
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect( -5 + cx, -126, 11, 18);

    // Barrel — 11 px wide, extends 21 px upward
    ctx.fillStyle = '#382a1a';
    ctx.fillRect( -5 + cx, -147, 11, 21);

    // ---- Cooling vents along barrel left side ----
    // Five 1px dark slots; a bright highlight pixel sits above each
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(-5 + cx, -143, 1, 1);
    ctx.fillRect(-5 + cx, -139, 1, 1);
    ctx.fillRect(-5 + cx, -135, 1, 1);
    ctx.fillRect(-5 + cx, -131, 1, 1);
    ctx.fillRect(-5 + cx, -127, 1, 1);
    ctx.fillStyle = '#6a5840';              // bright highlight above each slot
    ctx.fillRect(-5 + cx, -144, 1, 1);
    ctx.fillRect(-5 + cx, -140, 1, 1);
    ctx.fillRect(-5 + cx, -136, 1, 1);
    ctx.fillRect(-5 + cx, -132, 1, 1);
    ctx.fillRect(-5 + cx, -128, 1, 1);

    // ---- Barrel bore at tip — 2px dark outer ring, 1px bright center ----
    ctx.fillStyle = '#0a0806';              // very dark outer ring (2px border)
    ctx.fillRect(-2 + cx, -149, 4, 4);
    ctx.fillStyle = '#2a2018';              // medium dark inner area
    ctx.fillRect(-1 + cx, -148, 2, 2);
    ctx.fillStyle = '#585040';              // faint glint at bore centre
    ctx.fillRect(  0 + cx, -148, 1, 1);

    // ---- Weld lines where barrel meets mounting ----
    // Alternating bright/lighter 1px pixels suggest fresh tack welds
    ctx.fillStyle = '#c8b080';
    ctx.fillRect(-4 + cx, -126, 1, 1);
    ctx.fillRect(-2 + cx, -126, 1, 1);
    ctx.fillRect( 0 + cx, -126, 1, 1);
    ctx.fillRect( 2 + cx, -126, 1, 1);
    ctx.fillRect( 4 + cx, -126, 1, 1);
    ctx.fillStyle = '#e0c890';              // brighter accent welds between above
    ctx.fillRect(-3 + cx, -126, 1, 1);
    ctx.fillRect( 1 + cx, -126, 1, 1);
    ctx.fillRect( 3 + cx, -126, 1, 1);

    // ---- Orc glyph / scratch marks on barrel right side ----
    // A few 1px angular lines — the crew has marked their weapon
    ctx.fillStyle = '#6a5840';
    ctx.fillRect( 3 + cx, -142, 1, 5);     // vertical stroke
    ctx.fillRect( 2 + cx, -142, 2, 1);     // top horizontal tick
    ctx.fillRect( 2 + cx, -139, 2, 1);     // mid horizontal tick
    ctx.fillRect( 3 + cx, -136, 2, 1);     // angled bottom stroke (offset right)

    // ---- Ammunition feed — makeshift angled pipe on the left side ----
    // Three fillRect pieces suggest a crude reload mechanism bolted on
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(-9 + cx, -120, 5, 3);     // stub connecting to cannon body
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(-12 + cx, -118, 4, 2);    // angled elbow going down-left
    ctx.fillRect(-14 + cx, -116, 3, 2);    // further down-left segment
    ctx.fillStyle = '#2a1a0e';
    ctx.fillRect(-14 + cx, -115, 2, 3);    // pipe end cap
    ctx.fillStyle = '#6a5840';
    ctx.fillRect(-9 + cx, -120, 5, 1);     // top-face highlight (tube illusion)

    // Crank handle — L-shaped pair of rectangles on the right side
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(  5 + cx, -133,  9, 4); // horizontal arm of L
    ctx.fillRect( 12 + cx, -137,  4, 9); // vertical grip of L

    // ---- Crank grip texture — alternating 2px dark and lighter wrap bands ----
    ctx.fillStyle = '#3a2a1a';              // dark grip band
    ctx.fillRect( 12 + cx, -137, 4, 2);
    ctx.fillRect( 12 + cx, -133, 4, 2);
    ctx.fillRect( 12 + cx, -129, 4, 1);    // final partial band
    ctx.fillStyle = '#6a5848';              // lighter grip band
    ctx.fillRect( 12 + cx, -135, 4, 2);
    ctx.fillRect( 12 + cx, -131, 4, 2);

    // ----------------------------------------------------------------
    // VOIDHEART ORE POWER CELL — 10×10 px mounted on right side of cannon.
    // Layout: 2px dark border surrounding a 6×6 bright inner core.
    //
    // Color scheme:
    //   idle    : dim dark purplish-red — barely alive
    //   firing  : bright pulsing purplish-red/pink — active danger
    //   windup  : high-contrast deep maroon → white-pink flashes
    //
    // Wind-up: three concentric 1px rings expand outward in progressively
    // brighter pink, alpha driven by glow. White flash for 2 frames at
    // the instant just before the first shot fires.
    // ----------------------------------------------------------------
    let pr, pg, pb;
    if (this._state === 'windup') {
      // High-contrast windup palette: deep purplish-red → bright white-pink
      pr = Math.round( 60 + glow * 195); // 60  → 255
      pg = Math.round(  0 + glow * 200); //  0  → 200
      pb = Math.round( 40 + glow * 215); // 40  → 255
    } else {
      // idle / firing: subdued purplish-red range
      pr = Math.round(140 + glow * 115); // 140 → 255
      pg = Math.round( 10 + glow *  30); //  10 →  40
      pb = Math.round(120 + glow * 135); // 120 → 255
    }
    const cellColor = `rgb(${pr},${pg},${pb})`;

    // ---- Three-ring windup pulse ----
    // Concentric 1px rings drawn outside the cell; outermost is brightest.
    // Cell occupies (5+cx, -124, 10, 10). Ring offsets are 1/2/3 px out.
    if (this._state === 'windup') {
      // Ring 1 — 1px outside cell, dim purplish-pink
      ctx.globalAlpha = glow;
      ctx.fillStyle = '#8830a0';
      ctx.fillRect( 4 + cx, -125, 12,  1); // top
      ctx.fillRect( 4 + cx, -114, 12,  1); // bottom
      ctx.fillRect( 4 + cx, -124,  1, 10); // left
      ctx.fillRect(15 + cx, -124,  1, 10); // right
      // Ring 2 — 2px outside cell, medium pink
      ctx.globalAlpha = glow * 0.9;
      ctx.fillStyle = '#c82890';
      ctx.fillRect( 3 + cx, -126, 14,  1); // top
      ctx.fillRect( 3 + cx, -113, 14,  1); // bottom
      ctx.fillRect( 3 + cx, -125,  1, 12); // left
      ctx.fillRect(16 + cx, -125,  1, 12); // right
      // Ring 3 — 3px outside cell, brightest pink
      ctx.globalAlpha = glow * 0.8;
      ctx.fillStyle = '#ff60c0';
      ctx.fillRect( 2 + cx, -127, 16,  1); // top
      ctx.fillRect( 2 + cx, -112, 16,  1); // bottom
      ctx.fillRect( 2 + cx, -126,  1, 14); // left
      ctx.fillRect(17 + cx, -126,  1, 14); // right
      ctx.globalAlpha = 1.0;
    }

    // Cell 2px dark border background
    ctx.fillStyle = '#1a0820';
    ctx.fillRect( 5 + cx, -124, 10, 10);

    // Inner 6×6 bright core — carries the glow colour
    ctx.fillStyle = cellColor;
    ctx.fillRect( 7 + cx, -122, 6, 6);

    // ---- Circuit line details — 1px L-shaped traces from two corners ----
    ctx.fillStyle = '#9040b0';
    // Top-right corner: horizontal right then vertical up
    ctx.fillRect(15 + cx, -124, 2, 1);
    ctx.fillRect(16 + cx, -127, 1, 4);
    // Bottom-left corner: horizontal left then vertical down
    ctx.fillRect( 3 + cx, -115, 2, 1);
    ctx.fillRect( 3 + cx, -115, 1, 3);

    // Bright core sparkle — fades in from glow=0.5 to glow=1.0
    if (glow > 0.5) {
      ctx.globalAlpha = (glow - 0.5) * 2.0;
      ctx.fillStyle   = '#ffccff';
      ctx.fillRect( 8 + cx, -121, 4, 4); // bright spot centred in 6×6 core
      ctx.globalAlpha = 1.0;
    }

    // ---- Two-frame white flash just before windup completes ----
    // The power cell flares white at ≈0.717 s, signalling imminent fire
    if (this._state === 'windup' && this._windupTimer >= 0.75 - (2 / 60)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect( 5 + cx, -124, 10, 10);
    }
  }

  // Draws the 4-frame pixel art explosion.
  // ctx is already translated to (screenX, groundY).
  //
  // Frame 1 (0.000–0.033 s / 2 frames): solid white flash, full bounding box
  // Frame 2 (0.000–0.600 s): 14 Voidheart burst fragments + 10 spark pixels
  // Frame 3 (0.080–1.000 s): 12 gold/yellow 2×2 fragments scatter wider
  // Frame 4 (0.250–1.750 s): 10 smoke rectangles + 5 gold sparks, fade over 1.5 s
  _renderExplosion(ctx) {
    const t           = this._deathTimer;
    const FLASH_FRAMES = 2 / 60; // exactly 2 render frames at 60 fps ≈ 0.033 s

    // ---- Frame 1: Bright white flash ----
    // Solid white for exactly 2 frames — no fade, hard cut-off.
    if (t < FLASH_FRAMES) {
      ctx.globalAlpha = 1.0;
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(-28, -150, 56, 150); // full cannon bounding box
      ctx.globalAlpha = 1.0;
      return; // white covers everything; skip remaining frames this pass
    }

    // ---- Frame 2: Voidheart burst fragments + spark pixels ----
    // Fragments: full alpha until t=0.3 s, then fade out by t=0.6 s.
    // Sparks render at the same alpha alongside fragments.
    if (t < 0.6) {
      const burstAlpha = t < 0.3 ? 1.0 : 1.0 - (t - 0.3) / 0.3;
      ctx.globalAlpha  = Math.max(0, burstAlpha);
      this._burstFragments.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      // Spark pixels scattered among the debris — 1×1 each
      this._sparkPixels.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
      });
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 3: Gold scatter ----
    // Appears as flash clears (t=0.08 s), solid until t=0.53 s,
    // then fades completely by t=1.0 s — Voidheart Ore energy dispersing.
    if (t >= 0.08 && t < 1.0) {
      const goldAge   = t - 0.08;
      const goldAlpha = goldAge < 0.45 ? 1.0 : 1.0 - (goldAge - 0.45) / 0.47;
      ctx.globalAlpha = Math.max(0, goldAlpha);
      this._goldDebris.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 4: Smoke cloud + lingering gold sparks ----
    // Appears at t=0.25 s; fades to zero over 1.5 s (fully gone at t=1.75 s).
    if (t >= 0.25) {
      const smokeAlpha = Math.max(0, 1.0 - (t - 0.25) / 1.5);
      ctx.globalAlpha  = smokeAlpha;
      this._smokeParticles.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      // A few gold spark pixels still hot in the cooling smoke column
      this._smokeGoldSparks.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
      });
      ctx.globalAlpha = 1.0;
    }
  }

  // Draws all active plasma bolts in screen space.
  // Called after ctx.restore() so bolts are not affected by the
  // per-structure translate used by _renderStructure.
  _renderBolts(ctx, cameraX) {
    this._bolts.forEach(b => {
      if (!b.active) return;
      const sx = Math.round(b.worldX - cameraX);
      const sy = Math.round(b.y);

      // 6×6 px purplish-red outer bolt — visually distinct from IPDF plasma
      ctx.fillStyle = '#b01490';
      ctx.fillRect(sx - 3, sy - 3, 6, 6);

      // 2×2 px bright pink center — instantly readable as enemy fire
      ctx.fillStyle = '#ff80ff';
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    });
  }
}
