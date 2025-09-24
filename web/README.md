# Monaco Actor Web Player

React + Vite + TypeScript app that plays AI-directed coding timelines in lockstep with narration. The app
now ships with an audio-driven scheduler, Monaco virtual file system, and Xterm terminal plumbing so we can drop
in real assets and iterate on playback quality.

## Prerequisites
- Node.js 20.19+ is recommended (tooling currently works on 20.14, but Vite prints a warning at build time).
- npm 10+

## Setup
```bash
npm install
```

## Adding Demo Assets
- Place narration audio in `public/` (e.g. `public/demo.mp3`).
- Place the matching timeline JSON in `public/` (e.g. `public/demo-timeline.json`). The loader expects a shape of:
  ```json
  {
    "actions": [
      { "kind": "create_file", "path": "src/main.tsx", "timeMs": 0 },
      { "kind": "type", "path": "src/main.tsx", "text": "console.log('Hello');\n", "timeMs": 500 }
    ]
  }
  ```
- Update the filenames in `src/App.tsx` if you change the defaults.

## Available Timeline Actions
The runtime currently supports: `create_file`, `open_file`, `type`, `move_cursor`, `highlight_range`,
`terminal_run`, `terminal_output`, and `clear_terminal` (see `src/timeline/types.ts`).

## Development
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Roadmap
- Expand the scheduler to rehydrate editor/terminal state instantly when seeking mid-track.
- Add granular typing simulations (chunked inserts, simulated latency) for more cinematic playback.
- Surface diagnostics overlays (drift meters, action queue) while iterating on real hackathon assets.
