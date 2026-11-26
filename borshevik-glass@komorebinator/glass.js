// SPDX-License-Identifier: GPL-2.0-or-later

// One monitor's glass, baked: the wallpaper blurred and lifted to a lightness
// of its own, rendered once into a texture that every surface then shows as
// plain content. See the guidelines on static glass and on the glass's colour.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BAND_FADE, CASES, SAMPLE_WIDTH, analyse, analyseColour, liftFor, sample} from './adapt.js';
import {SnippetEffect} from './shader.js';

// Logical pixels, scaled by the monitor scale factor: Borshevik's Blur my Shell sigma.
export const BLUR_RADIUS = 30;

// How far the baked texture reaches past the monitor, in logical pixels: an
// offscreen effect's buffer is the actor's box padded by Clutter so its size
// does not depend on sub-pixel position (_clutter_actor_box_enlarge_for_effects:
// the right and bottom edges ceil(edge + 0.75), the left and top 3 px further
// out than the size), which for a box on whole pixels is 2 before it and 1
// after. The texture is shown at that offset and size, the excess clipped.
export const BAKE_MARGIN = {before: 2, after: 1};

// The lift: sRGB to CIELAB, as tests/vm/run.js checks it, the lightness set, the chroma
// scaled, and back with every linear channel clamped; then the band under the
// panel mixed in, full over the panel's height and fading out below it. The
// texture covers the monitor with Clutter's padding (BAKE_MARGIN), so a
// texture coordinate times `size`, less the margin before, is a point of the
// monitor. cogl_color_out holds the blurred pixel, premultiplied.
const LIFT_DECLARATIONS = `
uniform float target;
uniform float gain;
uniform float chroma;
uniform vec2 size;
uniform vec4 band;
uniform float panel;
uniform float fade;
vec3 lift_lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 lift_srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lift_f(float t) { return t > 216.0 / 24389.0 ? pow(t, 1.0 / 3.0) : (24389.0 / 27.0 * t + 16.0) / 116.0; }
float lift_finv(float t) { return t * t * t > 216.0 / 24389.0 ? t * t * t : (116.0 * t - 16.0) / (24389.0 / 27.0); }
`;
const LIFT_CODE = `
vec4 c = cogl_color_out;
vec3 l = lift_lin(c.a > 0.0 ? c.rgb / c.a : vec3(0.0));
float x = (l.r * 0.4124 + l.g * 0.3576 + l.b * 0.1805) / 0.95047;
float y = l.r * 0.2126 + l.g * 0.7152 + l.b * 0.0722;
float z = (l.r * 0.0193 + l.g * 0.1192 + l.b * 0.9505) / 1.08883;
float fx = lift_f(x), fy = lift_f(y), fz = lift_f(z);
float L = clamp(target + gain * (116.0 * fy - 16.0 - 50.0), 0.0, 100.0);
float A = 500.0 * (fx - fy) * chroma;
float B = 200.0 * (fy - fz) * chroma;
fy = (L + 16.0) / 116.0;
fx = fy + A / 500.0;
fz = fy - B / 200.0;
x = lift_finv(fx) * 0.95047;
y = lift_finv(fy);
z = lift_finv(fz) * 1.08883;
vec3 o = vec3(3.2406 * x - 1.5372 * y - 0.4986 * z,
              -0.9689 * x + 1.8758 * y + 0.0415 * z,
              0.0557 * x - 0.2040 * y + 1.0570 * z);
vec3 lifted = lift_srgb(clamp(o, 0.0, 1.0));
float band_y = cogl_tex_coord_in[0].t * size.y - ${BAKE_MARGIN.before.toFixed(1)};
lifted = mix(lifted, band.rgb, band.a * clamp(1.0 - (band_y - panel) / fade, 0.0, 1.0));
cogl_color_out = vec4(lifted * c.a, c.a);
`;

