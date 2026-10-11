import browserExtension from "../src/index.ts";
import { closeBrowser } from "../src/session.ts";
import http from "node:http";
const tools = new Map<string, any>();
const fakePi: any = { registerTool: (t: any) => tools.set(t.name, t), on: () => {} };
browserExtension(fakePi);
const call = async (name: string, params: any) => (await tools.get(name).execute("t", params)).content[0].text as string;
const results: string[] = [];
const check = (label: string, cond: boolean, detail = "") => {
  results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail.slice(0, 160) : ""));
  if (!cond) throw new Error("FAILED: " + label);
};
// Slow page: the script at /slow.js takes 4s, so the load event is late; a button appears 6s after scripts run.
const server = http.createServer((req, res) => {
  if (req.url === "/slow.js") { setTimeout(() => { res.writeHead(200, { "content-type": "application/javascript" }); res.end("1"); }, 4000); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>Slow</title><div id='root'></div><script src='/slow.js'></script><script>setTimeout(function(){var b=document.createElement('button');b.id='late-btn';b.textContent='Late';b.onclick=function(){document.title='late clicked'};document.getElementById('root').appendChild(b);},6000);</script>");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as any).port;
try {
  const t0 = Date.now();
  const opened = await call("browser_open", { url: "http://127.0.0.1:" + port + "/" });
  const took = Date.now() - t0;
  check("open waits for slow load", took >= 3500 && opened.includes("title: Slow"), took + "ms");
  const t1 = Date.now();
  const clicked = await call("browser_click", { selector: "#late-btn" });
  const clickTook = Date.now() - t1;
  check("click auto-waits for late element", clicked.startsWith("clicked #late-btn") && clicked.includes("late clicked"), clicked.split("\n")[0] + " (" + clickTook + "ms)");
  const found = await call("browser_find", {});
  check("find works after slow load", found.includes("controls"), found.split("\n")[0]);
  results.push("ALL SLOW-LOAD CHECKS PASSED");
} finally {
  console.log(results.join("\n"));
  server.close();
  await closeBrowser();
}
