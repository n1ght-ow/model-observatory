"""Report the advance widths the tnum feature substitutes in.

The web marks almost every numeric cell tabular-nums, and Geist's default
figures are proportional (a '1' is 384/1000 em, a '0' is 663). GDI+ cannot
enable OpenType features, so the tray needs the numbers to hard-code the
tabular advances.
"""

from fontTools.ttLib import TTFont

SRC = "D:/dashboard/.next/static/media/caa3a2e1cccd8315-s.p.0wgildi0cnwt9.woff2"

font = TTFont(SRC)
upm = font["head"].unitsPerEm
cmap = font.getBestCmap()
hmtx = font["hmtx"]

# Collect the single substitutions the tnum feature applies.
glyphs = {}
gsub = font["GSUB"].table
for record in gsub.FeatureList.FeatureRecord:
    if record.FeatureTag != "tnum":
        continue
    for index in record.Feature.LookupListIndex:
        lookup = gsub.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            if hasattr(sub, "mapping"):
                glyphs.update(sub.mapping)

print("upm", upm, " tnum substitutions:", len(glyphs))
rows = []
for ch in "0123456789":
    base = cmap[ord(ch)]
    alt = glyphs.get(base, base)
    rows.append((ch, base, hmtx[base][0], alt, hmtx[alt][0]))

for ch, base, a0, alt, a1 in rows:
    print(f"  {ch}: {base}({a0}) -> {alt}({a1})")
widths = sorted({r[4] for r in rows})
print("tabular advance candidates:", widths)
font.close()
