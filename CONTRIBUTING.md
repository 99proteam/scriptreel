# Contributing to scriptreel

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Setup

```bash
git clone https://github.com/99proteam/scriptreel.git
cd scriptreel
npm install
npx playwright install chromium
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run build` | Build `dist/` with tsup |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit and end-to-end tests (Vitest) |
| `npm run test:unit` | Only the fast unit tests |
| `npm run site` | Serve the test site on http://127.0.0.1:4173 |
| `npm run examples` | Record every script in `examples/` to `examples/output/` |
| `node dist/cli.js record examples/login-flow.yml --headed` | Watch a demo run (with `npm run site` running) |

## Project layout

```
src/
  cli.ts              command-line interface
  record.ts           record(): run → composite → encode
  script/             script types, YAML/TS loading, validation, ${ENV} placeholders
  runner/             Playwright recorder (virtual clock), cursor paths, typing rhythm
  render/             camera track, captions/SRT, layout, compositor, ffmpeg encoding
tests/
  unit/               fast tests for the parser, cursor, camera, captions and layout
  e2e/                renders real videos against tests/site and checks them with ffprobe
  site/               the small demo web app used by tests and examples
examples/             example scripts
```

## How a recording works

The recorder never records the screen in real time. It keeps a virtual clock in milliseconds and takes a
screenshot whenever the page can change. Each screenshot gets a timestamp on that clock. Cursor moves, clicks,
camera focus areas and captions are recorded as data on the same clock. The compositor then draws every frame
from that data. This is what makes videos smooth and identical on fast and slow machines, so keep it that way:
never let real elapsed time leak into the timeline.

## Pull requests

- Add or update tests for behavior changes. Pure logic (cursor, camera, captions, parsing) belongs in `tests/unit`.
- Run `npm run lint && npm run typecheck && npm test` before pushing.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).
- Keep the README tables in sync when you add a step or an option.

## Releasing (maintainers)

1. Update the version in `package.json` and move the changelog entries under the new version.
2. Commit, then tag and push: `git tag v0.2.0 && git push --follow-tags`.
3. The release workflow runs the checks and publishes to npm (it needs the `NPM_TOKEN` repository secret).
