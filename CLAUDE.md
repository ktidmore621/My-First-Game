# CLAUDE.md — AI Assistant Guide for My-First-Game

## Project Overview

**My-First-Game** is a **2D survival flight game** built with HTML5 Canvas and JavaScript, designed to run on iOS (wrapped in a native WKWebView container). The game has two modes:

- **Pilot Mode** — fly a plane over enemy territory, destroy ground threats before reaching your destination
- **Gunner Mode** — control a ground anti-aircraft gun, shoot down incoming enemy planes

The project uses **no build system, no frameworks, no dependencies** — just plain HTML, CSS, and JavaScript files that run directly in any browser. This keeps it easy to iterate and test.

---

## Repository Structure

```
My-First-Game/
├── index.html                    ← Entry point; loads all scripts in order
├── .gitignore
├── CLAUDE.md                     ← This file
├── README.md
│
├── css/
│   └── style.css                 ← Canvas scaling, mobile-friendly, landscape orientation
│
└── js/
    ├── main.js                   ← Starts the game (runs last)
    │
    ├── engine/
    │   ├── GameLoop.js           ← requestAnimationFrame loop; calls update + render at ~60fps
    │   └── StateManager.js       ← Screen/state stack (change, push, pop)
    │
    ├── input/
    │   └── InputHandler.js       ← Touch + mouse; left/right virtual thumbsticks; tap detection
    │
    ├── entities/
    │   ├── HealthSystem.js       ← Reusable health/damage system with callbacks
    │   └── Plane.js              ← Player plane with 4 stats, velocity, health, placeholder render
    │
    └── states/
        ├── MainMenuState.js      ← Title screen; PILOT MODE / GUNNER MODE buttons
        ├── PlaneSelectState.js   ← Card-based plane chooser (3 planes, 4 stat bars each)
        ├── PilotGameState.js     ← Pilot gameplay: movement, scrolling ground, aim, HUD
        ├── GunnerGameState.js    ← Gunner gameplay: rotating gun aim, FIRE button, HUD
        └── GameOverState.js      ← Result screen; PLAY AGAIN / MAIN MENU buttons
```

---

## Script Load Order

The order of `<script>` tags in `index.html` is **critical** — there is no module system. Files must be loaded after their dependencies:

1. **Foundation** (no dependencies): `HealthSystem.js`, `StateManager.js`
2. **Systems** (depend on foundation): `GameLoop.js`, `InputHandler.js`, `Plane.js`
3. **Game Screens** (depend on systems): All state files (`MainMenuState.js` → `GameOverState.js`)
4. **Entry Point** (ties everything together): `main.js`

When adding a new script, add its `<script>` tag in the right position — after everything it depends on, and before anything that depends on it.

---

## Game Coordinate System

All game logic uses a **fixed 960 × 540 (16:9) canvas**. The canvas is then scaled up/down with CSS to fit any screen size — like zooming a photograph. Always position objects assuming `GAME_WIDTH = 960`, `GAME_HEIGHT = 540`.

- x increases left → right
- y increases top → down
- Angles are in **radians** (0 = pointing right, π/2 = pointing down)

---

## Visual Style Guide

The game targets a **16-bit SNES-era pixel-art aesthetic** — more pixels at a smaller scale for readable detail, not chunky 8-bit blocks. Think Super Metroid or Contra III: individual sprites contain enough sub-pixel detail (rivets, panel seams, highlight edges, 1px shadow rows) to read clearly at gameplay distances. All new rendering code must follow these rules:

1. **Hard pixel edges everywhere** — no anti-aliasing, no smooth gradients on solid objects. Use flat `fillRect` colour bands instead of `createLinearGradient` for backgrounds.
2. **`ctx.imageSmoothingEnabled = false`** must be set at the start of every `render()` call (and anywhere else the canvas context is referenced for drawing).
3. **Limited, intentional colour palette**:
   - *Ground*: earthy muted tones — `#2a2010`, `#3c2e16`, `#4a3820`, `#5e4a28`
   - *Sky*: deep blues and purples — `#07101f`, `#0d1e38`, `#122848`, `#1e3a52`
   - *Warm accents*: amber/orange for horizon glow and fires — `#3a2010`, `#96461e`
   - *UI / explosions*: warm highlights — reds, oranges, whites
