# SPDX-License-Identifier: GPL-2.0-or-later
"""Looks — sets of the parameters Borshevik Glass draws with — and the round in progress.

The looks kept as good and the reference are not here but in results/ (store.py); this holds
SHIPPED — what the extension draws — and the round being held, if any. Rounds already held are
told in README.md's results; what was liked in them is kept in results/looks/.

A look is one case's: the light and the dark case are separate looks, met only in the reference
(store.py) and in the extension. SHIPPED holds both, as the extension draws them. A look's keys:
  base, depth, accent      the tint: base colour, opacity over the blur, share of GNOME's accent mixed in
  panel_depth, panel_sat   the panel's own depth and saturation on the desktop (default: the overview's)
  panel_like_dock          the panel on the desktop drawn as the dock: the overview's glass under the dock's surface
                           (panel_dock_alpha, panel_dock_accent: that surface's alpha and share of the accent)
  sat                      the blurred wallpaper's saturation, KWin's matrix (1 = as is)
  text, label_color        the panel's text colour; the overview's app labels (default: text)
  label_weight             the labels' weight in Adwaita Sans (default Regular)
  surface, dock, tile      translucent surfaces on the glass (r, g, b, alpha); surface_accent mixes in the accent
  surfaces_like_panel      dock, folder tiles and the open folder's card drawn as the tint at the alpha
                           that brings the overview's depth to the panel's
  card, card_share         the open folder's card (r, g, b, alpha), and its share of the tint's accent
                           (with surfaces_like_panel: card_accent, the card's own share of the accent)
  veil                     what GNOME's black veil behind an open folder becomes (r, g, b, alpha)
  fold_blur, card_alpha    whether the overview behind an open folder is blurred (default True; 'card':
                           only what lies under the card; 'glass': under the card the glass alone, the grid
                           hidden there); the card's alpha in place of its own
  dash_border, tile_border hairlines (r, g, b, alpha 0..255)
  lift, panel_lift, lift_accent    glass.lift's (target, gain, chroma) instead of tint over blur
  toward                   (other case dict, t): this case blended t of the way to the other
  bwm_*                    the Workspace Manager's inactive icons: desaturate, opacity, brightness and
                           contrast (Clutter's effects), shadow (offset, blur, alpha, rgb, own colour, spread), chip
                           outline (width px, rgb, alpha) — hard, unblurred — and outline_active (default
                           True: the active workspace's icons outlined too)
                           active_outline (width px, rgb or 'accent', alpha): an inset outline of the active
                           workspace's pill; active_fill (alpha): its fill in the accent instead of the text colour
  label_halo, soft_pill, label_pill, app_tile, app_tile_border   ways tried to make labels readable
"""

# What the extension and its stylesheets draw on `experimental` as of 2026-11-19: the
# reference pair (results/reference.json) — pastel-panel-as-overview and dark-card-accent-9, with
# the blur behind an open folder under its card alone (README.md, rounds r16 to r18). The light
# case's surfaces are its tint at the alpha that brings depth 0.55 to panel_depth 0.8 (≈ 0.556),
# the alpha accent.css writes; depth and panel_depth stand for nothing else here, the glass
# being lifted.
# Since 2026-11-20 the extension adapts the glass to each wallpaper (adapt.js), which this model does
# not do: SHIPPED is the look that adaptation started from.
SHIPPED = {
    'dark': dict(base=(0, 3, 4), depth=0.80, accent=0.10, text=(250, 250, 251),
                 surface=(100, 100, 100, 0.35), surface_accent=0.125,
                 card=(20, 22, 26, 0.85), card_share=0.35, card_accent=0.09,
                 veil=(0, 3, 4, 0.30), lift=(12, 0.3, 0.5), lift_accent=0.04, fold_blur='card'),
    'light': dict(base=(250, 250, 251), depth=0.55, panel_depth=0.8, accent=0.25, text=(34, 34, 38),
                  surface=(255, 255, 255, 0.50), surfaces_like_panel=True,
                  card=(250, 250, 251, 0.60), card_share=0.5, card_accent=0.06,
                  dash_border=(34, 34, 38, 30), tile_border=(34, 34, 38, 30),
                  veil=(0, 3, 4, 0.20), lift=(80, 0.3, 1.0), lift_accent=0.08, fold_blur='card'),
}


def all_looks(case):
    """Every look of one case by name: 'shipped' (that case as the extension draws it), each kept look
    of the case (store.py), and 'reference' — the case's reference. Read afresh each time: the server
    keeps adding to them. The cases are separate: a look is always one case's."""
    import store
    out = {'shipped': SHIPPED[case]}
    out.update({n: store.tuples(d['look']) for n, d in store.snapshots(case).items()})
    ref = store.reference_look(case)
    if ref:
        out['reference'] = ref
    return out


# The lookbook round in progress, if any: looks compared side by side, drawn on the page. A round
# explores one case — case='light' or 'dark' — and its variants are looks of that case only: each
# key -> (label, the look). walls names the rule its wallpapers are picked by from whatever
# collection it is drawn on (picks.RULES); chosen is the variant the author picked (None: none),
# verdict what they said. A round is working material: once it is decided, what was liked is kept
# (store.py), the outcome is told in README.md's results, and the round is cleared from here.
ROUNDS = {}
