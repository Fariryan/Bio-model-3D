# Bio-Model-3D

Bio-Model-3D is a static browser application for exploring stylized 3D biological cell models across human and animal samples. It is designed to run directly from GitHub Pages with no build step.

## Features

- Cinematic `three.js` scene with animated cell components
- Human and animal cell catalog with filtering and search
- Narrative cards, glossary, metrics, and organelle annotations
- GitHub Pages deployment workflow

## Local preview

Run a static server from the repository root:

```bash
python3 -m http.server 4173
```

Then open:

- `http://127.0.0.1:4173`

## GitHub Pages

The repository includes [`.github/workflows/deploy.yml`](/Users/fariryan/Documents/Codex/2026-04-27/connect-to-my-github-repo/.github/workflows/deploy.yml) to publish the repository root to GitHub Pages on every push to `main`.

After the first push:

1. Open repository `Settings`.
2. Go to `Pages`.
3. Set `Source` to `GitHub Actions`.

The site will then deploy automatically.
