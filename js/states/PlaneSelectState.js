/* ============================================================
   PlaneSelectState.js
   ============================================================
   The plane selection screen (shown before Pilot Mode).

   Displays three selectable plane cards, each showing:
     - Plane name
     - Triangle placeholder visual (colored by type)
     - Four stat bars: Speed, Durability, Weapon Size, Maneuver

   The player taps a card to highlight it, then taps FLY! to confirm.

   TRANSITIONS:
     FLY!   → PilotGameState (with chosen plane stored in gameData)
     ← Back → MainMenuState
   ============================================================ */

class PlaneSelectState {

  constructor(stateManager, input, gameData) {
    this._sm       = stateManager;
    this._input    = input;
    this._gameData = gameData;

    // --- Available planes ---
    // Stats are placeholders — balance these when building actual gameplay.
    this._planes = [
      new Plane({
        id:              'fighter',
        name:            'Fighter',
        speed:           82,
        durability:      55,
        weaponSize:      65,
        maneuverability: 90,
        color:           '#42a5f5', // Blue
      }),
      new Plane({
        id:              'bomber',
        name:            'Bomber',
        speed:           42,
        durability:      95,
        weaponSize:      95,
        maneuverability: 35,
        color:           '#78909c', // Gray
      }),
      new Plane({
        id:              'scout',
        name:            'Scout',
        speed:           95,
        durability:      38,
        weaponSize:      42,
        maneuverability: 96,
        color:           '#66bb6a', // Green
      }),
    ];

    this._selectedIndex = 0; // Which plane is currently highlighted

    // --- Card layout constants ---
    this._cardW    = 245;
    this._cardH    = 285;
    this._cardGap  = 27;
    this._cardsY   = 110;
    // Center the three cards horizontally
    this._cardsStartX = (960 - (this._cardW * 3 + this._cardGap * 2)) / 2;
  }

  enter() {
    console.log('[State] Plane Select');
  }

  exit() {}

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(dt) {
    const W = 960;

    // Back button (top-left)
    if (this._input.wasTappedInRegion(15, 15, 110, 42)) {
      this._sm.change(new MainMenuState(this._sm, this._input, this._gameData));
      this._input.clearTaps();
      return;
    }

    // Check if any plane card was tapped
    this._planes.forEach((plane, i) => {
      const cardX = this._cardsStartX + i * (this._cardW + this._cardGap);
      if (this._input.wasTappedInRegion(cardX, this._cardsY, this._cardW, this._cardH)) {
        this._selectedIndex = i;
      }
    });

    // FLY! confirm button
    if (this._input.wasTappedInRegion(W / 2 - 110, 430, 220, 58)) {
      // Store the chosen plane in shared gameData so PilotGameState can use it
      const chosen = this._planes[this._selectedIndex];
      chosen.reset(100, 270); // Start position: left side, vertical center
      this._gameData.selectedPlane = chosen;
      this._sm.change(new PilotGameState(this._sm, this._input, this._gameData));
    }

    this._input.clearTaps();
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  render(ctx) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // --- Background ---
    ctx.fillStyle = '#0b1520';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid lines (sci-fi briefing room feel)
    ctx.strokeStyle = 'rgba(30, 80, 130, 0.3)';
    ctx.lineWidth   = 1;
    for (let gx = 0; gx < W; gx += 60) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += 60) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // --- Title ---
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 34px Arial';
    ctx.fillText('SELECT YOUR AIRCRAFT', W / 2, 68);

    ctx.fillStyle = '#5a8aaa';
    ctx.font      = '16px Arial';
    ctx.fillText('Tap a card, then tap FLY!', W / 2, 93);

    // --- Back button ---
    ctx.fillStyle = '#1e2e3e';
    ctx.fillRect(15, 15, 110, 42);
    ctx.strokeStyle = '#3a5a7a';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(15, 15, 110, 42);
    ctx.fillStyle   = '#8aaabb';
    ctx.font        = '17px Arial';
    ctx.textAlign   = 'center';
    ctx.fillText('← Back', 70, 41);

    // --- Plane cards ---
    this._planes.forEach((plane, i) => {
      const cardX      = this._cardsStartX + i * (this._cardW + this._cardGap);
      const cardY      = this._cardsY;
      const isSelected = i === this._selectedIndex;

      this._drawCard(ctx, plane, cardX, cardY, isSelected);
    });

    // --- FLY! button ---
    _drawButton(ctx, W / 2 - 110, 430, 220, 58, 'FLY!', '#0d47a1', '#42a5f5');
  }

  // Draw a single plane selection card
  _drawCard(ctx, plane, x, y, isSelected) {
    // Card background
    ctx.fillStyle = isSelected ? '#0f2a4a' : '#121e2e';
    ctx.fillRect(x, y, this._cardW, this._cardH);

    // Card border (brighter when selected)
    ctx.strokeStyle = isSelected ? '#42a5f5' : '#1e3a5a';
    ctx.lineWidth   = isSelected ? 3 : 1.5;
    ctx.strokeRect(x, y, this._cardW, this._cardH);

    // Plane name
    ctx.fillStyle   = '#ffffff';
    ctx.font        = 'bold 22px Arial';
    ctx.textAlign   = 'center';
    ctx.fillText(plane.name.toUpperCase(), x + this._cardW / 2, y + 34);

    // Plane silhouette (reusing the Plane triangle render, scaled down)
    ctx.save();
    ctx.translate(x + this._cardW / 2, y + 95);
    ctx.scale(0.9, 0.9);
    ctx.fillStyle = plane.color;
    ctx.beginPath();
    ctx.moveTo(36, 0);
    ctx.lineTo(-28, -18);
    ctx.lineTo(-18, 0);
    ctx.lineTo(-28, 18);
    ctx.closePath();
    ctx.fill();
    // Cockpit glint
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(10, 0, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Stat bars
    const stats = [
      { label: 'Speed',    value: plane.speed },
      { label: 'Durability', value: plane.durability },
      { label: 'Weapons',  value: plane.weaponSize },
      { label: 'Maneuver', value: plane.maneuverability },
    ];

    const statStartY  = y + 145;
    const statBarX    = x + 105;
    const statBarW    = 125;
    const statBarH    = 11;
    const statSpacing = 32;

    stats.forEach((stat, si) => {
      const sy = statStartY + si * statSpacing;

      // Label
      ctx.fillStyle   = '#7a9ab0';
      ctx.font        = '13px Arial';
      ctx.textAlign   = 'left';
      ctx.fillText(stat.label, x + 12, sy + 10);

      // Bar background
      ctx.fillStyle = '#0b1520';
      ctx.fillRect(statBarX, sy, statBarW, statBarH);

      // Bar fill (colored by plane)
      ctx.fillStyle = plane.color;
      ctx.fillRect(statBarX, sy, statBarW * (stat.value / 100), statBarH);

      // Bar border
      ctx.strokeStyle = '#1e3a5a';
      ctx.lineWidth   = 1;
      ctx.strokeRect(statBarX, sy, statBarW, statBarH);

      // Numeric value
      ctx.fillStyle   = '#ccdde8';
      ctx.font        = '12px Arial';
      ctx.textAlign   = 'right';
      ctx.fillText(stat.value, x + this._cardW - 8, sy + 10);
    });
  }
}
