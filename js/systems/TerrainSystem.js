/* ============================================================
   TerrainSystem.js — Procedural Terrain & Ground Rendering
   ============================================================
   Owns all terrain geometry and ground-layer rendering for
   PILOT MODE.  Replaces the canvas-based _buildGround /
   _drawGround / terrain methods that lived in PilotGameState.

   PUBLIC API (call in this order from PilotGameScene.create()):
     1.  new TerrainSystem(scene, battlefieldW [, seed])
     2.  .flattenZone(centerX, halfFlatW, blendW)  — one per enemy
     3.  .buildFeatures()                           — after all flattenZone calls
     4.  .build()                                   — creates all Phaser objects

   Then every update():
         .update(time, delta)                       — animated elements + particles

   To spawn a dirt burst at impact point (e.g. enemy bolt hits ground):
         .spawnImpact(worldX, worldY)

   Internal layer order (Phaser depth):
     0.5  — far parallax hills  (TileSprite, scrollFactor 0.25)
     0.7  — near parallax hills (TileSprite, scrollFactor 0.55)
     1    — static ground       (Image from offscreen canvas, scrollFactor 1)
     1.5  — animated overlay    (Graphics, redrawn each frame,  scrollFactor 1)

   ============================================================ */

// Terrain samples every 32 world-px.  One sample covers a 32-px strip.
const TERRAIN_STEP = 32;

class TerrainSystem {

  // scene        — active Phaser.Scene
  // battlefieldW — total world width in px (e.g. 4800)
  // seed         — optional float; random if omitted (same seed → same landscape)
  constructor(scene, battlefieldW, seed) {
    this._scene         = scene;
    this._battlefieldW  = battlefieldW;
    this._H             = 540;
    this._horizonY      = Math.floor(this._H * 0.72);   // 388
    this._groundH       = this._H - this._horizonY;     // 152
    this._tileW         = 960; // feature tile width — one viewport-wide repeat

    this._terrainSeed    = (seed !== undefined) ? seed : Math.random() * 1000;
    this._terrainHeights = this._buildTerrainHeights();
    this._groundFeatures = []; // populated by buildFeatures()

    // Phaser display objects (created in build())
    this._groundSprite   = null; // Image — static ground baked from canvas
    this._animGfx        = null; // Graphics — animated overlay (Voidheart pulse etc.)
    this._farHills       = null; // TileSprite — far parallax hills
    this._nearHills      = null; // TileSprite — near parallax hills
    this._dustEmitter    = null; // ParticleEmitter — ambient surface dust
    this._impactEmitter  = null; // ParticleEmitter — dirt burst on ground strike
  }

  // ================================================================
  // PUBLIC TERRAIN API
  // ================================================================

  getSeed() { return this._terrainSeed; }

  // Linear-interpolated terrain height at any world X.
  // Returns px above (positive) or below (negative) horizonY.
  // Safe to call outside [0, battlefieldW] — clamped to nearest edge.
  getHeightAt(worldX) {
    const raw = worldX / TERRAIN_STEP;
    const i0  = Math.max(0, Math.min(Math.floor(raw), this._terrainHeights.length - 1));
    const i1  = Math.min(i0 + 1, this._terrainHeights.length - 1);
    const t   = raw - Math.floor(raw);
    return this._terrainHeights[i0] + (this._terrainHeights[i1] - this._terrainHeights[i0]) * t;
  }

  // Flatten terrain under a structure (e.g. OrcCannon, OrcSilo).
  // centerX      — world-space centre of the structure
  // halfFlatW    — half-width of the completely flat zone (px)
  // blendW       — linear-blend fringe on each edge (px)
  //
  // Call once per enemy placement BEFORE buildFeatures().
  flattenZone(centerX, halfFlatW, blendW) {
    const h     = this._terrainHeights;
    const count = h.length;
    const flatL = centerX - halfFlatW;
    const flatR = centerX + halfFlatW;

    const iFlatL   = Math.max(0,         Math.ceil( flatL / TERRAIN_STEP));
    const iFlatR   = Math.min(count - 1, Math.floor(flatR / TERRAIN_STEP));
    const iBlendLL = Math.max(0,         Math.ceil( (flatL - blendW) / TERRAIN_STEP));
    const iBlendRR = Math.min(count - 1, Math.floor((flatR + blendW) / TERRAIN_STEP));

    let sum = 0, num = 0;
    for (let i = iFlatL; i <= iFlatR; i++) { sum += h[i]; num++; }
    if (num === 0) return;
    const flatH = sum / num;

    const origL = [];
    const origR = [];
    for (let i = iBlendLL; i < iFlatL;      i++) origL.push(h[i]);
    for (let i = iFlatR + 1; i <= iBlendRR; i++) origR.push(h[i]);

    for (let i = iFlatL; i <= iFlatR; i++) h[i] = flatH;

    for (let i = iBlendLL; i < iFlatL; i++) {
      const t = Math.max(0, Math.min(1,
        ((i * TERRAIN_STEP) - (flatL - blendW)) / blendW));
      h[i] = origL[i - iBlendLL] * (1 - t) + flatH * t;
    }
    for (let i = iFlatR + 1; i <= iBlendRR; i++) {
      const t = Math.max(0, Math.min(1,
        ((i * TERRAIN_STEP) - flatR) / blendW));
      h[i] = flatH * (1 - t) + origR[i - iFlatR - 1] * t;
    }
  }

  // Build the ground feature array using the current (possibly flattened)
  // height map.  Must be called AFTER all flattenZone() calls.
  buildFeatures() {
    this._groundFeatures = _buildGroundFeatures(
      this._terrainSeed,
      (x) => this.getHeightAt(x)
    );
  }

  // ================================================================
  // PHASER BUILD — call once from scene.create() after buildFeatures()
  // ================================================================

  build() {
    this._buildParallaxHills();
    this._buildStaticGround();
    this._buildAnimatedGfx();
    this._buildParticles();
  }

  // ================================================================
  // UPDATE — call every frame from scene.update()
  //
  // time  — Phaser scene time in ms
  // delta — Phaser frame delta in ms
  // ================================================================

  update(time, delta) {
    this._updateParallax();
    this._updateAnimated(time / 1000); // pass seconds to match legacy API
    this._updateDustEmitter();
  }

  // ================================================================
  // GROUND IMPACT — call when an enemy bolt hits the ground
  // worldX, worldY — world-space coordinates of the impact point
  // ================================================================

  spawnImpact(worldX, worldY) {
    if (!this._impactEmitter) return;
    this._impactEmitter.setPosition(worldX, worldY);
    this._impactEmitter.explode(10);
  }

