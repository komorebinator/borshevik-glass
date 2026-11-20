# SPDX-License-Identifier: GPL-2.0-or-later
"""Fits a Gaussian to the blurred step in a screenshot of the overview: what sigma Shell.BlurEffect
uses for the extension's radius, and whether it blurs in sRGB or in linear light."""
import sys
import numpy as np
from PIL import Image
from scipy.optimize import curve_fit
from scipy.special import erf

im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
h = im.shape[0]
# a column left of every window: x 60..160, from below the panel to above the dash
y = np.arange(100, h - 50)
col = im[100:h - 50, 60:160, :].mean(axis=(1, 2))
model = lambda y, y0, s, lo, hi: lo + (hi - lo) * 0.5 * (1 + erf((y - y0) / (s * np.sqrt(2))))
p, _ = curve_fit(model, y, col, p0=[h / 2, 20, 0, 255])
lin = lambda v: np.where(v / 255 <= 0.04045, v / 255 / 12.92, ((v / 255 + 0.055) / 1.055) ** 2.4)
q, _ = curve_fit(model, y, lin(col), p0=[h / 2, 20, 0, 1])
import json
res = {'srgb_sigma': round(float(p[1]), 2), 'srgb_rms': round(float(np.sqrt(np.mean((model(y, *p) - col) ** 2))), 2),
       'linear_sigma': round(float(q[1]), 2), 'linear_rms': round(float(np.sqrt(np.mean((model(y, *q) - lin(col)) ** 2)) * 255), 2)}
print(f"sRGB fit:   sigma {res['srgb_sigma']} px, rms {res['srgb_rms']}/255", file=sys.stderr)
print(f"linear fit: sigma {res['linear_sigma']} px, rms {res['linear_rms']}/255", file=sys.stderr)
print(json.dumps(res))
