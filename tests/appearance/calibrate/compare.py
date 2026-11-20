# SPDX-License-Identifier: GPL-2.0-or-later
"""Compares the model's glass with screenshots of the real one on the same wallpaper.

    compare.py <wallpaper> <dir with real-{dark,light}-{desk,grid}.png> [accent]
"""
import os
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import glass as g
import looks

wall, d = sys.argv[1], sys.argv[2]
accent = g.ACCENTS[sys.argv[3] if len(sys.argv) > 3 else 'purple']
real0 = Image.open(os.path.join(d, 'real-dark-desk.png'))
size = real0.size
b = g.blur(np.asarray(g.zoom(g.read_image(wall), size)).astype(np.float32), 15)
worst = 0
for case in ('dark', 'light'):
    p = looks.SHIPPED[case]
    gl = g.over(b, g.tint(p, accent), p['depth'])
    for kind, (y0, y1, x0, x1) in (('desk', (2, 6, 300, 500)), ('grid', (500, 600, 10, 60)), ('grid', (120, 160, size[0] - 80, size[0] - 10))):
        real = np.asarray(Image.open(os.path.join(d, f'real-{case}-{kind}.png')).convert('RGB')).astype(np.float32)[y0:y1, x0:x1].mean((0, 1))
        sim = gl[y0:y1, x0:x1].mean((0, 1))
        e = float(g.de(real, sim)); worst = max(worst, e)
        print(f'{case} {kind} at {x0},{y0}: real {real.round(1)}  model {sim.round(1)}  ΔE {e:.2f}', file=sys.stderr)
import json
print(json.dumps({'worst_de': round(worst, 2)}))
