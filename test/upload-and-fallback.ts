import { resolve } from "node:path";
import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const expectErr = async (fn: () => Promise<string>) => { try { await fn(); return ""; } catch (e: any) { return e.message as string; } };
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 140) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
const FILE = resolve("test/fixtures/upload-test.txt");

try {
  await call("browser_open", { url: "https://selectorshub.com/xpath-practice-page/" });
  const up = await call("browser_upload", { selector: "#myFile", files: [FILE] });
  check("upload file", up.startsWith("uploaded upload-test.txt to #myFile"), up.split("\n")[0]);
  const name = await call("browser_eval", { script: "return document.querySelector('#myFile').files[0] ? document.querySelector('#myFile').files[0].name : null;" });
  check("file set on input", name === "\"upload-test.txt\"", name);
  const bad = await expectErr(() => call("browser_upload", { selector: "#myFile", files: ["C:/Windows/win.ini"] }));
  check("upload outside root refused", bad.includes("file not allowed"), bad);
  const skip = await call("browser_click", { selector: "text=Skip to content" });
  check("hidden skip link via JS fallback", skip.startsWith("clicked (JS fallback)"), skip.split("\n")[0]);
  const hash = await call("browser_eval", { script: "return location.hash;" });
  check("skip link moved to #content", hash === "\"#content\"", hash);
  const normal = await call("browser_click", { selector: "#myBtn" });
  check("normal click unaffected", normal.startsWith("clicked #myBtn"), normal.split("\n")[0]);
  results.push("ALL UPLOAD/FALLBACK CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  await closeBrowser();
}
