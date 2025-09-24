# Implementation Plan for Monaco_Actor Web Player

## Phase 0 � Alignment & Project Setup
- Confirm project goals with hackathon pitch: AI-directed, perfectly synced playback of coding demos in the browser.
- Inventory existing assets from the pipeline (audio `.mp3`, `timed-actions/*.json`, any code snippets) and document assumptions or gaps.
- Choose tech stack: Vite + React + TypeScript for the UI shell, Tailwind (or CSS Modules) for layout, Monaco Editor + Xterm.js for core surfaces. Record versions to freeze later.
- Set up repo structure: `web/` for front-end, `assets/` for sample runs, `docs/` for notes. Initialize package.json, tsconfig, eslint/prettier to keep velocity high during the hackathon.

## Phase 1 � Timeline Data & Domain Modeling
- Define TypeScript interfaces mirroring the action JSON schema (e.g., `TimelineAction`, `TypeAction`, `CreateFileAction`). Support optional metadata (delay, decorations, terminal text).
- Write a resilient loader that fetches `timed-actions/*.json` and the corresponding audio. Handle corrupt records with validation + dev console warnings.
- Add transformation utilities: convert `time_ms` numbers into seconds, expand `delay_ms` into derived end times, and pre-sort actions so the scheduler can stream them cheaply.
- Build a mocked dataset and unit tests covering parsing edge cases (missing paths, overlapping actions, unknown types) before wiring in real assets.

## Phase 2 � Audio-Driven Scheduler Core
- Implement an `AudioController` wrapper around the `<audio>` element with promises for `load`, `play`, `pause`, and events for buffering or time updates.
- Design an `ActionScheduler` class that keeps a pointer to the next action, compares it against `audio.currentTime` inside a `requestAnimationFrame` loop, and fires handlers when thresholds are met.
- Ensure scheduler is idempotent: actions fire exactly once even if the browser janks or the user seeks. Maintain a processed set and support `seekTo(timestamp)` for scrubbing.
- Expose lifecycle hooks (`onActionStart`, `onActionComplete`, `onTimelineEnd`) for logging, debugging overlays, or future editor recording.
- Add metrics and debug overlay (FPS, drift, queued actions) to validate the �single clock� design early.

## Phase 3 � Monaco Editor & File System Simulation
- Integrate Monaco via `@monaco-editor/react`. Configure worker loading under Vite, preload common languages (ts, js, py, md).
- Craft a lightweight virtual file system: maintain a tree structure `{path, content, isOpen, cursor}` plus helpers to create/update files and apply text edits.
- Implement action handlers:
  - `create_file`: create node in tree, open tab in Monaco, set empty content.
  - `open_file`: switch active model without losing unsaved state.
  - `type`: apply incremental edits respecting `delay_ms`; for long blocks, chunk text to mimic human typing while still honoring schedule.
  - `move_cursor`/`highlight_range`: use Monaco decorations for caret + highlight pulses.
- Add viewport choreography: auto-reveal lines, smooth scroll, optional letterboxing/zoom for cinematic feel.

## Phase 4 � Terminal & Ancillary Surfaces
- Bring in Xterm.js, mount alongside editor, style to match VS Code terminal.
- Define terminal-specific actions (`terminal_run`, `terminal_output`, `clear_terminal`). Ensure they respect timestamps and can overlap with editor actions visually without blocking the scheduler.
- Optional: lightweight file explorer panel that reflects virtual file system changes for additional realism.

## Phase 5 � Playback Controls & UX Polish
- Build transport controls (play/pause, seek bar, playback rate lock). Seek should re-run scheduler from start to the new time deterministically.
- Display upcoming actions timeline (e.g., mini list with T-minus countdown) for debugging and demo commentary overlays.
- Implement �resume from middle� workflow: when user scrubs, reapply all stateful actions up to that time (virtual file system, Monaco content, terminal buffer) before resuming playback.
- Add loading states, error toasts, and fallbacks if assets fail to load.

## Phase 6 � Authoring & Debugging Tooling (Stretch)
- Add a developer console panel showing fired actions, their actual execution timestamp, and drift (`actual - scheduled`).
- Provide manual override shortcuts to trigger actions for live demos.
- Explore in-browser authoring aids (timeline scrubber that lets a human insert adjustments) if time allows.

## Phase 7 � Testing, Packaging, and Demo Prep
- Write unit tests for parser and scheduler logic; add integration test that runs through a short timeline inside Playwright or Cypress to verify deterministic playback.
- Set up `pnpm build` (or npm/yarn) and bundle audio/timeline assets into a `public/` directory. Confirm Monaco/Xterm assets emit correctly.
- Prepare demo scripts: load flagship scenario, confirm zero drift, capture screen recording.
- Document run instructions in `README.md`: install deps, `pnpm dev`, where to drop new audio/json pairs, how to debug.
- Stage deployment (Vercel/Netlify or static hosting) so the hackathon judges can launch the experience from a URL.

## Phase 8 � Risk Tracking & Contingencies
- Identify primary risks: large `type` payloads causing jank, audio loading delays, Monaco worker CSP issues. Capture mitigation steps (chunking, preload audio, host worker files correctly).
- Keep checklists for hackathon day (offline builds, fallback demo video, spare laptop) to guarantee reliable pitch even if live environment fails.
