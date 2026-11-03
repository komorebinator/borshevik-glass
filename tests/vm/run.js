// SPDX-License-Identifier: GPL-2.0-or-later
//
// Acts out tests/scenarios.js in the test machine and prints ok, FAIL or SKIP for each.
// Run on the host by `tests/vm.sh scenarios [filter]`, with the machine started and the
// working tree deployed. What a scenario sees is judged from screenshots — pixels sampled
// where a surface is, against colours worked out from the wallpaper and the tint the
// stylesheets name — and, through Eval, from which actors exist; never from the
// extension's own state.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';

import {scenarios} from '../scenarios.js';

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

// The colour a rule of the stylesheet gives a style class, in the dark or the light
// case; a class with no light rule of its own (the panel's tint in the dark case) is
// asked for by the class it falls back on.
function cssColour(scheme, styleClass) {
    const css = new TextDecoder().decode(GLib.file_get_contents(`${repo}/${UUID}/stylesheet.css`)[1]);
    const selector = scheme === 'light'
        ? `\\.borshevik-glass-light \\.${styleClass}` : `\\n\\.${styleClass}`;
    const m = css.match(new RegExp(`${selector}\\s*\\{[^}]*background-color:\\s*rgba\\(([^)]*)\\)`));
    if (!m)
        throw new Error(`no ${scheme} colour for .${styleClass} in stylesheet.css`);
    return m[1].split(',').map(Number);
}

const tintOf = (scheme, surface) => cssColour(scheme,
    surface === 'panel' && scheme === 'light' ? 'borshevik-glass-panel-tint' : 'borshevik-glass-tint');

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
}

const fmt = c => `(${c.map(v => Math.round(v)).join(', ')})`;

function helpers(scenario) {
    let shots = 0;
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
        scheme(name) {
            vm('scheme', name);
        },
        wallpaper(name) {
            vm('wallpaper', makeWallpaper(name));
        },
        setLightStyle(on) {
            vm('ssh', `uid=$(id -u tester); runuser -u tester -- env DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus dconf ${on === null ? 'reset' : 'write'} /org/gnome/shell/extensions/borshevik-glass/light-style ${on === null ? '' : on}`);
            h.sleep(1.5);
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
        // whether the blur behind a folder is on: on the open one, on none when all are closed
        expectFolderBlur(open) {
            const state = JSON.parse(h.eval(`JSON.stringify(Main.layoutManager.overviewGroup.get_children()
                .map(c => [c.visible, c.get_effect?.('borshevik-glass-folder-blur')])
                .filter(([, e]) => e).map(([visible, e]) => ({visible, enabled: e.enabled, radius: e.radius})))`));
            const on = state.filter(s => s.enabled);
            if (open ? !on.some(s => s.visible && s.radius > 0) : on.length > 0)
                h.fail(`the blur behind folders is not what it should be ${open ? 'with one open' : 'with none open'}: ${JSON.stringify(state)}`);
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
        glass(scheme, wallpaper, surface = 'overview') {
            const [a, b] = WALLPAPERS[wallpaper];
            return h.over(a.map((v, c) => (v + b[c]) / 2), tintOf(scheme, surface));
        },
        veil(scheme) {
            return cssColour(scheme, 'borshevik-glass-folder-veil');
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
        expectNoDynamicBlur() {
            const found = h.eval(`global.stage.get_children().flatMap(function walk(a) {
                return [a, ...a.get_children().flatMap(walk)];
            }).filter(a => a.name === 'borshevik-glass').flatMap(function walk(a) {
                return [a, ...a.get_children().flatMap(walk)];
            }).flatMap(a => a.get_effects())
              .filter(e => e.mode !== undefined && e.mode !== 0).length`);
            if (found !== '0')
                h.fail(`${found} blur effects of the extension are not in ACTOR mode`);
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
    h.setLightStyle(null);
    h.scheme('dark');
    h.wallpaper('A');
    h.sleep(1.5);
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
