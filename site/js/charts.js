// The five views. Each draw function clears its container and redraws from
// (data, state); state = { t0, t1, methods: Set }. Marks carry data-id so
// hovering one highlights the same event everywhere (see main.js).
import { addDays, DAY_MS, fmtDay, fmtRange, phaseLon, PHASE_REGION, REGIONS } from "./data.js";

const tip = document.getElementById("tip");
export function showTip(ev, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
export function hideTip() { tip.hidden = true; }

// Charts are drawn at the container's CSS pixel width, so 11px text stays 11px on a
// phone; main.js redraws on resize.
function widthOf(sel, fallback) {
  const w = d3.select(sel).node().clientWidth;
  return w > 0 ? Math.round(w) : fallback;
}

function svgIn(sel, w, h) {
  const root = d3.select(sel);
  root.selectAll("*").remove();
  return root.append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");
}

// Centered message, wrapped to the available width (≈6.5px per character at 13px).
function emptyText(svg, x, y, width, msg) {
  const maxCh = Math.max(16, Math.floor(width / 6.8));
  const lines = [];
  for (const w of msg.split(" ")) {
    const l = lines.at(-1);
    if (l !== undefined && (l + " " + w).length <= maxCh) lines[lines.length - 1] = l + " " + w;
    else lines.push(w);
  }
  const t = svg.append("text").attr("class", "empty halo").attr("x", x).attr("y", y - (lines.length - 1) * 9);
  lines.forEach((l, i) => t.append("tspan").attr("x", x).attr("dy", i ? 18 : 0).text(l));
}

// HTML legend under a chart. items: [{ swatch: svg-markup, label: html, cls }]
function legend(sel, items) {
  const div = d3.select(sel).append("div").attr("class", "legend");
  for (const it of items) {
    const row = div.append("span").attr("class", `key ${it.cls ?? ""}`);
    if (it.swatch) row.append("svg").attr("class", "sw").attr("viewBox", "0 0 28 14").attr("aria-hidden", "true").html(it.swatch);
    row.append("span").html(it.label);
  }
  return div;
}

const isDark = () => getComputedStyle(document.documentElement).colorScheme.includes("dark");

function inWindow(a0, a1, s) { return a1 > s.t0 && a0 < s.t1; }

function describe(item) {
  if (item.method === "rmm") {
    return `<b>RMM event</b><br>${fmtRange(item.t0, addDays(item.t1, -1))} (${item.days} d)<br>` +
      `phase ${item.start_phase} → ${item.end_phase}, max amplitude ${item.max_amp}<br>` +
      `~${item.period_days}-day period`;
  }
  return `<b>LPT system ${item.lpt_index}</b><br>${fmtRange(item.t0, item.t1)} (${Math.round(item.duration_days)} d)<br>` +
    item.eprop.map((e) => `east ${e.lon_begin}°→${e.lon_end}°E at ${e.speed_ms} m/s`).join("<br>");
}
export { describe };

// ---------------------------------------------------------------- timeline
export function drawTimeline(sel, data, state, onBrush) {
  const W = widthOf(sel, 1200), narrow = W < 600;
  const m = { t: 14, r: 8, b: 20, l: 34 };
  const yLpt = 76, H = yLpt + 10 + m.b;
  const svg = svgIn(sel, W, H);
  const days = data.days;
  const x = d3.scaleUtc().domain([days[0].date, addDays(days.at(-1).date, 1)]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 3]).range([yLpt - 12, m.t]).clamp(true);

  // RMM amplitude, averaged into bins about 5px wide so 47 years read as a smooth band
  const binDays = Math.max(1, Math.round(days.length / ((W - m.l - m.r) / 5)));
  const bins = [];
  for (let i = 0; i < days.length; i += binDays) {
    const v = days.slice(i, i + binDays).filter((d) => d.amp !== null);
    bins.push({ date: days[Math.min(i + (binDays >> 1), days.length - 1)].date, amp: v.length ? d3.mean(v, (d) => d.amp) : null });
  }

  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(d3.utcYear.every(narrow ? 10 : 5)).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).tickValues([0, 1, 2]).tickFormat(d3.format("d")).tickSize(3));
  svg.append("line").attr("class", "amp-line1").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1)).attr("y2", y(1));
  const gR = svg.append("g").attr("class", "rmm-only");
  gR.append("path").attr("class", "amp-area")
    .attr("d", d3.area().defined((d) => d.amp !== null).x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.amp)).curve(d3.curveMonotoneX)(bins));
  gR.append("path").attr("class", "amp-top")
    .attr("d", d3.line().defined((d) => d.amp !== null).x((d) => x(d.date)).y((d) => y(d.amp)).curve(d3.curveMonotoneX)(bins));
  gR.append("text").attr("class", "row-label").attr("x", m.l + 4).attr("y", m.t - 4)
    .text(`RMM amplitude · ${binDays}-day mean`);

  // LPT coverage row: one tick per tracked system
  const gL = svg.append("g").attr("class", "lpt-only");
  gL.append("text").attr("class", "row-label").attr("x", m.l - 5).attr("y", yLpt).attr("dy", "0.35em")
    .attr("text-anchor", "end").text("LPT");
  gL.selectAll("line").data(data.lpt).join("line")
    .attr("class", "lpt-tick").attr("x1", (d) => x(d.t0)).attr("x2", (d) => Math.max(x(d.t1), x(d.t0) + 1))
    .attr("y1", yLpt).attr("y2", yLpt);
  const [l0, l1] = d3.extent(data.lpt.flatMap((d) => [d.t0, d.t1]));
  const xEnd = x(l1) + 6, cov = `systems ${l0.getUTCFullYear()}–${l1.getUTCFullYear()}`;
  if (xEnd + cov.length * 6 < W - m.r) {
    gL.append("text").attr("class", "row-label").attr("x", xEnd).attr("y", yLpt).attr("dy", "0.35em").text(cov);
  }

  const brush = d3.brushX().extent([[m.l, m.t], [W - m.r, yLpt + 6]])
    .on("end", (ev) => {
      if (!ev.sourceEvent) return;
      if (!ev.selection) { // a click: centre the current window length there
        const len = state.t1 - state.t0;
        const c = x.invert(d3.pointer(ev.sourceEvent, svg.node())[0]);
        return onBrush(new Date(c - len / 2), new Date(+c + len / 2));
      }
      const [a, b] = ev.selection.map(x.invert);
      onBrush(a, b);
    });
  const g = svg.append("g").attr("class", "brush").call(brush);
  g.call(brush.move, [x(state.t0), x(state.t1)]);
  g.select(".selection").attr("rx", 2);
  // a caret above the window, so a narrow selection is still easy to find
  const cx = (x(state.t0) + x(state.t1)) / 2;
  svg.append("path").attr("class", "win-caret").attr("d", `M${cx - 5},${m.t - 9}h10l-5,6z`);
  return { x };
}

