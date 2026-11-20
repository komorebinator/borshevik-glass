# SPDX-License-Identifier: GPL-2.0-or-later
"""The apps the frames show — free software only — with the names GNOME gives them, so every label
sits under its own icon. icons.sh rasterises their icons; one the host lacks is left out."""

NAMES = {
    'org.gnome.Nautilus': 'Files', 'org.gnome.Settings': 'Settings', 'org.gnome.Ptyxis': 'Terminal',
    'org.gnome.Software': 'Software', 'org.mozilla.firefox': 'Firefox', 'org.gnome.TextEditor': 'Text Editor',
    'org.gnome.Loupe': 'Image Viewer', 'org.gnome.Calendar': 'Calendar', 'org.telegram.desktop': 'Telegram',
    'org.gnome.Calculator': 'Calculator', 'org.gnome.Characters': 'Characters', 'org.gnome.clocks': 'Clocks',
    'org.gnome.Contacts': 'Contacts', 'org.gnome.Weather': 'Weather', 'org.gnome.Maps': 'Maps',
    'org.gnome.Papers': 'Papers', 'org.gnome.Snapshot': 'Camera', 'org.gnome.Showtime': 'Video Player',
    'org.gnome.Boxes': 'Boxes', 'org.gnome.Builder': 'Builder', 'org.gimp.GIMP': 'GIMP',
    'org.inkscape.Inkscape': 'Inkscape', 'com.obsproject.Studio': 'OBS Studio', 'com.transmissionbt.Transmission': 'Transmission',
    'org.gnome.Fractal': 'Fractal', 'com.github.tchx84.Flatseal': 'Flatseal', 'com.mattjakeman.ExtensionManager': 'Extension Manager',
    'io.missioncenter.MissionCenter': 'Mission Center', 'org.gnome.baobab': 'Disk Usage Analyzer', 'org.gnome.Logs': 'Logs',
    'org.gnome.World.Secrets': 'Secrets', 'org.gnome.FileRoller': 'File Roller', 'org.gnome.font-viewer': 'Fonts',
    'org.libreoffice.LibreOffice.writer': 'Writer', 'org.libreoffice.LibreOffice.calc': 'Calc',
    'org.libreoffice.LibreOffice.impress': 'Impress', 'org.libreoffice.LibreOffice.draw': 'Draw',
    'org.libretro.RetroArch': 'RetroArch', 'page.kramo.Cartridges': 'Cartridges', 'org.gnome.Epiphany': 'Web',
}

DOCK = ['org.gnome.Nautilus', 'org.mozilla.firefox', 'org.telegram.desktop', 'org.gnome.Ptyxis', 'org.gnome.TextEditor',
        'org.gnome.Loupe', 'org.gnome.Calendar', 'org.gnome.Software', 'org.gnome.Settings']
FOLDERS = {
    'Utilities': ['org.gnome.baobab', 'org.gnome.Logs', 'org.gnome.World.Secrets', 'org.gnome.FileRoller', 'org.gnome.font-viewer', 'io.missioncenter.MissionCenter'],
    'Office': ['org.libreoffice.LibreOffice.writer', 'org.libreoffice.LibreOffice.calc', 'org.libreoffice.LibreOffice.impress', 'org.libreoffice.LibreOffice.draw', 'org.gnome.Papers', 'org.gnome.Calculator'],
    'Games': ['org.libretro.RetroArch', 'page.kramo.Cartridges'],
}
# the app grid: 24 places, three of them folders
GRID = ['org.gnome.Calculator', 'org.gnome.Characters', 'org.gnome.clocks', 'org.gnome.Contacts', 'org.gnome.Weather',
        'Utilities', 'org.gnome.Maps', 'org.gnome.Papers',
        'org.gnome.Snapshot', 'org.gnome.Showtime', 'org.gnome.Boxes', 'org.gnome.Builder', 'org.gimp.GIMP',
        'Office', 'org.inkscape.Inkscape', 'com.obsproject.Studio',
        'com.transmissionbt.Transmission', 'org.gnome.Fractal', 'Games', 'com.github.tchx84.Flatseal',
        'com.mattjakeman.ExtensionManager', 'org.gnome.Epiphany', 'org.gnome.World.Secrets', 'io.missioncenter.MissionCenter']
# the Workspace Manager's buttons: the active workspace's apps, then an inactive one's
BWM_ACTIVE = ['org.gnome.Nautilus']
BWM_INACTIVE = ['org.gnome.Settings', 'org.gnome.Ptyxis', 'org.gnome.Fractal', 'org.mozilla.firefox', 'com.obsproject.Studio']

ALL = sorted(set(NAMES))
