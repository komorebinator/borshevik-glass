# SPDX-License-Identifier: GPL-2.0-or-later
"""Prints what results/ holds (or, with `rounds`, the round in progress): the model's calibration against GNOME, and every recorded measure
of a look on a collection — by wallpaper class, never by wallpaper."""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEXT = ('panel_text', 'grid_text', 'dock_text', 'card_text')

if sys.argv[1:] == ['rounds']:
    import looks
    import picks
    if not looks.ROUNDS:
        print('no round in progress; the rounds held are told in README.md, Results')
    for k, v in looks.ROUNDS.items():
        chosen = v['variants'][v['chosen']][0] if v['chosen'] else 'none'
        print(f"{k:12s} {v['title']} — {len(v['variants'])} variants, wallpapers: {picks.RULES[v['walls']]}")
        print(f"{'':13s}chosen: {chosen}. {v['verdict']}")
    sys.exit()

cal = os.path.join(HERE, 'results', 'calibration.json')
if os.path.exists(cal):
    c = json.load(open(cal))
    b, m = c['blur'], c['model_vs_screenshots']
    print(f"calibration {c['date']}, {c['gnome_shell']}, {c['screen']}: blur radius {b['extension_radius']} = "
          f"sigma {b['srgb_sigma']} px in sRGB (rms {b['srgb_rms']}/255; linear light fits worse, rms {b['linear_rms']}); "
          f"model vs GNOME worst ΔE {m['worst_de']}")
for f in sorted(glob.glob(os.path.join(HERE, 'results', 'measures', '*.json'))):
    r = json.load(open(f))
    comp = r['composition']
    print(f"\n{r['look']} on {r['collection']} ({r['date']}, accent {r['accent']}): {comp['wallpapers']} wallpapers — "
          f"dark {comp['dark']}, medium {comp['medium']}, light {comp['light']}; muted {comp['muted']}, colourful {comp['colourful']}, busy {comp['busy']}")
    for case, res in r['cases'].items():
        a = res['all']
        worst = min(a[k]['min'] for k in TEXT)
        below = max(a[k]['below_4_5'] for k in TEXT)
        print(f"  {case:5s} text worst {worst:.2f}:1, below 4.5:1 on {below}; panel L* {a['L_panel']['median']:.0f}, overview L* {a['L_overview']['median']:.0f}, chroma {a['chroma']['median']:.0f}")
        for cls, s in res['by_lightness'].items():
            print(f"        {cls:7s} worst {min(s[k]['min'] for k in TEXT):.2f}:1, below 4.5:1 on {max(s[k]['below_4_5'] for k in TEXT)}")
    if 'accents' in r:
        w = r['accents']
        print('  accents, worst text: ' + ', '.join(f"{k} " + '/'.join(f'{x:.2f}' for x in v.values()) for k, v in w.items()))
