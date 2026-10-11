# Plan: Make pi-headed-browser Public-Ready

## Assumptions
- Project = C:/Users/dhanu/Desktop/Pi-Projects/pi-headed-browser
- User wants public GitHub repo at github.com/Danu28/pi-headed-browser, MIT license
- Keep existing functionality (Playwright headed Chromium, real-user mode, 14 tools) - no breaking API
- TypeScript ESM, Node >=18, Playwright ^1.64

## Audit Summary
- ✅ Functionality: real-user scroll+hover+delay, frame/shadow piercing, dialogs, upload guard, 10 test files all passing logic-wise
- ❌ Public-repo gaps:
  1. No git repo initialized (fatal: not a git repository)
  2. package.json: wrong main (index.js), empty keywords/author, ISC without LICENSE file, no repository/homepage/bugs, no exports/files/engines, scripts only "test" error, no build/typecheck, no devDeps (typescript, tsx)
  3. No tsconfig.json → no build (npm publish would ship TS)
  4. No LICENSE, CONTRIBUTING, SECURITY, CHANGELOG
  5. README has hardcoded C:/Users/dhanu/... path, incomplete tools table (missing find/read/list/scroll/upload/dialog), no install instructions, no badges
  6. .gitignore missing dist/, coverage, logs
  7. Bug: browser_click duplicates scrollIntoViewIfNeeded+hoverWithDelay twice (copy-paste)
  8. No CI workflow, no .github
  9. screenshots/.profile folders present on disk but should be gitignored; no .npmignore/files field so npm pack would include them

## Plan Steps
1. Fix .gitignore → add dist/, coverage/, *.log, .env
2. Create tsconfig.json (ESNext, module NodeNext, declaration, outDir dist, strict)
3. Fix package.json → license MIT, repository github.com/Danu28/pi-headed-browser, keywords, engines node>=18, exports/main/types/files, scripts: build/typecheck/test/test:all/dev, devDeps typescript/tsx
4. Create LICENSE (MIT 2026 Danu), CONTRIBUTING.md, SECURITY.md, CHANGELOG.md
5. Fix src/index.ts → remove duplicate scroll/hover in browser_click (keep one set), verify imports
6. Rewrite README.md → badges, install (npm i + npx playwright install chromium), usage (pi --extension, npm import), full 14-tool table, env vars table, human-mode docs, codemode examples, development & test instructions, license
7. Add .github/workflows/ci.yml (node 20, npm ci, build, smoke with PI_BROWSER_PROFILE tmp)
8. Ensure src/session.ts PROFILE_DIR default uses join(here, "..", ".profile") still works after build (use import.meta.dirname fallback)
9. Init git repo (if needed), git add, verify: npm run build (tsc --noEmit + tsc), npm test runs smoke via tsx, git status clean except ignored folders

## Verification
- npx tsc --noEmit passes
- npm run build creates dist/index.js + dist/session.js + .d.ts
- node --test or npm test (smoke) passes or reports headed browser need
- git log shows initial commit
- npm pack --dry-run lists only dist/README/LICENSE/package.json (not .profile/screenshots)
