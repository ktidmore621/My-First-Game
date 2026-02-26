/* ============================================================
   InputHandler.js
   ============================================================
   Manages ALL player input — touch events on mobile and mouse
   clicks on desktop (for development testing).

   WHAT IT TRACKS:
   ┌─────────────────────────────────────────────────────────┐
   │  LEFT HALF OF SCREEN     │  RIGHT HALF OF SCREEN        │
   │  ── Left Thumbstick ──   │  ── Right Thumbstick ──      │
   │  Controls plane movement │  Controls weapon aim         │
   │  Output: x,y from -1→+1  │  Output: x,y from -1→+1     │
   └─────────────────────────────────────────────────────────┘

   TAPS:
   A "tap" is a quick touch with very little movement.
   Game states check taps each frame to detect button presses.
   Call input.clearTaps() at the end of each update() to reset.

   COORDINATE CONVERSION:
   Touch events give positions in screen pixels, but our game
   uses a fixed 960×540 coordinate system. _toGameCoords()
   handles the conversion so everything lines up correctly even
   when the canvas is scaled to different screen sizes.
   ============================================================ */

// --- Constants ---
const STICK_RADIUS     = 65;  // How far (in game pixels) the thumb can move from the stick base
const TAP_MAX_DISTANCE = 15;  // Max movement (game pixels) to still count as a tap

class InputHandler {

  constructor(canvas, gameWidth, gameHeight) {
    this._canvas     = canvas;
    this._gameWidth  = gameWidth;
    this._gameHeight = gameHeight;

    // ---- Left Thumbstick (plane movement) ----
    this.leftStick = {
      active: false, // Is a finger currently touching the left side?
      x: 0,          // Horizontal: -1 = full left, +1 = full right
      y: 0,          // Vertical:   -1 = full up,   +1 = full down
      baseX: 0,      // Where the finger first touched (for drawing the stick ring)
      baseY: 0,
    };

    // ---- Right Thumbstick (weapon aim) ----
    this.rightStick = {
      active: false,
      x: 0,
      y: 0,
      baseX: 0,
      baseY: 0,
    };

    // ---- Taps ----
    // Filled during touchend/mouseup. States read and clear this each frame.
    this.tapsThisFrame = []; // Array of { x, y } in game coordinates

    // ---- Internal tracking ----
    // Touch IDs let us track which finger is on which stick
    this._leftTouchId   = null;
    this._rightTouchId  = null;
    this._touchOrigins  = {}; // { touchId → {x, y} } — where each finger started

    // Mouse state (desktop testing)
    this._mouseDown     = false;
    this._mouseOrigin   = null;

    this._bindEvents();
  }

  // ==========================================================
  // PUBLIC API — used by game states
  // ==========================================================

  // Check if any tap this frame landed inside a rectangular area.
  // x, y = top-left corner of the area; w, h = size.
  wasTappedInRegion(x, y, w, h) {
    return this.tapsThisFrame.some(tap =>
      tap.x >= x && tap.x <= x + w &&
      tap.y >= y && tap.y <= y + h
    );
  }

  // Clear the tap list. Call at the END of each state's update().
  clearTaps() {
    this.tapsThisFrame = [];
  }

  // Draw the thumbstick visuals on screen.
  // Call from a state's render() method after drawing the game world.
  renderSticks(ctx) {
    this._drawStick(ctx, this.leftStick);
    this._drawStick(ctx, this.rightStick);
  }

  // ==========================================================
  // COORDINATE CONVERSION
  // ==========================================================

  // Convert a screen-pixel position (from a touch or mouse event)
  // into the game's 960×540 coordinate system.
  _toGameCoords(screenX, screenY) {
    const rect   = this._canvas.getBoundingClientRect();
    const scaleX = this._gameWidth  / rect.width;
    const scaleY = this._gameHeight / rect.height;
    return {
      x: (screenX - rect.left) * scaleX,
      y: (screenY - rect.top)  * scaleY,
    };
  }

  // ==========================================================
  // EVENT BINDING
  // ==========================================================

  _bindEvents() {
    const opts = { passive: false }; // passive:false allows us to call preventDefault()

    // Touch events (actual mobile / iOS)
    this._canvas.addEventListener('touchstart',  this._onTouchStart.bind(this),  opts);
    this._canvas.addEventListener('touchmove',   this._onTouchMove.bind(this),   opts);
    this._canvas.addEventListener('touchend',    this._onTouchEnd.bind(this),    opts);
    this._canvas.addEventListener('touchcancel', this._onTouchEnd.bind(this),    opts);

    // Mouse events (desktop browser testing)
    this._canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    this._canvas.addEventListener('mouseup',   this._onMouseUp.bind(this));
  }

  // ==========================================================
  // TOUCH EVENT HANDLERS
  // ==========================================================

