"""LPT (Large-scale Precipitation Tracking) sources for the site.

Each source is reduced to the same records:
    {id, lpt_index, begin, end, duration_days, eprop: [...], track: {t0, p}, [mask_url]}
MJO systems go to one file; the other (non-MJO) systems are split by year so the
page loads only the years it shows.

Sources (Kerns & Chen, https://orca.atmos.washington.edu/data/lpt/):
  imerg  IMERG V7, 1998–present, hourly; per-system mask files for real outlines
  tmpa   TRMM/TMPA 3B42 as in Kerns & Chen (2020), Jun 1998 – Jun 2018, 3-hourly
"""
import re
from pathlib import Path

import pandas as pd

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
LPT_URL = "https://orca.atmos.washington.edu/data/lpt"
IMERG_DIR = RAW / "imerg_v7"
IMERG_REMOTE = f"{LPT_URL}/imerg_v7/g50_72h/thresh12/systems"
MIN_OTHER_DAYS = 3  # shorter non-MJO systems are left out


def iso(t):
    return f"{t:%Y-%m-%dT%H:%MZ}"


def to_time(s):
    return pd.to_datetime(s.astype(str), format="%Y%m%d%H")


def read_tracks(path, key):
    """{key(lpt_index): DataFrame(time, area, lat, lon)} from an lpt_systems_*.txt file."""
    tracks, cur, rows = {}, None, []
    for line in path.read_text().splitlines()[2:]:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "LPT":
            if cur is not None:
                tracks[cur] = rows
            cur, rows = key(float(parts[1])), []
        else:
            rows.append((pd.to_datetime(parts[0], format="%Y%m%d%H"),
                         float(parts[1]), float(parts[2]), float(parts[3])))
    if cur is not None:
        tracks[cur] = rows
    return {k: pd.DataFrame(v, columns=["time", "area", "lat", "lon"]) for k, v in tracks.items()}


def compact_track(tr):
    """6-hourly centroid track as {t0, p: [[hours since t0, lat, lon, area 1e3 km2], ...]}."""
    six = tr[tr.time.dt.hour % 6 == 0]
    if len(six) < 2:
        six = tr
    t0 = six.time.iloc[0]
    return {"t0": iso(t0), "p": [
        [int((t - t0) / pd.Timedelta("1h")), round(la, 2), round(lo, 2), round(a / 1e3)]
        for t, a, la, lo in six.itertuples(index=False)]}


def eprop_rows(g, hours):
    """Eastward-propagation segments of one system (one list row each)."""
    unit = 1 / 24 if hours else 1
    return [{
        "begin": iso(e.eprop_begin), "end": iso(e.eprop_end),
        "lon_begin": round(float(e.eprop_lon_begin), 1), "lon_end": round(float(e.eprop_lon_end), 1),
        "speed_ms": round(float(e.eprop_spd), 2), "days": round(float(e.eprop_dur) * unit, 2),
    } for e in g.itertuples()]


def other_record(sid, lid, tr):
    days = (tr.time.iloc[-1] - tr.time.iloc[0]) / pd.Timedelta("1D")
    return {"id": sid, "lpt_index": lid, "begin": iso(tr.time.iloc[0]), "end": iso(tr.time.iloc[-1]),
            "duration_days": round(days, 2), "track": compact_track(tr)}


# ---------------------------------------------------------------- TMPA (Kerns & Chen 2020)
def load_tmpa():
    lpt = pd.read_csv(RAW / "mjo_lpt_list.txt", sep=r"\s+")
    for c in ["begin", "end", "eprop_begin", "eprop_end"]:
        lpt[c] = to_time(lpt[c])
    tracks = {}
    for path in sorted(RAW.glob("lpt_systems_tmpa_*.txt")):
        # files number systems per June–June season, so the season year is part of the key
        year = int(re.search(r"_(\d{4})\d{6}_", path.name).group(1))
        tracks.update(read_tracks(path, lambda x, y=year: (y, f"{x:.4f}")))

    mjo, keys = [], set()
    for (year, index), g in lpt.groupby(["begin_year", "lpt_index"], sort=False):
        r, lid = g.iloc[0], f"{index:.4f}"
        rec = {"id": f"LPT-{year}-{lid}", "lpt_index": lid, "begin": iso(r.begin), "end": iso(r.end),
               "duration_days": round(float(r.duration), 2), "eprop": eprop_rows(g, hours=False)}
        tr = tracks.get((year, lid))
        if tr is not None and tr.time.iloc[0] == r.begin:
            rec["track"] = compact_track(tr)
        mjo.append(rec)
        keys.add((year, lid))
    others = [other_record(f"LPT-{y}-{lid}", lid, tr) for (y, lid), tr in tracks.items()
              if (y, lid) not in keys and (tr.time.iloc[-1] - tr.time.iloc[0]).days >= MIN_OTHER_DAYS]
    return mjo, others


