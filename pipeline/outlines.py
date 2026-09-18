"""Real rain-area outlines for IMERG LPT MJO systems, from the per-system mask files.

The mask files (one per system, 50–350 MB, global 0.1°, hourly) live on the LPT server.
Only the 6-hourly mask slices are read, over HTTP range requests, and each slice is
reduced to its outline (the 0.5 contour of the 0/1 mask), simplified, and written to
site/data/outlines/imerg/<id>.json:

    {"id", "t0", "h": [hours since t0, ...], "rings": [[[lon, lat, lon, lat, ...], ...], ...]}

Resumable: systems with an existing file are skipped. Newest systems go first.

    python pipeline/outlines.py [--workers 4] [--limit N] [--ids ID ...]
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import contourpy
import fsspec
import h5py
import numpy as np
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "data" / "outlines" / "imerg"
STEP_H = 6          # outline every 6 hours
SIMPLIFY_DEG = 0.1  # Douglas–Peucker tolerance
MIN_POINTS = 6      # drop specks

# The LPT server's TLS chain is incomplete (curl needs -k too); these are public files.
fs = fsspec.filesystem("https", ssl=False, block_size=2**20)


def rings_of(mask, lat, lon):
    """Outline rings of mask > 0 as flat [lon, lat, ...] lists."""
    m = mask > 0
    if not m.any():
        return []
    ys, xs = np.nonzero(m)
    j0, j1 = max(ys.min() - 1, 0), min(ys.max() + 2, m.shape[0])
    i0, i1 = max(xs.min() - 1, 0), min(xs.max() + 2, m.shape[1])
    sub = np.zeros((j1 - j0 + 2, i1 - i0 + 2))
    sub[1:-1, 1:-1] = m[j0:j1, i0:i1]
    lines = contourpy.contour_generator(z=sub).lines(0.5)
    dlat, dlon = float(lat[1] - lat[0]), float(lon[1] - lon[0])
    out = []
    for ln in lines:
        x = lon[i0] + (ln[:, 0] - 1) * dlon
        y = lat[j0] + (ln[:, 1] - 1) * dlat
        if len(x) < MIN_POINTS:
            continue
        s = LineString(np.column_stack([x, y])).simplify(SIMPLIFY_DEG)
        c = np.round(np.asarray(s.coords), 2)
        if len(c) >= 4:
            out.append(c.ravel().tolist())
    return out


def extract(sysd):
    t_start = time.time()
    with fs.open(sysd["mask_url"], "rb", cache_type="none") as f, h5py.File(f, "r") as h:
        # time is "<unit> since <date>" (hours in these files)
        unit, _, since = h["time"].attrs["units"].decode().partition(" since ")
        step = {"hours": np.timedelta64(1, "h"), "days": np.timedelta64(1, "D"), "minutes": np.timedelta64(1, "m")}[unit]
        times = np.datetime64(since.strip()[:19].replace(" ", "T"), "m") + h["time"][:].astype("int64") * step
        lat, lon = h["lat"][:], h["lon"][:]
        hour = times.astype("datetime64[h]")
        on_grid = (times == hour) & (hour.astype("int64") % STEP_H == 0)
        idx = sorted(set(np.flatnonzero(on_grid).tolist()) | {0, len(times) - 1})
        t0 = times[idx[0]]
        rec = {"id": sysd["id"], "t0": str(t0.astype("datetime64[m]")) + "Z", "h": [], "rings": []}
        for i in idx:
            rec["h"].append(int((times[i] - t0) / np.timedelta64(1, "h")))
            rec["rings"].append(rings_of(h["mask"][i], lat, lon))
    path = OUT / f"{sysd['id']}.json"
    path.write_text(json.dumps(rec, separators=(",", ":")))
    return sysd["id"], len(idx), path.stat().st_size, time.time() - t_start


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--ids", nargs="*")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    systems = json.loads((ROOT / "site" / "data" / "lpt_mjo_imerg.json").read_text())
    todo = [s for s in reversed(systems) if not (OUT / f"{s['id']}.json").exists()]
    if args.ids:
        todo = [s for s in todo if s["id"] in args.ids]
    todo = todo[:args.limit]
    print(f"{len(todo)} systems to do ({len(systems) - len(todo)} done or skipped)", flush=True)
    done = 0
    with ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(extract, s): s for s in todo}
        for fut in as_completed(futs):
            done += 1
            try:
                sid, n, size, dt = fut.result()
                print(f"[{done}/{len(todo)}] {sid}: {n} outlines, {size / 1024:.0f} KB, {dt:.0f} s", flush=True)
            except Exception as err:
                print(f"[{done}/{len(todo)}] {futs[fut]['id']}: FAILED {err!r}", file=sys.stderr, flush=True)
    index = sorted(p.stem for p in OUT.glob("*.json") if p.stem != "index")
    (OUT / "index.json").write_text(json.dumps(index))
    print(f"index: {len(index)} systems with outlines")


if __name__ == "__main__":
    main()
