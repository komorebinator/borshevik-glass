// SPDX-License-Identifier: GPL-2.0-or-later

// The blur under an open folder's card: what lies under the folder in the
// overview, blurred and baked into a texture once as the folder opens and
// afterwards only shown, cut to the card's rounded rectangle. See
// behaviour#folder-over-blur and the guideline on static glass.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BAKE_MARGIN, BLUR_RADIUS, GrabEffect} from './glass.js';

const BACKDROP_NAME = 'borshevik-glass-folder-backdrop';
const BAKE_NAME = 'borshevik-glass-folder-bake';

// GNOME's style class of a folder's card, inside the dialog's container.
const CARD_STYLE = 'app-folder-dialog';

// The properties GNOME animates on the card's container as it opens and closes.
const CONTAINER_MOTION = ['translation-x', 'translation-y', 'scale-x', 'scale-y', 'opacity', 'allocation'];

// Keeps the card's rounded rectangle and nothing else, antialiased over one
// pixel, at the card's opacity. The texture covers the backdrop with Clutter's
// padding of an offscreen buffer (BAKE_MARGIN), so a texture coordinate times
// `size`, less the margin before, is a point of the backdrop. cogl_color_out is
// premultiplied.
const MASK_DECLARATIONS = `
uniform vec2 size;
uniform vec4 card;
uniform float radius;
uniform float alpha;
`;
const MASK_CODE = `
vec2 p = cogl_tex_coord_in[0].st * size - vec2(${BAKE_MARGIN.before.toFixed(1)});
vec2 hs = card.zw * 0.5;
float r = min(radius, min(hs.x, hs.y));
vec2 q = abs(p - card.xy - hs) - hs + vec2(r);
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
cogl_color_out *= clamp(0.5 - d, 0.0, 1.0) * alpha;
`;

const MaskEffect = GObject.registerClass(
class BorshevikGlassMaskEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet((Shell.SnippetHook ?? Cogl.SnippetHook).FRAGMENT, MASK_DECLARATIONS, MASK_CODE, false);
    }

    // The card's place is read as the effect paints, not as GNOME announces it: as
    // the first folder opens its card has no place yet when the folder says it
    // opens, and GNOME's zoom announced none after (seen in the test machine, where
    // that folder was blurred whole). `uniforms` gives them, or null to keep the last.
    vfunc_paint(node, paintContext, flags) {
        for (const [name, n, value] of this.uniforms?.() ?? [])
            this.set_uniform_float(this.get_uniform_location(name), n, value);
        super.vfunc_paint(node, paintContext, flags);
    }
});

export class FolderBackdrop {
    constructor(dialog) {
        this._dialog = dialog;
        this._card = null;
        this._idleId = 0;
        this._bakes = 0;

        // What is shown: the baked picture at the offset of Clutter's padding,
        // the excess clipped, under the mask.
        const {before, after} = BAKE_MARGIN;
        this._actor = new Clutter.Actor({name: BACKDROP_NAME, visible: false, clip_to_allocation: true});
        this._picture = new Clutter.Actor({x: -before, y: -before});
        this._actor.add_child(this._picture);
        this._mask = new MaskEffect();
        this._mask.uniforms = () => this._uniforms();
        this._actor.add_effect(this._mask);
        Main.layoutManager.overviewGroup.insert_child_below(this._actor, dialog);

        // What it is baked from: clones under the blur, under the grab, at the
        // bottom of Main.uiGroup where it is painted unseen — two actors, since
        // the effects must apply in that order.
        this._grabbed = new Clutter.Actor({name: BAKE_NAME, visible: false, clip_to_allocation: true});
        this._clones = new Clutter.Actor({clip_to_allocation: true});
        this._grabbed.add_child(this._clones);
        Main.layoutManager.uiGroup.insert_child_at_index(this._grabbed, 0);
        // as GNOME Shell shuts down it destroys its groups, and with them these,
        // before it destroys the dialog
        this._grabbed.connect('destroy', () => {
            this._grabbed = null;
            this._clones = null;
        });
        this._actor.connect('destroy', () => {
            this._actor = null;
        });

        dialog.connectObject(
            'open-state-changed', (_, open) => {
                if (open)
                    this._open();
            },
            'notify::visible', () => {
                if (!dialog.visible)
                    this._close();
            },
            'destroy', () => this.destroy(),
            this);
        for (const property of CONTAINER_MOTION)
            dialog.child.connectObject(`notify::${property}`, () => this._follow(), this);
    }

