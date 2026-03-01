# CLAUDE.md — AI Assistant Guide for My-First-Game

## Project Overview

**My-First-Game** is a **2D survival flight game** built with Phaser 3 and JavaScript, designed to run on iOS (wrapped in a native WKWebView container). The game has two modes:

- **Pilot Mode** — fly a ship over enemy territory, destroy ground threats (OrcCannons and OrcSilos) before the mission timer expires
- **Gunner Mode** — control a ground anti-aircraft gun, shoot down incoming enemy planes (not yet implemented; button currently routes to Pilot Mode)

The project uses **no build system, no frameworks, no dependencies beyond Phaser 3.60** — plain HTML, CSS, and JavaScript files served directly. See `GAME_DESIGN.md` for the full lore, world-building, and design philosophy (IPDF vs Orc Collective, Voidheart Ore, ship classes, weapon systems).

---

## Repository Structure

```
My-First-Game/
├── index.html                    ← Entry point; loads all scripts in order
├── .gitignore
├── CLAUDE.md                     ← This file
├── GAME_DESIGN.md                ← Lore, world design, ship/weapon specs
├── README.md
│
├── css/
│   └── style.css                 ← Canvas scaling, mobile-friendly, landscape orientation
│
└── js/
    ├── main.js                   ← Phaser game config + window.game entry point
    │
    ├── systems/
    │   ├── InputSystem.js        ← Phaser-based input: virtual thumbsticks, buttons, keyboard
    │   ├── TerrainSystem.js      ← Procedural terrain: height map, parallax hills, ground features
    │   ├── EnemyManager.js       ← Battlefield generation + enemy lifecycle management
    │   ├── LightingSystem.js     ← Dynamic lighting: dark overlay + additive light sources
    │   └── SoundSystem.js        ← Sound event stubs (all no-ops pending audio assets)
    │
    ├── scenes/                   ← Active Phaser scenes
    │   ├── MainMenuScene.js      ← Title screen; PILOT MODE / GUNNER MODE buttons
    │   ├── PlaneSelectScene.js   ← Card-based plane chooser (3 planes, 4 stat bars each)
    │   ├── PilotGameScene.js     ← Full gameplay scene: ship, enemies, collision, HUD
    │   └── GameOverScene.js      ← Result screen: score counter, PLAY AGAIN / MAIN MENU
    │
    ├── entities/
    │   ├── HealthSystem.js       ← Reusable health/damage system with callbacks
    │   ├── Plane.js              ← Legacy plane data class (used in PlaneSelectScene UI only)
    │   ├── PlayerShip.js         ← Phaser.GameObjects.Graphics player ship (gameplay entity)
    │   ├── OrcCannon.js          ← Ground enemy: pixel-art plasma cannon with state machine
    │   ├── OrcSilo.js            ← Ground enemy: missile silo with homing missiles
    │   └── Projectile.js         ← Pooled bolt/orb/proxy entity for all projectile types
    │
    ├── engine/                   ← Legacy canvas engine (NOT loaded by index.html)
    │   ├── GameLoop.js
    │   └── StateManager.js
    │
    ├── input/                    ← Legacy input (NOT loaded by index.html)
    │   └── InputHandler.js
    │
    └── states/                   ← Legacy canvas states (NOT loaded by index.html)
        ├── MainMenuState.js
        ├── PlaneSelectState.js
        ├── PilotGameState.js
        ├── GunnerGameState.js
        └── GameOverState.js
```

---

## Script Load Order

The order of `<script>` tags in `index.html` is **critical** — there is no module system. Files must be loaded after their dependencies:

```
1. Phaser 3.60 CDN
2. InputSystem.js              ← depends only on Phaser
3. HealthSystem.js             ← depends only on Phaser
4. Projectile.js               ← depends only on Phaser
5. PlayerShip.js               ← depends on HealthSystem
6. OrcCannon.js                ← depends on HealthSystem, Projectile
7. OrcSilo.js                  ← depends on HealthSystem, Projectile
8. TerrainSystem.js            ← depends only on Phaser
9. EnemyManager.js             ← depends on OrcCannon, OrcSilo, Projectile
10. LightingSystem.js          ← depends only on Phaser
11. SoundSystem.js             ← depends only on Phaser
12. GameOverScene.js           ← must load before PilotGameScene (transition target)
13. MainMenuScene.js           ← depends on systems
14. PlaneSelectScene.js        ← depends on systems
15. PilotGameScene.js          ← depends on all systems and entities
16. main.js                    ← creates Phaser.Game, loads last
```

