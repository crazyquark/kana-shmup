// test-playwright.mjs — drives the real game in a real browser.
// Run: node test-playwright.mjs
import { chromium } from 'playwright';

const URL = 'http://localhost:8765/index.html';
let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

const boot = async () => {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.KanaShmup, null, { timeout: 20000 });
};
// The game spawns on a timer, so never assume a ship exists — wait for one.
const waitForShip = () => page.waitForFunction(() => KanaShmup.enemies.some(e => e.alive), null, { timeout: 10000 });

// For anything gated on simulated game-seconds elapsing (wound timers, wave
// timers, …): don't assume sim-time tracks real-time 1:1. The render loop
// clamps dt to 0.05s/frame, and under headless + swiftshader + bloom this
// environment's actual frame time regularly exceeds that, so sim-time has
// been observed running at roughly 30% of real-time — a 2.4 sim-second
// timer can take ~8 real seconds here. Poll from Node (not a busy-loop
// inside page.evaluate, which would only make the frame-time problem worse)
// with a generous ceiling instead of a fixed wait tuned to the 1:1 case.
async function waitForPageCondition(fn, timeoutMs = 15000, intervalMs = 300){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(intervalMs);
  }
  return false;
}

await boot();

/* ---------- boot ---------- */
check(await page.locator('canvas').count() === 1, 'WebGL canvas created');
check(await page.locator('#titleScreen').isVisible(), 'title screen shown on load');
const counts = await page.evaluate(() => [KanaShmup.ROMAJI.length, KanaShmup.HIRAGANA.length, KanaShmup.KATAKANA.length]);
check(counts[0] === counts[1] && counts[1] === counts[2], `kana tables aligned in-page (${counts.join('/')})`);
const glOk = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!(c.getContext('webgl2') || c.getContext('webgl'));
});
check(glOk, 'WebGL context is live');

/* ---------- start a run ---------- */
await page.click('#startBtn');
await waitForShip();
check(true, `enemies spawn (${(await page.evaluate(() => KanaShmup.liveEnemies())).length} on screen)`);
check(await page.evaluate(() => KanaShmup.state.score) === 0, 'score starts at 0');

/* ---------- core mechanic: type the romaji to destroy ---------- */
const target = await page.evaluate(() => {
  const e = KanaShmup.enemies.filter(x => x.alive).sort((a, b) => a.g.position.y - b.g.position.y)[0];
  return { romaji: e.entry.romaji, glyph: e.entry.glyph, key: e.entry.key };
});
console.log(`       targeting ${target.glyph} → "${target.romaji}"`);
await page.keyboard.type(target.romaji, { delay: 40 });
await page.waitForTimeout(400);

const after = await page.evaluate(() => ({
  kills: KanaShmup.state.kills, score: KanaShmup.state.score,
  typed: KanaShmup.state.typed, correct: KanaShmup.state.correct,
  buffer: KanaShmup.state.buffer, inScene: KanaShmup.enemies.length,
}));
check(after.kills === 1, `typing the romaji destroys the ship (kills=${after.kills})`);
check(after.score > 0, `score awarded (${after.score})`);
check(after.correct === 1 && after.typed === 1, 'attempt/accuracy counters incremented');
check(after.buffer === '', 'buffer clears after a kill');
check(after.inScene === 0, 'destroyed ship is reaped from the scene graph (no leak)');

/* ---------- partial word: highlight, don't fire, don't give the answer away ----------
   Deterministically spawn a multi-letter kana rather than trusting whatever the
   live ship happens to be — it could be "n" (ん), the one single-letter romaji,
   which would complete on the very first keystroke. spawnIn is parked so the
   natural spawner can't add a second "m" ship and steal the lock mid-check. */
