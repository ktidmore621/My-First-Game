/* ============================================================
   GameLoop.js
   ============================================================
   The Game Loop is the HEARTBEAT of the game.

   It runs continuously and does two things every frame:
     1. UPDATE — advance all game logic by a tiny time step
     2. RENDER — redraw the entire screen

   It targets 60 frames per second using requestAnimationFrame,
   which is the browser's built-in "draw the next frame when
   the screen is ready" function. This is more efficient and
   accurate than using setInterval or setTimeout.

   DELTA TIME (dt):
   Instead of moving things "5 pixels per frame", we move them
   "300 pixels per second × dt". This way the game runs at the
   same speed regardless of frame rate fluctuations or device speed.
   dt is always a small decimal like 0.016 (= 16ms at 60fps).
   ============================================================ */

class GameLoop {

  constructor(stateManager, ctx) {
    this._stateManager = stateManager;
    this._ctx = ctx;

    this._running = false;
    this._lastTimestamp = 0;
    this._animFrameId = null;

    // Bind _tick so "this" always refers to this GameLoop instance,
    // even when called by requestAnimationFrame.
    this._tick = this._tick.bind(this);
  }

  // ---- Start the loop ----
  start() {
    if (this._running) return; // Guard: don't start twice
    this._running = true;
    this._animFrameId = requestAnimationFrame(this._tick);
  }

  // ---- Stop the loop (e.g. when switching to a native iOS view) ----
  stop() {
    this._running = false;
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  // ---- One tick = one frame ----
  // Called by requestAnimationFrame with a high-resolution timestamp (ms).
  _tick(timestamp) {
    if (!this._running) return;

    // --- Calculate delta time ---
    // How many seconds have passed since the last frame?
    let dt = (timestamp - this._lastTimestamp) / 1000;
    this._lastTimestamp = timestamp;

    // --- Cap delta time ---
    // If the tab was in the background or the device lagged badly,
    // dt could be huge (several seconds). Capping it prevents objects
    // from teleporting across the screen after a pause.
    const MAX_DT = 1 / 20; // Never simulate more than 50ms at once
    if (dt > MAX_DT) dt = MAX_DT;

    // --- Update game logic ---
    // Pass dt so everything moves at the right speed
    this._stateManager.update(dt);

    // --- Draw the current frame ---
    this._stateManager.render(this._ctx);

    // --- Schedule the next frame ---
    this._animFrameId = requestAnimationFrame(this._tick);
  }
}