When adding a new script, add its `<script>` tag in the right position — after everything it depends on, and before anything that depends on it.

---

## Phaser Game Config (`main.js`)

```javascript
{
  type: Phaser.CANVAS,          // Canvas renderer — entities use raw Canvas 2D API
  width: 960, height: 540,      // Fixed 16:9 game space
  scene: [MainMenuScene, PlaneSelectScene, PilotGameScene, GameOverScene],
  input: { activePointers: 4 }, // Simultaneous dual-stick + button touch
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { pixelArt: true, antialias: false, antialiasGL: false },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
}
```

`window.game` is exposed globally for browser console debugging.

---

## Game Coordinate System

All game logic uses a **fixed 960 × 540 (16:9) canvas**. Phaser's `Scale.FIT` handles CSS scaling to any screen size.

- x increases left → right
- y increases top → down
- Angles are in **radians** (0 = pointing right, π/2 = pointing down)
- World bounds in Pilot Mode: **4800 × 540 px** (camera follows the player ship)

---

## Scene Flow

```
MainMenuScene
   ├── PILOT MODE  → PilotGameScene → GameOverScene → PLAY AGAIN (PilotGameScene)
   │                                                 → MAIN MENU (MainMenuScene)
   └── GUNNER MODE → PilotGameScene  (stub — routes to pilot mode with mode:'gunner')

PlaneSelectScene exists but is currently bypassed by MainMenuScene.
```

Scene data passed between transitions:

```javascript
// MainMenuScene → PilotGameScene
{ mode: 'pilot', plane: { id, name, color, speed, durability, weaponSize, maneuverability } }

// PilotGameScene → GameOverScene
{ result: 'victory' | 'defeated', score: Number, plane: Object }

// GameOverScene → PilotGameScene (PLAY AGAIN)
{ mode: 'pilot', plane: Object }
```

---

## Visual Style Guide

The game targets a **16-bit SNES-era pixel-art aesthetic**. All rendering code must follow these rules:

1. **Hard pixel edges everywhere** — no anti-aliasing, no smooth gradients on solid objects. Use flat `fillRect` colour bands instead of `createLinearGradient` for backgrounds.
2. **`pixelArt: true`** is set in the Phaser config, so `imageSmoothingEnabled` is disabled globally. For any raw canvas context access, set `ctx.imageSmoothingEnabled = false` explicitly.
3. **Limited, intentional colour palette**:
   - *Ground*: earthy muted tones — `#2a2010`, `#3c2e16`, `#4a3820`, `#5e4a28`
   - *Sky*: deep blues and purples — `#07101f`, `#0d1e38`, `#122848`, `#1e3a52`
   - *Warm accents*: amber/orange for horizon glow and fires — `#3a2010`, `#96461e`
   - *UI / explosions*: warm highlights — reds, oranges, whites
   - *Voidheart*: purplish-red with gold veins
   - *Orc plasma*: magenta/purple energy (`0xff40ff`)
4. **Pixel-grid shapes only** — favour `fillRect` and clear outlines over `arc`, `ellipse`, and curves. Sprites and ground features should feel drawn on a grid, with flat shading and no soft edges. (Exception: `LightingSystem` uses `fillEllipse` for additive light blooms at depth 31, which is acceptable for atmospheric effects.)
5. **16×16 and 32×32 unit tile grid** — the game's pixel grid is based on these tile sizes. The 960×540 canvas fits exactly 60×33.75 sixteen-pixel tiles.
6. **OrcCannon is the detail standard** — all future ground entities must match `OrcCannon.js` in visual density: panel seams, rivet highlights, shadow pixels, multi-layer colour, progressive damage states, and a multi-frame explosion sequence.

---

## Core Systems

### InputSystem (`js/systems/InputSystem.js`)

Phaser-based input system. Instantiate inside a Phaser scene's `create()`, then call `update()` at the top and `clearTaps()` at the bottom of each `update()` tick.

```javascript
create() {
  this._input = new InputSystem(this);
}
update(time, delta) {
  this._input.update();           // keyboard synthesis + redraw sticks
  // ... read input ...
  this._input.clearTaps();        // reset one-frame flags
}
```