// ---------------------------------------------------------------- hovmöller
export function drawHovmoller(sel, data, state) {
  const nDays = Math.round((state.t1 - state.t0) / DAY_MS);
  const W = widthOf(sel, 720), narrow = W < 560;
  const H = Math.max(380, Math.min(900, nDays * 4)), m = { t: 24, r: narrow ? 14 : 16, b: 26, l: narrow ? 54 : 64 };
  const svg = svgIn(sel, W, H);
  const x = d3.scaleLinear().domain([0, 360]).range([m.l, W - m.r]);
  const y = d3.scaleUtc().domain([state.t0, state.t1]).range([m.t, H - m.b]);

  svg.append("g").selectAll("rect").data(REGIONS.filter((_, i) => i % 2 === 1)).join("rect")
    .attr("class", "region-band").attr("x", (d) => x(d.lon[0])).attr("width", (d) => x(d.lon[1]) - x(d.lon[0]))
    .attr("y", m.t).attr("height", H - m.t - m.b);
  // one row of region names; abbreviate any that would not fit their band
  const ABBR = { "Africa": "Afr", "Indian Ocean": "IO", "Maritime Cont.": "MC", "W. Pacific": "WP", "E. Pacific": "EP", "Americas / Atl.": "Atl" };
  const fits = (d) => d.name.length * 6.2 + 6 < x(d.lon[1]) - x(d.lon[0]);
  const useShort = !REGIONS.every(fits);
  svg.append("g").selectAll("text").data(REGIONS).join("text").attr("class", "region")
    .attr("x", (d) => x((d.lon[0] + d.lon[1]) / 2)).attr("y", m.t - 8)
    .text((d) => (useShort && !fits(d) ? ABBR[d.name] : d.name))
    .append("title").text((d) => d.name);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).tickValues(d3.range(0, 361, 60)).tickFormat((d) => `${d > 180 ? 360 - d : d}°${d === 0 || d === 180 || d === 360 ? "" : d > 180 ? "W" : "E"}`));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(Math.round(H / 60)).tickFormat(d3.utcFormat("%-d %b %y")));

  svg.append("clipPath").attr("id", "hov-clip").append("rect")
    .attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b);
  const plot = svg.append("g").attr("clip-path", "url(#hov-clip)");

  // RMM: active days at the approximate longitude of their phase
  const rmmDays = data.days.filter((d) => d.date >= state.t0 && d.date < state.t1 && d.amp !== null && d.amp >= 1);
  const gR = plot.append("g").attr("class", "rmm-only");
  const segs = [];
  let cur = [];
  for (const d of rmmDays) {
    const prev = cur.at(-1);
    if (prev && (d.date - prev.date > DAY_MS || Math.abs(phaseLon(d.angle) - phaseLon(prev.angle)) > 120)) {
      segs.push(cur); cur = [];
    }
    cur.push(d);
  }
  if (cur.length) segs.push(cur);
  gR.selectAll("path").data(segs).join("path").attr("class", "rmm-path")
    .attr("d", d3.line().x((d) => x(phaseLon(d.angle))).y((d) => y(d.date)));
  gR.selectAll("circle").data(rmmDays).join("circle").attr("class", "rmm-dot mark")
    .attr("data-id", (d) => d.event).attr("cx", (d) => x(phaseLon(d.angle))).attr("cy", (d) => y(d.date))
    .attr("r", (d) => 1.2 + 1.3 * Math.min(d.amp, 3.5))
    .on("mousemove", (ev, d) => showTip(ev, `<b>${fmtDay(d.date)}</b><br>RMM phase ${d.phase} (${PHASE_REGION[d.phase]})<br>amplitude ${d.amp.toFixed(2)}`))
    .on("mouseleave", hideTip);

  // LPT: full track (thin) and eastward-propagation segments (thick)
  const sys = data.lpt.filter((s) => inWindow(s.t0, s.t1, state));
  const gL = plot.append("g").attr("class", "lpt-only");
  gL.selectAll("path").data(sys.filter((s) => s.track)).join("path").attr("class", "lpt-track mark")
    .attr("data-id", (s) => s.id).attr("d", (s) => d3.line().x((p) => x(p.lon)).y((p) => y(p.t))(s.track));
  gL.selectAll("g").data(sys).join("g").attr("class", "mark").attr("data-id", (s) => s.id)
    .on("mousemove", (ev, s) => showTip(ev, describe(s))).on("mouseleave", hideTip)
    .selectAll("line").data((s) => s.eprop).join("line").attr("class", "lpt-seg")
    .attr("x1", (e) => x(e.lon_begin)).attr("y1", (e) => y(e.t0))
    .attr("x2", (e) => x(e.lon_end)).attr("y2", (e) => y(e.t1));

  // speed guide: 5 m/s from the top-left of the Indian Ocean
  const lon0 = 60, t0 = addDays(state.t0, 2), sp = 5 * 86400 / 111e3; // deg/day
  const tEnd = addDays(t0, Math.min(nDays - 4, 30));
  const guide = svg.append("g");
  guide.append("line").attr("class", "guide").attr("x1", x(lon0)).attr("y1", y(t0)).attr("x2", x(lon0 + sp * (tEnd - t0) / DAY_MS)).attr("y2", y(tEnd));
  guide.append("text").attr("class", "halo").attr("x", x(lon0 + sp * (tEnd - t0) / DAY_MS) + 4).attr("y", y(tEnd)).attr("dy", "0.35em").text("5 m/s");

  if (!rmmDays.length && !sys.length) {
    emptyText(svg, (m.l + W - m.r) / 2, (m.t + H - m.b) / 2, W - m.l - m.r, "No active MJO in this window");
  }

  const nTrack = sys.filter((s) => s.track).length;
  legend(sel, [
    { cls: "lpt-only", swatch: '<line class="lpt-seg" x1="3" y1="3" x2="25" y2="11"/>', label: "LPT eastward segment" },
    { cls: "lpt-only", swatch: '<path class="lpt-track" d="M3 3c6 2 4 6 10 5s6 4 12 3"/>',
      label: `LPT full track <span class="dim">(loaded for Jun 2011 – Jun 2012 only${sys.length && !nTrack ? "; none here" : ""})</span>` },
    { cls: "rmm-only", swatch: '<circle class="rmm-dot" cx="5" cy="7" r="2.5"/><circle class="rmm-dot" cx="13" cy="7" r="3.8"/><circle class="rmm-dot" cx="23" cy="7" r="5"/>',
      label: "RMM day, amplitude ≥ 1 <span class=\"dim\">(size = amplitude; approximate longitude)</span>" },
    { swatch: '<line class="guide" x1="3" y1="3" x2="25" y2="11"/>', label: "5 m/s eastward reference" },
  ]);
}

