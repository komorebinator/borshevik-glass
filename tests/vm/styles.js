// SPDX-License-Identifier: GPL-2.0-or-later
//
// The styles stand: puts GNOME's popups in the test machine through every state worth
// looking at, in both cases and every one of GNOME's accent colours, photographs each, and
// lays the photographs of a state out on one sheet — a column per accent, with GNOME's own
// popup first for comparison, a row per case — for the author to judge. Nothing is
// checked; the scenarios check. Run on the host by `tests/vm.sh styles [filter]`, with the
// machine started and the working tree deployed; the sheets land in the machine's
// directory, glass-styles/<state>.png.

import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Gdk from 'gi://Gdk?version=4.0';
import Cairo from 'cairo';
import System from 'system';

const UUID = 'borshevik-glass@komorebinator';
const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const vmScript = `${GLib.path_get_dirname(here)}/vm.sh`;
const machineDir = `${GLib.getenv('XDG_CACHE_HOME') ?? `${GLib.get_home_dir()}/.cache`}/borshevik-extensions-vm`;
const outDir = `${machineDir}/glass-styles`;
GLib.mkdir_with_parents(`${outDir}/shots`, 0o755);

const ACCENTS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];
// GNOME's own popups are compared at one accent
const REFERENCE_ACCENT = 'purple';
const CASES = ['light', 'dark'];
const CELL_WIDTH = 380;
const MARGIN = 16;

function run(argv) {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, out, err] = proc.communicate_utf8(null, null);
    if (!proc.get_successful())
        throw new Error(`${argv.join(' ')}: ${(err || out).trim()}`);
    return out;
}
const vm = (...args) => run(['bash', vmScript, ...args]);
const evalJs = js => vm('eval', js).trim();
const sleep = seconds => GLib.usleep(seconds * 1e6);

// A box of an actor on the screen, from an expression giving it.
function box(js) {
    const b = JSON.parse(evalJs(`(() => {
        const a = ${js};
        if (!a || !a.is_mapped()) return 'null';
        const [x, y] = a.get_transformed_position();
        const [width, height] = a.get_transformed_size();
        return JSON.stringify({x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height)});
    })()`));
    if (!b)
        throw new Error(`not shown: ${js}`);
    return b;
}

// Four notifications from two sources; with `quiet`, put straight into the calendar's
// list, with no banner.
const notify = (quiet = false) => `import('resource:///org/gnome/shell/ui/messageTray.js').then(MT => {
    Main.messageTray.bannerBlocked = ${quiet};
    const source = (title, iconName) => {
        const s = new MT.Source({title, iconName});
        Main.messageTray.add(s);
        return s;
    };
    const mail = source('Mail', 'mail-unread-symbolic');
    const chat = source('Chat', 'user-available-symbolic');
    for (const [s, title, body] of [
        [mail, 'Three new messages', 'From the reviewers of the glass'],
        [mail, 'Build passed', 'experimental is green again'],
        [chat, 'Komorebi', 'Look at the popups in every accent'],
        [chat, 'Komorebi', 'And then in the dark case'],
    ])
        s.addNotification(new MT.Notification({source: s, title, body}));
    Main.messageTray.bannerBlocked = false;
})`;
const CLEAR_NOTIFICATIONS = 'Main.messageTray.getSources().forEach(s => s.destroy())';

// Each state: how to bring it up, the actor to photograph, how to put it away.
const STATES = [
    {
        id: 'quick-settings',
        show: 'Main.panel.statusArea.quickSettings.menu.open(false)',
        actor: 'Main.panel.statusArea.quickSettings.menu.box',
        hide: 'Main.panel.statusArea.quickSettings.menu.close(false)',
    },
    {
        id: 'quick-settings-submenu',
        show: `(() => {
            const qs = Main.panel.statusArea.quickSettings;
            qs.menu.open(false);
            const walk = a => [a, ...a.get_children().flatMap(walk)];
            const toggle = walk(qs.menu.box).find(a => a.menu && a.menuEnabled);
            toggle?.menu.open(false);
            return String(!!toggle);
        })()`,
        actor: 'Main.panel.statusArea.quickSettings.menu.box',
        hide: 'Main.panel.statusArea.quickSettings.menu.close(false)',
    },
    {
        id: 'calendar-empty',
        before: CLEAR_NOTIFICATIONS,
        show: 'Main.panel.statusArea.dateMenu.menu.open(false)',
        actor: 'Main.panel.statusArea.dateMenu.menu.box',
        hide: 'Main.panel.statusArea.dateMenu.menu.close(false)',
    },
    {
        id: 'notification-banner',
        before: CLEAR_NOTIFICATIONS,
        show: notify(),
        wait: 2,
        actor: 'Main.messageTray._bannerBin',
        hide: 'Main.messageTray._hideNotification?.(false)',
    },
    {
        id: 'calendar-notifications',
        before: `${CLEAR_NOTIFICATIONS}; ${notify(true)}`,
        show: 'Main.panel.statusArea.dateMenu.menu.open(false)',
        actor: 'Main.panel.statusArea.dateMenu.menu.box',
        hide: 'Main.panel.statusArea.dateMenu.menu.close(false)',
        after: CLEAR_NOTIFICATIONS,
    },
    {
        id: 'app-menu',
        show: `(() => {
            Main.overview.show();
            return 'ok';
        })()`,
        then: `(() => {
            const icon = Main.overview.dash._box.get_children().map(c => c.child).find(c => c?.popupMenu);
            icon.popupMenu();
            global._styleMenu = icon._menu;
            return 'ok';
        })()`,
        actor: 'global._styleMenu.box',
        hide: `(() => {
            global._styleMenu?.close(false);
            Main.overview.hide();
            return 'ok';
        })()`,
    },
    {
        id: 'dialog',
        show: `import('resource:///org/gnome/shell/ui/modalDialog.js').then(MD =>
            import('resource:///org/gnome/shell/ui/dialog.js').then(D => {
                const d = new MD.ModalDialog();
                d.contentLayout.add_child(new D.MessageDialogContent({
                    title: 'Restart to update?',
                    description: 'Borshevik has downloaded an update. It is installed when the computer restarts.',
                }));
                d.addButton({label: 'Cancel', action: () => d.close()});
                d.addButton({label: 'Restart', action: () => d.close(), default: true});
                global._styleDialog = d;
                d.open();
            }))`,
        actor: 'global._styleDialog.dialogLayout',
        hide: 'global._styleDialog?.close()',
    },
];

