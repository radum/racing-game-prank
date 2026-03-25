# AGENTS.md — Starter Kit Racing

Port of Kenney's "Starter Kit Racing" from Godot 4.6 to plain JavaScript + three.js + crashcat physics.

## Build / Serve / Test

**There is no build step, no bundler, no package.json, and no test suite.**

This is a zero-build, static-file project. All dependencies load from CDN via import maps in the HTML files.

```
# Serve locally (any static server works)
npx serve .
# or
python3 -m http.server 8000
```

- **Entry points:** `index.html` (game), `editor.html` (track editor)
- **No npm install required** — no `node_modules`, no `package.json`
- **No linter or formatter configured** — style is enforced by convention (see below)
- **No tests** — verify changes by running the game in a browser
- **No CI/CD** — the site is deployed to GitHub Pages from the branch directly
- **Dependencies (CDN):** three.js 0.183.2 (`three`, `three/addons/`), crashcat 0.0.2 (`crashcat`)

## Project Structure

```
index.html          Game entry point
editor.html         Track editor (standalone page, no physics)
js/
  main.js           Composition root: scene, renderer, game loop
  Audio.js          Engine / skid / impact sounds
  Camera.js         PerspectiveCamera that follows the vehicle
  Controls.js       Keyboard, gamepad, and touch input
  Particles.js      Smoke trail particle effects
  Physics.js        crashcat wall colliders and sphere body
  Track.js          GridMap layout, piece placement, track codec
  Vehicle.js        Vehicle physics and steering
models/             GLB models (vehicles, track pieces, decorations)
audio/              OGG sound files
sprites/            Sprite textures (smoke.png)
_godot/             Original Godot project (gitignored, reference only)
```

## Code Style (three.js / mrdoob conventions)

This project follows the **three.js house style** exactly. Every rule below must be respected.

### Formatting

- **Tabs** for indentation (single tab per level, no spaces).
- **Spaces inside parentheses, brackets, and braces:**
  ```js
  renderer.setSize( window.innerWidth, window.innerHeight );
  const arr = [ 1, 2, 3 ];
  new THREE.WebGLRenderer( { antialias: true } );
  if ( child.isMesh ) { ... }
  for ( let i = 0; i < count; i ++ ) { ... }
  ```
- **Space before `++` / `--`:** write `i ++`, not `i++`.
- **Single quotes** for strings. Template literals only when interpolation is needed.
- **Semicolons** on every statement.
- **No trailing commas** in single-line literals. Multi-line object/array literals may have trailing commas.
- **Opening brace on the same line** as `function` / `if` / `for` / `class`.
- **Padded brace bodies** — blank line after opening brace and before closing brace of functions, classes, constructors, and longer blocks:
  ```js
  function foo( x ) {

  	const y = x * 2;
  	return y;

  }
  ```
- **No hard line-length limit.** Keep lines readable; break when extremely long.

### Imports / Exports

- **ES Modules only** (`import` / `export`). No CommonJS.
- **Namespace import** for THREE: `import * as THREE from 'three';`
- **Named imports** for everything else: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';`
- **Relative paths with `.js` extension** for local modules: `import { Vehicle } from './Vehicle.js';`
- **Named exports only** — no default exports:
  ```js
  export class Vehicle { ... }
  export function buildTrack( ... ) { ... }
  export const CELL_RAW = 9.99;
  ```
- `main.js` is the entry point and has **no exports**.

### Naming Conventions

| Kind | Convention | Examples |
|------|-----------|----------|
| Variables, functions, methods, parameters | `camelCase` | `linearSpeed`, `buildTrack`, `controlsInput` |
| Classes | `PascalCase` | `Vehicle`, `SmokeTrails`, `GameAudio` |
| Module-level constants | `UPPER_SNAKE_CASE` | `SPEED_SCALE`, `CELL_RAW`, `GRID_SCALE` |
| Scratch/temp THREE objects (module scope) | `_camelCase` | `_tmpVec`, `_forward`, `_quat`, `_dummy` |
| Internal properties on external objects | `_camelCase` | `world._OL_MOVING` |

### Variable Declarations

- **`const`** by default for all bindings.
- **`let`** only when reassignment is necessary.
- **Never use `var`.**

### Functions

- **`function` declarations** for top-level and exported functions (including `async`).
- **Class methods** as plain method declarations (not arrow functions).
- **Arrow functions** only for callbacks and short closures:
  ```js
  modelNames.map( ( name ) => loadModel( name ) );
  ```

### Classes

- ES6 `class` syntax for stateful entities (`Vehicle`, `Camera`, `Controls`, etc.).
- Plain exported functions for stateless utilities (`buildTrack`, `buildWallColliders`).
- **No inheritance, no static methods, no getters/setters, no private `#` fields.**
- No `this` aliasing (`const self = this`) — use arrow functions to capture `this`.

### Error Handling

- **Minimal and pragmatic.** No `throw` statements in the codebase.
- `try/catch` only where decode/parse can fail; log with `console.warn` and fall back.
- **Nullish coalescing (`??`)** for safe defaults: `ORIENT_DEG[ orient ] ?? 0`.
- **Early-return guard clauses:** `if ( ! this.bodyNode ) return;`
- Optional chaining (`?.`) is not used.

### Comments

- **`//` single-line comments** only. No JSDoc, no block `/* */` comments.
- Reference Godot source when porting: `// Godot: scale_min = 0.25, scale_max = 0.5`
- Section dividers use box-drawing characters:
  ```js
  // --- Track Codec -----------------------------------------------
  ```

### Performance Conventions

- **Reusable scratch objects at module scope** to avoid GC in hot paths:
  ```js
  const _tmpVec = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  ```
  Always prefixed with `_` and mutated in place.
- **Instanced meshes** (`THREE.InstancedMesh`) for repeated geometry (track pieces, decorations).
- **Object pooling** for particles (`POOL_SIZE`).

## Domain-Specific Conventions

- **GridMap cell size:** `CELL_RAW = 9.99`, scale factor `GRID_SCALE = 0.75`. Effective cell = `CELL_RAW * GRID_SCALE`.
- **Track group offset:** `position.y = -0.5`.
- **Godot vehicle scale:** `root_scale = 0.5` applied to imported models.
- **Wall colliders:** friction `0.0`, restitution `0.1`.
- **Corner arcs:** center at `(-CELL_HALF, +CELL_HALF)` in local space, outer radius `2*CELL_HALF - 0.25`.
- **Orientation mapping** from Godot GridMap indices: `{ 0: 0deg, 10: 180deg, 16: 90deg, 22: 270deg }`.
- **Godot collision shapes** (`ConcavePolygonShape3D` in `_godot/models/Library/mesh-library.tscn`) are approximated as crashcat cuboid colliders.
