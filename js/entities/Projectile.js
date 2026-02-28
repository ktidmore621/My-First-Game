/* ============================================================
   Projectile.js
   ============================================================
   Phaser-native projectile for both player and enemy fire.
   Extends Phaser.GameObjects.Graphics so it draws itself and
   participates in the Phaser arcade physics world.

   POOLING:
   Managed via Phaser.GameObjects.Group with classType: Projectile
   and runChildUpdate: true so preUpdate() is called automatically
   each frame for every active member.

     const playerBolts = scene.add.group({
       classType: Projectile,
       maxSize: 30,
       runChildUpdate: true,
     });
     const b = playerBolts.get();
     if (b) b.fire(x, y, vx, vy, damage, color, angle);

   group.get() returns an inactive member (or creates one if the
   pool has not yet reached maxSize). kill() returns it to the pool.

   ----------------------------------------------------------------
   PROJECTILE TYPES
   ----------------------------------------------------------------
   bolt   — IPDF plasma bolt. 10×4 px elongated sprite rotated to
            face the travel direction. Moves via Phaser body velocity.
            Fired by the player ship.

   orb    — Orc plasma orb. 6×6 px square sprite. Moves via Phaser
            body velocity. Fired by OrcCannon.

   proxy  — Invisible. No self-movement. Position synced manually
            each frame by OrcSilo via syncProxy(). Used purely for
            arcade physics overlap on homing missiles so that Phaser
            collision callbacks work without migrating OrcSilo's
            complex rendering pipeline.

   ----------------------------------------------------------------
   VISUAL SPEC  (bolt type)
   ----------------------------------------------------------------
     10×4 px outer border in a darker shade of the ship's color
     8×3 px bright core in the ship's color
     4×1 px white center highlight (pixel-art energy glow)
     Sprite rotated via this.setRotation(angle) — Phaser renders
     the rotation automatically, so _draw() always works in local
     space (0,0 = projectile centre).

   ================================================================ */

// Auto-kill bolts/orbs after this travel distance (px).
// Keeps stray projectiles from drifting forever across the 4800 px world.
const PROJECTILE_RANGE = 700;

class Projectile extends Phaser.GameObjects.Graphics {

  constructor(scene) {
    super(scene);

    // Register with the scene display list and the arcade physics world.
    // 'false' = dynamic body — velocity drives movement for bolts/orbs.
    scene.add.existing(this);
    scene.physics.add.existing(this, false);
    this.body.setGravityY(0);

    // Start inactive — pool is pre-allocated; objects wait for get() calls.
    this.setActive(false).setVisible(false);
    this.body.enable = false;

    // ---- Internal per-projectile state ----
    this._type    = 'bolt';    // 'bolt' | 'orb' | 'proxy'
    this._color   = 0xffffff;  // integer hex color for the sprite
    this._angle   = 0;         // travel direction in radians (for sprite rotation)
    this._damage  = 0;         // HP dealt on impact
    this._originX = 0;         // world X at spawn — used for range culling
    this._originY = 0;         // world Y at spawn
  }

  // ================================================================
  // ACTIVATION — fire as a standard IPDF plasma bolt
  //
  //   x, y   : world-space spawn position (Phaser world coords)
  //   vx, vy : velocity in pixels per second (world-space)
  //   damage : HP to deal on impact
  //   color  : integer hex matching the pilot's ship (e.g. 0x42a5f5)
  //   angle  : travel direction in radians — orients the bolt sprite
  // ================================================================

  fire(x, y, vx, vy, damage, color, angle) {
    this.setActive(true).setVisible(true);
    this.body.reset(x, y);   // repositions body and game object together
    this.body.enable = true;
    this.body.setVelocity(vx, vy);
    this.body.setSize(10, 4);
    this.body.setOffset(-5, -2);

    this._type    = 'bolt';
    this._color   = color;
    this._angle   = angle;
    this._damage  = damage;
    this._originX = x;
    this._originY = y;

    this.setRotation(angle);
    this._draw();
  }

  // ================================================================
  // ACTIVATION — fire as an orc plasma orb
  //
  //   color : e.g. 0xff40ff for orc magenta plasma
  // ================================================================

