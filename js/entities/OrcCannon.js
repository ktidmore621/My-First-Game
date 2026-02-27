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

   ----------------------------------------------------------------
   HEALTH & DAMAGE STATES
   ----------------------------------------------------------------
   3 hit points (HealthSystem). Progressive visual damage:
     After hit 1: crack zigzag drawn on the left strut
     After hit 2: platform tilts 3 px to the right
     After hit 3: death — 3-frame collapse animation, then gone

   ----------------------------------------------------------------
   WIND-UP STATE MACHINE
   ----------------------------------------------------------------
   States: 'idle' → 'windup' → 'firing' (looping) → 'dead'

   idle    The cannon is dormant. Power cell glows dim.
           Transition: player enters 400 px horizontal range.

   windup  The cannon is charging. Power cell pulses brighter
           over 1.5 seconds — a visible warning to the player.
           If player leaves range before 1.5 s: back to idle.
           After 1.5 s: fire first bolt → firing state.

   firing  Cannon fires one plasma bolt every 3 seconds.
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

    // ---- Health: 3 hit points — destroyed by 3 direct PX-9 hits ----
    this.health    = new HealthSystem(3);
    this._hitCount = 0; // 0→1→2 as hits land; drives progressive damage render

    // ---- Wind-up state machine ----
    this._state        = 'idle';  // 'idle' | 'windup' | 'firing' | 'dead'
    this._windupTimer  = 0;       // accumulates 0→1.5s during windup phase
    this._fireCooldown = 0;       // counts down 3→0s between shots in firing
    this._pulseT       = 0;       // ever-incrementing time for glow oscillation

    // ---- Outgoing plasma bolts — small pool, max 4 in-flight ----
    // Each slot: { active, worldX, y, velocityX, velocityY }
    // worldX and velocityX are world-space; y and velocityY are screen-space.
    this._bolts = Array.from({ length: 4 }, () => ({
      active: false, worldX: 0, y: 0, velocityX: 0, velocityY: 0,
    }));

    // ---- Damage-state rendering flags ----
    this._crackVisible = false; // drawn on left strut after hit 1
    this._platformTilt = 0;    // 3px offset applied to platform + orc + cannon after hit 2

    // ---- Death / collapse animation ----
    this._dying      = false;
    this._dead       = false;
    this._deathTimer = 0;
    this._debris     = []; // populated by _spawnDebris() on death

    // ---- Callback: track hit count for progressive damage visuals ----
    this.health.onDamage(() => {
      this._hitCount++;
      if (this._hitCount >= 1) this._crackVisible = true;
      if (this._hitCount >= 2) this._platformTilt = 3;
    });

    // ---- Callback: trigger collapse animation on death ----
    this.health.onDeath(() => {
      this._state = 'dead';
      this._dying = true;
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
      this._updateCollapse(dt);
      return;
    }

    // ---- Advance in-flight bolts; cull any that have left the play area ----
    this._bolts.forEach(b => {
      if (!b.active) return;
      b.worldX += b.velocityX * dt;
      b.y      += b.velocityY * dt;
      // Deactivate when far above screen top, below screen bottom,
      // or more than 1500 world-px away horizontally (flew past the scene)
      if (b.y < -60 || b.y > 650 || Math.abs(b.worldX - this.worldX) > 1500) {
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
    // idle → windup: player enters range
    // windup → idle: player leaves range before 1.5 s (wind-up resets)
    // windup → firing: 1.5 s elapses, fires first bolt
    // firing → idle: player leaves range (wind-up resets, cell dims)
    // firing → firing: fires bolt every 3 s while in range
    // any → dead: health.onDeath() callback above handles this
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
        if (this._windupTimer >= 1.5) {
          this._fireBolt(playerWorldX, playerY);
          this._state        = 'firing';
          this._fireCooldown = 3.0;
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
          this._fireCooldown = 3.0;
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
    // Cull structures entirely off-screen (structure is ~32px wide, ~90px tall)
    if (screenX < -60 || screenX > 1020) return;

    ctx.save();
    ctx.translate(screenX, this._groundY);

    if (this._dying) {
      this._renderCollapse(ctx);
      ctx.restore();
      return;
    }

    // ---- Power cell glow intensity: 0.0 (dim) → 1.0 (bright pink) ----
    // idle:   very dim — power cell barely lit, slow background flicker
    // windup: pulses 0→1→0→1 over the 1.5 s charge window (two oscillations)
    // firing: bright and fast — 1.4 Hz pulse to signal active danger
    let glow = 0.08 + 0.04 * Math.abs(Math.sin(this._pulseT * 0.5)); // idle flicker
    if (this._state === 'windup') {
      // Two full oscillations across the 1.5 s wind-up window
      glow = 0.25 + 0.75 * Math.abs(Math.sin((this._windupTimer / 1.5) * Math.PI * 2));
    } else if (this._state === 'firing') {
      glow = 0.6 + 0.4 * Math.abs(Math.sin(this._pulseT * Math.PI * 1.4));
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
  getStructureHitbox() {
    return {
      x: this.worldX - 14,   // world-space left edge  (28 px wide)
      y: this._groundY - 86, // screen-space top edge  (86 px tall)
      w: 28,
      h: 86,
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

  // Acquire an inactive bolt slot and launch it toward the target's
  // current position. Shot is NOT tracked — it travels in a straight
  // line to where the player WAS at the moment of firing.
  _fireBolt(targetWorldX, targetY) {
    const b = this._bolts.find(b => !b.active);
    if (!b) return; // all 4 slots in-flight — shot dropped silently

    // Barrel mouth: horizontally centred on the cannon, at the barrel tip
    const tipWorldX = this.worldX;
    const tipY      = this._groundY - 86; // top of the cannon barrel

    // Direction vector from barrel tip to target at time of firing
    const dx   = targetWorldX - tipWorldX;
    const dy   = targetY      - tipY;
    const dist = Math.hypot(dx, dy) || 1; // guard against zero distance

    const SPEED = 300; // world-space px/s

    b.active    = true;
    b.worldX    = tipWorldX;
    b.y         = tipY;
    b.velocityX = (dx / dist) * SPEED;
    b.velocityY = (dy / dist) * SPEED;
  }

  // ================================================================
  // PRIVATE — DEATH ANIMATION
  // ================================================================

  // Pre-generate 8 debris chunks flying outward from the structure.
  // Positions are relative to (screenX, groundY) for the collapse render.
  _spawnDebris() {
    this._debris = [
      { x: -10, y: -20, w: 7, h: 4, vx: -65,  vy: -90,  color: '#4a3a2a' },
      { x:   8, y: -30, w: 4, h: 6, vx:  75,  vy: -105, color: '#3a2a1a' },
      { x:  -5, y: -10, w: 8, h: 3, vx: -42,  vy: -65,  color: '#2a2010' },
      { x:   6, y: -50, w: 4, h: 4, vx:  52,  vy: -125, color: '#5a3a20' },
      { x:  -8, y: -40, w: 5, h: 5, vx: -82,  vy: -95,  color: '#4a3a2a' },
      { x:   0, y: -60, w: 6, h: 3, vx:  28,  vy: -115, color: '#3a2a1a' },
      { x: -12, y: -15, w: 4, h: 4, vx: -105, vy: -72,  color: '#2a2010' },
      { x:  10, y: -25, w: 5, h: 5, vx:  92,  vy: -98,  color: '#5a3a20' },
    ];
  }

  _updateCollapse(dt) {
    this._deathTimer += dt;
    // Arc debris up then fall — each chunk has its own initial velocity
    // with gravity pulling it back down over the 1 second animation
    this._debris.forEach(d => {
      d.x  += d.vx * dt;
      d.y  += d.vy * dt;
      d.vy += 200 * dt; // gravity: 200 px/s² downward
    });
    if (this._deathTimer >= 1.0) {
      this._dead = true; // fully gone — no further update or render
    }
  }

  // ================================================================
  // PRIVATE — RENDERING
  // ================================================================

  // Draws the full cannon structure relative to ctx.translate(screenX, groundY).
  // All coordinates are offsets from that origin — negative Y = upward.
  // glow : 0.0→1.0, drives the Voidheart power cell color
  _renderStructure(ctx, glow) {
    const t  = this._platformTilt; // 0 or 3 — shifts platform/orc/cannon right
    const ox = t;                  // orc X offset (tracks platform)
    const cx = t;                  // cannon X offset (tracks platform)

    // ----------------------------------------------------------------
    // BASE — wide dark iron plate, rust-brown edge pixels (Visual Style
    // Guide: fillRect only, limited earthy palette, no gradients)
    // ----------------------------------------------------------------
    ctx.fillStyle = '#3a3838';
    ctx.fillRect(-16, -6, 32, 5);        // main plate body
    ctx.fillStyle = '#4a2a12';           // rust-brown top edge
    ctx.fillRect(-16, -6, 32, 1);
    ctx.fillStyle = '#5a3a1a';           // lighter rust bottom edge
    ctx.fillRect(-16, -1, 32, 1);
    ctx.fillStyle = '#222220';           // bolt holes — two dark squares
    ctx.fillRect(-13, -4, 2, 2);
    ctx.fillRect( 11, -4, 2, 2);

    // ----------------------------------------------------------------
    // TOWER LEGS — two thin salvaged struts, intentionally uneven heights
    // so the structure feels cobbled together rather than engineered
    // ----------------------------------------------------------------
    ctx.fillStyle = '#2e2c22';
    ctx.fillRect(-12, -34, 4, 28); // left leg  — 28 px tall (taller)
    ctx.fillRect(  8, -32, 4, 26); // right leg — 26 px tall (shorter = uneven)

    // Horizontal brace — single connecting bar for structural plausibility
    ctx.fillStyle = '#383630';
    ctx.fillRect(-8, -22, 16, 2);

    // Damage state 1: 1-pixel zigzag crack on the left strut
    if (this._crackVisible) {
      ctx.fillStyle = '#0e0a06';
      ctx.fillRect(-11, -30, 1, 1);
      ctx.fillRect(-10, -28, 1, 1);
      ctx.fillRect(-11, -26, 1, 1);
      ctx.fillRect(-10, -24, 1, 1);
      ctx.fillRect(-11, -22, 1, 1);
    }

    // ----------------------------------------------------------------
    // PLATFORM — rickety ledge connecting the two legs
    // Damage state 2: shifts 3 px right, simulating a buckled joint
    // ----------------------------------------------------------------
    ctx.fillStyle = '#585850';
    ctx.fillRect(-12 + t, -38, 24, 4);  // platform deck
    ctx.fillStyle = '#2a2820';          // visible bolt pixels at each corner
    ctx.fillRect(-12 + t, -38, 2, 2);
    ctx.fillRect( 10 + t, -38, 2, 2);
    ctx.fillRect(-12 + t, -36, 2, 2);
    ctx.fillRect( 10 + t, -36, 2, 2);

    // ----------------------------------------------------------------
    // ORC GUNNER — blocky pixel-art figure standing on the platform.
    // All pieces shift with the platform tilt via ox.
    // Body readable at small scale: ~10 px wide, ~22 px tall with head.
    // ----------------------------------------------------------------

    // Lower body / legs
    ctx.fillStyle = '#2e5e12'; // darker orc green for lower half
    ctx.fillRect(-4 + ox, -42, 3, 4); // left leg
    ctx.fillRect( 1 + ox, -42, 3, 4); // right leg

    // Torso
    ctx.fillStyle = '#3a7a18'; // orc green
    ctx.fillRect(-5 + ox, -52, 10, 10);

    // Brass shoulder augment — right shoulder only (asymmetric per spec)
    ctx.fillStyle = '#8a6a20'; // brass
    ctx.fillRect( 4 + ox, -52, 4, 5);
    ctx.fillStyle = '#6a4a10'; // darker brass rivet on augment
    ctx.fillRect( 5 + ox, -54, 2, 2);

    // Head
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect(-4 + ox, -60, 8, 8);

    // Eyes — red-orange, two 2×2 px squares
    ctx.fillStyle = '#ee4400';
    ctx.fillRect(-3 + ox, -57, 2, 2);
    ctx.fillRect( 1 + ox, -57, 2, 2);

    // Neon fur plume on helmet — small plume = basic rank indicator
    // Bright magenta: high-contrast against the dark sky
    ctx.fillStyle = '#ff44ff';
    ctx.fillRect(-2 + ox, -64, 4, 4); // plume base
    ctx.fillRect(-1 + ox, -67, 2, 3); // plume tip

    // ----------------------------------------------------------------
    // CANNON — chunky hand-cranked barrel, asymmetric and improvised.
    // Shifts with platform via cx.
    // ----------------------------------------------------------------

    // Cannon body — thick base block mounted behind the barrel
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(-3 + cx, -72, 6, 10);

    // Barrel — 6 px wide, extends 12 px upward
    ctx.fillStyle = '#382a1a';
    ctx.fillRect(-3 + cx, -84, 6, 12);

    // Darker bore pixel at tip (Visual Style Guide rule 4)
    ctx.fillStyle = '#0e0a06';
    ctx.fillRect(-1 + cx, -85, 2, 2);

    // Crank handle — L-shaped pair of rectangles on the right side.
    // Horizontal arm + vertical grip = improvised hand-crank aesthetic.
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect( 3 + cx, -76, 5, 2); // horizontal arm of L
    ctx.fillRect( 7 + cx, -78, 2, 5); // vertical grip of L

    // ----------------------------------------------------------------
    // VOIDHEART ORE POWER CELL — 4×4 px mounted on right side of cannon
    // Purplish-red at rest; brightens toward bright pink as glow → 1.0
    // Color channels tuned so the shift is distinctly visible on screen
    // ----------------------------------------------------------------
    const pr = Math.round(140 + glow * 115); // red:   140 → 255
    const pg = Math.round( 10 + glow *  30); // green:  10 →  40
    const pb = Math.round(120 + glow * 135); // blue:  120 → 255
    ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
    ctx.fillRect(3 + cx, -70, 4, 4);

    // Bright center highlight appears only when the cell is actively glowing
    if (glow > 0.5) {
      ctx.globalAlpha = (glow - 0.5) * 2.0; // fades in from glow=0.5 to glow=1.0
      ctx.fillStyle   = '#ffccff';
      ctx.fillRect(4 + cx, -69, 2, 2);
      ctx.globalAlpha = 1.0;
    }
  }

  // Draws the 3-frame collapse animation.
  // ctx is already translated to (screenX, groundY).
  _renderCollapse(ctx) {
    // Alpha fades 1→0 over the full 1-second animation
    const fade = Math.max(0, 1.0 - this._deathTimer);
    ctx.globalAlpha = fade;
    this._debris.forEach(d => {
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.w, d.h);
    });
    ctx.globalAlpha = 1.0;
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
