// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {glassAccentShare} from './adapt.js';
import {FolderBackdrop} from './folder.js';
import {BAKE_MARGIN, MonitorGlass} from './glass.js';

// The style class GNOME gives each monitor's group while workspaces slide.
const WORKSPACE_ANIMATION_STYLE = 'workspace-animation';

// On Main.uiGroup while GNOME's dark style is off and the light style on: the
// stylesheet's light rules.
const LIGHT_STYLE = 'borshevik-glass-light';

// The session mode colour schemes the extension sets: under the first GNOME Shell
// is dark only for prefer-dark, under the second always, with the light style off.
const LIGHT_SESSION_SCHEME = 'prefer-light';
const DARK_SESSION_SCHEME = 'force-dark';
const OWN_SESSION_SCHEMES = [LIGHT_SESSION_SCHEME, DARK_SESSION_SCHEME];

// The accent's share, in per cent at an accent strength of 100 %, of the
// surfaces on the glass — an open folder's card among them — per case, and of
// the light glass: the dark case's surfaces take half of the light one's, at
// which the author found them right on a real screen. The dark glass's share
// depends on the accent itself (adapt.js).
const ACCENT_SHARES = {
    light: {glass: 8, surface: 25},
    dark: {surface: 12.5},
};

// The settings the glass is baked with, and those the accent stylesheet is.
const DEPTH_KEYS = ['dark-depth-scale', 'light-depth-scale'];
const ACCENT_KEYS = ['accent-tint', 'accent-scale'];

// What one surface shows of a monitor's glass: the baked content, and the
// accent over it, coloured by the accent stylesheet.
const Glass = GObject.registerClass(
class Glass extends St.Widget {
    _init(monitor) {
        super._init({
            name: 'borshevik-glass',
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            // the baked texture's margin lies outside: not shown, not stretched in
            clip_to_allocation: true,
        });
        const {before, after} = BAKE_MARGIN;
        this.picture = new Clutter.Actor({
            x: -before,
            y: -before,
            width: monitor.width + before + after,
            height: monitor.height + before + after,
        });
        this.add_child(this.picture);
        this.add_child(new St.Widget({
            style_class: 'borshevik-glass-accent',
            width: monitor.width,
            height: monitor.height,
        }));
    }
});

const CLEAR = new Cogl.Color({red: 0, green: 0, blue: 0, alpha: 0});

export default class BorshevikGlassExtension extends Extension {
    enable() {
        this._actors = [];
        this._monitorGlasses = [];
        this._surfaces = [];
        this._gnomeSessionScheme = null;
        this._accentFile = null;
        this._settings = this.getSettings();

        // The blur under each folder dialog's card (folder.js).
        this._backdrops = new WeakMap();

        // Holds no picture: its theme node is where GNOME's accent colour, which
        // sets the dark glass's share of it, is read.
        this._accentProbe = new St.Widget({style: 'background-color: -st-accent-color;', visible: false});
        Main.layoutManager.uiGroup.add_child(this._accentProbe);
        this._accentShare = null;
        this._accentIdleId = 0;

        Main.layoutManager.connectObject('monitors-changed',
            () => this._rebuild(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._rebuild(), this);
        Main.layoutManager.overviewGroup.connectObject('child-added',
            (_, child) => this._onOverviewChildAdded(child), this);
        Main.layoutManager.uiGroup.connectObject('child-added',
            (_, child) => this._onUiChildAdded(child), this);
        St.Settings.get().connectObject(
            'notify::color-scheme', () => this._syncScheme(),
            // read once GNOME's theme has the new colour
            'notify::accent-color', () => {
                this._accentIdleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._accentIdleId = 0;
                    this._writeAccentStyles(true);
                    return GLib.SOURCE_REMOVE;
                });
            },
            this);
        Main.sessionMode.connectObject('updated',
            () => this._syncSessionScheme(), this);
        this._settings.connectObject('changed', (_, key) => {
            if (key === 'light-style') {
                this._syncSessionScheme();
                this._syncScheme();
            } else if (DEPTH_KEYS.includes(key)) {
                this._applyCase();
            } else if (ACCENT_KEYS.includes(key)) {
                this._writeAccentStyles();
            }
        }, this);

        this._writeAccentStyles();
        this._syncSessionScheme();
        this._build();
        this._syncScheme();
        this._folders().forEach(dialog => this._watchFolder(dialog));
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        Main.layoutManager.overviewGroup.disconnectObject(this);
        Main.layoutManager.uiGroup.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._folders().forEach(dialog => {
            dialog.disconnectObject(this);
            this._backdrops.get(dialog)?.destroy();
        });
        this._backdrops = null;

