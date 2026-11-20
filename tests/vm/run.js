// SPDX-License-Identifier: GPL-2.0-or-later
//
// Acts out tests/scenarios.js in the test machine and prints ok, FAIL or SKIP for each.
// Run on the host by `tests/vm.sh scenarios [filter]`, with the machine started and the
// working tree deployed. What a scenario sees is judged from screenshots — pixels sampled
// where a surface is, against colours worked out from the wallpaper, the lift the glass
// is baked with, GNOME's accent colour and the colours the stylesheets name — and,
// through Eval, from which actors exist; never from the extension's own state.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';

import {scenarios} from '../scenarios.js';
import {CASES, analyseColour, glassAccentShare, liftFor} from '../../borshevik-glass@komorebinator/adapt.js';

const UUID = 'borshevik-glass@komorebinator';
const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const repo = GLib.path_get_dirname(GLib.path_get_dirname(here));
const vmScript = `${repo}/tests/vm.sh`;
const machineDir = `${GLib.getenv('XDG_CACHE_HOME') ?? `${GLib.get_home_dir()}/.cache`}/borshevik-extensions-vm`;
const shotsDir = `${machineDir}/glass-scenarios`;
GLib.mkdir_with_parents(shotsDir, 0o755);

// Two striped wallpapers far apart in colour: blurred, each is its stripes' average,
// so the expected colour is known, and a picture still striped was not blurred.
const WALLPAPERS = {
    A: [[230, 120, 30], [250, 200, 60]],
    B: [[30, 90, 200], [60, 160, 230]],
};

class Failure extends Error {}
class Skip extends Error {}

function run(argv, input = null) {
    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE |
        (input === null ? 0 : Gio.SubprocessFlags.STDIN_PIPE);
    const proc = Gio.Subprocess.new(argv, flags);
    const [, out, err] = proc.communicate_utf8(input, null);
    if (!proc.get_successful())
        throw new Error(`${argv.join(' ')}: ${(err || out).trim()}`);
    return out;
}

const vm = (...args) => run(['bash', vmScript, ...args]);

// A rule of accent.css, the template of the rules with the accent in them: the base
// colour the accent is mixed into, the alpha, and which share of the accent it takes.
function accentRule(scheme, selector) {
    const css = new TextDecoder().decode(GLib.file_get_contents(`${repo}/${UUID}/accent.css`)[1]);
    const prefix = scheme === 'light' ? '\\.borshevik-glass-light ' : '\\n';
    const escaped = selector.replace(/[.#]/g, c => `\\${c}`);
    // the selector whole: followed by the next one or by its rule, not by a descendant
    const m = css.match(new RegExp(`${prefix}${escaped}\\s*[,{][^}]*?background-color:\\s*` +
        'st-transparentize\\(st-mix\\(-st-accent-color, rgb\\(([^)]*)\\), \\{\\{\\w+-(\\w+)\\}\\}%\\), ([\\d.]+)\\)'));
    if (!m)
        throw new Error(`no ${scheme} rule for ${selector} in accent.css`);
    return {base: m[1].split(',').map(Number), alpha: 1 - Number(m[3]), share: m[2]};
}

// The glass as the extension bakes it — the lift, kept here
// apart from the extension's shader so the two are checked against each other — with
// the lift the extension's own rules give the wallpaper (adapt.js: what is adapted to
// the wallpaper is the rule's to say, what is drawn the shader's), and the accent's
// shares: @BorshevikGlassExtension's guideline on the glass's colour and
// behaviour#tint-tunable.
const ACCENT_SHARES = {light: {glass: 8, surface: 25}, dark: {surface: 12.5}};

const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const unlin = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
const finv = t => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);

function lab(rgb) {
    const [r, g, b] = rgb.map(lin);
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function lift(rgb, target, gain, chroma) {
    const [L0, A0, B0] = lab(rgb);
    const L = Math.min(100, Math.max(0, target + gain * (L0 - 50)));
    const fy = (L + 16) / 116, fx = fy + A0 * chroma / 500, fz = fy - B0 * chroma / 200;
    const x = finv(fx) * 0.95047, y = finv(fy), z = finv(fz) * 1.08883;
    return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z,
        0.0557 * x - 0.2040 * y + 1.0570 * z].map(v => unlin(Math.min(1, Math.max(0, v))));
}

function makeWallpaper(name) {
    const [a, b] = WALLPAPERS[name];
    const width = 1920, height = 1080, stripe = 8;
    const row = new Uint8Array(width * 3);
    for (let x = 0; x < width; x++)
        row.set(Math.floor(x / stripe) % 2 ? b : a, x * 3);
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
        data.set(row, y * width * 3);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(data),
        GdkPixbuf.Colorspace.RGB, false, 8, width, height, width * 3);
    const file = `${shotsDir}/wallpaper-${name}.png`;
    pixbuf.savev(file, 'png', [], []);
    return file;
}

