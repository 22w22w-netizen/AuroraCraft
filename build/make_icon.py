import math
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角方形底：深空蓝
radius = int(S * 0.22)
bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
bd.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=(9, 14, 26, 255))
img.alpha_composite(bg)

# 极光渐变光晕（多层椭圆模糊）
aurora = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ad = ImageDraw.Draw(aurora)
bands = [
    ((-220, 120, 760, 900), (34, 211, 238, 210)),   # 青
    ((60, -180, 980, 620), (74, 222, 128, 190)),    # 绿
    ((240, 320, 1180, 1080), (168, 85, 247, 200)),  # 紫
]
for box, color in bands:
    ad.ellipse(box, fill=color)
aurora = aurora.filter(ImageFilter.GaussianBlur(150))

# 裁切到圆角形状内
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(aurora, (0, 0), mask)

# 中央等距立方体（方块意象）
def iso_cube(draw, cx, cy, w, h, top, left, right):
    # 顶面菱形
    draw.polygon([(cx, cy - h * 0.62), (cx + w, cy - h * 0.16), (cx, cy + h * 0.30), (cx - w, cy - h * 0.16)], fill=top)
    # 左面
    draw.polygon([(cx - w, cy - h * 0.16), (cx, cy + h * 0.30), (cx, cy + h * 0.96), (cx - w, cy + h * 0.50)], fill=left)
    # 右面
    draw.polygon([(cx + w, cy - h * 0.16), (cx, cy + h * 0.30), (cx, cy + h * 0.96), (cx + w, cy + h * 0.50)], fill=right)

cube_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cd = ImageDraw.Draw(cube_layer)
iso_cube(cd, S // 2, int(S * 0.47), int(S * 0.235), int(S * 0.235),
         (245, 250, 255, 255), (176, 196, 222, 255), (120, 148, 186, 255))
# 立方体柔和阴影
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse([S * 0.28, S * 0.70, S * 0.72, S * 0.84], fill=(0, 0, 0, 120))
shadow = shadow.filter(ImageFilter.GaussianBlur(38))
img.alpha_composite(shadow)
img.alpha_composite(cube_layer)

# 顶部高光弧
gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gloss).ellipse([int(-S * 0.15), int(-S * 0.62), int(S * 1.15), int(S * 0.34)], fill=(255, 255, 255, 26))
gloss = gloss.filter(ImageFilter.GaussianBlur(60))
img.paste(gloss, (0, 0), mask)

img.save("build/icon-1024.png")
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
img.save("build/icon.ico", format="ICO", sizes=sizes)
print("icon.ico written with sizes:", sizes)
