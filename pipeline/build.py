"""Build the JSON the static site reads, from raw MJO tracking data.

Every tracking method is converted to one of two shapes the site knows how to draw:

- a daily index in RMM phase space (rmm.json), plus the events detected on it
  (rmm_events.json);
- tracked systems in longitude/latitude/time (lpt_mjo.json), each with its
  eastward-propagation segment and, where the raw data has it, the full
  centroid track.

manifest.json lists the methods, their coverage and their sources, so the page
never hard-codes what data exists. Adding a method means adding a loader here
and an entry in the manifest.

    python pipeline/build.py            # use data/raw/rmm.74toRealtime.txt
    python pipeline/build.py --fetch    # download the latest RMM from BoM first
"""
import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "site" / "data"

RMM_URL = "http://www.bom.gov.au/climate/mjo/graphics/rmm.74toRealtime.txt"
RMM_FILE = RAW / "rmm.74toRealtime.txt"
RMM_START = "1979-01-01"  # the 1978 OLR gap ends here
LPT_LIST = RAW / "mjo_lpt_list.txt"
LPT_TRACKS = sorted(RAW.glob("lpt_systems_*.txt"))

# RMM event rule. Kept deliberately simple and stated on the page.
EVENT_AMP = 1.0          # active when amplitude >= this
EVENT_GAP_DAYS = 3       # a dip below EVENT_AMP this short does not end an event
EVENT_MIN_DAYS = 20      # shortest event kept
EVENT_MIN_EAST_DEG = 90  # net counter-clockwise (eastward) progress needed, degrees


def fetch_rmm():
    req = urllib.request.Request(RMM_URL, headers={"User-Agent": "mjo-track-app"})
    with urllib.request.urlopen(req, timeout=60) as r:
        RMM_FILE.write_bytes(r.read())


def load_rmm(path=RMM_FILE):
    df = pd.read_csv(path, skiprows=2, sep=r"\s+", header=None, usecols=range(7),
                     names=["year", "month", "day", "rmm1", "rmm2", "phase", "amp"])
    df.index = pd.to_datetime(df[["year", "month", "day"]])
    df = df.loc[RMM_START:, ["rmm1", "rmm2"]]
    df = df.mask(df.abs() > 100)  # BoM missing values are 1e36 / 999
    return df.asfreq("D")


def rmm_events(rmm):
    """Contiguous active spells with net eastward propagation."""
    amp = np.hypot(rmm.rmm1, rmm.rmm2).to_numpy()
    active = np.nan_to_num(amp, nan=0.0) >= EVENT_AMP
    # close short gaps
    idx = np.flatnonzero(active)
    for a, b in zip(idx[:-1], idx[1:]):
        if 1 < b - a <= EVENT_GAP_DAYS + 1:
            active[a:b] = True
    edges = np.diff(np.r_[0, active.astype(int), 0])
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    ang = np.arctan2(rmm.rmm2.to_numpy(), rmm.rmm1.to_numpy())
    events = []
    for s, e in zip(starts, ends):
        if e - s < EVENT_MIN_DAYS or np.isnan(ang[s:e]).any():
            continue
        east = np.degrees(np.unwrap(ang[s:e]))
        progress = east[-1] - east[0]
        if progress < EVENT_MIN_EAST_DEG:
            continue
        seg = amp[s:e]
        events.append({
            "id": f"RMM-{rmm.index[s]:%Y%m%d}",
            "start": f"{rmm.index[s]:%Y-%m-%d}",
            "end": f"{rmm.index[e - 1]:%Y-%m-%d}",
            "days": int(e - s),
            "max_amp": round(float(seg.max()), 2),
            "mean_amp": round(float(seg.mean()), 2),
            "start_phase": phase_of(ang[s]),
            "end_phase": phase_of(ang[e - 1]),
            "east_deg": round(float(progress)),
            "period_days": round(float(360 * (e - s) / progress)),
        })
    return events


def phase_of(angle_rad):
    """Wheeler & Hendon (2004) phase 1..8; phase k spans [-180+45(k-1), -180+45k) deg."""
    return int(np.floor((np.degrees(angle_rad) + 180) / 45) % 8) + 1


def load_lpt_list(path=LPT_LIST):
    lpt = pd.read_csv(path, sep=r"\s+")
    for c in ["begin", "end", "eprop_begin", "eprop_end"]:
        lpt[c] = pd.to_datetime(lpt[c].astype(str), format="%Y%m%d%H")
    return lpt


