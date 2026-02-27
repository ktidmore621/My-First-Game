/* ============================================================
   PilotGameState.js
   ============================================================
   The main gameplay screen for PILOT MODE.

   Left stick = movement (all directions). Right stick = weapon aim.
   HUD shows health bar, mode label, and elapsed time.

   ----------------------------------------------------------------
   CAMERA & WORLD OFFSET SYSTEM
   ----------------------------------------------------------------
   The battlefield is a wide fixed arena — 5× the canvas width
   (4800px). The player has a world-space position (_worldX) that
   tracks where they are inside that arena.

   Each frame, the CAMERA OFFSET (_cameraX) is computed so the
   player stays horizontally centred on screen:

       _cameraX = clamp(_worldX − W/2,  0,  BATTLEFIELD_W − W)

   The player's SCREEN X is then derived from the two world values:

       player.x = _worldX − _cameraX

   While the player is away from both battlefield edges, _cameraX
   tracks _worldX exactly and player.x stays at W/2 (≈ 480) — the
   world moves, the ship holds still. Near either edge, the camera
   clamp kicks in; the player drifts toward the edge of the screen,
   making the boundary feel solid. A darkening vignette reinforces
   the wall (see _drawBoundaryIndicator).

   The ground and all world objects are drawn using _cameraX as
   their scroll offset:
     - Moving right  → _worldX grows → _cameraX grows → ground
       shifts left.
     - Moving left   → _cameraX shrinks → ground shifts right.
     - Holding still → _cameraX constant → world holds still.

   Vertical movement (up/down) is screen-space only — the camera
   does not pan vertically.

   ----------------------------------------------------------------
   BACKGROUND SYSTEM
   ----------------------------------------------------------------
   The sky is flat horizontal colour bands — it never scrolls.
   The ground is a single tiled layer (960px wide) drawn at an
   offset of (_cameraX % TILE_W), creating seamless looping that
   responds to actual player movement rather than a fixed clock.

   VISUAL STYLE (see Visual Style Guide in CLAUDE.md):
     - ctx.imageSmoothingEnabled = false at the top of render()
     - Sky: four flat colour bands, no createLinearGradient
     - Ground base: three flat colour bands, no createLinearGradient
     - Ground features: fillRect only — no ellipse() or arc()

   WHAT TO BUILD NEXT:
     - Parallax mid-ground and far-hill layers for depth
     - Enemy objects with world-space positions that scroll with ground
     - Bullet / projectile firing from the aim direction
     - Collision detection (AABB)
     - Real mission objectives replacing the 30-second placeholder
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
      x: 480, y: 270,
    });

    // Aim angle in radians (0 = pointing right)
    this._aimAngle = 0;

    this._elapsedTime     = 0;
    this._gameOverPending = false;

    this._W = 960;
    this._H = 540;

    // ================================================================
    // CAMERA & WORLD OFFSET SYSTEM
    // ================================================================

    // Total width of the playable battlefield in world-space pixels.
    // 5× the canvas width gives a wide arena without being infinite.
    this._BATTLEFIELD_W = this._W * 5; // 4800 px

    // _worldX: player's current X position in world space (pixels).
    //   Range: [player.width/2 … BATTLEFIELD_W − player.width/2]
    //   Starts at W/2 so the player appears screen-centred at game start
    //   with the left edge of the battlefield visible.
    this._worldX = this._W / 2; // 480 px

    // _cameraX: world-space X of the screen's left edge (pixels).
    //   Computed every frame in update(). Range: [0 … BATTLEFIELD_W − W].
    //   While the player is mid-field, this equals _worldX − W/2.
    //   Near the left/right battlefield edge it clamps so we never
    //   render outside the arena.
    this._cameraX = 0;

    // ---- Ground tile setup ----
    // Tile width = canvas width. Two tiles drawn side-by-side, shifted by
    // (_cameraX % TILE_W), create seamless looping. See _drawGround().
    this._TILE_W = 960;

    // Pre-build the ground detail array once so we don't allocate each frame.
    this._groundFeatures = _buildGroundFeatures();

    // ---- Placeholder enemy world positions ----
    // Markers placed at fixed world-space X coordinates across the battlefield.
    // Each is drawn at (worldX − _cameraX) so it scrolls with the ground.
    // Replace with real entity classes when enemy logic is implemented.
    this._enemyPlaceholders = [
      { worldX: 1200, screenY: this._H * 0.72 - 18, label: '▲ AA Gun'  },
      { worldX: 2400, screenY: this._H * 0.72 - 18, label: '▲ Missile' },
      { worldX: 3600, screenY: this._H * 0.72 - 22, label: '▲ Base'    },
    ];

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
      '| battlefield:', this._BATTLEFIELD_W, 'px wide',
      '| starting worldX:', Math.round(this._worldX));
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    this._elapsedTime += dt;

    // ---- Player movement ----
    // velocityX moves the player through WORLD space (drives _worldX).
    // velocityY moves the player through SCREEN space (drives player.y).
    // Both are driven by the left thumbstick.
    const maxSpeed = (this._player.speed          / 100) * 220;
    const turnRate = (this._player.maneuverability / 100) * 10 + 4;

    if (this._input.leftStick.active) {
      // Smooth velocity toward the stick target using turnRate as a lerp speed
      this._player.velocityX += (this._input.leftStick.x * maxSpeed - this._player.velocityX) * turnRate * dt;
      this._player.velocityY += (this._input.leftStick.y * maxSpeed - this._player.velocityY) * turnRate * dt;

      // Rotate the plane to face its direction of travel when moving fast enough
      const spd = Math.hypot(this._player.velocityX, this._player.velocityY);
      if (spd > 15) {
        this._player.angle = Math.atan2(this._player.velocityY, this._player.velocityX);
      }
    } else {
      // Decelerate naturally when no stick input
      this._player.velocityX *= 0.88;
      this._player.velocityY *= 0.88;
    }

    // ---- Horizontal: advance the player through world space ----
    // _worldX is the authoritative position. The screen X is derived
    // later from _worldX and _cameraX — the player never flies to the
    // edge of the canvas under normal conditions.
    this._worldX += this._player.velocityX * dt;

    // Hard boundary: clamp to the battlefield edges so the player cannot
    // fly off the left or right end of the arena.
    const hw = this._player.width  / 2;
    this._worldX = Math.max(hw, Math.min(this._BATTLEFIELD_W - hw, this._worldX));

    // ---- Vertical: move the player within screen space ----
    // The camera does not pan vertically, so player.y is screen-space only.
    this._player.y += this._player.velocityY * dt;
    const hh = this._player.height / 2;
    this._player.y = Math.max(hh + 30, Math.min(this._H - hh - 30, this._player.y));

    // ---- Update camera offset ----
    // The camera tries to keep the player at the horizontal mid-point of the
    // screen. It is clamped so it never shows area outside the battlefield:
    //   Left clamp  (_cameraX >= 0):              don't reveal left of arena
    //   Right clamp (_cameraX <= BATTLEFIELD_W−W): don't reveal right of arena
    this._cameraX = Math.max(
      0,
      Math.min(this._BATTLEFIELD_W - this._W, this._worldX - this._W / 2)
    );

    // Derive the player's SCREEN X from world position and camera offset.
    // In the middle of the battlefield this equals W/2 (480px) — centred.
    // Near a battlefield edge the camera clamps and the player drifts
    // toward the screen edge, making the wall feel solid.
    this._player.x = this._worldX - this._cameraX;

    // ---- Aim ----
    if (this._input.rightStick.active) {
      const rx = this._input.rightStick.x;
      const ry = this._input.rightStick.y;
      if (Math.hypot(rx, ry) > 0.1) {
        this._aimAngle = Math.atan2(ry, rx);
      }
    }

    // ---- Button placeholders ----
    if (this._input.wasTappedInRegion(820, 460, 130, 58)) {
      console.log('[Input] Weapon Select tapped — implement weapon cycling here');
    }
    if (this._input.wasTappedInRegion(680, 460, 130, 58)) {
      console.log('[Input] Evade tapped — implement defensive maneuver here');
    }

    // ---- Placeholder: auto game-over at 30 s ----
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

    // Subtle darkening at the screen edge when the player is near a
    // battlefield boundary — signals the hard wall before they hit it
    this._drawBoundaryIndicator(ctx, W, H);

    // Placeholder enemy markers at their world-space positions.
    // screenX = worldX − _cameraX. Skip markers that are off-screen.
    this._enemyPlaceholders.forEach(e => {
      const screenX = e.worldX - this._cameraX;
      if (screenX > -40 && screenX < W + 40) {
        _drawPlaceholderEnemy(ctx, screenX, e.screenY, e.label);
      }
    });

    // Aim indicator line from the plane nose (right-stick active only)
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
  // BOUNDARY INDICATOR
  // ==========================================================

  // Draws a dark vignette strip at the left or right screen edge when the
  // player approaches a battlefield boundary. The overlay fades in over the
  // last FADE_DIST world-pixels before the wall, reaching max alpha (0.5)
  // exactly at the hard boundary clamp.
  _drawBoundaryIndicator(ctx, W, H) {
    const FADE_DIST  = 300; // world-px from boundary where fade begins
    const VIGNETTE_W = 120; // screen-px width of the darkened edge strip

    // How far the player's hull edge is from each battlefield boundary
    const distLeft  = this._worldX - (this._player.width / 2);
    const distRight = (this._BATTLEFIELD_W - this._player.width / 2) - this._worldX;

    if (distLeft < FADE_DIST) {
      const alpha = (1 - distLeft / FADE_DIST) * 0.5;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, VIGNETTE_W, H);
    }

    if (distRight < FADE_DIST) {
      const alpha = (1 - distRight / FADE_DIST) * 0.5;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
      ctx.fillRect(W - VIGNETTE_W, 0, VIGNETTE_W, H);
    }
  }

  // ==========================================================
  // BACKGROUND: SKY (static)
  // ==========================================================

  // The sky is a fixed set of flat colour bands — it never scrolls.
  // Hard-edged horizontal strips step from deep navy at the top down to
  // a hazy blue near the horizon. No gradients (Visual Style Guide rule 1).
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
  // BACKGROUND: GROUND (camera-driven scrolling)
  // ==========================================================

  // The ground tiles scroll in response to _cameraX — the world-space X
  // of the screen's left edge. This means the ground holds perfectly still
  // when the player holds still, and moves at exactly the player's speed
  // when flying left or right.
  //
  // HOW CAMERA-DRIVEN TILING WORKS:
  //   _cameraX represents how many world-pixels we've scrolled from the
  //   left edge of the battlefield. We take shift = _cameraX % TILE_W
  //   (always 0–959) and draw tiles starting at x = -shift:
  //     tile at x = -shift          (left tile, partially off-screen left)
  //     tile at x = -shift + 960    (right tile, fills the remainder)
  //   Together they cover the full 960px canvas every frame.
  //   As _cameraX grows (moving right) shift grows, tiles march leftward.
  //   When _cameraX stops changing the tiles lock in place.
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

    // Scroll ground detail tiles using _cameraX as the source.
    // _cameraX is the world-left edge of the screen; modding by TILE_W
    // gives the sub-tile pixel offset to shift the repeating pattern.
    const shift = this._cameraX % this._TILE_W;
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