class Shot {
    constructor(file) {
        this.file = file;
        this.pixbuf = GdkPixbuf.Pixbuf.new_from_file(file);
        this.pixels = this.pixbuf.get_pixels();
        this.stride = this.pixbuf.get_rowstride();
        this.channels = this.pixbuf.get_n_channels();
    }

    // The mean colour of a rectangle, and how far its pixels stray from it: a blurred
    // picture strays little, stripes a lot.
    region({x, y, width, height}) {
        const sum = [0, 0, 0], sq = [0, 0, 0];
        let n = 0, darkest = [255, 255, 255];
        for (let j = y; j < y + height; j++) {
            for (let i = x; i < x + width; i++) {
                const o = j * this.stride + i * this.channels;
                const px = [0, 1, 2].map(c => this.pixels[o + c]);
                for (let c = 0; c < 3; c++) {
                    sum[c] += px[c];
                    sq[c] += px[c] ** 2;
                }
                if (px[0] + px[1] + px[2] < darkest[0] + darkest[1] + darkest[2])
                    darkest = px;
                n++;
            }
        }
        const mean = sum.map(s => s / n);
        const spread = Math.max(...sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c] ** 2))));
        return {mean, spread, darkest};
    }

    // How far the most different pixel of a rectangle is from the same pixel of
    // another shot, by its most different channel.
    differs(other, {x, y, width, height}) {
        let most = 0;
        for (let j = y; j < y + height; j++) {
            for (let i = x; i < x + width; i++) {
                const o = j * this.stride + i * this.channels;
                const p = j * other.stride + i * other.channels;
                for (let c = 0; c < 3; c++)
                    most = Math.max(most, Math.abs(this.pixels[o + c] - other.pixels[p + c]));
            }
        }
        return most;
    }
}

const fmt = c => `(${c.map(v => Math.round(v)).join(', ')})`;

