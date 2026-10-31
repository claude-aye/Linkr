import sys, glob, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(d, '*.png')), key=lambda f: float(os.path.basename(f)[1:-4]))
cols = 3; w, h = 480, 360
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * (h + 24)), 'white')
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((w, h))
    x, y = (i % cols) * w, (i // cols) * (h + 24)
    sheet.paste(im, (x, y + 24)); dr.text((x + 6, y + 4), os.path.basename(f), fill='black')
sheet.save(out)
