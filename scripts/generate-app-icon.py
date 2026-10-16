"""Export the approved generated artwork as multi-resolution Windows icons."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "desktop" / "artwork" / "model-observatory.png"
OUTPUTS = [ROOT / "public" / "app.ico", ROOT / "src" / "app" / "favicon.ico", ROOT / "desktop" / "icon.ico"]

ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]

def main():
    with Image.open(SOURCE) as source:
        canvas = source.convert("RGBA")
        for output in OUTPUTS:
            output.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(output, format="ICO", sizes=ICO_SIZES)
            print(f"wrote {output}")


if __name__ == "__main__":
    main()
