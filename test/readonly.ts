import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
try {
  await call("browser_open", { url: "https://selectorshub.com/xpath-practice-page/" });
  const def = await expectErr(() => call("browser_type", { selector: "input[type=email]", value: "qa@example.com" }));
  console.log((def.includes("readonly") ? "PASS" : "FAIL") + " default still refuses readonly :: " + def);
  const out = await call("browser_type", { selector: "input[type=email]", value: "qa@example.com", allowReadonly: true });
  console.log("INFO allowReadonly reply :: " + out.split("\n")[0]);
  const v = await call("browser_eval", { script: "const e = document.querySelector('input[type=email]'); return { value: e.value, readOnly: e.readOnly };" });
  const ok = v.includes("qa@example.com");
  console.log((ok ? "PASS" : "FAIL") + " value written :: " + v);
  // Verify the page kept the value (page scripts did not reset it).
  await new Promise((r) => setTimeout(r, 1000));
  const v2 = await call("browser_eval", { script: "return document.querySelector('input[type=email]').value;" });
  console.log((v2.includes("qa@example.com") ? "PASS" : "FAIL") + " value persists after 1s :: " + v2);
} finally { await closeBrowser(); }
