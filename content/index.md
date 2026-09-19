---
title: MJO Track Archive
eyebrow: Tropical intraseasonal variability · Data archive
subtitle: 'Madden–Julian Oscillation events from the RMM index (1979–present) and Large-scale Precipitation Tracking (<span class="lpt-cov">Jan 1998 – Aug 2026</span>)'
description: Archive of Madden–Julian Oscillation events tracked by the RMM index and LPT precipitation tracking.
header-includes: |
  <meta name="citation_author" content="Alex, Nirmal Mathew">
  <meta name="citation_author_institution" content="Florida Institute of Technology">
abstract: |
  The Madden–Julian Oscillation (MJO) is the dominant mode of tropical intraseasonal variability: a
  planetary-scale envelope of enhanced rainfall that travels eastward along the equator, returning every
  30–60 days. This archive sets two ways of following it side by side — the Real-time Multivariate MJO
  index [RMM, @wheeler2004], a daily index of upper- and lower-level wind and cloudiness, and Large-scale
  Precipitation Tracking [LPT, @kerns2016; @kerns2020], which follows the rain systems themselves. Choose a
  time window below; all figures update together, and the page address records the view.

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
  <p class="caption">RMM amplitude, 1979 to present, smoothed to the bin width shown (dashed line: amplitude 1, the usual
    threshold for an active MJO), and the periods covered by LPT MJO systems (ticks; <span class="lpt-cov"></span>). The
    highlighted interval is the window shown in all other figures.</p>
</section>

<div class="grid">
  <section class="card fig map-card" aria-labelledby="map-h">
    <h2 id="map-h">Map of LPT tracks <span class="sub">pan, zoom, play</span></h2>
    <div id="map" class="chart"></div>
  </section>
  <section id="detail" class="card fig detail-card" aria-label="Selected system details" hidden></section>

  <section class="card fig hov-card" aria-labelledby="hov-h">
    <h2 id="hov-h">Longitude–time (Hovmöller) diagram</h2>
    <div id="hovmoller" class="chart"></div>
    <p class="caption">Longitude–time diagram of the window; time increases downward, so eastward propagation runs down
      and to the right. LPT lines are centroid tracks of tracked rain systems (available <span class="lpt-cov"></span>; click one for details). RMM is an index,
      not a location: its active days (amplitude ≥ 1) are placed at the <em>approximate</em> longitude of their phase,
      from the Wheeler &amp; Hendon (2004) composites. The dotted line is a 5&nbsp;m&nbsp;s⁻¹ eastward reference.</p>
  </section>

  <section class="card fig phase-card" aria-labelledby="ph-h">
    <h2 id="ph-h">RMM phase diagram</h2>
    <div id="phase" class="chart"></div>
    <p class="caption">(RMM1, RMM2) phase space after Wheeler &amp; Hendon (2004). Counter-clockwise motion is eastward
      propagation; numbers are the eight MJO phases, labelled with where enhanced convection sits. Inside the unit circle
      (amplitude &lt; 1) the MJO is weak. Colour runs with time; small labelled dots mark the 1st of each month.</p>
  </section>

  <section class="card list-card" aria-labelledby="list-h">
    <h2 id="list-h"><span class="tab-no">Table 1.</span> Events in the window</h2>
    <ul id="events" class="events"></ul>
  </section>
</div>

<section id="forecast-section" class="card fig forecast-card" aria-labelledby="fc-h">
  <h2 id="fc-h">Track forecast <span class="badge-exp">experimental</span> <span class="sub">trained model on GEFS · test event</span></h2>
  <div id="forecast" class="chart"></div>
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
