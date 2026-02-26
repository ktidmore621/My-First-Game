/* ============================================================
   PilotGameState.js
   ============================================================
   The main gameplay screen for PILOT MODE.

   Left stick = movement. Right stick = weapon aim direction.
   HUD shows health bar, mode label, and elapsed time.

   BACKGROUND SYSTEM:
     The sky is drawn as flat horizontal colour bands (no gradients).
     The ground is a single tiled layer that scrolls right-to-left,
     giving the feeling of flying forward over enemy territory.
     Scroll speed is derived from the plane's Speed stat so faster
     planes feel faster. See _drawSky() and _drawGround() below.

   VISUAL STYLE (see Visual Style Guide in CLAUDE.md):
     - ctx.imageSmoothingEnabled = false set at the top of render()
     - Sky: four flat colour bands, no createLinearGradient
     - Ground base: three flat colour bands, no createLinearGradient
     - Ground features: fillRect only — no ellipse() or arc()

   WHAT TO BUILD NEXT:
     - Parallax mid-ground and far-hill layers for depth
     - Enemy objects with world-space positions that scroll with the ground
     - Bullet/projectile firing
     - Collision detection
     - Mission completion condition
   ============================================================ */

class PilotGameState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;

    // The player's plane (set in PlaneSelectState; fall back to default)
    this._player = gameData.selectedPlane || new Plane({
      id: 'default', name: 'Fighter',
      speed: 70, durability: 80, weaponSize: 60, maneuverability: 70,
      x: 100, y: 270,
    });

    // Aim angle in radians (0 = pointing right)
    this._aimAngle = 0;

    this._elapsedTime     = 0;
    this._gameOverPending = false;

    this._W = 960;
    this._H = 540;

    // ---- Ground scrolling setup ----
    // The tile width matches the canvas width so exactly one tile fills the screen.
    // We always draw two tiles side-by-side and shift them left each frame,
    // creating seamless looping. See _drawGround() for details.
    this._TILE_W = 960;

    // Accumulated scroll distance in pixels (grows without bound; we use % when drawing)
    this._groundOffset = 0;

    // Scroll speed in pixels/second, driven by the plane's Speed stat:
    //   speed =   0  →  55 px/s  (slowest, barely creeping)
    //   speed =  50  → 138 px/s  (moderate)
    //   speed = 100  → 220 px/s  (feels fast)
    this._scrollSpeed = 55 + (this._player.speed / 100) * 165;

    // Pre-build the ground detail array once so we don't allocate each frame
    this._groundFeatures = _buildGroundFeatures();

    // Register death callback
    this._player.health.onDeath(() => {
      if (!this._gameOverPending) {
        this._gameOverPending = true;
        this._gameData.score  = Math.floor(this._elapsedTime * 10);
        this._gameData.result = 'defeated';
        setTimeout(() => {
          this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
        }, 800);
      }
    });
  }

  enter() {
    console.log('[State] Pilot Mode — plane:', this._player.name,
      '| ground scroll:', Math.round(this._scrollSpeed), 'px/s');
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    this._elapsedTime += dt;

    // Advance the ground scroll by this frame's time slice.
    // Not calling this line is how a pause screen would freeze the background.
    this._groundOffset += this._scrollSpeed * dt;

    // --- Player movement ---
    const maxSpeed = (this._player.speed           / 100) * 220;
    const turnRate = (this._player.maneuverability  / 100) * 10 + 4;

    if (this._input.leftStick.active) {
      this._player.velocityX += (this._input.leftStick.x * maxSpeed - this._player.velocityX) * turnRate * dt;
      this._player.velocityY += (this._input.leftStick.y * maxSpeed - this._player.velocityY) * turnRate * dt;

      const spd = Math.hypot(this._player.velocityX, this._player.velocityY);
      if (spd > 15) {
        this._player.angle = Math.atan2(this._player.velocityY, this._player.velocityX);
      }
    } else {
      this._player.velocityX *= 0.88;
      this._player.velocityY *= 0.88;
    }

    this._player.x += this._player.velocityX * dt;
    this._player.y += this._player.velocityY * dt;

    const hw = this._player.width  / 2;
    const hh = this._player.height / 2;
    this._player.x = Math.max(hw,      Math.min(this._W - hw,      this._player.x));
    this._player.y = Math.max(hh + 30, Math.min(this._H - hh - 30, this._player.y));

    // --- Aim ---
    if (this._input.rightStick.active) {
      const rx = this._input.rightStick.x;
      const ry = this._input.rightStick.y;
      if (Math.hypot(rx, ry) > 0.1) {
        this._aimAngle = Math.atan2(ry, rx);
      }
    }

    // --- Button placeholders ---
    if (this._input.wasTappedInRegion(820, 460, 130, 58)) {
      console.log('[Input] Weapon Select tapped — implement weapon cycling here');
    }
    if (this._input.wasTappedInRegion(680, 460, 130, 58)) {
      console.log('[Input] Evade tapped — implement defensive maneuver here');
    }

    // --- Placeholder: auto game-over at 30 s ---
    // Remove when real win/lose conditions are in place.
    if (this._elapsedTime > 30 && !this._gameOverPending) {
      this._gameOverPending = true;
      this._gameData.score  = Math.floor(this._elapsedTime * 10);
      this._gameData.result = 'survived';
      this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render(ctx) {
    ctx.imageSmoothingEnabled = false; // pixel-art style — no interpolation (Visual Style Guide rule 2)
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // Draw back-to-front so later layers paint over earlier ones
    this._drawSky(ctx, W, H);
    this._drawGround(ctx, W, H);

    // Placeholder enemy markers (static screen-space for now; will scroll with ground later)
    _drawPlaceholderEnemy(ctx, 400, H * 0.72 - 18, '▲ AA Gun');
    _drawPlaceholderEnemy(ctx, 620, H * 0.72 - 18, '▲ Missile');
    _drawPlaceholderEnemy(ctx, 820, H * 0.72 - 22, '▲ Base');

    // Aim indicator line from the plane nose
    if (this._input.rightStick.active) {
      ctx.save();
      ctx.translate(this._player.x, this._player.y);
      ctx.rotate(this._aimAngle);
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.55)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(this._player.width / 2, 0);
      ctx.lineTo(this._player.width / 2 + 180, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    this._player.render(ctx);
    this._renderHUD(ctx);
    this._input.renderSticks(ctx);

    _drawHUDButton(ctx, 820, 460, 130, 58, 'WEAPON\nSELECT', '#1a2a3a', '#4488aa');
    _drawHUDButton(ctx, 680, 460, 130, 58, 'EVADE',           '#2a1a3a', '#aa44aa');
  }

  // ==========================================================
  // BACKGROUND: SKY (static)
  // ==========================================================

  // The sky is a fixed set of flat colour bands — it never scrolls.
  // Hard-edged horizontal strips step from deep navy at the top down to
  // a hazy blue near the horizon.  No gradients (Visual Style Guide rule 1).
  _drawSky(ctx, W, H) {
    const horizonY = Math.floor(H * 0.72);

    // Flat banded sky — four distinct colour strips
    ctx.fillStyle = '#07101f';                                               // Deep navy (zenith)
    ctx.fillRect(0, 0, W, Math.floor(horizonY * 0.35));

    ctx.fillStyle = '#0d1e38';                                               // Dark blue (upper-mid)
    ctx.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));

    ctx.fillStyle = '#122848';                                               // Steel blue (lower-mid)
    ctx.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));

    ctx.fillStyle = '#1e3a52';                                               // Hazy blue (near horizon)
    ctx.fillRect(0, Math.floor(horizonY * 0.85), W, horizonY - Math.floor(horizonY * 0.85));

    // Warm amber strip at the horizon — distant fires, flat solid colour
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(0, horizonY - 8, W, 8);

    // Stars as 2×2 pixel squares — no arc(), no anti-aliasing (Visual Style Guide rule 4)
    ctx.fillStyle = '#c8d8e8';
    [
      [44, 12], [148, 28], [268, 10], [400, 22],
      [520, 8 ], [640, 32], [760, 18], [880, 8 ],
      [100, 52], [340, 44], [590, 48], [820, 38],
    ].forEach(([sx, sy]) => {
      ctx.fillRect(sx, sy, 2, 2);
    });
  }

  // ==========================================================
  // BACKGROUND: GROUND (scrolling)
  // ==========================================================

  // The ground scrolls right-to-left by tiling a 960px-wide pattern.
  //
  // HOW SEAMLESS TILING WORKS:
  //   Each frame, _groundOffset grows by (scrollSpeed * dt) pixels.
  //   We compute  shift = _groundOffset % TILE_W  (always 0–959).
  //   Then we draw tiles starting at x = -shift, stepping by TILE_W:
  //     tile at x = -shift          (partially off-screen left)
  //     tile at x = -shift + 960    (fills the right remainder)
  //   Together they always cover the full 960px canvas.
  //   When shift wraps from 959 back to 0, both tiles are in the same
  //   relative positions — the seam is invisible because the tile
  //   content at its left edge matches its right edge.
  _drawGround(ctx, W, H) {
    const horizonY = H * 0.72;
    const groundH  = H - horizonY;

    // Flat banded ground — three colour strips, no gradients (Visual Style Guide rule 1)
    ctx.fillStyle = '#4a3820';                                               // Sandy tan (near horizon)
    ctx.fillRect(0, Math.floor(horizonY),                              W, Math.floor(groundH * 0.30));

    ctx.fillStyle = '#3c2e16';                                               // Mid earth
    ctx.fillRect(0, Math.floor(horizonY + groundH * 0.30),             W, Math.floor(groundH * 0.40));

    ctx.fillStyle = '#2a2010';                                               // Dark base (screen bottom)
    ctx.fillRect(0, Math.floor(horizonY + groundH * 0.70),             W, Math.ceil(groundH  * 0.30));

    // Horizon edge — 2px fillRect, not strokeRect, to avoid sub-pixel bleed
    ctx.fillStyle = '#5e4a28';
    ctx.fillRect(0, Math.floor(horizonY), W, 2);

    // Draw scrolling detail tiles
    const shift = this._groundOffset % this._TILE_W;
    for (let tileX = -shift; tileX < W; tileX += this._TILE_W) {
      this._drawGroundTile(ctx, tileX, horizonY, groundH);
    }
  }

  // Draws one full tile of ground detail at the given x position.
  // Called once or twice per frame (for the two side-by-side tiles).
  // All feature positions are relative to tileX, so results are identical
  // for every tile copy — this is what makes the loop seamless.
  _drawGroundTile(ctx, tileX, horizonY, groundH) {
    this._groundFeatures.forEach(f => {
      // f.x is the feature's position within the tile (0–960)
      // f.y is a 0–1 fraction of ground height (0 = horizon, 1 = screen bottom)
      f.draw(ctx, tileX + f.x, horizonY + f.y * groundH, f);
    });
  }

  // ==========================================================
  // HUD
  // ==========================================================

  _renderHUD(ctx) {
    const W = ctx.canvas.width;

    ctx.fillStyle = '#aaccdd';
    ctx.font      = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('HULL', 12, 24);
    this._player.health.renderBar(ctx, 55, 10, 180, 18);

    ctx.fillStyle = '#5bc8f5';
    ctx.font      = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('✈  PILOT MODE', W / 2, 24);

    ctx.fillStyle = '#aaaaaa';
    ctx.font      = '14px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('T+' + Math.floor(this._elapsedTime) + 's', W - 12, 24);
  }
}

