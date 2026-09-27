#!/usr/bin/env python3
"""Generate the PWA icon set in public/.

A host-side developer tool, not part of the runtime: it is run by hand when the
icon design changes, and its output (the PNGs) is what ships. Requires Pillow.

    python3 scripts/make-icons.py

Bump the ?v= query in app/manifest.ts after regenerating. Android bakes the
icon into a generated APK at install time and only re-reads it when it notices
the manifest changed, so an icon swapped behind an unchanged URL never reaches
a home screen that already has the app.
"""

from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"

ACCENT = (168, 85, 247)      # --accent, violet-500
ACCENT_DEEP = (88, 28, 135)  # violet-900, the far end of the maskable gradient
TILE_TOP = (30, 19, 42)      # the violet-tinted dark the background fades from
TILE_BOTTOM = (18, 18, 18)   # --app-bg's base
WHITE = (255, 255, 255)

SUPERSAMPLE = 4


def vertical_gradient(size, top, bottom):
    """A one-pixel-wide gradient stretched to `size` — cheaper than per-pixel."""
    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
    return strip.resize((size, size), Image.Resampling.BICUBIC)


def screen_icon(size, *, background, screen_fill, play, bleed=False):
    """The Adflix mark: a wide screen holding a play triangle — a library of
    films rather than a feed of pictures.

    `bleed` fills the whole square (iOS applies its own rounding, and a maskable
    icon must have paint in every corner); otherwise the tile gets Android's
    rounded-square silhouette.
    """
    s = size * SUPERSAMPLE
    img = background(s).convert("RGBA")

    if not bleed:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, s - 1, s - 1), radius=s * 0.22, fill=255
        )
        img.putalpha(mask)

    draw = ImageDraw.Draw(img)

    # A 16:10 screen, centred. Smaller when bleeding so the maskable crop keeps
    # it inside the 80% safe zone.
    w = s * (0.58 if bleed else 0.66)
    h = w * 0.625
    cx = cy = s / 2
    screen = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    draw.rounded_rectangle(screen, radius=h * 0.18, fill=screen_fill)

    # The play triangle, nudged right so it looks optically centred.
    t = h * 0.46
    px = cx - t * 0.02
    draw.polygon(
        [
            (px - t * 0.40, cy - t / 2),
            (px - t * 0.40, cy + t / 2),
            (px + t * 0.48, cy),
        ],
        fill=play,
    )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)

    def tile(s):
        return vertical_gradient(s, TILE_TOP, TILE_BOTTOM)

    def violet(s):
        return vertical_gradient(s, ACCENT, ACCENT_DEEP)

    # "any": the dark tile, so the icon reads as the app on a dark home screen
    # rather than as a violet blob.
    for size in (512, 192):
        screen_icon(size, background=tile, screen_fill=ACCENT, play=WHITE).save(PUBLIC / f"icon-{size}.png")

    # "maskable": paint to every edge. The launcher crops this to whatever
    # shape it likes, so the screen sits well inside the 80% safe zone.
    screen_icon(
        512, background=violet, screen_fill=WHITE, play=ACCENT_DEEP, bleed=True
    ).save(PUBLIC / "icon-maskable-512.png")

    # iOS rounds this itself and puts it on the home screen as-is.
    screen_icon(180, background=tile, screen_fill=ACCENT, play=WHITE, bleed=True).save(PUBLIC / "apple-touch-icon.png")

    screen_icon(32, background=tile, screen_fill=ACCENT, play=WHITE).save(PUBLIC / "favicon-32.png")

    for f in sorted(PUBLIC.glob("*.png")):
        print(f"{f.name}: {f.stat().st_size} B")


if __name__ == "__main__":
    main()
