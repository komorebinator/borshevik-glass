#!/usr/bin/env bash
# Rasterises the app and symbolic icons the frames are drawn with into the work directory, from what
# the host has installed (its own apps and Flatpak exports). App icons are not ours to commit; an app
# whose icon the host lacks is left out of the frames. The apps are free software only.
set -euo pipefail
out="${XDG_CACHE_HOME:-$HOME/.cache}/borshevik-glass-appearance/icons"
rm -rf "$out"; mkdir -p "$out"
dirs=(/usr/share/icons/hicolor /var/lib/flatpak/exports/share/icons/hicolor "$HOME/.local/share/flatpak/exports/share/icons/hicolor")
S=/usr/share/icons/Adwaita/symbolic
raster() { magick -background none -density 384 "$1" -resize "$2" "$3" 2>/dev/null; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# the app ids render.py draws, one per line
apps=$(cd "$here" && "${PY:-python3}" -c 'import apps; print("\n".join(apps.ALL))')
found=0
for n in $apps; do
    f=$(for d in "${dirs[@]}"; do ls "$d"/scalable/apps/$n.svg "$d"/*/apps/$n.png 2>/dev/null; done | sort -V | tail -1 || true)
    if [[ -n $f ]] && raster "$f" 128x128 "$out/$n.png"; then found=$((found + 1)); else echo "  no icon for $n" >&2; fi
done
for n in network-vpn-symbolic face-cool-symbolic color-select-symbolic camera-web-symbolic edit-paste-symbolic \
         accessories-dictionary-symbolic network-wired-symbolic audio-volume-high-symbolic \
         battery-level-80-symbolic system-shutdown-symbolic; do
    f=$(ls "$S"/*/$n.svg 2>/dev/null | head -1)
    [[ -n $f ]] && raster "$f" 64x64 "$out/sym-$n.png"
done
echo "  $found app icons, $(ls "$out"/sym-*.png | wc -l) symbolic"
