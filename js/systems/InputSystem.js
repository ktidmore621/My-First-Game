/* ============================================================
   InputSystem.js — Phaser-based input wrapper
   ============================================================
   Replaces the legacy InputHandler with Phaser's pointer and
   keyboard APIs. Provides the same public interface so existing
   game logic needs minimal changes.

   USAGE (inside a Phaser scene):

     create() {
       this.inputSys = new InputSystem(this);
     }

     update(time, delta) {
       this.inputSys.update();      // ← must be first line
       // ... read sticks, check flags ...
       this.inputSys.clearTaps();   // ← must be last line
     }

   PUBLIC INTERFACE:
     input.leftStick           — { active, x, y, baseX, baseY }
     input.rightStick          — same shape
     input.weaponSelectPressed — true for one frame on button/key press
     input.evadePressed        — true for one frame on button/key press
     input.firePressed         — true for one frame on button/key press
     input.tapsThisFrame       — [{ x, y }] in game coordinates
     input.wasTappedInRegion(x, y, w, h) → boolean
     input.update()            — call at start of every scene update()
     input.clearTaps()         — call at end of every scene update()
     input.renderSticks(ctx)   — no-op; Phaser handles stick rendering

   TOUCH / POINTER:
     Left half of screen  (x < 480) → left stick
     Right half of screen (x ≥ 480) → right stick
     Quick release (< 15 px travel)  → tapsThisFrame entry

   KEYBOARD (desktop testing):
     WASD / Arrow keys   → left stick (continuous)
     IJKL                → right stick (continuous)
     Space               → firePressed (one-shot)
     Shift               → evadePressed (one-shot)
     Q or E              → weaponSelectPressed (one-shot)

   BUTTONS (Phaser GameObjects, always in scene display list):
     WEAPON SELECT — bottom centre  (cx 480, cy 495, 200 × 48)
     EVADE         — bottom right   (cx 868, cy 495, 140 × 48)
     FIRE          — above EVADE    (cx 868, cy 435, 140 × 48)

   Each button scales to 0.9× on press via a brief tween.
   Scenes can toggle button visibility with .setVisible(bool).
   ============================================================ */

// Max thumb travel from base in game pixels (matches legacy InputHandler)
const INPUT_STICK_RADIUS = 65;
// Max pointer movement (game px) that still counts as a tap
const INPUT_TAP_MAX_DIST = 15;

class InputSystem {

  constructor(scene) {
    this.scene = scene;

    // Ensures 4 total pointers (default 1 + 3 added) for dual-stick multi-touch
    this.scene.input.addPointer(3);

    // ---- Stick state (same shape as InputHandler) ----
    this.leftStick  = { active: false, x: 0, y: 0, baseX: 0, baseY: 0 };
    this.rightStick = { active: false, x: 0, y: 0, baseX: 0, baseY: 0 };

    // ---- One-shot button flags — reset by clearTaps() ----
    this.weaponSelectPressed = false;
    this.evadePressed        = false;
    this.firePressed         = false;

    // ---- Tap accumulator — reset by clearTaps() ----
    this.tapsThisFrame = [];

    // ---- Internal pointer tracking ----
    this._leftPointerId  = null;  // Phaser pointer id on left stick
    this._rightPointerId = null;  // Phaser pointer id on right stick
    this._pointerOrigins = {};    // { id → { x, y } } — start positions

    // ---- Persistent Graphics for stick ring + knob visuals ----
    // Depth 90 puts it above gameplay objects but below buttons (95)
    this._stickGfx = scene.add.graphics().setDepth(90).setScrollFactor(0);

    // ---- Button hit regions in game coords (top-left origin) ----
    // Kept in sync with _buildButtons() positions.
    this._buttonBounds = [
      { x: 380, y: 471, w: 200, h: 48, btn: null },  // WEAPON SELECT
      { x: 798, y: 471, w: 140, h: 48, btn: null },  // EVADE
      { x: 798, y: 411, w: 140, h: 48, btn: null },  // FIRE
    ];

    this._buildButtons();
    this._bindPointerEvents();
    this._setupKeyboard();
  }

