import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";

const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);

const call = async (name: string, params: any) => {
  const r = await tools.get(name).execute("smoke", params);
  return r.content[0].text as string;
};

const fixture = "data:text/html," + encodeURIComponent(
  '<title>Fixture</title><h1>Hello pi</h1><input id="q"><button onclick="document.title=\'clicked\'">Go</button>'
);

try {
  console.log("== open\n" + await call("browser_open", { url: fixture }));
  console.log("== type\n" + await call("browser_type", { selector: "#q", value: "hello" }));
  console.log("== click\n" + await call("browser_click", { selector: "text=Go" }));
  console.log("== extract\n" + await call("browser_extract", { selector: "h1" }));
  const ev = await call("browser_eval", { script: "return document.querySelector('#q').value + '|' + document.title" });
  console.log("== eval\n" + ev);
  if (!ev.includes("hello|clicked")) throw new Error("ASSERT FAILED: " + ev);
  console.log("== screenshot\n" + await call("browser_screenshot", { name: "smoke" }));
  try {
    await call("browser_click", { selector: "#nope" });
    console.log("UNEXPECTED: click on missing element succeeded");
  } catch (e: any) {
    console.log("== expected error\n" + e.message);
  }
  console.log("SMOKE PASSED");
} finally {
  await closeBrowser();
}
