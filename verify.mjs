// verify.mjs — checks the shipping game file without a browser.
// Run: node verify.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let fails = 0;
const ok  = (m) => console.log('  ok   ' + m);
const bad = (m) => { fails++; console.log('  FAIL ' + m); };
const check = (cond, m) => cond ? ok(m) : bad(m);

/* ---------- 1. the module script must actually parse ---------- */
const modMatch = SRC.match(/<script type="module">([\s\S]*?)<\/script>/);
check(!!modMatch, 'module script found in HTML');
const modSrc = modMatch[1];
writeFileSync('/tmp/kana-module.mjs', modSrc);
try {
  execFileSync(process.execPath, ['--check', '/tmp/kana-module.mjs'], { stdio: 'pipe' });
  ok('module parses as valid ES module (node --check)');
} catch (e) {
  bad('module has a syntax error:\n' + e.stderr?.toString());
}

/* ---------- 2. run the REAL data tables + buildPool ---------- */
// Slice the shipping source (not a copy) from the ROMAJI declaration through
// the end of buildPool, so this exercises the code the game actually runs.
const start = modSrc.indexOf('const ROMAJI = [');
const endMarker = 'function buildPool(mode){';
const end = modSrc.indexOf('}', modSrc.indexOf('return out;', modSrc.indexOf(endMarker))) + 1;
const slice = modSrc.slice(start, end);

const { ROMAJI, HIRAGANA, KATAKANA, buildPool } = await import(
  'data:text/javascript,' + encodeURIComponent(slice + '\nexport { ROMAJI, HIRAGANA, KATAKANA, buildPool };')
);

check(ROMAJI.length === HIRAGANA.length, `romaji/hiragana aligned (${ROMAJI.length} vs ${HIRAGANA.length})`);
check(ROMAJI.length === KATAKANA.length, `romaji/katakana aligned (${ROMAJI.length} vs ${KATAKANA.length})`);

check(ROMAJI.every(r => /^[a-z]+$/.test(r)), 'every romaji is typeable lowercase a-z only');

const dupRomaji = ROMAJI.filter((r, i) => ROMAJI.indexOf(r) !== i);
check(JSON.stringify([...new Set(dupRomaji)].sort()) === '["ji","zu"]',
  'only expected romaji duplicates (ji, zu — the じ/ぢ and ず/づ homophones)');

const hOk = HIRAGANA.every(g => [...g].every(c => c.codePointAt(0) >= 0x3040 && c.codePointAt(0) <= 0x309f));
const kOk = KATAKANA.every(g => [...g].every(c => c.codePointAt(0) >= 0x30a0 && c.codePointAt(0) <= 0x30ff));
check(hOk, 'every hiragana glyph is in U+3040–U+309F');
check(kOk, 'every katakana glyph is in U+30A0–U+30FF');

check(new Set(HIRAGANA).size === HIRAGANA.length, 'no duplicate hiragana glyphs');
check(new Set(KATAKANA).size === KATAKANA.length, 'no duplicate katakana glyphs');

/* ---------- 3. spot-check the alignment row by row ---------- */
const pairs = ROMAJI.map((r, i) => [r, HIRAGANA[i], KATAKANA[i]]);
const expect = (romaji, hira, kata) => {
  const p = pairs.find(x => x[0] === romaji);
  return p && p[1] === hira && p[2] === kata;
};
const spot = [
  ['shi', 'し', 'シ'], ['chi', 'ち', 'チ'], ['tsu', 'つ', 'ツ'], ['fu', 'ふ', 'フ'],
  ['ji',  'じ', 'ジ'], ['n',   'ん', 'ン'], ['wo',  'を', 'ヲ'],
  ['kya', 'きゃ', 'キャ'], ['sha', 'しゃ', 'シャ'], ['cho', 'ちょ', 'チョ'],
];
check(spot.every(([r, h, k]) => expect(r, h, k)), 'spot-checks pass (shi/chi/tsu/fu/ji/n/wo/kya/sha/cho)');

// the じ/ぢ collision must land on the right glyphs, in order
const jiIdx = ROMAJI.map((r, i) => [r, i]).filter(([r]) => r === 'ji').map(([, i]) => i);
check(jiIdx.length === 2 && HIRAGANA[jiIdx[0]] === 'じ' && HIRAGANA[jiIdx[1]] === 'ぢ',
  'both "ji" entries map to じ then ぢ');

/* ---------- 4. pool building ---------- */
const hPool = buildPool('hiragana'), kPool = buildPool('katakana'), bPool = buildPool('both');
check(hPool.length === ROMAJI.length, `hiragana pool = ${hPool.length} (all entries)`);
check(kPool.length === ROMAJI.length, `katakana pool = ${kPool.length}`);
check(bPool.length === ROMAJI.length * 2, `both pool = ${bPool.length}`);
check(new Set(bPool.map(p => p.key)).size === bPool.length, 'pool keys are unique (mastery tracking is per-script)');
check(hPool.every(p => HIRAGANA.includes(p.glyph)) && kPool.every(p => KATAKANA.includes(p.glyph)),
  'each pool contains only its own script');

/* ---------- 5. every DOM id the game touches must exist ---------- */
const ids = new Set();
for (const m of SRC.matchAll(/\bel\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of SRC.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(m[1]);
for (const m of SRC.matchAll(/document\.querySelector\('(#[^']+)'\)/g)) ids.add(m[1].slice(1));
const declared = new Set([...SRC.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const missing = [...ids].filter(i => !declared.has(i));
check(missing.length === 0,
  `all ${ids.size} referenced element ids exist${missing.length ? ' — MISSING: ' + missing.join(', ') : ''}`);

/* ---------- 6. imports resolve to something a browser can fetch ---------- */
const importMap = JSON.parse(SRC.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
check(!!importMap.imports.three, 'importmap maps "three"');
check(!!importMap.imports['three/addons/'], 'importmap maps "three/addons/"');
const addons = [...modSrc.matchAll(/(?:from\s+|import\()['"]three\/addons\/([^'"]+)['"]/g)].map(m => m[1]);
check(addons.length > 0, `addons imported: ${[...new Set(addons)].join(', ')}`);

/* ---------- 7. nothing obviously unsafe left in ---------- */
check(!/eval\(|new Function\(/.test(modSrc), 'no eval / new Function');

// Every innerHTML write must route user-visible text through escapeHtml.
// (The kana glyphs and romaji are our own data, but the habit is worth keeping
// enforceable — and this is the one place a stray string could get injected.)
const htmlWrites = [...modSrc.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map(m => m[1]);
const unsafeWrites = htmlWrites.filter(rhs => {
  if (rhs.includes('escapeHtml')) return false;                 // e.g. buf ? escapeHtml(buf) : ''
  const trimmed = rhs.trim();
  return !/^(['"`])[^$]*\1$/.test(trimmed);                    // or a plain literal
});
check(htmlWrites.length > 0 && unsafeWrites.length === 0,
  `all ${htmlWrites.length} innerHTML writes are escaped${unsafeWrites.length ? ' — UNSAFE: ' + unsafeWrites.join(' | ') : ''}`);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
