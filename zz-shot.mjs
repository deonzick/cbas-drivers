import { chromium } from "playwright";
const [,, out] = process.argv;
const b = await chromium.launch();
for (const [name, w, h, scheme] of [["desk-light", 1280, 1900, "light"], ["phone-light", 390, 2400, "light"], ["phone-dark", 390, 1400, "dark"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
  await p.goto("http://localhost:3123/zz-preview", { waitUntil: "networkidle" });
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  if (name === "desk-light") { await p.goto("http://localhost:3123/login", { waitUntil: "networkidle" }); await p.screenshot({ path: `${out}/login.png` }); }
}
await b.close();