const pick = await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  const e = KanaShmup.spawn({ glyph: 'みゃ', romaji: 'mya', key: 'h83' });
  e.g.position.y = 0; e.speed = 0; e.drift = 0;
  return { romaji: e.entry.romaji, glyph: e.entry.glyph };
});
{
  const killsBefore = await page.evaluate(() => KanaShmup.state.kills);
  await page.keyboard.type(pick.romaji[0], { delay: 40 });
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => ({
    buffer: KanaShmup.state.buffer, kills: KanaShmup.state.kills, t: KanaShmup.targetRomaji(),
    hud: document.getElementById('buffer').innerText,
  }));
  check(mid.buffer === pick.romaji[0], `partial input held in buffer ("${mid.buffer}")`);
  check(mid.kills === killsBefore, 'a partial word does NOT fire');
  check(mid.t === pick.romaji, `target locks to the closest matching ship (${pick.glyph})`);
  check(!mid.hud.includes(pick.romaji), `remaining romaji is NOT revealed in the HUD (hud="${mid.hud}")`);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => KanaShmup.state.buffer) === '', 'Backspace clears the buffer');
}

/* ---------- wrong key ---------- */
const wrong = await page.evaluate(() => {
  const S = KanaShmup.state;
  const typedBefore = S.typed;
  // dispatch and read in the same synchronous block: the miss styling is
  // intentionally transient, so a round-trip could miss it
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
  return {
    typedDelta: S.typed - typedBefore,
    buffer: S.buffer,
    cls: document.getElementById('buffer').className,
  };
});
check(wrong.typedDelta === 1, 'wrong key is counted as an attempt');
check(wrong.buffer === '', 'wrong key clears the buffer');
check(wrong.cls.includes('miss'), 'wrong key shows the miss feedback');
// ...and the transient styling must not stick around forever
await page.waitForTimeout(600);
check(await page.evaluate(() => document.getElementById('buffer').className) === '',
  'miss feedback clears itself after the shake');

/* ---------- an escaped ship costs a life, and reveals the answer ---------- */
const livesBefore = await page.evaluate(() => KanaShmup.state.lives);
const escaped = await page.evaluate(() => {
  const e = KanaShmup.enemies.filter(x => x.alive).sort((a, b) => a.g.position.y - b.g.position.y)[0];
  if (!e) return null;
  e.g.position.y = -59;                     // just past the "reached the player" line
  return { glyph: e.entry.glyph, romaji: e.entry.romaji };
});
check(!!escaped, 'an enemy was available to push off the bottom');
await page.waitForTimeout(600);
const livesAfter = await page.evaluate(() => KanaShmup.state.lives);
check(livesAfter === livesBefore - 1, `an escaped ship costs a life (${livesBefore} → ${livesAfter})`);
const toast = (await page.locator('#toast').innerText()).trim();
// innerText is uppercased by CSS text-transform, so compare case-insensitively
check(toast.toLowerCase().includes(escaped.romaji), `the answer is revealed when you fail it ("${toast}")`);

/* ---------- mastery memory ---------- */
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kana-shmup.mastery.v1') || '{}'));
check(Object.values(saved).some(v => v.miss > 0), `a miss is recorded for re-drilling (${Object.keys(saved).length} kana tracked)`);

/* ---------- pause / resume ---------- */
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check(await page.locator('#pauseScreen').isVisible(), 'Esc pauses the game');
const frozen = await page.evaluate(() => KanaShmup.enemies.length);
await page.waitForTimeout(500);
check(await page.evaluate(() => KanaShmup.enemies.length) === frozen, 'the world is frozen while paused');
await page.click('#resumeBtn');
await page.waitForTimeout(200);
check(!(await page.locator('#pauseScreen').isVisible()), 'resume works');

