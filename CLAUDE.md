# CLAUDE.md — AI Assistant Guide for My-First-Game

## Project Overview

**My-First-Game** is an iOS game project owned by ktidmore621. The repository is in its initial stage — no source code, build system, or game assets exist yet. This file establishes conventions and guidelines for AI assistants contributing to this project.

## Current Repository State

```
My-First-Game/
├── CLAUDE.md       ← this file
└── README.md       ← minimal project description
```

- **Language/Platform**: iOS (Swift preferred)
- **Project Type**: Mobile game
- **Stage**: Pre-development (no code exists yet)
- **Git remote**: `origin` → `ktidmore621/My-First-Game`
- **Active development branch**: `claude/claude-md-mm2qx7mdoo3e0x5h-R0AK2`

## Git Workflow

### Branching
- Default long-lived branch: `master`
- Claude Code feature branches follow the pattern: `claude/<task-slug>`
- Always develop on the branch specified in the task; never push to `master` without explicit permission

### Commit Style
- Write concise, imperative commit messages (e.g., `Add player movement controller`)
- Reference the relevant task/issue when applicable
- One logical change per commit; avoid bundling unrelated changes

### Push Protocol
```bash
git push -u origin <branch-name>
```
- Only push to the branch designated in your task
- Retry on network failures: wait 2s, 4s, 8s, 16s between attempts (max 4 retries)

## Development Conventions (to be adopted when code is added)

### Language & Framework
- **Swift** is the preferred language for iOS development
- Use **SpriteKit** or **SceneKit** for 2D/3D game rendering (decide and document when project starts)
- Follow Apple's [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/)

### Code Style
- 4-space indentation
- `camelCase` for variables and functions; `PascalCase` for types and classes
- Prefer `let` over `var` unless mutation is required
- Keep functions short and focused (single responsibility)
- Add comments only for non-obvious logic; self-documenting names are preferred

### Project Structure (expected once Xcode project is created)
```
My-First-Game/
├── My-First-Game.xcodeproj/    ← Xcode project
├── My-First-Game/
│   ├── AppDelegate.swift
│   ├── GameViewController.swift
│   ├── Scenes/                 ← SpriteKit/SceneKit scenes
│   ├── Models/                 ← Game data models
│   ├── Controllers/            ← Game logic controllers
│   ├── Assets.xcassets/        ← Images, sounds, fonts
│   └── Resources/              ← Other game resources
└── My-First-GameTests/         ← Unit tests
```

### Testing
- Write unit tests in the `*Tests` Xcode target using **XCTest**
- Test game logic and model classes; UI/rendering tests are lower priority
- Run tests before pushing: `xcodebuild test -scheme My-First-Game -destination 'platform=iOS Simulator,name=iPhone 15'`

### Build & Run
- Open `My-First-Game.xcodeproj` in Xcode (or use `xed .`)
- Target simulator for local development; real device for performance testing
- Minimum iOS version to be decided when project bootstraps (suggest iOS 16+)

## Key Tasks for Project Bootstrap

When starting development, the first steps should be:

1. Create the Xcode project (SpriteKit or SceneKit game template)
2. Add a `.gitignore` appropriate for Xcode/Swift projects
3. Set up SwiftLint for consistent code style (`.swiftlint.yml`)
4. Create the basic game scene and main menu
5. Update this `CLAUDE.md` with actual build instructions once the project exists

## What AI Assistants Should Know

- **No build system exists yet** — do not attempt to run build or test commands until the Xcode project is created
- **No linting config exists** — follow the Swift conventions described above manually
- **No CI/CD exists** — changes are reviewed manually via pull requests
- When adding the first source files, also add a Swift/Xcode `.gitignore`
- Update this `CLAUDE.md` whenever the project structure, build system, or conventions change significantly
- Keep changes minimal and focused — do not add unrequested scaffolding or dependencies
