import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);

const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 160) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };

try {
  await call("browser_open", { url: "https://selectorshub.com/xpath-practice-page/" });

  const sel = await call("browser_select", { selector: "#cars", value: "saab" });
  check("browser_select by value", sel.startsWith("selected saab"), sel.split("\n")[0]);
  const sel2 = await call("browser_select", { selector: "#cars", label: "Audi" });
  check("browser_select by label", sel2.startsWith("selected audi"), sel2.split("\n")[0]);

  await call("browser_type", { selector: "#kils", value: "shadow-ok" });
  const sh = await call("browser_eval", { script: "return document.querySelector('#userName').shadowRoot.querySelector('#kils').value;" });
  check("shadow DOM input filled (pierced)", sh === "\"shadow-ok\"", sh);

  const ro = await expectErr(() => call("browser_type", { selector: "input[type=email]", value: "x@y.z" }));
  check("readonly fails fast", ro.includes("element is readonly: input[type=email]"), ro);
  const t0 = Date.now();
  await expectErr(() => call("browser_type", { selector: "input[type=email]", value: "x" }));
  check("readonly error under 3s", Date.now() - t0 < 3000, (Date.now() - t0) + "ms");

  const dis = await expectErr(() => call("browser_type", { selector: "input[disabled]", nth: 0, value: "x" }));
  check("disabled fails fast", dis.includes("element is disabled"), dis);

  const alertMsg = await call("browser_click", { selector: "button[onclick*=windowAlertFunction]" });
  check("alert captured + accepted", alertMsg.includes("dialogs: confirm: Press a button"), alertMsg.split("\n").slice(-1)[0]);
  const promptMsg = await call("browser_click", { selector: "button[onclick*=promptAlertFunction]" });
  check("prompt captured", promptMsg.includes("dialogs: prompt:"), promptMsg.split("\n").slice(-1)[0]);

  await call("browser_dialog", { action: "dismiss" });
  const dismissed = await call("browser_click", { selector: "button[onclick*=promptAlertFunction]" });
  check("dialog dismiss mode", dismissed.includes("dialogs: prompt:"), dismissed.split("\n").slice(-1)[0]);
  await call("browser_dialog", { action: "accept" });

  const cb1 = await call("browser_check", { selector: "#ohrmList_chkSelectRecord_25", checked: true });
  check("checkbox checked", cb1.includes("checked=true"), cb1.split("\n")[0]);
  const cb2 = await call("browser_check", { selector: "#ohrmList_chkSelectRecord_25", checked: false });
  check("checkbox unchecked", cb2.includes("checked=false"), cb2.split("\n")[0]);

  const fr = await call("browser_extract", { selector: "body", frame: "iframe[src*='docs.google.com']", maxChars: 300 });
  check("iframe extract (google form)", fr.includes("---") && fr.split("---")[1].trim().length > 0, fr.slice(0, 120));
  const frTitle = await call("browser_eval", { frame: "iframe[src*='docs.google.com']", script: "return document.title;" });
  check("iframe eval", frTitle.startsWith("\""), frTitle);

  const missing = await expectErr(() => call("browser_select", { selector: "#cars", value: "nope" }));
  check("select bad value errors", missing.startsWith("browser_select failed:"), missing);

  results.push("ALL SELECTORSHUB CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
