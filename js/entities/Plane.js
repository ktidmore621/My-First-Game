/* ============================================================
   Plane.js
   ============================================================
   Represents a PLAYER PLANE with all its attributes and a
   placeholder visual. This object holds data — game states
   (like PilotGameState) use this data to move and draw the plane.

   THE FOUR CORE STATS (all 0–100 unless noted):
   ┌──────────────────┬────────────────────────────────────────┐
   │ speed            │ How fast the plane moves across screen  │
   │ durability       │ Max health points                       │
   │ weaponSize       │ Power/range of equipped weapons         │
   │ maneuverability  │ How quickly it responds to stick input  │
   └──────────────────┴────────────────────────────────────────┘

   FUTURE ADDITIONS (when building out gameplay):
     - Equipped weapon list
     - Fuel system
     - Altitude (for 3D flight feel)
     - Shield / armor layer
     - Afterburner / boost cooldown
   ============================================================ */

class Plane {

  constructor(config = {}) {

    // --- Identity ---
    this.id   = config.id   || 'unknown';
    this.name = config.name || 'Unknown Plane';

    // --- Core Stats ---
    // Default to 50 (mid-range) if not specified
    this.speed           = config.speed           ?? 50;
    this.durability      = config.durability      ?? 100;
    this.weaponSize      = config.weaponSize      ?? 50;
    this.maneuverability = config.maneuverability ?? 50;

    // --- Position (center of the plane in game coordinates) ---
    this.x = config.x ?? 0;
    this.y = config.y ?? 0;

    // --- Velocity (pixels per second, set by movement logic) ---
    this.velocityX = 0;
    this.velocityY = 0;

    // --- Visual Angle (radians; 0 = pointing right) ---
    this.angle = 0;

    // --- Visual Size ---
    this.width  = config.width  ?? 64;  // Wing-tip to wing-tip
    this.height = config.height ?? 28;  // Nose to tail depth

    // --- Color (placeholder until sprite art is added) ---
    this.color = config.color ?? '#4fc3f7';

    // --- Health ---
    // Durability stat becomes the plane's max health
    this.health = new HealthSystem(this.durability);

    // Log a death message automatically (remove or replace when game logic is ready)
    this.health.onDeath(() => {
      console.log(`${this.name} has been destroyed.`);
    });
  }

  // ==========================================================
  // UPDATE
  // The actual movement logic lives in the game state (PilotGameState),
  // because it needs access to the input handler and world boundaries.
  // This method is a placeholder for any self-contained per-frame logic
  // the plane might eventually need (e.g., engine particle effects).
  // ==========================================================

  update(dt) {
    // TODO: Add per-frame self-update logic here as the game grows.
    // For now, all movement is handled in PilotGameState.update().
  }

  // ==========================================================
  // RENDER
  // Draws a triangle placeholder representing the plane.
  // Replace this with sprite/image drawing when art is ready.
  // ==========================================================

  render(ctx) {
    ctx.imageSmoothingEnabled = false; // pixel-art style — no interpolation (Visual Style Guide rule 2)
    // --- Plane body (rotated triangle) ---
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Main body triangle: nose at (+w/2, 0), wings at (-w/2, ±h/2)
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);                     // Nose
    ctx.lineTo(-this.width / 2, -this.height / 2);     // Left wingtip
    ctx.lineTo(-this.width * 0.2, 0);                  // Tail indent
    ctx.lineTo(-this.width / 2,  this.height / 2);     // Right wingtip
    ctx.closePath();
    ctx.fill();

    // Cockpit highlight — pixel-art fillRect, no ellipse() (Visual Style Guide rule 4)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(
      Math.round(this.width * 0.1 - this.width * 0.12),
      -Math.round(this.height * 0.2),
      Math.round(this.width * 0.24),
      Math.round(this.height * 0.4)
    );

    ctx.restore();

    // --- Health bar above the plane (drawn without rotation) ---
    const barW = this.width;
    const barH = 5;
    const barX = this.x - barW / 2;
    const barY = this.y - this.height / 2 - 10;
    this.health.renderBar(ctx, barX, barY, barW, barH);
  }

  // ==========================================================
  // CONVENIENCE METHODS
  // ==========================================================

  isAlive() {
    return this.health.isAlive();
  }

  // Reset the plane for a new game (restore health, center position)
  reset(x, y) {
    this.x         = x ?? 0;
    this.y         = y ?? 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.angle     = 0;
    this.health.reset();
  }
}
