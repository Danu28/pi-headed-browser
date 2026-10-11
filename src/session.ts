import { chromium, type BrowserContext, type FrameLocator, type Page, type Frame } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

// --- Extension support ---
let extensionPaths: string[] = [];
let extensionIds: Map<string, string> = new Map();
export function getExtensionPaths(): string[] { return [...extensionPaths]; }
export function getExtensionIds(): Record<string,string> { return Object.fromEntries(extensionIds); }

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
    const extArgs = extensionPaths.length
      ? [`--disable-extensions-except=${extensionPaths.join(",")}`, `--load-extension=${extensionPaths.join(",")}`]
      : [];
    const isHeadedWithExt = extensionPaths.length > 0;
    opening = chromium
      .launchPersistentContext(PROFILE_DIR, {
        headless: isHeadedWithExt ? false : (process.env.HEADLESS === "true" || !!process.env.CI),
        executablePath: EXECUTABLE,
        viewport: { width: 1280, height: 800 },
        args: ["--no-first-run", "--no-default-browser-check", ...extArgs],
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
  activePage = undefined;
  await ctx?.close().catch(() => {});
}
export async function loadExtension(extPath: string): Promise<{ id: string, path: string }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const abs = path.resolve(extPath);
  if(!fs.existsSync(abs)) throw new Error("extension path not found: "+abs+" — tip: use absolute path like C:/Users/.../extension");
  if(!fs.existsSync(path.join(abs, "manifest.json"))) throw new Error("manifest.json not found in "+abs+" — is this an unpacked extension dir?");
  const existing = extensionIds.get(abs);
  if(existing && extensionPaths.includes(abs)){
    return { id: existing, path: abs }; // idempotent - AI can call repeatedly
  }
  if(!extensionPaths.includes(abs)) extensionPaths.push(abs);
  // restart context to load extension (required by Chromium)
  if(context) await closeBrowser();
  await new Promise(r=>setTimeout(r, 800));
  const ctx = await ensureContext();
  // discover extension id via service worker / background page URL
  let id = "";
  for(let i=0;i<15;i++){
    const workers = ctx.serviceWorkers();
    const pages = ctx.backgroundPages();
    const all = [...workers.map(w=>w.url()), ...pages.map(p=>p.url())];
    const hit = all.find(u=>u.startsWith("chrome-extension://"));
    if(hit){ const m=hit.match(/chrome-extension:\/\/([^\/]+)/); if(m) id=m[1]; break; }
    // also try to find via chrome://extensions page (fallback)
    await new Promise(r=>setTimeout(r, 400));
  }
  // fallback: if id still empty, open extensions page to discover
  if(!id){
    try{
      const pg = await getPage();
      await pg.goto("chrome://extensions", { waitUntil: "domcontentloaded", timeout: 8000 }).catch(()=>{});
      await new Promise(r=>setTimeout(r, 1000));
      const workers2 = ctx.serviceWorkers();
      const hit2 = workers2.map(w=>w.url()).find(u=>u.startsWith("chrome-extension://"));
      if(hit2){ const m=hit2.match(/chrome-extension:\/\/([^\/]+)/); if(m) id=m[1]; }
    }catch{}
  }
  if(id) extensionIds.set(abs, id);
  return { id: id || "pending", path: abs };
}
export async function unloadExtension(extPath?: string): Promise<void> {
  if(extPath){ const path = await import("node:path"); const abs=path.resolve(extPath); extensionPaths=extensionPaths.filter(p=>p!==abs); extensionIds.delete(abs); }
  else { extensionPaths=[]; extensionIds.clear(); }
  if(context) await closeBrowser();
}
export function getExtensionIdForPath(p: string): string | undefined {
  try{ return extensionIds.get(resolve(p)); }catch{ return undefined; }
}