function helpers(scenario) {
    let shots = 0;
    // what the scenario has set, as the extension's settings: the rest are defaults
    const settings = {};
    const notes = [];
    const h = {
        notes,
        lastShot: null,
        fail(why) {
            throw new Failure(why);
        },
        skip(why) {
            throw new Skip(why);
        },
        note(text) {
            notes.push(text);
        },
        sleep(seconds) {
            GLib.usleep(seconds * 1e6);
        },
        eval(js) {
            return vm('eval', js).trim();
        },
        waitFor(js, seconds = 5) {
            for (let i = 0; i < seconds * 4; i++) {
                if (h.eval(js) === 'true') {
                    h.sleep(1);
                    return;
                }
                h.sleep(0.25);
            }
            h.fail(`waited ${seconds} s for ${js}`);
        },
        key(...keys) {
            vm('key', ...keys);
        },
        // the pointer through points of the screen, [x, y] each
        pointer(...points) {
            vm('pointer', ...points.flat().map(v => String(Math.round(v))));
        },
        // a new scheme or wallpaper is baked again: a moment for the bake
        scheme(name) {
            vm('scheme', name);
            h.sleep(1);
        },
        wallpaper(name) {
            vm('wallpaper', makeWallpaper(name));
            h.sleep(1);
        },
        // one of the extension's settings, as the preferences write it; null resets it
        setSetting(key, value) {
            settings[key] = value;
            vm('ssh', `uid=$(id -u tester); runuser -u tester -- env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus dconf ${value === null ? 'reset' : 'write'} /org/gnome/shell/extensions/borshevik-glass/${key} ${value === null ? '' : value}`);
            h.sleep(1.5);
        },
        setLightStyle(on) {
            h.setSetting('light-style', on);
        },
        // GNOME's accent colour, as GNOME resolves it for a widget of its own
        accentColour() {
            return JSON.parse(h.eval(`(() => {
                const w = new (imports.gi.St.Widget)({style: 'background-color: -st-accent-color;'});
                Main.layoutManager.uiGroup.add_child(w);
                const c = w.get_theme_node().get_background_color();
                w.destroy();
                return JSON.stringify([c.red, c.green, c.blue]);
            })()`));
        },
        // the accent's strength the scenario has the extension at, 0 with it switched off
        accentStrength() {
            return settings['accent-tint'] === false ? 0 : (settings['accent-scale'] ?? 100) / 100;
        },
        // the accent over the glass in a scheme, as [r, g, b, alpha]
        accentOverGlass(scheme) {
            const accent = h.accentColour();
            const share = glassAccentShare(scheme === 'dark', ACCENT_SHARES.light.glass, accent);
            return [...accent, share / 100 * h.accentStrength()];
        },
        // a surface of accent.css on the glass, as [r, g, b, alpha]: its base colour with
        // its share of the accent mixed in
        surface(scheme, selector) {
            const {base, alpha, share} = accentRule(scheme, selector);
            const k = ACCENT_SHARES[scheme][share] / 100 * h.accentStrength();
            const accent = h.accentColour();
            return [...base.map((v, c) => v * (1 - k) + accent[c] * k), alpha];
        },
        // the accent over the glass as the stylesheet has it, as [r, g, b, alpha]
        glassAccent() {
            return JSON.parse(h.eval(`(() => {
                const w = global.stage.get_children().flatMap(function walk(a) {
                    return [a, ...a.get_children().flatMap(walk)];
                }).find(a => a.has_style_class_name?.('borshevik-glass-accent') && a.is_mapped());
                const c = w.get_theme_node().get_background_color();
                return JSON.stringify([c.red, c.green, c.blue, c.alpha / 255]);
            })()`));
        },
        // the open folder's card as the extension has coloured it, as [r, g, b, alpha]:
        // the stylesheet's colour with a share of the accent, so read from the shell
        folderCard() {
            return JSON.parse(h.eval(`(() => {
                const d = Main.layoutManager.overviewGroup.get_children().find(c => c._isOpen);
                const c = d.child.child.get_theme_node().get_background_color();
                return JSON.stringify([c.red, c.green, c.blue, c.alpha / 255]);
            })()`));
        },
        // GNOME's Quick Settings, in which of its two variants: light, or dark
        expectQuickSettings(variant) {
            h.eval('Main.panel.statusArea.quickSettings.menu.open(false)');
            h.sleep(1.5);
            const box = h.actorBox('Main.panel.statusArea.quickSettings.menu.box');
            const spot = {x: box.x + 30, y: box.y + box.height - 12, width: 4, height: 4};
            const {mean} = h.shot().region(spot);
            h.eval('Main.panel.statusArea.quickSettings.menu.close(false)');
            const light = Math.min(...mean) > 220, dark = Math.max(...mean) < 80;
            if (variant === 'light' ? !light : !dark)
                h.fail(`Quick Settings is not GNOME's ${variant} one: its background is ${mean.map(Math.round)}`);
        },
        setEnabled(on) {
            h.eval(`Main.extensionManager.${on ? 'enableExtension' : 'disableExtension'}('${UUID}')`);
            h.sleep(2);
        },
        shot() {
            const file = `${shotsDir}/${scenario.path.replace('#', '--')}-${++shots}.png`;
            vm('shot', file);
            h.lastShot = new Shot(file);
            return h.lastShot;
        },
        actorBox(js) {
            const box = JSON.parse(h.eval(`(() => {
                const a = ${js};
                if (!a) return 'null';
                const [x, y] = a.get_transformed_position();
                const [width, height] = a.get_transformed_size();
                return JSON.stringify({x: Math.round(x), y: Math.round(y),
                    width: Math.round(width), height: Math.round(height)});
            })()`));
            if (!box)
                h.fail(`no actor: ${js}`);
            return box;
        },
        // the empty middle of the panel's left half: no button, no clock
        panelStrip() {
            const panel = h.actorBox('Main.panel');
            return {
                x: panel.x + Math.floor(panel.width * 0.2), y: panel.y + 3,
                width: Math.floor(panel.width * 0.15), height: panel.height - 6,
            };
        },
        // left of an open folder, above the dash, clear of the screen's edge, where a
        // blur would pull in what lies beyond it
        besideFolder() {
            const height = Number(h.eval('global.stage.height'));
            return {x: 60, y: height - 160, width: 40, height: 40};
        },
        // whether the blur under a folder's card is there: shown with a baked picture
        // under the open one, and nothing left of its bake; shown nowhere when all
        // are closed
        expectFolderBlur(open) {
            const state = JSON.parse(h.eval(`JSON.stringify(Main.layoutManager.overviewGroup.get_children()
                .filter(c => c.name === 'borshevik-glass-folder-backdrop')
                .map(c => ({visible: c.visible, picture: c.first_child.content !== null})))`));
            const bakes = JSON.parse(h.eval(`JSON.stringify(Main.layoutManager.uiGroup.get_children()
                .filter(c => c.name === 'borshevik-glass-folder-bake')
                .map(c => ({visible: c.visible, effects: c.get_effects().length + c.first_child.get_effects().length,
                    clones: c.first_child.get_n_children()})))`));
            const shown = state.filter(s => s.visible || s.picture);
            const right = (open ? shown.length === 1 && shown[0].visible && shown[0].picture : shown.length === 0) &&
                bakes.every(b => !b.visible && b.effects === 0 && b.clones === 0);
            if (!right)
                h.fail(`the blur under folders is not what it should be ${open ? 'with one open' : 'with none open'}: ${JSON.stringify({state, bakes})}`);
        },
        cornerBottomLeft() {
            // the stage's own transformed size is not its size; width and height are
            const height = Number(h.eval('global.stage.height'));
            return {x: 12, y: height - 52, width: 40, height: 40};
        },
        // what a surface over a colour looks like: [r, g, b, alpha] over [r, g, b]
        over(below, [r, g, b, alpha]) {
            return below.map((v, c) => v * (1 - alpha) + [r, g, b][c] * alpha);
        },
        // whether the panel is the glass of the dark case or of the light one, by its
        // lightness: the cases' glasses lie far apart at any depth
        expectCase(scheme) {
            const [L] = lab(h.shot().region(h.panelStrip()).mean);
            if (scheme === 'dark' ? L > 35 : L < 55)
                h.fail(`the panel's lightness is ${L.toFixed(0)}, not of the ${scheme} case (${h.lastShot.file})`);
        },
        // the glass the extension bakes from a striped wallpaper, in the scheme given and
        // at the depth the scenario set, with the accent over it: blurred, the wallpaper
        // is a flat field of its stripes' average in sRGB
        // ...under the panel, the case's band mixed in
        glass(wallpaper, scheme, {underPanel = false} = {}) {
            const [a, b] = WALLPAPERS[wallpaper];
            const flat = a.map((v, c) => (v + b[c]) / 2);
            const depth = (settings[`${scheme}-depth-scale`] ?? 100) / 100;
            const {target, gain, chroma} = liftFor(scheme === 'dark', analyseColour(flat), depth);
            let lifted = lift(flat, target, gain, chroma);
            if (underPanel) {
                const {rgb, alpha} = CASES[scheme].band;
                lifted = h.over(lifted, [...rgb, alpha]);
            }
            return h.over(lifted, h.accentOverGlass(scheme));
        },
        panelGlass(wallpaper, scheme) {
            return h.glass(wallpaper, scheme, {underPanel: true});
        },
        expectColour(what, {mean}, expected, tolerance = 10) {
            const off = Math.max(...mean.map((v, c) => Math.abs(v - expected[c])));
            if (off > tolerance)
                h.fail(`${what} is ${fmt(mean)}, expected ${fmt(expected)} ± ${tolerance} (${h.lastShot?.file ?? ''})`);
        },
        expectBlurred(what, {spread}) {
            if (spread > 6)
                h.fail(`${what} is not blurred: its pixels stray by ${spread.toFixed(1)} (${h.lastShot.file})`);
        },
        // on any actor of the stage, the extension's or GNOME's: the extension once put
        // its folder blur on GNOME's own dialog
        expectNoDynamicBlur() {
            const found = h.eval(`global.stage.get_children().flatMap(function walk(a) {
                return [a, ...a.get_children().flatMap(walk)];
            }).flatMap(a => a.get_effects())
              .filter(e => e.mode !== undefined && e.mode !== 0).length`);
            if (found !== '0')
                h.fail(`${found} blur effects are not in ACTOR mode`);
        },
        // the background colour of the first dash icon's highlight, its tile in the state given
        dashHighlight(state) {
            return JSON.parse(h.eval(`(() => {
                const walk = a => [a, ...a.get_children().flatMap(walk)];
                const tile = Main.overview.dash._box.get_children().map(c => c.child)
                    .find(t => t?.has_style_class_name?.('overview-tile'));
                ${state === 'hover' ? 'tile.hover = true;' : ''}
                const icon = walk(${state === 'hover' ? 'tile' : 'Main.overview.dash.showAppsButton'})
                    .find(a => a.has_style_class_name?.('overview-icon'));
                const c = icon.get_theme_node().get_background_color();
                ${state === 'hover' ? 'tile.hover = false;' : ''}
                return JSON.stringify([c.red, c.green, c.blue, c.alpha]);
            })()`));
        },
        // the effects on what the extension shows and on what it bakes from, while
        // nothing is being baked
        glassEffects() {
            return JSON.parse(h.eval(`JSON.stringify(global.stage.get_children().flatMap(function walk(a) {
                return [a, ...a.get_children().flatMap(walk)];
            }).filter(a => a.name === 'borshevik-glass' || a.name === 'borshevik-glass-bake').flatMap(function walk(a) {
                return [a, ...a.get_children().flatMap(walk)];
            }).flatMap(a => a.get_effects().map(e => e.constructor.name)))`));
        },
        shellCpu() {
            const stat = vm('ssh', 'cat /proc/$(pgrep -u tester -x gnome-shell)/stat').trim();
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const ticks = Number(run(['getconf', 'CLK_TCK']).trim());
            return (Number(fields[11]) + Number(fields[12])) / ticks;
        },
    };
    return h;
}

