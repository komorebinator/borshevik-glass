#!/usr/bin/env bash
# The appearance lab: Borshevik Glass's look modelled on a wallpaper collection. See README.md.
# Runs on the host (needs python3, magick and GNOME's Adwaita Sans); keeps its venv, blur cache,
# icons and output in ${XDG_CACHE_HOME:-~/.cache}/borshevik-glass-appearance.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${XDG_CACHE_HOME:-$HOME/.cache}/borshevik-glass-appearance"
py="$work/venv/bin/python"

usage() {
    cat >&2 <<USAGE
usage: $0 setup                 make the venv and rasterise the icons
       $0 measure [look] [--wallpapers DIR...] [--collection NAME] [--all-accents] [--record]
                                measure a look (looks.LOOKS, default reference) over a collection
       $0 serve [--wallpapers DIR...] [--collection NAME] [--port 8765] [--open]
                                the lab as a local web page: looks, rounds, both cases, any accent
       $0 stop                  stop a server started with serve
       $0 rounds                the rounds held, with what was chosen and why
       $0 results               the recorded results: calibration and measures
       $0 calibrate [wallpaper] check the model against GNOME in the running test machine, record it
A collection is the given directories (searched recursively) and files; without --wallpapers, the
system's wallpapers (/usr/share/backgrounds). The screen: BORSHEVIK_GLASS_LOGICAL=WxH logical
pixels (default 1728x1080).
USAGE
    exit 2
}

need_venv() { [[ -x $py ]] || { echo "no venv; run $0 setup first" >&2; exit 1; }; }

case "${1:-}" in
    setup)
        mkdir -p "$work"
        [[ -x $py ]] || python3 -m venv "$work/venv"
        "$work/venv/bin/pip" install -q -r "$here/requirements.txt"
        "$here/icons.sh" ;;
    measure)  shift; need_venv; cd "$here" && "$py" measure.py "$@" ;;
    serve)    shift; need_venv; cd "$here" && exec "$py" server.py "$@" ;;
    stop)     pkill -TERM -f "[v]env/bin/python server.py" || echo "no server running" ;;
    rounds)   need_venv; cd "$here" && "$py" results.py rounds ;;
    results)  need_venv; cd "$here" && "$py" results.py ;;
    calibrate) shift; need_venv; "$here/calibrate/capture.sh" "$@" ;;
    *) usage ;;
esac
