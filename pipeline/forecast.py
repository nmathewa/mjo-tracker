"""Experimental track forecast for one MJO LPT event with the trained rain-track corrector (ONNX).

For each start date: fetch the GEFS v12 reforecast (5 members, byte ranges, cached), follow the
forecast rain from the system's position, correct that track with the model, and summarise
50 sampled tracks into a cone. Writes site/data/forecast/<event>.json. Mirrors mjopredict exactly.

    python pipeline/forecast.py --model models/        # needs corrector.onnx, norm.npz, meta.json
"""
import argparse
import json
import os
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import eccodes
import numpy as np
import onnxruntime as ort
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
EVENT = "LPT-I-2010-70.2000"
START, END, EVERY = "2011-12-19", "2012-02-17", 4      # forecast starts (00 UTC), each with ≥ 2 days of track
MEMBERS = ["c00", "p01", "p02", "p03", "p04"]
H, T, DAYS, SAMPLES = 20, 60, 16, 10
REFORECAST = "https://noaa-gefs-retrospective.s3.amazonaws.com/GEFSv12/reforecast"
GEFS_VARS = [("olr", ["ulwrf_tatm"], "ULWRF", "top of atmosphere"), ("precip", ["apcp_sfc"], "APCP", "surface"),
             ("pwat", ["pwat_eatm"], "PWAT", None), ("q700", ["spfh_pres", "spfh_pres_abv700mb"], "SPFH", "700 mb"),
             ("w500", ["vvel_pres", "vvel_pres_abv700mb"], "VVEL", "500 mb"),
             ("u850", ["ugrd_pres", "ugrd_pres_abv700mb"], "UGRD", "850 mb"),
             ("u200", ["ugrd_pres", "ugrd_pres_abv700mb"], "UGRD", "200 mb")]
LAT = np.arange(22.5, -25, -5.0)
LON = np.arange(2.5, 360, 5.0)
CACHE = Path(os.environ.get("GEFS_CACHE", ROOT / "data" / "gefs"))
http = requests.Session()


# ---------------------------------------------------------------- GEFS 5° fields
def records(url, var, level):
    r = http.get(url + ".idx", timeout=60)
    if not r.ok:
        return []
    lines = r.text.strip().splitlines()
    offs = [int(ln.split(":")[1]) for ln in lines] + [None]
    out = []
    for ln, a, b in zip(lines, offs, offs[1:]):
        _, _, _, v, lev, when, _ = ln.split(":")[:7]
        if v != var or (level and lev != level):
            continue
        h = when.split()[0]
        if "-" in h:
            h0, h1 = map(int, h.split("-"))
            if h1 - h0 != 6:
                continue
        else:
            h1 = int(h)
            if h1 % 24:
                continue
        if h1 % 6 == 0 and 0 < h1 <= 24 * DAYS:
            out.append((h1, a, b))
    return out


def box(url, a, b):
    rng = f"bytes={a}-{'' if b is None else b - 1}"
    msg = eccodes.codes_new_from_message(http.get(url, headers={"Range": rng}, timeout=120).content)
    ni, nj = eccodes.codes_get(msg, "Ni"), eccodes.codes_get(msg, "Nj")
    v = eccodes.codes_get_values(msg).reshape(nj, ni)
    eccodes.codes_release(msg)
    res = 180 / (nj - 1)
    k, i0 = round(5 / res), round(65 / res)
    return v[i0:i0 + len(LAT) * k].reshape(len(LAT), k, len(LON), k).mean((1, 3))


