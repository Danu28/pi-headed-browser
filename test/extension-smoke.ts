import { getPage, loadExtension } from "../src/session.js";

async function smokeExtension(){
  console.log("=== Extension smoke: load Coverage Copilot ===");
  const r = await loadExtension("C:/Users/dhanu/Desktop/QA-Tools/coverage-copilot/extension");
  console.log("loaded", r);
  const page = await getPage();
  await page.goto("chrome-extension://"+r.id+"/popup.html", { waitUntil: "domcontentloaded" }).catch(e=>console.log("popup open err", e.message));
  console.log("popup url", page.url(), "title", await page.title());
  // quick find would require index.ts tools, but we can eval popup DOM
  const html = await page.content();
  console.log("popup html head", html.slice(0,1200));
  console.log("=== done (check if Generate P0 Suite button visible) ===");
  process.exit(0);
}
smokeExtension();