  // ==========================================================
  // PUBLIC API
  // ==========================================================

  /**
   * Call at the START of every scene update().
   * Applies keyboard values to sticks and redraws stick visuals.
   */
  update() {
    this._applyKeyboard();
    this._drawSticks();
  }

  /**
   * No-op — stick visuals are Phaser GameObjects that render
   * automatically each frame. Kept for API parity with InputHandler.
   */
  renderSticks(ctx) {}  // eslint-disable-line no-unused-vars

  /** True if any tap this frame landed inside the given rectangle. */
  wasTappedInRegion(x, y, w, h) {
    return this.tapsThisFrame.some(t =>
      t.x >= x && t.x <= x + w &&
      t.y >= y && t.y <= y + h
    );
  }

  /**
   * Reset all one-frame inputs.
   * Call at the END of every scene update().
   */
  clearTaps() {
    this.tapsThisFrame       = [];
    this.weaponSelectPressed = false;
    this.evadePressed        = false;
    this.firePressed         = false;
  }

  /**
   * Tear down event listeners and Phaser objects.
   * Call from scene shutdown() if InputSystem needs explicit cleanup.
   */
  destroy() {
    const input = this.scene.input;
    input.off(Phaser.Input.Events.POINTER_DOWN,  this._boundPointerDown);
    input.off(Phaser.Input.Events.POINTER_MOVE,  this._boundPointerMove);
    input.off(Phaser.Input.Events.POINTER_UP,    this._boundPointerUp);

    this._stickGfx.destroy();
    this.weaponSelectBtn.destroy();
    this.evadeBtn.destroy();
    this.fireBtn.destroy();
  }

  // ==========================================================
  // BUTTON SETUP
  // ==========================================================

  _buildButtons() {
    const scene = this.scene;

    // ---- WEAPON SELECT — bottom centre ----
    this.weaponSelectBtn = this._makeButton(
      scene, 480, 495, 200, 48,
      'WEAPON SELECT', 0x0d2a4a, 0x2a6aaa, '#7ec8e3', '15px'
    );
    this.weaponSelectBtn.on('pointerdown', () => {
      this.weaponSelectPressed = true;
      this._animPress(this.weaponSelectBtn);
    });
    this._buttonBounds[0].btn = this.weaponSelectBtn;

    // ---- EVADE — bottom right ----
    this.evadeBtn = this._makeButton(
      scene, 868, 495, 140, 48,
      'EVADE', 0x2a0d0d, 0xaa2a2a, '#f06060', '15px'
    );
    this.evadeBtn.on('pointerdown', () => {
      this.evadePressed = true;
      this._animPress(this.evadeBtn);
    });
    this._buttonBounds[1].btn = this.evadeBtn;

    // ---- FIRE — above EVADE, bottom right ----
    this.fireBtn = this._makeButton(
      scene, 868, 435, 140, 48,
      'FIRE', 0x2a1a00, 0xcc6600, '#ff9900', '17px'
    );
    this.fireBtn.on('pointerdown', () => {
      this.firePressed = true;
      this._animPress(this.fireBtn);
    });
    this._buttonBounds[2].btn = this.fireBtn;
  }

