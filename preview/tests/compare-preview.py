import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


def opaque(path):
    image = Image.open(path).convert("RGBA")
    background = Image.new("RGBA", image.size, "black")
    return Image.alpha_composite(background, image).convert("RGB")


def mask(image, threshold):
    channels = image.split()
    intensity = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    return intensity.point(lambda value: 255 if value >= threshold else 0)


def count(image):
    return sum(image.histogram()[1:])


def geometry(entry):
    native, web = opaque(entry["nativeImage"]), opaque(entry["webImage"])
    assert native.size == web.size, entry["key"]
    difference = ImageChops.difference(native, web)
    core_native, core_web = mask(native, 32), mask(web, 32)
    web_support, native_support = mask(web, 8), mask(native, 8)
    outside_native = count(ImageChops.subtract(core_native, web_support.filter(ImageFilter.MaxFilter(3))))
    outside_web = count(ImageChops.subtract(core_web, native_support.filter(ImageFilter.MaxFilter(3))))
    mae = sum(ImageStat.Stat(difference).mean) / 3
    difference.save(Path(entry["webImage"]).with_name(entry["key"] + "-difference.png"))
    return {"key": entry["key"], "mae": mae, "nativeOutsideOnePixel": outside_native, "webOutsideOnePixel": outside_web,
            "passed": outside_native == 0 and outside_web == 0 and mae < 3}


def font_bounds_accuracy(native, web):
    if native is None or web is None:
        return 100 if native == web else 0
    width = max(1, native[2] - native[0], web[2] - web[0])
    height = max(1, native[3] - native[1], web[3] - web[1])
    error = max(abs(native[0] - web[0]) / width, abs(native[2] - web[2]) / width,
                abs(native[1] - web[1]) / height, abs(native[3] - web[3]) / height)
    return max(0, 100 * (1 - error))


def compare_hud(entry, scene):
    native, web = opaque(entry["nativeImage"]), opaque(entry["webImage"])
    native_overlay = ImageChops.difference(native, opaque(scene["nativeImage"]))
    web_overlay = ImageChops.difference(web, opaque(scene["webImage"]))
    width, height = native.size
    fields = [("Timestamp", (0, height * .85, width * .35, height)),
              ("CenterDisplay", (width * .35, height * .35, width * .65, height * .7))]
    if width >= round(height * 4 / 3):
        fields.extend([("ChartInfo", (0, 0, width * .35, height * .4)),
                       ("ObjectStats", (width * .7, height * .5, width, height))])
    covered = Image.new("L", native.size)
    regions = []
    for name, rect in fields:
        box = tuple(round(value) for value in rect)
        ImageDraw.Draw(covered).rectangle(box, fill=255)
        native_mask, web_mask = mask(native_overlay.crop(box), 8), mask(web_overlay.crop(box), 8)
        native_bounds, web_bounds = native_mask.getbbox(), web_mask.getbbox()
        bounds_accuracy = font_bounds_accuracy(native_bounds, web_bounds)
        native_core, web_core = mask(native_overlay.crop(box), 128), mask(web_overlay.crop(box), 128)
        color_accuracy = 100
        if count(native_core) and count(web_core):
            native_color = ImageStat.Stat(native.crop(box), native_core).mean
            web_color = ImageStat.Stat(web.crop(box), web_core).mean
            color_accuracy = 100 * (1 - max(abs(a - b) for a, b in zip(native_color, web_color)) / 255)
        regions.append({"area": name, "nativeBounds": native_bounds, "webBounds": web_bounds,
                        "boundsAccuracy": bounds_accuracy, "colorAccuracy": color_accuracy,
                        "passed": min(bounds_accuracy, color_accuracy) >= 85})
    native_extra = count(ImageChops.subtract(mask(native_overlay, 8), covered))
    web_extra = count(ImageChops.subtract(mask(web_overlay, 8), covered))
    return {"key": entry["key"], "sceneReference": entry["sceneReference"], "fontRegions": regions,
            "nativePixelsOutsideHud": native_extra, "webPixelsOutsideHud": web_extra,
            "passed": all(region["passed"] for region in regions) and native_extra == 0 and web_extra == 0}


path = Path(sys.argv[1])
entries = json.loads(path.read_text(encoding="utf-8"))
by_key = {entry["key"]: entry for entry in entries}
results = [compare_hud(entry, by_key[entry["sceneReference"]]) if entry.get("hud") else geometry(entry) for entry in entries]
path.with_name("comparison.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print(json.dumps(results, indent=2))
assert results and all(entry["passed"] for entry in results), "Preview native/Web geometry comparison"
