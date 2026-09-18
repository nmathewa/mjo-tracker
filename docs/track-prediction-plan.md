# MJO track prediction: plan

Living document — revise as results come in. Started 2026-09-18.

## Goal

Given an MJO LPT system observed up to an initial time *t₀*, predict where its rain
centroid goes next (longitude, latitude), how large it is, and whether it survives —
as a **probabilistic** forecast (an ensemble of plausible tracks), learned from past tracks.

This is a statistical route to Phase 3 that runs on observed state alone. It complements
Phase 2 (running LPT on dynamical-model forecast rainfall); later the two can be blended.

## What we have to learn from

| data | size | use |
|---|---|---|
| IMERG V7 MJO LPT tracks, 1998 – Aug 2026 | 320 systems, 33,785 six-hourly points; median life 23.5 d (10–90 %: 11–45 d) | main training set |
| IMERG V7 non-MJO LPT tracks | 1,155 systems ≥ 3 d | pre-training (how rain systems move in general) |
| Eastward-propagation periods (MJO list) | median 14 d, speed median 3.5 m/s (1.3–7.6) | labels: "MJO part" |
| Real rain outlines (285 systems) | 6-hourly polygons | later: shape/extent targets |
| RMM daily, 1979 – present | ~17,000 days | large-scale state to condition on |
| ENSO (Niño 3.4), QBO | monthly | conditioning (loaders exist in `~/qb_mjo/mjo/indices.py`) |
| TMPA LPT (1998–2018) | 215 systems | *not* independent of IMERG — use only as a robustness check |

**The central constraint: ~320 independent events.** Samples taken at many *t₀* along one
track are strongly correlated, so the effective sample size is the number of systems, not
the number of 6-hour steps. Everything below is sized for that: small models, strong
baselines, strict cross-validation.

## Forecast task (v1)

- **Initial time:** any 6-hourly point of an MJO system with ≥ 2 days of history.
- **Inputs:** the last 5 days of the track (Δlon, lat, log area, speed), time of year,
  current RMM (RMM1, RMM2, amplitude, phase angle) and its last 10 days, ENSO/QBO.
- **Outputs:** for leads 6 h … 15 days: centroid lon/lat and log area, and P(system still alive).
- **Form:** an ensemble of N = 50 sampled tracks per forecast (so the site can draw a plume,
  and every probabilistic score is computable).