  fireOrb(x, y, vx, vy, damage, color) {
    this.setActive(true).setVisible(true);
    this.body.reset(x, y);
    this.body.enable = true;
    this.body.setVelocity(vx, vy);
    this.body.setSize(6, 6);
    this.body.setOffset(-3, -3);

    this._type    = 'orb';
    this._color   = color;
    this._angle   = 0;
    this._damage  = damage;
    this._originX = x;
    this._originY = y;

    this.setRotation(0);
    this._draw();
  }

  // ================================================================
  // ACTIVATION — activate as an invisible missile physics proxy
  //
  // The proxy's physics body is what arcade overlap detects.
  // OrcSilo calls syncProxy() every frame to keep it aligned with
  // the missile's manually-computed world position.
  //
  //   w, h : hitbox dimensions for collision detection
  // ================================================================

  activateProxy(x, y, w, h) {
    this._type = 'proxy';
    this.setActive(true).setVisible(false);  // active but invisible
    this.body.reset(x, y);
    this.body.enable = true;
    this.body.setVelocity(0, 0);
    this.body.setSize(w, h);
    this.body.setOffset(-w / 2, -h / 2);
    this._damage = 25;  // missiles deal more damage than bolts
  }

  // ================================================================
  // syncProxy — reposition the missile proxy (called by OrcSilo)
  //
  // OrcSilo computes missile positions using its own math (homing,
  // gravity, etc.) and calls this to keep the physics body in sync.
  // body.reset() updates both the physics body position and the
  // game object position atomically without applying velocity.
  // ================================================================

  syncProxy(x, y) {
    if (!this.active || this._type !== 'proxy') return;
    this.body.reset(x, y);
  }

  // ================================================================
  // kill — deactivate and return to pool for reuse
  // ================================================================

  kill() {
    this.setActive(false).setVisible(false);
    if (this.body) this.body.enable = false;
    this.clear();
  }

  // ================================================================
  // preUpdate — called automatically by the Group each frame
  // (requires runChildUpdate: true on the parent Group)
  //
  // Bolts and orbs: check travel range, kill if exceeded, redraw.
  // Proxies: skip all logic — OrcSilo manages their lifecycle.
  // ================================================================

  preUpdate(time, delta) {
    if (!this.active || this._type === 'proxy') return;

    // Kill after PROJECTILE_RANGE pixels of travel or if off-world.
    const dist = Math.hypot(this.x - this._originX, this.y - this._originY);
    if (dist > PROJECTILE_RANGE ||
        this.x < -100 || this.x > BATTLEFIELD_W + 100 ||
        this.y < -100 || this.y > 640) {
      this.kill();
      return;
    }

    this._draw();
  }

  // ================================================================
  // _draw — render the bolt or orb in local space (origin = centre).
  //   Phaser applies this.rotation when compositing, so all
  //   fillRect calls are in the un-rotated local coordinate frame.
  // ================================================================

  _draw() {
    this.clear();

    if (this._type === 'orb') {
      // Orc plasma orb: 6×6 outer shell + 4×4 bright body + 2×2 hot core
      this.fillStyle(_darkenColor(this._color, 0.35), 1);
      this.fillRect(-3, -3, 6, 6);

      this.fillStyle(this._color, 1);
      this.fillRect(-2, -2, 4, 4);

      this.fillStyle(0xffffff, 1);
      this.fillRect(-1, -1, 2, 2);

    } else {
      // IPDF plasma bolt: elongated 10×4 with white center highlight
      this.fillStyle(_darkenColor(this._color, 0.45), 1);
      this.fillRect(-5, -2, 10, 4);

      this.fillStyle(this._color, 1);
      this.fillRect(-4, -1, 8, 3);

      this.fillStyle(0xffffff, 1);
      this.fillRect(-2, 0, 4, 1);
    }
  }
}

/* ============================================================
   FILE-SCOPED HELPER
   ============================================================ */

// Returns a darkened integer hex color.
// factor = 0 → no change, factor = 1 → full black.
// Used to generate bolt/orb border colors from the core color.
function _darkenColor(colorInt, factor) {
  const r  = (colorInt >> 16) & 0xff;
  const g  = (colorInt >>  8) & 0xff;
  const b  =  colorInt        & 0xff;
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return (dr << 16) | (dg << 8) | db;
}
