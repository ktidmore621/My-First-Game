/* ============================================================
   PlayerShip.js
   ============================================================
   Phaser-native player ship that replaces the legacy Plane.js.
   Extends Phaser.GameObjects.Graphics so it can draw with
   fillRect and still participate fully in the Phaser scene graph.

   USAGE (inside a Phaser scene with arcade physics configured):

     create() {
       this._ship = new PlayerShip(this, 100, 270, planeConfig);
       this._ship.setDepth(10);
     }

     update(time, delta) {
       this._ship.update(this._inputSys);
     }

   PLANE CONFIG FIELDS (all optional, safe defaults used):
     speed           0–100  → max move speed (44–220 px/s)
     durability      0–100  → max health
     weaponSize      0–100  → weapon power (not yet wired)
     maneuverability 0–100  → future: turn responsiveness
     color           hex    → 0x42a5f5, etc.
   ============================================================ */

// Drag removed — lerp handles both accel and decel. Increase ACCEL_FACTOR for snappier feel
const ACCEL_FACTOR = 12.0;

class PlayerShip extends Phaser.GameObjects.Graphics {

  constructor(scene, x, y, planeConfig = {}) {
    super(scene);

    // Keep a direct reference to the scene for timers, tweens, etc.
    // (this.scene is set by add.existing but not guaranteed during ctor)
    this._scene = scene;

    // ---- Stats from plane config ----
    this._speed           = planeConfig.speed           ?? 50;
    this._durability      = planeConfig.durability      ?? 100;
    this._weaponSize      = planeConfig.weaponSize      ?? 50;
    this._maneuverability = planeConfig.maneuverability ?? 50;
    this._color           = planeConfig.color           ?? 0x4fc3f7;

    // ---- Ship visual dimensions ----
    this._shipW = 64;
    this._shipH = 28;

    // ---- Derived flight stats ----
    // Speed stat 0–100 maps to 44–220 px/s max speed
    this._maxSpeed = (this._speed / 100) * 220;

    // ---- Spawn invincibility ----
    this._invincible = true;
    this._hitFlash   = false;   // true for 150 ms after a hit — triggers red redraw

    // ---- Place in world before add.existing so the body spawns in the right spot ----
    this.setPosition(x, y);

    // Register with the scene display list and physics world
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Configure the arcade body
    this.body.setMaxVelocity(this._maxSpeed, this._maxSpeed);
    this.body.setCollideWorldBounds(true);
    // Center the hitbox on the ship's local origin
    this.body.setSize(this._shipW, this._shipH);
    this.body.setOffset(-this._shipW / 2, -this._shipH / 2);

    // ---- Health ----
    this.health = new HealthSystem(this._durability);
    this.health.onDamage(() => this._onHit());
    this.health.onDeath(() => this._onDeath());

    // ---- Secondary visual GameObjects (positioned each frame) ----
    this._createEngineGlow();
    this._createShieldShimmer();
    this._createParticleTrail();

    // ---- Start 2-second spawn invincibility window ----
    scene.time.addEvent({
      delay: 2000,
      callback: () => {
        this._invincible = false;
        if (this._shield) this._shield.setVisible(false);
      },
    });

    // Initial draw
    this._draw();
  }

  // ================================================================
  // DRAWING — called every frame; clears and redraws ship geometry
  // in local space (0, 0 = ship centre). Phaser applies this.angle
  // automatically when rendering, so the geometry always points right.
  // ================================================================

  _draw() {
    this.clear();

    const w = this._shipW;
    const h = this._shipH;
    const color = this._hitFlash ? 0xff4444 : this._color;

    // Main body: two triangles forming a winged arrowhead shape
    // Nose at (+w/2, 0), wingtips at (-w/2, ±h/2), tail indent at (-w*0.2, 0)
    this.fillStyle(color, 1);
    this.fillTriangle(
       w / 2,    0,         // nose
      -w / 2,   -h / 2,    // left wingtip
      -w * 0.2,  0         // tail indent — upper half
    );
    this.fillTriangle(
       w / 2,    0,         // nose
      -w * 0.2,  0,         // tail indent — lower half
      -w / 2,    h / 2      // right wingtip
    );

    // Cockpit highlight — fillRect only, no arc (Visual Style Guide rule 4)
    this.fillStyle(0xffffff, 0.4);
    this.fillRect(
      Math.round(w * 0.10 - w * 0.12),
      -Math.round(h * 0.20),
       Math.round(w * 0.24),
       Math.round(h * 0.40)
    );

    // Fire feedback — bright white strokeRect for one frame
    if (this._fireFeedbackFrame) {
      this.lineStyle(2, 0xffffff, 1);
      this.strokeRect(-w / 2, -h / 2, w, h);
      this._fireFeedbackFrame = false;
    }
  }

  // ================================================================
  // ENGINE GLOW
  // A semi-transparent ellipse at the ship's exhaust port.
  // Drawn once into its own Graphics object; repositioned each frame.
  // Pulses in both size and alpha via a looping tween.
  // ================================================================

