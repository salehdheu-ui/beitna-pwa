"""Render the white house mark from favicon.svg as a transparent notification badge."""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "icons" / "notification-badge.png"

# Same house silhouette as assets/icons/favicon.svg. Android uses the alpha
# channel of the small badge and applies its own single-color tint.
house = [
    (256, 116), (106, 246), (150, 246), (150, 396), (234, 396),
    (234, 300), (278, 300), (278, 396), (362, 396), (362, 246),
    (406, 246),
]
canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
ImageDraw.Draw(canvas).polygon(house, fill=(255, 255, 255, 255))
canvas.resize((96, 96), Image.Resampling.LANCZOS).save(OUTPUT, optimize=True)