4. **Pixel-grid shapes only** — favour `fillRect` and clear outlines over `arc`, `ellipse`, and curves. Sprites and ground features should feel drawn on a grid, with flat shading and no soft edges.
5. **16×16 and 32×32 unit tile grid** — the game's pixel grid is based on these tile sizes. All future entities (enemies, bullets, pickups) must be designed to snap to this scale. The 960×540 canvas fits exactly 60×33.75 sixteen-pixel tiles.
6. **OrcCannon is the detail standard** — all future ground entities must match `OrcCannon.js` in visual density: panel seams, rivet highlights, shadow pixels, multi-layer colour, and a multi-frame explosion sequence. A ground entity is not complete until it has the same depth of `fillRect` detail as the OrcCannon structure and its death animation.

---

## State Machine Flow

```
MainMenuState
   ├── PILOT MODE  → PlaneSelectState → PilotGameState → GameOverState → MainMenuState
   └── GUNNER MODE → GunnerGameState  → GameOverState  → MainMenuState
```

Every state implements four methods:
| Method | Purpose |
|---|---|
| `enter()` | Called once when the state becomes active |
| `exit()` | Called once when leaving the state |
| `update(dt)` | Game logic; `dt` = seconds since last frame |
| `render(ctx)` | Draw the screen; called after update |

---

## Core Systems

### GameLoop (`js/engine/GameLoop.js`)
Uses `requestAnimationFrame`. Calculates delta time (`dt`) in seconds each frame. Caps `dt` at `1/20s` to prevent physics explosions after tab-background pauses. Calls `stateManager.update(dt)` then `stateManager.render(ctx)`.

- `start()` — begins the loop
- `stop()` — cancels the loop (for native iOS transitions)

### StateManager (`js/engine/StateManager.js`)
- `change(state)` — replace everything with a new state (most common)
- `push(state)` — add state on top (use for pause screens / overlays)
- `pop()` — go back to the previous state
- `isActive(StateClass)` — check if a specific state type is current

### InputHandler (`js/input/InputHandler.js`)
- `input.leftStick`  — `{ active, x, y, baseX, baseY }` — x/y range: -1 to +1
- `input.rightStick` — same shape as leftStick
- `input.tapsThisFrame` — array of `{ x, y }` tap positions in game coordinates
- `input.wasTappedInRegion(x, y, w, h)` — returns true if any tap was inside that rectangle
- `input.clearTaps()` — **call this at the end of every state's `update()`**
- `input.renderSticks(ctx)` — draws the thumbstick visuals; call from `render()`

Internal constants: `STICK_RADIUS = 65` (max thumb travel), `TAP_MAX_DISTANCE = 15` (drag threshold).

Touch events use the left/right screen halves for left/right sticks. Mouse events work the same way (for desktop testing). Multi-touch is tracked by `touch.identifier` so each finger is independent.

### HealthSystem (`js/entities/HealthSystem.js`)
```javascript
const hp = new HealthSystem(100);                     // maxHealth = 100
hp.takeDamage(30);                                    // currentHealth → 70
hp.heal(10);                                          // currentHealth → 80
hp.getPercent();                                      // → 0.80
hp.isAlive();                                         // → true
hp.reset();                                           // restore to maxHealth
hp.onDamage((amount, remaining) => { /* ... */ });    // callback on each hit
hp.onDeath(() => console.log('dead'));                // callback on death
hp.renderBar(ctx, x, y, width, height);
```

Both `onDamage` and `onDeath` return `this` for chaining. Multiple callbacks can be registered on the same instance. Health bar color transitions: Green (full) → Yellow (half) → Red (critical).

### Plane (`js/entities/Plane.js`)
```javascript
const p = new Plane({ id, name, speed, durability, weaponSize, maneuverability, x, y, color });
p.health       // HealthSystem instance
p.render(ctx)  // triangle placeholder + health bar; cockpit highlight is a pixel-art fillRect
p.reset(x, y)  // restore health, reset velocity + position
p.isAlive()    // convenience wrapper for p.health.isAlive()
```

Optional constructor fields: `width` (default 64), `height` (default 28). All stats default to 50 if omitted.

The four stats (all 0–100):
| Stat | Effect |
|---|---|
| `speed` | Max pixels/sec at full stick deflection |
| `durability` | Max health points |
| `weaponSize` | Power/range of weapons (not yet wired up) |
| `maneuverability` | Stick responsiveness / turn acceleration |

---

## Plane Definitions (PlaneSelectState)

Three aircraft are defined in `PlaneSelectState.js` and created fresh on each visit to that screen:

