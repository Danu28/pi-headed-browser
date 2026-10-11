import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 160) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
try {
  await call("browser_open", { url: pathToFileURL(resolve("test/fixtures/shadow.html")).href });
  const find = await call("browser_find", {});
  check("find lists open shadow input", find.includes("-> #open-in") && find.includes("(shadow)"), find.split("\n").slice(0, 3).join(" | "));
  check("find lists nested shadow button", find.includes("\"deep\" (shadow) -> role=button[name=\"deep\"]") || find.includes("-> #deep"));
  check("closed shadow controls not listed", !find.includes("closed-in"));
  const m = find.match(/"two" \(shadow\) -> (role=button\[name="two"\])/);
  check("duplicate shadow buttons get unique selectors", m !== null, find);
  await call("browser_click", { selector: m![1] });
  const t2 = await call("browser_eval", { script: "return document.title;" });
  check("selector from find clicks the right shadow button", t2 === "\"b2\"", t2);
  await call("browser_click", { selector: "#deep" });
  const t3 = await call("browser_eval", { script: "return document.title;" });
  check("nested shadow click via find selector", t3 === "\"deep clicked\"", t3);
  const closed = await expectErr(() => call("browser_type", { selector: "#closed-in", value: "x" }));
  check("closed shadow error is explicit", closed.includes("closed shadow"), closed);
  results.push("ALL SHADOW CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