  _onTouchStart(e) {
    e.preventDefault(); // Stop the browser from scrolling or zooming

    for (const touch of e.changedTouches) {
      const pos = this._toGameCoords(touch.clientX, touch.clientY);

      // Remember where this finger started (for tap detection)
      this._touchOrigins[touch.identifier] = { x: pos.x, y: pos.y };

      // Left half → left stick, Right half → right stick
      if (pos.x < this._gameWidth / 2) {
        if (this._leftTouchId === null) {
          this._leftTouchId       = touch.identifier;
          this.leftStick.active   = true;
          this.leftStick.baseX    = pos.x;
          this.leftStick.baseY    = pos.y;
          this.leftStick.x        = 0;
          this.leftStick.y        = 0;
        }
      } else {
        if (this._rightTouchId === null) {
          this._rightTouchId      = touch.identifier;
          this.rightStick.active  = true;
          this.rightStick.baseX   = pos.x;
          this.rightStick.baseY   = pos.y;
          this.rightStick.x       = 0;
          this.rightStick.y       = 0;
        }
      }
    }
  }

  _onTouchMove(e) {
    e.preventDefault();

    for (const touch of e.changedTouches) {
      const pos = this._toGameCoords(touch.clientX, touch.clientY);

      if (touch.identifier === this._leftTouchId) {
        this._updateStickValue(this.leftStick, pos.x, pos.y);
      } else if (touch.identifier === this._rightTouchId) {
        this._updateStickValue(this.rightStick, pos.x, pos.y);
      }
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();

    for (const touch of e.changedTouches) {
      const pos    = this._toGameCoords(touch.clientX, touch.clientY);
      const origin = this._touchOrigins[touch.identifier];

      // Check for tap: did the finger move less than the threshold?
      if (origin) {
        const dist = Math.hypot(pos.x - origin.x, pos.y - origin.y);
        if (dist < TAP_MAX_DISTANCE) {
          this.tapsThisFrame.push({ x: pos.x, y: pos.y });
        }
        delete this._touchOrigins[touch.identifier];
      }

      // Release whichever stick this finger was on
      if (touch.identifier === this._leftTouchId) {
        this._releaseLeftStick();
      } else if (touch.identifier === this._rightTouchId) {
        this._releaseRightStick();
      }
    }
  }

  // ==========================================================
  // MOUSE EVENT HANDLERS (desktop testing)
  // ==========================================================

  _onMouseDown(e) {
    this._mouseDown = true;
    const pos       = this._toGameCoords(e.clientX, e.clientY);
    this._mouseOrigin = { x: pos.x, y: pos.y };

    if (pos.x < this._gameWidth / 2) {
      this._leftTouchId     = 'mouse';
      this.leftStick.active = true;
      this.leftStick.baseX  = pos.x;
      this.leftStick.baseY  = pos.y;
      this.leftStick.x      = 0;
      this.leftStick.y      = 0;
    } else {
      this._rightTouchId      = 'mouse';
      this.rightStick.active  = true;
      this.rightStick.baseX   = pos.x;
      this.rightStick.baseY   = pos.y;
      this.rightStick.x       = 0;
      this.rightStick.y       = 0;
    }
  }

  _onMouseMove(e) {
    if (!this._mouseDown) return;
    const pos = this._toGameCoords(e.clientX, e.clientY);

    if (this._leftTouchId === 'mouse') {
      this._updateStickValue(this.leftStick, pos.x, pos.y);
    } else if (this._rightTouchId === 'mouse') {
      this._updateStickValue(this.rightStick, pos.x, pos.y);
    }
  }

  _onMouseUp(e) {
    if (!this._mouseDown) return;
    this._mouseDown = false;

    const pos = this._toGameCoords(e.clientX, e.clientY);

    // Check for mouse click tap
    if (this._mouseOrigin) {
      const dist = Math.hypot(pos.x - this._mouseOrigin.x, pos.y - this._mouseOrigin.y);
      if (dist < TAP_MAX_DISTANCE) {
        this.tapsThisFrame.push({ x: pos.x, y: pos.y });
      }
      this._mouseOrigin = null;
    }

    if (this._leftTouchId === 'mouse')  this._releaseLeftStick();
    if (this._rightTouchId === 'mouse') this._releaseRightStick();
  }

  // ==========================================================
  // HELPERS
  // ==========================================================

  // Calculate the stick's normalized x/y output based on
  // how far the finger is from the stick's base position.
  _updateStickValue(stick, touchX, touchY) {
    const dx   = touchX - stick.baseX;
    const dy   = touchY - stick.baseY;
    const dist = Math.hypot(dx, dy);

    if (dist > STICK_RADIUS) {
      // Clamp to edge of circle: normalize to exactly ±1
      stick.x = dx / dist;
      stick.y = dy / dist;
    } else {
      // Inside circle: scale linearly between 0 and 1
      stick.x = dx / STICK_RADIUS;
      stick.y = dy / STICK_RADIUS;
    }
  }

  _releaseLeftStick() {
    this._leftTouchId   = null;
    this.leftStick.active = false;
    this.leftStick.x      = 0;
    this.leftStick.y      = 0;
  }

  _releaseRightStick() {
    this._rightTouchId    = null;
    this.rightStick.active = false;
    this.rightStick.x      = 0;
    this.rightStick.y      = 0;
  }

  // Draw a single thumbstick's visual (ring + thumb dot)
  _drawStick(ctx, stick) {
    if (!stick.active) return;

    ctx.save();
    ctx.globalAlpha = 0.45;

    // Outer ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, STICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Thumb dot — positioned based on current x/y values
    const thumbX = stick.baseX + stick.x * STICK_RADIUS;
    const thumbY = stick.baseY + stick.y * STICK_RADIUS;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, STICK_RADIUS * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
