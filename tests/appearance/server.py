# SPDX-License-Identifier: GPL-2.0-or-later
"""The lab as a local web page: a frame on the left, everything that chooses it on the right.

    server.py [--wallpapers DIR|FILE ...] [--collection NAME] [--port 8765] [--open]

What is shown is a look — a round's variant (looks.ROUNDS) or a kept one (results/looks/) — in the
dark or the light case, with any of GNOME's accents, on a wallpaper a rule picks from the collection,
as one of render.VIEWS. Frames are drawn on demand in a pool of processes and cached in the work
directory, so flipping back is instant. The page can keep the look on screen as a snapshot and make
a kept look the reference (store.py); nothing else it does writes anything outside the work directory.
Listens on 127.0.0.1 only.
"""
import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
from concurrent.futures import ProcessPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import glass as g
import looks
import picks
import store

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(g.WORK, 'frames')
PHOTO_VIEWS = {'desk', 'over', 'fold'}   # every view is a whole screen: JPEG

# ---- drawing, in worker processes ----

_frames = {}


def _draw(path, params, accent, view, case, out):
    import render
    fr = _frames.get(path)
    if fr is None:
        if len(_frames) > 6:
            _frames.pop(next(iter(_frames)))
        fr = _frames[path] = render.Frames(path)
    im = render.view(fr, view, params, tuple(accent), case)
    tmp = out + '.tmp'
    im.save(tmp, format='JPEG' if view in PHOTO_VIEWS else 'PNG', quality=93)
    os.replace(tmp, out)
    return out


def _prepare(path):
    import render
    render.prepare(path)
    g.load(path)


def _measure(path, params, accent):
    _, b = g.load(path)
    return g.measures(b, params, tuple(accent))


def revision():
    """A fingerprint of everything a frame is drawn by — the model, the renderer, the apps and their
    icons — taken as the server starts, so cached frames of code that is gone are never served."""
    h = hashlib.sha1(str(g.MODEL).encode())
    for f in ('glass.py', 'render.py', 'apps.py'):
        h.update(open(os.path.join(HERE, f), 'rb').read())
    icons = os.path.join(g.WORK, 'icons')
    for f in sorted(os.listdir(icons)) if os.path.isdir(icons) else []:
        h.update(f'{f}{os.path.getsize(os.path.join(icons, f))}'.encode())
    return h.hexdigest()[:16]


class Lab:
    def __init__(self, paths, name):
        self.rev = revision()
        self.files = g.wallpapers(paths)
        if not self.files:
            raise SystemExit('no wallpapers found')
        self.name = name
        self.pool = ProcessPoolExecutor(min(6, os.cpu_count() or 1))
        self.lock = threading.Lock()
        self.pending = {}
        self.picks = {}

    def walls(self, rule):
        if rule not in self.picks:
            self.picks[rule] = picks.select(rule, self.files)
            # decode and scale the rule's wallpapers ahead of the first look at them
            for path, _ in self.picks[rule]:
                self.pool.submit(_prepare, path)
        return self.picks[rule]

    def look(self, src, var, case):
        """(parameters, native): what the source draws in the case — or, when the source is a look
        of the other case, that case's reference, so switching cases still shows a whole desktop."""
        here = looks.all_looks(case)
        fallback = here.get('reference', here['shipped'])
        if src.startswith('round:'):
            r = looks.ROUNDS[src[6:]]
            return (r['variants'][var][1], True) if r['case'] == case else (fallback, False)
        name = src[5:]
        if name in here:
            return here[name], True
        if name not in store.snapshots():
            raise KeyError(name)
        return fallback, False

    def key(self, q):
        params, _ = self.look(q['src'], q.get('var', '1'), q['case'])
        path = self.walls(q['rule'])[int(q['wall'])][0]
        accent = g.ACCENTS[q['accent']]
        key = hashlib.sha1(json.dumps([self.rev, path, store.plain(params), q['case'], accent, q['view']]).encode()).hexdigest()
        return key, params, path, accent

    def frame(self, q):
        key, look, path, accent = self.key(q)
        out = os.path.join(FRAMES, key + ('.jpg' if q['view'] in PHOTO_VIEWS else '.png'))
        if os.path.exists(out):
            return out
        with self.lock:
            fut = self.pending.get(out)
            if fut is None:
                os.makedirs(FRAMES, exist_ok=True)
                fut = self.pending[out] = self.pool.submit(_draw, path, look, accent, q['view'], q['case'], out)
        try:
            return fut.result()
        finally:
            with self.lock:
                self.pending.pop(out, None)

    def measures(self, q):
        params, native = self.look(q['src'], q.get('var', '1'), q['case'])
        path = self.walls(q['rule'])[int(q['wall'])][0]
        return dict(self.pool.submit(_measure, path, params, g.ACCENTS[q['accent']]).result(), native=native)

    def state(self):
        import render
        kept = store.snapshots()
        ref = store.reference_doc()
        return {
            'collection': self.name, 'count': len(self.files), 'rev': self.rev,
            'rounds': [{'id': k, 'title': r['title'], 'walls': r['walls'], 'chosen': r['chosen'], 'verdict': r['verdict'],
                        'case': r['case'],
                        'variants': [{'key': vk, 'label': v[0]} for vk, v in r['variants'].items()]}
                       for k, r in looks.ROUNDS.items()],
            'kept': [{'name': n, 'case': d['case'], 'date': d['date'], 'note': d['note'], 'source': d['source']} for n, d in kept.items()],
            'reference': ref,
            'accents': {k: '#%02x%02x%02x' % v for k, v in g.ACCENTS.items()},
            'views': {k: v[0] for k, v in render.VIEWS.items()},
            'rules': picks.RULES,
        }


