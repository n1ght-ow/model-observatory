"""Generate the Router Monitor dashboard icon.

Renders a dashboard-style mark (bar chart + rising trend line) at high
resolution, then exports a multi-size Windows .ico plus a PNG preview.
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public"
OUT_ICO = OUT_DIR / "router-monitor.ico"
OUT_PNG = OUT_DIR / "router-monitor.png"

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

TOP_COLOR = (12, 26, 56)
BOTTOM_COLOR = (37, 99, 235)
CYAN = (56, 189, 248)


def lerp(start, end, t):
    return tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))


def build_gradient():
    gradient = Image.new("RGBA", (SIZE, SIZE))
    pixels = gradient.load()
    for y in range(SIZE):
        color = lerp(TOP_COLOR, BOTTOM_COLOR, y / (SIZE - 1))
        for x in range(SIZE):
            pixels[x, y] = (*color, 255)
    return gradient


def main():
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255
    )
    canvas.paste(build_gradient(), (0, 0), mask)

    draw = ImageDraw.Draw(canvas, "RGBA")

    # Baseline.
    draw.rounded_rectangle([300, 792, 724, 808], radius=8, fill=(255, 255, 255, 90))

    # Bars with increasing opacity so the tallest reads as the focus.
    bars = [
        (300, 240, 150),
        (457, 360, 200),
        (614, 500, 255),
    ]
    for x, height, alpha in bars:
        draw.rounded_rectangle(
            [x, 800 - height, x + 110, 800],
            radius=18,
            fill=(255, 255, 255, alpha),
        )

    # Rising trend line above the bars.
    points = [(330, 500), (512, 380), (694, 240)]
    draw.line(points, fill=CYAN, width=28, joint="curve")
    for cx, cy in points:
        draw.ellipse([cx - 34, cy - 34, cx + 34, cy + 34], fill=CYAN)
        draw.ellipse([cx - 19, cy - 19, cx + 19, cy + 19], fill=(255, 255, 255, 255))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_PNG, format="PNG")
    canvas.save(OUT_ICO, format="ICO", sizes=ICO_SIZES)

    print(f"wrote {OUT_ICO}")
    print(f"wrote {OUT_PNG}")


if __name__ == "__main__":
    main()
