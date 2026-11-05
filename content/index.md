---
title: MJO Track Archive
eyebrow: Data archive
subtitle: 'Madden–Julian Oscillation events from the RMM index (1979–present) and Large-scale Precipitation Tracking (LPT; <span class="lpt-cov">Jan 1998 – Aug 2026</span>)'
description: Archive of Madden–Julian Oscillation events tracked by the RMM index and LPT precipitation tracking.
header-includes: |
  <meta name="citation_author" content="Alex, Nirmal Mathew">
  <meta name="citation_author_institution" content="Florida Institute of Technology">
abstract: |
  The Madden–Julian Oscillation [MJO, @madden1971; @madden1972] is the most prominent mode of tropical
  intraseasonal variability (20–100 days). It modulates global weather and climate and is critical for
  skillful forecasting at sub-seasonal-to-seasonal (S2S) timescales [@zhang2013]. The convective evolution and
  propagation of the MJO have been explored extensively in previous studies. This archive brings together two
  ways of following it: the Real-time Multivariate MJO index [RMM, @wheeler2004], a daily index of upper- and
  lower-level wind and cloudiness, and Large-scale Precipitation Tracking [LPT, @kerns2016; @kerns2020].

  <p id="now" class="now" aria-live="polite"></p>
nav:
  - {title: Figures, href: "#figures"}
  - {title: Forecast (experimental), href: "#forecast-section"}
  - {title: Data and methods, href: "#methods"}
  - {title: References, href: "#references"}
  - {title: How to cite, href: "#cite"}
---

