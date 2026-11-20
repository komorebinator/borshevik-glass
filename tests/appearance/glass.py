# SPDX-License-Identifier: GPL-2.0-or-later
"""Borshevik Glass, modelled: what the extension draws over a wallpaper, and measures of it.

The model is calibrated against GNOME Shell 50 in the test machine (calibrate/): Shell.BlurEffect
with radius 30 is a Gaussian of sigma 15 logical px, computed in sRGB space with clamped edges, and
Clutter blends in sRGB space; simulated glass matches screenshots of the real one within ΔE 0.6.
Measures are taken at a quarter of the logical screen (blur sigma 3.75 there): the glass is smooth
at that scale, so nothing a measure looks at is lost. render.py draws full-size frames to look at.

A look is a dict per case ('dark', 'light') — see looks.py for the keys and the named looks.
"""
import glob
import hashlib
import os
import subprocess

import io

import numpy as np
from PIL import Image, ImageCms
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(os.environ.get('XDG_CACHE_HOME', os.path.expanduser('~/.cache')), 'borshevik-glass-appearance')
CACHE = os.path.join(WORK, 'cache')

# The author's screen: 2880x1800 at scale 5/3. Override with BORSHEVIK_GLASS_LOGICAL=WxH.
LOGICAL = tuple(int(v) for v in os.environ.get('BORSHEVIK_GLASS_LOGICAL', '1728x1080').split('x'))
F = 4
W, H = LOGICAL[0] // F, LOGICAL[1] // F
SIGMA = 15 / F

