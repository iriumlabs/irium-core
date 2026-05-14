"""
Regenerate Irium Core installer BMP images.

Produces:
  nsis-sidebar.bmp     164x314  NSIS welcome/finish sidebar
  nsis-header.bmp      150x57   NSIS inner-page header strip
  installer-banner.bmp 493x58   WiX MSI banner
  installer-dialog.bmp 493x312  WiX MSI welcome dialog
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, sys

ICONS = r'C:\Users\Ibrahim\Desktop\irium-core\src-tauri\icons'
LOGO  = os.path.join(ICONS, 'icon.png')

# ── Palette ──────────────────────────────────────────────────────────────────
BG      = (10,  14,  26)    # #0a0e1a
BG_DARK = (6,   9,   17)    # slightly darker for gradient bottoms
WHITE   = (230, 235, 252)   # near-white
BLUE    = (110, 198, 255)   # #6ec6ff accent
DIM     = (90,  100, 125)   # subdued text
VERSION = '1.0.6'

# ── Helpers ───────────────────────────────────────────────────────────────────
def font(size, bold=False):
    candidates = (
        [r'C:\Windows\Fonts\segoeuib.ttf',
         r'C:\Windows\Fonts\arialbd.ttf',
         r'C:\Windows\Fonts\verdanab.ttf']
        if bold else
        [r'C:\Windows\Fonts\segoeui.ttf',
         r'C:\Windows\Fonts\arial.ttf',
         r'C:\Windows\Fonts\verdana.ttf']
    )
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

def tw(draw, text, f):
    """Return text pixel width."""
    try:
        bb = draw.textbbox((0, 0), text, font=f)
        return bb[2] - bb[0], bb[3] - bb[1]
    except AttributeError:
        return f.getsize(text)

def cx(draw, text, f, width):
    """Horizontal centre x for text in given width."""
    w, _ = tw(draw, text, f)
    return (width - w) // 2

def vgradient(img, c1, c2):
    W, H = img.size
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / max(H - 1, 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    return img

def hgradient(img, c1, c2):
    W, H = img.size
    d = ImageDraw.Draw(img)
    for x in range(W):
        t = x / max(W - 1, 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        d.line([(x, 0), (x, H)], fill=(r, g, b))
    return img

def glow(base_rgba, cx_, cy_, radius, color, blur=18, alpha=70):
    """Soft glow circle composited onto base."""
    layer = Image.new('RGBA', base_rgba.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = radius
    d.ellipse([cx_ - r, cy_ - r, cx_ + r, cy_ + r],
              fill=(color[0], color[1], color[2], alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(base_rgba, layer)

def paste_logo(img, logo_rgba, lx, ly, size):
    resized = logo_rgba.resize((size, size), Image.LANCZOS)
    base = img.convert('RGBA')
    base = glow(base, lx + size // 2, ly + size // 2,
                size // 2 + 14, BLUE, blur=20, alpha=60)
    base.paste(resized, (lx, ly), resized)
    return base.convert('RGB')

def save(img, name):
    path = os.path.join(ICONS, name)
    img.save(path)
    kb = os.path.getsize(path) / 1024
    print(f'  {name}  {img.size[0]}x{img.size[1]}  {kb:.1f} KB')

# ── Load source logo ──────────────────────────────────────────────────────────
logo = Image.open(LOGO).convert('RGBA')
print(f'Logo source: {logo.size}  ({os.path.basename(LOGO)})')
print()


# ─────────────────────────────────────────────────────────────────────────────
# 1. nsis-sidebar.bmp — 164×314
# ─────────────────────────────────────────────────────────────────────────────
W, H = 164, 314
img = vgradient(Image.new('RGB', (W, H), BG), BG, BG_DARK)

ls = 84
lx = (W - ls) // 2
ly = 34
img = paste_logo(img, logo, lx, ly, ls)
d = ImageDraw.Draw(img)

ft_big  = font(20, bold=True)
ft_med  = font(10)
ft_tiny = font(8)

y_name = ly + ls + 14
x_iri = cx(d, 'IRIUM', ft_big, W)
d.text((x_iri, y_name), 'IRIUM', font=ft_big, fill=WHITE)

y_core = y_name + 26
x_core = cx(d, 'CORE', ft_med, W)
d.text((x_core, y_core), 'CORE', font=ft_med, fill=BLUE)

sep_y = y_core + 22
d.line([(22, sep_y), (W - 22, sep_y)], fill=(32, 42, 65))

x_ver = cx(d, f'v{VERSION}', ft_tiny, W)
d.text((x_ver, H - 26), f'v{VERSION}', font=ft_tiny, fill=DIM)

d.line([(W - 1, 0), (W - 1, H)], fill=(28, 40, 62))

save(img, 'nsis-sidebar.bmp')


# ─────────────────────────────────────────────────────────────────────────────
# 2. nsis-header.bmp — 150×57
# ─────────────────────────────────────────────────────────────────────────────
W, H = 150, 57
img = hgradient(Image.new('RGB', (W, H), BG), BG, BG_DARK)

ls = 36
lx, ly = 8, (H - ls) // 2
img = paste_logo(img, logo, lx, ly, ls)
d = ImageDraw.Draw(img)

ft_h1 = font(12, bold=True)
ft_h2 = font(9)

tx = lx + ls + 9
tw1, th1 = tw(d, 'Irium', ft_h1)
tw2, th2 = tw(d, 'Core',  ft_h2)
total_h = th1 + 4 + th2
ty = (H - total_h) // 2
d.text((tx, ty),            'Irium', font=ft_h1, fill=WHITE)
d.text((tx, ty + th1 + 4),  'Core',  font=ft_h2, fill=BLUE)

d.line([(0, H - 1), (W, H - 1)], fill=(28, 40, 62))

save(img, 'nsis-header.bmp')


# ─────────────────────────────────────────────────────────────────────────────
# 3. installer-banner.bmp — 493×58
# ─────────────────────────────────────────────────────────────────────────────
W, H = 493, 58
img = hgradient(Image.new('RGB', (W, H), BG), BG, BG_DARK)

ls = 40
lx, ly = 12, (H - ls) // 2
img = paste_logo(img, logo, lx, ly, ls)
d = ImageDraw.Draw(img)

ft_b1 = font(16, bold=True)
ft_b2 = font(10)

tx = lx + ls + 14
tw_t, th_t = tw(d, 'Irium Core', ft_b1)
tw_s, th_s = tw(d, 'Full-node desktop wallet and miner', ft_b2)
total_h = th_t + 4 + th_s
ty = (H - total_h) // 2
d.text((tx, ty),             'Irium Core',                      font=ft_b1, fill=WHITE)
d.text((tx, ty + th_t + 4),  'Full-node desktop wallet and miner', font=ft_b2, fill=DIM)

# Blue→purple gradient accent line at bottom
for x in range(W):
    t = x / max(W - 1, 1)
    r = int(BLUE[0] + (167 - BLUE[0]) * t)
    g = int(BLUE[1] + (139 - BLUE[1]) * t)
    b = int(BLUE[2] + (250 - BLUE[2]) * t)
    d.point((x, H - 1), fill=(r, g, b))

save(img, 'installer-banner.bmp')


# ─────────────────────────────────────────────────────────────────────────────
# 4. installer-dialog.bmp — 493×312
# ─────────────────────────────────────────────────────────────────────────────
W, H = 493, 312
img = vgradient(Image.new('RGB', (W, H), BG), BG, BG_DARK)

ls = 110
lx = (W - ls) // 2
ly = 44
img = paste_logo(img, logo, lx, ly, ls)
d = ImageDraw.Draw(img)

ft_d1 = font(28, bold=True)
ft_d2 = font(13)
ft_d3 = font(10)

title = 'IRIUM CORE'
x_t = cx(d, title, ft_d1, W)
tw_t, th_t = tw(d, title, ft_d1)
d.text((x_t, ly + ls + 16), title, font=ft_d1, fill=WHITE)

subtitle = 'Trustless Settlement Platform'
x_s = cx(d, subtitle, ft_d2, W)
tw_s, th_s = tw(d, subtitle, ft_d2)
d.text((x_s, ly + ls + 16 + th_t + 10), subtitle, font=ft_d2, fill=BLUE)

ver = f'Version {VERSION}'
x_v = cx(d, ver, ft_d3, W)
d.text((x_v, H - 28), ver, font=ft_d3, fill=DIM)

save(img, 'installer-dialog.bmp')

print()
print('Done — all four installer images written to src-tauri/icons/')
