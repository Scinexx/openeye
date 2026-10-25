#!/usr/bin/env python3
"""Build every OpenEye icon from one master image.

Put your artwork in design/ and run:  python3 tools/build-icons.py

  design/mark.png         REQUIRED. Your icon, square, transparent background.
                          Pixel art: draw it at 32x32 (it is scaled up in whole steps, so it stays crisp).
                          Painted or vector art: export it at 512x512 or larger.
  design/favicon-16.png   Optional. A hand-tuned 16x16 version for browser tabs (pixel art looks
                          much better at 16px when it is redrawn rather than shrunk).
  design/logo.png         Optional. The logo shown in the site header, transparent background,
                          exactly 56px tall (shown at 28px; 56 keeps it sharp on phones), any width
                          up to 224px. Without it, the header uses mark.png.

Output goes to public/icons/ with fixed names that index.html already links to.
Needs Python 3 and Pillow (pip install pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / 'design'
OUT = ROOT / 'public' / 'icons'
FONT = ROOT / 'public' / 'fonts' / 'pixelify-sans-latin-700-normal.woff2'

# Site colours (public/style.css)
STONE = (43, 47, 58, 255)        # --stone, behind icons that cannot be transparent
STONE_DEEP = (35, 38, 47, 255)
BONE = (235, 230, 217, 255)
MUTED = (180, 179, 173, 255)
GOLD = (242, 196, 67, 255)

PIXEL_ART_MAX = 64  # masters this small are treated as pixel art and scaled without smoothing


def load(name):
    path = DESIGN / name
    return Image.open(path).convert('RGBA') if path.exists() else None


def is_pixel_art(img):
    return max(img.size) <= PIXEL_ART_MAX


def fit(img, box):
    """Scale img to fit inside a box x box square. Pixel art uses whole-number steps."""
    w, h = img.size
    if is_pixel_art(img):
        if box < max(w, h):  # shrinking pixel art loses detail; design/favicon-16.png avoids this
            k = box / max(w, h)
            return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.NEAREST)
        k = box // max(w, h)
        return img.resize((w * k, h * k), Image.NEAREST)
    k = box / max(w, h)
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def square(mark, size, art_share, background=None):
    """A size x size icon with the mark centred, filling art_share of the width."""
    canvas = Image.new('RGBA', (size, size), background or (0, 0, 0, 0))
    art = fit(mark, int(size * art_share))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def pixel_svg(img):
    """An SVG of pixel art (one rect per run of same-colour pixels), crisp at any size."""
    w, h = img.size
    px = img.load()
    rects = []
    for y in range(h):
        x = 0
        while x < w:
            c = px[x, y]
            if c[3] == 0:
                x += 1
                continue
            start = x
            while x < w and px[x, y] == c:
                x += 1
            fill = '#%02x%02x%02x' % c[:3]
            opacity = '' if c[3] == 255 else f' fill-opacity="{c[3] / 255:.3f}"'
            rects.append(f'<rect x="{start}" y="{y}" width="{x - start}" height="1" fill="{fill}"{opacity}/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">'
            + ''.join(rects) + '</svg>\n')


def og_image(mark, logo):
    """1200x630 link preview for Discord, X, etc."""
    img = Image.new('RGBA', (1200, 630), STONE)
    d = ImageDraw.Draw(img)
    for x in range(0, 1200, 48):
        d.line([(x, 0), (x, 630)], fill=STONE_DEEP)
    for y in range(0, 630, 48):
        d.line([(0, y), (1200, y)], fill=STONE_DEEP)
    art = fit(mark, 300)
    img.alpha_composite(art, (120, (630 - art.height) // 2))
    title = ImageFont.truetype(str(FONT), 112)
    sub = ImageFont.truetype(str(FONT), 40)
    x = 120 + art.width + 72
    d.text((x, 205), 'OpenEye', font=title, fill=BONE)
    d.text((x, 345), 'Open RotMG stats, deaths & loot', font=sub, fill=MUTED)
    d.rectangle([x, 410, x + 120, 418], fill=GOLD)
    return img.convert('RGB')


def main():
    mark = load('mark.png')
    if mark is None:
        raise SystemExit('design/mark.png is missing. See the notes at the top of this file.')
    if mark.width != mark.height:
        raise SystemExit(f'design/mark.png must be square (it is {mark.width}x{mark.height}).')
    small = load('favicon-16.png')
    logo = load('logo.png')
    OUT.mkdir(parents=True, exist_ok=True)

    # Browser tab: .ico with 16, 32 and 48 px versions (16 uses the hand-tuned file if there is one).
    sizes = {16: small.resize((16, 16), Image.NEAREST) if small else square(mark, 16, 1.0),
             32: square(mark, 32, 1.0), 48: square(mark, 48, 1.0)}
    sizes[48].save(OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)],
                   append_images=[sizes[16], sizes[32]])
    # Scalable tab icon for modern browsers.
    if is_pixel_art(mark):
        (OUT / 'icon.svg').write_text(pixel_svg(mark))
    elif (OUT / 'icon.svg').exists():
        (OUT / 'icon.svg').unlink()

    # iPhone/iPad home screen: no transparency allowed; iOS rounds the corners itself.
    square(mark, 180, 0.72, STONE).convert('RGB').save(OUT / 'apple-touch-icon.png')
    # Android / installed web app.
    square(mark, 192, 0.8, STONE).save(OUT / 'icon-192.png')
    square(mark, 512, 0.8, STONE).save(OUT / 'icon-512.png')
    # Android adaptive icon: the launcher may crop to a circle, so the art stays inside the middle 56%.
    square(mark, 512, 0.56, STONE).save(OUT / 'icon-maskable-512.png')

    # Site header: logo.png if given, otherwise the mark at 56px tall.
    if logo is not None:
        if logo.height != 56:
            raise SystemExit(f'design/logo.png must be 56px tall (it is {logo.height}px).')
        header = logo
    else:
        # Trim empty space so the artwork fills the header height.
        art = mark.crop(mark.getbbox())
        k = 56 / art.height
        if is_pixel_art(mark):
            k = max(1, 56 // art.height)
            art = art.resize((art.width * k, art.height * k), Image.NEAREST)
            # Pad to exactly 56px so each art pixel lands on whole screen pixels at 28px.
            header = Image.new('RGBA', (art.width, 56), (0, 0, 0, 0))
            header.alpha_composite(art, (0, (56 - art.height) // 2))
        else:
            header = art.resize((round(art.width * k), 56), Image.LANCZOS)
    header.save(OUT / 'logo.png')

    og_image(mark, logo).save(OUT / 'og.png', optimize=True)
    print('Built:', ', '.join(sorted(p.name for p in OUT.iterdir())))


if __name__ == '__main__':
    main()
