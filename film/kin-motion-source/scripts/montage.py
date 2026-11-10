# Review montage: python3 scripts/montage.py out/dir out.png  (labels each tile with its frame number)
import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
files = sorted(f for f in os.listdir(d) if f.endswith(".png"))
ims = [Image.open(os.path.join(d, f)).convert("RGB") for f in files]
w, h = ims[0].size
cols = 3
rows = (len(ims) + cols - 1) // cols
pad = 8
sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + pad) + pad), (200, 200, 200))
dr = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x = pad + (i % cols) * (w + pad); y = pad + (i // cols) * (h + pad)
    sheet.paste(im, (x, y))
    dr.rectangle([x, y, x + 70, y + 20], fill=(255, 220, 0)); dr.text((x + 4, y + 4), f[1:5], fill=(0, 0, 0))
sheet.save(out)
print(out, sheet.size)
