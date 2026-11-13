"""art/pant.webp(가로 4 × 세로 2, 앉아서 헥헥거리는 8장면)를 잘라 "sit" 동작을 여러 장면 재생으로 바꾼다.
사용법: python3 tools/cut_pant.py   (cut_sprites.py를 실행하면 이어서 자동 실행된다)"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from cut_gif import ROOT, dog_mask, box

FILE, COLS, ROWS = "pant.webp", 4, 2
MS = 150  # 장면당 시간(ms)
SKIP = [(2, 2)]  # 쓰지 않을 장면 (행, 열). 1부터 센다
HEIGHT = 290  # 다른 앉은 그림과 키를 맞추는 기준(원본 시트 픽셀)
FUR = (249, 199, 125)  # 다른 그림들의 밝은 털 색. 여기에 색을 맞춘다


def fur_color(rgb, m):
    px = rgb[m].astype(float)
    lum = px.sum(1)
    return np.median(px[lum > np.median(lum)], axis=0)


def main():
    src = os.path.join(ROOT, "art", FILE)
    if not os.path.exists(src):
        return
    sheet = Image.open(src).convert("RGBA")
    cw, ch = sheet.width // COLS, sheet.height // ROWS
    cells, masks, anchors = [], [], []
    for r in range(ROWS):
        for c in range(COLS):
            if (r + 1, c + 1) in SKIP:
                continue
            cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            m = dog_mask(cell, shadow=True)  # 가장 큰 덩어리만 남기므로 움직임 표시선·하트는 빠진다
            l, t, rr, b = box(m)
            # 장면마다 그림 위치가 조금씩 달라서 발(아래쪽 6%)의 가운데와 바닥을 기준으로 맞춘다
            xs = np.where(m[int(b - (b - t) * 0.06):b].any(axis=0))[0]
            anchors.append(((xs.min() + xs.max()) / 2, b))
            cells.append(cell)
            masks.append(m)

    tint = np.array(FUR) / np.mean([fur_color(np.asarray(c)[:, :, :3], m) for c, m in zip(cells, masks)], axis=0)
    # 모든 장면을 발 기준으로 같은 자리에 놓았을 때의 전체 범위
    rel = [(bx[0] - ax, bx[1] - ay, bx[2] - ax, bx[3] - ay) for bx, (ax, ay) in zip(map(box, masks), anchors)]
    L, T = int(np.floor(min(r[0] for r in rel))) - 3, int(min(r[1] for r in rel)) - 3
    R, B = int(np.ceil(max(r[2] for r in rel))) + 3, 3
    names = []
    for i, (cell, m, (ax, ay)) in enumerate(zip(cells, masks, anchors), start=1):
        ox, oy = int(round(ax)) + L, int(ay) + T
        win = (ox, oy, ox + (R - L), oy + (B - T))
        alpha = Image.fromarray((m * 255).astype("uint8")).crop(win)
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
        rgb = np.asarray(cell.convert("RGB").crop(win)) * tint
        out = Image.fromarray(rgb.round().clip(0, 255).astype("uint8")).convert("RGBA")
        out.putalpha(alpha)
        out.save(os.path.join(ROOT, "sprites", f"sit{i}.png"))
        names.append(f"sit{i}.png")

    path = os.path.join(ROOT, "sprites", "sprites.json")
    manifest = json.load(open(path))
    stand_h = float(np.mean([bx[3] - bx[1] for bx in map(box, masks)]))
    manifest["sit"] = {
        "frames": names, "ms": MS, "k": round(HEIGHT / stand_h, 3),
        "w": R - L, "h": B - T, "cx": -L, "foot": B,
    }
    # 그림을 따로 받지 않은 동작은 있는 장면을 골라 만든다
    # 쓰다듬기: 앉아서 눈을 감은 장면(3번)을 길게
    manifest["pet"] = {**manifest["sit"], "frames": ["sit2.png", "sit3.png", "sit3.png", "sit3.png"], "ms": 250}
    if manifest.get("happy", {}).get("frames"):
        # 높이 뛰기(따라오기 중): 공중에 뜬 장면 둘을 번갈아
        manifest["leap"] = {**manifest["happy"], "frames": ["happy4.png", "happy5.png"], "ms": 180}
    print("sit", json.dumps(manifest["sit"]), "anchors", [(round(a), int(b)) for a, b in anchors])
    json.dump(manifest, open(path, "w"), indent=2)


if __name__ == "__main__":
    main()
