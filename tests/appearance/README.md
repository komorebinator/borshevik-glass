# Appearance lab

How Borshevik Glass looks depends on the wallpaper under it, and a user can set any wallpaper and
keep it through both colour schemes. A tint that is right on one wallpaper can be grey, garish or
unreadable on another, so a colour of the extension is not judged on one screen but on a
collection. This lab models what the extension draws, measures it on every wallpaper of a
collection, and draws frames to flip through, so a look can be chosen by eye and checked by
number before any of it reaches the extension.

## Use

Runs on the host, like `tests/vm.sh`; needs `python3`, ImageMagick's `magick` and GNOME's Adwaita
Sans. What it makes from a collection — venv, blur cache, rasterised icons, frames — lives in
`${XDG_CACHE_HOME:-~/.cache}/borshevik-glass-appearance`; what it finds and keeps goes to `results/` here.

```sh
lab.sh setup                                    # venv (numpy, Pillow, SciPy), icons
lab.sh serve [--wallpapers DIR ...] [--collection NAME] [--port 8765] [--open]
lab.sh stop                                     # stop the server, its drawing processes with it
lab.sh measure [look] [--wallpapers DIR ...] [--collection NAME] [--all-accents] [--record]
lab.sh rounds                                   # the round in progress, if any
lab.sh results                                  # what results/ holds
lab.sh calibrate [wallpaper]                    # the model against GNOME in the test machine
```

A **collection** is the directories (searched recursively) and files given with `--wallpapers`; with
none, the system's wallpapers in `/usr/share/backgrounds` — GNOME's and the distribution's, JPEG XL
and SVG included (read through ImageMagick). `--collection` names it in results; by default the
directories' names, or `system`. The screen is `BORSHEVIK_GLASS_LOGICAL` in logical pixels,
by default 1728x1080 (2880x1800 at scale 5/3).

`serve` is the lab as a local web page (127.0.0.1 only): the frame on the left, on the right what
chooses it — a kept look or a round's variant, the dark or the light case, any of GNOME's nine
accents, the view (the desktop with a window under the panel, the overview, an open folder), the
rule wallpapers are picked by and which of them — with the frame's own measures beside it. Frames
are drawn on demand (~0.3 s) and cached, neighbours ahead of time. One frame at a time, in place:
number keys switch the variant, arrows the wallpaper, A S D the view, T the case, [ ] the accent —
by the key's place, so in any keyboard layout; Space held shows the reference in place of the frame,
same case, wallpaper, view and accent, until it is let go. That is the way a difference is seen;
side by side, at small size, none was. The page
can keep what is on screen as a look ("Отметить как хороший") and make a kept look the reference.

## What is kept where

Results are about **kinds of wallpaper, never about particular ones**: a wallpaper is described by
its classes — lightness `dark` (L* < 30) / `medium` / `light` (≥ 55), colour `muted` (chroma < 12) /
`moderate` / `colourful` (≥ 25), and `busy` when the strip under the panel spans ≥ 60 L* — measured on
the wallpaper as the glass sees it, blurred. What fails on dark wallpapers fails on anyone's dark
wallpapers; which file it was says nothing that carries over.

| what | where | how it is made |
|---|---|---|
| every look marked good — one case's, every parameter, where it came from, what was said | `results/looks/<name>.json` | the page's "keep", or `store.save`; never overwritten, removed only when the author says so |
| the reference, per case: a kept light look and a kept dark look, since when and why, and every reference before each | `results/reference.json` | the page's "make reference", or `store.set_reference` |
| the round in progress: variants compared, the variant chosen, the verdict | `looks.py` | written by hand while a round is held; cleared once it is decided, its outcome told here, in Results |
| the model's calibration against GNOME | `results/calibration.json` | `lab.sh calibrate` |
| a look measured on a collection, overall and per lightness class, with the look's parameters | `results/measures/<look>-<collection>.json` | `lab.sh measure <look> --record` |
| why it all came out as it did | this README, Results | written by hand |
| frames, picks, blur cache | the work directory | made again on demand; not kept |

A look liked once is not lost by accident: a kept look is a snapshot, so later edits of `looks.py`
do not touch it, and a reference replaced stays in `reference.json`'s history and in its own snapshot.
`looks.all_looks(case)` reads them: `shipped` (that case as the extension draws it, in `looks.py`),
every kept look of the case by name, and `reference`.

