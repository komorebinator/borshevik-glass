# SPDX-License-Identifier: GPL-2.0-or-later
"""Measures a look over a wallpaper collection, in both cases, and reports it by wallpaper class.

    measure.py [look] [--wallpapers DIR|FILE ...] [--collection NAME] [--accent purple] [--all-accents] [--record]

look is shipped or reference — both cases — or a kept look (results/looks/) — its one case;
default reference. The collection is the given directories and
files, or the system's wallpapers. Prints, per case, each measure's spread over the collection and
how many wallpapers leave text below WCAG's 4.5:1 and 3:1 — overall and per lightness class
(glass.LIGHTNESS). Wallpapers are never named: a result says what kind of wallpaper a look fails on,
which is what carries over to wallpapers nobody measured. --record writes the same into
results/measures/<look>-<collection>.json, beside this script, with the look's every parameter
(and, for reference, which kept look it was), so a result says what was measured on its own.
"""
import argparse
import datetime
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

import glass as g
import looks

TEXT = ('panel_text', 'grid_text', 'dock_text', 'card_text')
HERE = os.path.dirname(os.path.abspath(__file__))


def one(args):
    path, look, accent = args
    _, b = g.load(path)
    st = g.stats(path)
    return [dict(g.measures(b, params, g.ACCENTS[accent]), case=case, classes=g.classes(st))
            for case, params in look.items()]


def resolve(name):
    """{case: parameters} of what the name stands for."""
    import store
    if name in ('shipped', 'reference'):
        return {c: looks.all_looks(c)[name] for c in ('dark', 'light') if name in looks.all_looks(c)}
    doc = store.snapshots()[name]
    return {doc['case']: store.tuples(doc['look'])}


def spread(v):
    v = np.asarray(v)
    return {'min': round(float(v.min()), 2), 'p5': round(float(np.percentile(v, 5)), 2), 'median': round(float(np.median(v)), 2),
            'p95': round(float(np.percentile(v, 95)), 2), 'max': round(float(v.max()), 2)}


def summary(rows):
    out = {}
    for k in rows[0]:
        if k in ('case', 'classes'):
            continue
        out[k] = spread([r[k] for r in rows])
        if k in TEXT:
            v = np.array([r[k] for r in rows])
            out[k].update(below_4_5=int((v < 4.5).sum()), below_3=int((v < 3).sum()))
    return out


def collection(rows):
    first = rows[0]['case']
    n = sum(r['case'] == first for r in rows)
    count = lambda c: sum(c in r['classes'] for r in rows if r['case'] == first)
    return {'wallpapers': n, **{c: count(c) for c, _, _ in g.LIGHTNESS + g.COLOUR}, 'busy': count('busy')}


def main():
    ap = argparse.ArgumentParser()
    import store
    ap.add_argument('look', nargs='?', default='reference', choices=['shipped', 'reference'] + sorted(store.snapshots()))
    ap.add_argument('--wallpapers', nargs='+', action='extend', default=[])
    ap.add_argument('--collection', help='a name for the collection in results (default: its directories)')
    ap.add_argument('--accent', default='purple', choices=sorted(g.ACCENTS))
    ap.add_argument('--all-accents', action='store_true')
    ap.add_argument('--record', action='store_true')
    a = ap.parse_args()
    look = resolve(a.look)
    files = g.wallpapers(a.wallpapers)
    if not files:
        raise SystemExit('no wallpapers found')
    with ProcessPoolExecutor(min(8, os.cpu_count() or 1)) as ex:
        rows = [r for rs in ex.map(one, [(f, look, a.accent) for f in files]) for r in rs]
    name = a.collection or g.describe(a.wallpapers)
    result = {'look': a.look, 'kept_as': store.reference() if a.look == 'reference' else (a.look if a.look != 'shipped' else None),
              'params': store.plain(look), 'collection': name, 'accent': a.accent, 'date': datetime.date.today().isoformat(),
              'screen': f'{g.LOGICAL[0]}x{g.LOGICAL[1]}', 'composition': collection(rows), 'cases': {}}
    print(f'{a.look} on {name}: {json.dumps(result["composition"])}, accent {a.accent}')
    for case in look:
        r = [x for x in rows if x['case'] == case]
        res = {'all': summary(r), 'by_lightness': {}}
        for cls, _, _ in g.LIGHTNESS:
            rc = [x for x in r if cls in x['classes']]
            if rc:
                res['by_lightness'][cls] = {k: v for k, v in summary(rc).items() if k in TEXT + ('L_panel', 'L_overview', 'chroma')}
        result['cases'][case] = res
        print(f'== {case}')
        for k, v in res['all'].items():
            line = f"  {k:12s} min {v['min']:6.2f}  p5 {v['p5']:6.2f}  median {v['median']:6.2f}  p95 {v['p95']:6.2f}  max {v['max']:6.2f}"
            if 'below_4_5' in v:
                line += f"   below 4.5:1 on {v['below_4_5']}, below 3:1 on {v['below_3']}"
            print(line)
        for cls, s in res['by_lightness'].items():
            print(f'  {cls:7s} text worst ' + ', '.join(f"{k.split('_')[0]} {s[k]['min']:.2f}" for k in TEXT)
                  + f"; below 4.5:1 on {max(s[k]['below_4_5'] for k in TEXT)}; overview L* {s['L_overview']['median']:.0f}, chroma {s['chroma']['median']:.0f}")
    if a.all_accents:
        result['accents'] = {}
        for acc in g.ACCENTS:
            with ProcessPoolExecutor(min(8, os.cpu_count() or 1)) as ex:
                rs = [r for rr in ex.map(one, [(f, look, acc) for f in files]) for r in rr]
            w = {c: round(min(min(x[k] for k in TEXT) for x in rs if x['case'] == c), 2) for c in look}
            result['accents'][acc] = w
            print(f'accent {acc:7s} worst text contrast: ' + ', '.join(f'{c} {v:5.2f}' for c, v in w.items()))
    if a.record:
        out = os.path.join(HERE, 'results', 'measures', f'{a.look}-{name}.json')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump(result, open(out, 'w'), indent=1, ensure_ascii=False)
        print('recorded', os.path.relpath(out, HERE))


if __name__ == '__main__':
    sys.exit(main())