function setAccent(name) {
    evalJs(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'}).set_string('accent-color', '${name}')`);
    sleep(1.5);
}

// GNOME's own light popups need prefer-light: with the extension off, Dark Style off
// leaves GNOME's shell dark.
function setCase(name, gnome) {
    vm('scheme', name === 'light' ? (gnome ? 'light-only' : 'light') : 'dark');
    sleep(1);
}

function photograph(state, file) {
    if (state.before)
        evalJs(state.before);
    evalJs(state.show);
    sleep(state.wait ?? 1.5);
    if (state.then) {
        evalJs(state.then);
        sleep(1.5);
    }
    let b;
    try {
        b = box(state.actor);
    } finally {
        vm('shot', `${outDir}/screen.png`);
        evalJs(state.hide);
        if (state.after)
            evalJs(state.after);
        sleep(1);
    }
    const screen = GdkPixbuf.Pixbuf.new_from_file(`${outDir}/screen.png`);
    const x = Math.max(0, b.x - MARGIN), y = Math.max(0, b.y - MARGIN);
    const width = Math.min(screen.get_width() - x, b.width + 2 * MARGIN);
    const height = Math.min(screen.get_height() - y, b.height + 2 * MARGIN);
    screen.new_subpixbuf(x, y, width, height).savev(file, 'png', [], []);
}

// One sheet per state: GNOME's popup and each accent across, light above dark.
function sheet(state, columns) {
    const label = 28;
    const cells = CASES.map(c => columns.map(col => {
        const file = `${outDir}/shots/${state.id}-${c}-${col}.png`;
        if (!GLib.file_test(file, GLib.FileTest.EXISTS))
            return null;
        const p = GdkPixbuf.Pixbuf.new_from_file(file);
        const scale = Math.min(1, CELL_WIDTH / p.get_width());
        return p.scale_simple(Math.round(p.get_width() * scale), Math.round(p.get_height() * scale), GdkPixbuf.InterpType.BILINEAR);
    }));
    const rowHeights = cells.map(row => Math.max(1, ...row.map(p => p?.get_height() ?? 0)));
    const width = columns.length * (CELL_WIDTH + 8) + 8;
    const height = label + rowHeights.reduce((a, b) => a + b + 8, 8);
    const surface = new Cairo.ImageSurface(Cairo.Format.RGB24, width, height);
    const cr = new Cairo.Context(surface);
    cr.setSourceRGB(0.5, 0.5, 0.5);
    cr.paint();
    const layout = PangoCairo.create_layout(cr);
    layout.set_font_description(Pango.FontDescription.from_string('Sans Bold 11'));
    columns.forEach((col, i) => {
        cr.setSourceRGB(1, 1, 1);
        cr.moveTo(8 + i * (CELL_WIDTH + 8), 6);
        layout.set_text(col === 'gnome' ? `GNOME (${REFERENCE_ACCENT})` : col, -1);
        PangoCairo.show_layout(cr, layout);
    });
    let y = label + 8;
    cells.forEach((row, r) => {
        row.forEach((p, i) => {
            if (!p)
                return;
            Gdk.cairo_set_source_pixbuf(cr, p, 8 + i * (CELL_WIDTH + 8), y);
            cr.paint();
        });
        y += rowHeights[r] + 8;
    });
    surface.writeToPNG(`${outDir}/${state.id}.png`);
}

const filter = System.programArgs[0] ?? '';
const states = STATES.filter(s => s.id.includes(filter));
const accentBefore = evalJs(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'}).get_string('accent-color')`);
try {
    // GNOME's own first, with the extension off
    evalJs(`Main.extensionManager.disableExtension('${UUID}')`);
    sleep(2);
    setAccent(REFERENCE_ACCENT);
    for (const c of CASES) {
        setCase(c, true);
        for (const state of states) {
            try {
                photograph(state, `${outDir}/shots/${state.id}-${c}-gnome.png`);
            } catch (e) {
                print(`gnome ${c} ${state.id}: ${e.message}`);
            }
        }
    }
    evalJs(`Main.extensionManager.enableExtension('${UUID}')`);
    sleep(3);
    for (const c of CASES) {
        setCase(c, false);
        for (const accent of ACCENTS) {
            setAccent(accent);
            for (const state of states) {
                try {
                    photograph(state, `${outDir}/shots/${state.id}-${c}-${accent}.png`);
                    print(`${c} ${accent} ${state.id}`);
                } catch (e) {
                    print(`${c} ${accent} ${state.id}: ${e.message}`);
                }
            }
        }
    }
} finally {
    evalJs(`Main.extensionManager.enableExtension('${UUID}')`);
    setAccent(accentBefore.replace(/'/g, '') || 'blue');
}
for (const state of states) {
    sheet(state, ['gnome', ...ACCENTS]);
    print(`sheet: ${outDir}/${state.id}.png`);
}
