"""Regenerate the offline JV AppIcon assets with Pillow (no network required)."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent / "JiufenVocabulary" / "Assets.xcassets"
DEST = ROOT / "AppIcon.appiconset"
DEST.mkdir(parents=True, exist_ok=True)
fonts = [Path("C:/Windows/Fonts/arialbd.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")]
font_path = next((font for font in fonts if font.is_file()), None)
if font_path is None:
    raise SystemExit("Install Arial Bold or DejaVu Sans Bold before regenerating AppIcon assets.")
canvas = Image.new("RGB", (1024, 1024), "#202a23")
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((95, 95, 929, 929), radius=135, outline="#647b60", width=7)
font = ImageFont.truetype(str(font_path), 440)
draw.text((512, 455), "JV", font=font, anchor="mm", fill="#c0dda6", stroke_width=1)
draw.rounded_rectangle((270, 750, 754, 785), radius=17, fill="#c0dda6")
draw.ellipse((210, 731, 284, 805), fill="#e4eddc")
draw.ellipse((740, 731, 814, 805), fill="#e4eddc")
specs = [("iphone", "20x20", 2), ("iphone", "20x20", 3), ("iphone", "29x29", 2), ("iphone", "29x29", 3), ("iphone", "40x40", 2), ("iphone", "40x40", 3), ("iphone", "60x60", 2), ("iphone", "60x60", 3), ("ipad", "20x20", 1), ("ipad", "20x20", 2), ("ipad", "29x29", 1), ("ipad", "29x29", 2), ("ipad", "40x40", 1), ("ipad", "40x40", 2), ("ipad", "76x76", 1), ("ipad", "76x76", 2), ("ipad", "83.5x83.5", 2), ("ios-marketing", "1024x1024", 1)]
images = []
for idiom, size, scale in specs:
    pixels = round(float(size.split("x")[0]) * scale)
    name = f"icon-{idiom}-{size}@{scale}x.png"
    canvas.resize((pixels, pixels), Image.Resampling.LANCZOS).save(DEST / name)
    images.append({"idiom": idiom, "size": size, "scale": f"{scale}x", "filename": name})
(DEST / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n", encoding="utf-8")
(ROOT / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n", encoding="utf-8")
print(f"Generated {len(images)} opaque AppIcon images in {DEST}")