**Stick properties** (x/y range −1 to +1):
- `input.leftStick`  — `{ active, x, y, baseX, baseY }`
- `input.rightStick` — same shape

**One-shot button flags** (true for one frame, reset by `clearTaps()`):
- `input.weaponSelectPressed`
- `input.evadePressed`
- `input.firePressed`

**Tap API**:
- `input.tapsThisFrame` — `[{ x, y }]` in game coordinates
- `input.wasTappedInRegion(x, y, w, h)` — rectangle hit test
- `input.clearTaps()` — **call at the end of every scene `update()`**

**Touch/pointer:** left half of screen (x < 480) drives the left stick; right half drives the right stick. A quick release (< 15 px travel) registers as a tap.

**Keyboard (desktop testing):**
- WASD / Arrow keys → left stick (continuous while held)
- IJKL → right stick (continuous while held)
- Space → `firePressed`, Shift → `evadePressed`, Q or E → `weaponSelectPressed`

**On-screen buttons** (Phaser Containers, depth 95):
- `input.weaponSelectBtn` — bottom centre (480, 495), 200 × 48 px
- `input.evadeBtn` — bottom right (868, 495), 140 × 48 px
- `input.fireBtn` — above EVADE (868, 435), 140 × 48 px

Hide irrelevant buttons with `.setVisible(false)` in `create()`. PilotGameScene hides weaponSelect and evade, shows fire.

Internal constants: `INPUT_STICK_RADIUS = 65`, `INPUT_TAP_MAX_DIST = 15`.

---

### TerrainSystem (`js/systems/TerrainSystem.js`)

Procedural terrain generation and rendering for Pilot Mode.

```javascript
// In PilotGameScene.create():
this._terrain = new TerrainSystem(this, battlefieldW);

// Flatten terrain under enemy structures before building features
this._terrain.flattenZone(centerX, halfFlatW, blendW);

// Build ground features (Voidheart veins, acid pools, rubble, etc.)
this._terrain.buildFeatures();

// Create all Phaser display objects (must call last)
this._terrain.build();

// Every frame:
this._terrain.update(time, delta);

// On enemy bolt ground impact:
this._terrain.spawnImpact(worldX, worldY);

// Get positions for lighting system:
const { veins, pools } = this._terrain.getFeaturePositions();
```

**Internal layer order (Phaser depth):**
- `0.5` — far parallax hills (TileSprite, scrollFactor 0.25)
- `0.7` — near parallax hills (TileSprite, scrollFactor 0.55)
- `1.0` — static ground (Image from offscreen canvas, scrollFactor 1)
- `1.5` — animated overlay (Graphics, redrawn each frame, scrollFactor 1)

Terrain is sampled every 32 world-px (`TERRAIN_STEP`). Uses a seeded sine-hash PRNG for deterministic generation: `(Math.sin(seed + n) * 9301 + 49297) % 233280`.

---

### EnemyManager (`js/systems/EnemyManager.js`)

Procedural battlefield generation and enemy lifecycle.

```javascript
// In PilotGameScene.create():
this._enemyManager = new EnemyManager(this, groundY, enemyBolts, missiles);

// Every frame:
this._enemyManager.update(time, delta, playerWorldX, playerY, cameraScrollX);

// For manual overlap checks:
const cannons = this._enemyManager.getCannons(); // OrcCannon[]
const silos   = this._enemyManager.getSilos();   // OrcSilo[]
```

Generates a mix of OrcCannons and OrcSilos across the 4800px battlefield using cursor-based placement with seeded RNG. Guaranteed sequence: 3 silos + 2 cannons shuffled, then additional cannons fill remaining space. Minimum 100px gap between structures.

---

### LightingSystem (`js/systems/LightingSystem.js`)

Dynamic lighting with ambient darkness overlay and additive light sources.

```javascript
this._lighting = new LightingSystem(this);
this._lighting.setVoidheartPositions(positions);  // [{ x, y }] world-space
this._lighting.setPoolPositions(positions);        // [{ x, y }] world-space

// Every frame:
this._lighting.update(time, delta);

// On game events:
this._lighting.addExplosionLight(worldX, worldY);  // 0.5s warm orange burst
this._lighting.addMuzzleFlash(worldX, worldY);     // 0.08s white pop
this._lighting.addMissileExhaust(worldX, worldY);  // per-frame orange dot

this._lighting.destroy();  // cleanup on scene shutdown
```

