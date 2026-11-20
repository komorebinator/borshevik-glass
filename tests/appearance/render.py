# SPDX-License-Identifier: GPL-2.0-or-later
"""Mock frames of what Borshevik Glass draws, at the screen's full logical size, to look at.

The same model as glass.py (calibrated against GNOME Shell), drawn with GNOME's font and real app
icons: a desktop with a window under the panel, the app grid with folder tiles and the dash, and an
open folder. A frame is not a screenshot — it is what the model says the extension would draw, with
GNOME's own widgets stood in for by shapes of their size — so it is for judging colour, depth and
readability, not GNOME's layout.
"""
import glob
import hashlib
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, maximum_filter

import apps
import glass as g

FONT = os.environ.get('BORSHEVIK_GLASS_FONT', '/usr/share/fonts/adwaita-sans-fonts/AdwaitaSans-Regular.ttf')
LW, LH = g.LOGICAL


def font(size, weight='Regular'):
    f = ImageFont.truetype(FONT, size=round(size))
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


# rasterised by icons.sh into the work directory: app icons are not ours to commit
ICONS = {os.path.basename(p)[:-4]: Image.open(p).convert('RGBA') for p in glob.glob(os.path.join(g.WORK, 'icons', '*.png'))}


def have(ids):
    """The apps of a list whose icons the host had."""
    return [a for a in ids if a in ICONS]


def icon(name, size):
    return ICONS[name].resize((size, size), Image.LANCZOS)


def symbolic(name, size, rgb):
    a = ICONS['sym-' + name].resize((size, size), Image.LANCZOS).getchannel('A')
    im = Image.new('RGBA', (size, size), tuple(rgb) + (255,))
    im.putalpha(a)
    return im


