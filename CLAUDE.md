# mjo_track_app — MJO Track Archive & Forecast site

Website showing MJO tracks from several tracking methods, growing into live forecasts.

## Roadmap
1. **Archive (now):** RMM index + LPT MJO systems, static site, anyone can host it.
2. **Forecast backend:** run LPT tracking on forecast rainfall.
3. **Live:** forecast tracks drawn against the archive.

## No datasets in git
`data/raw/` and `site/data/` are gitignored and rebuilt from the original sources: `pipeline/build.py`
downloads anything missing (BoM RMM, UW LPT text files) and `pipeline/outlines.py` rebuilds outlines.
The Pages workflow does the same on every run, keeping downloads + outlines in the Actions cache.

## Layout
- `pipeline/build.py` — raw data → `site/data/*.json` + `manifest.json`. Every method is
  reduced to one of two shapes: a daily RMM-space index, or tracked systems in lon/lat/time
  (with `eprop` eastward-propagation segments and an optional full `track`). Adding a method
  = a loader here + a manifest entry + a colour token.
- `pipeline/lpt.py` — LPT sources (`imerg` = IMERG V7 1998–Aug 2026, default; `tmpa` = Kerns & Chen 2020).
  IMERG tracking periods overlap by a month; duplicates are resolved by keeping the longest copy.
- `pipeline/outlines.py` — real rain-area outlines for IMERG MJO systems: reads 6-hourly slices of the
  per-system mask NetCDFs (50–350 MB each) over HTTP range requests (h5py+fsspec, ssl off — the server's
  TLS chain is incomplete), contours mask>0, simplifies, writes `site/data/outlines/imerg/<id>.json`.
  Resumable; ~20 s/system. 285/320 done: the server's 2000060100_2005063023 mask folder stops at
  lptid 56 (checked 2026-09-18), so 35 systems from 2003–05 have no outline and fall back to circles.
- `data/raw/imerg_v7/` — IMERG V7 track files and MJO/non-MJO lists.
- `data/raw/` — BoM `rmm.74toRealtime.txt`; LPT MJO list + all 20 `lpt_systems_tmpa_*.txt`
  track files (Jun 1998–Jun 2018) from the Kerns & Chen 2020 database,
  https://orca.atmos.washington.edu/data/lpt/ (kc2020/20_72h/thresh12/systems/). Track files number
  systems per June–June season, so tracks are keyed by (season year, lpt_index). The same site has
  IMERG V7 (1998–present) and ERA5 (1940–) LPT databases — candidates for extending coverage.
- `site/` — static, no build step: `index.html`, `css/style.css`, `js/data.js` (load + phase
  geometry), `js/charts.js` (timeline, Hovmöller, phase diagram, map, list), `js/main.js`
  (state in URL hash `#from=&days=&m=&sel=`), `js/now.js` (plain-language "latest" line, RMM only),
  `js/map.js` (interactive pan/zoom/playback map; broadcasts `mjo:time`, `mjo:select` events),
  `js/detail.js` (one LPT system, after Kerns & Chen 2020 Fig. 1; opens only on click). D3/topojson/land vendored in `site/vendor/`.

## Commands
- Build data: `~/miniforge3/envs/nma/bin/python pipeline/build.py` (`--fetch` pulls latest RMM from
  `https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt`; the old `climate/mjo/graphics/`
  URL is frozen at 2024-02-24. The fetch refuses a file older than the current one).
- Deploy: `.github/workflows/pages.yml` — daily 06:30 UTC fetch + rebuild + GitHub Pages (no commits; keepalive action).
- Serve: `~/miniforge3/envs/nma/bin/python pipeline/serve.py` (0.0.0.0:8765, no-cache headers).
- Browser checks: `@playwright/test` in `node_modules`; run scripts from the repo root.

## Agents (.claude/agents)
- `ui-designer` — visual design; edits css + chart styling.
- `ux-engineer` — drives the page, fixes interaction/accessibility; owns main.js.
- `communicator` — read-only; ranked outreach/design ideas.

- `docs/track-prediction-plan.md` — plan for the ML track-prediction work (living document).

## Honesty rules
- RMM on the Hovmöller is placed at the *approximate* longitude of its phase (WH04
  composites) — always labelled as such.
- A system can have several `eprop` segments; the LPT list has one row per segment.
- RMM ENSO removal stops after 2013-12-31 (BoM).
- Detail-figure outlines are real mask edges (IMERG); the map's moving discs and TMPA footprints are
  equal-area circles — label them so.
- State the coverage of the LPT source shown (IMERG Jan 1998–Aug 2026, TMPA Jun 1998–Jun 2018).