def gefs(init, member):
    path = CACHE / member / f"{init:%Y%m%d}.npy"
    if path.exists():
        return np.load(path)
    jobs, seen = [], set()
    for vi, (_, files, var, level) in enumerate(GEFS_VARS):
        for days in ["1-10", "10-16", "10-35"]:
            for short in files:
                url = f"{REFORECAST}/{init:%Y}/{init:%Y%m%d%H}/{member}/Days:{days}/{short}_{init:%Y%m%d%H}_{member}.grib2"
                for h, a, b in records(url, var, level):
                    if (vi, h) not in seen:
                        seen.add((vi, h))
                        jobs.append((vi, h, url, a, b))
    with ThreadPoolExecutor(16) as ex:
        boxes = list(ex.map(lambda j: box(*j[2:]), jobs))
    out = np.zeros((DAYS, len(GEFS_VARS), len(LAT), len(LON)), np.float32)
    n = np.zeros((DAYS, len(GEFS_VARS)))
    for (vi, h, *_), bx in zip(jobs, boxes):
        out[(h - 1) // 24, vi] += bx
        n[(h - 1) // 24, vi] += 1
    if (n == 0).any():
        raise ValueError(f"{init:%Y-%m-%d} {member}: incomplete GEFS forecast")
    out /= n[..., None, None]
    out[:, 1] *= 4                                          # precipitation: mm per 6 h -> mm per day
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, out)
    return out


# ---------------------------------------------------------------- the physics prior
def follow_rain(f, lon0, lat0, thresh=12.0, dlon=30, dlat=15):
    p = f[:, 1]
    p3 = np.stack([p[max(0, d - 2):d + 1].mean(0) for d in range(DAYS)])
    lon, lat, alive = lon0, lat0, True
    daily = [(0.0, 0.0)]
    for d in range(DAYS):
        if alive:
            dx = (LON[None, :] - lon % 360 + 180) % 360 - 180
            dy = LAT[:, None] - lat
            w = np.where((np.abs(dx) <= dlon) & (np.abs(dy) <= dlat), np.maximum(p3[d] - thresh, 0), 0)
            if w.sum() > 0:
                lon += (w * dx).sum() / w.sum()
                lat += (w * dy).sum() / w.sum()
            else:
                alive = False
        daily.append((lon - lon0, lat - lat0))
    daily = np.array(daily)
    h = np.arange(1, T + 1) / 4
    return np.column_stack([np.interp(h, np.arange(DAYS + 1), daily[:, 0]),
                            np.interp(h, np.arange(DAYS + 1), daily[:, 1])]).astype(np.float32)


# ---------------------------------------------------------------- track + context features
def load_track(event):
    s = next(x for x in json.loads((ROOT / "site/data/lpt_mjo_imerg.json").read_text()) if x["id"] == event)
    p = np.array(s["track"]["p"], float)
    p = p[p[:, 0] % 6 == 0]
    t = pd.Timestamp(s["track"]["t0"]).tz_localize(None) + pd.to_timedelta(p[:, 0], "h")
    return t, p[:, 1], np.degrees(np.unwrap(np.radians(p[:, 2]))), np.log(np.maximum(p[:, 3], 1))


def read_psl(url):
    path = ROOT / "data/raw/indices" / url.split("/")[-1]
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60, context=ssl.create_default_context()) as r:
            path.write_bytes(r.read())
    lines = path.read_text().splitlines()
    y0, y1 = map(int, lines[0].split()[:2])
    rows = [[int(r[0])] + [float(v) for v in r[1:]] for r in (ln.split() for ln in lines[1:])
            if len(r) == 13 and r[0].isdigit() and y0 <= int(r[0]) <= y1]
    s = pd.DataFrame(rows).set_index(0).stack()
    s.index = pd.to_datetime([f"{y}-{m:02d}-01" for y, m in s.index])
    return s.where(s > -99).dropna()


def context(t0):
    r = pd.read_csv(ROOT / "data/raw/rmm.74toRealtime.txt", skiprows=2, sep=r"\s+", header=None,
                    usecols=range(5), names=["year", "month", "day", "rmm1", "rmm2"])
    r.index = pd.to_datetime(r[["year", "month", "day"]])
    r = r[["rmm1", "rmm2"]].mask(r[["rmm1", "rmm2"]].abs() > 100).loc["1979":].asfreq("D").interpolate(limit=3)
    k = (t0.normalize() - r.index[0]).days - 1
    r1, r2 = r.rmm1.fillna(0).to_numpy()[k - 9:k + 1], r.rmm2.fillna(0).to_numpy()[k - 9:k + 1]
    ang = np.arctan2(r2, r1)
    m = t0.to_period("M").to_timestamp()
    nino = read_psl("https://psl.noaa.gov/data/correlation/nina34.anom.data").asof(m)
    qbo = read_psl("https://psl.noaa.gov/data/correlation/qbo.data").asof(m)
    doy = 2 * np.pi * t0.dayofyear / 365.25
    return np.array([r1[-1], r2[-1], np.hypot(r1[-1], r2[-1]), np.cos(ang[-1]), np.sin(ang[-1]),
                     np.diff(np.unwrap(ang)).mean(), np.sin(doy), np.cos(doy),
                     np.nan_to_num(nino), np.nan_to_num(qbo) / 10], np.float32)


def history(lon, lat, la, i):
    j = max(0, i - H + 1)
    h = np.zeros((H, 6), np.float32)
    h[H - (i - j + 1):] = np.column_stack([lon[j:i + 1] - lon[i], lat[j:i + 1] - lat[i], la[j:i + 1], lat[j:i + 1],
                                          np.sin(np.radians(lon[j:i + 1])), np.cos(np.radians(lon[j:i + 1]))])
    return h


