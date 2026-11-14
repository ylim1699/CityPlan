/* Dev check: open a page in headless Chrome, run optional clicks, save a screenshot, print console errors.
   Usage: pnpm tsx scripts/shot.ts <url> <out.png> [steps as JSON: [{"click":"css"},{"wait":ms},{"eval":"js"}]] */
import puppeteer from 'puppeteer-core';

const [url, out, stepsJson] = process.argv.slice(2);
const exe = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors: string[] = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + (e as Error).message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
for (const st of JSON.parse(stepsJson || '[]')) {
  if (st.click) await page.click(st.click);
  if (st.eval) console.log('eval:', JSON.stringify(await page.evaluate(st.eval)));
  await new Promise(r => setTimeout(r, st.wait || 600));
}
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
