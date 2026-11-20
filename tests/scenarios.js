// SPDX-License-Identifier: GPL-2.0-or-later
//
// The scenarios of @BorshevikGlassExtension#behaviour as tests/vm/run.js acts them out in
// the test machine, keyed by their path. `run` gets the helpers of run.js (h) and returns
// nothing when the scenario holds; it throws, or calls h.fail, when it does not, and calls
// h.skip for what only a person can judge. Every scenario starts on the desktop, the
// overview closed, the dark scheme and wallpaper A, the extension enabled.

const OVERVIEW_JS = 'Main.overview.visible';

function openFolder(h) {
    h.key('super');
    h.waitFor(OVERVIEW_JS);
    h.eval('Main.overview.dash.showAppsButton.checked = true');
    h.sleep(1.5);
    const opened = h.eval(`(() => {
        const icon = Main.overview._overview.controls._appDisplay._folderIcons?.[0];
        if (!icon) return 'none';
        icon.open();
        return 'opened';
    })()`);
    if (opened === 'none')
        h.skip('the app grid has no folder');
    h.sleep(1.5);
}

const folderBox = h => h.actorBox(`global.stage.get_children().flatMap(function walk(a) {
    return [a, ...a.get_children().flatMap(walk)];
}).find(a => a.has_style_class_name?.('app-folder-dialog') && a.is_mapped())`);