# ---------------------------------------------------------------- model
def windows(f, rain, lon0, norm, west, east):
    f = np.roll(f, len(LON) // 2 - int((lon0 % 360) // 5), axis=-1)
    f = (f - norm["fmean"]) / norm["fstd"]
    start = np.concatenate([[0.0], rain[3::4, 0]])
    c = f.shape[-1] // 2
    return np.stack([f[d][..., (c + int(round(start[d] / 5)) + np.arange(-west, east)) % f.shape[-1]]
                     for d in range(DAYS)]).astype(np.float32)


def summarise(tracks, alive, rain, lon0, lat0, obs):
    """Cone: median track, distance radii holding 50/90 % of tracks, longitude quantiles, P(alive)."""
    med = np.median(tracks, 0)
    coslat = np.cos(np.radians(lat0 + med[:, 1]))
    dist = 111.2 * np.hypot((tracks[..., 0] - med[:, 0]) * coslat, tracks[..., 1] - med[:, 1])
    q = np.quantile(tracks[..., 0], [0.1, 0.25, 0.5, 0.75, 0.9], axis=0)
    reach = ((lon0 % 360) + tracks[..., 0] >= 150).any(1) & (lon0 % 360 < 150)
    r = lambda a, n=2: np.round(a, n).tolist()
    return {"median": r(med), "r50_km": r(np.quantile(dist, 0.5, 0), 0), "r90_km": r(np.quantile(dist, 0.9, 0), 0),
            "lon_q": r(q), "rain": r(rain.mean(0)), "p_alive": r(alive.mean(0)),
            "p_reach_150E": round(float(reach.mean()), 2) if lon0 % 360 < 150 else None, "observed": r(obs)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "models"))
    args = ap.parse_args()
    mdir = Path(args.model)
    meta = json.loads((mdir / "meta.json").read_text())
    norm = dict(np.load(mdir / "norm.npz"))
    sess = ort.InferenceSession(str(mdir / "corrector.onnx"))
    t, lat, lon, la = load_track(EVENT)
    rng = np.random.default_rng(0)
    out = []
    for t0 in pd.date_range(START, END, freq=f"{EVERY}D"):
        i = int(np.flatnonzero(t == t0)[0])
        assert i >= 7, "needs 2 days of track history, as in training"
        fields = [f for f in (gefs_or_none(t0, m) for m in MEMBERS) if f is not None]
        rains = np.stack([follow_rain(f, lon[i], lat[i]) for f in fields])
        feed = {"win": np.stack([windows(f, r, lon[i], norm, meta["west_cols"], meta["east_cols"])
                                 for f, r in zip(fields, rains)]),
                "rain": rains,
                "hist": np.repeat(((history(lon, lat, la, i) - norm["hmean"]) / norm["hstd"])[None], len(fields), 0).astype(np.float32),
                "ctx": np.repeat(((context(t0) - norm["cmean"]) / norm["cstd"])[None], len(fields), 0).astype(np.float32)}
        mu, sd, end = sess.run(None, feed)
        eps = rng.standard_normal((len(fields), SAMPLES, 1, 2))
        tracks = rains[:, None] + 10 * (mu[:, None] + sd[:, None] * eps)
        live = np.cumprod(rng.random((len(fields), SAMPLES, T)) > 1 / (1 + np.exp(-end[:, None])), 2)
        last = np.maximum.accumulate(np.where(live > 0, np.arange(T), 0), 2)
        tracks = np.take_along_axis(tracks, last[..., None].repeat(2, -1), 2).reshape(-1, T, 2)
        obs = np.column_stack([lon[i + 1:i + 1 + T] - lon[i], lat[i + 1:i + 1 + T] - lat[i]])
        out.append({"t0": f"{t0:%Y-%m-%dT%H:%MZ}", "lon0": round(float(lon[i] % 360), 2), "lat0": round(float(lat[i]), 2),
                    "members": len(fields), **summarise(tracks, live.reshape(-1, T), rains, lon[i], lat[i], obs)})
        print(f"{t0:%Y-%m-%d}: {len(fields)} members, median 5-day move {out[-1]['median'][19][0]:+.1f}°", flush=True)
    dest = ROOT / "site/data/forecast"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{EVENT}.json").write_text(json.dumps({"event": EVENT, "model": meta, "step_hours": 6, "starts": out},
                                                   separators=(",", ":")))
    print(f"wrote {len(out)} forecasts for {EVENT}")


def gefs_or_none(t0, member):
    try:
        return gefs(t0, member)
    except Exception as err:
        print(f"  {t0:%Y-%m-%d} {member}: skipped ({err})")
        return None


if __name__ == "__main__":
    main()