        if (this._gnomeSessionScheme !== null && OWN_SESSION_SCHEMES.includes(Main.sessionMode.colorScheme)) {
            Main.sessionMode.colorScheme = this._gnomeSessionScheme;
            St.Settings.get().notify('color-scheme');
        }
        this._gnomeSessionScheme = null;

        Main.layoutManager.uiGroup.remove_style_class_name(LIGHT_STYLE);
        if (this._accentIdleId)
            GLib.source_remove(this._accentIdleId);
        this._accentIdleId = 0;
        this._unloadAccentStyles();
        this._accentProbe.destroy();
        this._accentProbe = null;
        this._destroyActors();
        this._actors = null;
        this._monitorGlasses = null;
        this._surfaces = null;
        this._settings = null;
    }

    // GNOME's user mode is prefer-dark, under which the shell is light only for
    // prefer-light; under prefer-light it is dark only for prefer-dark, the same
    // rule as the glass, and under force-dark always dark, for the light style
    // switched off. GNOME rebuilds the mode's properties at every update.
    _syncSessionScheme() {
        const target = this._settings.get_boolean('light-style')
            ? LIGHT_SESSION_SCHEME : DARK_SESSION_SCHEME;
        const current = Main.sessionMode.colorScheme;
        if (current === target)
            return;
        if (!OWN_SESSION_SCHEMES.includes(current))
            this._gnomeSessionScheme = current;
        Main.sessionMode.colorScheme = target;
        // what makes GNOME Shell pick its stylesheet again
        St.Settings.get().notify('color-scheme');
    }

    // Light unless dark style is on or the light style is switched off.
    _syncScheme() {
        const dark = !this._settings.get_boolean('light-style') ||
            St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
        if (dark)
            Main.layoutManager.uiGroup.remove_style_class_name(LIGHT_STYLE);
        else
            Main.layoutManager.uiGroup.add_style_class_name(LIGHT_STYLE);
        this._applyCase();
    }

    _isDark() {
        return !Main.layoutManager.uiGroup.has_style_class_name(LIGHT_STYLE);
    }

    // The current case and its depth; every monitor's glass bakes the lift its
    // wallpaper gives them, if it is new (adapt.js).
    _applyCase() {
        const dark = this._isDark();
        const depth = this._settings.get_int(dark ? 'dark-depth-scale' : 'light-depth-scale') / 100;
        this._monitorGlasses.forEach(glass => glass.setCase({dark, depth}));
    }

    // accent.css with the shares filled in, written under the user's runtime
    // directory and loaded after the extension's stylesheet in place of the
    // copy before; a new file name each time, so the theme cannot keep the old.
    // With `ifAccentMoved`, only if the accent colour gives the dark glass a new
    // share: writing reloads the theme, which must not write again.
    _writeAccentStyles(ifAccentMoved = false) {
        const {red, green, blue} = this._accentProbe.get_theme_node().get_background_color();
        const darkGlass = glassAccentShare(true, 0, [red, green, blue]);
        if (ifAccentMoved && this._accentShare !== null && Math.abs(darkGlass - this._accentShare) < 0.01)
            return;
        this._accentShare = darkGlass;

        const strength = this._settings.get_boolean('accent-tint')
            ? this._settings.get_int('accent-scale') / 100 : 0;
        const [, template] = this.dir.get_child('accent.css').load_contents(null);
        let css = new TextDecoder().decode(template);
        for (const [scheme, base] of Object.entries(ACCENT_SHARES)) {
            const shares = scheme === 'dark' ? {...base, glass: darkGlass} : base;
            for (const [key, share] of Object.entries(shares)) {
                // the glass's is what is left clear of the accent widget
                const value = key === 'glass' ? (1 - share * strength / 100).toFixed(4) : (share * strength).toFixed(3);
                css = css.replaceAll(`{{${scheme}-${key}}}`, value);
            }
        }

        const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'borshevik-glass']));
        try {
            dir.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
        const file = dir.get_child(`accent-${GLib.get_monotonic_time()}.css`);
        file.replace_contents(new TextEncoder().encode(css), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        this._unloadAccentStyles();
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
        this._accentFile = file;
    }

    _unloadAccentStyles() {
        if (!this._accentFile)
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._accentFile);
        try {
            this._accentFile.delete(null);
        } catch (e) {
            logError(e, 'Borshevik Glass: could not remove the accent stylesheet');
        }
        this._accentFile = null;
    }

    _folders() {
        return Main.layoutManager.overviewGroup.get_children()
            .filter(child => child instanceof AppDisplay.AppFolderDialog);
    }

    _rebuild() {
        this._destroyActors();
        this._build();
        this._applyCase();
    }

    _destroyActors() {
        this._monitorGlasses.forEach(glass => glass.destroy());
        this._monitorGlasses = [];
        this._actors.forEach(actor => actor.destroy());
        this._actors = [];
        this._surfaces = [];
        this._overviewGlass = null;
        this._gapGlasses = [];
    }

    _build() {
        const {monitors, primaryMonitor, panelBox, overviewGroup, uiGroup} = Main.layoutManager;
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);

        // One baked glass per monitor, shown by every surface of that monitor.
        for (const monitor of monitors) {
            this._surfaces[monitor.index] = [];
            // the panel is on the primary monitor alone, and so is the band under it
            const panel = monitor === primaryMonitor ? Main.panel.height : 0;
            this._monitorGlasses[monitor.index] = new MonitorGlass(monitor, scaleFactor, panel,
                content => this._surfaces[monitor.index]?.forEach(glass => glass.picture.set_content(content)));
        }
        const glass = monitor => {
            const made = new Glass(monitor);
            made.picture.set_content(this._monitorGlasses[monitor.index].content);
            this._surfaces[monitor.index].push(made);
            return made;
        };

        // The panel: a strip of the primary monitor's glass, kept under panelBox
        // with its geometry and visibility, so it hides with the panel for a
        // full-screen window. panelBox sits at the primary monitor's origin, so
        // the glass inside the strip lines up with the overview's below it.
        if (primaryMonitor) {
            const strip = new St.Widget({clip_to_allocation: true});
            strip.add_constraint(new Clutter.BindConstraint({
                source: panelBox,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            for (const property of ['visible', 'opacity', 'translation-y'])
                panelBox.bind_property(property, strip, property, GObject.BindingFlags.SYNC_CREATE);

            const panelGlass = glass(primaryMonitor);
            panelGlass.set_position(0, 0);
            strip.add_child(panelGlass);

            uiGroup.insert_child_below(strip, panelBox);
            this._actors.push(strip);
        }

        // The overview: every monitor's glass at the bottom of overviewGroup,
        // over GNOME's solid colour and under everything the overview shows.
        this._overviewGlass = new Clutter.Actor();
        for (const monitor of monitors)
            this._overviewGlass.add_child(glass(monitor));
        overviewGroup.insert_child_at_index(this._overviewGlass, 0);
        this._actors.push(this._overviewGlass);

        // The workspace gap: a glass per monitor, hidden until GNOME adds a
        // monitor group for a workspace switch (_onUiChildAdded).
        this._gapGlasses = monitors.map(monitor => {
            const gap = glass(monitor);
            gap.hide();
            uiGroup.add_child(gap);
            this._actors.push(gap);
            return gap;
        });
    }

    _onOverviewChildAdded(child) {
        if (this._overviewGlass && child !== this._overviewGlass)
            Main.layoutManager.overviewGroup.set_child_below_sibling(this._overviewGlass, null);
        if (child instanceof AppDisplay.AppFolderDialog)
            this._watchFolder(child);
    }

    // GNOME eases a folder dialog's background_color to a black veil as the
    // folder opens, lighter while an icon is dragged out over it, and back as it
    // closes; the dialog is kept clear instead, the transition dropped as it
    // starts (decisions#no-veil of folder-over-blur). What lies under the card is
    // blurred by the dialog's backdrop (folder.js).
    _watchFolder(dialog) {
        if (!this._backdrops.has(dialog))
            this._backdrops.set(dialog, new FolderBackdrop(dialog));

        dialog.connectObject('notify::background-color', () => {
            if (dialog.get_transition('background-color'))
                dialog.remove_transition('background-color');
            if (dialog.background_color.alpha !== 0)
                dialog.background_color = CLEAR;
        }, this);
        dialog.background_color = CLEAR;
    }

    // A workspace switch adds one St.Widget per monitor to uiGroup, right above
    // global.window_group; its background is made transparent by the
    // stylesheet, and the monitor's glass goes right under it while it lives.
    _onUiChildAdded(child) {
        if (!(child instanceof St.Widget) || !child.has_style_class_name(WORKSPACE_ANIMATION_STYLE))
            return;

        const index = child._monitor?.index ?? Main.layoutManager.primaryIndex;
        const glass = this._gapGlasses[index];
        if (!glass)
            return;

        Main.layoutManager.uiGroup.set_child_below_sibling(glass, child);
        glass.show();
        child.connectObject('destroy', () => glass.hide(), glass);
    }
}