// The cap is 3, so stage exactly that many — including a digraph (きゃ),
// which uses a smaller font size in the canvas texture, to prove it renders
// cleanly alongside basic kana. Wound one and bank a bomb so the screenshot
// also shows off both new mechanics, not just the kill-to-type loop.
await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  KanaShmup.state.fireIn = 1e9;
  KanaShmup.playerBullets.length = 0;
  // The escaped-ship test above left the ship mid-invuln-blink; without this
  // the screenshot has a coin-flip chance of landing on a blinked-off frame.
  KanaShmup.state.invuln = 0;
  KanaShmup.player.visible = true;
  const spawned = [['か', 'ka', 'h5'], ['つ', 'tsu', 'h17'], ['きゃ', 'kya', 'h71']].map(([glyph, romaji, key], i) => {
    const e = KanaShmup.spawn({ glyph, romaji, key });
    e.g.position.y = 28 - i * 19;
    e.g.position.x = (i - 1) * 20;
    e.x0 = e.g.position.x; e.speed = 0; e.drift = 0;
    return e;
  });
  KanaShmup.woundEnemy(spawned[1]);
  KanaShmup.state.bombs = 1;
  KanaShmup.syncBombBadge();
});
await page.waitForTimeout(700);
check((await page.evaluate(() => KanaShmup.liveEnemies())).length === 3, 'three-ship lineup staged for the screenshot');
await page.screenshot({ path: 'shot-gameplay.png' });
await page.evaluate(() => { KanaShmup.state.bombs = 0; KanaShmup.syncBombBadge(); });

/* ---------- game over ---------- */
await page.evaluate(() => {
  KanaShmup.state.lives = 1;
  KanaShmup.enemies.filter(e => e.alive).forEach(e => { e.g.position.y = -59; });
});
await page.waitForTimeout(800);
check(await page.locator('#overScreen').isVisible(), 'game over screen appears when lives run out');
const detail = await page.locator('#oDetail').innerText();
check(detail.length > 0, `game over names the weak kana ("${detail.slice(0, 70)}…")`);
await page.screenshot({ path: 'shot-gameover.png' });

await page.click('#againBtn');
await page.waitForTimeout(400);
check(await page.evaluate(() => KanaShmup.state.lives) === 3, 'restart restores 3 lives');

/* ---------- katakana mode ---------- */
await boot();
await page.click('.modes button[data-mode="katakana"]');
check(await page.evaluate(() => KanaShmup.state.mode) === 'katakana', 'katakana mode selected');
await page.click('#startBtn');
const poolOk = await page.evaluate(() => KanaShmup.state.pool.length === 104 &&
  KanaShmup.state.pool.every(p => [...p.glyph].every(c => c.codePointAt(0) >= 0x30a0 && c.codePointAt(0) <= 0x30ff)));
check(poolOk, 'katakana pool is built from katakana only (104 entries)');
await page.waitForFunction(() => KanaShmup.enemies.some(e => e.alive), null, { timeout: 10000 });
const kata = await page.evaluate(() => KanaShmup.liveEnemies().map(e => e.glyph));
const isKata = kata.length > 0 && kata.every(g => [...g].every(c => c.codePointAt(0) >= 0x30a0 && c.codePointAt(0) <= 0x30ff));
check(isKata, `katakana mode spawns only katakana (${kata.join(' ')})`);

// Same — a 3-ship lineup, matching real gameplay.
await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  [['カ', 'ka', 'k5'], ['ン', 'n', 'k45'], ['キャ', 'kya', 'k71']].forEach(([glyph, romaji, key], i) => {
    const e = KanaShmup.spawn({ glyph, romaji, key });
    e.g.position.y = 28 - i * 19;
    e.g.position.x = (i - 1) * 20;
    e.x0 = e.g.position.x; e.speed = 0; e.drift = 0;
  });
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'shot-katakana.png' });

/* ---------- "both" mode ---------- */
await boot();
await page.click('.modes button[data-mode="both"]');
await page.click('#startBtn');
check(await page.evaluate(() => KanaShmup.state.pool.length) === 208, '"both" mode pools hiragana + katakana');

/* ---------- difficulty slider ---------- */
await boot();
await page.click('.modes button[data-mode="hiragana"]');
check(await page.locator('#diffSlider').inputValue() === '3', 'difficulty defaults to 3 (full table)');