<!-- The interactive figures are HTML blocks filled by js/*.js; the text around them is Markdown. -->

```{=html}
<nav class="controls" aria-label="View controls">
  <div class="window-nav">
    <button id="prev" type="button" aria-label="Previous window">◀</button>
    <output id="window-label" aria-live="polite"></output>
    <button id="next" type="button" aria-label="Next window">▶</button>
  </div>
  <label class="presets">Jump to
    <select id="preset">
      <option value="">choose…</option>
      <option value="latest">Latest 120 days</option>
      <option value="2011-10-01">DYNAMO field campaign (Oct 2011)</option>
      <option value="2015-11-01">2015–16 El Niño winter</option>
      <option value="1987-12-15">TOGA COARE era (1987–88)</option>
      <option value="2019-10-15">2019–20 Australian summer</option>
    </select>
  </label>
  <fieldset class="methods">
    <legend>Methods</legend>
    <label class="chip rmm"><input type="checkbox" name="method" value="rmm" checked><span class="glyph" aria-hidden="true"></span> Wind + cloud index <abbr title="Real-time Multivariate MJO index">RMM</abbr></label>
    <label class="chip lpt"><input type="checkbox" name="method" value="lpt" checked><span class="glyph" aria-hidden="true"></span> Rain-band tracking <abbr title="Large-scale Precipitation Tracking">LPT</abbr></label>
    <select id="lpt-src" aria-label="LPT rainfall dataset"></select>
  </fieldset>
</nav>

<section id="figures" class="card fig timeline-card" aria-labelledby="tl-h">
  <h2 id="tl-h">Archive overview <span class="sub">drag or click to choose a window</span></h2>
  <div id="timeline" class="chart"></div>
  <p class="caption">Time series of RMM amplitude from 1979 to present (dashed line: amplitude 1) and the periods
    covered by LPT MJO systems (<span class="lpt-cov"></span>).</p>
</section>

<div class="grid">
  <section class="card fig map-card" aria-labelledby="map-h">
    <h2 id="map-h">Map of LPT tracks <span class="sub">pan and zoom</span></h2>
    <div id="map" class="chart"></div>
  </section>
  <section id="detail" class="card fig detail-card" aria-label="Selected system details" hidden></section>

  <section class="card fig hov-card" aria-labelledby="hov-h">
    <h2 id="hov-h">Hovmöller diagram</h2>
    <div id="hovmoller" class="chart"></div>
    <p class="caption">Hovmöller diagram of eastward MJO propagation, with LPT tracks (blue lines;
      <span class="lpt-cov"></span>) and the RMM index (orange dots, placed at the <em>approximate</em> longitude of
      their phase, after Wheeler &amp; Hendon 2004). Click a track for more details.</p>
  </section>

  <section class="card fig phase-card" aria-labelledby="ph-h">
    <h2 id="ph-h">RMM phase diagram</h2>
    <div id="phase" class="chart"></div>
    <p class="caption">(RMM1, RMM2) phase space diagram (Wheeler &amp; Hendon 2004). Eastward propagation runs
      counter-clockwise; colours show the date. Click to highlight.</p>
  </section>

  <section class="card list-card" aria-labelledby="list-h">
    <h2 id="list-h"><span class="tab-no">Table 1.</span> Events in the window</h2>
    <ul id="events" class="events"></ul>
  </section>
</div>

<section id="forecast-section" class="card fig forecast-card" aria-labelledby="fc-h">
  <h2 id="fc-h">Track forecast <span class="badge-exp">experimental</span> <span class="sub">trained model on GEFS · single event</span></h2>
  <div id="forecast" class="chart"></div>

  <h3 class="fc-flow-h"><span class="panel-letter">(c)</span> How the forecast is made</h3>
  <ol class="fc-flow" aria-label="Forecast workflow">
    <li class="fc-step fc-in">
      <span class="fc-tag">Inputs</span>
      <ul>
        <li><b>GEFS forecast</b> rain, 5 members, 16 days</li>
        <li><b>Observed track</b>, last 5 days (IMERG LPT)</li>
        <li><b>MJO state</b>: RMM, ENSO, QBO, season</li>
        <li class="fc-unk"><b>GEFS environment</b>: OLR, moisture, vertical motion, winds — <i>contribution not yet measured</i></li>
      </ul>
    </li>
    <li class="fc-step fc-plain">
      <span class="fc-tag">Step 1 · no model</span>
      <b>Follow the GEFS rain</b> from where the system is → a first-guess track
    </li>
    <li class="fc-step fc-ml">
      <span class="fc-tag">Step 2 · trained model</span>
      <b>Correct the track</b> towards what IMERG LPT observed (CNN-Transformer): shift, spread, chance of dying
    </li>
    <li class="fc-step fc-outp">
      <span class="fc-tag">Output</span>
      <b>50 possible tracks</b> → cone (a), chance of reaching 150°E (b)
    </li>
    <li class="fc-step fc-check">
      <span class="fc-tag">Checked against IMERG LPT</span>
      <b>CRPS</b>: whole spread of tracks, vs following the GEFS rain<br>
      <b>Brier skill</b>: crossing 150°E, vs climatology
    </li>
  </ol>

  <p class="caption"><b>Experimental.</b> (a) Track of one MJO rain system and the forecast from the start chosen with
    the slider, made by the MJO LPT corrector (a Convolutional Neural Network (CNN)-Transformer, v0.1): the shading
    shows where 50 % and 90 % of 50 forecast tracks fall; the dashed red line is 150°E, the
    eastern side of the Maritime Continent. (b) For each start, the model's chance that the system reaches 150°E within
    15 days (bars) against climatology (red lines: how often winter MJO systems starting near the same longitude did),
    and whether it did (✓/✗); starts already east of 150°E are marked E. The Brier skill score compares the two:
    1 is perfect, 0 is no better than climatology, below 0 is worse. For this one event it rests on only a few
    starts; tested on 21 winters, each left out of training in turn, it is +0.13, and the track spread has 18–41 %
    lower CRPS than following the GEFS rain from day 3 to 15. It is worse than simple methods at day 1, and its
    crossing skill may come from the RMM index it is given rather than from the GEFS weather fields. Its settings
    were tuned while looking at this winter. (c) How the forecast is made.</p>

  <p class="fc-why"><b>Why forecast the track and not the MJO itself?</b> GEFS already forecasts the MJO's winds, cloud
    and rain. What it often gets wrong is where the MJO rain goes, especially whether it crosses the Maritime
    Continent, where models tend to weaken or stall it. A track is also something this archive can check directly:
    every forecast is scored against the IMERG LPT track that was observed. With 21 winters to learn from, a
    correction to GEFS's track is a target a model can learn and be tested on; forecasting whole fields is not.
    The price is that the model learns GEFS's track errors, not the physics of the MJO.</p>
</section>

<div id="tip" class="tip" role="tooltip" hidden></div>
```

::: paper

## Data and methods {#methods}

<div id="about"></div>

## References {#references}

::: {#refs}
:::

## How to cite and data sources {#cite}

This site redistributes and visualises published datasets; please cite the original work. For the RMM
index, cite @wheeler2004 and acknowledge the Australian Bureau of Meteorology, which publishes the daily
values. For LPT systems, cite @kerns2016 for the method and @kerns2020 for the MJO database. To refer to
a particular view on this site, give its full address (it encodes the window, methods and selected
system) and the date of access: <span id="cite-url" class="mono"></span>.

To cite this site: Alex, N. M., *MJO Track Archive*, Florida Institute of Technology,
<span class="mono">https://nmathewa.github.io/mjo-tracker/</span>, accessed <span id="cite-date"></span>.

:::