/* ============================================================
   GROUND FEATURE BUILDER
   ============================================================
   Returns an array of feature objects. Each object stores:
     x     — pixel position within the 960px tile (0–960)
     y     — fractional depth in the ground area (0 = horizon, 1 = bottom)
     draw  — function(ctx, px, py, self) that renders the feature

   Built once in the constructor and reused every frame.
   The draw functions use only ctx primitives — no images needed.
   ============================================================ */

function _buildGroundFeatures() {
  const features = [];

  // ---- Roads ----
  // Each road spans the full 960px tile width so it appears as a continuous
  // horizontal band across the scrolling ground.
  [[0.13], [0.52]].forEach(([yFrac]) => {
    features.push({
      x: 0, y: yFrac,
      draw(ctx, px, py) {
        // Dark asphalt strip
        ctx.fillStyle = 'rgba(30, 22, 14, 0.78)';
        ctx.fillRect(px, py - 5, 960, 10);
        // Faded centre-line dashes (spacing chosen to look natural at scroll speed)
        ctx.fillStyle = 'rgba(58, 48, 32, 0.55)';
        for (let mx = 0; mx < 960; mx += 60) {
          ctx.fillRect(px + mx, py - 1, 28, 2);
        }
      },
    });
  });

  // ---- Bomb craters ----
  // Dark rectangular pits with a sandy ejecta ring — pixel-art style, no ellipses.
  [
    [75,  0.28, 14], [195, 0.65, 17], [330, 0.38, 11],
    [460, 0.72, 19], [560, 0.22, 13], [680, 0.58, 15],
    [790, 0.42, 12], [900, 0.75, 18],
  ].forEach(([fx, fy, r]) => {
    features.push({
      x: fx, y: fy, r,
      draw(ctx, px, py, f) {
        // Sandy blast ring — flat rectangle (Visual Style Guide rule 4)
        const rw = Math.floor(f.r * 3.5);
        const rh = Math.floor(f.r * 0.88);
        ctx.fillStyle = '#644e26';
        ctx.fillRect(Math.floor(px - rw / 2), Math.floor(py - rh / 2), rw, rh);
        // Dark crater pit — smaller inner rectangle
        const pw = Math.floor(f.r * 2);
        const ph = Math.max(4, Math.floor(f.r * 0.5));
        ctx.fillStyle = '#100a04';
        ctx.fillRect(Math.floor(px - pw / 2), Math.floor(py - ph / 2), pw, ph);
      },
    });
  });

  // ---- Scorched / burned patches ----
  // Dark solid rectangles — napalm strikes, oil fires, vehicle burn-outs.
  // Pixel-art style: flat rectangles, no ellipses (Visual Style Guide rule 4).
  [
    [145, 0.44, 54, 24], [310, 0.78, 62, 28], [500, 0.30, 46, 20],
    [720, 0.62, 52, 24], [870, 0.48, 40, 18],
  ].forEach(([fx, fy, w, h]) => {
    features.push({
      x: fx, y: fy, w, h,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#0e0903';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ---- Sandy lighter patches ----
  // Flat tan rectangles to break up the uniform ground colour.
  // Pixel-art style: solid fillRect, no ellipses (Visual Style Guide rule 4).
  [
    [220, 0.55, 52, 22], [490, 0.20, 44, 18], [740, 0.80, 58, 26],
  ].forEach(([fx, fy, w, h]) => {
    features.push({
      x: fx, y: fy, w, h,
      draw(ctx, px, py, f) {
        ctx.fillStyle = '#695830';
        ctx.fillRect(Math.floor(px - f.w / 2), Math.floor(py - f.h / 2), f.w, f.h);
      },
    });
  });

  // ---- Rubble piles ----
  // Clusters of small rectangles simulating broken concrete and debris.
  [
    [380, 0.48], [610, 0.33], [820, 0.68], [130, 0.82],
  ].forEach(([fx, fy]) => {
    features.push({
      x: fx, y: fy,
      draw(ctx, px, py) {
        ctx.fillStyle = '#38281a';
        ctx.fillRect(px - 9, py - 4, 7, 5);
        ctx.fillRect(px + 0, py - 6, 5, 5);
        ctx.fillRect(px + 6, py - 3, 8, 5);
        ctx.fillRect(px - 4, py + 1, 6, 3);
        ctx.fillRect(px + 10, py,    4, 6);
      },
    });
  });

  return features;
}

/* ============================================================
   LOCAL HELPERS
   ============================================================ */

function _drawPlaceholderEnemy(ctx, x, y, label) {
  ctx.fillStyle   = 'rgba(180, 40, 40, 0.55)';
  ctx.fillRect(x - 20, y, 40, 18);
  ctx.strokeStyle = '#ff5555';
  ctx.lineWidth   = 1;
  ctx.strokeRect(x - 20, y, 40, 18);
  ctx.fillStyle   = '#ffaaaa';
  ctx.font        = '11px Arial';
  ctx.textAlign   = 'center';
  ctx.fillText(label, x, y - 4);
}

function _drawHUDButton(ctx, x, y, w, h, label, bgColor, borderColor) {
  ctx.globalAlpha = 0.82;
  ctx.fillStyle   = bgColor;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 14px Arial';
  ctx.textAlign = 'center';

  const lines  = label.split('\n');
  const lineH  = 17;
  const startY = y + h / 2 - (lines.length - 1) * lineH / 2 + 5;
  lines.forEach((line, i) => ctx.fillText(line, x + w / 2, startY + i * lineH));
}
