# Kana Shmup — かなシューティング

A small Three.js shmup for drilling hiragana and katakana. Up to three ships
drift down at once, each carrying a kana; **you destroy one by typing its
romaji.** Let a ship reach the bottom and you lose a life.

## Running it

Open `index.html` in a browser. That's it — it's a single self-contained file
and works straight from `file://` (double-click it). It does need an internet
connection the first time, because Three.js and the Japanese webfont come from a
CDN.

Prefer a local server? Anything works:

    python3 -m http.server 8765     # then open http://localhost:8765/
    node server.mjs                 # or the dependency-free Node server, :8080

## Controls

| Key | |
|---|---|
| letters | type the target's romaji |
| Backspace | clear a half-typed word |
| Esc | pause (Q quits to menu from there) |
| Shift+M | mute (outside a run only) |

Arrow keys / WASD fly the ship, which matters once enemies start shooting back
from wave 3.

### Touch / mobile

On a touch device (anything with a coarse pointer — phones, tablets) the
keyboard controls above are replaced automatically, no setting to flip:

- **Typing** — an on-screen QWERTY panel docks at the bottom once a run
  starts. It drives the exact same targeting/miss logic as a physical
  keyboard, including Backspace.
- **Movement** — drag a finger anywhere on the play field (the area above the
  keyboard) and the ship follows the motion.
- **Pause** — there's no Esc on a phone, so a small pause button sits at the
  top of the on-screen keyboard. The pause screen has a "Quit to menu" button
  for the same reason (that button also now works for mouse/desktop users,
  who previously had no clickable way to quit — only the `Q` key).

The canvas is sized to the space above the keyboard, so gameplay and typing
never overlap.

## How the drill works

- **At most three on screen.** Enough to force picking a target, never enough
  to turn into clutter. A kill or an escape opens a slot and the next ship
  appears right away. Waves ramp difficulty by making ships fall faster and
  (from wave 3) shoot at you, never by raising the cap further.
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

## Difficulty

A slider on the title screen caps how much of the kana table is in play. The
tables are laid out in difficulty order, so each level is a prefix of the
next — nothing you've unlocked disappears as you go up:

| Level | Adds | Pool size (per script) |
|---|---|---|
| 1 — Basic | the 46 plain kana (あ, か, さ … no diacritics) | 46 |
| 2 — + Tenten | the 25 dakuten/handakuten (゛゜ — が, ざ, だ, ば, ぱ rows) | 71 |
| 3 — + Combined | the 33 digraphs (きゃ, しゃ, ちょ …) | 104 |

Defaults to 3 (the full table), so existing behavior and save data are
unaffected if you never touch the slider.

## Contents

    index.html                 the whole game (data, logic, rendering)
    server.mjs                 dependency-free static file server (Node)
    verify.mjs                 static checks — data integrity, DOM ids, syntax
    test-playwright.mjs        drives the real game in a real (desktop) browser
    test-mobile.mjs            same, under touch emulation — on-screen keyboard,
                                drag-to-move, pause/quit buttons
    check-file-protocol.mjs    confirms it runs from file://
    shot-*.png                 screenshots produced by the test run

## Tests

    node verify.mjs                                    # no browser needed
    npm i -D playwright && npx playwright install chromium
    python3 -m http.server 8765 &                      # tests need the server
    node test-playwright.mjs
    node test-mobile.mjs

`verify.mjs` parses the module, runs the shipping kana tables, `buildPool`, and
the difficulty cutoffs, and checks every DOM id the game reaches for actually
exists. `test-playwright.mjs` plays the game on desktop: it types romaji,
checks partial words don't fire, that the answer isn't leaked, that escapes
and bullets cost lives, that pause freezes the world, that the difficulty
slider actually changes the pool, and — most usefully — that **all 104 romaji
are typeable**. That last one exists because it caught a real bug: `m` was
bound to the mute toggle, which silently made ma/mi/mu/me/mo/mya/myu/myo
impossible to answer. `test-mobile.mjs` runs the same game under touch
emulation and drives the on-screen keyboard and drag gestures directly.

## Coverage

104 kana per script: the 46 basic, 25 dakuten/handakuten, and 33 digraphs
(きゃ, しゃ, ちょ …) — see [Difficulty](#difficulty) for how these are staged.
Not yet included: small tsu (っ — needs doubled consonants), long vowel mark
(ー), and the katakana-only extended set (ヴ, ファ …).