class Handler(BaseHTTPRequestHandler):
    lab = None

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype, etag=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache' if etag else 'no-store')
        if etag:
            self.send_header('ETag', etag)
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode(), 'application/json; charset=utf-8')

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == '/':
                self.send(200, PAGE.encode(), 'text/html; charset=utf-8')
            elif u.path == '/api/state':
                self.json(self.lab.state())
            elif u.path == '/api/walls':
                self.json([{'i': i, 'label': lab} for i, (_, lab) in enumerate(self.lab.walls(q['rule']))])
            elif u.path == '/api/frame':
                # the browser asks again every time (no-cache) and gets 304 while the frame is the same
                etag = '"' + self.lab.key(q)[0] + '"'
                if self.headers.get('If-None-Match') == etag:
                    self.send_response(304)
                    self.send_header('ETag', etag)
                    self.end_headers()
                    return
                out = self.lab.frame(q)
                self.send(200, open(out, 'rb').read(), 'image/jpeg' if out.endswith('.jpg') else 'image/png', etag)
            elif u.path == '/api/measures':
                self.json(self.lab.measures(q))
            else:
                self.send(404, b'not found', 'text/plain')
        except (KeyError, IndexError, ValueError) as e:
            self.json({'error': repr(e)}, 400)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        try:
            if self.path == '/api/keep':
                params, native = self.lab.look(body['src'], body.get('var', '1'), body['case'])
                if not native:
                    raise ValueError('this look has no ' + body['case'] + ' case to keep')
                if body['src'].startswith('round:'):
                    rnd = body['src'][6:]
                    source = {'round': rnd, 'variant': body.get('var'), 'label': looks.ROUNDS[rnd]['variants'][body['var']][0]}
                else:
                    source = {'look': body['src'][5:]}
                self.json({'name': store.save(body['name'], params, body['case'], source, body.get('note', ''))})
            elif self.path == '/api/reference':
                self.json(store.set_reference(body['name'], body.get('why', '')))
            else:
                self.send(404, b'not found', 'text/plain')
        except (KeyError, ValueError) as e:
            self.json({'error': repr(e)}, 400)


