/* ============================================================
   PilotGameScene.js  — PLACEHOLDER
   ============================================================
   This scene will host the full Pilot Mode (and Gunner Mode)
   gameplay once migrated from PilotGameState / GunnerGameState.

   For now it displays a "Coming Soon" screen so that
   scene transitions from MainMenuScene and PlaneSelectScene
   do not throw errors.

   Receives scene data:
     { mode: 'pilot' | 'gunner', plane: { ...planeData } | undefined }
   ============================================================ */

class PilotGameScene extends Phaser.Scene {

  constructor() {
    super({ key: 'PilotGameScene' });
  }

  init(data) {
    this._mode  = (data && data.mode)  ? data.mode  : 'pilot';
    this._plane = (data && data.plane) ? data.plane : null;
  }

  create() {
    const W = 960;
    const H = 540;

    // Dark background
    this.add.graphics().fillStyle(0x07101f).fillRect(0, 0, W, H);

    this.add.text(W / 2, H / 2 - 40, 'PILOT GAME SCENE', {
      fontFamily: 'monospace',
      fontSize: '36px',
      fontStyle: 'bold',
      color: '#42a5f5',
    }).setOrigin(0.5, 0.5);

    this.add.text(W / 2, H / 2 + 10, `Mode: ${this._mode.toUpperCase()}`, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#7ec8e3',
    }).setOrigin(0.5, 0.5);

    this.add.text(W / 2, H / 2 + 50, '[ Full gameplay coming in the next session ]', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#4a6070',
    }).setOrigin(0.5, 0.5);

    this.add.text(W / 2, H / 2 + 110, 'Tap anywhere to return to Main Menu', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#8aaabb',
    }).setOrigin(0.5, 0.5);

    this.input.once('pointerdown', () => {
      this.scene.start('MainMenuScene');
    });
  }
}