**The light and the dark case are separate.** A kept look is one case's; a round explores one case
(`case` in `looks.py`) and its variants are looks of that case; the reference is a pair of pointers,
a kept light look and a kept dark look, and making a look the reference moves its own case's pointer
only. So work on the dark case cannot touch the light one. They meet in the reference — `reference`
and `shipped` have both — and on the page: switching the case while a light look is on screen shows
the dark case's reference on the same wallpaper, so the desktop can still be seen whole both ways.

A round's wallpapers are not a list of files but a rule (`picks.RULES`: the darkest, the median,
the most colourful, where the reference reads worst…), so any comparison can be made again on any
collection; the page names wallpapers by class and numbers, never by file.

## Files

- `glass.py` — the model: a wallpaper read colour-managed into sRGB, placed as GNOME's `zoom`,
  blurred as Shell.BlurEffect, the tint and surfaces composed as the extension and its stylesheet
  do; the measures; the wallpaper classes.
- `render.py` — frames at the screen's full logical size, with GNOME's font and real app icons: the
  panel as Borshevik has it (the Workspace Manager, the clock, extensions' indicators, the input
  source, Quick Settings, where GNOME puts them), the app grid with folders, the dock.
- `apps.py` — the apps the frames show, free software only, each under its own name.
- `looks.py` — what the extension draws (`SHIPPED`; every key of a look explained) and the round in
  progress.
- `store.py` — kept looks and the reference, in `results/`.
- `picks.py` — the rules a collection's wallpapers are picked by.
- `server.py` — the page; `measure.py` — a look over a whole collection; `results.py` prints `results/`.
- `calibrate/` — what ties the model to GNOME: a blurred step and real screenshots from the shared
  test machine (`tests/vm.sh`), fitted and compared.
- `icons.sh` — rasterises the icons the frames use from the host (they are not ours to commit); an
  app whose icon the host lacks is left out.

## The model and how far to trust it

`results/calibration.json`, against GNOME Shell 50.6 in the test machine:

- Shell.BlurEffect at the extension's radius 30 is a Gaussian of **sigma 15** logical px (radius/2),
  computed in **sRGB** space with clamped edges: a fit to a blurred black-to-white step is exact
  (rms 0.14/255); a fit in linear light is not (rms 0.31/255).
- Clutter blends in sRGB space; GNOME 50 converts a wallpaper's embedded colour profile to sRGB, and
  so does the model.
- The model's glass against screenshots of the real one, both cases, on an sRGB wallpaper (the
  release's): **ΔE ≤ 0.65** — below what the eye can tell.
- Known limit: GNOME's own Adwaita wallpapers are wide-gamut (DCI-P3 primaries). GNOME appears to
  keep their out-of-sRGB colours until they are blended with the tint, where the model clips them
  first: on those the light case is off by ΔE ≈ 2 (the dark case ≤ 0.2).
- GNOME's geometry: panel 32 px, clock Adwaita Sans Bold 14.67 px, dash 669x100 at the bottom, an
  open folder's card 722x720.

Measures are taken at a quarter of the logical size (the glass is smooth there). Frames are not
screenshots: GNOME's widgets are stood in for by shapes of their size, so they are for colour,
depth and readability, not layout.

### Measures

Readability is WCAG's contrast ratio at the worst 1 % of the places text can lie — the panel's
strip (panel text), the overview's glass (app labels), the dock, an open folder's card — with
**4.5:1** as the floor for text of this size. Beside it: CIELAB lightness of the panel and the
overview, how much of the wallpaper's light and dark shows through, chroma, how far the dock and
the card stand out from what is around them (ΔE), and how visible the accent is.

## Results — 2026-11-04, the light reference chosen 2026-11-18

Measured on two collections (`lab.sh results`): **system**, the 60 wallpapers of
`/usr/share/backgrounds` (dark 16, medium 26, light 18; colourful 34), and a private one of 210 (dark
67, medium 106, light 37; colourful 32) on which the rounds were held. Accent purple unless said.

### The look shipped until 2026-11-19

What the extension drew before the lift (a tint over the blur); `looks.SHIPPED` now holds the
reference pair, which the extension draws since.


- **Dark case: fine on every kind of wallpaper.** Text never below 8.5:1 on either collection.
  Its one weak point: an open folder's card stands out from the veiled overview by only ΔE ≈ 5.