await page.fill('#diffSlider', '1');
await page.dispatchEvent('#diffSlider', 'input');
check((await page.locator('#diffName').innerText()).includes('Basic'), 'difficulty label updates to Basic kana');
await page.click('#startBtn');
let diffPool = await page.evaluate(() => KanaShmup.state.pool);
check(diffPool.length === 46, `difficulty 1 pool is 46 (basic only, got ${diffPool.length})`);
check(diffPool.every(p => [...p.glyph].length === 1), 'difficulty 1 pool has no digraphs');

await boot();
await page.fill('#diffSlider', '2');
await page.dispatchEvent('#diffSlider', 'input');
await page.click('#startBtn');
diffPool = await page.evaluate(() => KanaShmup.state.pool);
check(diffPool.length === 71, `difficulty 2 pool is 71 (basic + dakuten, got ${diffPool.length})`);

/* ---------- positioning bonus: typing always fires, alignment just scores more ----------
   Romaji is deliberately "kyo" (きょ), not a real table entry — it must avoid
   w/a/s/d, which double as movement keys: typing one would nudge the ship
   mid-word via the same keydown listener that drives flying, throwing off
   the x-position this test is trying to hold still. */
const killAt = async (playerX) => {
  await boot();
  await page.click('#startBtn');
  await page.evaluate((px) => {
    KanaShmup.enemies.forEach(e => { e.alive = false; });
    KanaShmup.state.spawnIn = 1e9;
    // Auto-fire's very first shot leaves the gun at reset time, from the
    // default player position, before this setup gets to move the ship —
    // left alone it can wound this test's target regardless of which
    // scenario is running. Neutralize it the same way spawnIn is parked.
    KanaShmup.playerBullets.length = 0;
    KanaShmup.state.fireIn = 1e9;
    const e = KanaShmup.spawn({ glyph: 'きょ', romaji: 'kyo', key: 'h90' });
    // phase=0 too: the update loop applies sin(age*drift + phase)*5.5 to x every
    // frame regardless of drift/speed, so a random leftover phase still jitters
    // the enemy's x by up to ±5.5 — enough to flip the alignment check.
    e.g.position.y = 0; e.g.position.x = 0; e.x0 = 0; e.speed = 0; e.drift = 0; e.phase = 0;
    KanaShmup.player.position.x = px;
  }, playerX);
  await page.keyboard.type('kyo', { delay: 30 });
  await page.waitForTimeout(250);
  return { score: await page.evaluate(() => KanaShmup.state.score),
           toast: (await page.locator('#toast').innerText()).trim() };
};
const aligned = await killAt(0);     // directly under the target
const far = await killAt(60);        // well outside ALIGN_RANGE, same kill otherwise
check(aligned.score > far.score,
  `killing while aligned scores more (${aligned.score} vs ${far.score})`);
check(aligned.score >= Math.round(far.score * 1.25),
  `alignment bonus is a meaningful fraction of score, not rounding noise (${aligned.score} vs ${far.score})`);
check(aligned.toast.toLowerCase().includes('precision'), 'aligned kill shows the precision-kill callout');
check(!far.toast.toLowerCase().includes('precision'), 'misaligned kill does not claim precision');

/* ---------- auto-fire: the ship shoots on its own and wounds an aligned enemy ---------- */
await boot();
await page.click('#startBtn');
await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
  // Directly in the player's lane, close enough that the first real shot reaches it quickly.
  e.g.position.y = 0; e.g.position.x = KanaShmup.player.position.x; e.x0 = e.g.position.x;
  e.speed = 0; e.drift = 0; e.phase = 0;
});
const woundedByRealFire = await waitForPageCondition(() => KanaShmup.enemies[0]?.wounded ?? false);
check(woundedByRealFire, 'auto-fire actually hits and wounds an aligned enemy (real collision path, not the test hook)');

