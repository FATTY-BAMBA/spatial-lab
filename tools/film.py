"""Assemble the demo film (1920x1080, 30 fps) from the AI renders, clips and app screenshots.
usage: python3 tools/film.py <out.mp4> <screens_dir>   (screens_dir holds plan.png, approved.png)"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT, SCREENS = sys.argv[1], sys.argv[2]
W, H, FPS, XF = 1920, 1080, 30, 0.6
TMP = tempfile.mkdtemp(prefix='film_')
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-{}.ttc'
TC = 3  # face index of "Noto Sans CJK TC" inside the collection
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
TAPE = (224, 169, 30)

def font(weight, size):
    try: return ImageFont.truetype(FONT.format(weight), size, index=TC)
    except Exception: return ImageFont.truetype(FONT.format(weight), size)

def caption_png(name, title, sub='', kicker=''):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    # soft bottom gradient for legibility
    for y in range(H - 330, H):
        a = int(150 * (y - (H - 330)) / 330); d.line([(0, y), (W, y)], fill=(10, 11, 12, a))
    x, y = 96, H - 210
    if kicker:
        f = font('Medium', 26); d.text((x, y - 50), kicker, font=f, fill=TAPE)
    d.rectangle([x, y + 8, x + 8, y + 74], fill=TAPE)
    d.text((x + 28, y), title, font=font('Bold', 64), fill=(246, 247, 243))
    if sub: d.text((x + 28, y + 92), sub, font=font('Regular', 30), fill=(220, 222, 216))
    p = os.path.join(TMP, name + '.png'); im.save(p); return p

def card_png(name, lines, bg=(18, 19, 20)):
    im = Image.new('RGB', (W, H), bg); d = ImageDraw.Draw(im)
    y = H // 2 - sum(s for _, s, _ in lines) // 2 - 40
    for text, size, color in lines:
        f = font('Bold' if size > 50 else 'Regular', size)
        w = d.textlength(text, font=f); d.text(((W - w) / 2, y), text, font=f, fill=color); y += int(size * 1.6)
    p = os.path.join(TMP, name + '.png'); im.save(p); return p

def seg(i, src, dur, cap=None, kind='image', pan=1):
    out = os.path.join(TMP, f'seg{i:02d}.mp4')
    if kind == 'still':
        vf = f"scale={W}:{H},fps={FPS},format=yuv420p"; inp = ['-loop', '1', '-t', str(dur), '-i', src]
    elif kind == 'image':
        # slow Ken Burns: scale up 8 %, drift horizontally
        vf = (f"scale={int(W*1.08)}:{int(H*1.08)}:force_original_aspect_ratio=increase,crop={int(W*1.08)}:{int(H*1.08)},"
              f"crop={W}:{H}:x='(iw-{W})*({'t' if pan > 0 else f'{dur}-t'})/{dur}':y='(ih-{H})/2',fps={FPS},format=yuv420p")
        inp = ['-loop', '1', '-t', str(dur), '-i', src]
    else:
        vf = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p"
        inp = ['-t', str(dur), '-i', src]
    if cap:
        fc = f"[0:v]{vf}[b];[1:v]format=rgba,fade=in:st=0.35:d=0.5:alpha=1[c];[b][c]overlay=0:0,format=yuv420p[v]"
        cmd = ['ffmpeg', '-loglevel', 'error', '-y', *inp, '-loop', '1', '-t', str(dur), '-i', cap, '-filter_complex', fc, '-map', '[v]']
    else:
        cmd = ['ffmpeg', '-loglevel', 'error', '-y', *inp, '-vf', vf]
    subprocess.run([*cmd, '-t', str(dur), '-r', str(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', out], check=True)
    return out, dur

R = lambda n: os.path.join(ROOT, 'assets/ai/render', n + '.jpg')
V = lambda n: os.path.join(ROOT, 'assets/ai/video', n + '.mp4')
prices = json.load(open(os.path.join(SCREENS, 'prices.json')))
names = {'original': '原始提案', 'cream': '奶油風', 'wabi': '侘寂風', 'luxe': '現代輕奢', 'japandi': '日式無印', 'industrial': '工業風'}
fmt = lambda n: f"NT$ {n:,}"

plan = [
    (card_png('open', [('一張平面圖，', 72, (246, 247, 243)), ('變成看得見、算得出價格的家。', 72, (246, 247, 243)), ('PrimeStride Spatial Lab', 30, TAPE)]), 3.2, None, 'image'),
    (os.path.join(SCREENS, 'plan.png'), 3.6, caption_png('c_plan', '從實際尺寸的平面圖開始', 'Every wall, door and window measured — areas in m² and 坪', '01 · PLAN'), 'image'),
    (V('living-3d-to-real'), 5.9, caption_png('c_3d', '即時 3D → AI 效果圖', 'Geometry-locked: walls, openings and furniture stay where the plan put them', '02 · 3D → REAL'), 'video'),
]
for k in ['original', 'cream', 'wabi', 'luxe', 'japandi', 'industrial']:
    sfx = '' if k == 'original' else '-' + k
    if os.path.exists(R('living' + sfx)):
        plan.append((R('living' + sfx), 2.3, caption_png('c_' + k, f"{names[k]}　{fmt(prices[k])}", '同一個空間・六種風格・報價即時更新（未稅）', '03 · STYLES'), 'image'))
def grid_png():
    keys = ['original', 'cream', 'wabi', 'luxe', 'japandi', 'industrial']
    if not all(os.path.exists(R('master' + ('' if k == 'original' else '-' + k))) for k in keys): return None
    g, cw, ch, pad = Image.new('RGB', (W, H), (18, 19, 20)), 560, 313, 22
    x0, y0 = (W - 3 * cw - 2 * pad) // 2, 70
    d = ImageDraw.Draw(g)
    for i, k in enumerate(keys):
        im = Image.open(R('master' + ('' if k == 'original' else '-' + k))).convert('RGB').resize((cw, ch), Image.LANCZOS)
        x, y = x0 + (i % 3) * (cw + pad), y0 + (i // 3) * (ch + pad); g.paste(im, (x, y))
        f = font('Bold', 28); d.rectangle([x, y + ch - 50, x + 10 + d.textlength(names[k], font=f) + 14, y + ch], fill=(18, 19, 20)); d.text((x + 12, y + ch - 46), names[k], font=f, fill=TAPE)
    p = os.path.join(TMP, 'grid.png'); g.save(p); return p
gp = grid_png()
if gp: plan.append((gp, 3.4, caption_png('c_grid', '主臥・六種風格', '同一張床、同一個衣櫃位置 — 只換材質與氛圍', '03 · STYLES'), 'still'))
for n, t, s in [('master', '主臥', 'Master bedroom'), ('dining', '餐廳', 'Dining'), ('kitchen', '廚房', 'Kitchen')]:
    if os.path.exists(R(n)): plan.append((R(n), 2.6, caption_png('c_' + n, t, s, '04 · ROOMS'), 'image'))
if os.path.exists(V('balcony-golden')): plan.append((V('balcony-golden'), 5.0, caption_png('c_bal', '前陽台・黃昏', '9F city view', '05 · LIGHT'), 'video'))
if os.path.exists(V('living-dusk-push')): plan.append((V('living-dusk-push'), 5.5, caption_png('c_dusk', '夜晚的客廳', 'Same room, blue hour', '05 · LIGHT'), 'video'))
plan.append((os.path.join(SCREENS, 'approved.png'), 4.0, caption_png('c_pp', '提案 → 核准 → 報價', '方案 A / B 比較、一鍵核准、送至 StrideBrain', '06 · PROPOSAL'), 'image'))
plan.append((card_png('end', [('PrimeStride Spatial Lab', 76, (246, 247, 243)), ('從平面圖，到可以簽約的提案。', 40, (220, 222, 216)), ('spatial-lab-iota.vercel.app', 30, TAPE)]), 3.5, None, 'image'))

segs = [seg(i, src, dur, cap, kind, pan=(1 if i % 2 else -1)) for i, (src, dur, cap, kind) in enumerate(plan)]
# chain cross-fades
inputs, fc, prev, t = [], [], '0:v', 0.0
for i, (p, d) in enumerate(segs): inputs += ['-i', p]
t = segs[0][1]
for i in range(1, len(segs)):
    off = t - XF; lab = f'x{i}'
    fc.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[{lab}]")
    prev = lab; t = off + segs[i][1]
fc.append(f"[{prev}]fade=in:st=0:d=0.6,fade=out:st={t-0.8:.3f}:d=0.8,format=yuv420p[v]")
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(fc), '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', OUT], check=True)
print(f'{OUT}: {t:.1f}s, {len(segs)} segments')
