/* ============================================================
   SoundSystem.js — Sound Event Stubs
   ============================================================
   Placeholder class for all in-game audio events.
   All methods are no-ops until audio assets are ready.

   // Connect to Web Audio API or Phaser Sound Manager when audio assets are ready

   USAGE:
     this._sound = new SoundSystem(scene);
     this._sound.fireWeapon();        // called when player fires
     this._sound.enemyHit(x, y);     // called on enemy structure hit
     this._sound.playerHit();         // called when player takes damage
     this._sound.explosion(x, y);    // called on enemy or missile explosion
     this._sound.missileAlert();      // called when a missile is launched at player

   When audio assets are available, replace each method body with:
     this._scene.sound.play('key', { volume: 0.8, rate: 1.0 });
   or use the Web Audio API directly.

   Phaser.Sound.BaseSound is ready to use when audio files are added:
     this._scene.sound.add('fire_sfx').play();
   ============================================================ */

class SoundSystem {

  constructor(scene) {
    this._scene = scene;
    // Placeholder: no audio assets loaded yet.
    // When assets are ready, preload them in the scene's preload() method:
    //   this.load.audio('fire_sfx',      'assets/audio/fire.wav');
    //   this.load.audio('hit_sfx',       'assets/audio/hit.wav');
    //   this.load.audio('player_hit_sfx','assets/audio/player_hit.wav');
    //   this.load.audio('explosion_sfx', 'assets/audio/explosion.wav');
    //   this.load.audio('missile_sfx',   'assets/audio/missile_alert.wav');
  }

  // Called when the player fires the PX-9 plasma array
  fireWeapon() {
    // this._scene.sound.play('fire_sfx', { volume: 0.6 });
  }

  // Called when a player bolt hits an OrcCannon or OrcSilo
  // worldX, worldY — world-space impact coordinates (for positional audio)
  enemyHit(worldX, worldY) {
    // this._scene.sound.play('hit_sfx', { volume: 0.7 });
  }

  // Called when the player's ship takes damage
  playerHit() {
    // this._scene.sound.play('player_hit_sfx', { volume: 0.9 });
  }

  // Called on a large explosion — enemy destruction or missile detonation
  // worldX, worldY — world-space explosion coordinates
  explosion(worldX, worldY) {
    // this._scene.sound.play('explosion_sfx', { volume: 1.0 });
  }

  // Called when a missile silo launches a missile targeting the player
  missileAlert() {
    // this._scene.sound.play('missile_sfx', { volume: 0.8 });
  }
}