def blur_full(arr, sigma=15):
    """GNOME's blur at full size, computed at a quarter of it and scaled back: at sigma 15 nothing
    finer than a few pixels is left, so the two cannot be told apart, and this is ~16 times faster."""
    h, w = arr.shape[:2]
    small = np.asarray(to_img(arr).resize((w // g.F, h // g.F), Image.BOX)).astype(np.float32)
    return upscale(g.blur(small, sigma / g.F), (w, h))


def upscale(a, size):
    return np.asarray(to_img(a).resize(size, Image.BICUBIC)).astype(np.float32)


def to_img(a):
    return Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8))


def grey(im, opacity=0.8, brightness=0.0, contrast=0.0, desaturate=1.0):
    """Clutter's DesaturateEffect then BrightnessContrastEffect, as their shaders compute them."""
    a = np.asarray(im).astype(np.float32)
    l = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    g = a[..., :3] * (1 - desaturate) + np.stack([l, l, l], -1) * desaturate
    g = g / 255
    g = g * (1 - abs(brightness)) + (brightness if brightness > 0 else 0)
    k = np.tan((contrast + 1) * np.pi / 4)
    g = ((g - 0.5) * k + 0.5) * 255
    out = np.concatenate([g, a[..., 3:] * opacity], -1)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')


def outlined(im, width=1, rgb=(34, 34, 38), alpha=1.0):
    """A hard outline: the icon's silhouette grown by width px on every side, in one colour, under
    the icon — no blur. The icon's own alpha (its opacity included) carries over to the outline."""
    a = np.asarray(im.getchannel('A')).astype(np.float32) / 255
    pad = width + 1
    big = np.zeros((a.shape[0] + 2 * pad, a.shape[1] + 2 * pad), np.float32)
    big[pad:pad + a.shape[0], pad:pad + a.shape[1]] = a
    grown = maximum_filter(big, size=2 * width + 1) * alpha
    rgbimg = np.broadcast_to(np.asarray(rgb, np.float32), big.shape + (3,))
    out = Image.fromarray(np.concatenate([rgbimg, (np.clip(grown, 0, 1) * 255)[..., None]], -1).astype(np.uint8), 'RGBA')
    out.alpha_composite(im, (pad, pad))
    return out, pad


def dressed(ic, shadow, outline):
    """An icon with what the look puts around it — an outline, a shadow — and how far that reaches."""
    pad = 0
    if outline:
        ic, pad = outlined(ic, *outline)
    if shadow:
        ic, p2 = shadowed(ic, *shadow)
        pad += p2
    return ic, pad


def shadowed(im, offset=1, blur=1.5, alpha=0.35, rgb=(0, 0, 0), own=False, spread=0):
    """St's icon-shadow: the icon's silhouette, offset, blurred, under the icon, in one colour —
    or, with own, in the icon's own colours darkened (not something St's CSS can do). A spread, as
    St's _st_create_shadow_cairo_pattern does it, scales the silhouette up from its centre to the
    icon's size plus spread on each side — it does not grow it evenly."""
    if spread:
        h, w = im.size[1], im.size[0]
        sil = im.getchannel('A').resize((w + 2 * spread, h + 2 * spread), Image.BILINEAR)
    else:
        sil = im.getchannel('A')
    a = np.asarray(sil).astype(np.float32) / 255
    pad = 4 + spread
    big = np.zeros((im.size[1] + 2 * pad, im.size[0] + 2 * pad), np.float32)
    big[pad - spread + offset:pad - spread + offset + a.shape[0], pad - spread:pad - spread + a.shape[1]] = a
    sh = gaussian_filter(big, blur) * alpha
    if own:
        c = np.asarray(im).astype(np.float32)[..., :3]
        cb = np.zeros(big.shape + (3,), np.float32)
        a0 = np.asarray(im.getchannel('A')).astype(np.float32)[..., None] / 255
        cb[pad + offset:pad + offset + c.shape[0], pad:pad + c.shape[1]] = c * a0
        cb = np.stack([gaussian_filter(cb[..., k], blur) for k in range(3)], -1) / np.maximum(gaussian_filter(big, blur), 1e-3)[..., None]
        rgbimg = np.clip(cb * 0.55, 0, 255)
    else:
        rgbimg = np.broadcast_to(np.asarray(rgb, np.float32), big.shape + (3,))
    out = Image.fromarray(np.concatenate([rgbimg, (np.clip(sh, 0, 1) * 255)[..., None]], -1).astype(np.uint8), 'RGBA')
    out.alpha_composite(im, (pad, pad))
    return out, pad


def label(im, xy, txt, p, text):
    """An app's label: the case's text colour, optionally bolder and over a soft halo (St's text-shadow)."""
    f = font(13.33, p.get('label_weight', 'Regular'))
    halo = p.get('label_halo')
    if halo:
        blur, alpha, rgb = halo
        layer = Image.new('L', im.size, 0)
        ImageDraw.Draw(layer).text(xy, txt, font=f, fill=255, anchor='mm')
        a = gaussian_filter(np.asarray(layer).astype(np.float32), blur) * alpha * 2.2
        g = Image.new('RGBA', im.size, tuple(rgb) + (0,))
        g.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
        im.alpha_composite(g)
    ImageDraw.Draw(im).text(xy, txt, font=f, fill=tuple(p.get('label_color', text)), anchor='mm')


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, r, fill=fill)


def overlay(base, rgba, box, radius):
    """A translucent rounded rect composited over an image (sRGB blending, as Clutter)."""
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=tuple(int(round(v)) for v in rgba[:3]) + (int(round(rgba[3] * 255)),))
    return Image.alpha_composite(base, layer)


def ring(base, rgba, box, radius, width):
    """An inset outline of a rounded rect — St's `box-shadow: inset 0 0 0 <width>px` — drawn four
    times larger and scaled down, so a line of a pixel or less is smooth as on the screen."""
    k = 4
    layer = Image.new('RGBA', (base.size[0] * k, base.size[1] * k), (0, 0, 0, 0))
    x0, y0, x1, y1 = box
    ImageDraw.Draw(layer).rounded_rectangle((x0 * k, y0 * k, x1 * k - 1, y1 * k - 1), radius * k,
        outline=tuple(int(round(v)) for v in rgba[:3]) + (int(round(rgba[3] * 255)),), width=max(1, round(width * k)))
    return Image.alpha_composite(base, layer.resize(base.size, Image.LANCZOS))


def prepare(path):
    """The wallpaper at the screen's logical size, as GNOME's zoom places it, cached as a JPEG so a
    wallpaper is decoded and scaled once; returns the cached file."""
    key = hashlib.sha1(f'{g.MODEL}{path}{os.path.getmtime(path)}{g.LOGICAL}'.encode()).hexdigest()[:16]
    out = os.path.join(g.WORK, 'cache', 'screen', key + '.jpg')
    if not os.path.exists(out):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        g.zoom(g.read_image(path), (LW, LH)).save(out + '.tmp.jpg', quality=95)
        os.replace(out + '.tmp.jpg', out)
    return out