// ---------------------------------------------------------------- phase diagram
export function drawPhase(sel, data, state) {
  const S = Math.min(widthOf(sel, 420), 480), m = 28, R = 4;
  const svg = svgIn(sel, S, S).style("max-width", `${S}px`);
  const s = d3.scaleLinear().domain([-R, R]).range([m, S - m]);
  const sy = d3.scaleLinear().domain([-R, R]).range([S - m, m]);
  const c = s(0), unit = s(1) - s(0);

  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4;
    svg.append("line").attr("class", "sector")
      .attr("x1", c - R * unit * Math.cos(a)).attr("y1", c + R * unit * Math.sin(a))
      .attr("x2", c + R * unit * Math.cos(a)).attr("y2", c - R * unit * Math.sin(a));
  }
  svg.append("rect").attr("class", "frame").attr("x", m).attr("y", m).attr("width", S - 2 * m).attr("height", S - 2 * m);
  svg.append("circle").attr("class", "circle1").attr("cx", c).attr("cy", c).attr("r", unit);
  for (let k = 1; k <= 8; k++) {
    const a = (-180 + 45 * (k - 1) + 22.5) * Math.PI / 180, r = 3.5 * unit;
    svg.append("text").attr("class", "phase-num").attr("x", c + r * Math.cos(a)).attr("y", c - r * Math.sin(a)).text(k);
  }
  const lab = [["Indian Ocean", c, S - m + 16], ["Western Pacific", c, m - 10],
    ["Maritime Continent", S - m + 12, c], ["W. Hem. & Africa", m - 12, c]];
  lab.forEach(([t, x, y], i) => {
    const el = svg.append("text").attr("class", "region").attr("x", x).attr("y", y).text(t);
    if (i >= 2) el.attr("transform", `rotate(${i === 2 ? 90 : -90},${x},${y})`);
  });
  svg.append("text").attr("x", S - m - 4).attr("y", c - 4).attr("text-anchor", "end").text("RMM1");
  svg.append("text").attr("x", c + 4).attr("y", m + 12).text("RMM2");

  const pts = data.days.filter((d) => d.date >= state.t0 && d.date < state.t1 && d.amp !== null);
  if (!pts.length) {
    emptyText(svg, c, c + 40, S - 2 * m, "No RMM data in this window");
    return;
  }
  // time runs along viridis; trimmed so both ends keep contrast on the card
  const [v0, v1] = isDark() ? [0.3, 1] : [0.05, 0.8];
  const vir = (t) => d3.interpolateViridis(v0 + (v1 - v0) * t);
  const col = d3.scaleSequential(vir).domain([0, pts.length - 1]);
  const g = svg.append("g").attr("class", "rmm-only");
  g.selectAll("line").data(pts.slice(1)).join("line").attr("class", "traj mark")
    .attr("data-id", (d) => d.event)
    .attr("x1", (d, i) => s(pts[i].rmm1)).attr("y1", (d, i) => sy(pts[i].rmm2))
    .attr("x2", (d) => s(d.rmm1)).attr("y2", (d) => sy(d.rmm2)).attr("stroke", (d, i) => col(i));
  g.selectAll("circle.day").data(pts).join("circle").attr("class", "day").attr("r", 5).attr("fill", "transparent")
    .attr("cx", (d) => s(d.rmm1)).attr("cy", (d) => sy(d.rmm2))
    .on("mousemove", (ev, d) => showTip(ev, `<b>${fmtDay(d.date)}</b><br>phase ${d.phase}, amplitude ${d.amp.toFixed(2)}`))
    .on("mouseleave", hideTip);
  // label the first of each month
  const firsts = pts.filter((d) => d.date.getUTCDate() === 1);
  g.selectAll("text.month").data(firsts).join("text").attr("class", "month")
    .attr("class", "month halo").attr("x", (d) => s(d.rmm1) + 5).attr("y", (d) => sy(d.rmm2) - 4).text((d) => d3.utcFormat("%b")(d.date));
  g.selectAll("circle.m").data(firsts).join("circle").attr("class", "m").attr("r", 2.5)
    .attr("cx", (d) => s(d.rmm1)).attr("cy", (d) => sy(d.rmm2)).attr("fill", "var(--ink)");
  g.append("circle").attr("class", "traj-start").attr("r", 5).attr("cx", s(pts[0].rmm1)).attr("cy", sy(pts[0].rmm2))
    .attr("stroke", col(0));
  g.append("circle").attr("class", "traj-end").attr("r", 5).attr("cx", s(pts.at(-1).rmm1)).attr("cy", sy(pts.at(-1).rmm2))
    .attr("fill", col(pts.length - 1));

  const stops = d3.range(0, 1.01, 0.25).map((t) => `<stop offset="${t}" stop-color="${vir(t)}"/>`).join("");
  const key = d3.select(sel).append("div").attr("class", "legend time-key rmm-only");
  key.append("span").attr("class", "key").html(
    `<svg class="sw" viewBox="0 0 14 14" aria-hidden="true"><circle class="traj-start" cx="7" cy="7" r="4.5" stroke="${vir(0)}"/></svg>` +
    `<span>start <b>${fmtDay(pts[0].date)}</b></span>`);
  key.append("svg").attr("class", "ramp").attr("viewBox", "0 0 100 8").attr("preserveAspectRatio", "none").attr("aria-hidden", "true")
    .html(`<defs><linearGradient id="ph-ramp">${stops}</linearGradient></defs><rect width="100" height="8" rx="4" fill="url(#ph-ramp)"/>`);
  key.append("span").attr("class", "key").html(
    `<span>end <b>${fmtDay(pts.at(-1).date)}</b></span>` +
    `<svg class="sw" viewBox="0 0 14 14" aria-hidden="true"><circle class="traj-end" cx="7" cy="7" r="4.5" fill="${vir(1)}"/></svg>`);
}

