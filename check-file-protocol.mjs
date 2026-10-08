// check-file-protocol.mjs — can the game be opened by double-clicking the file,
// or does it need a web server? (module + importmap + CDN imports under file://)
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });

await page.goto('file:///root/workspace/kana-shmup/index.html', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const loaded = await page.evaluate(() => typeof window.KanaShmup);
console.log('KanaShmup on file:// →', loaded);
console.log('errors:', errs.length ? '\n  ' + errs.join('\n  ') : 'none');
await browser.close();
process.exit(loaded === 'object' && errs.length === 0 ? 0 : 1);
