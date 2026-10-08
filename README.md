# Kana Shmup — かなシューティング

A small Three.js shmup for drilling hiragana and katakana. Ships drift down
carrying a kana; **you destroy one by typing its romaji.** Let a ship reach the
bottom and you lose a life.

## Running it

Open `index.html` in a browser. That's it — it's a single self-contained file
and works straight from `file://` (double-click it). It does need an internet
connection the first time, because Three.js and the Japanese webfont come from a
CDN.

Prefer a local server? Anything works:

    python3 -m http.server 8765     # then open http://localhost:8765/

## Controls

| Key | |
|---|---|
| letters | type the target's romaji |
| Backspace | clear a half-typed word |
| Esc | pause (Q quits to menu from there) |
| Shift+M | mute (outside a run only) |

Arrow keys / WASD fly the ship, which matters once enemies start shooting back
from wave 3.

## How the drill works

- **Targeting.** What you type matches against the *lowest* ship whose romaji
  still fits what you've typed — the most urgent one. Matching ships are
  highlighted, so you can see the lock before you finish the word.
- **The answer is never shown.** Once you start a word the buffer shows your
  progress and placeholders, never the remaining letters. Handing over the rest
  of the word after the first keystroke would defeat the point for `tsu`,
  `kya`, `sha` and friends.
- **Misses cost you.** A wrong key clears the buffer. A ship you fail to kill
  reveals its answer (`ま = ma`) and takes a life.
- **It remembers what you get wrong.** Per-kana hit/miss counts live in
  `localStorage`; kana you miss come back more often, kana you've never seen get
  spawned early. The game-over screen names your weak spots.

## Modes

Hiragana, Katakana, or Both. Both scripts share the romaji, so `じ` and `ジ` are
both `ji` — the same sound, different script.

## Contents

    index.html                 the whole game (data, logic, rendering)
    verify.mjs                 static checks — data integrity, DOM ids, syntax
    test-playwright.mjs        drives the real game in a real browser
    check-file-protocol.mjs    confirms it runs from file://
    shot-*.png                 screenshots produced by the test run

## Tests

    node verify.mjs                                    # no browser needed
    npm i -D playwright && npx playwright install chromium
    python3 -m http.server 8765 &                      # tests need the server
    node test-playwright.mjs

`verify.mjs` parses the module, runs the shipping kana tables and `buildPool`,
and checks every DOM id the game reaches for actually exists. `test-playwright.mjs`
plays the game: it types romaji, checks partial words don't fire, that the answer
isn't leaked, that escapes and bullets cost lives, that pause freezes the world,
and — most usefully — that **all 104 romaji are typeable**. That last one exists
because it caught a real bug: `m` was bound to the mute toggle, which silently
made ma/mi/mu/me/mo/mya/myu/myo impossible to answer.

## Coverage

104 kana per script: the 46 basic, 25 dakuten/handakuten, and 33 digraphs
(きゃ, しゃ, ちょ …). Not yet included: small tsu (っ — needs doubled consonants),
long vowel mark (ー), and the katakana-only extended set (ヴ, ファ …).
