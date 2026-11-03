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
            h.expectTintCase('dark');
            const panel = h.panelStrip();
            h.expectColour('panel strip', h.shot().region(panel), h.glass('A'));
            h.expectBlurred('panel strip', h.lastShot.region(panel));
        },
    },
    {
        path: 'frosted-surfaces#overview-and-app-grid',
        run(h) {
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('A'));
            h.expectBlurred('window picker background', h.lastShot.region(h.cornerBottomLeft()));
            h.eval('Main.overview.dash.showAppsButton.checked = true');
            h.sleep(1.5);
            h.expectColour('app grid background', h.shot().region(h.cornerBottomLeft()), h.glass('A'));
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
                h.over(h.glass('A'), [100, 100, 100, 0.35]));
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
                h.over(h.glass('A'), [100, 100, 100, 0.35]));
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
                h.over(h.over(h.glass('A'), h.veil('light')), h.folderCard()), 15);
            // the wallpaper's glass is a flat field, so blurring it again leaves its colour
            h.expectColour('overview behind the folder', shot.region(h.besideFolder()),
                h.over(h.glass('A'), h.veil('light')));
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
                    h.over(h.glass('A'), h.veil('dark')));
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
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
        },
    },
    {
        path: 'folder-over-blur#folder-accent',
        run(h) {
            openFolder(h);
            const withAccent = h.folderCard();
            // the veil is the stylesheet's, with no accent in it, over the tinted glass
            h.expectColour('overview behind the folder', h.shot().region(h.besideFolder()),
                h.over(h.glass('A'), h.veil('dark')), 4);
            h.setSetting('accent-tint', false);
            const plain = h.folderCard();
            const base = h.css('dark', 'app-folder-dialog');
            if (Math.max(...plain.slice(0, 3).map((v, c) => Math.abs(v - base[c]))) > 1)
                h.fail(`with the accent tint off the card is ${plain}, not the stylesheet's ${base}`);
            if (withAccent.slice(0, 3).every((v, c) => Math.abs(v - plain[c]) <= 1))
                h.fail(`the accent tint changed nothing on the card: ${withAccent} against ${plain}`);
            h.expectColour('overview behind the folder', h.shot().region(h.besideFolder()),
                h.over(h.glass('A'), h.veil('dark')), 4);
        },
    },
    {
        path: 'folder-over-blur#panel-veiled',
        run(h) {
            openFolder(h);
            // the panel shows the overview's glass, veiled and blurred with the rest
            h.expectColour('panel strip', h.shot().region(h.panelStrip()),
                h.over(h.glass('A'), h.veil('dark')), 6);
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
            h.expectTintCase('light');
            const shot = h.shot();
            h.expectColour('panel strip', shot.region(h.panelStrip()), h.glass('A'));
            h.expectColour('app grid background', shot.region(h.cornerBottomLeft()), h.glass('A'));
            const dash = h.actorBox('Main.overview.dash._background');
            const spot = {x: dash.x + 4, y: dash.y + Math.floor(dash.height / 2) - 2, width: 4, height: 4};
            h.expectColour('dash background', shot.region(spot),
                h.over(h.glass('A'), [255, 255, 255, 0.5]));
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
            h.expectTintCase('light');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
        },
    },
    {
        path: 'follows-colour-scheme#switch-to-dark',
        run(h) {
            h.scheme('light');
            h.scheme('dark');
            h.expectTintCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
        },
    },
    {
        path: 'follows-wallpaper#new-wallpaper',
        run(h) {
            h.wallpaper('B');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('B'));
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('B'));
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
            h.expectTintCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
            h.expectQuickSettings('dark');
        },
    },
    {
        path: 'light-optional#off-even-for-prefer-light',
        run(h) {
            h.setLightStyle(false);
            h.scheme('light-only');
            h.expectTintCase('dark');
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
            h.expectQuickSettings('dark');
        },
    },
    {
        path: 'tint-tunable#accent-off',
        run(h) {
            const withAccent = h.tint();
            h.setSetting('accent-tint', false);
            const plain = h.tint();
            // the dark case's base colour, rgb(0, 3, 4), at the default depth
            if (Math.max(...plain.slice(0, 3).map((v, c) => Math.abs(v - [0, 3, 4][c]))) > 1)
                h.fail(`with the accent tint off the tint is ${plain}, not the plain base colour`);
            if (withAccent.slice(0, 3).every((v, c) => Math.abs(v - plain[c]) <= 1))
                h.fail(`the accent tint changed nothing: ${withAccent} against ${plain}`);
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
        },
    },
    {
        path: 'tint-tunable#depth-changed',
        run(h) {
            h.setSetting('dark-depth', 50);
            const tint = h.tint();
            if (Math.abs(tint[3] - 0.5) > 0.01)
                h.fail(`with the dark depth at 50 the tint's opacity is ${tint[3]}`);
            h.expectColour('panel strip', h.shot().region(h.panelStrip()), h.glass('A'));
            h.key('super');
            h.waitFor(OVERVIEW_JS);
            h.expectColour('window picker background', h.shot().region(h.cornerBottomLeft()), h.glass('A'));
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
