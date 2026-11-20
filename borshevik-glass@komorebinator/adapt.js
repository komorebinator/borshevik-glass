// SPDX-License-Identifier: GPL-2.0-or-later

// How the glass adapts to the wallpaper: what is read off a small copy of the
// wallpaper, and the lift, band and accent share each case takes from it — the
// rules the author tuned live on their own screen (2026-11-20). Plain
// arithmetic, with no GNOME import, so the test machine's scenarios run the
// same rules the extension does. See the guideline on the glass's colour.

// How much of the wallpaper's light and dark the glass keeps around its
// target lightness: L* = target + LIFT_GAIN × (L* − 50).
export const LIFT_GAIN = 0.3;

// Per case: the target lightness from the lightness under the panel, the most
// of the wallpaper's chroma the glass may keep, and how much colour it may
// leave in the glass by the wallpaper's mean hue — more for purple and
// magenta, less for blue in the dark case; how far a unit of depth moves the
// target; and the band under the panel, mixed into the glass's top.
export const CASES = {
    dark: {
        target: panelL => 12 - 0.2 * panelL,
        maxChroma: 0.5,
        colour: hue => 0.8 * (2.7 + 2.0 * bump(hue, 305, 45) - 1.2 * bump(hue, 250, 35)),
        perDepth: -24,
        band: {rgb: [0, 0, 0], alpha: 0.05},
    },
    light: {
        target: () => 80,
        maxChroma: 1,
        colour: hue => 28 + 20 * bump(hue, 305, 45),
        perDepth: 10,
        band: {rgb: [255, 255, 255], alpha: 0.2},
    },
};

// The width of the copy of the wallpaper the rules read: about a twelfth of a
// screen, which the glass's blur leaves little more detail than.
export const SAMPLE_WIDTH = 144;

// How far below the panel the band fades out, in logical pixels.
export const BAND_FADE = 60;

// The accent's share over the dark glass at strength 100 %, in per cent:
// purple's, scaled by purple's luminance over the accent's, so a light accent
// — yellow, orange — tints the dark glass no more than purple does.
const DARK_GLASS_ACCENT = 3.2;
const PURPLE = [0x91, 0x41, 0xac];

function bump(hue, centre, width) {
    const d = Math.min(Math.abs(hue - centre), 360 - Math.abs(hue - centre));
    return Math.cos(Math.min(d / width, 1) * Math.PI / 2) ** 2;
}

const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
const finv = t => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);

const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

// sRGB 0..255 to CIELAB, as the lift shader and the lab's glass.py do.
export function lab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// The chroma of one pixel of the glass after the lift: lightness set, chroma
// scaled, back to sRGB with each linear channel clamped — as the shader does,
// which is what lights up dark saturated colours — and into CIELAB again.
function liftedChroma(L, A, B, target, chroma) {
    const l = Math.min(100, Math.max(0, target + LIFT_GAIN * (L - 50)));
    const fy = (l + 16) / 116;
    const x = finv(fy + A * chroma / 500) * 0.95047;
    const y = finv(fy);
    const z = finv(fy - B * chroma / 200) * 1.08883;
    const c = v => Math.min(1, Math.max(0, v));
    const r = c(3.2406 * x - 1.5372 * y - 0.4986 * z);
    const g = c(-0.9689 * x + 1.8758 * y + 0.0415 * z);
    const b = c(0.0557 * x - 0.2040 * y + 1.0570 * z);
    const ffx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const ffy = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const ffz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    return Math.hypot(500 * (ffx - ffy), 200 * (ffy - ffz));
}

// What the rules read off the wallpaper: a small copy of it as the monitor
// shows it, blurred a little as the glass is — `pixels` an RGB(A) byte array of
// width × height with the given rowstride and channels — the mean lightness of
// its top `panelFraction` (the strip under the panel), the hue of its mean
// colour, and every pixel in CIELAB for the chroma the lift will leave.
export function analyse({width, height, rowstride, channels, pixels}, panelFraction) {
    const L = new Float32Array(width * height);
    const A = new Float32Array(width * height);
    const B = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = y * rowstride + x * channels;
            const [l, a, b] = lab(pixels[o], pixels[o + 1], pixels[o + 2]);
            const i = y * width + x;
            L[i] = l;
            A[i] = a;
            B[i] = b;
        }
    }
    const rows = Math.max(1, Math.round(height * panelFraction));
    let panelL = 0, meanA = 0, meanB = 0;
    for (let i = 0; i < rows * width; i++)
        panelL += L[i];
    for (let i = 0; i < L.length; i++) {
        meanA += A[i];
        meanB += B[i];
    }
    const hue = (Math.atan2(meanB / L.length, meanA / L.length) * 180 / Math.PI + 360) % 360;
    return {panelL: panelL / (rows * width), hue, L, A, B};
}

