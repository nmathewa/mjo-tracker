// Detail view for one LPT system, opened by clicking it (map, Hovmöller or event list).
// Laid out after Kerns & Chen (2020) Fig. 1, lettered column by column: (a) rain-area footprints
// coloured by date, (b) longitude–time track, (c) centroid longitude, (d) zonal speed, (e) propagation.
import { fmtDay, loadOutline } from "./data.js";
import { showTip, hideTip, axisTitle } from "./charts.js";

const KM_PER_DEG = 111.2;
const fmtT = d3.utcFormat("%-d %b %H UTC");
const fmtLon = (l) => { l = ((Math.round(l) % 360) + 360) % 360; return l === 0 || l === 180 ? `${l}°` : l < 180 ? `${l}°E` : `${360 - l}°W`; };
const rDeg = (p) => Math.sqrt(p.area / Math.PI) / KM_PER_DEG;   // equal-area radius, degrees

// zonal speed (m/s) from the centroid, centred difference over ±12 h
function zonalSpeed(track) {
  return track.map((p, i) => {
    const a = track[Math.max(0, i - 2)], b = track[Math.min(track.length - 1, i + 2)];
    const dt = (b.t - a.t) / 1000;
    if (!dt) return { t: p.t, u: 0 };
    let dlon = b.lon - a.lon;
    if (dlon > 180) dlon -= 360;
    if (dlon < -180) dlon += 360;
    return { t: p.t, u: dlon * KM_PER_DEG * 1000 * Math.cos(p.lat * Math.PI / 180) / dt };
  });
}

let drawToken = 0;
export async function drawDetail(sel, data, s, opts) {
  const card = d3.select(sel), token = ++drawToken;
  if (!s) { card.selectAll("*").remove(); card.attr("hidden", true); return; }
  // real outlines (IMERG) when extracted; otherwise equal-area circles
  const outline = await loadOutline(data.lptSrc, s.id).catch(() => null);
  if (token !== drawToken) return;   // a newer selection arrived meanwhile
  card.selectAll("*").remove();
  card.attr("hidden", null);
  draw(card, data, s, outline, opts);
}

