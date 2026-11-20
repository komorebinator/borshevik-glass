# SPDX-License-Identifier: GPL-2.0-or-later
"""Looks worth keeping, kept: snapshots of every look marked good, and which of them is the reference.

The light and the dark case are separate things here. A kept look is one case: results/looks/<name>.json
holds its case, every parameter, where it came from (a round and variant, or another look) and what was
said of it. Snapshots are only ever added: a name already taken gets a suffix, nothing is overwritten,
so a look once liked is never lost to later edits of looks.py.

results/reference.json names the reference — what the extension is aimed at — per case: a kept light
look and a kept dark look, each with the history of every reference before it. That pair is the only
place the two cases meet; changing one case's reference moves that pointer only.
"""
import datetime
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOOKS = os.path.join(HERE, 'results', 'looks')
REFERENCE = os.path.join(HERE, 'results', 'reference.json')


def plain(v):
    """A look as JSON can hold it."""
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def tuples(v):
    """A look as the model takes it: JSON's lists back to tuples."""
    if isinstance(v, dict):
        return {k: tuples(x) for k, x in v.items()}
    if isinstance(v, list):
        return tuple(tuples(x) for x in v)
    return v


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s or 'look'


def save(name, look, case, source, note=''):
    """Keeps one case's look under a new name (suffixed if taken); returns the name it got."""
    if case not in CASES:
        raise KeyError(case)
    os.makedirs(LOOKS, exist_ok=True)
    base = slug(name)
    name, n = base, 2
    while os.path.exists(os.path.join(LOOKS, name + '.json')):
        name, n = f'{base}-{n}', n + 1
    doc = {'name': name, 'case': case, 'date': datetime.date.today().isoformat(), 'source': source, 'note': note,
           'look': plain(look)}
    with open(os.path.join(LOOKS, name + '.json'), 'x') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    return name


CASES = ('dark', 'light')


def snapshots(case=None):
    """Every kept look (of one case, if given), by name, oldest first: {name: document}."""
    if not os.path.isdir(LOOKS):
        return {}
    docs = [json.load(open(os.path.join(LOOKS, f))) for f in os.listdir(LOOKS) if f.endswith('.json')]
    return {d['name']: d for d in sorted(docs, key=lambda d: (d['date'], d['name'])) if case in (None, d['case'])}


def look(name):
    return tuples(snapshots()[name]['look'])


def _ref_doc():
    if not os.path.exists(REFERENCE):
        return {c: {'current': None, 'since': None, 'why': '', 'history': []} for c in CASES}
    return json.load(open(REFERENCE))


def reference():
    """{case: snapshot name or None} — whose case is the reference."""
    doc = _ref_doc()
    return {c: doc[c]['current'] for c in CASES}


def reference_doc():
    return _ref_doc()


def reference_look(case):
    """The reference of a case, or None."""
    name = reference()[case]
    return look(name) if name else None


def set_reference(name, why=''):
    """Makes a kept look the reference of its case; the one before goes into that case's history."""
    case = snapshots()[name]['case']
    today = datetime.date.today().isoformat()
    doc = _ref_doc()
    d = doc[case]
    if d['current'] != name:
        if d['current']:
            d['history'].append({'look': d['current'], 'since': d['since'], 'until': today, 'why': d.get('why', '')})
        d.update(current=name, since=today, why=why)
        os.makedirs(os.path.dirname(REFERENCE), exist_ok=True)
        json.dump(doc, open(REFERENCE, 'w'), indent=1, ensure_ascii=False)
    return doc
