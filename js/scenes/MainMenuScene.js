/* ============================================================
   MainMenuScene.js
   ============================================================
   Phaser Scene — the first screen the player sees.

   Visual elements:
     - 4-band flat-colour sky background (no gradients)
     - Fixed 2×2px star squares with alpha-pulse tweens
     - Slow parallax star field updated each frame
     - Radial vignette overlay (canvas-texture approach)
     - Title + glowing underline (pulse tween)
     - PILOT MODE button   → PilotGameScene (bypasses PlaneSelectScene)
     - GUNNER MODE button  → PilotGameScene  (mode: 'gunner')
     - Footer hint + version tag

   Button hover: scale 1.1× tween on pointerover / back on pointerout.
   ============================================================ */

class MainMenuScene extends Phaser.Scene {

  constructor() {
    super({ key: 'MainMenuScene' });
  }

  // ==========================================================
  // CREATE — build all display objects once on scene start
  // ==========================================================

  create() {
    const W = 960;
    const H = 540;
    const horizonY = Math.floor(H * 0.72);   // y where sky meets ground (388px)

    // ---- Sky — 4 flat colour bands (Visual Style Guide rules 1 & 3) ----
    const sky = this.add.graphics();
    sky.fillStyle(0x07101f);
    sky.fillRect(0, 0, W, Math.floor(horizonY * 0.35));
    sky.fillStyle(0x0d1e38);
    sky.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x122848);
    sky.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x1e3a52);
    sky.fillRect(0, Math.floor(horizonY * 0.85), W, horizonY - Math.floor(horizonY * 0.85));
    // Warm amber strip at the horizon
    sky.fillStyle(0x3a2010);
    sky.fillRect(0, horizonY - 8, W, 8);
    // Ground
    sky.fillStyle(0x1e3310);
    sky.fillRect(0, horizonY, W, H - horizonY);

    // ---- Fixed stars — 2×2px squares, tweened alpha for subtle twinkle ----
    const FIXED_STARS = [
      [80, 40], [200, 20], [350, 55], [500, 15], [650, 40], [780, 25],
      [900, 50], [130, 80], [420, 30], [710, 70], [860, 35], [50, 100],
    ];
    FIXED_STARS.forEach(([sx, sy]) => {
      const star = this.add.graphics();
      star.fillStyle(0xffffff, 1);
      star.fillRect(sx - 1, sy - 1, 2, 2);
      this.tweens.add({
        targets: star,
        alpha: { from: 0.25, to: 0.9 },
        duration: Phaser.Math.Between(1100, 2800),
        yoyo: true,
        repeat: -1,
        delay: Phaser.Math.Between(0, 2200),
        ease: 'Sine.easeInOut',
      });
    });

    // ---- Parallax star field — moved left each frame in update() ----
    this._parallaxStars = [];
    for (let i = 0; i < 28; i++) {
      const gfx = this.add.graphics();
      gfx.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.15, 0.65));
      gfx.fillRect(0, 0, 2, 2);
      gfx.setPosition(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(4, horizonY - 12),
      );
      this._parallaxStars.push({
        gfx,
        speed: Phaser.Math.FloatBetween(4, 24),
      });
    }

    // ---- Screen vignette — radial gradient drawn to a canvas texture ----
    // Guard against recreating the texture if the scene restarts
    if (!this.textures.exists('vignette_mm')) {
      const vigTex = this.textures.createCanvas('vignette_mm', W, H);
      const vigCtx = vigTex.context;
      const grad = vigCtx.createRadialGradient(
        W / 2, H / 2, H * 0.20,
        W / 2, H / 2, H * 0.76,
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      vigCtx.fillStyle = grad;
      vigCtx.fillRect(0, 0, W, H);
      vigTex.refresh();
    }
    this.add.image(0, 0, 'vignette_mm').setOrigin(0, 0);

    // ---- Title ----
    this.add.text(W / 2, 115, 'MY FIRST GAME', {
      fontFamily: 'monospace',
      fontSize: '48px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#4fc3f7',
      strokeThickness: 2,
    }).setOrigin(0.5, 0.5);

    // Glowing underline beneath the title — pulses in alpha
    const underline = this.add.graphics();
    underline.fillStyle(0x4fc3f7, 1);
    underline.fillRect(W / 2 - 200, 138, 400, 3);
    this.tweens.add({
      targets: underline,
      alpha: { from: 0.15, to: 1 },
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Subtitle
    this.add.text(W / 2, 158, 'A Survival Flight Game', {
      fontFamily: 'monospace',
      fontSize: '21px',
      color: '#7ec8e3',
    }).setOrigin(0.5, 0.5);

    // ---- PILOT MODE button ----
    const pilotBtn = this._makeButton(W / 2, 217, 400, 65, 'PILOT MODE', 0x0d47a1, 0x42a5f5);
    pilotBtn.on('pointerdown', () => {
      this.cameras.main.flash(300, 255, 255, 255);
      this.time.delayedCall(300, () => {
        this.scene.start('PilotGameScene', {
          mode: 'pilot',
          plane: {
            id: 'fighter',
            name: 'Strikewing',
            color: 0x00aaff,
            speed: 160,
            durability: 100,
            weaponSize: 1,
            maneuverability: 2
          }
        });
      });
    });

    // ---- GUNNER MODE button ----
    const gunnerBtn = this._makeButton(W / 2, 307, 400, 65, 'GUNNER MODE', 0x880e4f, 0xf06292);
    gunnerBtn.on('pointerdown', () => {
      this.scene.start('PilotGameScene', { mode: 'gunner' });
    });

    // Footer hint
    this.add.text(W / 2, 400, 'Tap a mode to begin', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#4a6070',
    }).setOrigin(0.5, 0.5);

    // Version tag (bottom-right)
    this.add.text(W - 12, H - 10, 'v0.2.0-phaser', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#2a3a4a',
    }).setOrigin(1, 1);
  }

  // ==========================================================
  // UPDATE — animate the parallax star field
  // ==========================================================

  update(time, delta) {
    const W = 960;
    const horizonY = Math.floor(540 * 0.72);
    for (const star of this._parallaxStars) {
      star.gfx.x -= star.speed * (delta / 1000);
      if (star.gfx.x < -2) {
        // Wrap to the right edge at a new random vertical position
        star.gfx.x = W + 2;
        star.gfx.y = Phaser.Math.Between(4, horizonY - 12);
      }
    }
  }

  // ==========================================================
  // HELPERS
  // ==========================================================

  /**
   * Build a Container-based button with hover scale tween.
   * Drawing is done with Graphics (no images or rounded rects).
   */
  _makeButton(cx, cy, w, h, label, bgColor, borderColor) {
    const container = this.add.container(cx, cy);

    // Button background + border
    const bg = this.add.graphics();
    bg.fillStyle(bgColor);
    bg.fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(2.5, borderColor);
    bg.strokeRect(-w / 2, -h / 2, w, h);

    // Button label
    const text = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '26px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5, 0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });

    // Hover: scale up to 1.1×
    container.on('pointerover', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 120,
        ease: 'Power1',
      });
    });

    // Out: return to 1×
    container.on('pointerout', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: 120,
        ease: 'Power1',
      });
    });

    return container;
  }
}