// ---------------------------------------------------------------- map
export function drawMap(sel, data, state) {
  const LAT = 35, W = widthOf(sel, 1200), H = Math.round(W * 2 * LAT / 360);
  const svg = svgIn(sel, W, H);
  // equirectangular, 0°–360°E across the width, ±LAT tall
  const proj = d3.geoEquirectangular().rotate([-180, 0]).scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  const path = d3.geoPath(proj);
  const land = topojson.feature(data.land, data.land.objects.land);
  svg.append("clipPath").attr("id", "map-clip").append("rect").attr("width", W).attr("height", H);
  const g0 = svg.append("g").attr("clip-path", "url(#map-clip)");
  g0.append("path").attr("class", "gridline").attr("fill", "none").attr("d", path(d3.geoGraticule().step([30, 10])()));
  g0.append("path").attr("class", "land").attr("d", path(land));
  svg.append("rect").attr("class", "frame").attr("width", W).attr("height", H);

  const sys = data.lpt.filter((s) => s.track && inWindow(s.t0, s.t1, state));
  const g = g0.append("g").attr("class", "lpt-only");
  const pxy = (p) => proj([p.lon, p.lat]);
  g.selectAll("path").data(sys).join("path").attr("class", "lpt-map mark").attr("data-id", (s) => s.id)
    .attr("d", (s) => d3.line().x((p) => pxy(p)[0]).y((p) => pxy(p)[1]).curve(d3.curveCatmullRom)(s.track))
    .on("mousemove", (ev, s) => showTip(ev, describe(s))).on("mouseleave", hideTip);
  g.selectAll("circle").data(sys).join("circle").attr("class", "lpt-start").attr("r", 4)
    .attr("cx", (s) => pxy(s.track[0])[0]).attr("cy", (s) => pxy(s.track[0])[1]);

  if (!sys.length) {
    const nIn = data.lpt.filter((s) => inWindow(s.t0, s.t1, state)).length;
    const msg = nIn
      ? `${nIn} LPT system${nIn > 1 ? "s" : ""} in this window, but full centroid tracks are only loaded for Jun 2011 – Jun 2012`
      : "No LPT systems in this window (LPT catalogue covers 1998–2018)";
    emptyText(svg, W / 2, H / 2, W - 24, msg);
  }
}