PAGE = r'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glass lab</title>
<style>
:root{--bg:#fafafb;--fg:#222226;--muted:#5e5e66;--card:#fff;--line:#e3e3e8;--acc:#9141ac;--sel:#9141ac22}
@media (prefers-color-scheme: dark){:root{--bg:#1d1d20;--fg:#f0f0f2;--muted:#a8a8b0;--card:#26262a;--line:#38383e;--sel:#9141ac44}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.45 "Adwaita Sans",system-ui,sans-serif;display:grid;grid-template-columns:1fr 360px;height:100vh}
#stage{position:relative;display:flex;align-items:center;justify-content:center;padding:12px;min-width:0;min-height:0}
#stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;border:1px solid var(--line);background:#000}
#busy{position:absolute;top:18px;left:18px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px;color:var(--muted);display:none}
#refbadge{position:absolute;top:18px;right:18px;background:var(--acc);color:#fff;border-radius:999px;padding:2px 12px;font-weight:700;display:none}
aside{border-left:1px solid var(--line);background:var(--card);overflow-y:auto;padding:12px 14px 24px}
h1{font-size:16px;margin:0 0 2px}
.sub{color:var(--muted);font-size:12px;margin-bottom:8px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 6px}
select,input,textarea{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:5px 8px;width:100%}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
button{font:inherit;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:8px;padding:4px 10px;cursor:pointer;text-align:left}
button[aria-pressed=true]{background:var(--sel);border-color:var(--acc)}
.variants button{width:100%}
.variants .chosen::after{content:" ✓";color:var(--acc);font-weight:700}
.sw{width:26px;height:26px;border-radius:50%;padding:0;border:2px solid transparent}
.sw[aria-pressed=true]{border-color:var(--fg)}
.note{color:var(--muted);font-size:13px;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:2px 0} td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.bad{color:#c01c28;font-weight:700}
.primary{background:var(--acc);border-color:var(--acc);color:#fff}
kbd{border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:12px}
@media (max-width:900px){body{grid-template-columns:1fr;grid-template-rows:55vh 1fr}aside{border-left:0;border-top:1px solid var(--line)}}
</style></head><body>
<div id="stage"><img id="img" alt=""><div id="busy">рисую…</div><div id="refbadge">эталон</div></div>
<aside>
  <h1>Borshevik Glass — лаборатория</h1>
  <div class="sub" id="coll"></div>
  <h2>Что показывать</h2>
  <select id="src"></select>
  <div class="note" id="srcnote"></div>
  <div class="variants" id="variants"></div>
  <h2>Тема <kbd>T</kbd></h2>
  <div class="row" id="cases"></div>
  <h2>Акцент <kbd>[</kbd> <kbd>]</kbd></h2>
  <div class="row" id="accents"></div>
  <h2>Вид <kbd>A</kbd>…</h2>
  <div class="row" id="views"></div>
  <h2>Обои <kbd>←</kbd> <kbd>→</kbd></h2>
  <select id="rule"></select>
  <div class="row" style="margin-top:6px"><button id="prev">←</button><span id="wallno"></span><button id="next">→</button></div>
  <div class="note" id="wall"></div>
  <h2>Этот кадр</h2>
  <table id="meas"></table>
  <div class="note">Держи <kbd>пробел</kbd> — на месте кадра эталон той же темы, обоев, вида и акцента.</div>
  <h2>Сохранить</h2>
  <div class="row"><button id="keep">Отметить как хороший</button><button id="mkref" class="primary">Сделать эталоном</button></div>
  <div class="note" id="refnote"></div>
</aside>
<script>
let S, walls = [], st = {src: null, var: '1', kase: 'light', accent: 'purple', view: 'over', rule: 'sixteen', wall: 0};
try { Object.assign(st, JSON.parse(localStorage.getItem('glass-lab') || '{}')); } catch (e) {}
const $ = id => document.getElementById(id);
const save = () => { try { localStorage.setItem('glass-lab', JSON.stringify(st)); } catch (e) {} };
function btn(parent, html, on, cls) { const b = document.createElement('button'); b.innerHTML = html; b.onclick = on; if (cls) b.className = cls; parent.appendChild(b); return b; }
const isRound = () => st.src.startsWith('round:');
const round = () => S.rounds.find(r => 'round:' + r.id === st.src);
const CASE_RU = {light: 'светлая', dark: 'тёмная'}, CASE_GEN = {light: 'светлой', dark: 'тёмной'};
// the case the source on screen belongs to, or null for those that have both (reference, shipped)
function srcCase() {
  if (isRound()) return round().case;
  const k = S.kept.find(x => 'look:' + x.name === st.src);
  return k ? k.case : null;
}
const native = () => { const c = srcCase(); return !c || c === st.kase; };
const VIEWKEYS = 'asdfghj', VIEWCODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ'];

async function load() {
  S = await (await fetch('/api/state')).json();
  $('coll').textContent = `набор «${S.collection}», ${S.count} обоев`;
  const src = $('src'); src.innerHTML = '';
  const R = S.reference;
  const group = (label, items) => { if (!items.length) return; const gr = document.createElement('optgroup'); gr.label = label;
    for (const [v, t] of items) { const o = document.createElement('option'); o.value = v; o.textContent = t; gr.appendChild(o); } src.appendChild(gr); };
  group('Обе темы', [['look:reference', `★ эталон (светлая: ${R.light.current || '—'}, тёмная: ${R.dark.current || '—'})`]]);
  for (const c of ['light', 'dark']) {
    group(`Виды: ${CASE_RU[c]} тема`, S.kept.filter(k => k.case === c).map(k => ['look:' + k.name, k.name + (R[c].current === k.name ? ' — ★ эталон' : '')]));
    group(`Раунды: ${CASE_RU[c]} тема`, S.rounds.filter(r => r.case === c).map(r => ['round:' + r.id, r.title]));
  }
  if (!st.src || ![...src.options].some(o => o.value === st.src)) st.src = 'look:reference';
  src.value = st.src;
  src.onchange = () => { st.src = src.value; st.var = isRound() ? (round().chosen || round().variants[0].key) : '1'; if (isRound()) st.rule = round().walls;
    if (srcCase()) st.kase = srcCase(); renderAll(); loadWalls(); };
  const rule = $('rule'); rule.innerHTML = '';
  for (const [k, v] of Object.entries(S.rules)) { const o = document.createElement('option'); o.value = k; o.textContent = k + ' — ' + v; rule.appendChild(o); }
  rule.value = st.rule; rule.onchange = () => { st.rule = rule.value; st.wall = 0; loadWalls(); };
  const cases = $('cases'); cases.innerHTML = '';
  for (const [k, n] of [['light', 'Светлая'], ['dark', 'Тёмная']]) btn(cases, n, () => { st.kase = k; renderAll(); show(); }).dataset.k = k;
  const acc = $('accents'); acc.innerHTML = '';
  for (const [k, c] of Object.entries(S.accents)) { const b = btn(acc, '', () => { st.accent = k; renderAll(); show(); }, 'sw'); b.style.background = c; b.title = k; b.dataset.k = k; }
  const views = $('views'); views.innerHTML = '';
  Object.entries(S.views).forEach(([k, n], i) => { btn(views, `${n} <kbd>${VIEWKEYS[i].toUpperCase()}</kbd>`, () => { st.view = k; renderAll(); show(); }).dataset.k = k; });
  renderAll(); await loadWalls();
}

async function loadWalls() {
  $('wall').textContent = 'выбираю обои…';
  walls = await (await fetch('/api/walls?rule=' + st.rule)).json();
  if (st.wall >= walls.length) st.wall = 0;
  show();
}

function renderAll() {
  save();
  const v = $('variants'); v.innerHTML = '';
  if (isRound()) {
    const r = round();
    $('srcnote').innerHTML = `Раунд по <b>${CASE_GEN[r.case]}</b> теме.<br><b>Вердикт:</b> ${r.verdict}`;
    r.variants.forEach((x, i) => {
      const b = btn(v, `<kbd>${i + 1}</kbd> ${x.label}`, () => { st.var = x.key; renderAll(); show(); }, x.key === r.chosen ? 'chosen' : '');
      b.setAttribute('aria-pressed', x.key === st.var); b.style.marginBottom = '4px';
    });
  } else {
    const name = st.src.slice(5), k = S.kept.find(x => x.name === name);
    $('srcnote').textContent = name === 'shipped' ? 'То, что расширение рисует сейчас, из кода.' : name === 'reference' ? 'Светлая тема — эталон светлой, тёмная — эталон тёмной.' :
      k ? `${CASE_RU[k.case]} тема · ${k.date} · ${k.source.round ? 'раунд ' + k.source.round + ', ' + k.source.label : 'из ' + k.source.look}. ${k.note}` : '';
  }
  if (!native()) $('srcnote').innerHTML += `<br><b>Этот вид — только для ${CASE_GEN[srcCase()]} темы; в ${CASE_GEN[st.kase]} показан эталон ${CASE_GEN[st.kase]}.</b>`;
  for (const b of $('cases').children) b.setAttribute('aria-pressed', b.dataset.k === st.kase);
  for (const b of $('accents').children) b.setAttribute('aria-pressed', b.dataset.k === st.accent);
  for (const b of $('views').children) b.setAttribute('aria-pressed', b.dataset.k === st.view);
  $('rule').value = st.rule;
  const R = S.reference, kase = st.kase === 'dark' ? 'тёмной' : 'светлой';
  const line = (c, n) => { const r = R[c]; return r.current ? `${n}: <b>${r.current}</b> с ${r.since}. ${r.why || ''}` +
    (r.history.length ? ' Раньше: ' + r.history.map(h => `${h.look} (${h.since} — ${h.until})`).join(', ') + '.' : '') : `${n}: не выбран.`; };
  $('refnote').innerHTML = line('light', 'Эталон светлой') + '<br>' + line('dark', 'Эталон тёмной');
  $('mkref').textContent = `Сделать эталоном ${kase} темы`;
  $('mkref').disabled = !native() || st.src === 'look:reference' || st.src === 'look:' + R[st.kase].current;
  $('keep').disabled = !native() || st.src === 'look:reference';
}

// rev, the server's fingerprint of the code that draws, is part of every frame's address: frames a
// browser kept from older code have other addresses and are never shown again, whatever it cached.
function q(extra) {
  const p = new URLSearchParams({rev: S.rev, src: st.src, var: st.var, case: st.kase, accent: st.accent, rule: st.rule, wall: st.wall, ...extra});
  return p.toString();
}

let seq = 0;
function show() {
  if (!walls.length) return;
  save();
  $('wallno').textContent = `${st.wall + 1} из ${walls.length}`;
  $('wall').textContent = walls[st.wall].label;
  const my = ++seq, img = new Image();
  $('busy').style.display = 'block';
  img.onload = () => { if (my === seq) { $('img').src = img.src; $('busy').style.display = 'none'; prefetch(); } };
  img.onerror = () => { if (my === seq) $('busy').textContent = 'ошибка рисования'; };
  img.src = '/api/frame?' + q({view: st.view});
  fetch('/api/measures?' + q()).then(r => r.json()).then(m => {
    if (my !== seq) return;
    const row = (n, v, floor) => `<tr><td>${n}</td><td class="${floor && v < floor ? 'bad' : ''}">${v.toFixed(2)}${floor ? ':1' : ''}</td></tr>`;
    $('meas').innerHTML = row('текст на панели', m.panel_text, 4.5) + row('подписи в обзоре', m.grid_text, 4.5) + row('док', m.dock_text, 4.5) +
      row('открытая папка', m.card_text, 4.5) + row('светлота панели L*', m.L_panel) + row('светлота обзора L*', m.L_overview) +
      row('цветность обзора', m.chroma) + row('отделение папки ΔE', m.card_sep);
  });
}

function prefetch() {
  // the neighbours one is most likely to flip to next
  const near = [{wall: (st.wall + 1) % walls.length}, {wall: (st.wall + walls.length - 1) % walls.length}];
  near.unshift({src: 'look:reference', var: '1'});
  if (isRound()) for (const x of round().variants) if (x.key !== st.var) near.push({var: x.key});
  for (const n of near.slice(0, 7)) { const i = new Image(); i.src = '/api/frame?' + q({view: st.view, ...n}); }
}

$('prev').onclick = () => { st.wall = (st.wall + walls.length - 1) % walls.length; show(); };
$('next').onclick = () => { st.wall = (st.wall + 1) % walls.length; show(); };
$('keep').onclick = async () => {
  const name = prompt(`Имя для сохранённого вида (${CASE_RU[st.kase]} тема):`, isRound() ? round().id + '-' + st.var : st.src.slice(5) + '-' + st.kase);
  if (!name) return;
  const note = prompt('Что в нём хорошо?', '') || '';
  const r = await (await fetch('/api/keep', {method: 'POST', body: JSON.stringify({src: st.src, var: st.var, case: st.kase, name, note})})).json();
  if (r.error) return alert(r.error);
  await load(); st.src = 'look:' + r.name; $('src').value = st.src; renderAll(); show();
};
$('mkref').onclick = async () => {
  let name = st.src.slice(5);
  if (isRound() || name === 'shipped') {
    const n = prompt('Сначала вид сохраняется. Имя:', isRound() ? round().id + '-' + st.var : 'shipped-' + st.kase);
    if (!n) return;
    const r = await (await fetch('/api/keep', {method: 'POST', body: JSON.stringify({src: st.src, var: st.var, case: st.kase, name: n, note: ''})})).json();
    if (r.error) return alert(r.error);
    name = r.name;
  }
  const why = prompt(`Сделать «${name}» эталоном ${CASE_GEN[st.kase]} темы (эталон другой темы не меняется). Почему?`, '');
  if (why === null) return;
  const r = await (await fetch('/api/reference', {method: 'POST', body: JSON.stringify({name, why})})).json();
  if (r.error) return alert(r.error);
  await load(); st.src = 'look:' + name; $('src').value = st.src; renderAll(); show();
};
// Keys by their place on the keyboard (e.code), not the character they type: the same in any
// layout, Russian included. Taken in the capture phase, before a focused control can use them; a
// select gives its focus back once something is chosen, so arrows never move it by accident.
// Space held: the reference in place of the frame — same case, wallpaper, view and accent.
let holding = false, shownSrc = '';
function compare(on) {
  if (on === holding || st.src === 'look:reference') return;
  holding = on;
  $('refbadge').style.display = on ? 'block' : 'none';
  if (on) { shownSrc = $('img').src; const i = new Image(); i.onload = () => { if (holding) $('img').src = i.src; }; i.src = '/api/frame?' + q({view: st.view, src: 'look:reference', var: '1'}); }
  else if (shownSrc) $('img').src = shownSrc;
}
document.addEventListener('keyup', e => { if (e.code === 'Space') { e.preventDefault(); compare(false); } }, true);
addEventListener('blur', () => compare(false));
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) compare(true); return; }
  const c = e.code, views = Object.keys(S.views);
  let done = true;
  if (c === 'ArrowRight') $('next').click();
  else if (c === 'ArrowLeft') $('prev').click();
  else if (c === 'KeyT') { st.kase = st.kase === 'light' ? 'dark' : 'light'; renderAll(); show(); }
  else if (c === 'BracketLeft' || c === 'BracketRight') { const a = Object.keys(S.accents), i = a.indexOf(st.accent); st.accent = a[(i + (c === 'BracketRight' ? 1 : a.length - 1)) % a.length]; renderAll(); show(); }
  else if (/^(Digit|Numpad)[1-9]$/.test(c) && isRound()) { const x = round().variants[+c.slice(-1) - 1]; if (x) { st.var = x.key; renderAll(); show(); } }
  else if (VIEWCODES.includes(c) && VIEWCODES.indexOf(c) < views.length) { st.view = views[VIEWCODES.indexOf(c)]; renderAll(); show(); }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); if (document.activeElement.tagName === 'SELECT') document.activeElement.blur(); }
}, true);
for (const id of ['src', 'rule']) $(id).addEventListener('change', () => $(id).blur());
load();
</script></body></html>
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wallpapers', nargs='+', action='extend', default=[])
    ap.add_argument('--collection')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--open', action='store_true')
    a = ap.parse_args()
    Handler.lab = Lab(a.wallpapers, a.collection or g.describe(a.wallpapers))
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    url = f'http://127.0.0.1:{a.port}/'
    print(f'{url} — {Handler.lab.name}, {len(Handler.lab.files)} wallpapers; Ctrl+C stops', flush=True)
    if a.open:
        subprocess.Popen(['xdg-open', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # stopped by a signal too (lab.sh stop), the pool goes with the server rather than outliving it
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        Handler.lab.pool.shutdown(wait=False, cancel_futures=True)


if __name__ == '__main__':
    sys.exit(main())
