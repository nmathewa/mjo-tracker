# mjo_track_app — MJO Track Archive (website)

Public static website: MJO events from the RMM index and Large-scale Precipitation Tracking (LPT),
plus an experimental track forecast. Author: Nirmal Mathew Alex, Florida Institute of Technology.
Live: https://nmathewa.github.io/mjo-tracker/ · repo: github.com/nmathewa/mjo-tracker (public).
The ML/science lives in `~/mjo_predict` (private repo `nmathewa/mjo-predict`), not here.

## Rules from the user
- **No datasets in git.** `data/raw/`, `site/data/`, `data/gefs/`, `models/` are gitignored. Data is
  downloaded from the original sources by the pipeline, locally and in GitHub Actions (Actions cache).
  The forecast model comes from the GitHub Release `model-v0.1`, never committed.
- Everything installs under `/home/nma` (root disk is full): Python env `~/miniforge3/envs/nma`
  (don't pip-install into it), node deps in `node_modules/`.
- Keep scripts simple, few comments. Push when asked; the daily job adds no commits.
- Serve locally on `0.0.0.0` so the user can test over LAN/Tailscale (100.66.11.37).

## Layout
- `pipeline/build.py` — downloads missing RMM (BoM) and LPT text files (UW), builds `site/data/*.json`
  + `manifest.json`. `--fetch` refreshes RMM from
  `https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt` (the old `climate/mjo/graphics/`
  URL is frozen at 2024-02-24; the fetch refuses an older file).
- `pipeline/lpt.py` — LPT sources: `imerg` (IMERG V7, Jan 1998–Aug 2026, default) and `tmpa`
  (Kerns & Chen 2020, Jun 1998–Jun 2018), from https://orca.atmos.washington.edu/data/lpt/
  (TLS chain incomplete → cert checks off for that host). IMERG tracking periods overlap by a month;
  duplicates keep the longest copy, ties the later period (stable ids).
- `pipeline/outlines.py` — real rain-area outlines for IMERG MJO systems from the per-system mask
  NetCDFs (HTTP range reads). 286/320: the server's 2000–2005 mask folder stops at lptid 56.
- `pipeline/forecast.py` — experimental forecast for ONE test event (`LPT-I-2010-70.2000`, DJF 2011–12):
  GEFS v12 reforecast (5 members, byte-range, cached in `data/gefs/`) → follow the rain → ONNX
  rain-track corrector → cone summary → `site/data/forecast/<event>.json`. Self-contained copy of the
  mjopredict inputs; verified identical to training. Needs `models/{corrector.onnx,norm.npz,meta.json}`.
- `pipeline/serve.py` — local no-cache server, 0.0.0.0:8765.
- `site/` — static, no build step. `js/main.js` (state in URL hash `#from=&days=&m=&src=&sel=`),
  `js/charts.js` (timeline, Hovmöller, phase diagram, list), `js/map.js` (pan/zoom/playback;
  events `mjo:time`, `mjo:select`), `js/detail.js` (one system, after Kerns & Chen 2020 Fig. 1),
  `js/forecast.js` (forecast cone), `js/now.js` (current-state line). D3/topojson/land in `site/vendor/`.
- Style: academic (Source Serif 4 + Source Sans 3), Okabe–Ito blue `--lpt` / vermillion `--rmm` on
  white; dark mode kept; theme toggle; phase-diagram logo `site/img/logo-phase.svg`.
- `.github/workflows/pages.yml` — daily 06:30 UTC: build data, outlines, forecast, deploy Pages.
  Public repo → Actions minutes free. Keepalive action (no commits).
- `.claude/agents/` — `ui-designer`, `ux-engineer` (editing), `communicator` (read-only ideas).

## Commands
```bash
~/miniforge3/envs/nma/bin/python pipeline/build.py [--fetch]
~/miniforge3/envs/nma/bin/python pipeline/outlines.py --workers 4
GEFS_CACHE=~/mjo_predict/cache/gefs7 ~/mjo_predict/.venv/bin/python pipeline/forecast.py --model models
~/miniforge3/envs/nma/bin/python pipeline/serve.py            # http://0.0.0.0:8765
```
Browser checks: `@playwright/test` from `node_modules`; put throwaway scripts in the repo root as
dotfiles (`.s.mjs`) and delete them after.

## Honesty rules (keep on the page)
- RMM on the Hovmöller/map is at the *approximate* longitude of its phase (WH04 composites).
- State the LPT source coverage shown; RMM ENSO removal stops after 2013-12-31 (BoM).
- Detail outlines are real mask edges; map discs and TMPA footprints are equal-area circles.
- Track tracks: whole life thin, MJO (eastward-propagation) part bold — from the MJO list.
- The forecast is experimental, one test event; caption states its measured skill. Latest
  leave-one-winter-out result (21 DJF winters, in mjo-predict `reports/lowo_summary.txt`): best
  method from day 3–15, CRPS 18–41 % below following the GEFS rain; weak at day 1.
