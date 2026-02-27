/* ============================================================
   Projectile.js
   ============================================================
   A single pooled projectile for the PX-9 Rapid Plasma Array.

   OBJECT POOLING DESIGN:
   ─────────────────────────────────────────────────────────────
   Firing 8 shots per second creates and destroys many small
   objects rapidly. Repeated allocation triggers the JavaScript
   garbage collector, which can cause visible frame-rate hitches
   mid-game at exactly the wrong moment.

   The fix: allocate a fixed array of Projectile instances ONCE
   at startup (the "pool") inside PilotGameState. Every time a
   shot is fired we scan the pool for an inactive slot, configure
   it, and set active = true. When the projectile leaves the
   screen we set active = false — returning it to the pool for
   the next shot. No new objects are ever created during gameplay.

   PilotGameState manages the pool lifecycle:
     - Creation:       constructor builds 30 Projectile instances
     - Acquisition:    _fireProjectile() finds the first inactive slot
     - Deactivation:   update() resets out-of-bounds projectiles
   ============================================================ */

class Projectile {

  constructor() {
    // Pool control — false = available for reuse, true = currently in flight
    this.active    = false;

    // World-space X position (scrolls with the camera, same coordinate system
    // as _worldX in PilotGameState). Advances by velocityX every frame.
    this.worldX    = 0;

    // Screen-space Y position — the camera does not pan vertically, so Y is
    // always a direct canvas coordinate (0 = top, 540 = bottom).
    // Advances by velocityY every frame.
    this.y         = 0;

    // Velocity in pixels per second.
    // velocityX is world-space (drives worldX); velocityY is screen-space.
    this.velocityX = 0;
    this.velocityY = 0;

    // Damage dealt on impact — set from the plane's weaponSize stat when fired
    this.damage    = 0;

    // The firing ship's color — bolt is drawn in this color so each ship class
    // has visually distinct projectiles (Fighter=blue, Bomber=grey, Scout=green)
    this.color     = '#ffffff';

    // Direction of travel in radians — stored so render() can rotate the bolt
    // without recomputing atan2 every frame
    this._angle    = 0;
  }

  // ----------------------------------------------------------------
  // fire — take this slot from the pool and initialise it for flight
  // Called once per shot by PilotGameState._fireProjectile()
  // ----------------------------------------------------------------
  fire(worldX, y, velocityX, velocityY, damage, color, angle) {
    this.active    = true;
    this.worldX    = worldX;
    this.y         = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.damage    = damage;
    this.color     = color;
    this._angle    = angle;
  }

  // ----------------------------------------------------------------
  // deactivate — return this slot to the pool, ready for reuse
  // ----------------------------------------------------------------
  deactivate() {
    this.active = false;
  }

  // ----------------------------------------------------------------
  // update — advance world-space X and screen-space Y by dt seconds
  // ----------------------------------------------------------------
  update(dt) {
    if (!this.active) return;
    this.worldX += this.velocityX * dt;
    this.y      += this.velocityY * dt;
  }

  // ----------------------------------------------------------------
  // render — draw the plasma bolt at its current screen position
  //
  // Visual spec (Visual Style Guide rule 4 — fillRect only, no curves):
  //   • 10×4 px outer border in a darker shade of the ship's color
  //   • 8×3 px bright core in the ship's color
  //   • 4×1 px white center highlight (pixel-art energy glow, no blur)
  //   • Entire sprite rotated to face the direction of travel
  //
  // cameraX — the world-space X of the screen's left edge, used to
  //   convert worldX → screenX the same way enemies and ground do.
  // ----------------------------------------------------------------
  render(ctx, cameraX) {
    if (!this.active) return;
    ctx.imageSmoothingEnabled = false;

    const screenX = this.worldX - cameraX;

    ctx.save();
    ctx.translate(Math.round(screenX), Math.round(this.y));
    ctx.rotate(this._angle);

    // Outer border — 1px larger than the core on each side, darker shade
    ctx.fillStyle = _darkenProjectileColor(this.color, 0.45);
    ctx.fillRect(-5, -2, 10, 4);

    // Inner bright core — the actual plasma bolt (8×3 pixels)
    ctx.fillStyle = this.color;
    ctx.fillRect(-4, -1, 8, 3);

    // White center highlight — simulates an energy glow without blur or arc()
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, 0, 4, 1);

    ctx.restore();
  }
}

/* ============================================================
   FILE-SCOPED HELPER
   ============================================================ */

// Returns a darkened version of a 6-digit CSS hex color.
// factor = 0 → no change, factor = 1 → full black.
// Used to generate the bolt outline from the ship's body color so
// every projectile's border is a consistent darker shade of its core.
// Only handles 6-digit hex (e.g. '#42a5f5') — all plane colors qualify.
function _darkenProjectileColor(hex, factor) {
  if (!hex || hex.length !== 7 || hex[0] !== '#') return '#222222';
  const r  = parseInt(hex.slice(1, 3), 16);
  const g  = parseInt(hex.slice(3, 5), 16);
  const b  = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '#222222';
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `rgb(${dr},${dg},${db})`;
}
