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
import * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Logical pixels, scaled by the monitor scale factor: Borshevik's Blur my Shell sigma.
const BLUR_RADIUS = 30;

// The style class GNOME gives each monitor's group while workspaces slide.
const WORKSPACE_ANIMATION_STYLE = 'workspace-animation';

// The alpha of GNOME's own folder veil (DIALOG_SHADE_NORMAL); its veil while an
// icon is dragged over the folder is lighter, and ours is scaled in proportion.
const GNOME_VEIL_ALPHA = 204;

// On Main.uiGroup while GNOME's dark style is off: the stylesheet's light rules.
const LIGHT_STYLE = 'borshevik-glass-light';

// The session mode colour scheme under which GNOME Shell is dark only for prefer-dark.
const LIGHT_SESSION_SCHEME = 'prefer-light';

// One monitor's wallpaper, blurred once, under a tint. The blur is
// Shell.BlurEffect in ACTOR mode on the group holding the wallpaper, so it is
// rendered again only when the wallpaper itself changes; brightness stays at 1
// and the tint, from the stylesheet, is all that darkens or lightens it.
const Glass = GObject.registerClass(
class Glass extends St.Widget {
    _init(monitor, scaleFactor, tintStyle = '') {
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

        this.add_child(new St.Widget({
            style_class: `borshevik-glass-tint ${tintStyle}`,
            width: monitor.width,
            height: monitor.height,
        }));

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
        this._gnomeSessionScheme = null;

        // Holds no picture: its theme node is where the folder veil's colour is read.
        this._veilStyle = new St.Widget({style_class: 'borshevik-glass-folder-veil', visible: false});
        Main.layoutManager.uiGroup.add_child(this._veilStyle);

        Main.layoutManager.connectObject('monitors-changed',
            () => this._rebuild(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject('notify::scale-factor',
            () => this._rebuild(), this);
        Main.layoutManager.overviewGroup.connectObject('child-added',
            (_, child) => this._onOverviewChildAdded(child), this);
        Main.layoutManager.uiGroup.connectObject('child-added',
            (_, child) => this._onUiChildAdded(child), this);
        St.Settings.get().connectObject('notify::color-scheme',
            () => this._syncScheme(), this);
        Main.sessionMode.connectObject('updated',
            () => this._syncSessionScheme(), this);
        Main.overview.connectObject(
            'showing', () => this._fadePanelGlass(0),
            'hiding', () => this._fadePanelGlass(255),
            this);

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
        Main.overview.disconnectObject(this);
        Main.layoutManager.overviewGroup.get_children()
            .forEach(child => child.disconnectObject?.(this));

        if (this._gnomeSessionScheme !== null && Main.sessionMode.colorScheme === LIGHT_SESSION_SCHEME) {
            Main.sessionMode.colorScheme = this._gnomeSessionScheme;
            St.Settings.get().notify('color-scheme');
        }
        this._gnomeSessionScheme = null;

        Main.layoutManager.uiGroup.remove_style_class_name(LIGHT_STYLE);
        this._veilStyle.destroy();
        this._veilStyle = null;
        this._destroyActors();
        this._actors = null;
    }

    // GNOME's user mode is prefer-dark, under which the shell is light only for
    // prefer-light; under prefer-light it is dark only for prefer-dark, the same
    // rule as the glass. GNOME rebuilds the mode's properties at every update.
    _syncSessionScheme() {
        if (Main.sessionMode.colorScheme === LIGHT_SESSION_SCHEME)
            return;
        this._gnomeSessionScheme = Main.sessionMode.colorScheme;
        Main.sessionMode.colorScheme = LIGHT_SESSION_SCHEME;
        // what makes GNOME Shell pick its stylesheet again
        St.Settings.get().notify('color-scheme');
    }

    // Light unless dark style is on.
    _syncScheme() {
        const dark = St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_DARK;
        if (dark)
            Main.layoutManager.uiGroup.remove_style_class_name(LIGHT_STYLE);
        else
            Main.layoutManager.uiGroup.add_style_class_name(LIGHT_STYLE);
    }

    _rebuild() {
        this._destroyActors();
        this._build();
    }

    _destroyActors() {
        this._actors.forEach(actor => actor.destroy());
        this._actors = [];
        this._panelGlass = null;
        this._overviewGlass = null;
        this._gapGlasses = [];
    }

    _build() {
        const {monitors, primaryMonitor, panelBox, overviewGroup, uiGroup} = Main.layoutManager;
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);

        // The panel: a strip of the primary monitor's glass, kept under panelBox
        // with its geometry and visibility, so it hides with the panel for a
        // full-screen window. panelBox sits at the primary monitor's origin, so
        // the glass inside the strip lines up with the overview's below it. Its
        // tint is the panel's own; in the overview it fades out, and the panel,
        // transparent there, shows the overview's glass.
        if (primaryMonitor) {
            const strip = new St.Widget({clip_to_allocation: true});
            strip.add_constraint(new Clutter.BindConstraint({
                source: panelBox,
                coordinate: Clutter.BindCoordinate.ALL,
            }));
            for (const property of ['visible', 'opacity', 'translation-y'])
                panelBox.bind_property(property, strip, property, GObject.BindingFlags.SYNC_CREATE);

            this._panelGlass = new Glass(primaryMonitor, scaleFactor, 'borshevik-glass-panel-tint');
            this._panelGlass.set_position(0, 0);
            this._panelGlass.opacity = Main.overview.visible ? 0 : 255;
            strip.add_child(this._panelGlass);

            uiGroup.insert_child_below(strip, panelBox);
            this._actors.push(strip);
        }

        // The overview: every monitor's glass at the bottom of overviewGroup,
        // over GNOME's solid colour and under everything the overview shows.
        this._overviewGlass = new Clutter.Actor();
        for (const monitor of monitors)
            this._overviewGlass.add_child(new Glass(monitor, scaleFactor));
        overviewGroup.insert_child_at_index(this._overviewGlass, 0);
        this._actors.push(this._overviewGlass);

        // The workspace gap: a glass per monitor, hidden until GNOME adds a
        // monitor group for a workspace switch (_onUiChildAdded).
        this._gapGlasses = monitors.map(monitor => {
            const glass = new Glass(monitor, scaleFactor);
            glass.hide();
            uiGroup.add_child(glass);
            this._actors.push(glass);
            return glass;
        });
    }

    _fadePanelGlass(opacity) {
        this._panelGlass?.ease({
            opacity,
            duration: Overview.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onOverviewChildAdded(child) {
        if (this._overviewGlass && child !== this._overviewGlass)
            Main.layoutManager.overviewGroup.set_child_below_sibling(this._overviewGlass, null);
        if (child instanceof AppDisplay.AppFolderDialog)
            this._watchFolder(child);
    }

    // GNOME eases a folder dialog's background_color to its black veil as the
    // folder opens; the running transition is retargeted to ours, or, when GNOME
    // set the colour without animating, ours is set at once.
    _watchFolder(dialog) {
        dialog.connectObject('notify::background-color', () => {
            const transition = dialog.get_transition('background-color');
            if (transition) {
                const target = transition.get_interval().peek_final_value();
                if (isGnomeVeil(target))
                    transition.set_to(this._veil(target.alpha));
            } else if (isGnomeVeil(dialog.background_color)) {
                dialog.background_color = this._veil(dialog.background_color.alpha);
            }
        }, this);
    }

    _veil(gnomeAlpha) {
        const {red, green, blue, alpha} = this._veilStyle.get_theme_node().get_background_color();
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
