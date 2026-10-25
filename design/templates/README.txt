OpenEye icon templates
======================

You only need to make ONE thing: your logo mark, as a square image.
Everything else (browser tab icon, phone home-screen icons, link previews,
site header) is generated from it.

WHAT TO MAKE
------------
1. mark.png  (required)
   Your icon on a transparent background, square.
   - Pixel art: draw it on mark-32x32.png (32 x 32 pixels).
     Open mark-32x32-guide.png as a layer underneath while you draw: each
     grid cell is one pixel. Keep the art inside the red box (2 pixel
     margin) so it doesn't touch the edges.
   - Painted or vector art: use mark-512x512.png (512 x 512 or bigger).
     mark-512x512-guide.png shows the red margin box and a green circle:
     Android may crop the icon to that circle, so keep anything important
     inside it.

2. favicon-16.png  (optional, recommended for pixel art)
   A 16 x 16 redraw of your mark for browser tabs. Shrinking a 32 x 32
   pixel drawing to 16 x 16 loses detail; a hand-drawn 16 x 16 looks much
   better. Use favicon-16x16.png and favicon-16x16-guide.png.

3. logo.png  (optional)
   The logo in the site header. Exactly 56 pixels tall (it is shown at 28,
   the extra size keeps it sharp on phones), up to 224 pixels wide,
   transparent background. Use logo-56px-tall.png; the guide's yellow line
   is the vertical centre.
   Without this file, the header uses your mark.
   The word "OpenEye" is shown next to it as text. If your logo already
   includes the name, say so and the text will be removed.

Tips
- No animation: these are all still images.
- Use a transparent background. Where a background is required (iPhone
  home screen), the site's dark slate colour #2b2f3a is filled in.
- Test it small: zoom out until it is about the size of a browser tab.
- preview-sheet.png shows every generated file and where it appears.

WHEN YOU ARE DONE
-----------------
Put mark.png (and favicon-16.png / logo.png if you made them) in the
repo's design/ folder, replacing the placeholders, then run:

    python3 tools/build-icons.py

and push. Or just send the files to Claude and it will do this for you.
