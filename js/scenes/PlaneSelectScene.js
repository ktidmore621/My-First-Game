/* ============================================================
   PlaneSelectScene.js
   ============================================================
   Phaser Scene — aircraft selection screen (shown before Pilot Mode).

   Receives scene data: { mode: 'pilot' }

   Displays three selectable plane cards, each showing:
     - Plane name
     - Triangle placeholder silhouette (colored by type)
     - Four stat bars that animate from 0 to their value on enter

   Selection state:
     - Selected card: scale 1.05×, full alpha
     - Other cards: scale 1.0×, alpha 0.7
     - Particle spark emitter follows the selected card

   TRANSITIONS:
     FLY!   → PilotGameScene  (passes mode + plane data)
     ← Back → MainMenuScene
   ============================================================ */

class PlaneSelectScene extends Phaser.Scene {

  constructor() {
    super({ key: 'PlaneSelectScene' });
  }

  // ==========================================================
  // INIT — receive transition data before create() runs
  // ==========================================================

  init(data) {
    this.mode = (data && data.mode) ? data.mode : 'pilot';
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create() {
    const W = 960;
    const H = 540;

    this._selectedIndex = 0;

    // Plane definitions matching PlaneSelectState.js
    this._planeDefs = [
      {
        id: 'fighter', name: 'Fighter', color: 0x42a5f5,
        speed: 82, durability: 55, weaponSize: 65, maneuverability: 90,
      },
      {
        id: 'bomber', name: 'Bomber', color: 0x78909c,
        speed: 42, durability: 95, weaponSize: 95, maneuverability: 35,
      },
      {
        id: 'scout', name: 'Scout', color: 0x66bb6a,
        speed: 95, durability: 38, weaponSize: 42, maneuverability: 96,
      },
    ];

    // Card geometry — matching the original layout constants
    this._cardW = 245;
    this._cardH = 285;
    const cardGap  = 27;
    const cardsY   = 110;
    const startX   = (W - (this._cardW * 3 + cardGap * 2)) / 2;

    // ---- Background — same 4-band pixel-art sky as MainMenuScene ----
    // (Visual Style Guide rules 1 & 3 — flat fillRect bands, no gradients)
    const horizonY = Math.floor(H * 0.72);
    const sky = this.add.graphics();
    sky.fillStyle(0x07101f);
    sky.fillRect(0, 0, W, Math.floor(horizonY * 0.35));
    sky.fillStyle(0x0d1e38);
    sky.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x122848);
    sky.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x1e3a52);
    sky.fillRect(0, Math.floor(horizonY * 0.85), W, horizonY - Math.floor(horizonY * 0.85));
    // Warm amber horizon strip
    sky.fillStyle(0x3a2010);
    sky.fillRect(0, horizonY - 8, W, 8);
    // Ground
    sky.fillStyle(0x1e3310);
    sky.fillRect(0, horizonY, W, H - horizonY);

