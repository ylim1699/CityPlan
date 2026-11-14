/* Save the text of a few Rexburg meeting minutes from the city's Laserfiche archive, using the viewer's
   "View plain text" mode in a headless browser (file downloads are blocked for scripts). Low volume, public records only.
   Usage: pnpm tsx scripts/fetch_minutes.ts <laserfiche-doc-id>:<file-name.txt> ...   (saves to data/raw/minutes/)
   Then: pnpm agent data/raw/minutes/<file>.txt "<label>" */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const B = 'https://laserfiche.rexburg.org/WebLink/';
const exe = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync('data/raw/minutes', { recursive: true });
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clickText = (t: string) => page.evaluate((t: string) => {
  const e = [...document.querySelectorAll('a,button')].find(x => (x as HTMLElement).innerText.trim() === t || x.id === t);
  if (e) (e as HTMLElement).click(); return !!e;
}, t);

for (const arg of process.argv.slice(2)) {
  const [id, name] = arg.split(':');
  const url = B + 'DocView.aspx?id=' + id + '&dbid=0&repo=Rexburg';
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
  const title = await page.title();
  const pages = await page.evaluate(() => { const m = document.body.innerText.match(/\/\s*(\d+)\s*\n/); return m ? +m[1] : 1; });
  await sleep(2000); await clickText('View plain text'); await sleep(7000);
  /* the text panel adds each page as you step through, so the last snapshot holds the whole document */
  let body = '';
  for (let p = 1; p <= pages; p++) {
    body = await page.evaluate(() => document.body.innerText);
    if (p < pages) { await clickText('STR_NEXT_PAGE'); await sleep(5000); }
  }
  writeFileSync('data/raw/minutes/' + name, 'Source: ' + url + '\nTitle: ' + title + '\nPages: ' + pages + '\n\n' + body);
  console.log('saved', name, pages, 'pages,', body.length, 'chars');
  await sleep(1500); // be gentle with the city's server
}
await browser.close();