// A uniform wallpaper of one colour, for a wallpaper that is only a colour.
export function analyseColour(rgb) {
    const [l, a, b] = lab(...rgb);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return {panelL: l, hue, L: Float32Array.of(l), A: Float32Array.of(a), B: Float32Array.of(b)};
}

// The lift of a case on a wallpaper at a depth (1 = as designed): the target
// from the strip under the panel, moved by the depth, and the share of the
// wallpaper's chroma that leaves the case's colour in the glass, found by
// halving.
export function liftFor(dark, stats, depth = 1) {
    const rule = CASES[dark ? 'dark' : 'light'];
    const target = Math.min(100, Math.max(-60, rule.target(stats.panelL) + rule.perDepth * (depth - 1)));
    const wanted = rule.colour(stats.hue);
    // every pixel would be ten thousand; every few is as good a mean
    const n = stats.L.length, step = Math.max(1, Math.floor(n / 3000));
    const left = chroma => {
        let sum = 0, count = 0;
        for (let i = 0; i < n; i += step, count++)
            sum += liftedChroma(stats.L[i], stats.A[i], stats.B[i], target, chroma);
        return sum / count;
    };
    if (left(rule.maxChroma) <= wanted)
        return {target, chroma: rule.maxChroma};
    let lo = 0, hi = rule.maxChroma;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (left(mid) < wanted)
            lo = mid;
        else
            hi = mid;
    }
    return {target, chroma: (lo + hi) / 2};
}

// The accent's share over the glass at strength 100 %, in per cent: the light
// case's own, or the dark case's by the accent's luminance.
export function glassAccentShare(dark, lightShare, accentRgb) {
    if (!dark)
        return lightShare;
    return DARK_GLASS_ACCENT * luminance(PURPLE) / Math.max(luminance(accentRgb), 1e-3);
}

// The wallpaper as the monitor shows it, small — `pixbuf` a GdkPixbuf.Pixbuf of
// it, read at a few times this size: cropped to the monitor's
// aspect around its centre, as GNOME's zoom does, SAMPLE_WIDTH wide, and blurred
// by a pixel twice over, as the glass's blur leaves it at this size.
export function sample(pixbuf, aspect) {
    let w = pixbuf.get_width(), h = pixbuf.get_height();
    let crop = pixbuf;
    if (w / h > aspect) {
        const cw = Math.round(h * aspect);
        crop = pixbuf.new_subpixbuf(Math.floor((w - cw) / 2), 0, cw, h);
    } else {
        const ch = Math.round(w / aspect);
        crop = pixbuf.new_subpixbuf(0, Math.floor((h - ch) / 2), w, ch);
    }
    const width = SAMPLE_WIDTH, height = Math.max(1, Math.round(SAMPLE_WIDTH / aspect));
    const small = crop.scale_simple(width, height, 2 /* GdkPixbuf.InterpType.BILINEAR */);
    const channels = small.get_n_channels(), rowstride = small.get_rowstride();
    const bytes = small.get_pixels();
    let rgb = new Float32Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++)
                rgb[(y * width + x) * 3 + c] = bytes[y * rowstride + x * channels + c];
        }
    }
    for (let pass = 0; pass < 2; pass++)
        rgb = boxBlur(rgb, width, height);
    const pixels = new Uint8Array(rgb.length);
    for (let i = 0; i < rgb.length; i++)
        pixels[i] = Math.round(rgb[i]);
    return {width, height, rowstride: width * 3, channels: 3, pixels};
}

function boxBlur(src, width, height) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const at = (x, y, c) => (y * width + x) * 3 + c;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) {
                const l = src[at(Math.max(0, x - 1), y, c)], r = src[at(Math.min(width - 1, x + 1), y, c)];
                tmp[at(x, y, c)] = (l + src[at(x, y, c)] + r) / 3;
            }
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) {
                const u = tmp[at(x, Math.max(0, y - 1), c)], d = tmp[at(x, Math.min(height - 1, y + 1), c)];
                out[at(x, y, c)] = (u + tmp[at(x, y, c)] + d) / 3;
            }
        }
    }
    return out;
}