  /**
   * Build a Container-based button with interactive hit area.
   * Matches the pattern used by MainMenuScene._makeButton().
   */
  _makeButton(scene, cx, cy, w, h, label, bgColor, borderColor, textColor, fontSize) {
    const container = scene.add.container(cx, cy).setDepth(95).setScrollFactor(0);

    const bg = scene.add.graphics();
    bg.fillStyle(bgColor, 0.85);
    bg.fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(1.5, borderColor);
    bg.strokeRect(-w / 2, -h / 2, w, h);

    const txt = scene.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize,
      color: textColor,
    }).setOrigin(0.5, 0.5);

    container.add([bg, txt]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });

    return container;
  }

  /** Brief scale-down tween for tactile button press feedback. */
  _animPress(container) {
    this.scene.tweens.add({
      targets:  container,
      scaleX:   0.9,
      scaleY:   0.9,
      duration: 80,
      yoyo:     true,
      ease:     'Power1',
    });
  }

  // ==========================================================
  // POINTER EVENTS
  // ==========================================================

  _bindPointerEvents() {
    // Store bound references so they can be removed in destroy()
    this._boundPointerDown = this._onPointerDown.bind(this);
    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundPointerUp   = this._onPointerUp.bind(this);

    const input = this.scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN,  this._boundPointerDown);
    input.on(Phaser.Input.Events.POINTER_MOVE,  this._boundPointerMove);
    input.on(Phaser.Input.Events.POINTER_UP,    this._boundPointerUp);
  }

  _onPointerDown(pointer) {
    const x  = pointer.x;
    const y  = pointer.y;
    const id = pointer.id;

    // Always record origin for tap detection (button and stick taps)
    this._pointerOrigins[id] = { x, y };

    // Buttons capture their own input via setInteractive —
    // don't also activate a stick for button-area touches.
    if (this._isOnButton(x, y)) return;

    if (x < 480) {
      // Left screen half → left thumbstick
      if (this._leftPointerId === null) {
        this._leftPointerId   = id;
        this.leftStick.active = true;
        this.leftStick.baseX  = x;
        this.leftStick.baseY  = y;
        this.leftStick.x      = 0;
        this.leftStick.y      = 0;
      }
    } else {
      // Right screen half → right thumbstick
      if (this._rightPointerId === null) {
        this._rightPointerId   = id;
        this.rightStick.active = true;
        this.rightStick.baseX  = x;
        this.rightStick.baseY  = y;
        this.rightStick.x      = 0;
        this.rightStick.y      = 0;
      }
    }
  }

  _onPointerMove(pointer) {
    const id = pointer.id;
    if      (id === this._leftPointerId)  this._updateStick(this.leftStick,  pointer.x, pointer.y);
    else if (id === this._rightPointerId) this._updateStick(this.rightStick, pointer.x, pointer.y);
  }

  _onPointerUp(pointer) {
    const id     = pointer.id;
    const origin = this._pointerOrigins[id];

    // Tap detection: register if the pointer barely moved
    if (origin) {
      const dist = Math.hypot(pointer.x - origin.x, pointer.y - origin.y);
      if (dist < INPUT_TAP_MAX_DIST) {
        this.tapsThisFrame.push({ x: pointer.x, y: pointer.y });
      }
      delete this._pointerOrigins[id];
    }

    if (id === this._leftPointerId)  this._releaseLeftStick();
    if (id === this._rightPointerId) this._releaseRightStick();
  }

  /** Returns true when (x, y) overlaps any visible button's hit region. */
  _isOnButton(x, y) {
    return this._buttonBounds.some(b =>
      (!b.btn || b.btn.visible) &&
      x >= b.x && x <= b.x + b.w &&
      y >= b.y && y <= b.y + b.h
    );
  }

  // ==========================================================
  // KEYBOARD
  // ==========================================================

  _setupKeyboard() {
    const kb = this.scene.input.keyboard;

    this._keys = kb.addKeys({
      // Left stick — WASD
      w:     Phaser.Input.Keyboard.KeyCodes.W,
      a:     Phaser.Input.Keyboard.KeyCodes.A,
      s:     Phaser.Input.Keyboard.KeyCodes.S,
      d:     Phaser.Input.Keyboard.KeyCodes.D,
      // Left stick — arrow keys
      up:    Phaser.Input.Keyboard.KeyCodes.UP,
      left:  Phaser.Input.Keyboard.KeyCodes.LEFT,
      down:  Phaser.Input.Keyboard.KeyCodes.DOWN,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      // Right stick — IJKL
      i:     Phaser.Input.Keyboard.KeyCodes.I,
      j:     Phaser.Input.Keyboard.KeyCodes.J,
      k:     Phaser.Input.Keyboard.KeyCodes.K,
      l:     Phaser.Input.Keyboard.KeyCodes.L,
      // Action buttons (one-shot on keydown)
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      q:     Phaser.Input.Keyboard.KeyCodes.Q,
      e:     Phaser.Input.Keyboard.KeyCodes.E,
    });

    // One-shot flags: set on keydown, consumed by clearTaps()
    this._keys.space.on('down', () => { this.firePressed         = true; });
    this._keys.shift.on('down', () => { this.evadePressed        = true; });
    this._keys.q.on('down',     () => { this.weaponSelectPressed = true; });
    this._keys.e.on('down',     () => { this.weaponSelectPressed = true; });
  }

  /**
   * Synthesise stick values from held keyboard keys.
   * Only takes effect when no pointer is driving that stick.
   * Called every frame from update().
   */
  _applyKeyboard() {
    const k = this._keys;
    if (!k) return;

    // --- Left stick ---
    if (this._leftPointerId === null) {
      const kx = (k.d.isDown || k.right.isDown ? 1 : 0)
               - (k.a.isDown || k.left.isDown  ? 1 : 0);
      const ky = (k.s.isDown || k.down.isDown  ? 1 : 0)
               - (k.w.isDown || k.up.isDown    ? 1 : 0);
      this.leftStick.x      = kx;
      this.leftStick.y      = ky;
      this.leftStick.active = kx !== 0 || ky !== 0;
    }

    // --- Right stick ---
    if (this._rightPointerId === null) {
      const rx = (k.l.isDown ? 1 : 0) - (k.j.isDown ? 1 : 0);
      const ry = (k.k.isDown ? 1 : 0) - (k.i.isDown ? 1 : 0);
      this.rightStick.x      = rx;
      this.rightStick.y      = ry;
      this.rightStick.active = rx !== 0 || ry !== 0;
    }
  }

  // ==========================================================
  // STICK HELPERS
  // ==========================================================

  /**
   * Compute normalised stick x/y from how far the pointer has
   * moved from the stick's base. Clamps to ±1 at the radius edge.
   */
  _updateStick(stick, px, py) {
    const dx   = px - stick.baseX;
    const dy   = py - stick.baseY;
    const dist = Math.hypot(dx, dy);

    if (dist > INPUT_STICK_RADIUS) {
      // At or beyond radius: clamp to unit vector
      stick.x = dx / dist;
      stick.y = dy / dist;
    } else {
      // Inside radius: linear 0→1 scale
      stick.x = dx / INPUT_STICK_RADIUS;
      stick.y = dy / INPUT_STICK_RADIUS;
    }
  }

  _releaseLeftStick() {
    this._leftPointerId   = null;
    this.leftStick.active = false;
    this.leftStick.x      = 0;
    this.leftStick.y      = 0;
  }

  _releaseRightStick() {
    this._rightPointerId   = null;
    this.rightStick.active = false;
    this.rightStick.x      = 0;
    this.rightStick.y      = 0;
  }

  // ==========================================================
  // STICK VISUALS
  // ==========================================================

  /**
   * Clear and redraw stick rings + knobs each frame.
   * Only draws touch-driven sticks (keyboard has no visual).
   */
  _drawSticks() {
    const gfx = this._stickGfx;
    gfx.clear();

    if (this._leftPointerId  !== null) this._drawOneStick(gfx, this.leftStick);
    if (this._rightPointerId !== null) this._drawOneStick(gfx, this.rightStick);
  }

  _drawOneStick(gfx, stick) {
    // Outer ring — 60 px radius, semi-transparent
    gfx.lineStyle(2, 0xffffff, 0.45);
    gfx.strokeCircle(stick.baseX, stick.baseY, 60);

    // Inner knob — 24 px radius, offset by current stick deflection
    const knobX = stick.baseX + stick.x * INPUT_STICK_RADIUS;
    const knobY = stick.baseY + stick.y * INPUT_STICK_RADIUS;
    gfx.fillStyle(0xffffff, 0.55);
    gfx.fillCircle(knobX, knobY, 24);
  }
}
