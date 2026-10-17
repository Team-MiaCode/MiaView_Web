"""Package the original editor and difficulty-card fonts with glyph verification."""
from pathlib import Path
import hashlib
import json
import shutil
from fontTools.ttLib import TTFont
from fontTools import subset

root = Path(__file__).resolve().parents[1]
source = root / "vendor/MiaCode/assets/fonts/MapleMonoNormalNL-CN-Regular.ttf"
output = root / "ui/components/fonts"
output.mkdir(parents=True, exist_ok=True)
original = TTFont(source, recalcTimestamp=False)
family = original["name"].getBestFamilyName()
characters = set(original.getBestCmap())
line_ratio = (original["hhea"].ascent - original["hhea"].descent + original["hhea"].lineGap) / original["head"].unitsPerEm
files = []
styles = []
coverage = set()
for name, first, last in [("lower", 0, 0x6FFF), ("upper", 0x7000, 0x10FFFF)]:
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.glyph_names = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=[character for character in characters if first <= character <= last])
    processor.subset(font)
    font.flavor = "woff2"
    target = output / f"MapleMonoNormalNL-CN-{name}.woff2"
    font.save(target)
    decoded = TTFont(target)
    cmap = decoded.getBestCmap()
    assert all(original.getBestCmap()[character] == glyph for character, glyph in cmap.items())
    for glyph in set(cmap.values()):
        assert original["hmtx"].metrics[glyph] == decoded["hmtx"].metrics[glyph]
        assert original["glyf"][glyph].getCoordinates(original["glyf"]) == decoded["glyf"][glyph].getCoordinates(decoded["glyf"])
    coverage.update(cmap)
    unicode_range = f"U+{first:X}-{last:X}"
    files.append({"path": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                  "byteSize": target.stat().st_size, "unicodeRange": unicode_range})
    styles.append('@font-face { font-family: ' + json.dumps(family) + '; src: url("fonts/' + target.name + '") format("woff2"); '
                  'font-style: normal; font-weight: 400; font-display: swap; unicode-range: ' + unicode_range + '; }')
assert coverage == characters
(output / "MapleMonoNormalNL-CN-Regular.woff2").unlink(missing_ok=True)
shutil.copyfile(source.with_name("MapleMono-OFL.txt"), output / "MapleMono-OFL.txt")
record = {"family": family, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
          "characters": len(characters), "lineRatio": line_ratio, "files": files}
record["cardFonts"] = []
license_records = []
for weight, numeric_weight in [("Heavy", 900), ("Bold", 700)]:
    card_source = root / f"vendor/MiaCode/src/intro/assets/fonts/ResourceHanRoundedCN-{weight}.ttf"
    card = TTFont(card_source, recalcTimestamp=False)
    card.flavor = "woff2"
    target = output / f"ResourceHanRoundedCN-{weight}.woff2"
    card.save(target)
    original_card = TTFont(card_source)
    decoded_card = TTFont(target)
    assert original_card.getBestCmap() == decoded_card.getBestCmap()
    for glyph in set(original_card.getBestCmap().values()):
        assert original_card["hmtx"].metrics[glyph] == decoded_card["hmtx"].metrics[glyph]
        assert original_card["glyf"][glyph].getCoordinates(original_card["glyf"]) == decoded_card["glyf"][glyph].getCoordinates(decoded_card["glyf"])
    alias = f"Resource Han Rounded CN {weight}"
    styles.append('@font-face { font-family: ' + json.dumps(alias) + '; src: url("fonts/' + target.name + '") format("woff2"); '
                  f'font-style: normal; font-weight: {numeric_weight}; font-display: swap; }}')
    record["cardFonts"].append({"family": alias, "source": card_source.relative_to(root).as_posix(),
                                "sourceSha256": hashlib.sha256(card_source.read_bytes()).hexdigest(),
                                "path": target.name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                                "characters": len(original_card.getBestCmap()), "byteSize": target.stat().st_size})
    license_records.append(weight + "\n" + "\n".join(sorted({name.toUnicode() for name in original_card["name"].names if name.nameID in [0, 13, 14]})))
ofl = source.with_name("MapleMono-OFL.txt").read_text(encoding="utf-8")
ofl_body = ofl[ofl.index("SIL OPEN FONT LICENSE Version 1.1"):]
(output / "ResourceHanRoundedCN-LICENSE.txt").write_text("\n\n".join(license_records) + "\n\n" + ofl_body, encoding="utf-8")
(output / "font.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
(output.parent / "fonts.css").write_text(
    '\n'.join(styles) + '\n:root { --code-font-family: ' + json.dumps(family) + f'; --code-font-line-ratio: {line_ratio}; }}\n', encoding="utf-8")
print(json.dumps(record), flush=True)
