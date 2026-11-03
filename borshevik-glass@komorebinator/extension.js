// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Logical pixels, scaled by the monitor scale factor: Borshevik's Blur my Shell sigma.
const BLUR_RADIUS = 30;

// The style class GNOME gives each monitor's group while workspaces slide.
const WORKSPACE_ANIMATION_STYLE = 'workspace-animation';

// The alpha of GNOME's own folder veil (DIALOG_SHADE_NORMAL); its veil while an
// icon is dragged over the folder is lighter, and ours is scaled in proportion.
const GNOME_VEIL_ALPHA = 204;

// The name of the blur behind an open folder, on GNOME's folder dialog.
const FOLDER_BLUR = 'borshevik-glass-folder-blur';

// On Main.uiGroup while GNOME's dark style is off and the light style on: the
// stylesheet's light rules.
const LIGHT_STYLE = 'borshevik-glass-light';

// The session mode colour schemes the extension sets: under the first GNOME Shell
// is dark only for prefer-dark, under the second always, with the light style off.
const LIGHT_SESSION_SCHEME = 'prefer-light';
const DARK_SESSION_SCHEME = 'force-dark';
const OWN_SESSION_SCHEMES = [LIGHT_SESSION_SCHEME, DARK_SESSION_SCHEME];

// The settings the tint is made from.
const TINT_KEYS = ['accent-tint', 'accent-amount', 'dark-depth', 'light-depth'];

// One monitor's wallpaper, blurred once, under a tint. The blur is
// Shell.BlurEffect in ACTOR mode on the group holding the wallpaper, so it is
// rendered again only when the wallpaper itself changes; brightness stays at 1
// and the tint, which the extension colours (_applyTint), is all that darkens
// or lightens it.
const Glass = GObject.registerClass(
class Glass extends St.Widget {
    _init(monitor, scaleFactor) {
        super._init({
            name: 'borshevik-glass',
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });

        const backgrounds = new Meta.BackgroundGroup({
            width: monitor.width,
            height: monitor.height,
        });
        backgrounds.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            brightness: 1,
            radius: BLUR_RADIUS * scaleFactor,
        }));
        this.add_child(backgrounds);

        this.tint = new St.Widget({
            style_class: 'borshevik-glass-tint',
            width: monitor.width,
            height: monitor.height,
        });
        this.add_child(this.tint);

        const bgManager = new Background.BackgroundManager({
            container: backgrounds,
            monitorIndex: monitor.index,
            controlPosition: false,
        });
        this.connect('destroy', () => bgManager.destroy());
    }
});

const isGnomeVeil = c => c?.red === 0 && c.green === 0 && c.blue === 0 && c.alpha > 0;

