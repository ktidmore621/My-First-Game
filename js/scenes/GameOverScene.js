/* ============================================================
   GameOverScene.js — Mission Result Screen
   ============================================================
   Phaser Scene shown after PilotGameScene ends.

   Receives scene data:
     {
       result:    'victory' | 'defeated',
       score:     Number,
       planeSeed: Object (optional — plane config passed back to PilotGameScene
                         on PLAY AGAIN so terrain can use the same generation seed)
       plane:     Object (plane config for PLAY AGAIN)
     }

   Visual elements:
     - Full-screen dark backdrop (semi-transparent overlay)
     - Result banner slides in from the top via Phaser tween
     - Score counter animates from 0 up to final value via tween
     - Two buttons: PLAY AGAIN and MAIN MENU

   Transitions:
     PLAY AGAIN → PilotGameScene  (passes same plane + fresh seed)
     MAIN MENU  → MainMenuScene
   ============================================================ */

class GameOverScene extends Phaser.Scene {

  constructor() {
    super({ key: 'GameOverScene' });
  }

  // ==========================================================
  // INIT — receive result data before create() runs
  // ==========================================================

  init(data) {
    this._result    = (data && data.result) ? data.result    : 'defeated';
    this._score     = (data && data.score  !== undefined) ? data.score : 0;
    this._plane     = (data && data.plane)  ? data.plane    : null;
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create() {
    const W = 960;
    const H = 540;

    const isVictory = this._result === 'victory';

    // ---- Full-screen dark backdrop ----
    // Sits over whatever the previous scene rendered (scene is launched
    // in parallel via scene.launch so the game world stays visible behind).
    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.72);
    backdrop.fillRect(0, 0, W, H);

    // ---- Background sky (same palette as other scenes) ----
    // Drawn below the backdrop so the screen isn't just pure black
    const horizonY = Math.floor(H * 0.72);
    const sky = this.add.graphics().setDepth(-1);
    sky.fillStyle(0x07101f);
    sky.fillRect(0, 0, W, Math.floor(horizonY * 0.35));
    sky.fillStyle(0x0d1e38);
    sky.fillRect(0, Math.floor(horizonY * 0.35), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x122848);
    sky.fillRect(0, Math.floor(horizonY * 0.60), W, Math.floor(horizonY * 0.25));
    sky.fillStyle(0x1e3a52);
    sky.fillRect(0, Math.floor(horizonY * 0.85), W, horizonY - Math.floor(horizonY * 0.85));
    sky.fillStyle(0x3a2010);
    sky.fillRect(0, horizonY - 8, W, 8);
    sky.fillStyle(0x1a2a0a);
    sky.fillRect(0, horizonY, W, H - horizonY);

    // ---- Result banner container — slides in from above ----
    const bannerH   = 90;
    const bannerW   = 560;
    const bannerCY  = 165;  // target Y (centre)

    const bannerContainer = this.add.container(W / 2, -bannerH); // starts off-screen

    // Banner background
    const bannerBg = this.add.graphics();
    const bannerColor = isVictory ? 0x0a2a0a : 0x2a0a0a;
    const borderColor = isVictory ? 0x44ff44 : 0xff4444;
    bannerBg.fillStyle(bannerColor, 1);
    bannerBg.fillRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);
    bannerBg.lineStyle(3, borderColor);
    bannerBg.strokeRect(-bannerW / 2, -bannerH / 2, bannerW, bannerH);

    // Result label
    const resultLabel = this.add.text(0, -12, isVictory ? 'MISSION COMPLETE' : 'SHIP DESTROYED', {
      fontFamily: 'monospace',
      fontSize:   '36px',
      fontStyle:  'bold',
      color:      isVictory ? '#88ff88' : '#ff8888',
    }).setOrigin(0.5, 0.5);

    // Sub-label
    const subLabel = this.add.text(0, 26, isVictory ? 'All objectives cleared' : 'Returning to base…', {
      fontFamily: 'monospace',
      fontSize:   '17px',
      color:      '#aabbcc',
    }).setOrigin(0.5, 0.5);

    bannerContainer.add([bannerBg, resultLabel, subLabel]);

    // Tween: slide banner down into view
    this.tweens.add({
      targets:  bannerContainer,
      y:        bannerCY,
      duration: 550,
      ease:     'Back.easeOut',
    });

    // ---- Score display ----
    // Label
    this.add.text(W / 2, 285, 'MISSION SCORE', {
      fontFamily: 'monospace',
      fontSize:   '18px',
      color:      '#6a9aaa',
    }).setOrigin(0.5, 0.5);

    // Animated numeric counter
    // We tween a plain object's 'value' property and update the text each tick
    const scoreProxy = { value: 0 };
    const scoreText  = this.add.text(W / 2, 325, '0', {
      fontFamily: 'monospace',
      fontSize:   '48px',
      fontStyle:  'bold',
      color:      '#ffffff',
    }).setOrigin(0.5, 0.5);

    // Delay start until banner finishes its slide (≈600 ms)
    this.tweens.add({
      targets:    scoreProxy,
      value:      this._score,
      duration:   1200,
      delay:      600,
      ease:       'Power2',
      onUpdate:   () => {
        scoreText.setText(Math.floor(scoreProxy.value).toString());
      },
      onComplete: () => {
        scoreText.setText(this._score.toString());
      },
    });

    // ---- Buttons — appear after score animation starts ----
    this.time.delayedCall(800, () => this._buildButtons(W, H));
  }

  // ==========================================================
  // BUTTONS
  // ==========================================================

  _buildButtons(W, H) {
    const btnY = 432;
    const gap  = 32;

    // PLAY AGAIN
    const playBtn = this._makeButton(W / 2 - 130 - gap / 2, btnY, 260, 58, 'PLAY AGAIN', 0x0d3a1a, 0x44bb44);
    playBtn.setAlpha(0);
    this.tweens.add({ targets: playBtn, alpha: 1, duration: 280, ease: 'Power1' });
    playBtn.on('pointerdown', () => {
      // Restart PilotGameScene with the same plane; terrain gets a fresh seed
      this.scene.start('PilotGameScene', {
        mode:  'pilot',
        plane: this._plane || { id: 'fighter', name: 'Fighter', color: 0x42a5f5, speed: 82, durability: 55, weaponSize: 65, maneuverability: 90 },
      });
    });

    // MAIN MENU
    const menuBtn = this._makeButton(W / 2 + 130 + gap / 2, btnY, 260, 58, 'MAIN MENU', 0x1a1a2e, 0x4488cc);
    menuBtn.setAlpha(0);
    this.tweens.add({ targets: menuBtn, alpha: 1, duration: 280, delay: 100, ease: 'Power1' });
    menuBtn.on('pointerdown', () => {
      this.scene.start('MainMenuScene');
    });
  }

  // ==========================================================
  // HELPERS
  // ==========================================================

  _makeButton(cx, cy, w, h, label, bgColor, borderColor) {
    const container = this.add.container(cx, cy);

    const bg = this.add.graphics();
    bg.fillStyle(bgColor);
    bg.fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(2, borderColor);
    bg.strokeRect(-w / 2, -h / 2, w, h);

    const text = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize:   '22px',
      fontStyle:  'bold',
      color:      '#ffffff',
    }).setOrigin(0.5, 0.5);

    container.add([bg, text]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1.08, scaleY: 1.08, duration: 100, ease: 'Power1' });
    });
    container.on('pointerout', () => {
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100, ease: 'Power1' });
    });

    return container;
  }
}
