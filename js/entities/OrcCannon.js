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
    this._dying          = false;
    this._dead           = false;
    this._deathTimer     = 0;
    // Three particle arrays populated by _spawnDebris() on death:
    this._burstFragments = []; // frame 2: purplish-red burst chunks
    this._goldDebris     = []; // frame 3: scattering gold/yellow pixels
    this._smokeParticles = []; // frame 4: lingering dark purple smoke

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

    // ---- Frame 2: purplish-red burst — 10 large chunks fly outward ----
    this._burstFragments = [
      { x:  -4, y: -120, w: 14, h:  8, vx: -170, vy: -210, color: '#8a0060' },
      { x:   2, y: -115, w: 10, h: 10, vx:  190, vy: -240, color: '#b01890' },
      { x:  -7, y: -100, w: 16, h:  6, vx: -130, vy: -170, color: '#cc1880' },
      { x:   5, y: -105, w: 12, h:  8, vx:  150, vy: -190, color: '#aa0050' },
      { x:  -2, y: -130, w: 10, h:  6, vx:  -80, vy: -260, color: '#660048' },
      { x:   0, y: -110, w:  8, h: 10, vx:   60, vy: -140, color: '#9a0070' },
      { x:  -5, y:  -95, w: 14, h:  6, vx: -190, vy: -120, color: '#bb1070' },
      { x:   3, y: -125, w:  8, h:  8, vx:  120, vy: -280, color: '#aa0050' },
      { x:   1, y: -118, w: 12, h:  6, vx:  -40, vy: -230, color: '#8a0060' },
      { x:  -3, y: -108, w:  8, h: 10, vx:  230, vy: -150, color: '#cc1880' },
    ];

    // ---- Frame 3: gold debris — 12 small 2×2 and 4×4 px rectangles ----
    // Higher velocity than burst fragments; scatter further outward.
    this._goldDebris = [
      { x: 0, y: -120, w: 4, h: 4, vx: -230, vy: -270, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:  250, vy: -290, color: '#ffb800' },
      { x: 0, y: -120, w: 4, h: 4, vx: -170, vy: -250, color: '#ffff80' },
      { x: 0, y: -120, w: 2, h: 2, vx:  190, vy: -230, color: '#e8c000' },
      { x: 0, y: -120, w: 4, h: 4, vx:  -70, vy: -300, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:   90, vy: -270, color: '#ffff00' },
      { x: 0, y: -120, w: 4, h: 4, vx: -270, vy: -190, color: '#ffb800' },
      { x: 0, y: -120, w: 2, h: 2, vx:  270, vy: -180, color: '#ffd700' },
      { x: 0, y: -120, w: 4, h: 4, vx:  -30, vy: -320, color: '#e8c000' },
      { x: 0, y: -120, w: 2, h: 2, vx:   30, vy: -310, color: '#ffff80' },
      { x: 0, y: -120, w: 4, h: 4, vx: -150, vy: -170, color: '#ffd700' },
      { x: 0, y: -120, w: 2, h: 2, vx:  140, vy: -210, color: '#ffb800' },
    ];

    // ---- Frame 4: dark purple smoke cloud — 8 large chunks drifting up ----
    // No gravity — they float upward and fade over 1.5 s.
    this._smokeParticles = [
      { x: -18, y: -120, w: 12, h: 10, vy: -52, color: '#2a0040' },
      { x:   8, y: -130, w: 10, h: 12, vy: -43, color: '#380850' },
      { x:  -4, y: -140, w: 14, h:  8, vy: -62, color: '#1a0030' },
      { x:  14, y: -110, w:  8, h: 14, vy: -38, color: '#441060' },
      { x: -14, y: -100, w: 10, h: 10, vy: -48, color: '#2a0040' },
      { x:   4, y: -145, w: 12, h:  8, vy: -68, color: '#380850' },
      { x: -22, y: -115, w:  8, h: 12, vy: -33, color: '#1a0030' },
      { x:  18, y: -125, w: 10, h: 10, vy: -58, color: '#441060' },
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
    // BASE — wide dark iron plate, rust-brown edge pixels
    // ----------------------------------------------------------------
    ctx.fillStyle = '#3a3838';
    ctx.fillRect(-28, -11, 56, 9);          // main plate body
    ctx.fillStyle = '#4a2a12';              // rust-brown top edge
    ctx.fillRect(-28, -11, 56, 2);
    ctx.fillStyle = '#5a3a1a';              // lighter rust bottom edge
    ctx.fillRect(-28,  -2, 56, 2);
    ctx.fillStyle = '#222220';              // bolt holes — two dark squares
    ctx.fillRect(-23,  -7,  4, 4);
    ctx.fillRect( 19,  -7,  4, 4);

    // ----------------------------------------------------------------
    // TOWER LEGS — two thin salvaged struts, intentionally uneven heights
    // ----------------------------------------------------------------
    ctx.fillStyle = '#2e2c22';
    ctx.fillRect(-21, -60,  7, 49); // left leg  — 49 px tall (taller)
    ctx.fillRect( 14, -56,  7, 46); // right leg — 46 px tall (shorter = uneven)

    // Horizontal brace — single connecting bar for structural plausibility
    ctx.fillStyle = '#383630';
    ctx.fillRect(-14, -39, 28, 4);

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
    ctx.fillStyle = '#2a2820';           // visible bolt pixels at each corner
    ctx.fillRect(-21 + t, -67, 4, 4);
    ctx.fillRect( 18 + t, -67, 4, 4);
    ctx.fillRect(-21 + t, -63, 4, 4);
    ctx.fillRect( 18 + t, -63, 4, 4);

    // ----------------------------------------------------------------
    // ORC GUNNER — blocky pixel-art figure standing on the platform.
    // All pieces shift with the platform tilt via ox.
    // ----------------------------------------------------------------

    // Lower body / legs
    ctx.fillStyle = '#2e5e12'; // darker orc green for lower half
    ctx.fillRect( -7 + ox, -74, 5, 7); // left leg
    ctx.fillRect(  2 + ox, -74, 5, 7); // right leg

    // Torso
    ctx.fillStyle = '#3a7a18'; // orc green
    ctx.fillRect( -9 + ox, -91, 18, 18);

    // Brass shoulder augment — right shoulder only (asymmetric per spec)
    ctx.fillStyle = '#8a6a20'; // brass
    ctx.fillRect(  7 + ox, -91, 7, 9);
    ctx.fillStyle = '#6a4a10'; // darker brass rivet on augment
    ctx.fillRect(  9 + ox, -95, 4, 4);

    // Head
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect( -7 + ox, -105, 14, 14);

    // Eyes — red-orange, two 4×4 px squares
    ctx.fillStyle = '#ee4400';
    ctx.fillRect( -5 + ox, -100, 4, 4);
    ctx.fillRect(  2 + ox, -100, 4, 4);

    // Neon fur plume on helmet — small plume = basic rank indicator
    // Bright magenta: high-contrast against the dark sky
    ctx.fillStyle = '#ff44ff';
    ctx.fillRect( -4 + ox, -112, 7, 7); // plume base
    ctx.fillRect( -2 + ox, -117, 4, 5); // plume tip

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

    // Darker bore pixel at tip (Visual Style Guide rule 4)
    ctx.fillStyle = '#0e0a06';
    ctx.fillRect( -2 + cx, -149, 4, 4);

    // Crank handle — L-shaped pair of rectangles on the right side
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(  5 + cx, -133,  9, 4); // horizontal arm of L
    ctx.fillRect( 12 + cx, -137,  4, 9); // vertical grip of L

    // ----------------------------------------------------------------
    // VOIDHEART ORE POWER CELL — 8×8 px mounted on right side of cannon.
    //
    // Color scheme by state:
    //   idle/firing : dim-to-bright purplish-red (same formula as before)
    //   windup      : EXTREME contrast — deep maroon (#3c0028) to
    //                 bright white-pink (#ffe8ff) — impossible to miss
    //
    // A 2×2 px outer ring pulses outward during windup in matching colors.
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

    // Outer ring — 2 px wide border around the 8×8 cell, windup only.
    // Draw the ring as a slightly larger filled rect; the cell will cover
    // the center, leaving only the 2 px border visible.
    if (this._state === 'windup') {
      ctx.fillStyle = cellColor;
      ctx.fillRect( 3 + cx, -125, 12, 12); // 12×12 at (3,−125) = 2px margin
    }

    // Power cell body (8×8)
    ctx.fillStyle = cellColor;
    ctx.fillRect( 5 + cx, -123, 8, 8);

    // Bright center highlight — fades in from glow=0.5 to glow=1.0
    if (glow > 0.5) {
      ctx.globalAlpha = (glow - 0.5) * 2.0;
      ctx.fillStyle   = '#ffccff';
      ctx.fillRect( 7 + cx, -121, 4, 4); // 4×4 centered in the 8×8 cell
      ctx.globalAlpha = 1.0;
    }
  }

  // Draws the 4-frame pixel art explosion.
  // ctx is already translated to (screenX, groundY).
  //
  // Frame 1 (0.00–0.12 s): white flash fills the full bounding box
  // Frame 2 (0.00–0.60 s): purplish-red burst chunks fly outward
  // Frame 3 (0.08–1.00 s): gold debris pixels scatter further out
  // Frame 4 (0.25–1.75 s): dark purple smoke drifts upward and fades
  _renderExplosion(ctx) {
    const t = this._deathTimer;

    // ---- Frame 1: Bright white flash ----
    // Fills the full structure bounding box (56×150 px), sharp fast fade.
    if (t < 0.12) {
      ctx.globalAlpha = 1.0 - (t / 0.12);
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(-28, -150, 56, 150);
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 2: Purplish-red burst ----
    // Full alpha until t=0.3 s, then fades out completely by t=0.6 s.
    if (t < 0.6) {
      const burstAlpha = t < 0.3 ? 1.0 : 1.0 - (t - 0.3) / 0.3;
      ctx.globalAlpha  = Math.max(0, burstAlpha);
      this._burstFragments.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
      });
      ctx.globalAlpha = 1.0;
    }

    // ---- Frame 3: Gold debris ----
    // Appears at t=0.08 s (as flash fades), solid until t=0.53 s,
    // then fades completely by t=1.0 s.
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

    // ---- Frame 4: Dark purple smoke cloud ----
    // Appears at t=0.25 s, drifts upward, fades to zero over 1.5 s (gone at t=1.75 s).
    if (t >= 0.25) {
      const smokeAlpha = Math.max(0, 1.0 - (t - 0.25) / 1.5);
      ctx.globalAlpha  = smokeAlpha;
      this._smokeParticles.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
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