# ---------------------------------------------------------------- IMERG V7
def imerg_periods():
    return sorted(p.name.split("_list_imerg_v7_")[1][:-4] for p in IMERG_DIR.glob("mjo_lpt_list_imerg_v7_*.txt"))


def mask_url(period, lptid):
    whole, frac = f"{lptid:.4f}".split(".")
    return f"{IMERG_REMOTE}/{period}/lpt_system_mask_imerg_v7.lptid{int(whole):05d}.{frac}.nc"


def load_imerg():
    lists, tracks = [], {}
    for period in imerg_periods():
        d = pd.read_csv(IMERG_DIR / f"mjo_lpt_list_imerg_v7_{period}.txt", sep=r"\s+")
        d["period"] = period
        lists.append(d)
        tracks.update(read_tracks(IMERG_DIR / f"lpt_systems_imerg_v7_{period}.txt",
                                  lambda x, p=period: (p, f"{x:.4f}")))
    lpt = pd.concat(lists, ignore_index=True)
    for c in ["lpt_begin", "lpt_end", "eprop_begin", "eprop_end"]:
        lpt[c] = to_time(lpt[c])

    # Consecutive tracking periods overlap by a month, so a system can appear in both;
    # the earlier copy is cut off at the period end. Keep the longest copy per start time.
    first = lpt.drop_duplicates(["period", "lptid"])
    best = first.sort_values("duration", ascending=False).groupby("lpt_begin").head(1)
    same_period = first[first.duplicated("lpt_begin", keep=False)]
    same_period = same_period[same_period.groupby("lpt_begin").period.transform("nunique") == 1]
    keep = set(map(tuple, pd.concat([best, same_period])[["period", "lptid"]].to_numpy()))

    mjo, keys = [], set()
    for (period, lptid), g in lpt.groupby(["period", "lptid"], sort=False):
        if (period, lptid) not in keep:
            continue
        r, lid = g.iloc[0], f"{lptid:.4f}"
        rec = {"id": f"LPT-I-{period[:4]}-{lid}", "lpt_index": lid,
               "begin": iso(r.lpt_begin), "end": iso(r.lpt_end),
               "duration_days": round(float(r.duration) / 24, 2), "eprop": eprop_rows(g, hours=True),
               "mask_url": mask_url(period, lptid)}
        tr = tracks.get((period, lid))
        if tr is not None:
            rec["track"] = compact_track(tr)
        mjo.append(rec)
        keys.add((period, lid))
    mjo.sort(key=lambda s: s["begin"])

    # non-MJO systems, with the same overlap de-duplication by start time
    seen, others = {}, []
    for (period, lid), tr in tracks.items():
        if (period, lid) in keys or (tr.time.iloc[-1] - tr.time.iloc[0]).days < MIN_OTHER_DAYS:
            continue
        t0 = tr.time.iloc[0]
        rec = other_record(f"LPT-I-{period[:4]}-{lid}", lid, tr)
        if t0 in seen and seen[t0]["duration_days"] >= rec["duration_days"]:
            continue
        seen[t0] = rec
    mjo_starts = {s["begin"] for s in mjo}
    others = [r for r in seen.values() if r["begin"] not in mjo_starts]
    return mjo, others


SOURCES = {
    "imerg": {
        "load": load_imerg,
        "label": "IMERG V7",
        "long_name": "LPT on NASA IMERG V7 rainfall (Kerns & Chen database, 2025–26 update)",
        "source_url": f"{LPT_URL}/index.html",
        "outlines": True,
    },
    "tmpa": {
        "load": load_tmpa,
        "label": "TMPA (Kerns & Chen 2020)",
        "long_name": "LPT on TRMM/TMPA 3B42 rainfall, as in Kerns & Chen (2020)",
        "source_url": f"{LPT_URL}/index.html",
        "outlines": False,
    },
}
