# MJO Track Archive

Nirmal Mathew Alex, Florida Institute of Technology

Madden–Julian Oscillation events from two tracking methods, side by side:

- **RMM index** (Wheeler & Hendon 2004), daily 1979–present, from the Australian Bureau of Meteorology.
- **Large-scale Precipitation Tracking (LPT)** (Kerns & Chen 2016, 2020): IMERG V7 (1998–2026) and
  TMPA (1998–2018) databases, with real rain-area outlines for IMERG MJO systems.

Live site: https://nmathewa.github.io/mjo-tracker/

## Run locally

```bash
git clone --recursive https://github.com/nmathewa/mjo-tracker.git   # or: git submodule update --init
make                                 # build site/index.html from content/index.md (needs pandoc)
python pipeline/build.py --fetch     # download sources into data/raw and build site/data; --fetch refreshes RMM
python pipeline/serve.py             # http://0.0.0.0:8765
python pipeline/outlines.py          # (slow, optional) real LPT outlines from the upstream mask files
```

The page text is Markdown in `content/index.md` (settings in `content/site.yaml`, references in
`content/references.bib`), built with pandoc and the
[academic-site-template](https://github.com/nmathewa/academic-site-template) (submodule `theme/`), which
provides the layout, base style and theme toggle. Edit the template repo to change the look: the daily
build takes its latest `main`. To try a local template checkout: `make THEME=~/academic-site-template`.
The interactive figures are HTML blocks in `content/index.md` drawn by `site/js/`. No data is stored in this repository: `pipeline/build.py` downloads
it from the original sources, and a GitHub Actions workflow rebuilds it daily and deploys to Pages.

## Data sources

- RMM: https://www.bom.gov.au/clim_data/IDCKGEM000/rmm.74toRealtime.txt
- LPT: https://orca.atmos.washington.edu/data/lpt/ (B. Kerns, University of Washington)

Please cite the original papers; see the site's "How to cite" section.

## Roadmap

1. Archive of MJO tracks by several methods (this site).
2. Backend that runs LPT tracking on forecast rainfall.
3. Live MJO forecasts shown against the archive.