  _createEngineGlow() {
    this._engineGlow = this._scene.add.graphics();
    this._engineGlow.setDepth(this.depth - 1);

    // Draw the glow shape once, centered at (0, 0) in the glow's local space.
    // Scaling the Graphics object from its origin handles the size pulse.
    const glowW = this._shipW * 0.38;
    const glowH = this._shipH * 0.55;
    this._engineGlow.fillStyle(this._color, 1);
    this._engineGlow.fillEllipse(0, 0, glowW, glowH);

    // Simultaneously pulse size and alpha
    this._scene.tweens.add({
      targets:  this._engineGlow,
      scaleX:   { from: 0.8, to: 1.3 },
      scaleY:   { from: 0.8, to: 1.3 },
      alpha:    { from: 0.15, to: 0.40 },
      duration: 420,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });
  }

  // ================================================================
  // SHIELD SHIMMER — visible during 2-second spawn invincibility
  // Drawn once as a stroke rect centered at (0,0); repositioned each frame.
  // ================================================================

  _createShieldShimmer() {
    this._shield = this._scene.add.graphics();
    this._shield.setDepth(this.depth + 1);

    const pad = 6;
    const sw  = this._shipW + pad * 2;
    const sh  = this._shipH + pad * 2;
    this._shield.lineStyle(2, 0x00ffff, 1);
    this._shield.strokeRect(-sw / 2, -sh / 2, sw, sh);

    // Pulse alpha while active
    this._scene.tweens.add({
      targets:  this._shield,
      alpha:    { from: 0.9, to: 0.25 },
      duration: 200,
      yoyo:     true,
      repeat:   -1,
    });
  }

  // ================================================================
  // ENGINE PARTICLE TRAIL
  // Small bright pixels spawned at the exhaust port, fading to transparent.
  // ================================================================

  _createParticleTrail() {
    // Reuse or create a 2×2 white pixel texture for the particle
    if (!this._scene.textures.exists('ship_trail')) {
      const pg = this._scene.make.graphics({ x: 0, y: 0, add: false });
      pg.fillStyle(0xffffff, 1);
      pg.fillRect(0, 0, 2, 2);
      pg.generateTexture('ship_trail', 2, 2);
      pg.destroy();
    }

    this._trail = this._scene.add.particles(this.x, this.y, 'ship_trail', {
      speed:     { min: 8,   max: 30  },
      scale:     { start: 1.2, end: 0 },
      alpha:     { start: 0.6, end: 0 },
      tint:      [this._color],
      lifespan:  320,
      quantity:  1,
      frequency: 40,
      blendMode: 'ADD',
    });
    this._trail.setDepth(this.depth - 2);
  }

  // ================================================================
  // DAMAGE
  // ================================================================

  /**
   * Apply damage from an external source.
   * No-ops during spawn invincibility so the player has time to react.
   */
  takeDamage(amount) {
    if (this._invincible) return;
    this.health.takeDamage(amount);
  }

  _onHit() {
    // Brief red flash — _draw() reads _hitFlash and switches fill color
    this._hitFlash = true;
    this._scene.time.delayedCall(150, () => {
      if (this.active) this._hitFlash = false;
    });

    // Camera shake on every hit for tactile feedback
    this._scene.cameras.main.shake(200, 0.01);
  }

  _onDeath() {
    // Emit so PilotGameScene can handle the transition
    this.emit('destroyed');
  }

  isAlive() {
    return this.health.isAlive();
  }

  // ================================================================
  // UPDATE — call once per frame from the scene's update()
  // ================================================================

  update(inputSys, dt) {
    const stick    = inputSys.leftStick;
    const maxSpeed = this._maxSpeed;

    // Lerp velocity toward stick target for a gradual acceleration ramp.
    // When stick is released (x/y = 0) the lerp decelerates toward zero;
    // the body drag reinforces the stop.
    const targetVX = stick.x * maxSpeed;
    const targetVY = stick.y * maxSpeed;
    this.body.setVelocityX(
      Phaser.Math.Linear(this.body.velocity.x, targetVX, ACCEL_FACTOR * dt)
    );
    this.body.setVelocityY(
      Phaser.Math.Linear(this.body.velocity.y, targetVY, ACCEL_FACTOR * dt)
    );

    // Rotate nose to face direction of travel; smoothly returns to level when stopped.
    // 0.12 = rotation follow speed — increase for snappier nose response
    const vx    = this.body.velocity.x;
    const vy    = this.body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > 20) {
      const targetAngle = Math.atan2(vy, vx) * (180 / Math.PI);
      this.angle = Phaser.Math.Linear(this.angle, targetAngle, 0.12);
    } else {
      this.angle = Phaser.Math.Linear(this.angle, 0, 0.08);
    }

    // Redraw ship geometry every frame (Graphics has no sprite caching)
    this._draw();

    // Position engine exhaust effects at the tail of the ship
    const rad  = Phaser.Math.DegToRad(this.angle);
    const tailX = this.x - Math.cos(rad) * this._shipW * 0.42;
    const tailY = this.y - Math.sin(rad) * this._shipW * 0.42;

    this._engineGlow.setPosition(tailX, tailY);
    this._trail.setPosition(tailX, tailY);

    // Keep shield centered on ship
    this._shield.setPosition(this.x, this.y);
  }

  // ================================================================
  // CLEANUP
  // ================================================================

  destroy(fromScene) {
    if (this._engineGlow) this._engineGlow.destroy();
    if (this._shield)     this._shield.destroy();
    if (this._trail)      this._trail.destroy();
    super.destroy(fromScene);
  }
}