  // ================================================================
  // PRIVATE: TERRAIN HEIGHT MAP GENERATION
  // ================================================================
  //
  // Multi-octave sine noise with four phase offsets derived from the seed.
  // Range: −22 … +16 px relative to horizonY.
  // One smoothing pass + flat-zone injection for natural variation.

  _buildTerrainHeights() {
    const count  = Math.floor(this._battlefieldW / TERRAIN_STEP) + 1;
    const seed   = this._terrainSeed;
    const TWO_PI = Math.PI * 2;

    // Seeded random — identical formula to _buildGroundFeatures
    let _n = 0;
    const sr  = () => ((Math.sin(seed + _n++) * 9301 + 49297) % 233280) / 233280;
    const srf = () => Math.max(0, Math.min(1, (sr() - 0.1715) / (0.2512 - 0.1715)));

    const phase1 = srf() * TWO_PI;
    const phase2 = srf() * TWO_PI;
    const phase3 = srf() * TWO_PI;
    const phase4 = srf() * TWO_PI;

    const heights = new Array(count);
    for (let i = 0; i < count; i++) {
      const x    = i * TERRAIN_STEP;
      heights[i] =
        10 * Math.sin(x / 800  * TWO_PI + phase1) +
         5 * Math.sin(x / 300  * TWO_PI + phase2) +
         3 * Math.sin(x / 120  * TWO_PI + phase3) +
         1 * Math.sin(x / 45   * TWO_PI + phase4);
    }

    // Single smoothing pass
    const smoothed = heights.slice();
    for (let i = 1; i < count - 1; i++) {
      smoothed[i] = heights[i - 1] * 0.25 + heights[i] * 0.5 + heights[i + 1] * 0.25;
    }
    for (let i = 0; i < count; i++) heights[i] = smoothed[i];

    // Clamp
    for (let i = 0; i < count; i++) {
      heights[i] = Math.max(-22, Math.min(16, heights[i]));
    }

    // Natural flat zones (3–5 zones, 80–200 px wide)
    const zoneCount = 3 + Math.floor(srf() * 3);
    for (let z = 0; z < zoneCount; z++) {
      const centerX = Math.round(srf() * this._battlefieldW);
      const halfW   = Math.round((80 + srf() * 120) / 2);
      const i0 = Math.max(0,         Math.floor((centerX - halfW) / TERRAIN_STEP));
      const i1 = Math.min(count - 1, Math.ceil( (centerX + halfW) / TERRAIN_STEP));
      let sum = 0;
      for (let i = i0; i <= i1; i++) sum += heights[i];
      const mean = sum / (i1 - i0 + 1);
      for (let i = i0; i <= i1; i++) heights[i] = mean;
    }

    return heights;
  }

  // ================================================================
  // PRIVATE: PARALLAX HILLS — TileSprites at depth 0.5 and 0.7
  // ================================================================

  _buildParallaxHills() {
    const scene     = this._scene;
    const W         = 960; // tile width = one viewport
    const horizonY  = this._horizonY;

    // ---- Far hill silhouette — broad, dark alien mountains ----
    // 16-bit style: stepped sawtooth forms using fillRect only.
    const farGfx = scene.make.graphics({ x: 0, y: 0, add: false });
    farGfx.fillStyle(0x0d1a2a); // very dark blue-grey
    _drawHillSilhouette(farGfx, W, 68, [
      { x:   0, w: 80,  h: 52 },
      { x:  60, w: 120, h: 68 },
      { x: 160, w:  90, h: 44 },
      { x: 230, w: 140, h: 60 },
      { x: 340, w:  70, h: 38 },
      { x: 390, w: 160, h: 55 },
      { x: 520, w:  80, h: 42 },
      { x: 580, w: 130, h: 62 },
      { x: 680, w:  90, h: 48 },
      { x: 750, w: 150, h: 58 },
      { x: 880, w:  80, h: 40 },
    ]);
    farGfx.generateTexture('terrain_far_hills', W, 80);
    farGfx.destroy();

    this._farHills = scene.add.tileSprite(0, horizonY - 68, W, 80, 'terrain_far_hills')
      .setOrigin(0, 0)
      .setDepth(0.5)
      .setScrollFactor(0); // we drive tilePositionX manually in _updateParallax

    // ---- Near hill silhouette — closer, taller, warmer tones ----
    const nearGfx = scene.make.graphics({ x: 0, y: 0, add: false });
    nearGfx.fillStyle(0x1a2818); // dark muted green-grey (alien ground tone)
    _drawHillSilhouette(nearGfx, W, 52, [
      { x:   0, w: 110, h: 40 },
      { x:  90, w:  70, h: 52 },
      { x: 145, w: 130, h: 36 },
      { x: 255, w:  60, h: 44 },
      { x: 300, w: 180, h: 50 },
      { x: 460, w:  80, h: 32 },
      { x: 520, w: 100, h: 48 },
      { x: 600, w: 140, h: 38 },
      { x: 720, w:  70, h: 46 },
      { x: 780, w: 160, h: 42 },
      { x: 910, w:  50, h: 34 },
    ]);
    nearGfx.generateTexture('terrain_near_hills', W, 64);
    nearGfx.destroy();

    this._nearHills = scene.add.tileSprite(0, horizonY - 50, W, 64, 'terrain_near_hills')
      .setOrigin(0, 0)
      .setDepth(0.7)
      .setScrollFactor(0); // we drive tilePositionX manually in _updateParallax
  }

  // ================================================================
  // PRIVATE: STATIC GROUND — offscreen canvas → Phaser Image at depth 1
  // ================================================================
  //
  // Draws the full battlefield (up to battlefieldW × 540 px) using the
  // existing Canvas 2D API so all legacy feature.draw() closures work
  // without modification.  Uploaded once as a Phaser texture.