**Layer stack** (screen-space, setScrollFactor(0)):
- Depth 30: ambient darkness overlay (0.18 alpha black rect)
- Depth 31: dynamic light layer (ADD blend mode)

---

### SoundSystem (`js/systems/SoundSystem.js`)

Stub system — all methods are no-ops pending audio assets.

```javascript
this._sound = new SoundSystem(this);
this._sound.fireWeapon();            // player fires PX-9 plasma
this._sound.enemyHit(worldX, worldY); // bolt hits enemy structure
this._sound.playerHit();             // player takes damage
this._sound.explosion(worldX, worldY); // large explosion
this._sound.missileAlert();          // missile launched at player
```

When audio assets are available, replace each method body with `this._scene.sound.play('key', config)`.

---

## Entities

### PlayerShip (`js/entities/PlayerShip.js`)

The gameplay player entity. Extends `Phaser.GameObjects.Graphics` with arcade physics.

```javascript
this._ship = new PlayerShip(this, x, y, planeConfig);
this._ship.setDepth(10);

// Every frame:
this._ship.update(inputSys, dt);

// Damage:
this._ship.takeDamage(amount);   // no-ops during 2s spawn invincibility
this._ship.isAlive();
this._ship.health;               // HealthSystem instance

// Events:
this._ship.on('destroyed', () => { ... });

// Cleanup:
this._ship.destroy();            // also destroys engine glow, shield, trail
```

**Stats from planeConfig** (all 0–100):
| Stat | Effect |
|---|---|
| `speed` | Max move speed: `(speed / 100) * 220` px/s |
| `durability` | Max health points |
| `weaponSize` | Weapon power (not yet wired) |
| `maneuverability` | Future: turn responsiveness |

**Visual features:**
- Arrowhead ship drawn with `fillTriangle` (two halves) + cockpit `fillRect`
- Engine glow: pulsing ellipse at exhaust port (tween: scale 0.8–1.3×, alpha 0.15–0.40)
- Shield shimmer: cyan `strokeRect` during 2s spawn invincibility (pulsing alpha 0.25–0.9)
- Particle trail: 2×2px pixels emitted from exhaust, ADD blend
- Hit flash: body turns red for 150ms on damage
- Fire feedback: white `strokeRect` for one frame after firing

**Movement:** Lerps velocity toward left stick target using `ACCEL_FACTOR = 12.0`. Nose rotates to face travel direction when speed > 20 px/s.

---

### Plane (`js/entities/Plane.js`) — UI ONLY

Legacy data class. Still used by PlaneSelectScene for rendering plane cards. **Not used during gameplay** — PlayerShip is the gameplay entity.

---

### OrcCannon (`js/entities/OrcCannon.js`)

Ground enemy: anti-aircraft plasma cannon. Extends `Phaser.GameObjects.Graphics`.

- **Health:** 6 HP with progressive damage visuals (cracks at hit 2, platform tilt at hit 4, explosion at hit 6)
- **State machine:** `idle` → `windup` (0.75s) → `firing` (1.5s interval) → `dead`
- **Active range:** 400px horizontal distance to player
- **Fires:** Orc plasma orbs into a shared `enemyBolts` projectile pool
- **Death:** 4-frame pixel-art explosion sequence

---

### OrcSilo (`js/entities/OrcSilo.js`)

Ground enemy: Voidheart missile silo. Extends `Phaser.GameObjects.Graphics`.

- **Health:** 10 HP with progressive damage (cracks, scorch marks, sparking conduits, explosion)
- **State machine:** `idle` → `windup` (2.5s hatch opening) → `firing` (2.5s interval) → `dead`
- **Active range:** 500px horizontal distance to player
- **Fires:** Homing missiles using invisible Projectile proxies (`activateProxy()` / `syncProxy()`)
- **Missiles:** Track player for 4s, deal 25 damage on impact
- **Missile interception:** `hitMissileProxy(proxy)` applies damage; `detonateMissileProxy(proxy)` triggers explosion
- **Visual:** Wide 120×28px above-ground structure with 280px perimeter fence, hatch animation, warning beacons

---

### Projectile (`js/entities/Projectile.js`)

