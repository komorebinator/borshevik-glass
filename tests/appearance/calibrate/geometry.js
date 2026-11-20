// Evaluated in tester's GNOME Shell by capture.sh: where GNOME puts what the model draws.
const box = a => { const [x, y] = a.get_transformed_position(); return [Math.round(x), Math.round(y), Math.round(a.width), Math.round(a.height)]; };
const all = global.stage.get_children().flatMap(function walk(a) { return [a, ...a.get_children().flatMap(walk)]; });
const find = cls => all.filter(a => a.has_style_class_name?.(cls) && a.is_mapped());
const out = {panel: box(Main.panel), clock: box(Main.panel.statusArea.dateMenu._clockDisplay),
    clockFont: Main.panel.statusArea.dateMenu._clockDisplay.get_theme_node().get_font().to_string()};
const dash = find('dash-background')[0]; if (dash) out.dash = box(dash);
const card = find('app-folder-dialog')[0]; if (card) out.card = box(card);
const tile = find('overview-tile')[0]; if (tile) out.tile = box(tile);
JSON.stringify(out)
