// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// A row with a slider bound to an integer setting, in per cent.
function sliderRow(settings, key, title, min, max) {
    const adjustment = new Gtk.Adjustment({lower: min, upper: max, step_increment: 1, page_increment: 5});
    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    const scale = new Gtk.Scale({
        adjustment,
        digits: 0,
        valign: Gtk.Align.CENTER,
        width_request: 240,
    });
    // a label of its own, of one width for every row, so the sliders line up
    const value = new Gtk.Label({width_chars: 5, xalign: 1, css_classes: ['dim-label', 'numeric']});
    const showValue = () => (value.label = `${Math.round(adjustment.value)} %`);
    adjustment.connect('value-changed', showValue);
    showValue();
    const row = new Adw.ActionRow({title});
    row.add_suffix(scale);
    row.add_suffix(value);
    return row;
}

export default class BorshevikGlassPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: _('Appearance')});
        const lightStyle = new Adw.SwitchRow({
            title: _('Light style'),
            subtitle: _('When dark style is off, the panel, the overview and GNOME’s menus turn light. Off: always dark.'),
        });
        settings.bind('light-style', lightStyle, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(lightStyle);
        page.add(group);

        const tint = new Adw.PreferencesGroup({title: _('Tint')});
        const accentTint = new Adw.SwitchRow({
            title: _('Accent tint'),
            subtitle: _('Mix the accent colour into the glass'),
        });
        settings.bind('accent-tint', accentTint, 'active', Gio.SettingsBindFlags.DEFAULT);
        tint.add(accentTint);
        const accentAmount = sliderRow(settings, 'accent-amount', _('Accent amount'), 5, 30);
        settings.bind('accent-tint', accentAmount, 'visible', Gio.SettingsBindFlags.GET);
        tint.add(accentAmount);
        tint.add(sliderRow(settings, 'dark-depth', _('Dark depth'), 0, 100));
        tint.add(sliderRow(settings, 'light-depth', _('Light depth'), 0, 100));
        page.add(tint);

        window.add(page);
    }
}