# GNOME 50's geometry in logical px, measured in the test machine (calibrate/geometry.js);
# centred items re-centred for the screen's width.
PANEL_H = 32
DASH = (LOGICAL[0] // 2 - 335, LOGICAL[1] - 92, 669, 84)          # x, y, w, h of the dash's background
CARD = (LOGICAL[0] // 2 - 361, 56, 722, 720)                       # an open folder's card
PANEL = slice(0, PANEL_H // F)

# GNOME's accent colours (St's -st-accent-color for each org.gnome.desktop.interface accent-color)
ACCENTS = {
    'blue': (0x35, 0x84, 0xe4), 'teal': (0x21, 0x90, 0xa4), 'green': (0x3a, 0x94, 0x4a),
    'yellow': (0xc8, 0x88, 0x00), 'orange': (0xed, 0x5b, 0x00), 'red': (0xe6, 0x2d, 0x42),
    'pink': (0xd5, 0x61, 0x99), 'purple': (0x91, 0x41, 0xac), 'slate': (0x6f, 0x83, 0x96),
}


# Bumped whenever reading or blurring a wallpaper changes, so cached blurs are made again
# (2: embedded colour profiles converted to sRGB).
MODEL = 2

# The system's wallpapers — GNOME's, the distribution's — unless a collection is given.
SYSTEM_WALLPAPERS = ['/usr/share/backgrounds']
IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'webp', 'jxl', 'svg', 'svgz', 'avif', 'heic', 'bmp', 'tif', 'tiff'}
# what Pillow cannot read is decoded once by ImageMagick into the cache
MAGICK_EXTS = {'jxl', 'svg', 'svgz', 'avif', 'heic'}


def wallpapers(paths=None):
    """The collection: image files in the given directories (searched recursively) and files;
    the system's wallpapers when none are given."""
    files = []
    for part in paths or SYSTEM_WALLPAPERS:
        part = os.path.expanduser(part)
        if os.path.isdir(part):
            files += [f for f in glob.glob(os.path.join(part, '**', '*'), recursive=True)
                      if os.path.isfile(f) and f.rsplit('.', 1)[-1].lower() in IMAGE_EXTS]
        elif os.path.isfile(part):
            files.append(part)
    return sorted(set(os.path.realpath(f) for f in files))


def describe(paths):
    """A collection named by what it is, not by its files: the directories given, or 'system'."""
    if not paths:
        return 'system'
    return '+'.join(os.path.basename(os.path.normpath(os.path.expanduser(p))) or 'root' for p in paths)


SRGB = ImageCms.createProfile('sRGB')


def to_srgb(img):
    """Colour-managed as GNOME 50 shows it: an embedded ICC profile converted to sRGB. GNOME's own
    wallpapers carry a wide-gamut one (D65, DCI-P3 primaries); read as plain sRGB numbers, their
    colours came out duller than GNOME draws them (ΔE up to 1.65 in calibration, 0.6 after)."""
    icc = img.info.get('icc_profile')
    if icc:
        try:
            return ImageCms.profileToProfile(img, ImageCms.ImageCmsProfile(io.BytesIO(icc)), SRGB, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode='RGB')
        except ImageCms.PyCMSError:
            pass
    return img.convert('RGB')


def read_image(path):
    """A wallpaper as an RGB image in sRGB, at least twice the screen's logical size where it matters;
    formats Pillow lacks (JPEG XL, SVG — GNOME's own wallpapers) through ImageMagick, cached."""
    ext = path.rsplit('.', 1)[-1].lower()
    if ext in MAGICK_EXTS:
        key = hashlib.sha1(f'{path}{os.path.getmtime(path)}'.encode()).hexdigest()[:16]
        png = os.path.join(CACHE, 'decoded', key + '.png')
        if not os.path.exists(png):
            os.makedirs(os.path.dirname(png), exist_ok=True)
            pre = ['-density', '192', '-background', 'white'] if ext.startswith('svg') else []
            subprocess.run(['magick', *pre, path, '-flatten', '-resize', f'{LOGICAL[0] * 2}x{LOGICAL[1] * 2}^', png], check=True)
        return to_srgb(Image.open(png))
    img = Image.open(path)
    img.draft('RGB', (LOGICAL[0] * 2, LOGICAL[1] * 2))
    return to_srgb(img)


def zoom(img, size):
    """GNOME's 'zoom' picture option: scaled to cover the screen, centred, cropped."""
    w, h = img.size
    s = max(size[0] / w, size[1] / h)
    nw, nh = max(size[0], round(w * s)), max(size[1], round(h * s))
    img = img.resize((nw, nh), Image.LANCZOS, reducing_gap=3.0)
    x, y = (nw - size[0]) // 2, (nh - size[1]) // 2
    return img.crop((x, y, x + size[0], y + size[1]))


def blur(a, sigma):
    return np.stack([gaussian_filter(a[..., c], sigma, mode='nearest') for c in range(3)], -1)


def load(path):
    """The wallpaper at work size, sharp and blurred, as float arrays 0..255 (cached)."""
    key = hashlib.sha1(f'{MODEL}{path}{os.path.getmtime(path)}{LOGICAL}'.encode()).hexdigest()[:16]
    f = os.path.join(CACHE, key + '.npz')
    if os.path.exists(f):
        z = np.load(f)
        return z['sharp'].astype(np.float32), z['blur'].astype(np.float32)
    sharp = np.asarray(zoom(read_image(path), (W, H))).astype(np.float32)
    b = blur(sharp, SIGMA)
    os.makedirs(CACHE, exist_ok=True)
    np.savez(f, sharp=sharp.astype(np.uint8), blur=np.clip(b, 0, 255).round().astype(np.uint8))
    return sharp, b


# ---- colour ----

def over(below, rgb, alpha):
    return below * (1 - alpha) + np.asarray(rgb, np.float32) * alpha


def mix(rgb, other, amount):
    return tuple(c * (1 - amount) + o * amount for c, o in zip(rgb, other))


def saturate(a, s):
    """KWin's saturation matrix (Rec.709 weights): s > 1 makes colours stronger, 1 changes nothing."""
    if s == 1:
        return a
    l = (a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722)[..., None]
    return np.clip(l + (a - l) * s, 0, 255)


def lin(v):
    v = np.asarray(v, np.float32) / 255
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    l = lin(rgb)
    return l[..., 0] * 0.2126 + l[..., 1] * 0.7152 + l[..., 2] * 0.0722


def contrast(a, b):
    """WCAG contrast ratio."""
    la, lb = luminance(a), luminance(b)
    return (np.maximum(la, lb) + 0.05) / (np.minimum(la, lb) + 0.05)


def lab(rgb):
    l = lin(rgb)
    x = (l[..., 0] * 0.4124 + l[..., 1] * 0.3576 + l[..., 2] * 0.1805) / 0.95047
    y = l[..., 0] * 0.2126 + l[..., 1] * 0.7152 + l[..., 2] * 0.0722
    z = (l[..., 0] * 0.0193 + l[..., 1] * 0.1192 + l[..., 2] * 0.9505) / 1.08883
    f = lambda t: np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    fx, fy, fz = f(x), f(y), f(z)
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], -1)


