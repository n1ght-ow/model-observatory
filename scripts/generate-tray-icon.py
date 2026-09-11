"""Generate the Windows system-tray icon for Router Monitor.

The dashboard mark (bars + trend line) is too dense at 16 px, so this script
renders a simplified variant meant to stay legible in the notification area:
a rounded blue tile with three bold bars and a cyan sparkline.
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public"
OUT_ICO = OUT_DIR / "router-monitor-tray.ico"

ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64)]

TOP_COLOR = (13, 30, 66)
BOTTOM_COLOR = (29, 78, 216)
CYAN = (56, 189, 248)


def lerp(start, end, t):
    return tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))


def build_gradient():
    gradient = Image.new("RGBA", (SIZE, SIZE))
    pixels = gradient.load()
    for y in range(SIZE):
        color = lerp(TOP_COLOR, BOTTOM_COLOR, y / (SIZE - 1))
        for x in range(SIZE):
            pixels[x, y] = (color[0], color[1], color[2], 255)
    return gradient


def main():
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [4, 4, SIZE - 5, SIZE - 5], radius=int(SIZE * 0.26), fill=255
    )
    canvas.paste(build_gradient(), (0, 0), mask)

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Three chunky bars. Fewer, fatter shapes survive the 16 px downsample.
    bar_width = 44
    gap = 22
    total = bar_width * 3 + gap * 2
    left = (SIZE - total) // 2
    baseline = SIZE - 52
    bars = [88, 132, 176]
    for index, height in enumerate(bars):
        x = left + index * (bar_width + gap)
        draw.rounded_rectangle(
            [x, baseline - height, x + bar_width, baseline],
            radius=14,
            fill=(255, 255, 255, 255 if index == 2 else 210),
        )

    # Sparkline sitting above the bars.
    draw.line([(58, 92), (128, 66), (198, 42)], fill=CYAN, width=22, joint="curve")
    for cx, cy in ((58, 92), (128, 66), (198, 42)):
        draw.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=CYAN)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_ICO, format="ICO", sizes=ICO_SIZES)
    print(f"wrote {OUT_ICO}")


if __name__ == "__main__":
    main()
