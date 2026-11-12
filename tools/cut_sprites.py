"""동작 시트(art/sheet.webp, 3x3)를 잘라 배경이 투명한 PNG 9장과 sprites.json을 만든다.
사용법: python3 tools/cut_sprites.py   (Pillow, numpy, scipy 필요)"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAMES = [["wag", "run", "surprise"], ["happy", "eat", "coffee"], ["study", "sit", "sleep"]]

im = Image.open(os.path.join(ROOT, "art", "sheet.webp")).convert("RGB")
a = np.asarray(im).astype(int)
H, W, _ = a.shape
mn, mx = a.min(axis=2), a.max(axis=2)

# 배경: 밝고 색이 옅은 픽셀 중 그림 가장자리와 이어진 것 (흰 바탕, 옅은 그림자, 이름표 바탕)
pale = (mn > 185) & (mx - mn < 48)
lab, _ = ndi.label(pale)
edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = np.isin(lab, edge[edge > 0])
fg = ~bg

comp, n = ndi.label(fg, structure=np.ones((3, 3)))
boxes = ndi.find_objects(comp)
sizes = ndi.sum(fg, comp, range(1, n + 1))
vivid = ndi.mean(mx - mn, comp, range(1, n + 1))  # 조각별 색의 진하기
ch, cw = H / 3, W / 3
manifest = {}

for r in range(3):
    for c in range(3):
        x0, y0 = c * cw, r * ch
        mine = []
        for i, sl in enumerate(boxes, start=1):
            cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
            if x0 <= cx < x0 + cw and y0 <= cy < y0 + ch and sizes[i - 1] >= 25:
                mine.append((sizes[i - 1], i, cx - x0, cy - y0))
        mine.sort(reverse=True)
        dog = mine[0][1]
        # 왼쪽 위 이름표(글자)는 버린다
        # 색이 옅은 조각(그림자·먼지 자국)도 버린다
        keep = [dog] + [i for _, i, cx, cy in mine[1:]
                        if not (cy < 82 and cx < cw * 0.47) and vivid[i - 1] > 62]
        mask = np.isin(comp, keep)
        name = NAMES[r][c]
        if name == "eat":
            # 다리 사이에 갇힌 흰 바탕을 뚫는다 (그릇의 뼈다귀 무늬는 왼쪽이라 남는다)
            d = boxes[dog - 1]
            mid = (d[1].start + d[1].stop) / 2
            holes, hn = ndi.label(pale & mask)
            for j, sl in enumerate(ndi.find_objects(holes), start=1):
                if (sl[1].start + sl[1].stop) / 2 > mid and (holes[sl] == j).sum() > 80:
                    mask[holes == j] = False
        ys, xs = np.where(mask)
        t, b, l, rt = ys.min() - 3, ys.max() + 4, xs.min() - 3, xs.max() + 4
        m = Image.fromarray((mask[t:b, l:rt] * 255).astype("uint8"))
        m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))  # 흰 테두리 제거
        out = im.crop((l, t, rt, b)).convert("RGBA")
        out.putalpha(m)
        out.save(os.path.join(ROOT, "sprites", name + ".png"))
        d = boxes[dog - 1]
        manifest[name] = {
            "w": int(rt - l), "h": int(b - t),
            "cx": round((d[1].start + d[1].stop) / 2 - l, 1),  # 강아지 몸의 가로 중심
            "foot": int(b - d[0].stop),                        # 그림 아래 끝에서 발까지 거리
        }

json.dump(manifest, open(os.path.join(ROOT, "sprites", "sprites.json"), "w"), indent=2)
print(json.dumps(manifest))

import cut_gif  # 달리기 GIF가 있으면 "run"을 여러 장면으로 바꾼다
cut_gif.main()
import cut_pant  # 헥헥거리는 그림이 있으면 "sit"을 여러 장면으로 바꾼다
cut_pant.main()