// The state every scenario starts from (see tests/scenarios.js).
function reset(h) {
    h.eval(`Main.overview.dash.showAppsButton.checked = false; Main.overview.hide();
        global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time()); 'ok'`);
    h.eval(`Main.extensionManager.lookup('${UUID}')?.state === 1 ? 'on' :
        (Main.extensionManager.enableExtension('${UUID}'), 'enabled')`);
    vm('ssh', `uid=$(id -u tester); runuser -u tester -- env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus dconf reset -f /org/gnome/shell/extensions/borshevik-glass/`);
    h.scheme('dark');
    h.wallpaper('A');
    // a new wallpaper or scheme is baked again: a moment for the bake
    h.sleep(2.5);
}

const filter = System.programArgs[0] ?? '';
let failed = 0;
for (const scenario of scenarios.filter(s => s.path.includes(filter))) {
    const h = helpers(scenario);
    let verdict = 'ok', detail = '';
    try {
        reset(h);
        scenario.run(h);
    } catch (e) {
        if (e instanceof Skip) {
            verdict = 'SKIP';
            detail = e.message;
        } else {
            verdict = 'FAIL';
            detail = e instanceof Failure ? e.message : `${e.message}\n${e.stack}`;
            failed++;
        }
    }
    print(`${verdict.padEnd(4)} ${scenario.path}${detail ? ` — ${detail}` : ''}`);
    for (const note of h.notes)
        print(`     ${note}`);
}
// leave the session as a person would want to find it
try {
    const h = helpers({path: 'end'});
    reset(h);
} catch (e) {
    printerr(`could not reset the session: ${e.message}`);
}
System.exit(failed ? 1 : 0);