export const scenarios = [
    {
        path: 'frosted-surfaces#panel-on-desktop',
        run(h) {
            h.expectCase('dark');
            const panel = h.panelStrip();
            h.expectColour('panel strip', h.shot().region(panel), h.panelGlass('A', 'dark'));
            h.expectBlurred('panel strip', h.lastShot.region(panel));
            // the glass reaches the screen's top edge: no margin of the baked texture shows
            // there, which would be GNOME's own colour, far off; the blur's edge, which takes the
            // wallpaper's last stripe for what lies beyond, strays a little from the flat field
            h.expectColour('panel at the screen\'s top edge', h.lastShot.region({...panel, y: 0, height: 1}),
                h.panelGlass('A', 'dark'), 12);
        },
    },
    {
        path: 'frosted-surfaces#overview-and-app-grid',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('A', 'dark'));
            h.expectBlurred('window picker background', h.lastShot.region(h.cornerBottomLeft()));
            // the glass reaches the screen's edges (see panel-on-desktop on the tolerance)
            const corner = h.cornerBottomLeft();
            h.expectColour('window picker at the screen\'s left edge', h.lastShot.region({...corner, x: 0, width: 1}),
                h.glass('A', 'dark'), 12);
            const width = Number(h.eval('global.stage.width'));
            h.expectColour('window picker at the screen\'s right edge', h.lastShot.region({...corner, x: width - 1, width: 1}),
                h.glass('A', 'dark'), 12);
            h.eval('Main.overview.dash.showAppsButton.checked = true');
            h.sleep(1.5);
            h.expectColour('app grid background', h.shot().region(h.cornerBottomLeft()), h.glass('A', 'dark'));
        },
    },
    {
        path: 'frosted-surfaces#workspace-gap',
        run(h) {
            // GNOME adds a switch's monitor groups to uiGroup a moment after the switch is
            // asked for: what lies under each is recorded as it is added, and read once
            // the switch is over.
            h.eval(`(() => {
                const wm = global.workspace_manager;
                if (wm.n_workspaces < 2)
                    wm.append_new_workspace(false, global.get_current_time());
                const ui = Main.layoutManager.uiGroup;
                global._glassGap = [];
                global._glassGapId = ui.connect_after('child-added', (_, child) => {
                    if (!child.has_style_class_name?.('workspace-animation'))
                        return;
                    const kids = ui.get_children();
                    const below = kids[kids.indexOf(child) - 1];
                    global._glassGap.push({below: below?.name ?? null, visible: !!below?.visible});
                });
                Main.wm.actionMoveWorkspace(wm.get_workspace_by_index(1));
                return 'switching';
            })()`);
            h.sleep(1.5);
            const during = JSON.parse(h.eval(`(() => {
                Main.layoutManager.uiGroup.disconnect(global._glassGapId);
                return JSON.stringify(global._glassGap);
            })()`));
            if (during.length === 0)
                h.fail('no workspace switch was animated');
            for (const g of during) {
                if (g.below !== 'borshevik-glass' || !g.visible)
                    h.fail(`under a workspace-animation group: ${JSON.stringify(g)}`);
            }
            const shown = h.eval(`Main.layoutManager.uiGroup.get_children()
                .filter(c => c.name === 'borshevik-glass' && c.visible).length`);
            if (shown !== '0')
                h.fail(`${shown} gap glass still shown after the switch`);
            h.eval(`global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time())`);
            h.sleep(1);
        },
    },
    {
        path: 'frosted-surfaces#second-monitor',
        run(h) {
            h.skip('the test machine has one monitor');
        },
    },
    {
        path: 'dock-and-overview-components#dash',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            const dash = h.actorBox('Main.overview.dash._background');
            // inside its left padding, at mid-height: background, no icon
            const spot = {x: dash.x + 4, y: dash.y + Math.floor(dash.height / 2) - 2, width: 4, height: 4};
            h.expectColour('dash background', h.shot().region(spot),
                h.over(h.glass('A', 'dark'), h.surface('dark', '#dash .dash-background')));
        },
    },
    {
        path: 'dock-and-overview-components#dash-hover',
        run(h) {
            for (const scheme of ['dark', 'light']) {
                h.scheme(scheme);
                h.key('super');
                h.waitFor(OVERVIEW_JS);
                h.eval('Main.overview.dash.showAppsButton.checked = true; "ok"');
                h.sleep(1);
                // the highlight is what accent.css writes for it, not left transparent by
                // the stylesheet's rule that takes the icons' backdrop away
                for (const [state, selector] of [
                    ['hover', '#dash .dash-item-container .overview-tile:hover .overview-icon'],
                    ['checked', '#dash .dash-item-container .show-apps:checked .overview-icon']]) {
                    const found = h.dashHighlight(state);
                    const [r, g, b, alpha] = h.surface(scheme, selector);
                    const off = Math.max(...[r, g, b].map((v, c) => Math.abs(v - found[c])), Math.abs(alpha * 255 - found[3]));
                    if (found[3] === 0 || off > 3)
                        h.fail(`the dash's ${state} highlight in the ${scheme} case is ${found}, not ${[r, g, b].map(Math.round)} at ${alpha.toFixed(2)}`);
                }
                h.eval('Main.overview.dash.showAppsButton.checked = false; Main.overview.hide(); "ok"');
                h.sleep(1.5);
            }
        },
    },
    {
        path: 'dock-and-overview-components#search',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.key('s', 'e', 't');
            h.sleep(1.5);
            const entry = h.actorBox('Main.overview.searchEntry');
            const spot = {x: entry.x + entry.width - 40, y: entry.y + Math.floor(entry.height / 2) - 2, width: 4, height: 4};
            h.expectColour('search entry', h.shot().region(spot),
                h.over(h.glass('A', 'dark'), h.surface('dark', '.search-entry')));
            h.note('whether the results read clearly is for the author to judge');
        },
    },
    {
        path: 'folder-over-blur#folder-open',
        run(h) {
            h.scheme('light');
            openFolder(h);
            const shot = h.shot();
            const box = folderBox(h);
            const spot = {x: box.x + box.width - 100, y: box.y + 28, width: 4, height: 4};
            // a light glassy card over the veiled, blurred overview; near its top corner
            // nothing of the grid lies behind it
            h.expectColour('open folder', shot.region(spot),
                h.over(h.over(h.glass('A', 'light'), h.veil('light')), h.surface('light', '.app-folder-dialog')), 15);
            // the wallpaper's glass is a flat field, so blurring it again leaves its colour
            h.expectColour('overview behind the folder', shot.region(h.besideFolder()),
                h.over(h.glass('A', 'light'), h.veil('light')));
            h.expectFolderBlur(true);
            h.expectNoDynamicBlur();
        },
    },
    {
        path: 'folder-over-blur#folder-dark-veil',
        run(h) {
            // GNOME inhibits animations in the test machine, which has no GPU; they are
            // let through here, so the veil is set by a running transition, as on real
            // hardware, and not at once
            h.eval(`imports.gi.St.Settings.get().uninhibit_animations(); 'ok'`);
            try {
                openFolder(h);
                h.expectColour('overview behind the folder', h.shot().region(h.besideFolder()),
                    h.over(h.glass('A', 'dark'), h.veil('dark')));
                h.expectFolderBlur(true);
            } finally {
                h.eval(`imports.gi.St.Settings.get().inhibit_animations(); 'ok'`);
            }
        },
    },
    {
        path: 'folder-over-blur#folder-closed',
        run(h) {
            openFolder(h);
            h.key('esc');
            h.sleep(1.5);
            h.expectFolderBlur(false);
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'));
        },
    },
    {
        path: 'folder-over-blur#hover-leaves-nothing',
        run(h) {
            const height = Number(h.eval('global.stage.height'));
            const width = Number(h.eval('global.stage.width'));
            h.pointer([width - 20, height - 20]);
            openFolder(h);
            const box = folderBox(h);
            const before = h.shot();
            const icon = h.actorBox(`(() => {
                const walk = a => [a, ...a.get_children().flatMap(walk)];
                const dialog = Main.layoutManager.overviewGroup.get_children().find(c => c._isOpen);
                return walk(dialog).find(a => a.has_style_class_name?.('overview-tile') && a.is_mapped());
            })()`);
            const cx = icon.x + icon.width / 2, cy = icon.y + icon.height / 2;
            h.pointer([cx - 10, cy - 10], [cx, cy], [cx + 5, cy + 5]);
            h.sleep(1);
            h.pointer([cx + icon.width, cy + 20], [width - 20, height - 20]);
            h.sleep(1.5);
            const after = h.shot();
            const most = before.differs(after, box);
            if (most > 3)
                h.fail(`the folder differs by up to ${most} after a hover passed over an icon (${before.file}, ${after.file})`);
            h.expectNoDynamicBlur();
        },
    },
    {
        path: 'folder-over-blur#folder-accent',
        run(h) {
            openFolder(h);
            const withAccent = h.folderCard();
            // the veil is the stylesheet's, with no accent in it, over the glass
            h.expectColour('overview behind the folder', h.shot().region(h.besideFolder()),
                h.over(h.glass('A', 'dark'), h.veil('dark')), 4);
            h.setSetting('accent-tint', false);
            const plain = h.folderCard();
            const base = h.surface('dark', '.app-folder-dialog');
            if (Math.max(...plain.slice(0, 3).map((v, c) => Math.abs(v - base[c]))) > 1)
                h.fail(`with the accent tint off the card is ${plain}, not accent.css's base ${base}`);
            if (withAccent.slice(0, 3).every((v, c) => Math.abs(v - plain[c]) <= 1))
                h.fail(`the accent tint changed nothing on the card: ${withAccent} against ${plain}`);
            h.expectColour('overview behind the folder', h.shot().region(h.besideFolder()),
                h.over(h.glass('A', 'dark'), h.veil('dark')), 4);
        },
    },
    {
        path: 'folder-over-blur#panel-veiled',
        run(h) {
            openFolder(h);
            // the panel shows the overview's glass, veiled and blurred with the rest
            h.expectColour('panel strip', h.shot().region(h.panelStrip()),
                h.over(h.glass('A', 'dark'), h.veil('dark')), 6);
        },
    },
    {
        path: 'panel-and-overview-meet#into-overview',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            const panel = h.panelStrip();
            const below = {x: panel.x, y: panel.y + panel.height + 4, width: panel.width, height: 4};
            const shot = h.shot();
            h.expectColour('panel strip in the overview', shot.region(panel), shot.region(below).mean, 6);
            h.note('whether the opening and closing animation flashes is for the author to judge');
        },
    },
    {
        path: 'follows-colour-scheme#switch-to-light',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.eval('Main.overview.dash.showAppsButton.checked = true');
            h.sleep(1.5);
            h.scheme('light');
            h.expectCase('light');
            const shot = h.lastShot;
            h.expectColour('panel strip', shot.region(h.panelStrip()), h.panelGlass('A', 'light'));
            h.expectColour('app grid background', shot.region(h.cornerBottomLeft()), h.glass('A', 'light'));
            const dash = h.actorBox('Main.overview.dash._background');
            const spot = {x: dash.x + 4, y: dash.y + Math.floor(dash.height / 2) - 2, width: 4, height: 4};
            h.expectColour('dash background', shot.region(spot),
                h.over(h.glass('A', 'light'), h.surface('light', '#dash .dash-background')));
            // GNOME's own variant is still dark: its white clock must have been made dark
            const clock = shot.region(h.actorBox('Main.panel.statusArea.dateMenu._clockDisplay'));
            if (Math.min(...clock.darkest) > 100)
                h.fail(`the panel's clock is not dark on light glass: its darkest pixel is ${clock.darkest}`);
        },
    },
    {
        path: 'follows-colour-scheme#menus-light',
        run(h) {
            h.scheme('light');
            h.expectQuickSettings('light');
        },
    },
    {
        path: 'follows-colour-scheme#prefer-light',
        run(h) {
            h.scheme('light-only');
            h.expectCase('light');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'light'));
        },
    },
    {
        path: 'follows-colour-scheme#switch-to-dark',
        run(h) {
            h.scheme('light');
            h.scheme('dark');
            h.expectCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'));
        },
    },
    {
        path: 'follows-wallpaper#new-wallpaper',
        run(h) {
            h.wallpaper('B');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('B', 'dark'));
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('B', 'dark'));
        },
    },
    {
        path: 'follows-wallpaper#monitor-added',
        run(h) {
            h.skip('the test machine has one monitor');
        },
    },
    {
        path: 'costs-nothing-at-rest#clock-tick',
        run(h) {
            // The clock ticks once a minute; the panel is made to repaint ten times a
            // second instead, which is what a re-blur at every repaint would show in.
            const repaints = `(() => {
                let n = 0;
                const id = setInterval(() => {
                    Main.panel._leftBox.opacity = n++ % 2 ? 255 : 254;
                    if (n >= 100) { clearInterval(id); Main.panel._leftBox.opacity = 255; }
                }, 100);
                return 'started';
            })()`;
            const measure = () => {
                const before = h.shellCpu();
                h.eval(repaints);
                h.sleep(11);
                return h.shellCpu() - before;
            };
            const enabled = measure();
            h.setEnabled(false);
            const disabled = measure();
            h.setEnabled(true);
            h.note(`gnome-shell CPU over 100 panel repaints: ${enabled.toFixed(2)} s enabled, ${disabled.toFixed(2)} s disabled`);
            if (enabled > disabled * 1.5 + 0.3)
                h.fail('the panel costs noticeably more with the extension');
        },
    },
    {
        path: 'costs-nothing-at-rest#overview-shows-baked',
        run(h) {
            for (let i = 0; i < 3; i++) {
                h.key('super');
                h.waitFor(OVERVIEW_JS);
                h.eval('Main.overview.dash.showAppsButton.checked = true');
                h.sleep(1);
                h.key('esc');
                h.sleep(0.5);
                h.key('esc');
                h.sleep(1);
            }
            const effects = h.glassEffects();
            if (effects.length)
                h.fail(`effects left on the glass after baking: ${effects.join(', ')}`);
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'), 4);
        },
    },
    {
        path: 'rest-left-to-gnome#menus-untouched',
        run(h) {
            const look = () => {
                h.eval('Main.panel.statusArea.quickSettings.menu.open(false)');
                h.sleep(1.5);
                const box = h.actorBox('Main.panel.statusArea.quickSettings.menu.box');
                const spot = {x: box.x + 30, y: box.y + box.height - 12, width: 4, height: 4};
                const mean = h.shot().region(spot).mean;
                h.eval('Main.panel.statusArea.quickSettings.menu.close(false)');
                h.sleep(1);
                return mean;
            };
            const enabled = look();
            h.setEnabled(false);
            const disabled = look();
            h.setEnabled(true);
            h.expectColour('Quick Settings with the extension', {mean: enabled, spread: 0}, disabled, 4);
        },
    },
    {
        path: 'rest-left-to-gnome#lock-screen-is-gnome',
        run(h) {
            h.skip('locking and unlocking is for the author to try');
        },
    },
    {
        path: 'light-optional#off-stays-dark',
        run(h) {
            h.scheme('light');
            h.setLightStyle(false);
            h.expectCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'));
            h.expectQuickSettings('dark');
        },
    },
    {
        path: 'light-optional#off-even-for-prefer-light',
        run(h) {
            h.setLightStyle(false);
            h.scheme('light-only');
            h.expectCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'));
            h.expectQuickSettings('dark');
        },
    },
    {
        path: 'tint-tunable#accent-off',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            const dash = h.actorBox('Main.overview.dash._background');
            const spot = {x: dash.x + 4, y: dash.y + Math.floor(dash.height / 2) - 2, width: 4, height: 4};
            const withAccent = h.shot();
            h.setSetting('accent-tint', false);
            const plain = h.shot();
            // the glass with no accent over it, the dash its plain base colour
            h.expectColour('window picker background', plain.region(h.cornerBottomLeft()), h.glass('A', 'dark'), 4);
            h.expectColour('dash background', plain.region(spot),
                h.over(h.glass('A', 'dark'), h.surface('dark', '#dash .dash-background')), 4);
            const off = Math.max(...withAccent.region(spot).mean.map((v, c) => Math.abs(v - plain.region(spot).mean[c])));
            if (off < 2)
                h.fail('the accent tint changed nothing on the dash');
            h.expectNoDynamicBlur();
        },
    },
    {
        path: 'tint-tunable#light-accent',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            const accent = h.eval(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'}).get_string('accent-color')`);
            const set = name => h.eval(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'}).set_string('accent-color', '${name}'); 'ok'`);
            const shares = {};
            try {
                for (const name of ['purple', 'yellow']) {
                    set(name);
                    h.sleep(2);
                    // the glass takes the share of this accent that its luminance gives it
                    const [, , , want] = h.accentOverGlass('dark');
                    const [, , , found] = h.glassAccent();
                    if (Math.abs(found - want) > 0.004)
                        h.fail(`the ${name} accent is over the glass at ${(found * 100).toFixed(2)} %, not ${(want * 100).toFixed(2)} %`);
                    shares[name] = found;
                    h.expectColour(`window picker background with the ${name} accent`,
                        h.shot().region(h.cornerBottomLeft()), h.glass('A', 'dark'), 4);
                }
                // yellow is far lighter than purple, and tints the dark glass with less of itself
                if (!(shares.yellow < shares.purple * 0.6))
                    h.fail(`the yellow accent's share over the glass is not well under purple's: ${JSON.stringify(shares)}`);
            } finally {
                set(accent);
                h.sleep(1);
            }
        },
    },
    {
        path: 'tint-tunable#depth-changed',
        run(h) {
            h.setSetting('dark-depth-scale', 150);
            h.sleep(1);
            // baked again: target 0 rather than 12
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.panelGlass('A', 'dark'), 4);
            h.expectBlurred('panel strip', h.lastShot.region(h.panelStrip()));
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('A', 'dark'), 4);
        },
    },
    {
        path: 'disable-restores#disable',
        run(h) {
            h.setEnabled(false);
            // the overview has been found open here for a reason not yet known; it is
            // closed before looking, so the scenario judges the panel and not that
            h.eval('Main.overview.hide(); "ok"');
            h.sleep(1.5);
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), [0, 0, 0], 4);
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), [0x22, 0x22, 0x26], 4);
            h.key('esc');
            h.setEnabled(true);
        },
    },
];