def load_lpt_tracks(paths=LPT_TRACKS):
    """{lpt_id: DataFrame(time, area_km2, lat, lon)} from lpt_systems_*.txt files."""
    tracks = {}
    for path in paths:
        cur, rows = None, []
        for line in path.read_text().splitlines()[2:]:
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "LPT":
                if cur is not None:
                    tracks[cur] = rows
                cur, rows = f"{float(parts[1]):.4f}", []
            else:
                rows.append((pd.to_datetime(parts[0], format="%Y%m%d%H"),
                             float(parts[1]), float(parts[2]), float(parts[3])))
        if cur is not None:
            tracks[cur] = rows
    return {k: pd.DataFrame(v, columns=["time", "area", "lat", "lon"]) for k, v in tracks.items()}


def lpt_systems(lpt, tracks):
    """One entry per LPT system. A system can have several eastward-propagation
    segments; the list has one row per segment."""
    out = []
    for (year, index), g in lpt.groupby(["begin_year", "lpt_index"], sort=False):
        r = g.iloc[0]
        lid = f"{index:.4f}"
        sysd = {
            "id": f"LPT-{year}-{lid}",
            "lpt_index": lid,
            "begin": iso(r.begin), "end": iso(r.end),
            "duration_days": round(float(r.duration), 2),
            "eprop": [{
                "begin": iso(e.eprop_begin), "end": iso(e.eprop_end),
                "lon_begin": round(float(e.eprop_lon_begin), 1),
                "lon_end": round(float(e.eprop_lon_end), 1),
                "speed_ms": round(float(e.eprop_spd), 2),
                "days": round(float(e.eprop_dur), 2),
            } for e in g.itertuples()],
        }
        tr = tracks.get(lid)
        if tr is not None and tr.time.iloc[0] == r.begin:
            tr6 = tr[tr.time.dt.hour % 6 == 0]  # 6-hourly is plenty for the map
            sysd["track"] = [[iso(t), round(la, 2), round(lo, 2), int(a)]
                             for t, a, la, lo in tr6.itertuples(index=False)]
        out.append(sysd)
    return out


def iso(t):
    return f"{t:%Y-%m-%dT%H:%MZ}"


def write(name, obj):
    path = OUT / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fetch", action="store_true", help="download the latest RMM from BoM")
    args = ap.parse_args()
    if args.fetch:
        fetch_rmm()
    OUT.mkdir(parents=True, exist_ok=True)

    rmm = load_rmm()
    rmm = rmm.loc[:rmm.dropna().index[-1]]
    events = rmm_events(rmm)
    r = lambda s: [None if np.isnan(v) else round(float(v), 3) for v in s]
    write("rmm.json", {"start": f"{rmm.index[0]:%Y-%m-%d}", "rmm1": r(rmm.rmm1), "rmm2": r(rmm.rmm2)})
    write("rmm_events.json", events)

    lpt = load_lpt_list()
    systems = lpt_systems(lpt, load_lpt_tracks())
    write("lpt_mjo.json", systems)

    write("manifest.json", {
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "methods": [
            {
                "id": "rmm", "name": "RMM index", "kind": "index",
                "long_name": "Real-time Multivariate MJO index (Wheeler & Hendon 2004)",
                "coverage": [f"{rmm.index[0]:%Y-%m-%d}", f"{rmm.index[-1]:%Y-%m-%d}"],
                "source": RMM_URL,
                "files": ["rmm.json", "rmm_events.json"],
                "event_rule": {
                    "min_amp": EVENT_AMP, "gap_days": EVENT_GAP_DAYS,
                    "min_days": EVENT_MIN_DAYS, "min_east_deg": EVENT_MIN_EAST_DEG,
                },
                "n_events": len(events),
                "note": "ENSO (SST1) signal removed only through 2013-12-31.",
            },
            {
                "id": "lpt", "name": "LPT tracking", "kind": "systems",
                "long_name": "Large-scale Precipitation Tracking (Kerns & Chen 2016, 2020)",
                "coverage": [systems[0]["begin"][:10], systems[-1]["end"][:10]],
                "source": "TMPA 3B42 rain, LPT MJO systems list",
                "files": ["lpt_mjo.json"],
                "n_systems": len(systems),
                "n_full_tracks": sum("track" in s for s in systems),
            },
        ],
    })


if __name__ == "__main__":
    main()
