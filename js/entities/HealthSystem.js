/* ============================================================
   HealthSystem.js
   ============================================================
   A reusable health/damage system that can be attached to
   ANY game object — the player's plane, a ground enemy base,
   a missile launcher, etc.

   FEATURES:
     - Take damage (reduces current health)
     - Heal (restores health up to the maximum)
     - Death detection (isAlive returns false at zero health)
     - Callback hooks: run custom code when damage or death occurs
     - Draw a visual health bar anywhere on screen

   USAGE EXAMPLE:
     const planeHealth = new HealthSystem(100);
     planeHealth.onDeath(() => console.log("Plane destroyed!"));
     planeHealth.takeDamage(30);  // health goes to 70
     planeHealth.getPercent();    // returns 0.70
   ============================================================ */

class HealthSystem {

  constructor(maxHealth = 100) {
    this.maxHealth     = maxHealth;
    this.currentHealth = maxHealth; // Always start at full health

    // Lists of functions to call when damage or death occurs.
    // Other parts of the game can register callbacks here.
    this._onDamageCallbacks = [];
    this._onDeathCallbacks  = [];
  }

  // ==========================================================
  // CORE METHODS
  // ==========================================================

  // Apply damage to this entity.
  // amount = how many health points to subtract.
  takeDamage(amount) {
    if (amount <= 0 || !this.isAlive()) return;

    // Don't go below zero
    const actualDamage   = Math.min(amount, this.currentHealth);
    this.currentHealth  -= actualDamage;

    // Notify anyone listening for damage events
    this._onDamageCallbacks.forEach(cb => cb(actualDamage, this.currentHealth));

    // If health just hit zero, trigger the death callbacks
    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this._onDeathCallbacks.forEach(cb => cb());
    }
  }

  // Restore health. Will not go above maxHealth.
  heal(amount) {
    if (amount <= 0) return;
    this.currentHealth = Math.min(this.currentHealth + amount, this.maxHealth);
  }

  // Returns true if this entity still has any health remaining.
  isAlive() {
    return this.currentHealth > 0;
  }

  // Returns health as a 0.0–1.0 fraction (useful for drawing health bars).
  // 1.0 = full health. 0.0 = dead.
  getPercent() {
    return this.currentHealth / this.maxHealth;
  }

  // Reset to full health (e.g. when restarting a level).
  reset() {
    this.currentHealth = this.maxHealth;
  }

  // ==========================================================
  // CALLBACK REGISTRATION
  // These allow other systems to react to damage/death events
  // without HealthSystem needing to know about those systems.
  // ==========================================================

  // Register a function to be called whenever damage is taken.
  // The callback receives: (amountDealt, remainingHealth)
  onDamage(callback) {
    this._onDamageCallbacks.push(callback);
    return this; // Allows chaining: health.onDamage(...).onDeath(...)
  }

  // Register a function to be called when health reaches zero.
  onDeath(callback) {
    this._onDeathCallbacks.push(callback);
    return this;
  }

  // ==========================================================
  // VISUAL: Draw a health bar
  // ==========================================================

  // Draws a health bar at the given position.
  //   x, y    = top-left corner of the bar
  //   width   = total bar width in game pixels
  //   height  = bar height in game pixels
  //
  // The bar changes color as health drops:
  //   Full health → green
  //   Half health → yellow
  //   Critical    → red
  renderBar(ctx, x, y, width, height) {
    const pct = this.getPercent();

    // Background (dark gray — the "empty" portion of the bar)
    ctx.fillStyle = '#333333';
    ctx.fillRect(x, y, width, height);

    // Filled portion — color shifts from green → yellow → red
    const red   = Math.floor(255 * (1 - pct));
    const green = Math.floor(255 * pct);
    ctx.fillStyle = `rgb(${red}, ${green}, 0)`;
    ctx.fillRect(x, y, width * pct, height);

    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x, y, width, height);
  }
}
