import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const results: string[] = [];
const check = (label:string, cond:boolean, detail="") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0,220) : ""));
  if (!cond) throw new Error("FAILED: " + label + " " + detail);
};

try {
  const faqUrl = pathToFileURL(resolve("test/fixtures/faq.html")).href;
  await call("browser_open", { url: faqUrl });
  const all = await call("browser_list", { within: "#faq", selector: "[role=button]" });
  check("browser_list container", all.startsWith("3 items") && all.includes("Q one"), all.split("\n")[0]);
  const filt = await call("browser_list", { within: "#faq", selector: "[role=button]", contains: "TWO" });
  check("browser_list contains case-insensitive", filt.startsWith("1 items") && filt.includes("Q two"), filt.split("\n")[0]);
  const m = filt.match(/nth=(\d+)/);
  check("browser_list provides nth", m !== null, filt);
  const nth = Number(m![1]);
  await call("browser_click", { selector: "[role=button]", nth });
  const panel = await call("browser_read", { selector: "[role=button]", nth, panel: true });
  check("browser_read panel reads hidden answer after click", panel === "A two", panel);
  const direct = await call("browser_read", { selector: "[role=button]", nth });
  check("browser_read direct reads button text", direct.includes("Q two"), direct);
  const ext = await call("browser_extract", { selector: "#faq" });
  check("browser_extract visible text after expand", ext.includes("A two"), ext.slice(0,200));
  const ev = await call("browser_eval", { script: "return document.title + '|' + document.querySelectorAll('[role=button]').length" });
  check("browser_eval returns JS result", ev.includes("FAQ") && ev.includes("4"), ev);
  const sc = await call("browser_scroll", { amount: 200 });
  check("browser_scroll human", sc.includes("scrolled") && sc.includes("real-user"), sc.split("\n")[0]);
  const scUp = await call("browser_scroll", { amount: 100, direction: "up" } as any);
  check("browser_scroll up", scUp.length>0, scUp.slice(0,100));
  const shot = await call("browser_screenshot", { name: "inspection-proof" });
  check("browser_screenshot saves", shot.includes("saved") && shot.includes("inspection-proof"), shot.split("\n")[0]);
  results.push("ALL INSPECTION CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