Pooled projectile entity. Extends `Phaser.GameObjects.Graphics` with arcade physics.

Three types:
| Type | Visual | Size | Usage |
|---|---|---|---|
| `bolt` | 10×4px elongated plasma bolt | Rotated to travel direction | Player ship fire |
| `orb` | 6×6px square plasma orb | No rotation | OrcCannon fire |
| `proxy` | Invisible | Variable hitbox | OrcSilo homing missile physics body |

```javascript
// Player bolts:
bolt.fire(x, y, vx, vy, damage, color, angle);

// Enemy orbs:
orb.fireOrb(x, y, vx, vy, damage, color);

// Missile proxies:
proxy.activateProxy(x, y, w, h);
proxy.syncProxy(x, y);       // called by OrcSilo each frame

// Deactivation:
projectile.kill();            // returns to pool
```

Auto-kills after 700px travel distance (`PROJECTILE_RANGE`). Pool sizes: playerBolts=30, enemyBolts=50, missiles=8.

---

### HealthSystem (`js/entities/HealthSystem.js`)

```javascript
const hp = new HealthSystem(maxHealth);
hp.takeDamage(amount);
hp.heal(amount);
hp.getPercent();    // 0.0–1.0
hp.isAlive();
hp.reset();
hp.onDamage((amount, remaining) => { ... });  // chainable
hp.onDeath(() => { ... });                     // chainable
hp.renderBar(ctx, x, y, width, height);        // legacy canvas render
```

---

## Plane Definitions (PlaneSelectScene)

Three aircraft defined in `PlaneSelectScene.js`:

| Name | Color | Speed | Durability | Weapon | Maneuver | Profile |
|---|---|---|---|---|---|---|
| **Fighter** | Blue `0x42a5f5` | 82 | 55 | 65 | 90 | Fast & agile, fragile |
| **Bomber** | Gray `0x78909c` | 42 | 95 | 95 | 35 | Slow, tough, powerful |
| **Scout** | Green `0x66bb6a` | 95 | 38 | 42 | 96 | Fastest/most agile, weakest |

**Note:** MainMenuScene currently bypasses PlaneSelectScene and sends a hardcoded Strikewing config directly to PilotGameScene.

---

## PilotGameScene — Key Details

### World Layout
- **Battlefield:** 4800 × 540 px (`BATTLEFIELD_W = 4800`)
- **Camera:** follows PlayerShip with 0.1 lerp lag, bounds clamped to world
- **Horizon:** at `Math.floor(540 * 0.72)` = 388px
- **Ground impact threshold:** ~410px (horizonY + terrain max dip)

### Player Controls
- Left stick: moves the ship (lerp-based acceleration)
- Right stick: sets aim direction (red dashed aim line from nose)
- FIRE button / right stick deflection > 0.1: fires player bolt (0.15s cooldown)

### Collision System (5 pairs)

| # | Source | Target | Method | Effect |
|---|---|---|---|---|
| 1 | playerBolts | OrcCannons | Manual AABB | 1 HP damage, impact sparks, camera shake |
| 2 | playerBolts | OrcSilos | Manual AABB | 1 HP damage, impact sparks, camera shake |
| 3 | enemyBolts | PlayerShip | `physics.add.overlap` | 1 HP damage, red flash, camera shake |
| 4 | missiles | PlayerShip | `physics.add.overlap` | 25 HP damage, explosion, heavy shake |
| 5 | playerBolts | missiles | `physics.add.overlap` | Intercept burst, missile damage |

Pairs 1 & 2 use manual AABB checks (plain arrays) because Phaser static groups crash on Graphics objects due to missing `getTopLeft()`. Pairs 3–5 use Phaser arcade physics overlaps.

### Camera Effects
- **Trauma system:** `_addTrauma(0–1)` → shake intensity = trauma² × 18px, decays at 2.0/s
- **Explosion zoom:** brief 1.1× zoom on enemy destruction (120ms in, 500ms out)
- **Death sequence:** slow zoom to 1.3× + fade to black over 900ms

### Particle Emitters
- `_muzzleEmitter` — burst at ship nose on fire (6 particles, ADD blend)
- `_impactEmitter` — sparks on structure hit (8 particles)
- `_explosionEmitter` — large burst on enemy death (30–40 particles, gravity 80)
- `_interceptEmitter` — burst when missile is shot down (12 particles)

