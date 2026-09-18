# mjo_track_app — MJO Track Archive & Forecast site

Website showing MJO tracks from several tracking methods, growing into live forecasts.

## Roadmap
1. **Archive (now):** RMM index + LPT MJO systems, static site, anyone can host it.
2. **Forecast backend:** run LPT tracking on forecast rainfall.
3. **Live:** forecast tracks drawn against the archive.

## Layout
- `pipeline/build.py` — raw data → `site/data/*.json` + `manifest.json`. Every method is
  reduced to one of two shapes: a daily RMM-space index, or tracked systems in lon/lat/time
  (with `eprop` eastward-propagation segments and an optional full `track`). Adding a method
  = a loader here + a manifest entry + a colour token.
- `data/raw/` — BoM `rmm.74toRealtime.txt`, LPT MJO list (1998–2018, from
  `~/phd/EXP_1d_diurnal_mse_TWP/dsets/`), LPT full tracks (only Jun 2011–Jun 2012 so far).
- `site/` — static, no build step: `index.html`, `css/style.css`, `js/data.js` (load + phase
  geometry), `js/charts.js` (timeline, Hovmöller, phase diagram, map, list), `js/main.js`
  (state in URL hash `#from=&days=&m=`). D3/topojson/land vendored in `site/vendor/`.

## Commands
- Build data: `~/miniforge3/envs/nma/bin/python pipeline/build.py` (`--fetch` pulls latest RMM).
- Serve: `~/miniforge3/envs/nma/bin/python -m http.server 8765 -d site`.
- Browser checks: `@playwright/test` in `node_modules`; run scripts from the repo root.

## Agents (.claude/agents)
- `ui-designer` — visual design; edits css + chart styling.
- `ux-engineer` — drives the page, fixes interaction/accessibility; owns main.js.
- `communicator` — read-only; ranked outreach/design ideas.

## Honesty rules
- RMM on the Hovmöller is placed at the *approximate* longitude of its phase (WH04
  composites) — always labelled as such.
- A system can have several `eprop` segments; the LPT list has one row per segment.
- RMM ENSO removal stops after 2013-12-31 (BoM).
- Don't imply LPT full tracks exist outside the loaded files.