function draw(card, data, s, outline, { onClose, onShow }) {

  const tr = s.track;
  const inEprop = (t) => s.eprop.some((e) => t >= e.t0 && t <= e.t1);
  const tcol = d3.scaleSequential((u) => d3.interpolateTurbo(0.05 + 0.9 * u)).domain([s.t0, s.t1]);

  const head = card.append("div").attr("class", "detail-head");
  head.append("h2").html(`MJO rain system LPT ${s.lpt_index} <span class="sub">${fmtDay(s.t0)} – ${fmtDay(s.t1)} · ${Math.round(s.duration_days)} days</span>`);
  const btns = head.append("div").attr("class", "detail-btns");
  btns.append("button").attr("type", "button").text("Show in timeline").on("click", onShow);
  btns.append("button").attr("type", "button").attr("class", "close").attr("aria-label", "Close details").text("×").on("click", onClose);
  const facts = s.eprop.map((e) => `${fmtDay(e.t0)} – ${fmtDay(e.t1)}, ${fmtLon(e.lon_begin)} → ${fmtLon(e.lon_end)} at ${e.speed_ms} m s⁻¹`);

  const grid = card.append("div").attr("class", "detail-grid");
  const panel = (cls, letter, title) => {
    const d = grid.append("div").attr("class", `panel ${cls}`);
    d.append("h3").html(`<span class="panel-letter">(${letter})</span> ${title}`);
    return d;
  };

  // ---- (a) footprints map
  {
    const p = panel("p-map", "a", outline ? "Rain-area outlines <span class=\"sub\">every 6 h · colour = date</span>"
      : "Rain-area footprints <span class=\"sub\">equal-area circles · colour = date</span>");
    const W = Math.max(280, p.node().clientWidth || 600);
    const pts = outline ? outline.flatMap((o) => o.rings.flat()) : null;
    const lons = outline ? pts.map((c) => c[0]) : tr.flatMap((q) => [q.lon - rDeg(q), q.lon + rDeg(q)]);
    const lats = outline ? pts.map((c) => c[1]) : tr.flatMap((q) => [q.lat - rDeg(q), q.lat + rDeg(q)]);
    let a = d3.min(lons) - 4, b = d3.max(lons) + 4, c = Math.max(-60, d3.min(lats) - 4), d = Math.min(60, d3.max(lats) + 4);
    const H = Math.round(Math.min(W * 0.75, Math.max(200, W * (d - c) / (b - a))));
    // widen the shorter side so degrees stay square
    const ppd = Math.min(W / (b - a), H / (d - c));
    const cx = (a + b) / 2, cy = (c + d) / 2;
    const proj = d3.geoEquirectangular().rotate([-cx, 0]).center([0, cy]).scale(ppd * 180 / Math.PI).translate([W / 2, H / 2]);
    const geo = d3.geoPath(proj);
    const svg = p.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    svg.append("clipPath").attr("id", "det-clip").append("rect").attr("width", W).attr("height", H);
    const g = svg.append("g").attr("clip-path", "url(#det-clip)");
    g.append("rect").attr("class", "ocean").attr("width", W).attr("height", H);
    g.append("path").attr("class", "gridline").attr("fill", "none").attr("d", geo(d3.geoGraticule().step([15, 15])()));
    g.append("path").attr("class", "land").attr("d", geo(topojson.feature(data.land, data.land.objects.land)));
    if (outline) {
      const ring = d3.line((c) => proj(c)[0], (c) => proj(c)[1]);
      g.append("g").selectAll("path").data(outline.flatMap((o) => o.rings.map((r) => ({ t: o.t, r }))))
        .join("path").attr("class", "foot outline").attr("d", (d) => ring(d.r)).attr("stroke", (d) => tcol(d.t));
    } else {
      g.append("g").selectAll("circle").data(tr).join("circle").attr("class", "foot")
        .attr("cx", (q) => proj([q.lon, q.lat])[0]).attr("cy", (q) => proj([q.lon, q.lat])[1])
        .attr("r", (q) => rDeg(q) * ppd).attr("stroke", (q) => tcol(q.t));
    }
    g.append("path").attr("class", "det-track").attr("d", d3.line((q) => proj([q.lon, q.lat])[0], (q) => proj([q.lon, q.lat])[1])(tr));
    g.append("circle").attr("class", "lpt-start").attr("r", 3.5).attr("cx", proj([tr[0].lon, tr[0].lat])[0]).attr("cy", proj([tr[0].lon, tr[0].lat])[1]);
    // lat/lon labels
    const ticks = svg.append("g").attr("class", "map-axis");
    for (let l = Math.ceil(a / 15) * 15; l < b; l += 15) {
      const x = proj([l, cy])[0];
      if (x > 16 && x < W - 16) ticks.append("text").attr("class", "halo").attr("x", x).attr("y", H - 5).attr("text-anchor", "middle").text(fmtLon(l));
    }
    for (let l = Math.ceil(c / 15) * 15; l < d; l += 15) {
      const y = proj([cx, l])[1];
      if (y > 10 && y < H - 16) ticks.append("text").attr("class", "halo").attr("x", 4).attr("y", y).attr("dy", "0.35em").text(l === 0 ? "0°" : `${Math.abs(l)}°${l > 0 ? "N" : "S"}`);
    }
    svg.append("rect").attr("class", "frame").attr("width", W).attr("height", H);
    // hover: nearest time
    svg.on("mousemove", (ev) => {
      const [mx, my] = d3.pointer(ev);
      const q = d3.least(tr, (q) => { const [x, y] = proj([q.lon, q.lat]); return (x - mx) ** 2 + (y - my) ** 2; });
      showTip(ev, `<b>${fmtT(q.t)}</b><br>${q.lat.toFixed(1)}°, ${fmtLon(q.lon)}<br>rain area ${Math.round(q.area / 1e3).toLocaleString()} thousand km²`);
    }).on("mouseleave", hideTip);
    const stops = d3.range(0, 1.001, 0.1).map((u) => `<stop offset="${u}" stop-color="${tcol(+s.t0 + u * (s.t1 - s.t0))}"/>`).join("");
    p.append("div").attr("class", "legend").html(`<span class="key time-key"><span>${fmtDay(s.t0)}</span>` +
      `<svg class="ramp" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="det-ramp">${stops}</linearGradient></defs><rect width="100" height="8" rx="4" fill="url(#det-ramp)"/></svg>` +
      `<span>${fmtDay(s.t1)}</span></span>`);
  }

  // shared time axis for the line panels
  const small = (p, h, xTitle) => {
    const W = Math.max(260, p.node().clientWidth || 500), m = { t: 8, r: 10, b: xTitle ? 38 : 22, l: 58 };
    const x = d3.scaleUtc().domain([s.t0, s.t1]).range([m.l, W - m.r]);
    const svg = p.append("svg").attr("viewBox", `0 0 ${W} ${h}`);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 90))).tickSizeOuter(0).tickFormat(d3.utcFormat("%-d %b")));
    if (xTitle) axisTitle(svg, (m.l + W - m.r) / 2, h - 5, xTitle);
    // eastward-propagation periods shaded behind every line panel (panel e in the paper)
    svg.append("g").selectAll("rect").data(s.eprop).join("rect").attr("class", "eprop-band")
      .attr("x", (e) => x(e.t0)).attr("width", (e) => Math.max(1, x(e.t1) - x(e.t0))).attr("y", m.t).attr("height", h - m.t - m.b);
    return { svg, x, W, m, h };
  };

  // ---- (b) longitude–time
  {
    const p = panel("p-hov", "b", outline ? "Longitude–time <span class=\"sub\">bars = east–west extent of the rain area</span>"
      : "Longitude–time <span class=\"sub\">circles = rain-area radius</span>");
    const extent = outline?.map((o) => { const l = o.rings.flat().map((c) => c[0]); return { t: o.t, lo: d3.min(l), hi: d3.max(l) }; })
      .filter((e) => e.lo !== undefined);
    const W = Math.max(260, p.node().clientWidth || 500), h = Math.round(Math.min(460, Math.max(260, s.duration_days * 7)));
    const m = { t: 8, r: 10, b: 38, l: 66 };
    const lo = (extent ? d3.min(extent, (e) => e.lo) : d3.min(tr, (q) => q.lon - rDeg(q))) - 3;
    const hi = (extent ? d3.max(extent, (e) => e.hi) : d3.max(tr, (q) => q.lon + rDeg(q))) + 3;
    const x = d3.scaleLinear().domain([lo, hi]).range([m.l, W - m.r]);
    const y = d3.scaleUtc().domain([s.t0, s.t1]).range([m.t, h - m.b]);
    const svg = p.append("svg").attr("viewBox", `0 0 ${W} ${h}`);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.floor(W / 70)).tickSizeOuter(0).tickFormat(fmtLon));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickSizeOuter(0).tickFormat(d3.utcFormat("%-d %b")));
    axisTitle(svg, (m.l + W - m.r) / 2, h - 5, "Longitude");
    axisTitle(svg, 12, (m.t + h - m.b) / 2, "Date (UTC)", -90);
    svg.append("g").selectAll("rect").data(s.eprop).join("rect").attr("class", "eprop-band")
      .attr("x", m.l).attr("width", W - m.l - m.r).attr("y", (e) => y(e.t0)).attr("height", (e) => Math.max(1, y(e.t1) - y(e.t0)));
    if (extent) {
      svg.append("g").selectAll("line").data(extent).join("line").attr("class", "extent-bar")
        .attr("x1", (e) => x(e.lo)).attr("x2", (e) => x(e.hi)).attr("y1", (e) => y(e.t)).attr("y2", (e) => y(e.t))
        .attr("stroke", (e) => tcol(e.t));
    } else {
      svg.append("g").selectAll("circle").data(tr.filter((q, i) => i % 2 === 0)).join("circle").attr("class", "foot foot-hov")
        .attr("cx", (q) => x(q.lon)).attr("cy", (q) => y(q.t)).attr("r", (q) => Math.min(40, (x(q.lon + rDeg(q)) - x(q.lon)) * 0.35))
        .attr("stroke", (q) => tcol(q.t));
    }
    svg.append("g").selectAll("line").data(tr.slice(1).map((q, i) => [tr[i], q])).join("line")
      .attr("class", ([q]) => `det-seg ${inEprop(q.t) ? "east" : "west"}`)
      .attr("x1", ([a]) => x(a.lon)).attr("y1", ([a]) => y(a.t)).attr("x2", ([, b]) => x(b.lon)).attr("y2", ([, b]) => y(b.t));
  }

  // ---- (c) centroid longitude
  {
    const p = panel("p-lon", "c", "Centroid longitude");
    const { svg, x, W, m, h } = small(p, 170);
    axisTitle(svg, 12, (m.t + h - m.b) / 2, "Longitude", -90);
    const y = d3.scaleLinear().domain(d3.extent(tr, (q) => q.lon)).nice().range([h - m.b, m.t]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(fmtLon));
    svg.append("g").selectAll("line").data(tr.slice(1).map((q, i) => [tr[i], q])).join("line")
      .attr("class", ([q]) => `det-seg ${inEprop(q.t) ? "east" : "west"}`)
      .attr("x1", ([a]) => x(a.t)).attr("y1", ([a]) => y(a.lon)).attr("x2", ([, b]) => x(b.t)).attr("y2", ([, b]) => y(b.lon));
    hoverLine(svg, x, m, h, W, (t) => { const q = nearest(tr, t); return `<b>${fmtT(q.t)}</b><br>centroid ${fmtLon(q.lon)}`; });
  }

  // ---- (d) zonal speed
  {
    const p = panel("p-spd", "d", "Zonal speed <span class=\"sub\">eastward positive</span>");
    const { svg, x, W, m, h } = small(p, 170);
    axisTitle(svg, 12, (m.t + h - m.b) / 2, "Speed (m s⁻¹)", -90);
    const u = zonalSpeed(tr), L = 15;
    const y = d3.scaleLinear().domain([-L, L]).range([h - m.b, m.t]).clamp(true);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5));
    const area = d3.area().x((d) => x(d.t)).y0(y(0)).curve(d3.curveMonotoneX);
    svg.append("path").attr("class", "spd east").attr("d", area.y1((d) => y(Math.max(0, d.u)))(u));
    svg.append("path").attr("class", "spd west").attr("d", area.y1((d) => y(Math.min(0, d.u)))(u));
    svg.append("line").attr("class", "zero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
    hoverLine(svg, x, m, h, W, (t) => { const d = nearest(u, t); return `<b>${fmtT(d.t)}</b><br>${d.u >= 0 ? "eastward" : "westward"} ${Math.abs(d.u).toFixed(1)} m/s`; });
  }

  // ---- (e) propagation
  {
    const p = panel("p-prop", "e", "Propagation <span class=\"sub\">from the LPT MJO list</span>");
    const { svg, x, m, h } = small(p, 80, "Date (UTC)");
    svg.selectAll(".eprop-band").attr("class", "eprop-band strong");
    svg.append("text").attr("x", m.l - 6).attr("y", (h - m.b + m.t) / 2).attr("dy", "0.35em").attr("text-anchor", "end").text("East");
    svg.selectAll(".eprop-band").each(function (e) {
      d3.select(this).on("mousemove", (ev) => showTip(ev, `<b>Eastward propagation</b><br>${fmtDay(e.t0)} – ${fmtDay(e.t1)} (${e.days} d)<br>${fmtLon(e.lon_begin)} → ${fmtLon(e.lon_end)} at ${e.speed_ms} m/s`))
        .on("mouseleave", hideTip);
    });
    p.append("div").attr("class", "legend").html(
      '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line class="det-seg east" x1="2" y1="7" x2="26" y2="7"/></svg>eastward-propagation period</span>' +
      '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line class="det-seg west" x1="2" y1="7" x2="26" y2="7"/></svg>rest of the system\'s life</span>');
  }

  const src = data.lptSrc;
  card.append("p").attr("class", "caption").html(
    `LPT MJO system ${s.lpt_index} (${src.label}), ${fmtDay(s.t0)} – ${fmtDay(s.t1)} (${Math.round(s.duration_days)} days), laid out after ` +
    `Kerns &amp; Chen (2020, Fig. 1). ` +
    (outline
      ? `(a) Edges of the system's rain area every 6 h, from its LPT mask file, coloured by date, with the centroid track; the open circle marks the start. ` +
        `(b) Longitude–time track of the centroid, red during eastward propagation and blue otherwise; bars span the rain area's east–west extent. `
      : `(a) Rain-area footprints every 6 h, coloured by date and drawn as circles of equal area (not the system's real shape${src.outlines ? "; its outline has not been extracted yet" : "; real outlines are available for the IMERG V7 database"}), with the centroid track; the open circle marks the start. ` +
        `(b) Longitude–time track of the centroid, red during eastward propagation and blue otherwise; circles are scaled to the rain-area radius. `) +
    `(c) Centroid longitude. (d) Zonal speed of the centroid (centred difference over ±12 h). (e) Eastward-propagation periods from the LPT ` +
    `MJO list: ${facts.join("; ")}. Light red shading in (b)–(d) marks the same periods.`);
}

function nearest(arr, t) { return d3.least(arr, (d) => Math.abs(d.t - t)); }

function hoverLine(svg, x, m, h, W, html) {
  const ln = svg.append("line").attr("class", "hover-rule").attr("y1", m.t).attr("y2", h - m.b).style("display", "none");
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove click", (ev) => {
      const t = x.invert(d3.pointer(ev)[0]);
      ln.style("display", null).attr("x1", x(t)).attr("x2", x(t));
      showTip(ev, html(t));
    })
    .on("mouseleave", () => { ln.style("display", "none"); hideTip(); });
}
