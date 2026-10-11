# pi-headed-browser

[![CI](https://github.com/Danu28/pi-headed-browser/actions/workflows/ci/badge.svg)](https://github.com/Danu28/pi-headed-browser/actions/workflows/ci)
[![npm version](https://img.shields.io/npm/v/pi-headed-browser)](https://www.npmjs.com/package/pi-headed-browser)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Pi extension that drives a **headed Chromium window (Playwright)** with small, composable tools that work well inside **codemode**. Real-user scrolling, hover dwell, and visible-only reads — designed for AI agents and human-in-the-loop automation.

## Features

- **14 tools** — open/goto, find/list, click/type/press/check/select, extract/read/eval, wait/upload/dialog/screenshot/scroll
- **Real-user mode** — smooth `scrollIntoView`, 200-400ms hover dwell, 80-700ms random delays, `pressSequentially` typing
- **Frames & Shadow DOM** — `frame: "iframe#a >> iframe#b"` and open shadow-root piercing
- **Nth disambiguation** — never acts on the wrong element silently
- **Dialog capture** — alert/confirm/prompt text surfaced and auto-accepted (toggle with `browser_dialog`)
- **Persistent profile** — cookies/logins survive restarts via `.profile/`

## Install

```bash
npm install pi-headed-browser
npx playwright install chromium
```

Requires **Node >=18**.

If Windows Application Control blocks Playwright's bundled Chromium, point at an existing build:

```bash
# Windows PowerShell
$env:PI_BROWSER_EXECUTABLE = "$env:LOCALAPPDATA\ms-playwright\chromium-1243\chrome-win64\chrome.exe"
# bash
export PI_BROWSER_EXECUTABLE="$HOME/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"
```

## Usage with pi

```bash
# dev (TypeScript)
pi --extension ./src/index.ts

# after build / from npm
pi --extension ./dist/index.js
# or if published
pi --extension pi-headed-browser
```

### Quick start (inside pi codemode)

```js
await tools.browser_open({ url: "https://example.com" });
await tools.browser_find({}); // discover stable selectors

await tools.browser_type({ selector: 'input[type="search"]', value: "playwright", submit: true });
text(await tools.browser_extract({ selector: "main", maxChars: 1200 }));
await tools.browser_screenshot({ name: "search-results" });
```

### FAQ / accordion — human flow

```js
await tools.browser_open({ url: "https://example.com/faq" });
await tools.browser_scroll({ amount: 600 }); // human scroll
await tools.browser_find({});               // visible controls

await tools.browser_click({ selector: 'div[aria-controls="section-general"]' }); // expand category
await tools.browser_click({ selector: 'div[aria-controls="item-4"]' });          // expand answer

// collapsed content is hidden on purpose — read the panel next to the trigger
text(await tools.browser_read({ selector: 'div[aria-controls="item-4"]', panel: true }));

await tools.browser_screenshot({ name: "faq-open", fullPage: true });
```

### Iframes & Shadow DOM

```js
// nested frames
text(await tools.browser_extract({ selector: "body", frame: "iframe#docs >> iframe#inner", maxChars: 800 }));
await tools.browser_click({ selector: "#submit", frame: "iframe#docs" });

// open shadow roots are pierced automatically
await tools.browser_type({ selector: "#kils", value: "shadow-ok" });
text(await tools.browser_find({})); // marks shadow controls with (shadow)
```

## Tools

| Tool | Purpose | Key params |
|------|---------|------------|
| `browser_open` | Open/reuse headed browser, optionally navigate | `url?, timeout?` |
| `browser_goto` | Navigate to URL | `url, timeout?` |
| `browser_find` | List controls with unique selectors (pierces frames + open shadow) | `kind?, limit?, frame?` |
| `browser_list` | List items in container order with nth | `within?, selector?, contains?, visibleOnly?, limit?, frame?` |
| `browser_click` | Click (scroll+hover+delay, ancestor fallback, JS fallback for hidden) | `selector, nth?, frame?` |
| `browser_type` | Fill input (human typing, Enter on submit) | `selector, value, submit?, allowReadonly?, nth?, frame?` |
| `browser_press` | Press a key | `key, frame?` |
| `browser_extract` | Visible text of selector (truncated) | `selector, maxChars?, frame?` |
| `browser_read` | Read text including collapsed, or panel next sibling | `selector, panel?, nth?, maxChars?, frame?` |
| `browser_select` | Choose `<select>` option | `selector, value? / label?, nth?, frame?` |
| `browser_check` | Set checkbox/radio (handles label-wrapped hidden inputs) | `selector, checked, nth?, frame?` |
| `browser_wait` | Wait for state or pause | `selector?, state?, ms?, nth?, frame?` |
| `browser_upload` | Set file(s) on input (restricted to `PI_UPLOAD_DIR`) | `selector, files[], nth?, frame?` |
| `browser_dialog` | Set next dialog action | `action: "accept" | "dismiss"` |
| `browser_screenshot` | Save PNG under `screenshots/` | `name?, fullPage?` |
| `browser_eval` | Run JS in page/frame, return JSON | `script, frame?` |
| `browser_scroll` | Human scroll (smooth) or scrollIntoView | `direction?, amount?, selector?, nth?, frame?` |

Selectors: CSS, or Playwright `text=Go`, `role=button[name="Save"]`. If a selector matches multiple elements, the tool errors with the count — pass `nth` (0-based) or use `browser_find`/`browser_list` to get a unique one.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_BROWSER_PROFILE` | `.profile/` | Persistent context dir (cookies, storage). Use `.profile-test` for tests |
| `PI_UPLOAD_DIR` | `process.cwd()` | Allowed root for `browser_upload` paths |
| `PI_BROWSER_EXECUTABLE` | Playwright bundled Chromium | Override Chromium executable path |

## Development

```bash
npm install
npx playwright install chromium
npm run typecheck
npm run build
npm test                 # smoke test (headed)
npm run test:all         # smoke + generic + list + shadow + real-user
```

Isolate test profile so you don't clash with a running `pi` session:

```bash
PI_BROWSER_PROFILE=.profile-test npm run test:all
```

Tests that hit live sites (e.g. `test/selectorshub.ts`) need network.

## How it works

- `src/session.ts` — launches `chromium.launchPersistentContext`, follows new tabs, captures dialogs, resolves `frame >> chain`, manages `.profile`
- `src/index.ts` — registers 14+ tools on pi's `ExtensionAPI`; real-user helpers (`scrollIntoViewIfNeeded`, `hoverWithDelay`, `humanDelay`, `settlePage`); fail-fast `assertUsable` with actionable hints

## License

MIT © 2026 Danu — see [LICENSE](./LICENSE).