- **Light case: grey.** White at 0.45 over a dark or medium wallpaper gives mid grey (glass L* ≈ 63):
  text falls to 2.9:1, below 4.5:1 on every dark wallpaper of both collections, on most medium ones
  (105 of 106 private, 14 of 26 system) and on some light ones. A "dull panel or an overbright overview": next to white
  windows a light panel needs L* ≳ 85, and that depth across the whole overview is a white sheet.
- One constant depth cannot be light and see-through over a dark wallpaper: white over a dark
  picture is either grey or opaque. Depth chosen per wallpaper from its blurred statistics was
  modelled too; it only changes light wallpapers, where the problem is smallest.

### KDE, for reference

Plasma 6's Breeze Light (from KWin's and libplasma's sources): the blurred backdrop's saturation
×1.5 (KWin's blur default), a little noise, then the panel's #eff0f1 at opacity 0.85 with #232629
text. Saturation is what keeps KDE's light glass coloured rather than grey.

### Rounds

Their variants were cleared from `looks.py` once the light reference was chosen (2026-11-18); what
was liked is kept (below). In short, on the light case:
the panel liked saturated (r1); steps too small to see (r2); then, clearly different looks shown
large (r3), **C** — saturation ×3 and a quarter of the accent in the tint — chosen over a glass that
keeps the wallpaper's hue at a lifted lightness (D, like Acrylic's luminosity layer), and kept pure
against blends toward D (r4), with the dock, folder tiles and open folder drawn like the panel; C's
app labels read below 4.5:1 on dark and medium wallpapers, and every fix that changes what is
around them — halos, a lighter overview, backgrounds behind apps, pills, however faint (r5–r7) —
was liked less than the lower contrast, until **black labels** (r8). Seen again at last, D was liked
for its lightness and C for its tinted dock, folders and open folder: the final round (r9) put D's
glass under C's surfaces, with less of the accent in the open folder's card (0.25 down to 0.05),
and made that the reference. Without the wallpaper's hue in the glass (r10: the lift's chroma 0, or
half) the glass is one light grey on every wallpaper, tinged only by the accent: the hue stays. The
open folder's card then went up to 6 % of the accent (5 % too little, 7 % a touch too much). The Workspace Manager's inactive icons stay grey
(r11, 2026-11-19): coloured ones, glows, chips and outlines were drawn — a hard 1 px outline, and
St's `icon-shadow: 0 0 0 1px`, whose spread scales the silhouette up from its centre rather than
growing it, so a gear's notches go unoutlined — but the grey icons look fine on the overview and
only wash out on the lighter panel of the desktop: it is the panel that is to change. Of panels
from the reference's L\* 84 down to the overview's 72 — its own glass darker, or the overview's glass
under the dock's tint — the overview's own glass was liked best (r12): the panel on the desktop is
now drawn exactly as on the overview. Then the dark case (r13), the first round held on it: the
light reference's ideas carried into the dark — a lightness of the glass's own with the wallpaper's
hue, a quarter of the accent in the dock's surface — liked with half the wallpaper's hue: the dark
reference since 2026-11-19. The active workspace's button in the Workspace Manager got an
outline in the accent colour (r14 light, r15 dark): 1 px at 80 % over its translucent background
liked best in both, over fainter, thicker ones and an accent background — then taken down to
60 % on the author's own screen, where 80 % was too bright. Behind an open folder (r16 light, r17
dark, 2026-11-19), the overview blurred whole was set beside no blur (the grid showing through the
card, denser cards, darker veils), the blur under the card alone (`fold_blur='card'`) and the
baked glass alone under the card, the grid hidden there (`fold_blur='glass'`): the whole overview
blurred looked doubtful to the author, and the blur under the card alone was chosen — the
extension bakes it once as the folder opens (its guideline on static glass). `SHIPPED` draws it so;
the kept reference looks, kept as they were, still blur the whole overview. The dark case's card,
at half the light one's share of the accent (3 %), showed almost none of it: of 3, 6, 9, 12 and 16 %
with the blur under the card alone (r18, 2026-11-20), 9 % was chosen — kept as `dark-card-accent-9`,
the dark reference since.

### Tuned live (2026-11-20)