| Name | Color | Speed | Durability | Weapon | Maneuver | Profile |
|---|---|---|---|---|---|---|
| **Fighter** | Blue `#42a5f5` | 82 | 55 | 65 | 90 | Fast & agile, fragile |
| **Bomber** | Gray `#78909c` | 42 | 95 | 95 | 35 | Slow, tough, powerful |
| **Scout** | Green `#66bb6a` | 95 | 38 | 42 | 96 | Fastest/most agile, weakest |

When the player taps "FLY!", the selected plane is reset to position `(100, 270)` and stored in `gameData.selectedPlane`, then `PilotGameState` is entered.

---

## Shared gameData Object

A plain object passed through every state constructor, holding cross-state information:

```javascript
gameData = {
  mode:          'pilot' | 'gunner' | null,
  selectedPlane: Plane | null,   // chosen in PlaneSelectState
  score:         Number,          // accumulated during gameplay
  result:        'victory' | 'defeated' | 'survived' | null,
}
```

---

## PilotGameState — Key Details

### Movement
- Left stick moves the plane; right stick sets the aim angle (red dashed line from nose)
- Max movement speed: `(plane.speed / 100) * 220` px/s
- Stick responsiveness: `(plane.maneuverability / 100) * 10 + 4`
- Velocity smooths toward stick input each frame; position clamped to plane half-size from all edges
- Plane angle rotates to face velocity direction when speed > 15 px/s

### Scrolling Ground (already implemented)
A seamless looping ground tile (960px wide) scrolls left as the plane flies:
- `_groundOffset` accumulates distance scrolled
- Scroll speed: `55 + (plane.speed / 100) * 165` px/s (ranges from 55 → 220 px/s)
- Two tiles drawn with modulo wrapping to create an invisible seam

Ground features built by `_buildGroundFeatures()` — all positioned in 0–960 tile space:
- 2 road strips with center-line dashes
- 8 bomb craters (flat rectangles: outer sandy ejecta ring + inner dark pit — no ellipses)
- 5 scorched/burned patches
- 3 sandy texture patches
- 4 rubble piles (small rectangle clusters)

### Game-Over Triggers
- Plane health reaches zero → 800ms delay → GameOverState (`'defeated'`)
- 30-second timer elapses → GameOverState (placeholder; score = `elapsed * 10`)

### Placeholder Buttons
"WEAPON SELECT" and "EVADE" (bottom-right) currently only log to the console — they are stubs for future implementation.

---

## GunnerGameState — Key Details

