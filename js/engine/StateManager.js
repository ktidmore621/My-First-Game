/* ============================================================
   StateManager.js
   ============================================================
   The State Manager controls WHICH SCREEN the player sees
   at any given moment.

   Think of it like a TV remote — it switches between channels.
   Each "channel" is a game state (Main Menu, Plane Select,
   Pilot Mode, Gunner Mode, Game Over).

   Every state must have four methods:
     enter()       — called once when the state becomes active
     exit()        — called once when the state is left
     update(dt)    — called 60x/sec to run game logic
     render(ctx)   — called 60x/sec to draw the screen

   The manager keeps a STACK of states, like a stack of plates:
     - push(state)   adds a new state on top (e.g. a pause screen)
     - pop()         removes the top state (returns to previous)
     - change(state) replaces everything with a single new state
   ============================================================ */

class StateManager {

  constructor() {
    // The stack of active states. The LAST item is the active one.
    this._stack = [];
  }

  // ---- The most common operation: replace everything with a new state ----
  // Use this when navigating between screens (Menu → Game, Game → Game Over).
  change(newState) {
    // Exit and discard all current states
    if (this._stack.length > 0) {
      this._stack[this._stack.length - 1].exit();
    }
    this._stack = [newState];
    newState.enter();
  }

  // ---- Push a new state on top without removing the one below ----
  // Useful for overlays like a pause menu — the game state is kept underneath.
  push(newState) {
    if (this._stack.length > 0) {
      this._stack[this._stack.length - 1].exit();
    }
    this._stack.push(newState);
    newState.enter();
  }

  // ---- Remove the top state and return to the one below ----
  pop() {
    if (this._stack.length === 0) return;
    this._stack.pop().exit();
    if (this._stack.length > 0) {
      this._stack[this._stack.length - 1].enter();
    }
  }

  // ---- Update: runs the active state's game logic ----
  // dt = delta time in seconds (how long since the last frame)
  update(dt) {
    if (this._stack.length > 0) {
      this._stack[this._stack.length - 1].update(dt);
    }
  }

  // ---- Render: draws the active state to the screen ----
  render(ctx) {
    if (this._stack.length > 0) {
      this._stack[this._stack.length - 1].render(ctx);
    }
  }

  // ---- Convenience: check if a specific type of state is currently active ----
  isActive(StateClass) {
    if (this._stack.length === 0) return false;
    return this._stack[this._stack.length - 1] instanceof StateClass;
  }
}
