// The base of the extension's shader effects: an effect that paints what it
// wraps through one fragment snippet, which a subclass gives as `snippet`
// ({declarations, code}, the code run after the default fragment), with
// uniforms set by setUniform(). Clutter.ShaderEffect asks for the snippet once
// per class.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

export const SnippetEffect = GObject.registerClass(
class BorshevikGlassSnippetEffect extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        const {declarations, code} = this.snippet;
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, code);
    }

    setUniform(name, n, value) {
        this.set_uniform_float(name, n, value);
    }
});