The frames and the measures stopped being the way colours are chosen: on the author's screen a panel
the model drew black came out olive (dark saturated colours clamped in sRGB light up), and the
measures did not predict what the author saw. The look was then tuned live in the author's session
(the workflow's judge_look), over some twenty of their wallpapers in both cases, and checked on
wallpapers the rules were not fitted on. The extension now adapts the glass to the wallpaper by
those rules (borshevik-glass@komorebinator/adapt.js): in the dark case the lightness falls with the
lightness under the panel and the colour kept follows the wallpaper's hue (blue least, purple and
magenta most); the light case keeps 80 and caps the colour; a band under the panel makes it denser
than the overview; a light accent tints the dark glass less. None of that is in the model:
`SHIPPED` is the look before it.

### Kept looks and the reference

Kept (`results/looks/`), light: `c-black-labels` (C, the light reference 2026-11-04 to 2026-11-18),
`lift-pastel` (D), `pastel-c-surfaces` — the two combined, the light reference on 2026-11-18 — and
`pastel-c-surfaces-card-7` and `pastel-c-surfaces-card-6`, the same with 7 % and 6 % of the accent
in the open folder's card — the 6 % one the light reference on 2026-11-19 — and
`pastel-panel-as-overview`, the 6 % one with the panel drawn as on the overview, the light reference
since 2026-11-19; dark:
`shipped-2026-11-04-dark`, the dark case as shipped — the dark reference until 2026-11-19 — and
`dark-pastel`, the dark reference that day, and `dark-pastel-half-accent`, the same with half the
accent, the dark reference since (`results/reference.json`). The other looks kept on the way
(`c`, `r1-favourites`, the light case as shipped) were removed at the author's word on 2026-11-18.

### The reference light look (`pastel-panel-as-overview`)

D's glass under C's surfaces, with less of the accent in the open folder's card (`card_accent` 0.06),
and one glass for the panel and the overview:

- the glass is the blurred wallpaper lifted, not tinted (`glass.lift`, Acrylic's luminosity idea):
  CIELAB lightness L\* = target + gain·(L\* − 50) keeps the wallpaper's hue — target 80, gain 0.3,
  chroma as is — with 8 % of the accent laid over it; the panel on the desktop is the same glass as
  the overview, not a lighter one of its own: the Workspace Manager's grey icons washed out on that;
- the dock, folder tiles in the grid and an open folder's card: C's surfaces — #fafafb with 25 % of
  the accent at ≈ 0.556 (the alpha that brings C's overview depth 0.55 to its panel's 0.8), hairlines
  rgba(34, 34, 38, 0.12) on the dock and folder tiles — except the open folder's card, which takes
  only 6 % of the accent;
- the veil behind an open folder 0.2 (shipped 0.1);
- text #222226, the app labels too: black is not needed on a glass this light.

On both collections (`results/measures/reference-*.json`): every text at least **5.52:1** (the app
labels and the panel's text; the dock 7.99:1, an open folder 8.22:1), none below 4.5:1 on any kind of
wallpaper; over GNOME's nine accents the worst is 5.50:1 (red) to 5.80:1 (yellow). The glass: the
panel's and the overview's L\* 73 (median; 63–91 over both collections), chroma 16 on the private
collection and 26 on the system one — paler than C's 21, as liked. Next to white windows the panel
is now a light grey-tinted glass rather than near-white: what the "dull panel"
finding (the look as shipped, above) warned of, chosen knowingly for the icons.

### The reference dark look (`dark-pastel-half-accent`, its card at 9 % since as `dark-card-accent-9`)

The light reference turned dark (r13's 6):

- the glass lifted the same way to a lightness of its own: target 12, gain 0.3, **half** the
  wallpaper's chroma — at full chroma the deep colours were too much — with 4 % of the accent over
  it; the panel the same glass as the overview, as it already was in the dark;
- the dock and folder tiles: the shipped grey surface (100, 100, 100 at 0.35) with an eighth of the
  accent; an open folder's card: the shipped #14161a at 0.85 with 3 % of the accent; no hairlines,
  which do not show on a dark glass; the veil 0.3 as shipped;
- the accent at half the light case's shares: r13 chose the light case's 8 / 25 / 6 %, which on the
  author's own screen were too colourful — the accent slider at 50 % looked right, and was made the
  default (2026-11-19);
- text #fafafb.

On both collections: every text at least **9.81:1** (the panel and the app labels; the dock 8.14:1,
an open folder 16.46:1); over GNOME's nine accents the worst is 7.75:1 (yellow) to 8.20:1 (red).
The glass: L\* 9–11 (median; 1–26), as dark as shipped (10), chroma 8.5 on the private collection
and 18 on the system one — the wallpaper's hue, at half its chroma, where the shipped near-black
tint smothered it. An open folder's card stands out from the veiled overview by ΔE 7–8 (median)
where shipped had 5, its one weak point.

### The light reference before (`c-black-labels`, 2026-11-04 to 2026-11-18)

C with black labels:

- the blurred wallpaper's saturation ×3;
- the tint: #fafafb with 25 % of the accent (shipped: 10 %);
- overview depth 0.55, panel depth 0.8 on the desktop — the panel and the overview no longer share
  a depth;
- the dock, folder tiles in the grid and an open folder's card: the tint at the alpha that brings
  the overview's 0.55 to the panel's 0.8 (≈ 0.556), so they look like the panel; hairlines
  rgba(34, 34, 38, 0.12) on the dock and folder tiles;
- the veil behind an open folder 0.2 (shipped 0.1);
- the overview's app labels #000 instead of #222226.

On both collections (`results/measures/reference-*.json`): every text at least **4.47:1** — the
floor is set by the darkest parts of dark wallpapers, the same on any collection — with app labels
a hair below 4.5:1 on some dark and medium wallpapers (7 and 3 of the private 210, 3 and 1 of the
system 60) and none on light ones; panel text, the dock and an open folder far above. Over GNOME's
nine accents the worst light-case text is 4.46:1 (red) to 4.93:1 (yellow) (measured 2026-11-04;
`results/measures/` now holds the reference after it).

### The lift in GNOME (test machine, GNOME Shell 50, 2026-11-19)

Tried by hand through Eval, not yet in the extension: a `Shell.GLSLEffect` whose fragment snippet is
`glass.lift` line for line (sRGB → CIELAB with the same constants, L\* = target + gain·(L\* − 50),
chroma scaled, back with each linear channel clamped), on an actor wrapping each glass's blurred
`Meta.BackgroundGroup`, so it acts on the blur's result. On f44-01-day at 1280×800, target 80, gain
0.3, the real glass matches the model within **ΔE 0.30** at eight places on the panel and the
overview — closer than the blur's own calibration (0.65).

Cost: the effect caches what is under it, but its shader runs again on every frame the glass is
painted from that cache — each frame of the overview's animations. Wrapped once more in an actor
with `offscreen_redirect` ALWAYS, the lifted glass itself is cached: the shader then runs only when
the glass is rendered again — once each time the overview opens (as the blur is) and never while
the desktop is idle (0 paints in 10 s) — and every other frame is a plain copy of the cache, as
before. The match stays ΔE ≤ 0.13 on the panel with the cache.

But GNOME hides the overview's group whenever the overview is closed, and an actor shown again is
rendered again, effects and all: so the blur (already, as shipped) and the lift run each time the
overview opens, and again whenever a hidden glass comes back. Neither depends on anything that
changes then. Baked instead (same day): a do-nothing `Clutter.OffscreenEffect` around the lifted
glass renders it into the effect's texture as it is painted; after one frame that texture
(`get_texture()`, 1283×803 for a 1280×800 glass — the effect's margin) is kept as a
`Clutter.TextureContent`, shown by plain actors on every glass, and the effect and the blurred,
lifted sources are destroyed — the texture lives on. Then opening and closing the overview and the
app grid runs **no shader and renders nothing again**, and the glass still matches the model within
ΔE 0.36, its edges and corners included. Drawing an actor straight into a texture of one's own is
not open to JavaScript (`Clutter.PaintContext.new_for_framebuffer` is not introspected), hence the
effect. Blur my Shell, for comparison, hangs its blur (`Shell.BlurEffect`, ACTOR mode) and its
shader effects (`Clutter.ShaderEffect`, a luminosity one among them) on the background group itself:
rendered again on every showing, its shaders on every frame.

### Rejected, and why

- Raising the overview's depth for readability (0.58–0.62): it greys out the colour C is chosen for.
- Light halos (`text-shadow`), backgrounds behind every app, pills under labels, however faint:
  they read, but are liked less than slightly lower contrast.
- Grey Workspace Manager icons on a light panel, darkened or compressed into a dark band, and grey
  drop shadows under coloured ones.
- Depth adapted per wallpaper: little gain for a mechanism of its own.

### Not settled

- The Workspace Manager's `experimental` (5fa8d5b) darkened the grey icons in the light variant
  (brightness −0.4), a treatment the author found bad; with the panel now the overview's glass the
  icons stay plain grey (r11, r12), and the commit is reverted on that branch (not yet pushed).
