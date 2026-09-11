"""Generate static Geist instances for the tray.

The web app renders text in Geist (next/font bundles the woff2 subsets in
.next/static/media). GDI+ cannot read woff2 and only uses a variable font's
default instance, so this script decompresses the Latin subset and emits one
static TTF per weight the panel draws with.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / ".next" / "static" / "media"
OUT = ROOT / "tray" / "fonts"

# (weight, family name written into the name table)
WEIGHTS = [(400, "Geist"), (500, "Geist Medium"), (600, "Geist SemiBold"), (700, "Geist Bold")]


def find_latin_subset():
    best = None
    for path in sorted(MEDIA.glob("*.woff2")):
        font = TTFont(path, lazy=True)
        family = font["name"].getDebugName(1) or ""
        cmap = font.getBestCmap() or {}
        covers_latin = ord("O") in cmap and ord("A") in cmap and ord("z") in cmap
        score = font["maxp"].numGlyphs
        font.close()
        if family == "Geist" and covers_latin:
            if best is None or score > best[1]:
                best = (path, score)
    return best[0] if best else None


def rename(font, family):
    name = font["name"]
    for record in name.names:
        if record.nameID in (1, 16):
            record.string = family
        elif record.nameID == 4:
            record.string = family
        elif record.nameID == 6:
            record.string = family.replace(" ", "")
        elif record.nameID == 2:
            record.string = "Regular"
    for record in list(name.names):
        if record.nameID in (17, 22):
            name.removeNames(record.nameID, record.platformID, record.platEncID, record.langID)


def main():
    source = find_latin_subset()
    if source is None:
        raise SystemExit("no Geist latin subset found under .next/static/media")

    OUT.mkdir(parents=True, exist_ok=True)
    for weight, family in WEIGHTS:
        font = TTFont(source)
        if "fvar" in font:
            font = instancer.instantiateVariableFont(font, {"wght": weight}, inplace=False)
        # GDI+ exposes a variable font's named instances as font families, which
        # would ignore the family name set below; drop the variation tables so each
        # file is a plain static face. OpenType layout is unused by the panel too.
        for table in ("fvar", "STAT", "GSUB", "GPOS", "GDEF", "HVAR", "MVAR", "avar"):
            if table in font:
                del font[table]
        font.flavor = None
        rename(font, family)
        target = OUT / (family.replace(" ", "") + ".ttf")
        font.save(target)
        font.close()
        print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
