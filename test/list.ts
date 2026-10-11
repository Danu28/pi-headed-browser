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
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 200) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
try {
  await call("browser_open", { url: pathToFileURL(resolve("test/fixtures/faq.html")).href });
  const all = await call("browser_list", { within: "#faq", selector: "[role=button]" });
  check("lists only items inside the container, in order", all.startsWith("3 items") && all.includes("1. div \"Q one\"") && all.includes("3. div \"Q three\""), all.split("\n").slice(0, 4).join(" | "));
  const f = await call("browser_list", { within: "#faq", selector: "[role=button]", contains: "TWO" });
  check("contains filter is case-insensitive", f.startsWith("1 items") && f.includes("Q two"), f.split("\n")[0]);
  const m = f.match(/Q two.* -> nth=(\d+)/);
  check("list gives an nth usable by other tools", m !== null, f);
  await call("browser_click", { selector: "[role=button]", nth: Number(m![1]) });
  const ans = await call("browser_read", { selector: "[role=button]", nth: Number(m![1]), panel: true });
  check("nth from list opens the right item", ans === "A two", ans);
  results.push("ALL LIST CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