def lab_to_rgb(L):
    fy = (L[..., 0] + 16) / 116
    fx = fy + L[..., 1] / 500
    fz = fy - L[..., 2] / 200
    inv = lambda f: np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27))
    x, y, z = inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883
    r = 3.2406 * x - 1.5372 * y - 0.4986 * z
    g = -0.9689 * x + 1.8758 * y + 0.0415 * z
    b = 0.0557 * x - 0.2040 * y + 1.0570 * z
    rgb = np.clip(np.stack([r, g, b], -1), 0, 1)
    return np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055) * 255


def lift(b, target, gain, chroma):
    """Acrylic's luminosity idea: a lightness of the glass's own — target, keeping gain of the
    wallpaper's light and dark around mid-grey — with the wallpaper's hue, chroma scaled."""
    L = lab(b)
    out = L.copy()
    out[..., 0] = np.clip(target + gain * (L[..., 0] - 50), 0, 100)
    out[..., 1:] *= chroma
    return lab_to_rgb(out)


def de(a, b):
    """CIE76 ΔE: enough to tell 'can be seen' from 'cannot'."""
    return np.linalg.norm(lab(a) - lab(b), axis=-1)


# ---- the look, composed ----

def tint(p, accent):
    return mix(p['base'], accent, p['accent'])


def depth(p, where):
    return p.get('panel_depth', p['depth']) if where == 'panel' else p['depth']


def glass(b, p, accent, where='overview'):
    """The glass: the blurred wallpaper, made more saturated if the look says so, under the tint —
    or lifted (looks.py's 'lift'), or a blend of two looks ('toward')."""
    if 'toward' in p:
        other, t = p['toward']
        a = glass(b, {k: v for k, v in p.items() if k != 'toward'}, accent, where)
        return a if t == 0 else a * (1 - t) + glass(b, other, accent, where) * t
    if where == 'panel' and p.get('panel_like_dock'):
        # the overview's glass with the dock's surface over it: the panel on the desktop as the dock looks
        *rgb, a = surface(p, accent, 'dock')
        rgb = mix(p['base'], accent, p.get('panel_dock_accent', p['accent']))
        a = p.get('panel_dock_alpha', a)
        return over(glass(b, p, accent, 'overview'), rgb, a)
    lf = p.get('panel_lift', p.get('lift')) if where == 'panel' else p.get('lift')
    if lf:
        return over(lift(b, *lf), accent, p.get('lift_accent', 0))
    sat = p.get('panel_sat', p.get('sat', 1)) if where == 'panel' else p.get('sat', 1)
    return over(saturate(b, sat), tint(p, accent), depth(p, where))


def surface(p, accent, which='dock'):
    """A surface on the glass (see _surface), with an open folder's card at card_alpha if the look
    gives one."""
    c = _surface(p, accent, which)
    return c[:3] + (p['card_alpha'],) if which == 'card' and 'card_alpha' in p else c


def _surface(p, accent, which='dock'):
    """A translucent surface on the overview's glass — the dock's, a folder tile's, an open folder's
    card — as (r, g, b, alpha). With surfaces_like_panel it is the tint at the alpha that brings the
    overview's depth to the panel's, so the surface looks like the panel on the desktop."""
    if p.get('surfaces_like_panel'):
        do, dp = p['depth'], depth(p, 'panel')
        share = p.get('card_accent', p['accent']) if which == 'card' else p['accent']
        return tuple(mix(p['base'], accent, share)) + (1 - (1 - dp) / (1 - do),)
    if which == 'card':
        return tuple(mix(p['card'][:3], accent, p.get('card_accent', p['accent'] * p['card_share']))) + (p['card'][3],)
    r, g, b, a = p.get(which, p['surface'])
    return tuple(mix((r, g, b), accent, p.get(which + '_accent', p.get('surface_accent', 0)))) + (a,)


