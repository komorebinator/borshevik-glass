# SPDX-License-Identifier: GPL-2.0-or-later
"""A wallpaper the size of the test machine's screen: black above, white below — a step to blur."""
import sys
from PIL import Image
w, h = (int(v) for v in sys.argv[2].split('x')) if len(sys.argv) > 2 else (1280, 800)
im = Image.new('RGB', (w, h), (0, 0, 0))
im.paste((255, 255, 255), (0, h // 2, w, h))
im.save(sys.argv[1])
