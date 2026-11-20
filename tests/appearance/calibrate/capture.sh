#!/usr/bin/env bash
# Takes from the shared test machine (../../vm.sh, started) what the model is calibrated against:
# the blur of a black-to-white step with the tint off, GNOME's geometry, and the glass as shipped on
# a real wallpaper in both cases — then fits, compares, and records the result in
# ../results/calibration.json. Runs on the host; leaves the extension's settings at their defaults
# and the scheme dark.
#   capture.sh [wallpaper]   (default: the release's day wallpaper, an sRGB one; GNOME's own Adwaita
#                            wallpapers are wide-gamut and match less closely — see README)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vm="$here/../../vm.sh"
work="${XDG_CACHE_HOME:-$HOME/.cache}/borshevik-glass-appearance/calibrate"
py="${XDG_CACHE_HOME:-$HOME/.cache}/borshevik-glass-appearance/venv/bin/python"
wall="${1:-$(ls /usr/share/backgrounds/*/default/*day* 2>/dev/null | head -1)}"
wall="${wall:-/usr/share/backgrounds/gnome/adwaita-l.jxl}"
results="$here/../results/calibration.json"
mkdir -p "$work"
dc() { "$vm" ssh "uid=\$(id -u tester); runuser -u tester -- env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$uid/bus dconf $*" 2>/dev/null; }
gs() { "$vm" ssh "uid=\$(id -u tester); runuser -u tester -- env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$uid/bus gsettings $*" 2>/dev/null; }
overview() { "$vm" eval "Main.overview.$1(); 'ok'" >/dev/null; sleep 2; }

"$vm" eval 'Main.overview.hide(); global.get_window_actors().forEach(a => a.meta_window.minimize()); "ok"' >/dev/null
size=$("$vm" eval 'global.stage.width + "x" + global.stage.height')

# 1. the blur: a step, the tint off
"$py" "$here/edge.py" "$work/edge.png" "$size"
"$vm" scheme dark >/dev/null
"$vm" wallpaper "$work/edge.png" >/dev/null
dc write /org/gnome/shell/extensions/borshevik-glass/dark-depth 0
dc write /org/gnome/shell/extensions/borshevik-glass/accent-tint false
sleep 3; overview show
"$vm" shot "$work/edge-overview.png" >/dev/null
overview hide
dc reset -f /org/gnome/shell/extensions/borshevik-glass/
fit=$("$py" "$here/fit.py" "$work/edge-overview.png")

# 2. GNOME's geometry, on the app grid with a folder open
overview show
"$vm" eval 'Main.overview.dash.showAppsButton.checked = true' >/dev/null; sleep 1.5
"$vm" eval 'Main.overview._overview.controls._appDisplay._folderIcons?.[0]?.open() ?? "none"' >/dev/null; sleep 1.5
geometry=$("$vm" eval "$here/geometry.js")
echo "geometry: $geometry"
"$vm" eval 'Main.layoutManager.overviewGroup.get_children().filter(c => c._isOpen).forEach(c => c.popdown()); "ok"' >/dev/null
overview hide

# 3. the glass as shipped on a real wallpaper, against the model
# a name of its own each time: GNOME does not reload a wallpaper whose URI stays the same
copy="$work/wallpaper-$(date +%s)-$(basename "$wall")"
rm -f "$work"/wallpaper-*
cp "$wall" "$copy"
"$vm" wallpaper "$copy" >/dev/null
gs set org.gnome.desktop.interface accent-color purple
for s in dark light; do
    "$vm" scheme "$s" >/dev/null; sleep 3
    "$vm" shot "$work/real-$s-desk.png" >/dev/null
    overview show
    "$vm" eval 'Main.overview.dash.showAppsButton.checked = true' >/dev/null; sleep 1.5
    "$vm" shot "$work/real-$s-grid.png" >/dev/null
    overview hide
done
"$vm" scheme dark >/dev/null
gs reset org.gnome.desktop.interface accent-color
compare=$("$py" "$here/compare.py" "$copy" "$work" purple)
shell=$("$vm" ssh 'gnome-shell --version' 2>/dev/null | tr -d '\r')
"$py" - "$results" "$fit" "$geometry" "$compare" "$shell" "$(basename "$wall")" "$size" <<'PY'
import datetime, json, os, sys
out, fit, geom, comp, shell, wall, size = sys.argv[1:]
res = {'date': datetime.date.today().isoformat(), 'gnome_shell': shell, 'screen': size,
       'blur': {'extension_radius': 30, **json.loads(fit)}, 'geometry': json.loads(geom),
       'model_vs_screenshots': {'wallpaper': wall, 'accent': 'purple', **json.loads(comp)}}
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(res, open(out, 'w'), indent=1)
print('recorded', out)
PY
