import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
const url = (h: string) => "data:text/html," + encodeURIComponent(h);
const late = url('<title>Late</title><button id="go" onclick="setTimeout(()=>{const d=document.createElement(\'div\');d.id=\'late\';d.textContent=\'LATE CONTENT\';document.body.appendChild(d)},800)">go</button><select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>');
const pop = url('<title>Start</title><button id="pop" onclick="const w=window.open(\'about:blank\');w.document.write(\'<title>Popup Tab</title><h1>popped</h1>\')">open</button>');
try {
  await call("browser_open", { url: late });
  const t0 = Date.now();
  const bad = await expectErr(() => call("browser_select", { selector: "#s", value: "zzz" }));
  const dt = Date.now() - t0;
  console.log((bad.includes("no option matches") && dt < 3000 ? "PASS" : "FAIL") + " bad select value fast (" + dt + "ms) :: " + bad);
  await call("browser_click", { selector: "#go" });
  const w = await call("browser_wait", { selector: "#late", state: "visible", ms: 5000 });
  console.log((w.startsWith("visible: #late") ? "PASS" : "FAIL") + " wait for late element");
  const pause = await call("browser_wait", { ms: 200 });
  console.log((pause.includes("url:") ? "PASS" : "FAIL") + " plain pause");
  const timeoutMsg = await expectErr(() => call("browser_wait", { selector: "#never", ms: 800 }));
  console.log((timeoutMsg.startsWith("browser_wait failed:") ? "PASS" : "FAIL") + " wait timeout is one-line error");
  await call("browser_goto", { url: pop });
  await call("browser_click", { selector: "#pop" });
  await call("browser_wait", { ms: 800 });
  const title = await call("browser_eval", { script: "return document.title;" });
  console.log((title === "\"Popup Tab\"" ? "PASS" : "FAIL") + " tools follow new tab :: " + title);
} finally { await closeBrowser(); }
