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
  await call("browser_open", { url: pathToFileURL(resolve("test/fixtures/nested.html")).href });
  const hiddenRead = await call("browser_read", { selector: "#qa" });
  check("browser_read reads collapsed text", hiddenRead === "Pick a plan here.", hiddenRead);
  const roleErr = await expectErr(() => call("browser_click", { selector: 'role=button[name="How do I pick?"]' }));
  check("role selector on hidden item explains why", roleErr.includes("role selectors skip hidden"), roleErr.slice(0, 200));
  const find = await call("browser_find", { kind: "pick" });
  check("find labels hidden controls and filters by text", find.includes('"How do I pick?"') && !find.includes("null"), find.split("\n").slice(0, 2).join(" | "));
  await call("browser_click", { selector: "text=Category" });
  await call("browser_click", { selector: "#q" });
  const answer = await call("browser_read", { selector: "#q", panel: true });
  check("panel read returns the answer below the question", answer === "Pick a plan here.", answer);
  results.push("ALL READ/FIND CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
