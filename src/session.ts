import { chromium, type BrowserContext, type FrameLocator, type Page, type Frame } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PROFILE_DIR = process.env.PI_BROWSER_PROFILE ?? join(here, "..", ".profile");
export const SHOT_DIR = join(here, "..", "screenshots");

// Bundled Chromium builds can be blocked by Windows Application Control; fall back to a known-good local build.
const FALLBACK_EXE = join(homedir(), "AppData", "Local", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe");
const EXECUTABLE = process.env.PI_BROWSER_EXECUTABLE || (existsSync(FALLBACK_EXE) ? FALLBACK_EXE : undefined);

let context: BrowserContext | undefined;
// The page tools act on. Follows newly opened tabs (target=_blank, window.open).
let activePage: Page | undefined;
let opening: Promise<BrowserContext> | undefined;

// Dialogs (alert/confirm/prompt) are recorded and answered. Tools report them via drainDialogs().
export type DialogAction = "accept" | "dismiss";
let dialogAction: DialogAction = "accept";
const pendingDialogs: string[] = [];
export function setDialogAction(action: DialogAction): void { dialogAction = action; }
export function drainDialogs(): string[] { return pendingDialogs.splice(0); }

function attachDialogs(page: Page) {
  page.on("dialog", async (d) => {
    pendingDialogs.push(d.type() + ": " + d.message());
    try {
      if (dialogAction === "accept") await d.accept();
      else await d.dismiss();
    } catch {
      // already handled
    }
  });
}

async function ensureContext(): Promise<BrowserContext> {
  if (context) return context;
  if (!opening) {
    opening = chromium
      .launchPersistentContext(PROFILE_DIR, {
        headless: process.env.HEADLESS === "true" || !!process.env.CI,
        executablePath: EXECUTABLE,
        viewport: { width: 1280, height: 800 },
        args: ["--no-first-run", "--no-default-browser-check"],
      })
      .then((ctx) => {
        context = ctx;
        ctx.pages().forEach(attachDialogs);
        ctx.on("page", (p) => {
          attachDialogs(p);
          activePage = p;
        });
        ctx.on("close", () => {
          context = undefined;
          activePage = undefined;
        });
        return ctx;
      })
      .finally(() => { opening = undefined; });
  }
  return opening;
}

export async function getPage(): Promise<Page> {
  const ctx = await ensureContext();
  if (activePage && !activePage.isClosed()) return activePage;
  const existing = ctx.pages().find((p) => !p.isClosed());
  activePage = existing ?? (await ctx.newPage());
  return activePage;
}

// Frame chain: "iframe#a >> iframe#b" -> nested frame locator. Default: top page.
export function scope(page: Page, frame?: string): Page | FrameLocator {
  let s: Page | FrameLocator = page;
  if (frame) for (const sel of frame.split(" >> ")) s = s.frameLocator(sel);
  return s;
}

// Resolve a frame chain to a Frame, for page-context evaluation.
export async function frameFor(page: Page, frame: string): Promise<Frame> {
  const parts = frame.split(" >> ");
  let s: Page | FrameLocator = page;
  for (const sel of parts.slice(0, -1)) s = s.frameLocator(sel);
  const handle = await s.locator(parts[parts.length - 1]).first().elementHandle({ timeout: 10000 });
  const f = handle ? await handle.contentFrame() : null;
  if (!f) throw new Error("frame not found: " + frame);
  return f;
}

export async function closeBrowser(): Promise<void> {
  const ctx = context;
  context = undefined;
  await ctx?.close().catch(() => {});
}