const LiftEffect = GObject.registerClass(
class BorshevikGlassLiftEffect extends SnippetEffect {
    get snippet() {
        return {declarations: LIFT_DECLARATIONS, code: LIFT_CODE};
    }

    // `fade` in pixels of the monitor
    setLift({target, gain, chroma}, band, panel, fade, size) {
        const uniforms = [
            ['target', 1, [target]], ['gain', 1, [gain]], ['chroma', 1, [chroma]],
            ['size', 2, size], ['band', 4, [...band.rgb.map(v => v / 255), band.alpha]],
            ['panel', 1, [panel]], ['fade', 1, [fade]],
        ];
        for (const [name, n, value] of uniforms)
            this.setUniform(name, n, value);
    }
});

// Renders what it wraps into its own texture as it is painted, and nothing
// else; it is how the glass gets into a texture, since JavaScript cannot paint
// an actor into a framebuffer of its own. Tells when it has painted.
export const GrabEffect = GObject.registerClass({
    Signals: {'painted': {}},
}, class BorshevikGlassGrabEffect extends Clutter.OffscreenEffect {
    vfunc_paint(node, paintContext, flags) {
        super.vfunc_paint(node, paintContext, flags);
        this.emit('painted');
    }
});

// The wallpaper of one monitor, kept at the bottom of Main.uiGroup, under
// GNOME's own wallpaper, by GNOME's BackgroundManager; baked into `content`
// whenever the wallpaper, the case or the depth changes, with the lift the
// case's rules give for this wallpaper (adapt.js). `onBaked` is called with
// the new content each time. `panel` is the height of the panel over this
// monitor, 0 where there is none: the band under it is baked in.
export class MonitorGlass {
    constructor(monitor, scaleFactor, panel, onBaked) {
        this._monitor = monitor;
        this._scaleFactor = scaleFactor;
        this._panel = panel;
        this._onBaked = onBaked;
        this._case = null;
        this._stats = null;
        this._baked = null;
        this._baking = false;
        this._again = false;
        this._idleId = 0;
        this._cancellable = null;
        this.content = null;

        // The source: the wallpaper, under the blur, under the lift, under the
        // grab — three actors, since the effects must apply in that order.
        this._grabbed = new Clutter.Actor({name: 'borshevik-glass-bake', visible: false});
        this._lifted = new Clutter.Actor();
        this._backgrounds = new Meta.BackgroundGroup({width: monitor.width, height: monitor.height});
        this._lifted.add_child(this._backgrounds);
        this._grabbed.add_child(this._lifted);
        Main.layoutManager.uiGroup.insert_child_at_index(this._grabbed, 0);

        this._bgManager = new Background.BackgroundManager({
            container: this._backgrounds,
            monitorIndex: monitor.index,
            controlPosition: false,
        });
        // nothing is baked before the wallpaper is in and read: it would bake an
        // empty picture, or one with the lift of another wallpaper
        const loaded = () => this._read();
        this._bgManager.connect('loaded', loaded);
        this._bgManager.connect('changed', loaded);
    }

    // The case and depth to bake: {dark, depth}. A new one is baked at once, if
    // the wallpaper is in.
    setCase(state) {
        if (this._case?.dark === state.dark && this._case?.depth === state.depth)
            return;
        this._case = state;
        this._bake();
    }

    // The wallpaper this monitor shows, as GNOME's background.js picks it: none
    // with picture-options none, else picture-uri-dark under GNOME's dark style
    // and picture-uri otherwise; a slideshow's current picture from GNOME's own
    // Background for it. Null for a wallpaper that is only its colour.
    _wallpaperFile() {
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        if (settings.get_string('picture-options') === 'none')
            return null;
        const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('color-scheme') === 'prefer-dark';
        const uri = settings.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
        if (!uri)
            return null;
        const file = Gio.File.new_for_commandline_arg(uri);
        if (file.get_basename()?.endsWith('.xml')) {
            const frames = this._bgManager._backgroundSource?.getBackground(this._monitor.index)
                ?._animation?.keyFrameFiles;
            return frames?.[0] ?? null;
        }
        return file;
    }

