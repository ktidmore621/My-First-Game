/* ============================================================
   LightingSystem.js — Dynamic Lighting for PilotGameScene
   ============================================================
   Uses Phaser.GameObjects.Graphics redrawn each frame to
   composite lighting effects over the scene.

   Layer stack (all setScrollFactor(0) so they sit in screen space):
     depth 30  — ambient darkness overlay  (multiply-like via alpha)
     depth 31  — dynamic light sources     (ADD blend mode)

   PUBLIC API:
     new LightingSystem(scene)
       scene  — active Phaser.Scene (PilotGameScene expected)

     .update(time, delta)
       Call once per frame from scene.update(). Redraws all layers.

     .addExplosionLight(worldX, worldY)
       Call when a large explosion fires — warm orange burst.

     .addMuzzleFlash(worldX, worldY)
       Call when the player fires — brief white flash at muzzle.

     .addMissileExhaust(worldX, worldY)
       Call each frame a missile is active — small trailing orange.

     .setVoidheartPositions(positions)
       positions — [{ x, y }] world-space; set once after terrain builds.
       Drives the purplish-red vein glow.

     .setPoolPositions(positions)
       positions — [{ x, y }] world-space acid pool centres.
       Drives the acidic-green pool glow.

     .destroy()
       Cleans up all Phaser objects; call on scene shutdown.
   ============================================================ */

class LightingSystem {

  constructor(scene) {
    this._scene = scene;

    // World → screen coordinate helper
    this._cam = scene.cameras.main;

    // Voidheart vein and acid pool positions (world space)
    this._voidheartPositions = [];
    this._poolPositions      = [];

    // Short-lived light events queued this frame
    this._explosionLights = []; // { wx, wy, age, maxAge }
    this._muzzleFlashes   = []; // { wx, wy, age, maxAge }
    this._missileExhausts = []; // { wx, wy } — drawn once then cleared

    // ---- Ambient darkness layer ----
    // A near-black rectangle at 0.30 alpha sits over the entire viewport.
    // setScrollFactor(0) keeps it fixed to screen space so the camera never
    // scrolls it — it always covers the full 960×540 canvas.
    this._darkLayer = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(30);

    // ---- Dynamic light layer ----
    // Drawn in ADD blend mode so bright lights punch through the dark overlay.
    // Rebuilt each frame in update().
    this._lightLayer = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(31);

    this._drawDarkLayer();
  }

  // ================================================================
  // CONFIG — call after terrain builds to supply glow positions
  // ================================================================

  setVoidheartPositions(positions) {
    this._voidheartPositions = positions || [];
  }

  setPoolPositions(positions) {
    this._poolPositions = positions || [];
  }

  // ================================================================
  // LIGHT EVENTS — called from PilotGameScene on game events
  // ================================================================

  addExplosionLight(worldX, worldY) {
    this._explosionLights.push({
      wx:     worldX,
      wy:     worldY,
      age:    0,
      maxAge: 0.5,   // 0.5 seconds fade
    });
  }

  addMuzzleFlash(worldX, worldY) {
    this._muzzleFlashes.push({
      wx:     worldX,
      wy:     worldY,
      age:    0,
      maxAge: 0.08,  // 3 frames at 30 fps — very brief white pop
    });
  }

  addMissileExhaust(worldX, worldY) {
    // Accumulated during the frame, drawn once, then cleared
    this._missileExhausts.push({ wx: worldX, wy: worldY });
  }

  // ================================================================
  // UPDATE — call once per frame
  // ================================================================

  update(time, delta) {
    const dt = delta / 1000;

    // Age all timed lights
    this._explosionLights = this._explosionLights.filter(l => {
      l.age += dt;
      return l.age < l.maxAge;
    });
    this._muzzleFlashes = this._muzzleFlashes.filter(l => {
      l.age += dt;
      return l.age < l.maxAge;
    });

    this._drawLightLayer();

    // Missile exhausts are one-shot per frame — cleared after draw
    this._missileExhausts = [];
  }

  // ================================================================
  // DRAWING — DARK LAYER
  // ================================================================

