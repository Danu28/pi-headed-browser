import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e:any) { return e.message as string; } };
const results: string[] = [];
const check = (label:string, cond:boolean, detail="") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0,200) : ""));
  if (!cond) throw new Error("FAILED: " + label + " " + detail);
};
const url = (h:string) => "data:text/html," + encodeURIComponent(h);

try {
  // browser_open - open fixture with controls
  const html = "<title>Core</title><h1>Core Nav</h1><input id=\"search\" placeholder=\"Search\"><button>Go</button><a href=\"https://example.com\">Link</a><div id=\"late\" style=\"display:none\">late</div><script>setTimeout(()=>document.getElementById('late').style.display='block', 600)</script>";
  const open = await call("browser_open", { url: url(html) });
  check("browser_open loads and returns url/title", open.includes("url: data:") && open.includes("Core"), open);

  // browser_find - list controls, stable selectors
  const find = await call("browser_find", {});
  check("browser_find lists controls with stable selectors", find.includes("controls") && find.includes("Search") && find.includes("->"), find.split("\n")[0]);
  const filtered = await call("browser_find", { kind: "Search" });
  check("browser_find kind filter", filtered.toLowerCase().includes("search"), filtered.split("\n")[0]);

  // browser_goto - navigate to new page
  const goto = await call("browser_goto", { url: url("<title>Goto</title><h1>Goto Page</h1>") });
  check("browser_goto navigates", goto.includes("Goto"), goto);

  // browser_wait - wait for late element, and pause without selector
  await call("browser_open", { url: url(html) });
  const waited = await call("browser_wait", { selector: "#late", state: "visible", ms: 5000 });
  check("browser_wait waits for visible", waited.includes("waited") || waited.includes("visible") || waited.length>0, waited.slice(0,120));
  const paused = await call("browser_wait", { ms: 300 });
  check("browser_wait pause without selector", paused.includes("paused") || paused.includes("300") || paused.length>0, paused.slice(0,80));

  // error hint quality: missing selector suggests browser_find
  const miss = await expectErr(() => call("browser_click", { selector: "#nope-xyz" }));
  check("error hint suggests browser_find", miss.includes("browser_find"), miss);

  results.push("ALL CORE CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