    // Reads the wallpaper the rules adapt to, then bakes: a copy SAMPLE_WIDTH
    // wide, cropped to the monitor's shape as GNOME's zoom does and blurred a
    // little; a wallpaper that cannot be read is taken as its colour.
    async _read() {
        this._cancellable?.cancel();
        const cancellable = this._cancellable = new Gio.Cancellable();
        const fraction = this._panelFraction();
        let stats;
        try {
            const file = this._wallpaperFile();
            if (!file)
                throw new Error('a colour');
            const stream = await new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_LOW, cancellable,
                (f, res) => { try { resolve(f.read_finish(res)); } catch (e) { reject(e); } }));
            const {width, height} = this._monitor;
            const pixbuf = await new Promise((resolve, reject) => GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, SAMPLE_WIDTH * 4, -1, true, cancellable,
                (s, res) => { try { resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res)); } catch (e) { reject(e); } }));
            stream.close(null);
            stats = analyse(sample(pixbuf, width / height), fraction);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            const colour = new Gio.Settings({schema_id: 'org.gnome.desktop.background'}).get_string('primary-color');
            const [ok, c] = Cogl.Color.from_string(colour);
            stats = analyseColour(ok ? [c.red, c.green, c.blue] : [0, 0, 0]);
        }
        if (cancellable.is_cancelled() || !this._bgManager)
            return;
        this._stats = stats;
        // a new picture, though its lift be the same
        this._baked = null;
        this._bake();
    }

    _panelFraction() {
        // the strip under the panel: the panel's height of the screen, as on the primary monitor
        return (Main.panel?.height || 32) / this._monitor.height;
    }

    // Bakes the case's lift for the wallpaper read, unless that very picture is
    // what was baked last.
    _bake() {
        if (!this._case || !this._stats || !this._bgManager)
            return;
        if (this._baking) {
            this._again = true;
            return;
        }
        const lift = {...liftFor(this._case.dark, this._stats, this._case.depth), dark: this._case.dark};
        if (this._baked && ['target', 'gain', 'chroma', 'dark'].every(k => this._baked[k] === lift[k]))
            return;
        this._baking = true;
        this._baked = lift;

        this._backgrounds.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            brightness: 1,
            radius: BLUR_RADIUS * this._scaleFactor,
        }));
        const liftEffect = new LiftEffect();
        const {before, after} = BAKE_MARGIN;
        const band = this._panel > 0 ? CASES[this._case.dark ? 'dark' : 'light'].band : {rgb: [0, 0, 0], alpha: 0};
        liftEffect.setLift(this._baked, band, this._panel, BAND_FADE * this._monitor.height,
            [this._monitor.width + before + after, this._monitor.height + before + after]);
        this._lifted.add_effect(liftEffect);
        const grab = new GrabEffect();
        grab.connect('painted', () => {
            // not from within the paint: the effects are taken off afterwards
            this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleId = 0;
                this._finish(grab);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._grabbed.add_effect(grab);
        this._grabbed.show();
        this._grabbed.queue_redraw();
    }

    _finish(grab) {
        const texture = grab.get_texture();
        if (texture) {
            this.content = Clutter.TextureContent.new_from_texture(texture, null);
            this._onBaked(this.content);
        }
        // the texture outlives the effect that made it; their buffers go
        this._grabbed.hide();
        this._grabbed.clear_effects();
        this._lifted.clear_effects();
        this._backgrounds.clear_effects();
        this._baking = false;
        if (this._again) {
            this._again = false;
            this._bake();
        }
    }

    destroy() {
        this._cancellable?.cancel();
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._bgManager.destroy();
        this._bgManager = null;
        this._grabbed.destroy();
        this.content = null;
        this._onBaked = null;
    }
}
