# Builds public/fx/caustics.png (Blue Paradise theme): python3 tools/fx/caustics.py public/fx/caustics.png
# Seamless water caustics: the edge network of a warped Voronoi diagram on a torus,
# bright where cells meet, like light focused by ripples on a pool floor.
import numpy as np
from PIL import Image
N = 512
rng = np.random.default_rng(7)
y, x = np.mgrid[0:N, 0:N] / N  # 0..1, periodic
def warp(x, y, amp, k, phase):
    # Periodic domain warp: sums of sines with integer frequencies stay seamless.
    wx = x + amp * (np.sin(2*np.pi*(k*y + phase)) * 0.6 + np.sin(2*np.pi*(2*k*x + 3*y + phase*1.7)) * 0.4)
    wy = y + amp * (np.sin(2*np.pi*(k*x + phase*1.3)) * 0.6 + np.sin(2*np.pi*(2*k*y + 2*x + phase*0.6)) * 0.4)
    return wx, wy
def edges(cells, x, y):
    pts = rng.random((cells, 2))
    d1 = np.full(x.shape, 9.0); d2 = np.full(x.shape, 9.0)
    for px, py in pts:
        dx = np.abs(x - px); dx = np.minimum(dx % 1, 1 - dx % 1)
        dy = np.abs(y - py); dy = np.minimum(dy % 1, 1 - dy % 1)
        d = np.sqrt(dx*dx + dy*dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
    return d2 - d1
wx, wy = warp(x, y, 0.035, 2, 0.13)
e1 = edges(26, wx, wy)
wx2, wy2 = warp(x, y, 0.05, 3, 0.71)
e2 = edges(14, wx2, wy2)
# Thin bright lines that thicken where they cross; the second, larger net is fainter.
l1 = np.exp(-(e1 / 0.010) ** 1.3)
l2 = np.exp(-(e2 / 0.016) ** 1.3) * 0.55
v = np.clip(l1 + l2 + 0.6 * l1 * l2, 0, 1) ** 1.1
a = (v * 255).astype(np.uint8)
img = np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a])
Image.fromarray(img, 'RGBA').save(__import__('sys').argv[1] if len(__import__('sys').argv) > 1 else 'caustics.png', optimize=True)
