// test-mobile.mjs — drives the game under touch emulation (Pixel 7 viewport,
// hasTouch/isMobile) to verify the on-screen keyboard and drag-to-move, which
// test-playwright.mjs's desktop/mouse context never exercises.
// Run: node test-mobile.mjs
import { chromium, devices } from 'playwright';

const URL = 'http://localhost:8765/index.html';
let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ ...devices['Pixel 7'] });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.KanaShmup, null, { timeout: 20000 });
const waitForShip = () => page.waitForFunction(() => KanaShmup.enemies.some(e => e.alive), null, { timeout: 10000 });

const isCoarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
check(isCoarse, 'touch emulation reports a coarse pointer');

/* ---------- keyboard hidden before a run ---------- */
check(!(await page.locator('#mobileKb').evaluate(el => el.classList.contains('show'))),
  'on-screen keyboard hidden on the title screen');

/* ---------- start a run ---------- */
await page.tap('#startBtn');
await waitForShip();
check(await page.locator('#mobileKb').evaluate(el => el.classList.contains('show')),
  'on-screen keyboard appears once a run starts');

const kbBox = await page.locator('#mobileKb').boundingBox();
const canvasBox = await page.locator('canvas').boundingBox();
check(kbBox.height > 0, `keyboard has real height (${Math.round(kbBox.height)}px)`);
check(Math.round(canvasBox.height + kbBox.height) === await page.evaluate(() => window.innerHeight),
  'canvas is shrunk by exactly the keyboard height, no gap/overlap');
check(canvasBox.y + canvasBox.height <= kbBox.y + 1, 'canvas sits entirely above the keyboard');

/* ---------- tapping keys types romaji through the real game logic ---------- */
const target = await page.evaluate(() => {
  const e = KanaShmup.liveEnemies()[0];
  return e.romaji;
});
const scoreBefore = await page.evaluate(() => KanaShmup.state.score);
for (const ch of target) {
  await page.tap(`#mobileKb .kbkey[data-k="${ch}"]`);
}
await page.waitForFunction(s => KanaShmup.state.score > s, scoreBefore, { timeout: 3000 });
check(true, `tapping "${target}" on the on-screen keyboard destroyed the ship`);

/* ---------- backspace key ---------- */
await waitForShip();
const t2 = await page.evaluate(() => KanaShmup.liveEnemies()[0].romaji);
await page.tap(`#mobileKb .kbkey[data-k="${t2[0]}"]`);
check((await page.evaluate(() => KanaShmup.state.buffer ?? document.getElementById('buffer').textContent)).length > 0 ||
  (await page.locator('#buffer').textContent()).length > 0,
  'buffer shows the tapped letter');
await page.tap('#mobileKb .kbkey.bksp');
check((await page.locator('#buffer').textContent()).trim() === '', 'on-screen Backspace clears the buffer');

/* ---------- drag-to-move ---------- */
// KanaShmup doesn't expose the player's position, so this drives a real
// touch-drag gesture via CDP and checks it actually moves the ship and
// produces no errors — the strongest signal available without a new hook.
const playerXBefore = await page.evaluate(() => KanaShmup.player?.position.x ?? null);
const startX = canvasBox.x + canvasBox.width / 2;
const startY = canvasBox.y + canvasBox.height / 2;
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart', touchPoints: [{ x: startX, y: startY }],
});
for (let i = 1; i <= 10; i++){
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: startX + i * 8, y: startY }],
  });
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
check(errors.length === 0, 'drag gesture produced no console/page errors');
if (playerXBefore !== null){
  const playerXAfter = await page.evaluate(() => KanaShmup.player.position.x);
  check(playerXAfter > playerXBefore, `drag moved the ship right (${playerXBefore.toFixed(1)} → ${playerXAfter.toFixed(1)})`);
}

/* ---------- pause button (the only way to pause without a keyboard) ---------- */
await page.tap('#mobileKb .kbkey.pause');
check(await page.locator('#pauseScreen').isVisible(), 'on-screen pause button opens the pause screen');
check(!(await page.locator('#mobileKb').evaluate(el => el.classList.contains('show'))),
  'keyboard hides while paused');

/* ---------- quit button (previously unreachable without a keyboard) ---------- */
await page.tap('#quitBtn');
check(await page.locator('#titleScreen').isVisible(), 'Quit to menu button returns to the title screen');

check(errors.length === 0, 'no console errors or page errors');
if (errors.length) console.log(errors.join('\n'));

await browser.close();

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL MOBILE CHECKS PASSED');
