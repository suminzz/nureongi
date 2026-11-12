"""art 폴더의 GIF에서 장면을 뽑아 투명 PNG로 저장하고, sprites.json의 해당 동작을 여러 장면 재생으로 바꾼다.
사용법: python3 tools/cut_gif.py   (cut_sprites.py를 실행하면 이어서 자동 실행된다)"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 동작 이름: (GIF 파일, 설정)
#   loop: 반복할 장면 번호(없으면 전부)   ms: 장면당 시간   size: 크기 보정
#   shadow: 그림에 그려진 바닥 그림자 지우기   tint: 색 보정(R,G,B 배율)
#   parts: 강아지와 떨어져 있어도 남길 덩어리의 최소 크기(가장 큰 덩어리 대비 비율). 없으면 가장 큰 덩어리만
JOBS = {
    "run": ("run.gif", dict(loop=[1, 2, 3, 4], ms=115, size=1.18)),  # 0번은 서 있는 장면이라 뺀다
    # GIF가 다른 그림보다 작고 밝아서 크기와 색을 맞춘다
    "wag": ("wag.gif", dict(ms=130, size=1.08, shadow=True, tint=(0.984, 0.957, 0.947))),
    "happy": ("jump.gif", dict(ms=140, size=1.08, shadow=True, tint=(0.984, 0.971, 0.933))),  # 신나서 폴짝 뛰기
    "eat": ("eat.gif", dict(ms=180, size=1.12, shadow=True, tint=(0.988, 0.980, 0.962), parts=0.08)),  # 밥그릇도 남긴다
}


def dog_mask(rgba, shadow=False, parts=None):
    """투명한 곳과 거기에 이어진 옅은 배경(흰 바탕·체크무늬)을 지우고 가장 큰 덩어리(강아지)만 남긴다."""
    a = np.asarray(rgba).astype(int)
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    clear = alpha < 128
    empty = clear | ((mn > 185) & (mx - mn < 48))
    if shadow:  # 옅은 베이지색 바닥 그림자도 배경으로 본다 (털은 훨씬 진한 노랑이라 남는다)
        empty |= (mn > 160) & (mx - mn < 72)
    lab, _ = ndi.label(empty)
    seeds = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1], lab[clear]]))
    fg = ~np.isin(lab, seeds[seeds > 0])
    comp, n = ndi.label(fg, structure=np.ones((3, 3)))
    sizes = ndi.sum(fg, comp, range(1, n + 1))
    if parts:
        # 가는 그림자 자국으로 이어진 부스러기를 떼어 내려고, 조금 깎은 뒤에 큰 덩어리만 골라 되살린다
        core, k = ndi.label(ndi.binary_erosion(fg, iterations=3))
        csize = ndi.sum(core > 0, core, range(1, k + 1))
        big = np.isin(core, np.where(csize >= parts * csize.max())[0] + 1)
        return fg & ndi.binary_dilation(big, iterations=4)
    return comp == (int(np.argmax(sizes)) + 1)


def box(m):
    ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def reference_height():
    """시트에서 잘라 낸 서 있는 그림(wag.png)의 강아지 키. 크기를 맞추는 기준."""
    alpha = np.asarray(Image.open(os.path.join(ROOT, "sprites", "wag.png")))[:, :, 3] > 128
    comp, n = ndi.label(alpha)
    big = ndi.find_objects(comp)[int(np.argmax(ndi.sum(alpha, comp, range(1, n + 1))))]
    return big[0].stop - big[0].start


def cut(name, file, ref_h, loop=None, ms=120, size=1.0, shadow=False, tint=None, parts=None):
    gif = Image.open(os.path.join(ROOT, "art", file))
    frames = []
    for i in range(gif.n_frames):
        gif.seek(i)
        frames.append(gif.convert("RGBA"))
    loop = loop or list(range(len(frames)))
    masks = {i: dog_mask(frames[i], shadow, parts) for i in set(loop) | {0}}

    stand = box(masks[0])  # 첫 장면(서 있는 모습): 크기와 바닥 높이의 기준
    ground = stand[3]
    boxes = [box(masks[i]) for i in loop]
    l = min(b[0] for b in boxes) - 3
    t = min(b[1] for b in boxes) - 3
    r = max(b[2] for b in boxes) + 3
    b = max(max(b[3] for b in boxes), ground) + 3
    names = []
    for k, i in enumerate(loop, start=1):
        m = Image.fromarray((masks[i][t:b, l:r] * 255).astype("uint8"))
        m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
        out = frames[i].crop((l, t, r, b)).convert("RGB")
        if tint:
            out = Image.fromarray((np.asarray(out) * np.array(tint)).round().clip(0, 255).astype("uint8"))
        out = out.convert("RGBA")
        out.putalpha(m)
        out.save(os.path.join(ROOT, "sprites", f"{name}{k}.png"))
        names.append(f"{name}{k}.png")
    return {
        "frames": names, "ms": ms,
        "k": round(float(size * ref_h / (stand[3] - stand[1])), 3),
        "w": int(r - l), "h": int(b - t),
        "cx": round(float(np.mean([(bx[0] + bx[2]) / 2 for bx in boxes]) - l), 1),
        "foot": int(b - ground),
    }


def main():
    path = os.path.join(ROOT, "sprites", "sprites.json")
    manifest = json.load(open(path))
    ref_h = reference_height()
    for name, (file, opts) in JOBS.items():
        if os.path.exists(os.path.join(ROOT, "art", file)):
            manifest[name] = cut(name, file, ref_h, **opts)
            print(name, json.dumps(manifest[name]))
    json.dump(manifest, open(path, "w"), indent=2)


if __name__ == "__main__":
    main()
