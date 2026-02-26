/* ============================================================
   PilotGameState.js
   ============================================================
   The main gameplay screen for PILOT MODE.

   The player flies their chosen plane over enemy territory.
   Left stick = movement. Right stick = weapon aim direction.
   HUD shows health bar, mode label, and elapsed time.

   CURRENT STATE (foundation):
     - Smooth plane movement with momentum
     - Screen-boundary clamping (can't fly off-screen)
     - Aim angle updated from right stick
     - Dashed aim indicator line from nose of plane
     - Placeholder buttons for Weapon Select and Evade
     - Auto-transitions to GameOverState after 30 seconds
       (remove this when enemy logic is implemented)

   WHAT TO BUILD NEXT HERE:
     - Scrolling ground background
     - Enemy objects (anti-aircraft guns, missile launchers, bases)
     - Bullet/projectile firing from the plane
     - Collision detection
     - Mission completion condition (destroy all targets / reach destination)
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

    // Aim angle in radians — updated by right stick, used by weapons
    // 0 = pointing right, π/2 = pointing down, etc.
    this._aimAngle = 0;

    this._elapsedTime      = 0;
    this._gameOverPending  = false;

    // Game canvas dimensions (must match GAME_WIDTH / GAME_HEIGHT in main.js)
    this._W = 960;
    this._H = 540;

    // Register death callback — when the plane's health hits zero, end the game
    this._player.health.onDeath(() => {
      if (!this._gameOverPending) {
        this._gameOverPending   = true;
        this._gameData.score    = Math.floor(this._elapsedTime * 10);
        this._gameData.result   = 'defeated';
        setTimeout(() => {
          this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
        }, 800); // Brief delay so player sees the moment of destruction
      }
    });
  }

  enter() {
    console.log('[State] Pilot Mode — flying:', this._player.name);
  }

  exit() {}

  // ==========================================================
  // UPDATE — game logic runs here every frame
  // ==========================================================

  update(dt) {
    this._elapsedTime += dt;

    // --- Movement ---
    // Convert the left stick's -1→+1 values into actual pixels-per-second speed.
    // The plane's speed stat (0–100) scales the maximum movement speed.
    // Maneuverability (0–100) controls how responsive the stick feels.
    const maxSpeed   = (this._player.speed           / 100) * 220; // px/sec at full stick
    const turnRate   = (this._player.maneuverability / 100) * 10 + 4; // acceleration factor

    if (this._input.leftStick.active) {
      // Accelerate toward the stick direction
      this._player.velocityX += (this._input.leftStick.x * maxSpeed - this._player.velocityX) * turnRate * dt;
      this._player.velocityY += (this._input.leftStick.y * maxSpeed - this._player.velocityY) * turnRate * dt;

      // Update facing angle to match movement direction (only if moving meaningfully)
      const speed = Math.hypot(this._player.velocityX, this._player.velocityY);
      if (speed > 15) {
        this._player.angle = Math.atan2(this._player.velocityY, this._player.velocityX);
      }
    } else {
      // No input: gradually decelerate (drag)
      this._player.velocityX *= 0.88;
      this._player.velocityY *= 0.88;
    }

    // Apply velocity to position
    this._player.x += this._player.velocityX * dt;
    this._player.y += this._player.velocityY * dt;

    // Clamp to screen bounds (half-width/height margin so plane doesn't clip edges)
    const hw = this._player.width  / 2;
    const hh = this._player.height / 2;
    this._player.x = Math.max(hw,          Math.min(this._W - hw, this._player.x));
    this._player.y = Math.max(hh + 30,     Math.min(this._H - hh - 30, this._player.y));
    // (+30 vertical margin keeps plane away from HUD at top and control buttons at bottom)

    // --- Aim ---
    // The right stick sets the aim angle for the weapon.
    // Any direction with meaningful input (>10% deflection) updates the aim.
    if (this._input.rightStick.active) {
      const rx = this._input.rightStick.x;
      const ry = this._input.rightStick.y;
      if (Math.hypot(rx, ry) > 0.1) {
        this._aimAngle = Math.atan2(ry, rx);
      }
    }

    // --- Placeholder: Weapon Select button tap ---
    // Region: bottom-right area. Replace with actual weapon cycling logic.
    if (this._input.wasTappedInRegion(820, 460, 130, 58)) {
      console.log('[Input] Weapon Select tapped — implement weapon cycling here');
    }

    // --- Placeholder: Defensive Maneuver button tap ---
    // Region: to the left of Weapon Select. Replace with actual evasion logic.
    if (this._input.wasTappedInRegion(680, 460, 130, 58)) {
      console.log('[Input] Evade tapped — implement defensive maneuver here');
    }

    // --- Placeholder: Auto game-over after 30 seconds ---
    // This exists only so you can see the full state flow while testing.
    // REMOVE THIS when actual win/lose conditions are implemented.
    if (this._elapsedTime > 30 && !this._gameOverPending) {
      this._gameOverPending = true;
      this._gameData.score  = Math.floor(this._elapsedTime * 10);
      this._gameData.result = 'survived'; // Temporary placeholder result
      this._sm.change(new GameOverState(this._sm, this._input, this._gameData));
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER — draw the scene
  // ==========================================================

  render(ctx) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // --- Sky ---
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, '#07101f');
    sky.addColorStop(1, '#1a4a8c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // --- Ground ---
    ctx.fillStyle = '#1e3310';
    ctx.fillRect(0, H * 0.75, W, H * 0.25);

    // Horizon line
    ctx.strokeStyle = '#2e4a1e';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.75);
    ctx.lineTo(W, H * 0.75);
    ctx.stroke();

    // --- Placeholder: ground threat indicators ---
    // These rectangles show WHERE enemy objects will eventually be placed.
    _drawPlaceholderEnemy(ctx, 400, H * 0.75 - 18, '▲ AA Gun');
    _drawPlaceholderEnemy(ctx, 620, H * 0.75 - 18, '▲ Missile');
    _drawPlaceholderEnemy(ctx, 820, H * 0.75 - 22, '▲ Base');

    // --- Aim indicator line ---
    // A dashed line from the plane nose showing current weapon aim direction.
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

    // --- Player plane ---
    this._player.render(ctx);

    // --- HUD ---
    this._renderHUD(ctx);

    // --- Virtual thumbsticks ---
    this._input.renderSticks(ctx);

    // --- On-screen buttons ---
    _drawHUDButton(ctx, 820, 460, 130, 58, 'WEAPON\nSELECT', '#1a2a3a', '#4488aa');
    _drawHUDButton(ctx, 680, 460, 130, 58, 'EVADE',           '#2a1a3a', '#aa44aa');
  }

  _renderHUD(ctx) {
    const W = ctx.canvas.width;

    // Health bar (top-left)
    ctx.fillStyle = '#aaccdd';
    ctx.font      = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('HULL', 12, 24);
    this._player.health.renderBar(ctx, 55, 10, 180, 18);

    // Mode label (top-center)
    ctx.fillStyle = '#5bc8f5';
    ctx.font      = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('✈  PILOT MODE', W / 2, 24);

    // Timer (top-right)
    ctx.fillStyle = '#aaaaaa';
    ctx.font      = '14px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('T+' + Math.floor(this._elapsedTime) + 's', W - 12, 24);
  }
}

/* ============================================================
   LOCAL HELPERS
   ============================================================ */

// Draw a placeholder rectangle representing a future ground enemy
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

// Draw an on-screen HUD button (weapon select, evade, etc.)
function _drawHUDButton(ctx, x, y, w, h, label, bgColor, borderColor) {
  ctx.globalAlpha = 0.82;
  ctx.fillStyle   = bgColor;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle   = '#ffffff';
  ctx.font        = 'bold 14px Arial';
  ctx.textAlign   = 'center';

  const lines = label.split('\n');
  const lineH = 17;
  const startY = y + h / 2 - (lines.length - 1) * lineH / 2 + 5;
  lines.forEach((line, i) => ctx.fillText(line, x + w / 2, startY + i * lineH));
}