export default class BorshevikGlassExtension extends Extension {
    enable() {
        this._actors = [];
        this._glasses = [];
        this._gnomeSessionScheme = null;
        this._settings = this.getSettings();

        // Hold no picture: their theme nodes are where colours written in the
        // stylesheet are read — the folder veil's, the tint's base colour of the
        // current case, and GNOME's accent colour.
        this._probes = {
            veil: new St.Widget({style_class: 'borshevik-glass-folder-veil', visible: false}),
            tint: new St.Widget({style_class: 'borshevik-glass-tint', visible: false}),
            accent: new St.Widget({style_class: 'borshevik-glass-accent', visible: false}),
        };
        Object.values(this._probes).forEach(probe => Main.layoutManager.uiGroup.add_child(probe));

        Main.layoutManager.connectObject('monitors-changed',
            () => this._rebuild(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._rebuild(),
            // a reloaded theme may have a new accent colour, or new base colours
            'changed', () => this._applyTint(),
            this);
        Main.layoutManager.overviewGroup.connectObject('child-added',
            (_, child) => this._onOverviewChildAdded(child), this);
        Main.layoutManager.uiGroup.connectObject('child-added',
            (_, child) => this._onUiChildAdded(child), this);
        St.Settings.get().connectObject(
            'notify::color-scheme', () => this._syncScheme(),
            'notify::accent-color', () => this._applyTint(),
            this);
        Main.sessionMode.connectObject('updated',
            () => this._syncSessionScheme(), this);
        this._settings.connectObject('changed', (_, key) => {
            if (key === 'light-style') {
                this._syncSessionScheme();
                this._syncScheme();
            } else if (TINT_KEYS.includes(key)) {
                this._applyTint();
            }
        }, this);

        this._syncSessionScheme();
        this._syncScheme();
        this._build();
        Main.layoutManager.overviewGroup.get_children()
            .filter(child => child instanceof AppDisplay.AppFolderDialog)
            .forEach(dialog => this._watchFolder(dialog));
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        Main.layoutManager.overviewGroup.disconnectObject(this);
        Main.layoutManager.uiGroup.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._settings.disconnectObject(this);
        Main.layoutManager.overviewGroup.get_children()
            .filter(child => child instanceof AppDisplay.AppFolderDialog)
            .forEach(dialog => {
                dialog.disconnectObject(this);
                dialog.remove_effect_by_name(FOLDER_BLUR);
            });

        if (this._gnomeSessionScheme !== null && OWN_SESSION_SCHEMES.includes(Main.sessionMode.colorScheme)) {
            Main.sessionMode.colorScheme = this._gnomeSessionScheme;
            St.Settings.get().notify('color-scheme');
        }
        this._gnomeSessionScheme = null;

        Main.layoutManager.uiGroup.remove_style_class_name(LIGHT_STYLE);
        Object.values(this._probes).forEach(probe => probe.destroy());
        this._probes = null;
        this._destroyActors();
        this._actors = null;
        this._glasses = null;
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
        this._applyTint();
    }

    // One colour on every tint: the case's base colour from the stylesheet,
    // mixed with GNOME's accent colour by the accent amount, at the case's depth.
    _applyTint() {
        if (!this._glasses.length)
            return;
        const base = this._probes.tint.get_theme_node().get_background_color();
        const accent = this._probes.accent.get_theme_node().get_background_color();
        const dark = !Main.layoutManager.uiGroup.has_style_class_name(LIGHT_STYLE);
        const depth = this._settings.get_int(dark ? 'dark-depth' : 'light-depth') / 100;
        const amount = this._settings.get_boolean('accent-tint')
            ? this._settings.get_int('accent-amount') / 100 : 0;
        const [red, green, blue] = ['red', 'green', 'blue']
            .map(c => Math.round(base[c] * (1 - amount) + accent[c] * amount));
        const style = `background-color: rgba(${red}, ${green}, ${blue}, ${depth});`;
        this._glasses.forEach(glass => glass.tint.set_style(style));
    }

    _rebuild() {
        this._destroyActors();
        this._build();
    }

    _destroyActors() {
        this._actors.forEach(actor => actor.destroy());
        this._actors = [];
        this._glasses = [];
        this._overviewGlass = null;
        this._gapGlasses = [];
    }

    _build() {
        const {monitors, primaryMonitor, panelBox, overviewGroup, uiGroup} = Main.layoutManager;
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const glass = monitor => {
            const made = new Glass(monitor, scaleFactor);
            this._glasses.push(made);
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

        this._applyTint();
    }

    _onOverviewChildAdded(child) {
        if (this._overviewGlass && child !== this._overviewGlass)
            Main.layoutManager.overviewGroup.set_child_below_sibling(this._overviewGlass, null);
        if (child instanceof AppDisplay.AppFolderDialog)
            this._watchFolder(child);
    }

    // GNOME eases a folder dialog's background_color to its black veil as the
    // folder opens; the running transition is retargeted to ours, or, when GNOME
    // set the colour without animating, ours is set at once. The overview behind
    // the folder is blurred by as much as it is veiled, so the blur comes and
    // goes with GNOME's animation and is off whenever there is no veil.
    _watchFolder(dialog) {
        if (!dialog.get_effect(FOLDER_BLUR)) {
            dialog.add_effect_with_name(FOLDER_BLUR, new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                brightness: 1,
                radius: 0,
                enabled: false,
            }));
        }

        dialog.connectObject('notify::background-color', () => {
            const transition = dialog.get_transition('background-color');
            if (transition) {
                const target = transition.get_interval().peek_final_value();
                if (isGnomeVeil(target))
                    transition.set_to(this._veil(target.alpha));
            } else if (isGnomeVeil(dialog.background_color)) {
                dialog.background_color = this._veil(dialog.background_color.alpha);
                return; // setting it notified again, and that call syncs the blur
            }
            this._syncFolderBlur(dialog);
        }, this);
    }

    _syncFolderBlur(dialog) {
        const blur = dialog.get_effect(FOLDER_BLUR);
        const full = this._veil(GNOME_VEIL_ALPHA).alpha;
        const share = full > 0 ? Math.min(1, dialog.background_color.alpha / full) : 0;
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        blur.radius = Math.round(BLUR_RADIUS * scaleFactor * share);
        blur.enabled = blur.radius > 0;
    }

    _veil(gnomeAlpha) {
        const {red, green, blue, alpha} = this._probes.veil.get_theme_node().get_background_color();
        return new Cogl.Color({red, green, blue, alpha: Math.round(alpha * gnomeAlpha / GNOME_VEIL_ALPHA)});
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