- Right stick rotates the gun barrel; aim is clamped to the upper hemisphere (can't aim into the ground)
- "FIRE" button (bottom-right) is a placeholder — logs aim angle to console
- Gun health: 150 HP; destruction triggers GameOverState (`'defeated'`); score = `elapsed * 8`
- "← Back" button (top-left) returns to MainMenuState
- Aim angle readout in degrees shown bottom-left (development helper)
- 30-second auto-game-over with `'survived'` result (placeholder); score = `elapsed * 8`
- Sky uses four flat `fillRect` bands matching the palette (rules 1 & 3); turret dome is a `fillRect` rectangle (rule 4)

---

## CSS & HTML Notes

### style.css
- Global reset: margin/padding/box-sizing on all elements
- `html, body`: 100% size, black background, flexbox centering, `overflow: hidden`, zoom disabled
- Canvas: `image-rendering: crisp-edges` (Firefox) + `image-rendering: pixelated` (Chrome/Safari) for sharp pixel scaling, `cursor: crosshair`
- **Portrait orientation overlay**: `@media screen and (orientation: portrait)` shows "↻ Please rotate your device to landscape" — the game requires landscape

### index.html Meta Tags (iOS critical)
- `viewport`: `user-scalable=no` — prevents pinch-zoom breaking input
- `apple-mobile-web-app-capable`: enables full-screen when added to iOS home screen
- `apple-mobile-web-app-status-bar-style: black-fullscreen` — immersive status bar
- `format-detection: telephone=no` — prevents phone-number link detection

---

## Git Workflow

- **Default branch**: `master`
- **Feature branches**: `claude/<task-slug>`
- **Active branch**: `claude/claude-md-mm2w5onwii8h2gkg-a9j7x`
- Never push to `master` without explicit permission
- Commit messages: imperative, one logical change per commit
- Push with: `git push -u origin <branch-name>`
- Retry on network failure: 2s → 4s → 8s → 16s (max 4 retries)

---

## Development Conventions

### Code Style
- 2-space indentation in all JS/HTML/CSS
- `camelCase` for variables and methods; `PascalCase` for classes
- `const` by default; `let` when reassignment is needed; never `var`
- Private/internal members prefixed with `_` (e.g. `this._stack`)
- Comments explain *why*, not *what* — the code should be readable on its own
- Section separators: `// ================================================================`

### Adding a New State
1. Create `js/states/YourState.js`
2. Add `enter()`, `exit()`, `update(dt)`, `render(ctx)` methods
3. Add a `<script>` tag in `index.html` **before** `main.js`
4. Navigate to it with `stateManager.change(new YourState(sm, input, gameData))`

### Adding a New Entity
1. Create `js/entities/YourEntity.js`
2. Load it in `index.html` before any state that uses it
3. Give it a `render(ctx)` method and optionally an `update(dt)` method
4. Attach a `HealthSystem` instance if it can take damage

### No Build System
Open `index.html` directly in a browser or serve it with any static file server:
```bash
npx serve .     # Node.js
python3 -m http.server 8080
```
No `npm install`, no compilation step needed.

### Testing on iOS
- Use Safari → Develop → Simulator, or connect a real device
- Inspect with Safari Web Inspector
- Test touch events on actual hardware before finalizing any input changes

---

## Logical Next Steps

These are the recommended next steps to turn this foundation into a playable game, in priority order:

1. ~~**Scrolling ground background**~~ ✅ — Implemented in `PilotGameState._buildGroundFeatures()` and `_groundOffset` scroll loop
2. **Bullets / projectiles** — add a `Bullet` entity; fire from the plane on right-stick tap; fire from the gun in GunnerMode on FIRE tap
3. **Ground enemies** — add `AntiAirGun`, `MissileLauncher`, and `EnemyBase` entities with their own HealthSystem and attack logic; make them scroll with the ground
4. **Collision detection** — simple AABB (rectangle) overlap checks between bullets and entities
5. **Enemy planes (Gunner Mode)** — add planes that fly across the sky in GunnerGameState
6. **Win/lose conditions** — replace the 30-second placeholder timer with real mission goals
7. **Plane sprites** — replace the triangle placeholder in `Plane.render()` with `ctx.drawImage()`
8. **Sound** — use the Web Audio API for engine sounds, explosions, firing
9. **iOS native wrapper** — integrate with WKWebView using `window.webkit.messageHandlers` for native iOS communication

---

## What AI Assistants Should Know

- **No build step** — edit files, refresh browser, that's it
- **No external libraries** — keep it dependency-free unless there's a compelling reason
- **`_drawButton` is a global helper** defined at the bottom of `MainMenuState.js` — all state files can call it since it loads first among the states
- **`_drawHUDButton` is a file-scoped helper** defined at the bottom of `PilotGameState.js` — it is only available within that file; do not call it from other states (use `_drawButton` or define a local equivalent instead). It supports multiline labels via `\n` in the label string.
- **`_drawPlaceholderEnemy` is a file-scoped helper** defined at the bottom of `PilotGameState.js` — draws a red placeholder box + label above a position; only used there for the static AA Gun / Missile / Base markers
- **Script load order matters** — `index.html` loads files in dependency order; add new scripts in the right place
- **gameData is the inter-state bus** — store anything that needs to survive a state transition there
- **All coordinates are in game space (960×540)** — never use `window.innerWidth/Height` in game logic
- **`input.clearTaps()` must be called at the end of every `update()`** — failing to do so causes taps to persist across frames
- **`ctx.save()` / `ctx.restore()` around every transform** — prevents cascading matrix bugs
- **Death callbacks use `setTimeout(800ms)`** — brief delay before transitioning to GameOverState; `_gameOverPending` flag prevents duplicate triggers
- **`ctx.imageSmoothingEnabled = false`** must be the first line of every `render()` method — now set in all render methods: `PilotGameState`, `GunnerGameState`, `MainMenuState`, `PlaneSelectState`, `GameOverState`, and `Plane.render()`. Any new `render()` method must continue this pattern.
- **`window.game`** is exposed in `main.js` for browser console debugging: `game.stateManager`, `game.input`, `game.gameLoop`, `game.gameData`
- Avoid adding unrequested scaffolding, dependencies, or "improvements" beyond the task at hand
- Update this `CLAUDE.md` whenever the folder structure, conventions, or systems change significantly