Extensions once v1 works: 30-day leads; genesis forecasts ("will this new system become an
MJO LPT and cross the Maritime Continent?"); outline/extent forecasts.

## Baselines (the model must beat these, or it doesn't ship)

1. **Persistence:** stays where it is.
2. **Constant velocity:** continues its last-2-day centroid velocity.
3. **Climatological drift:** mean velocity as a function of longitude and season from training
   years (captures slowing over the Maritime Continent).
4. **Analogs:** the k past systems whose recent track segment and RMM state best match; their
   subsequent paths, shifted to the current position, form the ensemble.
5. **Linear (Kalman-style) model** on track + RMM features.

Analogs are likely the strongest classical baseline with 320 events — beat them first.

## Models

- **M1 — sequence model with probabilistic head.** GRU (or small transformer) encoder over the
  history, conditioned on RMM/season/ENSO; autoregressive decoder emitting a Gaussian-mixture for
  the next 6-hour step (Δlon, Δlat, Δlog-area) plus a survival logit. Sample it for ensembles.
  ~50–100 k parameters. Trains in minutes on the RTX 4050.
- **M2 — pre-train on all LPTs, fine-tune on MJO.** Uses the 1,155 non-MJO systems for general
  motion, then specialises.
- **M3 — add gridded context** (IMERG rain or OLR/u850 around the system): a small CNN encoder
  over a coarse tropical field. Only if M1/M2 plateau; this needs a larger data pipeline.
- Augmentation: longitude shifts only where physically defensible (e.g. within the Indian Ocean),
  never across the Maritime Continent; noise on area; random history lengths.

## Evaluation (one rule set for every forecaster)

- **Cross-validation by whole years** (contiguous blocks, e.g. 7 folds of ~4 years), never random
  samples — adjacent initial times from one track must never be split across train and test.
  Same rule as `~/qb_mjo`.
- **Scores by lead time:** zonal and great-circle centroid error (ensemble mean), CRPS / energy
  score of the ensemble, 50/90 % coverage, spread–error ratio, Brier score for survival.
- **MJO-specific games:** does the system cross the Maritime Continent (reach 150°E)? Error in
  eastward-propagation end longitude and time. Stratify by initial longitude (Indian Ocean vs
  Maritime Continent vs Pacific), season, RMM amplitude, ENSO.
- **Uncertainty:** bootstrap over systems (not time steps) for every skill difference.
- **Held-out final test:** the most recent seasons (e.g. Jun 2023 – Aug 2026) touched once, at the
  end, for the numbers we publish.

## On the site

- **Hindcast figure (first):** pick any past system and initial time; show the model's ensemble
  plume against what actually happened, with the baselines one click away. Uses cross-validated
  forecasts only (each year predicted by a model that never saw it). Honest and a good demo.
- **Skill panel:** error vs lead for model vs baselines, with confidence bands.
- **Live forecast (Phase 3):** needs current LPT systems. The IMERG LPT database updates
  irregularly (last: 18 Aug 2026), so live use requires running LPT ourselves on near-real-time
  IMERG — shared work with Phase 2. Until then: "experimental" label, hindcasts only.

## Where things run

| step | where | notes |
|---|---|---|
| training, cross-validation, hindcasts | this machine (RTX 4050) | hindcasts committed as JSON |
| daily RMM update + deploy | GitHub Actions | running since 2026-09-18 |
| model inference | GitHub Actions (CPU) | export to ONNX (< 1 MB, committed); run with `onnxruntime`, no torch in CI. ~seconds per day. Same file can run in the browser via `onnxruntime-web`. |
| near-real-time LPT tracking | GitHub Actions — **untested** | IMERG NRT via NASA Earthdata (secret), public LPT code, tracking state kept between runs. Must be proven with a trial workflow (runtime, download size, continuity) before live forecasts depend on it. Shared with Phase 2. |

GitHub-hosted runners (public repos): 4 vCPU, 16 GB RAM, 14 GB disk, 6 h per job, no GPU.

## Code layout (proposed)

```
ml/
  dataset.py     tracks + RMM/ENSO -> (history, target) samples, year folds, normalisation
  baselines.py   persistence, constant velocity, climatological drift, analogs, linear
  models.py      GRU-MDN (M1), pre-train/fine-tune (M2)
  train.py       per-fold training, checkpoints, seeds
  evaluate.py    one scoring rule set for all forecasters, bootstrap, tables/plots
  export.py      cross-validated hindcasts -> site/data/hindcast/*.json
```

Environment: `.venv` layered on `~/miniforge3/envs/nma` (`--system-site-packages`) with torch
(CUDA) added; keep pip cache and temp files on /home (the root disk is full).

## Milestones

1. **Dataset + evaluation harness + baselines.** Output: a skill table for the 5 baselines.
   This alone tells us how predictable the tracks are.
2. **M1** trained with year-block CV; compare with baselines.
3. **Conditioning study:** what RMM / ENSO / season add (ablations).
4. **M2** pre-training; decide on M3.
5. **Hindcast export + site figure.**
6. **Live:** once near-real-time LPT exists (Phase 2).

## Honesty rules

- 320 events: report confidence intervals; don't claim skill differences inside them.
- A model that doesn't beat analogs and climatological drift isn't shown as a forecast.
- Hindcasts on the site come only from models that never saw that year.
- Forecasts always show spread; never a single deterministic track.
- The LPT MJO list is defined with hindsight (full track known). A live forecast can't know yet
  whether a young system will make the list — say so, and treat genesis as its own problem.