### Game-Over Triggers
- Ship health → 0: 900ms cinematic death → GameOverScene (`'defeated'`)
- 30-second timer: 400ms delay → GameOverScene (`'victory'`) — placeholder mission length

### HUD Elements (viewport-fixed, depth 50+)
- Health bar: top-left, 200×14px, green→yellow→red gradient
- Mission timer: top-right, countdown from 0:30
- ← MENU button: top-left below health bar

---

## GameOverScene — Key Details

- Full-screen dark backdrop (72% alpha) over sky background
- Result banner slides down from off-screen (Back.easeOut tween, 550ms)
- Score counter animates from 0 → final value (Power2 ease, 1200ms, 600ms delay)
- Two buttons appear after 800ms: PLAY AGAIN → PilotGameScene, MAIN MENU → MainMenuScene
- Victory: green border/text; Defeat: red border/text

---

## CSS & HTML Notes

### style.css
- Global reset: margin/padding/box-sizing on all elements
- `html, body`: 100% size, black background, flexbox centering, `overflow: hidden`, zoom disabled
- Canvas: `image-rendering: crisp-edges` (Firefox) + `image-rendering: pixelated` (Chrome/Safari)
- **Portrait orientation overlay**: `@media (orientation: portrait)` shows "Please rotate your device to landscape"

### index.html Meta Tags (iOS critical)
- `viewport`: `user-scalable=no` — prevents pinch-zoom breaking input
- `apple-mobile-web-app-capable`: enables full-screen when added to iOS home screen
- `apple-mobile-web-app-status-bar-style: black-fullscreen` — immersive status bar
- `format-detection: telephone=no` — prevents phone-number link detection

---

## Git Workflow

- **Default branch**: `master`
- **Feature branches**: `claude/<task-slug>`
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
- Private/internal members prefixed with `_` (e.g. `this._scene`, `this._enemies`)
- Comments explain *why*, not *what* — the code should be readable on its own
- Section separators: `// ================================================================`

### Adding a New Phaser Scene
1. Create `js/scenes/YourScene.js` extending `Phaser.Scene`
2. Add `constructor()` with `super({ key: 'YourScene' })`
3. Implement `init(data)`, `create()`, `update(time, delta)` as needed
4. Add a `<script>` tag in `index.html` — before any scene that transitions to it, and before `main.js`
5. Register the scene in the `config.scene` array in `main.js`
6. Navigate with `this.scene.start('YourScene', { data })` from another scene

### Adding a New Entity
1. Create `js/entities/YourEntity.js` extending `Phaser.GameObjects.Graphics`
2. Load it in `index.html` after `HealthSystem.js` and before any system/scene that uses it
3. Register with scene: `scene.add.existing(this)` and optionally `scene.physics.add.existing(this)`
4. Implement a `_draw()` method using `fillRect` / `fillTriangle` (no arcs)
5. Attach a `HealthSystem` instance if it can take damage
6. For enemies: implement state machine (`idle` → `windup` → `firing` → `dead`)

### Adding a New System
1. Create `js/systems/YourSystem.js`
2. Constructor takes `(scene, ...config)`
3. Provide `update(time, delta)` for per-frame logic
4. Provide `destroy()` for cleanup on scene shutdown
5. Load in `index.html` after entities it depends on, before scenes that use it

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

## Key Patterns in the Codebase

### Seeded PRNG
Both `TerrainSystem` and `EnemyManager` use the same deterministic sine-hash:
```javascript
(Math.sin(seed + n) * 9301 + 49297) % 233280) / 233280
```
Same seed → same terrain/enemy layout within a session.

### Enemy State Machines
Both OrcCannon and OrcSilo follow the same pattern:
- `idle` → player enters range → `windup` (with visual tells)
- `windup` → timer expires → fire first shot → `firing`
- `firing` → fire at interval → player leaves range → `idle`
- Any state → health reaches 0 → `dead` (multi-frame explosion)

### Missile Proxy Pattern
OrcSilo uses invisible `Projectile` instances as physics bodies for homing missiles. The silo computes missile positions with its own math (homing, gravity) and calls `syncProxy(x, y)` each frame to keep the arcade body aligned. This lets Phaser collision callbacks work without migrating the silo's complex rendering pipeline.

