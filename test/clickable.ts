import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 160) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
try {
  await call("browser_open", { url: pathToFileURL(resolve("test/fixtures/accordion.html")).href });
  const r1 = await call("browser_click", { selector: "text=What is it?" });
  const hidden = await call("browser_eval", { script: "return document.getElementById('ans').hidden;" });
  check("text on child span clicks the role=button ancestor", hidden === "false" && r1.startsWith("clicked text="), r1.split("\n")[0]);
  const find = await call("browser_find", {});
  check("browser_find returns role selector", find.includes('-> role=button[name="What is it?"]'), find.split("\n")[1] ?? find);
  await call("browser_eval", { script: "document.getElementById('ans').hidden = true; return true;" });
  await call("browser_click", { selector: 'role=button[name="What is it?"]' });
  const toggled = await call("browser_eval", { script: "return document.getElementById('ans').hidden;" });
  check("role selector from find is clickable", toggled === "false", toggled);
  results.push("ALL CLICKABLE CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
