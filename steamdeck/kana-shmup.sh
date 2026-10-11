#!/usr/bin/env bash
# Launches Kana Shmup fullscreen in a kiosk-mode browser. Add this file to
# Steam as a Non-Steam Game to play it from Game Mode / Big Picture.
#
# Overrides (set in Steam's launch options as `VAR=value %command%`):
#   KANA_URL      play a hosted copy instead of the local index.html
#   KANA_BROWSER  force a browser: a Flatpak app id or a command name
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
game_dir="$(dirname "$here")"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/kana-shmup"
mkdir -p "$data_dir"

# touch=1: the Deck's browser reports a fine pointer (trackpads), so the game
# wouldn't otherwise show its on-screen keyboard.
url="${KANA_URL:-file://${game_dir// /%20}/index.html?touch=1}"

# A dedicated profile keeps saved progress separate from normal browsing, and
# guarantees a fresh browser process — otherwise Chrome hands the URL to an
# already-running instance and exits, and Steam thinks the game quit.
chrome_args=(
  --kiosk --start-fullscreen
  "--user-data-dir=$data_dir/chrome-profile"
  --no-first-run --no-default-browser-check --password-store=basic
  --disable-features=Translate,TranslateUI --disable-translate
  --overscroll-history-navigation=0 --disable-pinch
  --autoplay-policy=no-user-gesture-required
  "$url"
)
firefox_args=(--kiosk --no-remote --profile "$data_dir/firefox-profile" "$url")
mkdir -p "$data_dir/firefox-profile"

chromium_flatpaks=(com.google.Chrome org.chromium.Chromium com.brave.Browser com.microsoft.Edge)
chromium_cmds=(google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge)

has_flatpak() { command -v flatpak >/dev/null && flatpak info "$1" >/dev/null 2>&1; }

run_flatpak() {
  local id=$1; shift
  # Flatpak browsers are sandboxed: grant read access to the game and write
  # access to the profile directory for this run only.
  exec flatpak run --filesystem="$game_dir:ro" --filesystem="$data_dir" "$id" "$@"
}

launch() {
  local b=$1
  case "$b" in
    org.mozilla.firefox) has_flatpak "$b" && run_flatpak "$b" "${firefox_args[@]}" ;;
    firefox)             command -v "$b" >/dev/null && exec "$b" "${firefox_args[@]}" ;;
    *.*)                 has_flatpak "$b" && run_flatpak "$b" "${chrome_args[@]}" ;;
    *)                   command -v "$b" >/dev/null && exec "$b" "${chrome_args[@]}" ;;
  esac
  return 1
}

if [[ -n "${KANA_BROWSER:-}" ]]; then
  launch "$KANA_BROWSER" || { echo "kana-shmup: KANA_BROWSER=$KANA_BROWSER not found" >&2; exit 1; }
fi

# Chromium-family first: better WebGL performance on the Deck than Firefox.
for b in "${chromium_flatpaks[@]}" "${chromium_cmds[@]}" org.mozilla.firefox firefox; do
  launch "$b" || true
done

msg="No supported browser found. Install Google Chrome from Discover (Flathub), then try again."
echo "kana-shmup: $msg" >&2
command -v zenity >/dev/null && zenity --error --title="Kana Shmup" --text="$msg" 2>/dev/null || true
exit 1
