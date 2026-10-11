import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("real-user", params)).content[0].text as string;

const fixture = "data:text/html," + encodeURIComponent(`
<title>FAQ Fixture</title>
<style>
  [aria-expanded=false] + div { display:none }
  [aria-expanded=true] + div { display:block; padding:8px; border:1px solid #ccc }
  [role=button]{ padding:8px; cursor:pointer; background:#eee; margin:4px }
</style>
<h1>Frequently asked questions</h1>
<div id="faq">
  <div role="button" aria-controls="section-general" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">General</div>
  <div id="section-general">
    <div role="button" aria-controls="item-0" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">What is HP Instant Ink?</div><div id="item-0">Answer 1 - HP Instant Ink is subscription</div>
    <div role="button" aria-controls="item-1" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">How much is HP Instant Ink?</div><div id="item-1">Answer 6th - Plans start at $1.99</div>
  </div>
</div>
`);

try {
  console.log("== open (real-user settle)"); 
  console.log((await call("browser_open", { url: fixture })).split("\n")[0]);
  console.log("== scroll like human");
  console.log((await call("browser_scroll", { amount: 200 })).split("\n")[0]);
  console.log("== find controls");
  const find = await call("browser_find", {});
  console.log(find.split("\n").slice(0,3).join("\n"));
  if (!find.includes("General")) throw new Error("find failed");
  console.log("== click General (scroll+hover+delay)");
  const c1 = await call("browser_click", { selector: 'div[aria-controls="section-general"]' });
  console.log(c1.split("\n")[0]);
  if (!c1.includes("real-user")) throw new Error("click not humanized");
  console.log("== click 6th FAQ (humanized)");
  const c2 = await call("browser_click", { selector: 'div[aria-controls="item-1"]' });
  console.log(c2.split("\n")[0]);
  console.log("== read panel (visible only)");
  const panel = await call("browser_read", { selector: 'div[aria-controls="item-1"]', panel: true } as any);
  console.log("panel:", panel.slice(0,200));
  if (!panel.includes("Plans start at")) throw new Error("panel read failed: "+panel);
  console.log("== extract visible FAQ");
  const ext = await call("browser_extract", { selector: "#faq" });
  console.log("extract:", ext.slice(0,300));
  if (!ext.includes("Plans start")) throw new Error("extract missing visible text");
  console.log("== screenshot proof");
  console.log((await call("browser_screenshot", { name: "real-user-fixture" })).slice(0,200));
  console.log("REAL-USER TEST PASSED");
} finally {
  await closeBrowser();
}