/* ---------- wounded bonus: finishing a shot enemy scores more; typing still kills either way ---------- */
const killWound = async (wounded) => {
  await boot();
  await page.click('#startBtn');
  await page.evaluate((w) => {
    KanaShmup.enemies.forEach(e => { e.alive = false; });
    KanaShmup.state.spawnIn = 1e9;
    KanaShmup.playerBullets.length = 0;
    KanaShmup.state.fireIn = 1e9;
    const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
    e.g.position.y = 0; e.g.position.x = 0; e.x0 = 0; e.speed = 0; e.drift = 0; e.phase = 0;
    KanaShmup.player.position.x = 0;   // aligned in both cases, isolates the wounded factor
    if (w) KanaShmup.woundEnemy(e);
  }, wounded);
  await page.keyboard.type('nu', { delay: 30 });
  await page.waitForTimeout(200);
  return { score: await page.evaluate(() => KanaShmup.state.score),
           toast: (await page.locator('#toast').innerText()).trim().toLowerCase() };
};
const healthy = await killWound(false);
const finished = await killWound(true);
check(finished.score > healthy.score, `finishing a wounded enemy scores more (${finished.score} vs ${healthy.score})`);
check(finished.score >= Math.round(healthy.score * 1.4),
  `wounded bonus is a meaningful fraction of score, not rounding noise (${finished.score} vs ${healthy.score})`);
check(healthy.toast.includes('precision') && !healthy.toast.includes('finish'),
  'an unwounded (but aligned) kill only claims precision, not "finished"');
check(finished.toast.includes('precision') && finished.toast.includes('finish'),
  'a wounded+aligned kill claims "precision finish"');

/* ---------- typing still kills an UNwounded enemy outright — shooting is never required ---------- */
await boot();
await page.click('#startBtn');
await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
  e.g.position.y = 0; e.speed = 0; e.drift = 0;
});
await page.keyboard.type('nu', { delay: 30 });
await page.waitForTimeout(200);
check((await page.evaluate(() => KanaShmup.state.kills)) === 1, 'typing alone destroys an unwounded enemy — shooting is optional, not a gate');

/* ---------- a wounded enemy regenerates (reverts, not destroyed) if not finished in time ---------- */
await boot();
await page.click('#startBtn');
await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  KanaShmup.state.spawnIn = 1e9;
  // Also neutralize auto-fire and park the enemy well outside its range —
  // left alone, a fresh shot landing right after regeneration (an unwounded
  // enemy in range is fair game again) would re-wound it before this can
  // observe the reverted state in between.
  KanaShmup.playerBullets.length = 0;
  KanaShmup.state.fireIn = 1e9;
  const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
  e.g.position.y = 0; e.g.position.x = 50; e.x0 = 50; e.speed = 0; e.drift = 0; e.phase = 0;
  KanaShmup.woundEnemy(e);
});
const woundedRightAfter = await page.evaluate(() => KanaShmup.enemies[0].wounded);
const reverted = await waitForPageCondition(() => !KanaShmup.enemies[0].wounded);
const stillAlive = await page.evaluate(() => KanaShmup.enemies[0].alive);
check(woundedRightAfter, 'shooting an enemy marks it wounded');
check(reverted, 'a wounded enemy regenerates (reverts) if not finished before the window closes');
check(stillAlive, 'regenerating does not destroy the enemy, it only reverts the wound');

/* ---------- streak bomb: every 5-kill streak banks one; Space detonates and clears the screen ---------- */
await boot();
await page.click('#startBtn');
await page.evaluate(() => {
  KanaShmup.state.spawnIn = 1e9; KanaShmup.state.fireIn = 1e9; KanaShmup.playerBullets.length = 0;
});
for (let i = 0; i < 5; i++){
  await page.evaluate(() => {
    KanaShmup.enemies.forEach(e => { e.alive = false; });
    const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
    e.g.position.y = 20; e.x0 = 0; e.g.position.x = 0; e.speed = 0; e.drift = 0; e.phase = 0;
  });
  await page.keyboard.type('nu', { delay: 20 });
  await page.waitForTimeout(80);
}
const bombsAfterStreak = await page.evaluate(() => KanaShmup.state.bombs);
check(bombsAfterStreak >= 1, `a 5-kill streak banks a bomb (bombs=${bombsAfterStreak})`);
check(await page.locator('#bombBadge').evaluate(el => getComputedStyle(el).opacity) !== '0',
  'the bomb badge becomes visible once a bomb is banked');