  _drawDarkLayer() {
    const W = 960;
    const H = 540;

    this._darkLayer.clear();
    // Flat dark overlay at 0.30 alpha — alien atmospheric tint
    this._darkLayer.fillStyle(0x000000, 0.30);
    this._darkLayer.fillRect(0, 0, W, H);
  }

  // ================================================================
  // DRAWING — LIGHT LAYER
  // Each emitter uses ADD blend mode via the Graphics blendMode property.
  // We switch blendMode on the Graphics object before each group of draws.
  // ================================================================

  _drawLightLayer() {
    const cam = this._cam;
    const gfx = this._lightLayer;

    gfx.clear();
    gfx.setBlendMode(Phaser.BlendModes.ADD);

    // ---- Voidheart vein glow — purplish-red pool above each vein ----
    for (const pos of this._voidheartPositions) {
      const sx = pos.x - cam.scrollX;
      const sy = pos.y - cam.scrollY;

      // Only draw if on screen (with margin)
      if (sx < -120 || sx > 1080 || sy < -80 || sy > 620) continue;

      // Outer soft ring
      gfx.fillStyle(0x6a1040, 0.06);
      gfx.fillEllipse(sx, sy - 24, 120, 48);
      // Inner brighter core
      gfx.fillStyle(0xaa2060, 0.10);
      gfx.fillEllipse(sx, sy - 16, 60, 28);
    }

    // ---- Acid pool glow — green light bleeding upward ----
    for (const pos of this._poolPositions) {
      const sx = pos.x - cam.scrollX;
      const sy = pos.y - cam.scrollY;

      if (sx < -120 || sx > 1080 || sy < -80 || sy > 620) continue;

      gfx.fillStyle(0x204a10, 0.07);
      gfx.fillEllipse(sx, sy - 20, 100, 40);
      gfx.fillStyle(0x40aa30, 0.08);
      gfx.fillEllipse(sx, sy - 12, 50, 22);
    }

    // ---- Explosion lights — warm orange-white burst fading over 0.5 s ----
    for (const light of this._explosionLights) {
      const t    = 1 - (light.age / light.maxAge);   // 1→0 as it fades
      const sx   = light.wx - cam.scrollX;
      const sy   = light.wy - cam.scrollY;
      const rOuter = 180 * (1 + (1 - t) * 0.5);      // expands slightly
      const rInner = 80  * (1 + (1 - t) * 0.3);

      // Warm outer glow
      gfx.fillStyle(0xff6600, 0.08 * t);
      gfx.fillEllipse(sx, sy, rOuter * 2, rOuter);

      // Bright white-orange core
      gfx.fillStyle(0xffcc44, 0.18 * t);
      gfx.fillEllipse(sx, sy, rInner * 2, rInner);
    }

    // ---- Muzzle flash lights — brief bright white pop at the gun muzzle ----
    for (const flash of this._muzzleFlashes) {
      const t  = 1 - (flash.age / flash.maxAge);
      const sx = flash.wx - cam.scrollX;
      const sy = flash.wy - cam.scrollY;

      gfx.fillStyle(0xffffff, 0.35 * t);
      gfx.fillEllipse(sx, sy, 80, 40);
      gfx.fillStyle(0xffeebb, 0.50 * t);
      gfx.fillEllipse(sx, sy, 36, 20);
    }

    // ---- Missile exhaust glow — small orange trailing dot ----
    for (const ex of this._missileExhausts) {
      const sx = ex.wx - cam.scrollX;
      const sy = ex.wy - cam.scrollY;

      if (sx < -60 || sx > 1020 || sy < -60 || sy > 600) continue;

      gfx.fillStyle(0xff8800, 0.22);
      gfx.fillEllipse(sx, sy, 40, 20);
      gfx.fillStyle(0xffcc00, 0.30);
      gfx.fillEllipse(sx, sy, 18, 10);
    }
  }

  // ================================================================
  // CLEANUP
  // ================================================================

  destroy() {
    if (this._darkLayer) { this._darkLayer.destroy(); this._darkLayer = null; }
    if (this._lightLayer) { this._lightLayer.destroy(); this._lightLayer = null; }
  }
}
