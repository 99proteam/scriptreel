# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-27

### Added

- Background music: `--music <file>` / `music:` loops the track to the video length, fades it in and out, and mixes it in
  without re-encoding the video. `--music-volume` / `musicVolume` sets the level (default 0.3).
- Chapters from captions: embedded in MP4/WebM output and written to `<video>.chapters.txt` in YouTube's format
  (first chapter at 0:00, chapters under 10 seconds merged). `--no-chapters` turns this off.
- GitHub Sponsors is now the main way to support the project (goal: $5,000/month).

## [0.1.0] - 2026-10-05

### Added

- `scriptreel record`: runs a YAML, JSON, TypeScript or JavaScript demo script in Chromium and renders a video.
- Steps: `caption`, `click`, `type`, `hover`, `select`, `press`, `wait`, `zoom`, `scroll`, `pause`, `goto`.
- Smooth animated cursor along eased curves, with click ripples.
- Natural typing rhythm with seeded random variation; `hidden: true` masks typed values.
- Deterministic capture on a virtual clock: the output does not depend on machine speed.
- Automatic camera that zooms toward the active element (`--zoom off|subtle|strong`), plus explicit `zoom` steps.
- Browser window frame (light and dark), rounded corners, shadow, color or gradient backgrounds, caption overlays.
- MP4 (H.264), WebM (VP9) and GIF output; size presets `youtube`, `reel`, `square`, `720p`, `4k`.
- `--blur` to hide private data, and `${ENV_VAR}` placeholders with log redaction.
- Voice-over text per step written to an `.srt` file.
- `scriptreel init` and `scriptreel validate`.
- Library API: `record()`, `parseScript()`, `loadScript()`, `defineDemo()` and lower-level building blocks.

[Unreleased]: https://github.com/99proteam/scriptreel/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/99proteam/scriptreel/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/99proteam/scriptreel/releases/tag/v0.1.0