  _buildStaticGround() {
    const scene      = this._scene;
    const W          = this._battlefieldW;
    const H          = this._H;
    const horizonY   = this._horizonY;
    const groundH    = this._groundH;

    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // ---- Sky extension buffer ----
    // Terrain can dip up to 22 px below horizonY; fill that strip so
    // no gap is visible between the sky and the raised ground edge.
    ctx.fillStyle = '#1e3a52';
    ctx.fillRect(0, horizonY, W, 24);

    // ---- Column-by-column terrain rendering ----
    // Every 2 px strip gets independent height lookup so the full
    // geological profile (cliff strata, surface bands, rocks) follows
    // the terrain curve exactly.
    const STEP = 2;
    for (let worldX = 0; worldX < W; worldX += STEP) {
      const height     = this.getHeightAt(worldX);
      const surfaceY   = Math.round(horizonY - height);
      const prevHeight = this.getHeightAt(worldX - STEP);
      const prevSurf   = Math.round(horizonY - prevHeight);
      const cliffH     = prevSurf - surfaceY; // > 0 when terrain rose

      // Ground body — horizontal colour bands from bodyStart to canvas bottom
      const bodyStart = surfaceY + 12;
      for (let by = bodyStart; by < H; by += 2) {
        const bandY = by - bodyStart;
        if (bandY % 6 === 0) {
          ctx.fillStyle = '#2a3828';
        } else if (Math.floor(bandY / 2) % 2 === 0) {
          ctx.fillStyle = '#3a4a32';
        } else {
          ctx.fillStyle = '#344530';
        }
        ctx.fillRect(worldX, by, STEP, Math.min(2, H - by));
      }

      // Cliff face strata
      if (cliffH > 3) {
        ctx.fillStyle = '#3a4a32';
        ctx.fillRect(worldX, surfaceY, STEP, Math.min(4, cliffH));
        if (cliffH > 4) {
          const midStart = surfaceY + 4;
          const midH     = Math.min(6, cliffH - 4);
          ctx.fillStyle  = '#2a3828';
          ctx.fillRect(worldX, midStart, STEP, midH);
          ctx.fillStyle  = '#1a2818';
          for (let cy = midStart; cy < midStart + midH; cy += 2) {
            ctx.fillRect(worldX, cy, STEP, 1);
          }
        }
        if (cliffH > 10) {
          const bedStart = surfaceY + 10;
          const bedH     = cliffH - 10;
          ctx.fillStyle  = '#1a2818';
          ctx.fillRect(worldX, bedStart, STEP, bedH);
          const mHash = (worldX * 7 + 43) % 11;
          if (mHash < 2) {
            ctx.fillStyle = '#1a0018';
            ctx.fillRect(worldX + (mHash % STEP), bedStart + Math.floor(bedH * 0.4), 1, 1);
          }
        }
        ctx.fillStyle = '#0d1a0a';
        ctx.fillRect(worldX, prevSurf, STEP, 2);
      }

      // 5-layer horizon transition at the very surface
      let hy = surfaceY;
      ctx.fillStyle = '#5a6a4a'; ctx.fillRect(worldX, hy, STEP, 1); hy += 1;
      ctx.fillStyle = '#4a5a3a'; ctx.fillRect(worldX, hy, STEP, 2); hy += 2;
      ctx.fillStyle = '#3a4a32'; ctx.fillRect(worldX, hy, STEP, 2); hy += 2;
      ctx.fillStyle = '#2a3828'; ctx.fillRect(worldX, hy, STEP, 3); hy += 3;
      ctx.fillStyle = '#1a2818'; ctx.fillRect(worldX, hy, STEP, 4);

      if (cliffH > 3) {
        ctx.fillStyle = '#4a5a3a';
        ctx.fillRect(worldX, surfaceY, STEP, 1);
      }

      // Surface noise — 1 px fleck per 2-px column
      const nHash = (worldX * 3 + 17) % 7;
      if (nHash < 3) {
        ctx.fillStyle = (nHash < 1) ? '#4a5a3a' : '#2a3828';
        ctx.fillRect(worldX + 1, surfaceY + 6, 1, 1);
      }

      // Scattered rocks
      const rHash = (worldX * 13 + 7) % 23;
      if (rHash < 4) {
        const rockColors = ['#4a5a40', '#3a4a34', '#2a3828'];
        ctx.fillStyle    = rockColors[rHash % 3];
        const ry         = surfaceY + 4 + (rHash % 4);
        if (rHash < 2) {
          ctx.fillRect(worldX + 1, ry, 1, 1);
        } else {
          ctx.fillRect(worldX, ry, 2, 1);
        }
      }
    }

    // ---- Ground features — tiled across full battlefield width ----
    // Features are defined in 0–960 tile space; we repeat across battlefieldW.
    for (let tileStart = 0; tileStart < W; tileStart += this._tileW) {
      for (const f of this._groundFeatures) {
        if (f._animated) continue; // skip animated features — drawn separately
        const worldX  = tileStart + f.x;
        if (worldX < -64 || worldX > W + 64) continue; // rough cull
        const tHeight = this.getHeightAt(worldX);
        const surfaceY = horizonY - tHeight;
        const py = surfaceY + f.y * groundH;
        // Pass t=0 for static draw (no pulse animation on first render)
        f.draw(ctx, worldX, py, f, 0);
      }
    }

    // Register as Phaser texture and place as world-space image
    if (scene.textures.exists('terrain_ground_static')) {
      scene.textures.remove('terrain_ground_static');
    }
    scene.textures.addCanvas('terrain_ground_static', canvas);

    this._groundSprite = scene.add.image(0, 0, 'terrain_ground_static')
      .setOrigin(0, 0)
      .setDepth(1)
      .setScrollFactor(1);
  }

  // ================================================================
  // PRIVATE: ANIMATED OVERLAY — Phaser Graphics redrawn each frame
  // ================================================================
  //
  // Only features with _animated = true are drawn here — Voidheart vein
  // pulses, pool shimmer, and large-crater ore glow.  The Graphics object
  // sits at depth 1.5 in world space so it renders on top of the static
  // ground canvas image.

  _buildAnimatedGfx() {
    this._animGfx = this._scene.add.graphics()
      .setDepth(1.5)
      .setScrollFactor(1);
  }

  // Redraws every animated feature that is within a generous viewport window.
  _updateAnimated(t) {
    const gfx      = this._animGfx;
    const camera   = this._scene.cameras.main;
    const camL     = camera.scrollX - 120;
    const camR     = camera.scrollX + 960 + 120;
    const horizonY = this._horizonY;
    const groundH  = this._groundH;
    const W        = this._battlefieldW;

    gfx.clear();

    for (let tileStart = 0; tileStart < W; tileStart += this._tileW) {
      for (const f of this._groundFeatures) {
        if (!f._animated) continue;
        const worldX = tileStart + f.x;
        if (worldX < camL || worldX > camR) continue; // viewport cull

        const tHeight  = this.getHeightAt(worldX);
        const surfaceY = horizonY - tHeight;
        const py       = surfaceY + f.y * groundH;

        f.drawAnimated(gfx, worldX, py, f, t);
      }
    }
  }

  // ================================================================
  // PRIVATE: PARTICLES
  // ================================================================