await page.evaluate(() => {
  KanaShmup.enemies.forEach(e => { e.alive = false; });
  for (let i = 0; i < 3; i++){
    const e = KanaShmup.spawn({ glyph: 'ぬ', romaji: 'nu', key: 'h99' });
    e.g.position.y = 10; e.g.position.x = (i - 1) * 20; e.x0 = e.g.position.x; e.speed = 0; e.drift = 0; e.phase = 0;
  }
});
check((await page.evaluate(() => KanaShmup.liveEnemies())).length === 3, '3 enemies staged before the bomb');
await page.keyboard.press(' ');
await page.waitForTimeout(150);
const afterBomb = await page.evaluate(() => ({ live: KanaShmup.liveEnemies().length, bombs: KanaShmup.state.bombs }));
check(afterBomb.live === 0, 'Space detonates the bomb and clears every live enemy');
check(afterBomb.bombs === bombsAfterStreak - 1, 'detonating consumes exactly one banked bomb');

/* ---------- every glyph must fit its sprite canvas without clipping ---------- */
const clipped = await page.evaluate(() => {
  const bad = [];
  const measure = (glyph) => {
    const cv = KanaShmup.kanaTexture(glyph).image;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let minX = cv.width, maxX = -1, minY = cv.height, maxY = -1;
    for (let y = 0; y < cv.height; y++){
      for (let x = 0; x < cv.width; x++){
        if (d[(y * cv.width + x) * 4 + 3] > 12){
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { minX, maxX, minY, maxY, w: cv.width, h: cv.height };
  };
  for (const glyph of [...KanaShmup.HIRAGANA, ...KanaShmup.KATAKANA]){
    const b = measure(glyph);
    // a glyph touching the canvas edge has been clipped by it
    if (b.minX <= 1 || b.minY <= 1 || b.maxX >= b.w - 2 || b.maxY >= b.h - 2){
      bad.push(`${glyph} (${b.minX},${b.minY})-(${b.maxX},${b.maxY})`);
    }
  }
  return bad;
});
check(clipped.length === 0,
  `all 208 glyphs render inside their canvas, un-clipped${clipped.length ? ' — CLIPPED: ' + clipped.join(' ') : ''}`);

/* ---------- exhaustive: EVERY romaji must be typeable and must fire ----------
   This is the regression test for the class of bug where a keyboard shortcut
   swallows a letter key ('m' used to be the mute toggle, which made all eight
   m-romaji unanswerable). It drives all 104 through the real input path. */
await boot();
await page.click('#startBtn');
await page.waitForTimeout(300);
const untypeable = await page.evaluate(async () => {
  const S = KanaShmup.state;
  const bad = [];
  S.spawnIn = 1e9;                                   // no interference from waves
  S.lives = 99;                                      // don't die mid-suite
  for (const p of KanaShmup.HIRAGANA.map((g, i) => ({ glyph: g, romaji: KanaShmup.ROMAJI[i], key: 'h' + i }))){
    // clear the field, place one stationary target mid-screen
    KanaShmup.enemies.forEach(e => { e.alive = false; });
    S.buffer = ''; S.target = null;
    const e = KanaShmup.spawn(p);
    e.g.position.y = 0; e.speed = 0; e.drift = 0;
    const before = S.kills;
    for (const ch of p.romaji){
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    }
    if (S.kills !== before) continue;
    bad.push(p.glyph + '/' + p.romaji);
  }
  return bad;
});
check(untypeable.length === 0,
  `all 104 romaji are typeable and fire${untypeable.length ? ' — DEAD KEYS: ' + untypeable.join(' ') : ''}`);

/* ---------- console must be clean ---------- */
check(errors.length === 0, `no console errors or page errors${errors.length ? ':\n       ' + errors.join('\n       ') : ''}`);

await browser.close();
console.log(fails === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${fails} BROWSER CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
