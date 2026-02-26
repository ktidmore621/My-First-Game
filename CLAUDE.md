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
        ├── PilotGameState.js     ← Pilot gameplay: movement, aim, HUD, placeholder enemies
        ├── GunnerGameState.js    ← Gunner gameplay: rotating gun aim, FIRE button, HUD
        └── GameOverState.js      ← Result screen; PLAY AGAIN / MAIN MENU buttons
```

---

## Game Coordinate System

All game logic uses a **fixed 960 × 540 (16:9) canvas**. The canvas is then scaled up/down with CSS to fit any screen size — like zooming a photograph. Always position objects assuming `GAME_WIDTH = 960`, `GAME_HEIGHT = 540`.

- x increases left → right
- y increases top → down
- Angles are in **radians** (0 = pointing right, π/2 = pointing down)

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

### StateManager (`js/engine/StateManager.js`)
- `change(state)` — replace everything with a new state (most common)
- `push(state)` — add state on top (use for pause screens / overlays)
- `pop()` — go back to the previous state

### InputHandler (`js/input/InputHandler.js`)
- `input.leftStick`  — `{ active, x, y, baseX, baseY }` — x/y range: -1 to +1
- `input.rightStick` — same shape as leftStick
- `input.tapsThisFrame` — array of `{ x, y }` tap positions in game coordinates
- `input.wasTappedInRegion(x, y, w, h)` — returns true if any tap was inside that rectangle
- `input.clearTaps()` — **call this at the end of every state's `update()`**
- `input.renderSticks(ctx)` — draws the thumbstick visuals; call from `render()`

Touch events use the left/right screen halves for left/right sticks. Mouse events work the same way (for desktop testing).

### HealthSystem (`js/entities/HealthSystem.js`)
```javascript
const hp = new HealthSystem(100);      // maxHealth = 100
hp.takeDamage(30);                     // currentHealth → 70
hp.heal(10);                           // currentHealth → 80
hp.getPercent();                       // → 0.80
hp.isAlive();                          // → true
hp.onDeath(() => console.log('dead')); // callback
hp.renderBar(ctx, x, y, width, height);
```

### Plane (`js/entities/Plane.js`)
```javascript
const p = new Plane({ id, name, speed, durability, weaponSize, maneuverability, x, y, color });
p.health    // HealthSystem instance
p.render(ctx)  // triangle placeholder + health bar
p.reset(x, y)  // restore health, reset velocity + position
```

The four stats (all 0–100):
| Stat | Effect |
|---|---|
| `speed` | Max pixels/sec at full stick deflection |
| `durability` | Max health points |
| `weaponSize` | Power/range of weapons (not yet wired up) |
| `maneuverability` | Stick responsiveness / turn acceleration |

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

## Git Workflow

- **Default branch**: `master`
- **Feature branches**: `claude/<task-slug>`
- **Active branch**: `claude/claude-md-mm2qx7mdoo3e0x5h-R0AK2`
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

These are the recommended steps to turn this foundation into a playable game, in order:

1. **Scrolling ground background** — create a parallax ground layer that scrolls left in PilotGameState to give the feeling of forward flight
2. **Bullets / projectiles** — add a `Bullet` entity; fire from the plane on right-stick input; fire from the gun in GunnerMode on FIRE tap
3. **Ground enemies** — add `AntiAirGun`, `MissileLauncher`, and `EnemyBase` entities with their own HealthSystem and attack logic
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
- **`_drawButton` is a global helper** defined in `MainMenuState.js` — all state files can call it
- **Script load order matters** — `index.html` loads files in dependency order; add new scripts in the right place
- **gameData is the inter-state bus** — store anything that needs to survive a state transition there
- **All coordinates are in game space (960×540)** — never use `window.innerWidth/Height` in game logic
- **`input.clearTaps()` must be called at the end of every `update()`** — failing to do so causes taps to persist across frames
- Avoid adding unrequested scaffolding, dependencies, or "improvements" beyond the task at hand
- Update this `CLAUDE.md` whenever the folder structure, conventions, or systems change significantly