def region(r):
    x, y, w, h = r
    return slice(y // F, (y + h) // F), slice(x // F, (x + w) // F)


def measures(b, p, accent):
    """What a look gives on one wallpaper (blurred, at work size): readability as WCAG contrast at the
    worst 1 % of places text can be, lightness and colour of the glass, and how surfaces stand out."""
    text = np.asarray(p['text'], np.float32)
    labels = np.asarray(p.get('label_color', p['text']), np.float32)
    gp = glass(b[PANEL], p, accent, 'panel')
    go = glass(b, p, accent)
    ds = region(DASH)
    sd = surface(p, accent, 'dock')
    dock = over(go[ds], sd[:3], sd[3])
    vr = p['veil']
    veiled = blur(over(go, vr[:3], vr[3]), SIGMA)
    cs = region(CARD)
    sc = surface(p, accent, 'card')
    card = over(veiled[cs], sc[:3], sc[3])
    around = np.ones(veiled.shape[:2], bool)
    around[cs] = False
    Lo, Lw = lab(go), lab(b)
    plain = glass(b, dict(p, accent=0), accent)
    return {
        'panel_text': float(np.percentile(contrast(text, gp), 1)),
        'grid_text': float(np.percentile(contrast(labels, go[PANEL.stop:]), 1)),
        'dock_text': float(np.percentile(contrast(text, dock), 1)),
        'card_text': float(np.percentile(contrast(labels, card), 1)),
        'dock_sep': float(np.median(de(dock, go[ds]))),
        'card_sep': float(np.median(de(card.mean((0, 1)), veiled[around]))),
        'L_panel': float(lab(gp)[..., 0].mean()), 'L_overview': float(Lo[..., 0].mean()),
        'see_through': float(Lo[..., 0].std() / max(Lw[..., 0].std(), 1e-3)),
        'chroma': float(np.hypot(Lo[..., 1], Lo[..., 2]).mean()),
        'chroma_p99': float(np.percentile(np.hypot(Lo[..., 1], Lo[..., 2]), 99)),
        'accent_de': float(de(go, plain).mean()),
    }


def stats(path):
    """The wallpaper's own, blurred as the glass sees it: mean lightness (CIELAB L*), mean
    colourfulness (chroma), and how much the strip under the panel varies in lightness."""
    _, b = load(path)
    L = lab(b)
    Lp = L[PANEL][..., 0]
    return {'L': float(L[..., 0].mean()), 'C': float(np.hypot(L[..., 1], L[..., 2]).mean()),
            'panel_range': float(np.percentile(Lp, 99) - np.percentile(Lp, 1))}


# Classes a wallpaper falls into, by its stats: what results are reported by instead of file names.
LIGHTNESS = (('dark', 0, 30), ('medium', 30, 55), ('light', 55, 101))
COLOUR = (('muted', 0, 12), ('moderate', 12, 25), ('colourful', 25, 1000))
BUSY = 60          # a panel strip whose lightness spans this much L* or more is 'busy'


def classes(st):
    out = [n for n, lo, hi in LIGHTNESS if lo <= st['L'] < hi] + [n for n, lo, hi in COLOUR if lo <= st['C'] < hi]
    if st['panel_range'] >= BUSY:
        out.append('busy')
    return out


CLASS_RU = {'dark': 'тёмные', 'medium': 'средние', 'light': 'светлые', 'muted': 'приглушённые',
            'moderate': 'умеренные', 'colourful': 'цветные', 'busy': 'пёстрые под панелью'}


def label(st):
    """How the lab names a wallpaper: its classes and numbers, never its file."""
    return f"{', '.join(CLASS_RU[c] for c in classes(st))} · L* {st['L']:.0f}, C {st['C']:.0f}"