  _buildParticles() {
    const scene = this._scene;

    // Shared 2×2 white pixel texture (may already exist)
    if (!scene.textures.exists('terrain_particle')) {
      const pg = scene.make.graphics({ x: 0, y: 0, add: false });
      pg.fillStyle(0xffffff, 1);
      pg.fillRect(0, 0, 2, 2);
      pg.generateTexture('terrain_particle', 2, 2);
      pg.destroy();
    }

    const horizonY = this._horizonY;

    // ---- Ambient dust emitter ----
    // Drifts slowly across the surface — a low-density continuous emitter
    // that follows the camera so dust always appears in the viewport.
    this._dustEmitter = scene.add.particles(480, horizonY - 8, 'terrain_particle', {
      speedX:   { min: -35, max: -12 },       // drift leftward (wind)
      speedY:   { min: -6,  max:  6  },
      scaleX:   { start: 0.8, end: 0 },
      scaleY:   { start: 0.5, end: 0 },
      alpha:    { start: 0.35, end: 0 },
      tint:     [0x8a7a58, 0x6a6040, 0x5a5030],
      lifespan: { min: 1200, max: 2400 },
      frequency: 180,                          // ms between particle births
      emitZone:  {
        type:   'random',
        source: new Phaser.Geom.Rectangle(-540, -40, 1080, 56),
      },
      blendMode: 'NORMAL',
    }).setDepth(1.6).setScrollFactor(0);      // fixed to viewport, appears atmospheric

    // ---- Ground impact emitter ----
    // Burst triggered by spawnImpact() — tiny dirt and rock particles.
    this._impactEmitter = scene.add.particles(0, 0, 'terrain_particle', {
      speedX:   { min: -80,  max:  80  },
      speedY:   { min: -140, max: -20  },
      gravityY:  280,
      scale:    { start: 1.0, end: 0.2 },
      alpha:    { start: 0.9, end: 0   },
      tint:     [0x5a6040, 0x4a5030, 0x3a4028, 0x8a7a58],
      lifespan: { min: 300, max: 600 },
      quantity:  0,   // burst mode — explode() called manually
      emitting:  false,
      blendMode: 'NORMAL',
    }).setDepth(12).setScrollFactor(1);       // world space — scrolls with camera
  }

  // Sync the dust emitter's X to the centre of the camera viewport each frame.
  _updateDustEmitter() {
    if (!this._dustEmitter) return;
    const cam = this._scene.cameras.main;
    // Keep emitter centred on viewport; scrollFactor(0) means screen space coords
    this._dustEmitter.setPosition(480, this._horizonY - 12);
  }

  // ================================================================
  // PRIVATE: PARALLAX SCROLL — update TileSprite tilePositionX each frame
  // ================================================================

  _updateParallax() {
    const cam = this._scene.cameras.main;
    if (this._farHills)  this._farHills.tilePositionX  = cam.scrollX * 0.25;
    if (this._nearHills) this._nearHills.tilePositionX = cam.scrollX * 0.55;
  }
}

// ================================================================
// MODULE HELPER — pixelated hill silhouette using fillRect only.
// Builds a stepped mountain profile from an array of peak descriptors.
//   gfx     — Phaser Graphics (pre-styled with fillStyle)
//   tileW   — total width of the tile to fill
//   maxH    — tallest possible peak height in px
//   peaks   — [ { x, w, h } ] — each peak's left edge, width, height
// ================================================================

function _drawHillSilhouette(gfx, tileW, maxH, peaks) {
  // Build a per-pixel height map by rasterising the peaks with a triangular
  // (sawtooth) profile so adjacent peaks blend naturally.
  const heights = new Float32Array(tileW);
  for (const p of peaks) {
    const cx = p.x + Math.floor(p.w / 2);
    for (let px = Math.max(0, p.x); px < Math.min(tileW, p.x + p.w); px++) {
      // Triangle profile: full height at centre, zero at edges
      const dist = Math.abs(px - cx) / (p.w / 2);
      const h    = p.h * Math.max(0, 1 - dist);
      if (h > heights[px]) heights[px] = h;
    }
  }

  // Render each column as a fillRect from the hill top down to maxH
  for (let px = 0; px < tileW; px++) {
    const h = Math.round(heights[px]);
    if (h <= 0) continue;
    const top = maxH - h;
    // 2-pixel-wide stepped blocks for the 16-bit aesthetic
    gfx.fillRect(px, top, 1, h);
  }

  // ---- Pixel detail: 1 px highlight on each peak's upper-left edge ----
  gfx.fillStyle(0x4a5a70); // slightly lighter blue-grey ridge catch
  for (const p of peaks) {
    const cx  = p.x + Math.floor(p.w / 2);
    const top = Math.round(maxH - p.h);
    // Stepped ridge highlight — 2 px to the right of the peak centre
    for (let hy = top; hy < top + Math.min(8, p.h); hy += 2) {
      gfx.fillRect(cx + 1, hy, 1, 1);
    }
  }
}

// ================================================================
// GROUND FEATURE BUILDER
// ================================================================
// Unchanged from PilotGameState — returns an array of feature objects.
// Animated features get an extra _animated flag and a drawAnimated()
// method alongside the static draw() so TerrainSystem can separate them.
//
// Feature structure:
//   x         — tile-space X position (0–960 px)
//   y         — fractional depth in ground area (0 = horizon, 1 = bottom)
//   _animated — true if the feature has time-varying visual elements
//   draw(ctx, px, py, self, t)          — Canvas 2D render (static parts)
//   drawAnimated(gfx, px, py, self, t)  — Phaser Graphics render (animated parts only)