    // Semi-transparent dark overlay — keeps the briefing-room feel and
    // ensures card text remains legible against the sky background
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.52);
    overlay.fillRect(0, 0, W, H);

    // Subtle sci-fi grid lines on top of the overlay
    const bg = this.add.graphics();
    bg.lineStyle(1, 0x1e5082, 0.3);
    for (let gx = 0; gx < W; gx += 60) {
      bg.beginPath(); bg.moveTo(gx, 0); bg.lineTo(gx, H); bg.strokePath();
    }
    for (let gy = 0; gy < H; gy += 60) {
      bg.beginPath(); bg.moveTo(0, gy); bg.lineTo(W, gy); bg.strokePath();
    }

    // ---- Title ----
    this.add.text(W / 2, 48, 'SELECT YOUR AIRCRAFT', {
      fontFamily: 'monospace',
      fontSize: '34px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0.5);

    this.add.text(W / 2, 78, 'Tap a card, then tap FLY!', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#5a8aaa',
    }).setOrigin(0.5, 0.5);

    // ---- Spark texture for the particle emitter ----
    // One 3×3 white square, generated once and cached as a texture key
    if (!this.textures.exists('spark')) {
      const pg = this.make.graphics({ x: 0, y: 0, add: false });
      pg.fillStyle(0xffffff, 1);
      pg.fillRect(0, 0, 3, 3);
      pg.generateTexture('spark', 3, 3);
      pg.destroy();
    }

    // ---- Build the three plane cards ----
    this._cards = [];         // { container, cardBg }
    this._cardPositions = []; // { x, y } scene-space centre of each card

    this._planeDefs.forEach((plane, i) => {
      const cx = startX + i * (this._cardW + cardGap) + this._cardW / 2;
      const cy = cardsY + this._cardH / 2;
      this._cardPositions.push({ x: cx, y: cy });
      this._buildCard(plane, cx, cy, i);
    });

    // ---- Particle emitter — starts on the first (default) selected card ----
    const initPos = this._cardPositions[0];
    this._emitter = this.add.particles(initPos.x, initPos.y, 'spark', {
      speed:   { min: 20, max: 70 },
      scale:   { start: 1.2, end: 0 },
      alpha:   { start: 0.9, end: 0 },
      tint:    [0xffff44, 0xff8800, 0xffffff, 0x88ffff],
      lifespan: 700,
      quantity: 1,
      frequency: 180,
      blendMode: 'ADD',
      emitZone: {
        type: 'random',
        source: new Phaser.Geom.Rectangle(
          -this._cardW / 2, -this._cardH / 2,
          this._cardW, this._cardH,
        ),
      },
    });

    // Apply initial selection visuals (no animation — just set state)
    this._applySelection(0, false);

    // ---- Back button (top-left) ----
    this._makeBackButton();

    // ---- FLY! confirm button ----
    this._makeFlyButton(W, H);
  }

  // ==========================================================
  // BUILD CARD — creates a single plane card Container
  // ==========================================================

  _buildCard(plane, cx, cy, index) {
    const cW = this._cardW;
    const cH = this._cardH;

    const container = this.add.container(cx, cy);

    // --- Card background + border (redrawn when selection changes) ---
    const cardBg = this.add.graphics();
    this._drawCardBg(cardBg, false); // initial: not selected
    container.add(cardBg);

    // --- Plane name ---
    const nameText = this.add.text(0, -cH / 2 + 24, plane.name.toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0.5);
    container.add(nameText);

    // --- Plane silhouette (same triangle as Plane.render, scaled to 0.9×) ---
    const silhouette = this.add.graphics();
    const sc = 0.9;
    silhouette.fillStyle(plane.color, 1);
    // Upper wing half
    silhouette.fillTriangle(
      36 * sc,  0,
      -28 * sc, -18 * sc,
      -18 * sc, 0,
    );
    // Lower wing half
    silhouette.fillTriangle(
      36 * sc, 0,
      -18 * sc, 0,
      -28 * sc, 18 * sc,
    );
    // Cockpit glint — fillRect, no arc() (Visual Style Guide rule 4)
    silhouette.fillStyle(0xffffff, 0.35);
    silhouette.fillRect(-1, -3, Math.round(22 * sc), 6);
    silhouette.setPosition(0, -cH / 2 + 85);
    container.add(silhouette);

    // --- Stat bars ---
    const stats = [
      { label: 'Speed',      value: plane.speed },
      { label: 'Durability', value: plane.durability },
      { label: 'Weapons',    value: plane.weaponSize },
      { label: 'Maneuver',   value: plane.maneuverability },
    ];

    const barMaxW   = 125;
    const barH      = 11;
    const spacing   = 32;
    const startY    = -cH / 2 + 145;
    const barX      = -cW / 2 + 105;  // left edge of bar in container-local coords
    const labelX    = -cW / 2 + 12;

    // barAnimData: array of plain objects we tween directly so onUpdate can redraw
    const barAnimData = [];

    stats.forEach((stat, si) => {
      const sy = startY + si * spacing;

      // Stat label
      const lbl = this.add.text(labelX, sy + barH / 2, stat.label, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#7a9ab0',
      }).setOrigin(0, 0.5);
      container.add(lbl);

      // Bar background + border
      const barBg = this.add.graphics();
      barBg.fillStyle(0x0b1520);
      barBg.fillRect(barX, sy, barMaxW, barH);
      barBg.lineStyle(1, 0x1e3a5a);
      barBg.strokeRect(barX, sy, barMaxW, barH);
      container.add(barBg);

      // Bar fill — drawn into a dedicated Graphics; animated below
      const barFill = this.add.graphics();
      container.add(barFill);

      // Numeric value (right-aligned)
      const valTxt = this.add.text(cW / 2 - 8, sy + barH / 2, String(stat.value), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ccdde8',
      }).setOrigin(1, 0.5);
      container.add(valTxt);

      // Store animation state for this bar
      barAnimData.push({
        gfx:    barFill,
        barX,
        sy,
        barMaxW,
        barH,
        color:  plane.color,
        pct:    0,                      // tweened 0 → target
        target: stat.value / 100,
      });
    });

    // --- Animate stat bars from 0 to their target values ---
    barAnimData.forEach((bar, si) => {
      this.tweens.add({
        targets:  bar,
        pct:      bar.target,
        duration: 520,
        ease:     'Power2',
        // Stagger: each card slightly delayed, each bar within card staggered too
        delay:    200 + index * 110 + si * 80,
        onUpdate: () => {
          bar.gfx.clear();
          bar.gfx.fillStyle(bar.color);
          bar.gfx.fillRect(bar.barX, bar.sy, bar.barMaxW * bar.pct, bar.barH);
        },
        onComplete: () => {
          // Snap to exact final value (avoids floating-point drift)
          bar.gfx.clear();
          bar.gfx.fillStyle(bar.color);
          bar.gfx.fillRect(bar.barX, bar.sy, bar.barMaxW * bar.target, bar.barH);
        },
      });
    });

    // --- Card interaction ---
    container.setSize(cW, cH);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      // Only scale on hover if this card is not the selected one
      if (this._selectedIndex !== index) {
        this.tweens.killTweensOf(container);
        this.tweens.add({
          targets: container,
          scaleX: 1.02, scaleY: 1.02,
          duration: 100, ease: 'Power1',
        });
      }
    });

    container.on('pointerout', () => {
      if (this._selectedIndex !== index) {
        this.tweens.killTweensOf(container);
        this.tweens.add({
          targets: container,
          scaleX: 1, scaleY: 1,
          duration: 100, ease: 'Power1',
        });
      }
    });

    container.on('pointerdown', () => {
      this._applySelection(index, true);
    });

    // Store refs for later border/scale updates
    this._cards.push({ container, cardBg });
  }

  // ==========================================================
  // SELECTION LOGIC
  // ==========================================================

  /**
   * Update the visual state of all cards to reflect a new selection.
   * @param {number}  index    Which card is now selected (0, 1, or 2)
   * @param {boolean} animate  True → tween; false → instant (initial setup)
   */
  _applySelection(index, animate) {
    this._selectedIndex = index;

    this._cards.forEach(({ container, cardBg }, i) => {
      const selected = (i === index);

      // Redraw card background with appropriate colours
      this._drawCardBg(cardBg, selected);

      // Scale + alpha
      this.tweens.killTweensOf(container);
      const targetScale = selected ? 1.05 : 1.0;
      const targetAlpha = selected ? 1.0  : 0.7;

      if (animate) {
        this.tweens.add({
          targets: container,
          scaleX: targetScale,
          scaleY: targetScale,
          alpha:  targetAlpha,
          duration: 150,
          ease: 'Power1',
        });
      } else {
        container.setScale(targetScale);
        container.setAlpha(targetAlpha);
      }
    });

    // Move the particle emitter to the newly selected card
    if (this._emitter) {
      const pos = this._cardPositions[index];
      this._emitter.setPosition(pos.x, pos.y);
    }
  }

  // ==========================================================
  // HELPERS
  // ==========================================================

  /** Draw (or redraw) a card background Graphics into `gfx`. */
  _drawCardBg(gfx, selected) {
    const cW = this._cardW;
    const cH = this._cardH;
    gfx.clear();
    gfx.fillStyle(selected ? 0x0f2a4a : 0x121e2e);
    gfx.fillRect(-cW / 2, -cH / 2, cW, cH);
    gfx.lineStyle(selected ? 3 : 1.5, selected ? 0x42a5f5 : 0x1e3a5a);
    gfx.strokeRect(-cW / 2, -cH / 2, cW, cH);
  }

  /** Back button — returns to MainMenuScene. */
  _makeBackButton() {
    const container = this.add.container(70, 36);

    const bg = this.add.graphics();
    bg.fillStyle(0x1e2e3e);
    bg.fillRect(-55, -21, 110, 42);
    bg.lineStyle(1.5, 0x3a5a7a);
    bg.strokeRect(-55, -21, 110, 42);

    const label = this.add.text(0, 0, '← Back', {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#8aaabb',
    }).setOrigin(0.5, 0.5);

    container.add([bg, label]);
    container.setSize(110, 42);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1.08, scaleY: 1.08, duration: 100 });
    });
    container.on('pointerout', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
    });
    container.on('pointerdown', () => {
      this.scene.start('MainMenuScene');
    });
  }

  /** FLY! confirm button — transitions to PilotGameScene with plane data. */
  _makeFlyButton(W, H) {
    const container = this.add.container(W / 2, 459);

    const bg = this.add.graphics();
    bg.fillStyle(0x0d47a1);
    bg.fillRect(-110, -29, 220, 58);
    bg.lineStyle(2.5, 0x42a5f5);
    bg.strokeRect(-110, -29, 220, 58);

    const label = this.add.text(0, 0, 'FLY!', {
      fontFamily: 'monospace',
      fontSize: '26px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0.5);

    container.add([bg, label]);
    container.setSize(220, 58);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1.1, scaleY: 1.1, duration: 120 });
    });
    container.on('pointerout', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 120 });
    });
    container.on('pointerdown', () => {
      const plane = this._planeDefs[this._selectedIndex];
      // Pass a plain-object copy of the plane data so PilotGameScene can
      // use it without depending on the old Plane class
      this.scene.start('PilotGameScene', {
        mode:  this.mode,
        plane: { ...plane },
      });
    });
  }
}
