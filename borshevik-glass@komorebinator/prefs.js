// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
        window.add(page);
    }
}
