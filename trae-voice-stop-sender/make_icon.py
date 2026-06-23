import struct, zlib, os

SIZE = 128
OUT = os.path.join(os.path.dirname(__file__), 'icon.png')

def inside_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

# RGBA background transparent
pixels = bytearray()
# Colors
BG_A = 0           # transparent
MIC_BODY = (52, 120, 215)   # blue body
MIC_DARK = (30, 90, 170)    # dark blue for mesh/shadow
MIC_LIGHT = (120, 170, 230) # light blue highlight
STAND = (120, 120, 120)
STAND_DARK = (80, 80, 80)
RED = (220, 60, 60)

def pick(x, y):
    # Mic head (ellipse), cx=64, cy=50, rx=22, ry=28
    # Anti-aliased: distance from center
    cx, cy = 64, 52
    rx, ry = 22, 28
    dx = (x - cx) / rx
    dy = (y - cy) / ry
    d2 = dx * dx + dy * dy
    if d2 <= 1.0:
        # outer ring dark
        if d2 > 0.85:
            return MIC_DARK + (255,)
        # mic top highlight
        if (x - cx) ** 2 / 100 + (y - cy + 12) ** 2 / 30 < 1:
            return MIC_LIGHT + (255,)
        # inner mesh pattern - vertical stripes
        if (x - cx) % 6 < 3 and abs(y - cy) < 20:
            return MIC_DARK + (255,)
        return MIC_BODY + (255,)
    # Mic neck (vertical rectangle below head)
    if 60 <= x <= 68 and 80 <= y <= 95:
        return STAND + (255,)
    # Mic base (horizontal rectangle)
    if 48 <= x <= 80 and 95 <= y <= 100:
        return STAND + (255,)
    if 44 <= x <= 84 and 100 <= y <= 104:
        return STAND_DARK + (255,)
    # Sound waves (arcs on left and right)
    for (sx, sy, sr, width) in [
        (64, 85, 36, 3),
        (64, 85, 44, 3),
    ]:
        dd2 = (x - sx) ** 2 + (y - sy) ** 2
        if (sr - width/2) ** 2 <= dd2 <= (sr + width/2) ** 2:
            # only arcs (top-left and top-right quadrants), exclude bottom
            if y < sy:
                return MIC_LIGHT + (255,)
    return (0, 0, 0, 0)

# Build row bytes
raw = bytearray()
for y in range(SIZE):
    raw.append(0)  # filter type 0 (None)
    for x in range(SIZE):
        r, g, b, a = pick(x, y)
        raw.extend([r, g, b, a])

# PNG structure
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

header = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)
idat = zlib.compress(bytes(raw), 9)
png = header + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

with open(OUT, 'wb') as f:
    f.write(png)
print(f'Wrote {OUT} ({len(png)} bytes)')