// ---------------------------------------------------------------- list
export function drawList(sel, data, state, onPick) {
  const items = [
    ...data.rmmEvents.filter((e) => state.methods.has("rmm") && inWindow(e.t0, e.t1, state)),
    ...data.lpt.filter((s) => state.methods.has("lpt") && inWindow(s.t0, s.t1, state)),
  ].sort((a, b) => a.t0 - b.t0);
  const ul = d3.select(sel);
  ul.selectAll("*").remove();
  if (!items.length) {
    ul.append("li").attr("class", "none").text("No events from the selected methods in this window.");
    return;
  }
  const li = ul.selectAll("li").data(items).join("li").attr("class", "mark").attr("data-id", (d) => d.id)
    .attr("tabindex", 0).attr("role", "button")
    .on("click", (ev, d) => onPick(d))
    .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(d); } });
  li.append("span").attr("class", (d) => `badge ${d.method}`).text((d) => d.method.toUpperCase());
  li.append("span").attr("class", "when").text((d) => fmtRange(d.t0, d.method === "rmm" ? addDays(d.t1, -1) : d.t1));
  li.append("span").attr("class", "meta").text((d) => d.method === "rmm"
    ? `${d.days} d · phase ${d.start_phase}→${d.end_phase} · max amp ${d.max_amp}`
    : `${Math.round(d.duration_days)} d · ${d.eprop.map((e) => `${Math.round(e.lon_begin)}°→${Math.round(e.lon_end)}°E`).join(", ")}${d.track ? " · track" : ""}`);
}