function _buildGroundFeatures(seed = 0, getHeightAt = () => 0) {
  const features = [];

  let _n = 0;
  const seededRand = (n) => ((Math.sin(seed + n) * 9301 + 49297) % 233280) / 233280;
  const sr  = () => seededRand(_n++);
  const srf = () => Math.max(0, Math.min(1, (sr() - 0.1715) / (0.2512 - 0.1715)));

  // ================================================================
  // ROADS
  // ================================================================
  [[0.13], [0.52]].forEach(([yFrac]) => {
    features.push({
      x: 0, y: yFrac, _animated: false,
      draw(ctx, px, py) {
        ctx.fillStyle = 'rgba(30, 22, 14, 0.78)';
        ctx.fillRect(px, py - 5, 960, 10);
        ctx.fillStyle = 'rgba(58, 48, 32, 0.55)';
        for (let mx = 0; mx < 960; mx += 60) {
          ctx.fillRect(px + mx, py - 1, 28, 2);
        }
      },
    });
  });

  // ================================================================
  // BOMB CRATERS
  // ================================================================
  [
    [75,  0.28, 14], [195, 0.65, 17], [330, 0.38, 11],
    [460, 0.72, 19], [560, 0.22, 13], [680, 0.58, 15],
    [790, 0.42, 12], [900, 0.75, 18],
  ].forEach(([bx, by, br]) => {
    let fx = Math.max(10,   Math.min(950,  Math.round(bx + srf() * 120 - 60)));
    const fy = Math.max(0.15, Math.min(0.85, by + srf() * 0.20 - 0.10));
    const r  = Math.max(9,    Math.min(22,   Math.round(br + srf() * 8   - 4)));

    let _cBestH = getHeightAt(fx);
    for (let _sx = Math.max(10, fx - 200); _sx <= Math.min(950, fx + 200); _sx += 32) {
      const _h = getHeightAt(_sx);
      if (_h < _cBestH) { _cBestH = _h; fx = _sx; }
    }

    let _di = 0;
    const dr = () => {
      const v = ((Math.sin(fx * 17.3 + r * 53.7 + _di++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const W2      = Math.floor(r * 1.75);
    const H2      = Math.max(4, Math.floor(r * 0.44));
    const fW      = W2 * 2;
    const fH      = H2 * 2;
    const iW      = fW - 6;
    const iH      = Math.max(2, fH - 6);
    const isLarge = r >= 17;
    const lightSide = dr() > 0.5 ? 1 : -1;

    const DEBRIS_COLORS = ['#4a5a40', '#3a4a34', '#2a3828'];
    const debris = [];
    const numDebris = 8 + Math.floor(dr() * 5);
    for (let i = 0; i < numDebris; i++) {
      const ang  = dr() * Math.PI * 2;
      const dist = 1.0 + dr() * 0.8;
      debris.push({
        dx:  Math.round(Math.cos(ang) * (W2 + dist * 6)),
        dy:  Math.round(Math.sin(ang) * (H2 + dist * 3)),
        w:   dr() > 0.5 ? 2 : 1,
        h:   dr() > 0.5 ? 2 : 1,
        col: DEBRIS_COLORS[Math.floor(dr() * 3)],
      });
    }

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

    const dL = 6 + Math.floor(dr() * 5);
    const dR = 6 + Math.floor(dr() * 5);
    const dU = 4 + Math.floor(dr() * 4);
    const dD = 4 + Math.floor(dr() * 4);
    const dusts = [
      { x: -(W2 + 2 + dL), y:  0,             w: dL, h: 1 },
      { x:   W2 + 2,       y:  0,             w: dR, h: 1 },
      { x:  0,             y: -(H2 + 2 + dU), w: 1, h: dU },
      { x:  0,             y:   H2 + 2,       w: 1, h: dD },
    ];

    const cracks = [];
    for (let row = 3; row < iH - 1; row += 3) {
      const maxCW  = Math.max(1, iW - 7);
      const crackW = 3 + Math.floor(dr() * maxCW);
      const crackO = Math.floor(dr() * Math.max(1, iW - crackW));
      cracks.push({ rx: crackO, ry: row, len: crackW });
    }

    const minerals = [];
    const numMin = 2 + Math.floor(dr() * 5);
    for (let i = 0; i < numMin; i++) {
      minerals.push({
        rx: Math.floor(dr() * Math.max(1, iW - 1)),
        ry: Math.floor(dr() * Math.max(1, iH - 1)),
      });
    }

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
      x: fx, y: fy,
      _animated: isLarge, // only large craters have animated Voidheart glow
      fW, fH, W2, H2, iW, iH, isLarge, lightSide,
      debris, chunks, dusts, cracks, minerals, voidCluster, goldVeins,

      // Static parts — drawn to the offscreen canvas once
      draw(ctx, px, py, f) {
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        // Outer debris
        for (const d of f.debris) {
          ctx.fillStyle = d.col;
          ctx.fillRect(cx + d.dx, cy + d.dy, d.w, d.h);
        }
        ctx.fillStyle = '#4a5a40';
        for (const c of f.chunks) ctx.fillRect(cx + c.dx, cy + c.dy, 4, 3);
        ctx.fillStyle = '#5a6a4a';
        for (const d of f.dusts) ctx.fillRect(cx + d.x, cy + d.y, d.w, d.h);
        // Raised rim
        ctx.fillStyle = '#2a3828';
        ctx.fillRect(cx - f.W2 - 1, cy - f.H2 - 1, f.fW + 2, f.fH + 2);
        ctx.fillStyle = '#3a4a32';
        ctx.fillRect(cx - f.W2, cy - f.H2, f.fW, f.fH);
        ctx.fillStyle = '#4a5a40';
        ctx.fillRect(cx - f.W2 + 3, cy - f.H2 + 2, f.iW, 1);
        ctx.fillRect(cx - f.W2 + 2, cy - f.H2 + 3, 1, f.iH);
        // Interior layers
        ctx.fillStyle = '#1a2818';
        ctx.fillRect(cx - f.W2 + 3, cy - f.H2 + 3, f.iW, f.iH);
        if (f.iW > 4 && f.iH > 4) {
          ctx.fillStyle = '#121e0e';
          ctx.fillRect(cx - f.W2 + 5, cy - f.H2 + 5, f.iW - 4, f.iH - 4);
        }
        if (f.iW > 8 && f.iH > 8) {
          ctx.fillStyle = '#0d1a0a';
          ctx.fillRect(cx - f.W2 + 7, cy - f.H2 + 7, f.iW - 8, f.iH - 8);
        }
        if (f.iW > 12 && f.iH > 12) {
          ctx.fillStyle = '#0d1a0a';
          ctx.fillRect(cx - f.W2 + 9, cy - f.H2 + 9, f.iW - 12, f.iH - 12);
        }
        const intL = cx - f.W2 + 3;
        const intT = cy - f.H2 + 3;
        ctx.fillStyle = '#2a3828';
        if (f.lightSide > 0) {
          ctx.fillRect(cx + f.W2 - 4, intT, 1, f.iH);
        } else {
          ctx.fillRect(intL, intT, 1, f.iH);
        }
        ctx.fillStyle = '#0d1a0a';
        for (const crack of f.cracks) ctx.fillRect(intL + crack.rx, intT + crack.ry, crack.len, 1);
        ctx.fillStyle = '#1a0018';
        for (const m of f.minerals) ctx.fillRect(intL + m.rx, intT + m.ry, 1, 1);
      },

      // Animated parts — drawn to Phaser Graphics each frame (large craters only)
      drawAnimated(gfx, px, py, f, t) {
        if (!f.isLarge) return;
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        const pulse     = (Math.sin(t * (Math.PI * 2 / 1.5)) + 1) / 2;
        const voidColor = pulse > 0.5 ? 0xaa0060 : 0x6a0040;
        // Glow halo
        gfx.fillStyle(0x2a0018, 0.8);
        gfx.fillRect(cx - 5, cy - 3, 10, 6);
        // Gold veins
        gfx.fillStyle(0xc8901a, 1);
        for (const g of f.goldVeins) gfx.fillRect(cx + g.dx, cy + g.dy, 1, 1);
        // Pulsing ore cluster
        gfx.fillStyle(voidColor, 1);
        for (const v of f.voidCluster) gfx.fillRect(cx + v.dx, cy + v.dy, 1, 1);
      },
    });
  });

  // ================================================================
  // SCORCHED PATCHES
  // ================================================================
  [
    [145, 0.44, 54, 24], [310, 0.78, 62, 28], [500, 0.30, 46, 20],
    [720, 0.62, 52, 24], [870, 0.48, 40, 18],
  ].forEach(([bx, by, bw, bh]) => {
    const fx = Math.max(40,   Math.min(920,  Math.round(bx + srf() * 80  - 40)));
    const fy = Math.max(0.20, Math.min(0.80, by + srf() * 0.16 - 0.08));
    const fw = Math.max(36,   Math.min(72,   Math.round(bw + srf() * 20  - 10)));
    const fh = Math.max(15,   Math.min(33,   Math.round(bh + srf() * 12  - 6)));
    features.push({
      x: fx, y: fy, w: fw, h: fh, _animated: false,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#0d1a0a';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ================================================================
  // SANDY PATCHES
  // ================================================================
  [
    [220, 0.55, 52, 22], [490, 0.20, 44, 18], [740, 0.80, 58, 26],
  ].forEach(([bx, by, bw, bh]) => {
    const fx = Math.max(40,   Math.min(920,  Math.round(bx + srf() * 80  - 40)));
    const fy = Math.max(0.15, Math.min(0.85, by + srf() * 0.16 - 0.08));
    const fw = Math.max(34,   Math.min(62,   Math.round(bw + srf() * 20  - 10)));
    const fh = Math.max(14,   Math.min(26,   Math.round(bh + srf() * 10  - 5)));
    features.push({
      x: fx, y: fy, w: fw, h: fh, _animated: false,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#695830';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ================================================================
  // RUBBLE PILES
  // ================================================================
  [
    [380, 0.48], [610, 0.33], [820, 0.68], [130, 0.82],
  ].forEach(([bx, by]) => {
    const fx = Math.max(30,   Math.min(930,  Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.25, Math.min(0.85, by + srf() * 0.14 - 0.07));
    features.push({
      x: fx, y: fy, _animated: false,
      draw(ctx, px, py) {
        ctx.fillStyle = '#2a3828';
        ctx.fillRect(px - 9, py - 4, 7, 5);
        ctx.fillRect(px + 0, py - 6, 5, 5);
        ctx.fillRect(px + 6, py - 3, 8, 5);
        ctx.fillRect(px - 4, py + 1, 6, 3);
        ctx.fillRect(px + 10, py,    4, 6);
      },
    });
  });

  // ================================================================
  // VOIDHEART ORE VEINS (animated)
  // ================================================================
  [
    [100, 0.30], [280, 0.54], [450, 0.36], [630, 0.63], [810, 0.44],
  ].forEach(([bx, by]) => {
    const fx = Math.max(60, Math.min(900, Math.round(bx + srf() * 120 - 60)));
    const fy = Math.max(0.15, Math.min(0.75, by + srf() * 0.18 - 0.09));

    let _vi = 0;
    const vr = () => {
      const v = ((Math.sin(fx * 11.73 + fy * 83.17 + _vi++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const SEG_W   = 5;
    const numSegs = 8 + Math.floor(vr() * 7);
    const segments = [];
    let cumDY = 0;
    for (let i = 0; i < numSegs; i++) {
      const jump = vr() > 0.65 ? 2 : 1;
      cumDY += jump * (vr() > 0.5 ? 1 : -1);
      segments.push({ sx: i * SEG_W, dy: cumDY });
    }

    const goldPixels = [];
    for (let i = 2; i < numSegs; i += 3) {
      goldPixels.push({ sx: segments[i].sx, dy: segments[i].dy, side: vr() > 0.5 ? 1 : -1 });
    }

    const numBranches = 2 + Math.floor(vr() * 2);
    const branches = [];
    for (let i = 0; i < numBranches; i++) {
      const segIdx = 1 + Math.floor(vr() * (numSegs - 2));
      const slope  = (0.55 + vr() * 0.45) * (vr() > 0.5 ? 1 : -1);
      branches.push({ segIdx, slope, len: 4 + Math.floor(vr() * 5) });
    }

    const midIdx = Math.floor(numSegs / 2);

    features.push({
      x: fx, y: fy, _animated: true,
      segments, goldPixels, branches, midIdx, SEG_W,

      // Static parts: staining bands, dark border layer, gold pixels, branch cracks
      draw(ctx, px, py, f) {
        const ox = Math.floor(px);
        const oy = Math.floor(py);
        // Surface staining
        ctx.fillStyle = '#2a1828';
        for (const seg of f.segments) {
          ctx.fillRect(ox + seg.sx, oy + seg.dy - 1, f.SEG_W, 1);
          ctx.fillRect(ox + seg.sx, oy + seg.dy + 3, f.SEG_W, 1);
        }
        // Static crack layers (dark border + main crack, no animated core)
        for (const seg of f.segments) {
          const sx = ox + seg.sx;
          const sy = oy + seg.dy;
          ctx.fillStyle = '#0d0804'; ctx.fillRect(sx, sy,     f.SEG_W, 1);
          ctx.fillStyle = '#1a0010'; ctx.fillRect(sx, sy + 1, f.SEG_W, 1);
          // Core placeholder (dark), overwritten by animated layer at runtime
          ctx.fillStyle = '#3a0028'; ctx.fillRect(sx, sy + 2, f.SEG_W, 1);
        }
        // Gold veining
        ctx.fillStyle = '#c8901a';
        for (const g of f.goldPixels) {
          const gx = g.side > 0 ? ox + g.sx + f.SEG_W : ox + g.sx - 2;
          ctx.fillRect(gx, oy + g.dy + 1, 2, 1);
        }
        // Branch cracks
        for (const b of f.branches) {
          const startSeg = f.segments[b.segIdx];
          const bx0 = ox + startSeg.sx + Math.floor(f.SEG_W / 2);
          const by0 = oy + startSeg.dy + 1;
          for (let i = 0; i < b.len; i++) {
            const bxi = bx0 + i;
            const byi = by0 + Math.round(i * b.slope);
            ctx.fillStyle = '#0d0804'; ctx.fillRect(bxi, byi - Math.sign(b.slope), 1, 1);
            ctx.fillStyle = '#1a0010'; ctx.fillRect(bxi, byi, 1, 1);
          }
        }
      },

      // Animated parts: pulsing glow rect + animated core colour on each segment
      drawAnimated(gfx, px, py, f, t) {
        const ox    = Math.floor(px);
        const oy    = Math.floor(py);
        const pulse   = (Math.sin(t * Math.PI) + 1) / 2; // 2-second cycle
        const coreHex = pulse > 0.5 ? 0xcc0060 : 0x6a0040;
        const glowW   = pulse > 0.82 ? 4 : 2;

        // Glow halo centred on mid segment
        const midSeg = f.segments[f.midIdx];
        gfx.fillStyle(0x1a0a18, 0.85);
        gfx.fillRect(
          ox + midSeg.sx - glowW, oy + midSeg.dy - glowW,
          f.SEG_W * 3 + glowW * 2, 3 + glowW * 2
        );

        // Animated core row overwrites the static placeholder colour
        gfx.fillStyle(coreHex, 1);
        for (const seg of f.segments) {
          gfx.fillRect(ox + seg.sx, oy + seg.dy + 2, f.SEG_W, 1);
        }
      },
    });
  });

  // ================================================================
  // UNSETTLING POOLS (animated)
  // ================================================================
  [
    [360, 0.58, false],
    [720, 0.42, true],
  ].forEach(([bx, by, hasEquip]) => {
    const fx = Math.max(60, Math.min(900, Math.round(bx + srf() * 100 - 50)));
    const fy = Math.max(0.20, Math.min(0.75, by + srf() * 0.16 - 0.08));

    let _pi = 0;
    const pr = () => {
      const v = ((Math.sin(fx * 19.31 + fy * 61.73 + _pi++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const baseW = 30 + Math.floor(pr() * 18);
    const baseH = 12 + Math.floor(pr() * 7);
    const numRects = 4 + Math.floor(pr() * 2);
    const rects = [{ dx: 0, dy: 0, w: baseW, h: baseH }];
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

    const numHL = 6 + Math.floor(pr() * 3);
    const highlights = [];
    for (let i = 0; i < numHL; i++) {
      highlights.push({
        bx:       Math.floor(pr() * (baseW - 6)) + 3,
        by:       Math.floor(pr() * (baseH - 4)) + 2,
        freqX:    0.12 + pr() * 0.20,
        freqY:    0.08 + pr() * 0.14,
        ampX:     1 + Math.floor(pr() * 3),
        ampY:     1 + Math.floor(pr() * 2),
        animated: i < 3,
        pulser:   i === 0,
      });
    }

    let equip = null;
    if (hasEquip) {
      const eW = 9  + Math.floor(pr() * 7);
      const eH = 5  + Math.floor(pr() * 4);
      equip = {
        eW, eH,
        edx: Math.floor((pr() - 0.5) * baseW * 0.4),
        edy: -Math.floor(eH * 0.35),
        bubbles: [
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.00, speed: 3.5 + pr() * 2 },
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.33, speed: 2.8 + pr() * 2 },
          { bdx: Math.floor(pr() * 5) - 2, phase: 0.67, speed: 4.2 + pr() * 2 },
        ],
      };
    }

    features.push({
      x: fx, y: fy, _animated: true,
      rects, innerW, innerH, baseW, baseH, highlights, equip,

      // Static parts: pool body, border, static highlights, equipment silhouette
      draw(ctx, px, py, f) {
        const left = Math.floor(px - f.baseW / 2);
        const top  = Math.floor(py - f.baseH / 2);
        // Glow halo
        ctx.fillStyle = '#0a2a00';
        for (const r of f.rects) ctx.fillRect(left + r.dx - 2, top + r.dy - 2, r.w + 4, r.h + 4);
        // Pool base
        ctx.fillStyle = '#0a1a00';
        for (const r of f.rects) ctx.fillRect(left + r.dx, top + r.dy, r.w, r.h);
        // Inner darkest zone
        ctx.fillStyle = '#061200';
        ctx.fillRect(
          left + Math.floor((f.baseW - f.innerW) / 2),
          top  + Math.floor((f.baseH - f.innerH) / 2),
          f.innerW, f.innerH);
        // Border
        ctx.fillStyle = '#1a3a00';
        ctx.fillRect(left,                top,                f.baseW, 1);
        ctx.fillRect(left,                top + f.baseH - 1, f.baseW, 1);
        ctx.fillRect(left,                top,                1, f.baseH);
        ctx.fillRect(left + f.baseW - 1, top,                1, f.baseH);
        // Static highlights
        for (const h of f.highlights) {
          if (h.animated) continue;
          ctx.fillStyle = '#44ff00';
          ctx.fillRect(left + h.bx, top + h.by, 1, 1);
        }
        // Equipment
        if (f.equip) {
          const eq  = f.equip;
          const eqX = left + Math.floor(f.baseW / 2) + eq.edx - Math.floor(eq.eW / 2);
          const eqY = top  + Math.floor(f.baseH / 2) + eq.edy;
          ctx.fillStyle = '#1a1808';
          ctx.fillRect(eqX, eqY, eq.eW, eq.eH);
          ctx.fillStyle = '#3a2808';
          ctx.fillRect(eqX + eq.eW - 1, eqY, 1, eq.eH);
        }
      },

      // Animated parts: drifting highlights, bubbles, pulser
      drawAnimated(gfx, px, py, f, t) {
        const left = Math.floor(px - f.baseW / 2);
        const top  = Math.floor(py - f.baseH / 2);

        for (const h of f.highlights) {
          if (!h.animated) continue;
          let hx = left + h.bx;
          let hy = top  + h.by;
          hx += Math.round(Math.sin(t * h.freqX * Math.PI * 2) * h.ampX);
          hy += Math.round(Math.sin(t * h.freqY * Math.PI * 2) * h.ampY);
          hx = Math.max(left + 1, Math.min(left + f.baseW - 2, hx));
          hy = Math.max(top  + 1, Math.min(top  + f.baseH - 2, hy));
          let hCol = 0x33cc00;
          if (h.pulser) {
            const bright = (Math.sin(t * 0.71 * Math.PI * 2 + 1.57) + 1) / 2;
            hCol = bright > 0.88 ? 0x88ff44 : 0x33cc00;
          }
          gfx.fillStyle(hCol, 1);
          gfx.fillRect(hx, hy, 1, 1);
        }

        if (f.equip) {
          const eq  = f.equip;
          const eqX = left + Math.floor(f.baseW / 2) + eq.edx - Math.floor(eq.eW / 2);
          const eqY = top  + Math.floor(f.baseH / 2) + eq.edy;
          const RISE = 10;
          gfx.fillStyle(0x22aa00, 1);
          for (const b of eq.bubbles) {
            const riseAmt = ((t * b.speed + b.phase * RISE) % RISE + RISE) % RISE;
            gfx.fillRect(eqX + Math.floor(eq.eW / 2) + b.bdx, eqY - Math.floor(riseAmt), 1, 1);
          }
        }
      },
    });
  });

  // ================================================================
  // EXCAVATION PITS
  // ================================================================
  [
    [160, 0.10], [360, 0.38], [560, 0.15], [800, 0.48],
  ].forEach(([bx, by]) => {
    const fx = Math.max(30,   Math.min(920,  Math.round(bx + srf() * 80 - 40)));
    const fy = Math.max(0.05, Math.min(0.60, by + srf() * 0.12 - 0.06));

    let _ei = 0;
    const er = () => {
      const v = ((Math.sin(fx * 11.3 + fy * 59.7 + _ei++) * 9301 + 49297) % 233280) / 233280;
      return Math.max(0, Math.min(1, (v - 0.1715) / (0.2512 - 0.1715)));
    };

    const PIT_W  = 52;
    const PIT_D  = 20;
    const BEAM_W = 4;

    const numDebris = 3 + Math.floor(er() * 2);
    const pitDebris = [];
    for (let i = 0; i < numDebris; i++) {
      const innerW = PIT_W - BEAM_W * 2 - 4;
      pitDebris.push({
        rx:    BEAM_W + 2 + Math.floor(er() * Math.max(1, innerW)),
        isOre: i < (1 + Math.floor(er() * 2)),
      });
    }

    const cabX1 = BEAM_W + 2 + Math.floor(er() * 8);
    const cabY1 = 2      + Math.floor(er() * 4);
    const cabX2 = BEAM_W + 10 + Math.floor(er() * 12);
    const cabY2 = PIT_D  - 6;

    features.push({
      x: fx, y: fy, _animated: false,
      PIT_W, PIT_D, BEAM_W, pitDebris, cabX1, cabY1, cabX2, cabY2,

      draw(ctx, px, py, f) {
        const lx = Math.floor(px - f.PIT_W / 2);
        const ty = Math.floor(py);
        // Bright outline
        ctx.fillStyle = '#8a9a78';
        ctx.fillRect(lx - 1, ty - 3, f.PIT_W + 2, f.PIT_D + 4);
        // ID label plate
        ctx.fillStyle = '#2a2820';
        ctx.fillRect(lx + Math.floor(f.PIT_W / 2) - 4, ty - 8, 8, 3);
        ctx.fillStyle = '#8a9a78';
        ctx.fillRect(lx + Math.floor(f.PIT_W / 2) - 3, ty - 7, 1, 1);
        ctx.fillRect(lx + Math.floor(f.PIT_W / 2) + 2, ty - 7, 1, 1);
        // Wall strata
        const strataTones = ['#1a2818', '#121e0e', '#1a2818'];
        for (let d = 0; d < f.PIT_D; d++) {
          ctx.fillStyle = strataTones[d % 3];
          ctx.fillRect(lx + f.BEAM_W, ty + d, f.PIT_W - f.BEAM_W * 2, 1);
        }
        // Floor
        for (let row = 0; row < 4; row++) {
          ctx.fillStyle = row % 2 === 0 ? '#0d1a0a' : '#0a1200';
          ctx.fillRect(lx + f.BEAM_W, ty + f.PIT_D - 4 + row, f.PIT_W - f.BEAM_W * 2, 1);
        }
        // Floor debris
        for (const d of f.pitDebris) {
          ctx.fillStyle = d.isOre ? '#3a0828' : '#3a4a34';
          ctx.fillRect(lx + d.rx, ty + f.PIT_D - 3, 2, 1);
        }
        // Broken cable (Bresenham approximation using horizontal slices)
        ctx.fillStyle = '#2a2a2a';
        const dx = f.cabX2 - f.cabX1;
        const dy = f.cabY2 - f.cabY1;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        for (let s = 0; s <= steps; s++) {
          const t = steps > 0 ? s / steps : 0;
          const cx2 = Math.round(lx + f.cabX1 + t * dx);
          const cy2 = Math.round(ty + f.cabY1 + t * dy);
          ctx.fillRect(cx2, cy2, 1, 1);
        }
        // Frayed end at cabX2 (3 diverging 1-px lines)
        ctx.fillRect(lx + f.cabX2 + 1, ty + f.cabY2 - 1, 2, 1);
        ctx.fillRect(lx + f.cabX2 + 1, ty + f.cabY2,     1, 1);
        ctx.fillRect(lx + f.cabX2 + 2, ty + f.cabY2 + 1, 2, 1);
        // Metal beam supports
        ctx.fillStyle = '#2a3020';
        ctx.fillRect(lx, ty, f.BEAM_W, f.PIT_D);
        ctx.fillRect(lx + f.PIT_W - f.BEAM_W, ty, f.BEAM_W, f.PIT_D);
        // Rivet highlights on beams
        ctx.fillStyle = '#5a6a50';
        for (let rv = 4; rv < f.PIT_D - 4; rv += 6) {
          ctx.fillRect(lx + 1,                     ty + rv, 2, 2);
          ctx.fillRect(lx + f.PIT_W - f.BEAM_W + 1, ty + rv, 2, 2);
        }
        // Warning stripes (top rim, alternating #ffaa00 / #1a1a00)
        const stripeW = 6;
        for (let sx2 = 0; sx2 < f.PIT_W; sx2 += stripeW * 2) {
          ctx.fillStyle = '#ffaa00';
          ctx.fillRect(lx + sx2,           ty - 3, stripeW, 3);
          ctx.fillStyle = '#1a1a00';
          ctx.fillRect(lx + sx2 + stripeW, ty - 3, stripeW, 3);
        }
      },
    });
  });

  return features;
}
