# Keep demo videos up to date with GitHub Actions

scriptreel runs headless and renders the same video on any machine. That makes it a good fit for CI: re-record
your demos whenever you ship, so the README, docs and landing page never show an outdated UI.

## Re-record on every release and commit the videos

Save this as `.github/workflows/demo-videos.yml` (a copy is in [demo-videos.yml](demo-videos.yml)):

```yaml
name: Update demo videos
on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  record:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.repository.default_branch }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx playwright install --with-deps chromium
      - name: Record demos
        env:
          DEMO_PASSWORD: ${{ secrets.DEMO_PASSWORD }}
        run: |
          npx scriptreel@latest record demos/login.yml -o docs/videos/login.mp4 --format gif
          npx scriptreel@latest record demos/tour.yml -o docs/videos/tour.mp4
      - name: Commit updated videos
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add docs/videos
          git diff --staged --quiet || git commit -m "docs: update demo videos for ${{ github.event.release.tag_name || 'manual run' }}"
          git push
```

Notes:

- Store credentials as repository secrets and reference them with `${DEMO_PASSWORD}` in the script.
- If your default branch is protected, push to a branch and open a pull request instead
  (for example with `peter-evans/create-pull-request`).
- Videos make a repository heavier over time. Consider Git LFS, or upload them as release assets instead:
  `gh release upload ${{ github.event.release.tag_name }} docs/videos/*.mp4 --clobber`.

## Record against a preview deployment

Point the script at an environment variable and pass the preview URL from your deploy step:

```yaml
# demos/login.yml
url: ${APP_URL:-http://localhost:3000}/login
```

```yaml
      - run: npx scriptreel@latest record demos/login.yml -o login.mp4
        env:
          APP_URL: ${{ steps.deploy.outputs.preview_url }}
      - uses: actions/upload-artifact@v4
        with:
          name: demo-video
          path: login.mp4
```

## Record against an app started in the job

```yaml
      - run: npm ci && npm run build
      - run: npm start &
      - run: npx wait-on http://localhost:3000
      - run: npx scriptreel@latest record demos/tour.yml -o tour.mp4
```

## Tips

- Pin a version (`npx scriptreel@0.1.0`) for fully reproducible videos.
- `--seed` controls the small random variations. Keep it fixed and the video only changes when your UI does.
- If a step fails, a screenshot is written next to the output as `<name>.error.png`. Upload it as an artifact
  with `if: failure()` to see what went wrong.
