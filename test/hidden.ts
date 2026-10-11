import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
try {
  await call("browser_open", { url: "https://selectorshub.com/xpath-practice-page/" });
  const hiddenType = await expectErr(() => call("browser_type", { selector: "input[name=company] >> nth=1", value: "x" }));
  console.log((hiddenType.includes("element is hidden") ? "PASS" : "FAIL") + " hidden input refused fast :: " + hiddenType);
  const visType = await call("browser_type", { selector: "input[name=company] >> nth=0", value: "Visible OK" });
  console.log((visType.startsWith("typed into") ? "PASS" : "FAIL") + " visible input still works");
  const skip = await call("browser_click", { selector: "text=Skip to content" });
  console.log((skip.startsWith("clicked (JS fallback)") ? "PASS" : "FAIL") + " click fallback unchanged :: " + skip.split("\n")[0]);
} finally { await closeBrowser(); }