### Projectile Pooling
Three Phaser.GameObjects.Groups with `classType: Projectile` and `runChildUpdate: true`:
- `playerBolts` (maxSize 30) — IPDF plasma bolts
- `enemyBolts` (maxSize 50) — Orc plasma orbs
- `missiles` (maxSize 8) — Invisible missile proxy bodies

### Manual AABB vs Phaser Overlap
Player bolts vs enemies use manual AABB checks (plain arrays) because `Phaser.Physics.Arcade.StaticGroup` crashes on `Phaser.GameObjects.Graphics` objects (missing `getTopLeft()`). Enemy fire vs player uses standard `physics.add.overlap()`.

---

## Logical Next Steps

Recommended priorities for continued development:

1. ~~**Scrolling ground background**~~ ✅ — TerrainSystem with procedural generation and parallax
2. ~~**Bullets / projectiles**~~ ✅ — Projectile class with pooling (bolt, orb, proxy types)
3. ~~**Ground enemies**~~ ✅ — OrcCannon (6 HP, plasma bolts) and OrcSilo (10 HP, homing missiles)
4. ~~**Collision detection**~~ ✅ — 5 collision pairs (manual AABB + arcade overlaps)
5. **Real mission objectives** — replace the 30-second placeholder timer with mission goals (destroy all emplacements, reach extraction point, etc.)
6. **Gunner Mode** — implement `GunnerGameScene` with ground-based AA gun, enemy planes flying overhead
7. **PlaneSelectScene integration** — re-enable the plane selection flow from MainMenuScene
8. **Ship class differentiation** — wire up `weaponSize` stat; implement Strikewing/Tempest/Hammerfall per GAME_DESIGN.md
9. **Weapon systems** — implement CM-3 Scatter Lance (cluster missiles), NF-1 Nightfall bomb
10. **Defensive systems** — implement FLR-2 Flair, OD-1 Overdrive, PS-5 Pulse Shield per GAME_DESIGN.md
11. **Sound** — add audio assets and replace SoundSystem stubs with actual playback
12. **Plane sprites** — replace triangle placeholders with pixel-art `drawImage()` sprites
13. **iOS native wrapper** — integrate with WKWebView using `window.webkit.messageHandlers`

---

## What AI Assistants Should Know

- **No build step** — edit files, refresh browser, that's it
- **Phaser 3.60** is loaded via CDN in `index.html`; all scenes extend `Phaser.Scene`
- **No external libraries beyond Phaser** — keep it dependency-free unless there's a compelling reason
- **Script load order matters** — see the detailed order above; add new scripts in the right position
- **All coordinates are in game space (960×540)** — never use `window.innerWidth/Height` in game logic; world bounds are 4800×540 in Pilot Mode
- **InputSystem usage:** call `inputSys.update()` at the top of every scene `update()` and `inputSys.clearTaps()` at the bottom — failing to call `clearTaps()` causes button flags and taps to persist across frames
- **InputSystem buttons are always in the scene display list** — hide irrelevant buttons with `.setVisible(false)` in `create()`; do not destroy and recreate them
- **InputSystem must be destroyed on scene transitions** — call `this._input.destroy()` in a `_cleanup()` method before `scene.start()`
- **Keyboard-driven sticks have no visual** — `_drawSticks()` only renders sticks driven by touch/pointer; keyboard input is silent
- **PlayerShip vs Plane** — `PlayerShip.js` is the gameplay entity (Phaser.GameObjects.Graphics with physics); `Plane.js` is a legacy data class used only in PlaneSelectScene for card UI
- **OrcCannon and OrcSilo extend Phaser.GameObjects.Graphics** — they cannot be in StaticGroups; use plain arrays and manual AABB for collision
- **`window.game`** is exposed in `main.js` for console debugging
- **Legacy files** (`js/engine/`, `js/input/`, `js/states/`) are NOT loaded by `index.html`; they remain as reference only
- **GAME_DESIGN.md** contains the full lore and design spec — reference it for naming conventions (IPDF fleet registry, ship classes, weapon designations)
- **PilotGameScene wraps every system init in try/catch** and displays errors on-screen if any system fails to initialize
- Avoid adding unrequested scaffolding, dependencies, or "improvements" beyond the task at hand
- Update this `CLAUDE.md` whenever the folder structure, conventions, or systems change significantly
