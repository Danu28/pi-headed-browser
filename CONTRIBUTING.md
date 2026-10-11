# Contributing

Thanks for your interest in contributing to pi-headed-browser!

## Development setup

```bash
git clone https://github.com/Danu28/pi-headed-browser.git
cd pi-headed-browser
npm install
npx playwright install chromium
npm run build
npm test
```

Node >=18 is required.

## Project structure

- `src/index.ts` — all tool definitions, real-user helpers, pi ExtensionAPI wiring
- `src/session.ts` — Playwright persistent context, profile, dialog handling, frame helpers
- `test/` — fixture HTML + integration tests (run with `tsx`, needs headed Chromium)

## Running pi with the extension

```bash
pi --extension ./src/index.ts
# or after build
pi --extension ./dist/index.js
```

Use `PI_BROWSER_PROFILE` to isolate test runs:

```bash
PI_BROWSER_PROFILE=.profile-test npm run test:all
```

## Pull requests

1. Fork and create a feature branch
2. Make surgical changes (touch only what you must)
3. Run `npm run typecheck` and `npm run build`
4. Run relevant tests (`npm test` for smoke, `npm run test:all` for full)
5. Update README/CHANGELOG if user-facing behavior changes
6. Open a PR with a clear description and test evidence

## Reporting issues

Please include: Node version, OS, Playwright version, reproduction HTML or URL, selector used, and full error message (one-line tool failures include hints).

## Code style

- Keep tool APIs backwards-compatible (add optional params only)
- Fail fast with one-line actionable messages (never leak stack traces to model context)
- Real-user behavior: scrollIntoView smooth center, hover dwell, random delays
