# SPDX-License-Identifier: GPL-2.0-or-later
"""Which wallpapers of a collection a look is shown on: picked by a rule, named by their classes.

A rule picks by what wallpapers are like — the darkest, the median, the most colourful, where a look
reads worst — so the same comparison can be made on any collection, and nothing kept about it names
a file. Picks are cached per collection and rule in the work directory.
"""
import hashlib
import json
import os

import glass as g

RULES = {
    'sixteen': 'fourteen steps of lightness from darkest to lightest, the most colourful, the busiest under the panel',
    'five': 'the darkest, the median, the most colourful, the busiest under the panel, the lightest',
    'three': 'a dark one (10th percentile of lightness), the median, the lightest',
    'labels': "the median, where the reference's light app labels read worst (5), where its glass is most saturated (4)",
    'all': 'every wallpaper, darkest first',
}


def select(rule, files):
    """[(file, label)] the rule picks from the collection."""
    key = hashlib.sha1(json.dumps([rule, g.MODEL, files]).encode()).hexdigest()[:16]
    cache = os.path.join(g.WORK, 'picks', key + '.json')
    if os.path.exists(cache):
        return [tuple(x) for x in json.load(open(cache))]
    st = {f: g.stats(f) for f in files}
    by = lambda k, rev=False: sorted(files, key=lambda f: st[f][k], reverse=rev)
    q = lambda frac: by('L')[round(frac * (len(files) - 1))]
    picks = []
    add = lambda fs: [picks.append(f) for f in fs if f not in picks]
    if rule == 'three':
        add([q(0.1), q(0.5), q(1.0)])
    elif rule == 'five':
        add([q(0.0), q(0.5), by('C', True)[0], by('panel_range', True)[0], q(1.0)])
    elif rule == 'sixteen':
        add([q(i / 13) for i in range(14)])
        add(by('C', True)[:3]); add(by('panel_range', True)[:3])
        picks = picks[:16]
    elif rule == 'labels':
        import looks
        import store
        ref = store.reference_look('light') or looks.SHIPPED['light']
        m = {f: g.measures(g.load(f)[1], ref, g.ACCENTS['purple']) for f in files}
        add([q(0.5)])
        add(sorted(files, key=lambda f: m[f]['grid_text'])[:5])
        add(sorted(files, key=lambda f: -m[f]['chroma_p99'])[:4])
    elif rule == 'all':
        add(by('L'))
    else:
        raise KeyError(rule)
    out = [(f, g.label(st[f])) for f in picks]
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    json.dump(out, open(cache, 'w'))
    return out
