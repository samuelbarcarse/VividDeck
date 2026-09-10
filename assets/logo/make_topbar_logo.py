"""
Derives the app's two marks from the brand lockup next to this file:

    web/public/sifttcg-icon.png   the top bar, transparent
    web/app/favicon.ico           the browser tab, on its own ground

Both come from one crop so they cannot drift apart, but they are not the same
image. The top bar sits on #08080a, so its mark is painted in the foreground
grey and left transparent. A favicon has no such guarantee — browser tabs,
bookmark bars and history lists are light in some themes and dark in others, and
a near-white mark on transparent disappears entirely against the light ones. So
the favicon carries the app's own background with it, which is also why it reads
as an app icon rather than as a floating shape.

The source is the logo as delivered: navy artwork on a white card, stacked with
a wordmark under the icon. Neither of those survives contact with the app, which
is near-black and has a top bar a few dozen pixels tall — dropped in as-is the
mark reads as a white slab. So this lifts the white ground out to alpha and
repaints the navy in the app's foreground grey.

The purple accent is left exactly as drawn. It is the one saturated colour in the
whole UI and the only part of the mark that is already legible on black.

Only the icon is emitted. The wordmark in the source lockup is the *previous*
project name rendered as pixels — it cannot be re-lettered, only replaced — so
the top bar now sets the name in Geist alongside this icon instead
(components/TopBar.tsx). That keeps the name in one place, in real text, where
renaming it again costs a string rather than a new asset.

If a proper SiftTCG lockup ever arrives: drop it in beside this file, point SRC
at it, re-check the icon crop below, and switch TopBar back to a single image.

Run from the repository root, with Pillow available:

    ingest/.venv/Scripts/python.exe assets/logo/make_topbar_logo.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
# Keeps its original name on purpose: this file *is* the old brand's delivered
# artwork, and calling it sifttcg-lockup.jpg would misdescribe what is in it.
SRC = ROOT / 'assets' / 'logo' / 'vividdeck-lockup.jpg'
ICON_OUT = ROOT / 'web' / 'public' / 'sifttcg-icon.png'
FAVICON_OUT = ROOT / 'web' / 'app' / 'favicon.ico'

FOREGROUND = (237, 237, 237)   # --foreground, so the mark matches body text
BACKGROUND = (8, 8, 10)        # --background, the ground the favicon carries
ALPHA_FULL = 200               # ink this far from white is fully opaque

def to_dark_mode(im):
    """White background -> alpha; navy ink -> foreground; purple kept as drawn."""
    im = im.convert('RGB')
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    src, dst = im.load(), out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = src[x, y]
            a = min(255, (255 - min(r, g, b)) * 255 // ALPHA_FULL)
            if a == 0:
                continue
            if b - max(r, g) > 40:
                dst[x, y] = (r, g, b, a)       # the purple accent already pops
            else:
                dst[x, y] = FOREGROUND + (a,)  # navy would vanish on #08080a
    return out

full = Image.open(SRC)
mark = to_dark_mode(full.crop((190, 86, 518, 387)))     # the card + spark

# --- top bar -------------------------------------------------------------
# 96px tall for a mark drawn at 20-28px: better than 3x on the densest display
# the top bar is likely to meet, and small enough not to be worth optimising.
ICON_H = 96
icon = mark.resize((round(mark.width * ICON_H / mark.height), ICON_H), Image.LANCZOS)
icon.save(ICON_OUT)
print(ICON_OUT, icon.size)

# --- browser tab ---------------------------------------------------------
# Drawn once at 256 and downsampled by the ICO writer, so every size comes from
# the same antialiased source rather than from progressively worse resizes.
SIDE = 256
PAD = round(SIDE * 0.08)        # the mark needs air, or it reads as a smudge at 16px
RADIUS = round(SIDE * 0.20)     # enough to look deliberate, not enough to lose corners at 16px

canvas = Image.new('RGBA', (SIDE, SIDE), BACKGROUND + (255,))
corners = Image.new('L', (SIDE, SIDE), 0)
ImageDraw.Draw(corners).rounded_rectangle([0, 0, SIDE - 1, SIDE - 1], radius=RADIUS, fill=255)
canvas.putalpha(corners)

fitted = mark.copy()
fitted.thumbnail((SIDE - 2 * PAD, SIDE - 2 * PAD), Image.LANCZOS)
canvas.alpha_composite(fitted, ((SIDE - fitted.width) // 2, (SIDE - fitted.height) // 2))

# 16 and 32 are what tabs and bookmarks actually use; 48 and 64 are for Windows
# taskbar and the higher-density cases that would otherwise upscale 32.
canvas.save(FAVICON_OUT, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print(FAVICON_OUT, canvas.size)
