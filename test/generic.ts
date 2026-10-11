import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
import { resolve } from "node:path";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
const url = (h: string) => "data:text/html," + encodeURIComponent(h);
const page = url("<title>Multi</title><button class='b'>one</button><button class='b'>two</button><input id='cb' type='checkbox' style='display:none'><label for='cb'>Agree</label><input name='q1' placeholder='First'><input name='q2'><input type='file' id='f'>");
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 160) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
try {
  await call("browser_open", { url: page });
  const amb = await expectErr(() => call("browser_click", { selector: ".b" }));
  check("multiple matches refused with count", amb.includes("2 elements match .b"), amb);
  const nth = await call("browser_click", { selector: ".b", nth: 1 });
  check("nth picks the element", nth.startsWith("clicked .b"), nth.split("\n")[0]);
  const find = await call("browser_find", {});
  check("browser_find lists controls", find.includes("controls") && find.includes("(hidden)") && find.includes("name=\"q1\""), find.split("\n")[0]);
  const ok = await call("browser_type", { selector: "input[name=\"q2\"]", value: "found-by-find" });
  check("find selector works", ok.startsWith("typed into"), ok.split("\n")[0]);
  const cb = await call("browser_check", { selector: "#cb", checked: true });
  const cbState = await call("browser_eval", { script: "return document.querySelector('#cb').checked;" });
  check("custom checkbox via label", cb.includes("checked=true") && cbState === "true", cb.split("\n")[0]);
  const cb2 = await call("browser_check", { selector: "#cb", checked: false });
  check("custom checkbox unchecks", cb2.includes("checked=false"), cb2.split("\n")[0]);
  const idErr = await expectErr(() => call("browser_click", { selector: "#no-such-id" }));
  check("missing id hints browser_find", idErr.includes("browser_find"), idErr);
  const up1 = await call("browser_upload", { selector: "#f", files: [resolve("test/fixtures/upload-test.txt")] });
  check("upload inside cwd allowed by default", up1.startsWith("uploaded"), up1.split("\n")[0]);
  process.env.PI_UPLOAD_DIR = resolve("test/fixtures");
  const up2 = await expectErr(() => call("browser_upload", { selector: "#f", files: [resolve("package.json")] }));
  check("PI_UPLOAD_DIR restricts uploads", up2.includes("file not allowed"), up2);
  delete process.env.PI_UPLOAD_DIR;
  results.push("ALL GENERIC CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