class Frames:
    def __init__(self, path):
        self.sharp = np.asarray(Image.open(prepare(path)).convert('RGB')).astype(np.float32)
        # the glass's blur, from the quarter-size one the measures use (glass.load, cached)
        self.blur = upscale(g.load(path)[1], (LW, LH))
        self.name = os.path.basename(path)

    def surface(self, p, accent, which):
        return g.surface(p, accent, which)

    def tint(self, p, accent):
        return g.tint(p, accent)

    def glass(self, p, accent, where='overview'):
        return g.glass(self.blur, p, accent, where)

    def panel(self, im, p, accent):
        """GNOME's top panel as Borshevik has it: the Workspace Manager's buttons on the left, the
        clock in the middle, extensions' indicators, the input source and Quick Settings on the right —
        each where GNOME puts it, measured in the test machine, from the right edge."""
        acc_rgb = accent
        d = ImageDraw.Draw(im)
        text = tuple(p['text'])
        f = font(14.67, 'Bold')
        x = 14
        for i in (0, 1):
            for j in (0, 1):
                d.rectangle((x + i * 9, 9 + j * 9, x + i * 9 + 7, 9 + j * 9 + 7), fill=text)
        x = 44
        shadow = p.get('bwm_shadow')
        if shadow and len(shadow) > 3 and shadow[3] == 'accent':
            shadow = shadow[:3] + (acc_rgb,) + shadow[4:]
        active, inactive = have(apps.BWM_ACTIVE), have(apps.BWM_INACTIVE)
        # the active workspace: highlighted, its icons in colour
        aw = 30 + 25 * len(active)
        hl = (34, 34, 38, 0.15) if p['text'][0] < 128 else (255, 255, 255, 0.15)
        if p.get('bwm_active_fill'):
            hl = tuple(acc_rgb) + (p['bwm_active_fill'],)
        im.paste(overlay(im, hl, (x, 5, x + aw, 27), 11))
        if p.get('bwm_active_outline'):
            width, colour, alpha = p['bwm_active_outline']
            # in place, as the rest of the panel is drawn: the caller holds this image
            im.paste(ring(im, tuple(acc_rgb if colour == 'accent' else colour) + (alpha,), (x, 5, x + aw, 27), 11, width))
        d = ImageDraw.Draw(im)
        d.text((x + 8, 16), '1', font=f, fill=text, anchor='lm')
        outline = p.get('bwm_outline')
        for k, n in enumerate(active):
            ic, pad = dressed(icon(n, 22), shadow, outline if p.get('bwm_outline_active', True) else None)
            im.alpha_composite(ic, (x + 26 + k * 25 - pad, 5 - pad))
        x += aw + 8
        # an inactive one: greyed and dimmed by the Workspace Manager
        iw = 20 + 25 * len(inactive)
        if p.get('bwm_chip'):
            chip = p['bwm_chip'] if p['bwm_chip'] != 'accent' else tuple(acc_rgb) + (0.14,)
            im.paste(overlay(im, chip, (x, 5, x + iw + 6, 27), 11))
            d = ImageDraw.Draw(im)
        d.text((x + 6, 16), '2', font=f, fill=text + (204,), anchor='lm')
        for k, n in enumerate(inactive):
            ic = grey(icon(n, 22), p.get('bwm_opacity', 0.8), p.get('bwm_brightness', 0), p.get('bwm_contrast', 0), p.get('bwm_desaturate', 1))
            ic, pad = dressed(ic, shadow, outline)
            im.alpha_composite(ic, (x + 20 + k * 25 - pad, 5 - pad))
        x += iw + 14
        d.text((x + 6, 16), '3', font=f, fill=text + (204,), anchor='lm')
        d.text((x + 20, 15), '+', font=font(18, 'Bold'), fill=text + (153,), anchor='lm')
        d.text((LW // 2, 16), 'Nov 4  05:54', font=f, fill=text, anchor='mm')
        # the right side, by the centres GNOME gives each indicator, from the screen's right edge
        for off, n in ((340, 'face-cool-symbolic'), (300, 'color-select-symbolic'), (262, 'camera-web-symbolic'),
                       (222, 'edit-paste-symbolic'), (180, 'accessories-dictionary-symbolic'),
                       (102, 'network-wired-symbolic'), (74, 'audio-volume-high-symbolic'),
                       (47, 'battery-level-80-symbolic'), (18, 'system-shutdown-symbolic')):
            if 'sym-' + n in ICONS:
                im.alpha_composite(symbolic(n, 16, text), (LW - off - 8, 8))
        d.text((LW - 136, 16), 'en', font=f, fill=text, anchor='mm')

    def desktop(self, p, accent, case):
        im = to_img(self.sharp).convert('RGBA')
        # a window, as the case's apps draw it
        win = (250, 110, 1350, 900)
        bg, head = ((250, 250, 251), (235, 235, 237)) if case == 'light' else ((34, 34, 38), (46, 46, 50))
        layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        dl.rounded_rectangle((win[0] + 4, win[1] + 10, win[2] + 4, win[3] + 14), 14, fill=(0, 0, 0, 70))
        im = Image.alpha_composite(im, layer)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle(win, 14, fill=bg)
        d.rounded_rectangle((win[0], win[1], win[2], win[1] + 48), 14, fill=head)
        d.rectangle((win[0], win[1] + 30, win[2], win[1] + 48), fill=head)
        tc = (34, 34, 38) if case == 'light' else (250, 250, 251)
        d.text(((win[0] + win[2]) // 2, win[1] + 24), 'Files', font=font(14.67, 'Bold'), fill=tc, anchor='mm')
        for i, n in enumerate(('Documents', 'Downloads', 'Music', 'Pictures', 'Videos')):
            d.text((win[0] + 40, win[1] + 90 + i * 40), n, font=font(14.67), fill=tc, anchor='lm')
        gl = self.glass(p, accent, 'panel')
        im.paste(to_img(gl[:g.PANEL_H]).convert('RGBA'), (0, 0))
        self.panel(im, p, accent)
        return im.convert('RGB')

    def overview(self, p, accent, case, folder=False):
        bare = to_img(self.glass(p, accent))  # the glass alone, before anything is drawn on it
        im = bare.convert('RGBA')
        text = tuple(p['text'])
        self.panel(im, p, accent)
        dx, dy, dw, dh = g.DASH
        im = overlay(im, self.surface(p, accent, 'dock'), (dx, dy, dx + dw, dy + dh), 24)
        if p.get('dash_border'):
            layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
            ImageDraw.Draw(layer).rounded_rectangle((dx, dy, dx + dw, dy + dh), 24, outline=p['dash_border'], width=1)
            im = Image.alpha_composite(im, layer)
        for i, n in enumerate(have(apps.DOCK)[:9]):
            im.alpha_composite(icon(n, 56), (dx + 18 + i * 70, dy + 14))
        # the grid: apps with labels, and folders — GNOME's tile behind a 2x2 of their apps
        cells = [c for c in apps.GRID if c in apps.FOLDERS or c in ICONS]
        for k, cell in enumerate(cells[:24]):
            r, c = divmod(k, 8)
            x, y = 190 + c * 175, 140 + r * 190
            if cell in apps.FOLDERS:
                im = overlay(im, self.surface(p, accent, 'tile'), (x - 14, y - 12, x + 110, y + 134), 22)
                if p.get('tile_border'):
                    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
                    ImageDraw.Draw(layer).rounded_rectangle((x - 14, y - 12, x + 110, y + 134), 22, outline=p['tile_border'], width=1)
                    im = Image.alpha_composite(im, layer)
                for q, n in enumerate(have(apps.FOLDERS[cell])[:4]):
                    qr, qc = divmod(q, 2)
                    im.alpha_composite(icon(n, 40), (x + 6 + qc * 46, y + 6 + qr * 46))
                label(im, (x + 48, y + 116), cell, p, text)
                continue
            name = apps.NAMES[cell]
            if p.get('app_tile'):
                c = self.surface(p, accent, 'tile')
                im = overlay(im, c[:3] + (c[3] * p['app_tile'],), (x - 14, y - 12, x + 110, y + 134), 22)
                if p.get('app_tile_border'):
                    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
                    ImageDraw.Draw(layer).rounded_rectangle((x - 14, y - 12, x + 110, y + 134), 22, outline=p['tile_border'], width=1)
                    im = Image.alpha_composite(im, layer)
            im.alpha_composite(icon(cell, 96), (x, y))
            if p.get('soft_pill'):
                rgb, alpha, blur, padx, pady = p['soft_pill']
                if rgb == 'tint':
                    rgb = tuple(int(v) for v in g.mix(self.tint(p, accent), (255, 255, 255), 0.5))
                tw = font(13.33, p.get('label_weight', 'Regular')).getlength(name)
                cx, cy = x + 48, y + 116
                mask = Image.new('L', im.size, 0)
                ImageDraw.Draw(mask).rounded_rectangle((cx - tw / 2 - padx, cy - 9 - pady, cx + tw / 2 + padx, cy + 9 + pady), 9 + pady, fill=255)
                m = gaussian_filter(np.asarray(mask).astype(np.float32), blur) * alpha
                layer = Image.new('RGBA', im.size, tuple(rgb) + (0,))
                layer.putalpha(Image.fromarray(np.clip(m, 0, 255).astype(np.uint8)))
                im.alpha_composite(layer)
            if p.get('label_pill'):
                c = self.surface(p, accent, 'tile')
                tw = font(13.33, p.get('label_weight', 'Regular')).getlength(name)
                im = overlay(im, c[:3] + (c[3] * p['label_pill'],), (x + 48 - tw / 2 - 8, y + 116 - 11, x + 48 + tw / 2 + 8, y + 116 + 11), 11)
            label(im, (x + 48, y + 116), name, p, text)
        if folder:
            vr = p['veil']
            veiled = g.over(np.asarray(im.convert('RGB')).astype(np.float32), vr[:3], vr[3])
            cx, cy, cw, ch = g.CARD
            fb = p.get('fold_blur', True)
            if fb == 'card':
                # only what lies under the card blurred; the rest of the overview veiled, sharp
                mask = Image.new('L', im.size, 0)
                ImageDraw.Draw(mask).rounded_rectangle((cx, cy, cx + cw, cy + ch), 28, fill=255)
                veiled = to_img(veiled)
                veiled.paste(to_img(blur_full(np.asarray(veiled).astype(np.float32))), (0, 0), mask)
                veiled = np.asarray(veiled).astype(np.float32)
            elif fb == 'glass':
                # under the card the baked glass alone, unveiled: the grid hidden there, nothing blurred again
                mask = Image.new('L', im.size, 0)
                ImageDraw.Draw(mask).rounded_rectangle((cx, cy, cx + cw, cy + ch), 28, fill=255)
                veiled = to_img(veiled)
                veiled.paste(bare, (0, 0), mask)
                veiled = np.asarray(veiled).astype(np.float32)
            elif fb:
                veiled = blur_full(veiled)
            im = to_img(veiled).convert('RGBA')
            if p.get('surfaces_like_panel'):
                cardc = self.surface(p, accent, 'card')
            else:
                cardc = tuple(g.mix(p['card'][:3], accent, p.get('card_accent', p['accent'] * p['card_share']))) + (p['card'][3],)
            im = overlay(im, cardc, (cx, cy, cx + cw, cy + ch), 28)
            d = ImageDraw.Draw(im)
            d.text((cx + cw // 2, cy + 42), 'Utilities', font=font(18, 'Bold'), fill=text, anchor='mm')
            for k, n in enumerate(have(apps.FOLDERS['Utilities'])[:6]):
                r, c = divmod(k, 3)
                x, y = cx + 120 + c * 180, cy + 110 + r * 180
                im.alpha_composite(icon(n, 96), (x, y))
                label(im, (x + 48, y + 116), apps.NAMES[n], p, text)
        return im.convert('RGB')


# The views the lab can show, each from one of the three frames.
VIEWS = {
    'desk': ('рабочий стол', 'desktop', None),
    'over': ('обзор', 'overview', None),
    'fold': ('открытая папка', 'folder', None),
}


def view(frames, name, p, accent, case='light'):
    _, frame, crop = VIEWS[name]
    im = frames.desktop(p, accent, case) if frame == 'desktop' else frames.overview(p, accent, case, folder=(frame == 'folder'))
    return crop(im) if crop else im