    // Under the dialog, which GNOME has just raised; baked from a clone of every
    // visible actor below it, each at its own place.
    _open() {
        if (!this._actor || !this._grabbed)
            return;
        const group = Main.layoutManager.overviewGroup;
        group.set_child_below_sibling(this._actor, this._dialog);

        const monitor = Main.layoutManager.primaryMonitor;
        const {before, after} = BAKE_MARGIN;
        this._actor.set({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        this._picture.set({width: monitor.width + before + after, height: monitor.height + before + after});
        this._picture.set_content(null);

        this._clearBake();
        this._grabbed.set({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        this._clones.set({width: monitor.width, height: monitor.height});
        for (const source of group.get_children()) {
            if (source === this._actor)
                break;
            if (!source.visible || source.name === BACKDROP_NAME || source instanceof AppDisplay.AppFolderDialog)
                continue;
            const box = source.get_allocation_box();
            this._clones.add_child(new Clutter.Clone({
                source,
                x: box.x1 - monitor.x,
                y: box.y1 - monitor.y,
                width: box.get_width(),
                height: box.get_height(),
            }));
        }

        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        this._clones.add_effect(new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            brightness: 1,
            radius: BLUR_RADIUS * scaleFactor,
        }));
        const bake = ++this._bakes;
        const grab = new GrabEffect();
        grab.connect('painted', () => {
            // not from within the paint: the effects are taken off afterwards
            this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleId = 0;
                if (bake === this._bakes)
                    this._finish(grab);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._grabbed.add_effect(grab);
        this._grabbed.show();
        this._grabbed.queue_redraw();

        this._actor.show();
    }

    // The picture is kept as content; the clones, the effects and their buffers go.
    _finish(grab) {
        const texture = grab.get_texture();
        if (texture && this._actor?.visible) {
            this._picture.set_content(Clutter.TextureContent.new_from_texture(texture, null));
            this._mask.queue_repaint();
        }
        this._clearBake();
    }

    _clearBake() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        if (!this._grabbed)
            return;
        this._grabbed.hide();
        this._grabbed.clear_effects();
        this._clones.clear_effects();
        this._clones.destroy_all_children();
    }

    _close() {
        this._bakes++;
        this._clearBake();
        if (!this._actor)
            return;
        this._actor.hide();
        this._picture.set_content(null);
    }

    // Paints the mask again, from the effect's buffer, as GNOME moves, scales or
    // fades the card.
    _follow() {
        if (this._actor?.visible)
            this._mask.queue_repaint();
    }

    // The card's rectangle on the screen, its corner radius and its opacity, for
    // the mask; null while the card has no place.
    _uniforms() {
        this._card ??= this._dialog.child.get_children().find(a => a.has_style_class_name?.(CARD_STYLE)) ?? null;
        if (!this._card)
            return null;

        const extents = this._card.get_transformed_extents();
        const card = [extents.origin.x, extents.origin.y, extents.size.width, extents.size.height];
        if (!card.every(Number.isFinite))
            return null;

        const container = this._dialog.child;
        const [x, y] = this._actor.get_transformed_position();
        const {before, after} = BAKE_MARGIN;
        return [
            ['size', 2, [this._actor.width + before + after, this._actor.height + before + after]],
            ['card', 4, [card[0] - x, card[1] - y, card[2], card[3]]],
            ['radius', 1, [this._card.get_theme_node().get_border_radius(St.Corner.TOPLEFT) * container.scale_x]],
            ['alpha', 1, [container.opacity / 255 * this._dialog.opacity / 255]],
        ];
    }

    destroy() {
        if (!this._dialog)
            return;
        this._dialog.disconnectObject(this);
        this._dialog.child?.disconnectObject(this);
        this._dialog = null;
        this._clearBake();
        this._grabbed?.destroy();
        this._actor?.destroy();
    }
}
