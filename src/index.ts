import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Locator, Page } from "playwright";
import { Type } from "typebox";
import { existsSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { getPage, closeBrowser, SHOT_DIR, setDialogAction, drainDialogs, scope, frameFor } from "./session.js";

const MAX_CHARS = 2000;
const TIMEOUT = 10000;

function clip(s: string, n: number = MAX_CHARS): string {
  return s.length > n ? s.slice(0, n) + " ...[+" + (s.length - n) + " chars]" : s;
}

async function state(page: Page): Promise<string> {
  const dialogs = drainDialogs();
  return "url: " + page.url() + "\ntitle: " + (await page.title()) + (dialogs.length ? "\ndialogs: " + dialogs.join(" | ") : "");
}

// ---------- Real-User helpers ----------
function humanDelay(min = 80, max = 180): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

async function scrollIntoViewIfNeeded(loc: Locator): Promise<void> {
  await loc.evaluate((el: any) => {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }).catch(() => {});
  // Let smooth scroll settle like a human
  await new Promise((r) => setTimeout(r, 350));
}

async function hoverWithDelay(loc: Locator): Promise<void> {
  try {
    await loc.hover({ timeout: 2000 }).catch(() => {});
    await humanDelay(200, 400);
  } catch {}
}

// Auto-wait for slow pages: full load, then (best effort, capped) network idle + human dwell.
async function settlePage(page: Page, timeout = 30000) {
  await page.waitForLoadState("load", { timeout }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await humanDelay(400, 700);
  // Small human scroll to trigger lazy loads
  await page.evaluate(() => window.scrollBy(0, 80)).catch(() => {});
  await humanDelay(150, 300);
  await page.evaluate(() => window.scrollBy(0, -80)).catch(() => {});
}

// Short wait lets dialogs/animations arrive before we report state.
const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await humanDelay(250, 450);
};

const FRAME = Type.Optional(Type.String({ description: "iframe selector; nested frames joined with \" >> \". Default: top page" }));
const NTH = Type.Optional(Type.Number({ description: "0-based index. Needed when the selector matches several elements (browser_find shows it)" }));

// Uploads are limited to PI_UPLOAD_DIR, or the folder pi was started in.
function uploadRoot(): string {
  return resolve(process.env.PI_UPLOAD_DIR || process.cwd());
}

function inUploadRoot(file: string): boolean {
  const rel = relative(uploadRoot(), resolve(file));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

// Resolve a selector to exactly one element. Several matches are an error unless nth picks one,
// so a tool never acts on the wrong element silently.
async function locate(page: Page, selector: string, frame?: string, nth?: number): Promise<Locator> {
  const base = scope(page, frame).locator(selector);
  if (nth !== undefined) return base.nth(nth);
  const n = await base.count();
  if (n > 1) throw new Error(n + " elements match " + selector + "; pass nth (0-" + (n - 1) + ") or run browser_find");
  return base.first();
}

const idHint = (selector: string) =>
  selector.startsWith("role=") ? " (role selectors skip hidden elements; expand the section first, or run browser_find)" :
  /#[\w-]/.test(selector) ? " (ids can change between page loads; run browser_find for stable selectors. Elements inside closed shadow roots cannot be reached)" : "";

// Fail fast with a clear message instead of a 10s Playwright timeout.
async function assertUsable(loc: Locator, selector: string, editing: boolean, clickable = false) {
  await loc.waitFor({ state: "attached", timeout: TIMEOUT }).catch(() => {
    throw new Error("no element matches " + selector + idHint(selector));
  });
  // Hidden elements cannot be filled or selected. Clicks keep their JavaScript fallback.
  if (!clickable && !(await loc.isVisible())) throw new Error("element is hidden: " + selector);
  const st = await loc.evaluate((el: any) => ({ disabled: !!el.disabled, readOnly: !!el.readOnly })).catch(() => null);
  if (st?.disabled) throw new Error("element is disabled: " + selector);
  if (editing && st?.readOnly) throw new Error("element is readonly: " + selector);
}

// Custom-styled checkboxes hide the real input and use its <label>. Click the label instead.
async function clickLabelOf(loc: Locator, page: Page, frame?: string): Promise<boolean> {
  const tagged = await loc.evaluate((el: any) => {
    const label = el.labels && el.labels[0];
    if (!label) return false;
    label.setAttribute("data-pi-label", "1");
    return true;
  }).catch(() => false);
  if (!tagged) return false;
  const label = scope(page, frame).locator("[data-pi-label]").first();
  try {
    await label.click({ timeout: TIMEOUT });
  } finally {
    await label.evaluate((el: any) => el.removeAttribute("data-pi-label")).catch(() => {});
  }
  return true;
}

// Click what a user would click: the matched element, or its nearest clickable ancestor
// (e.g. a span inside a role=button accordion). Visually hidden targets (e.g. skip links)
// are refused by Playwright, so fall back to a DOM click for those.
async function clickInteractive(loc: Locator, page: Page, frame?: string): Promise<"mouse" | "js"> {
  await loc.evaluate((el: any) => {
    const t = el.closest("button,a[href],input,select,textarea,label,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[aria-expanded],[onclick]") || el;
    t.setAttribute("data-pi-click", "1");
  });
  const target = scope(page, frame).locator("[data-pi-click]").first();
  try {
    try {
      await target.click({ timeout: 5000 });
      return "mouse";
    } catch (e: any) {
      if (!/Timeout/.test(e.message)) throw e;
      await target.evaluate((el: any) => el.click());
      return "js";
    }
  } finally {
    await target.evaluate((el: any) => el.removeAttribute("data-pi-click")).catch(() => {});
  }
}

interface BrowserToolDef {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: any;
  run: (params: any) => Promise<string>;
}

// Wraps a tool so every failure is a one-line, actionable message (keeps model context small).
function registerBrowserTool(pi: ExtensionAPI, def: BrowserToolDef) {
  pi.registerTool({
    name: def.name,
    label: def.label,
    description: def.description,
    promptSnippet: def.promptSnippet,
    parameters: def.parameters,
    async execute(_id: string, params: any) {
      try {
        const out = await def.run(params);
        return { content: [{ type: "text" as const, text: out }], details: {} };
      } catch (e) {
        const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
        throw new Error(def.name + " failed: " + clip(msg, 300));
      }
    },
  });
}

export default function browserExtension(pi: ExtensionAPI) {
  registerBrowserTool(pi, {
    name: "browser_open", label: "Browser Open",
    description: "Open the headed browser (or reuse it). Optionally navigate to url. Returns url, title and any dialogs.",
    promptSnippet: "Open the headed browser, optionally at a URL",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "URL to open" })),
      timeout: Type.Optional(Type.Number({ description: "Navigation timeout in ms (default 30000)" })),
    }),
    run: async (p) => {
      const page = await getPage();
      if (p.url) {
        await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: p.timeout ?? 30000 });
        await settlePage(page, p.timeout ?? 30000);
      }
      return await state(page);
    },
  });

  registerBrowserTool(pi, {
    name: "browser_goto", label: "Browser Goto",
    description: "Navigate the browser page to url. Returns url and title.",
    promptSnippet: "Navigate the browser to a URL",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute URL" }),
      timeout: Type.Optional(Type.Number({ description: "Navigation timeout in ms (default 30000)" })),
    }),
    run: async (p) => {
      const page = await getPage();
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: p.timeout ?? 30000 });
      await settlePage(page, p.timeout ?? 30000);
      return await state(page);
    },
  });

  registerBrowserTool(pi, {
    name: "browser_find", label: "Browser Find",
    description: "List controls on the page, inside frames and inside open shadow roots, with their label and a selector that matches exactly one element (or selector plus nth). Use it instead of guessing ids, which can change between page loads. Elements inside closed shadow roots cannot be listed or reached.",
    promptSnippet: "List page controls with stable selectors",
    parameters: Type.Object({
      kind: Type.Optional(Type.String({ description: "Filter by tag, type or label text, e.g. checkbox, email, Country" })),
      limit: Type.Optional(Type.Number({ description: "Max controls to list (default 40)" })),
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const target = p.frame ? await frameFor(page, p.frame) : page.mainFrame();
      const scoped = scope(page, p.frame);
      await page.waitForLoadState("domcontentloaded", { timeout: TIMEOUT }).catch(() => {});
      const max = p.limit || 40;
      let found: any;
      try {
        // Pass 1 (in the page): collect controls, walking open shadow roots, and tag each listed one with its index.
        found = await target.evaluate((opts: any) => {
          const want = String(opts.kind || "").toLowerCase();
          const q = (v: string) => JSON.stringify(v);
          const labelOf = (el: any): string => {
            if (el.labels && el.labels.length) return el.labels[0].innerText || "";
            if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
            if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role")) return (el.textContent || "").trim() || el.value || "";
            return el.placeholder || el.getAttribute("name") || "";
          };
          const candidates = (el: any): string[] => {
            const tag = el.tagName.toLowerCase();
            const out: string[] = [];
            // Role selectors match the real control, even when the text sits in a child element.
          const roleOf = el.getAttribute("role") || (el.tagName === "BUTTON" ? "button" : el.tagName === "A" && el.hasAttribute("href") ? "link" : el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "");
          const roleName = (el.getAttribute("aria-label") || el.textContent || el.value || "").trim().split("\n")[0].slice(0, 80);
          if (roleOf && roleName) out.push("role=" + roleOf + "[name=" + q(roleName) + "]");
          if (el.id) out.push("#" + CSS.escape(el.id));
            if (el.getAttribute("name")) out.push(tag + "[name=" + q(el.getAttribute("name")) + "]");
            if (el.getAttribute("placeholder")) out.push(tag + "[placeholder=" + q(el.getAttribute("placeholder")) + "]");
            if (el.getAttribute("aria-label")) out.push(tag + "[aria-label=" + q(el.getAttribute("aria-label")) + "]");
            if (tag === "input" && el.type) out.push(tag + "[type=" + q(el.type) + "]");
            out.push(tag);
            return out;
          };
          const all: any[] = [];
          const walk = (root: any) => {
            for (const el of Array.from(root.querySelectorAll("*")) as any[]) {
              all.push(el);
              if (el.shadowRoot) walk(el.shadowRoot);
            }
          };
          walk(document);
          const rows: any[] = [];
          let total = 0;
          for (const el of all) {
            if (!el.matches("input,select,textarea,button,a[href],[role=button],[role=checkbox],[role=radio],[role=tab]")) continue;
            const tag = el.tagName.toLowerCase();
            const type = tag === "input" ? el.type : "";
            const label = labelOf(el).replace(/\s+/g, " ").trim().slice(0, 40);
            if (want && !(tag + " " + type + " " + label).toLowerCase().includes(want)) continue;
            total++;
            if (rows.length >= (opts.limit || 40)) continue;
            const index = rows.length;
            el.setAttribute("data-pi-find", String(index));
            const r = el.getBoundingClientRect();
            rows.push({ index, tag, type, label, hidden: r.width === 0 || r.height === 0, shadow: el.getRootNode() instanceof ShadowRoot, candidates: candidates(el) });
          }
          return { total, rows };
        }, { kind: p.kind || "", limit: max });

        // Pass 2 (Playwright): keep a selector only if it resolves to exactly this element, using the same matching the other tools use.
        const lines: string[] = [];
        for (const r of found.rows) {
          let pick = "";
          let fallback = "";
          for (const c of r.candidates) {
            // [how many elements this selector matches, index of this control among them (-1 if not a match)]
            const [n, idx] = await scoped.locator(c).evaluateAll((els: any[], i: string) => [els.length, els.findIndex((e) => e.getAttribute("data-pi-find") === i)], String(r.index));
            if (idx < 0) continue;
            if (n === 1) { pick = c; break; }
            if (!fallback) fallback = c + " (nth=" + idx + ")";
          }
          pick = pick || fallback;
          lines.push((r.index + 1) + ". " + r.tag + (r.type ? "[" + r.type + "]" : "") + " \"" + r.label + "\"" + (r.shadow ? " (shadow)" : "") + (r.hidden ? " (hidden)" : "") + " -> " + (pick || "no unique selector"));
        }
        const header = found.total + " controls" + (p.kind ? " matching \"" + p.kind + "\"" : "") + ", showing " + lines.length;
        return header + (lines.length ? "\n" + lines.join("\n") : "");
      } finally {
        // Remove the temporary index attributes, including inside shadow roots.
        await target.evaluate(() => {
          const clean = (root: any) => {
            for (const el of Array.from(root.querySelectorAll("[data-pi-find]")) as any[]) el.removeAttribute("data-pi-find");
            for (const el of Array.from(root.querySelectorAll("*")) as any[]) if (el.shadowRoot) clean(el.shadowRoot);
          };
          clean(document);
        }).catch(() => {});
      }
    },
  });

  registerBrowserTool(pi, {
    name: "browser_click", label: "Browser Click",
    description: "Click the element matching selector (CSS, shadow DOM is pierced, or Playwright text=/role= selectors). If the match sits inside a clickable element (a span in a button, a role=button accordion), its clickable ancestor is clicked. Fails if several match unless nth is given. Use frame for iframe content.",
    promptSnippet: "Click an element in the browser by selector",
    parameters: Type.Object({ selector: Type.String({ description: "CSS or text=/role= selector" }), nth: NTH, frame: FRAME }),
    run: async (p) => {
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await assertUsable(loc, p.selector, false, true);
      await scrollIntoViewIfNeeded(loc);
      await hoverWithDelay(loc);
      await humanDelay(80, 180);
      const how = await clickInteractive(loc, page, p.frame);
      await settle(page);
      await humanDelay(300, 600);
      return "clicked" + (how === "js" ? " (JS fallback)" : "") + " " + p.selector + " [real-user: scroll+hover+delay]\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_type", label: "Browser Type",
    description: "Fill the input matching selector with value. Set submit to press Enter afterwards. Fails fast on hidden, readonly or disabled fields and on ambiguous selectors.",
    promptSnippet: "Type text into a browser input by selector",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS or text=/role= selector" }),
      value: Type.String({ description: "Text to enter" }),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
      allowReadonly: Type.Optional(Type.Boolean({ description: "Write to a readonly field by setting its value via DOM events. Bypasses the page readonly lock; default false" })),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await assertUsable(loc, p.selector, !p.allowReadonly);
      await scrollIntoViewIfNeeded(loc);
      await hoverWithDelay(loc);
      await loc.click({ timeout: 3000 }).catch(() => {});
      await humanDelay(100, 250);
      if (p.allowReadonly) {
        await loc.evaluate((el: any, v: string) => {
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, p.value);
      } else {
        // Human-like typing: small delay between keys when value is short
        if (p.value.length < 60) {
          await loc.pressSequentially(p.value, { delay: 35 });
        } else {
          await loc.fill(p.value, { timeout: TIMEOUT });
        }
      }
      await humanDelay(150, 350);
      if (p.submit) {
        await page.keyboard.press("Enter");
        await settle(page);
      }
      return "typed into " + p.selector + " [real-user: scroll+focus+typing-delay]\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_press", label: "Browser Press",
    description: "Press a keyboard key in the page (e.g. Enter, Tab, Escape, ArrowDown).",
    promptSnippet: "Press a key in the browser",
    parameters: Type.Object({ key: Type.String({ description: "Playwright key name" }) }),
    run: async (p) => {
      const page = await getPage();
      await page.keyboard.press(p.key);
      await settle(page);
      return "pressed " + p.key + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_extract", label: "Browser Extract",
    description: "Return visible text of selector (real-user: only visible text, auto-scrolls into view; use browser_read panel for accordion answers) (default: whole body), truncated to maxChars. Use frame for iframe content.",
    promptSnippet: "Extract visible text from the browser page",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS or text=/role= selector; default body" })),
      maxChars: Type.Optional(Type.Number({ description: "Max characters, default 2000, max 20000" })),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const loc = p.selector ? await locate(page, p.selector, p.frame, p.nth) : scope(page, p.frame).locator("body").first();
      const body = await loc.innerText({ timeout: TIMEOUT });
      const limit = Math.min(p.maxChars ?? MAX_CHARS, 20000);
      return (await state(page)) + "\n---\n" + clip(body, limit);
    },
  });

  registerBrowserTool(pi, {
    name: "browser_read", label: "Browser Read",
    description: "Read the text of an element with textContent, so collapsed or hidden content is included. Set panel to read the element right after the match instead (e.g. the answer below an accordion question).",
    promptSnippet: "Read text of an element, including collapsed content",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS or text=/role= selector" }),
      panel: Type.Optional(Type.Boolean({ description: "Read the element right after the match instead, e.g. the answer below a question" })),
      nth: NTH,
      maxChars: Type.Optional(Type.Number({ description: "Max characters, default 2000, max 20000" })),
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await loc.waitFor({ state: "attached", timeout: TIMEOUT }).catch(() => {
        throw new Error("no element matches " + p.selector + idHint(p.selector));
      });
      const text = await loc.evaluate((el: any, panel: boolean) => {
        const t = panel ? el.nextElementSibling : el;
        return t ? (t.textContent || "").replace(/\s+/g, " ").trim() : "";
      }, !!p.panel);
      return clip(text, Math.min(p.maxChars ?? MAX_CHARS, 20000)) || "(empty)";
    },
  });

  registerBrowserTool(pi, {
    name: "browser_list", label: "Browser List",
    description: "List items in page order inside a container (e.g. an FAQ section): 1-based index, text, visible/hidden, aria-expanded, and an nth value. Act on an item with browser_click/browser_read using selector + nth. Use this to answer 'the Nth item' questions.",
    promptSnippet: "List items in page order with indexes and nth values",
    parameters: Type.Object({
      within: Type.Optional(Type.String({ description: "CSS selector of the container; default whole page" })),
      selector: Type.Optional(Type.String({ description: "CSS selector of the items; default '[role=button], button, a[href]'" })),
      contains: Type.Optional(Type.String({ description: "Only items whose text contains this (case-insensitive)" })),
      visibleOnly: Type.Optional(Type.Boolean({ description: "Only items with a visible box" })),
      limit: Type.Optional(Type.Number({ description: "Max items to list (default 60)" })),
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const target = p.frame ? await frameFor(page, p.frame) : page.mainFrame();
      const selector = p.selector || "[role=button], button, a[href]";
      const res = await target.evaluate((o: any) => {
        const container = o.within ? document.querySelector(o.within) : document.body;
        if (!container) return { error: "container not found: " + o.within };
        const want = String(o.contains || "").toLowerCase();
        const all = Array.from(document.querySelectorAll(o.selector)) as any[];
        const rows: any[] = [];
        let total = 0;
        all.forEach((el, pageNth) => {
          if (!container.contains(el)) return;
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) return;
          if (want && !text.toLowerCase().includes(want)) return;
          const r = el.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0;
          if (o.visibleOnly && !visible) return;
          total++;
          if (rows.length < o.limit) rows.push({ n: total, pageNth, tag: el.tagName.toLowerCase(), text: text.slice(0, 90), visible, expanded: el.getAttribute("aria-expanded") });
        });
        return { total, rows };
      }, { within: p.within || "", selector, contains: p.contains || "", visibleOnly: !!p.visibleOnly, limit: p.limit || 60 });
      if ((res as any).error) throw new Error((res as any).error);
      const lines = (res as any).rows.map((r: any) => r.n + ". " + r.tag + " \"" + r.text + "\" " + (r.visible ? "visible" : "hidden") + (r.expanded !== null ? " expanded=" + r.expanded : "") + " -> nth=" + r.pageNth);
      return res.total + " items" + (p.within ? " in " + p.within : "") + " (selector " + selector + "), showing " + lines.length + "\n" + lines.join("\n");
    },
  });

  registerBrowserTool(pi, {
    name: "browser_select", label: "Browser Select",
    description: "Choose an option in a <select> by value or visible label.",
    promptSnippet: "Choose a dropdown option by value or label",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the select element" }),
      value: Type.Optional(Type.String({ description: "Option value attribute" })),
      label: Type.Optional(Type.String({ description: "Option visible text" })),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      if (!p.value && !p.label) throw new Error("give value or label");
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await assertUsable(loc, p.selector, false);
      await scrollIntoViewIfNeeded(loc);
      await hoverWithDelay(loc);
      // Check options first so a bad value fails immediately instead of waiting for the timeout.
      const options: string[] = await loc.evaluate((el: any) => Array.from(el.options).map((o: any) => o.value + "|" + o.text.trim()));
      const hasOption = p.value ? options.some((o) => o.startsWith(p.value + "|")) : options.some((o) => o.endsWith("|" + p.label));
      if (!hasOption) throw new Error("no option matches " + (p.value ? "value=" + p.value : "label=" + p.label) + " (options: " + options.map((o) => o.split("|")[0]).join(", ") + ")");
      const chosen = await loc.selectOption(p.value ? { value: p.value } : { label: p.label }, { timeout: TIMEOUT });
      return "selected " + chosen.join(",") + " in " + p.selector + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_check", label: "Browser Check",
    description: "Set a checkbox or radio to checked/unchecked and report its resulting state. Works with custom checkboxes whose input is hidden behind a label.",
    promptSnippet: "Check or uncheck a checkbox by selector",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the checkbox" }),
      checked: Type.Boolean({ description: "true to check, false to uncheck" }),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await loc.waitFor({ state: "attached", timeout: 5000 }).catch(() => {
        throw new Error("no element matches " + p.selector + idHint(p.selector));
      });
      if (await loc.isVisible()) {
        await assertUsable(loc, p.selector, false);
        await loc.setChecked(p.checked, { timeout: TIMEOUT });
      } else if ((await loc.isChecked()) !== p.checked) {
        await assertUsable(loc, p.selector, false, true);
        if (!(await clickLabelOf(loc, page, p.frame))) throw new Error("element is hidden and has no label: " + p.selector);
      }
      const now = await loc.isChecked();
      if (now !== p.checked) throw new Error("checkbox did not change to checked=" + p.checked + ": " + p.selector);
      return "checkbox " + p.selector + " checked=" + now + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_wait", label: "Browser Wait",
    description: "Wait for selector to reach a state (visible, hidden, attached), or pause for ms when no selector is given. Use after actions that load or reveal content.",
    promptSnippet: "Wait for an element state or a delay",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS or text=/role= selector; omit to just pause" })),
      state: Type.Optional(Type.Union([Type.Literal("visible"), Type.Literal("hidden"), Type.Literal("attached")], { description: "default visible" })),
      ms: Type.Optional(Type.Number({ description: "Pause length without selector (default 1000); wait timeout with selector (default 10000, max 60000)" })),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      const page = await getPage();
      if (!p.selector) {
        await new Promise((r) => setTimeout(r, Math.min(p.ms ?? 1000, 60000)));
        return await state(page);
      }
      const st = p.state ?? "visible";
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await loc.waitFor({ state: st, timeout: Math.min(p.ms ?? TIMEOUT, 60000) });
      return st + ": " + p.selector + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_upload", label: "Browser Upload",
    description: "Set local file(s) on a file input. Paths must be absolute and inside the upload folder (PI_UPLOAD_DIR, default: the folder pi was started in).",
    promptSnippet: "Upload local file(s) to a file input",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the file input" }),
      files: Type.Array(Type.String({ description: "Absolute file path" })),
      nth: NTH,
      frame: FRAME,
    }),
    run: async (p) => {
      if (!p.files.length) throw new Error("give at least one file path");
      for (const f of p.files) {
        if (!isAbsolute(f) || !inUploadRoot(f)) throw new Error("file not allowed (must be inside " + uploadRoot() + "): " + f);
        if (!existsSync(f)) throw new Error("file not found: " + f);
      }
      const page = await getPage();
      const loc = await locate(page, p.selector, p.frame, p.nth);
      await loc.setInputFiles(p.files, { timeout: TIMEOUT });
      return "uploaded " + p.files.map((f: string) => basename(f)).join(", ") + " to " + p.selector + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_dialog", label: "Browser Dialog",
    description: "Set how the next alert/confirm/prompt dialogs are answered: accept (default) or dismiss.",
    promptSnippet: "Set whether browser dialogs are accepted or dismissed",
    parameters: Type.Object({ action: Type.Union([Type.Literal("accept"), Type.Literal("dismiss")]) }),
    run: async (p) => {
      setDialogAction(p.action);
      const page = await getPage();
      return "dialog action: " + p.action + "\n" + (await state(page));
    },
  });

  registerBrowserTool(pi, {
    name: "browser_screenshot", label: "Browser Screenshot",
    description: "Save a PNG screenshot of the page under screenshots/ and return its path.",
    promptSnippet: "Save a screenshot of the browser page and return the file path",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "File name without extension" })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full scrollable page" })),
    }),
    run: async (p) => {
      const page = await getPage();
      mkdirSync(SHOT_DIR, { recursive: true });
      const safe = (p.name ?? "shot-" + Date.now()).replace(/[^\w-]/g, "_");
      const file = join(SHOT_DIR, safe + ".png");
      await page.screenshot({ path: file, fullPage: !!p.fullPage });
      return "saved " + file;
    },
  });

  registerBrowserTool(pi, {
    name: "browser_eval", label: "Browser Eval",
    description: "Run JavaScript in the page (or in an iframe via frame). Script body must return a JSON-serializable value.",
    promptSnippet: "Run JavaScript in the browser page and return the result",
    parameters: Type.Object({ script: Type.String({ description: "JS function body; use return" }), frame: FRAME }),
    run: async (p) => {
      const page = await getPage();
      const body = "(async () => {\n" + p.script + "\n})()";
      const value = p.frame ? await (await frameFor(page, p.frame)).evaluate(body) : await page.evaluate(body);
      return clip(JSON.stringify(value) ?? "undefined");
    },
  });

  registerBrowserTool(pi, {
    name: "browser_scroll", label: "Browser Scroll",
    description: "Scroll the page like a human (smooth, center). Use direction: up/down, amount in pixels. Mimics real-user scroll with dwell.",
    promptSnippet: "Scroll the page like a real user",
    parameters: Type.Object({
      direction: Type.Optional(Type.String({ description: 'up or down (default down)' })),
      amount: Type.Optional(Type.Number({ description: "pixels to scroll (default 400)" })),
      selector: Type.Optional(Type.String({ description: "CSS selector to scroll into view instead of amount" })),
      frame: FRAME,
      nth: NTH,
    }),
    run: async (p) => {
      const page = await getPage();
      if (p.selector) {
        const loc = await locate(page, p.selector, p.frame, p.nth);
        await scrollIntoViewIfNeeded(loc);
        return "scrolled into view " + p.selector + " [real-user]\n" + (await state(page));
      }
      const dir = p.direction === "up" ? -1 : 1;
      const amt = p.amount ?? 400;
      await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dir * amt);
      await humanDelay(400, 700);
      return "scrolled " + (dir === -1 ? "up" : "down") + " " + amt + "px [real-user]\n" + (await state(page));
    },
  });

  pi.on("session_shutdown", async () => {
    await closeBrowser();
  });
}
