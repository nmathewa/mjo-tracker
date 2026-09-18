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

function svgIn(sel, w, h) {
  const root = d3.select(sel);
  root.selectAll("*").remove();
  return root.append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("preserveAspectRatio", "xMidYMid meet");
}

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
  const W = 1200, H = 92, m = { t: 6, r: 8, b: 20, l: 30 };
  const svg = svgIn(sel, W, H);
  const days = data.days;
  const x = d3.scaleUtc().domain([days[0].date, addDays(days.at(-1).date, 1)]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, 4]).range([H - m.b - 14, m.t]).clamp(true);

  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(d3.utcYear.every(5)).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(2).tickSize(3));
  svg.append("line").attr("class", "amp-line1").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(1)).attr("y2", y(1));
  svg.append("path").attr("class", "amp-area rmm-only")
    .attr("d", d3.area().defined((d) => d.amp !== null).x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.amp)).curve(d3.curveStep)(days));
  svg.append("g").attr("class", "lpt-only").selectAll("line").data(data.lpt).join("line")
    .attr("class", "lpt-tick").attr("x1", (d) => x(d.t0)).attr("x2", (d) => Math.max(x(d.t1), x(d.t0) + 1))
    .attr("y1", H - m.b - 6).attr("y2", H - m.b - 6);

  const brush = d3.brushX().extent([[m.l, m.t], [W - m.r, H - m.b]])
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
  return { x };
}

// ---------------------------------------------------------------- hovmöller
export function drawHovmoller(sel, data, state) {
  const nDays = Math.round((state.t1 - state.t0) / DAY_MS);
  const W = 720, H = Math.max(380, Math.min(900, nDays * 4)), m = { t: 36, r: 12, b: 26, l: 70 };
  const svg = svgIn(sel, W, H);
  const x = d3.scaleLinear().domain([0, 360]).range([m.l, W - m.r]);
  const y = d3.scaleUtc().domain([state.t0, state.t1]).range([m.t, H - m.b]);

  svg.append("g").selectAll("rect").data(REGIONS.filter((_, i) => i % 2 === 1)).join("rect")
    .attr("class", "region-band").attr("x", (d) => x(d.lon[0])).attr("width", (d) => x(d.lon[1]) - x(d.lon[0]))
    .attr("y", m.t).attr("height", H - m.t - m.b);
  svg.append("g").selectAll("text").data(REGIONS).join("text").attr("class", "region")
    .attr("x", (d) => x((d.lon[0] + d.lon[1]) / 2)).attr("y", (d, i) => m.t - 6 - (i % 2) * 11).text((d) => d.name);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).tickValues(d3.range(0, 361, 60)).tickFormat((d) => `${d > 180 ? 360 - d : d}°${d === 0 || d === 180 || d === 360 ? "" : d > 180 ? "W" : "E"}`));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(8).tickFormat(d3.utcFormat("%-d %b %y")));

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
  guide.append("line").attr("x1", x(lon0)).attr("y1", y(t0)).attr("x2", x(lon0 + sp * (tEnd - t0) / DAY_MS)).attr("y2", y(tEnd))
    .attr("stroke", "currentColor").attr("stroke-dasharray", "2 4").style("color", "var(--muted)");
  guide.append("text").attr("x", x(lon0 + sp * (tEnd - t0) / DAY_MS) + 4).attr("y", y(tEnd)).text("5 m/s");

  if (!rmmDays.length && !sys.length) {
    svg.append("text").attr("class", "empty").attr("x", W / 2).attr("y", H / 2).text("No active MJO in this window");
  }
}

// ---------------------------------------------------------------- phase diagram
export function drawPhase(sel, data, state) {
  const S = 420, m = 28, R = 4;
  const svg = svgIn(sel, S, S);
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
  if (!pts.length) return;
  const col = d3.scaleSequential((t) => d3.interpolateViridis(0.1 + 0.8 * t)).domain([0, pts.length - 1]);
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
    .attr("x", (d) => s(d.rmm1) + 5).attr("y", (d) => sy(d.rmm2) - 4).text((d) => d3.utcFormat("%b")(d.date));
  g.selectAll("circle.m").data(firsts).join("circle").attr("class", "m").attr("r", 2.5)
    .attr("cx", (d) => s(d.rmm1)).attr("cy", (d) => sy(d.rmm2)).attr("fill", "var(--ink)");
  g.append("circle").attr("class", "traj-start").attr("r", 4.5).attr("cx", s(pts[0].rmm1)).attr("cy", sy(pts[0].rmm2));
  g.append("circle").attr("class", "traj-end").attr("r", 4.5).attr("cx", s(pts.at(-1).rmm1)).attr("cy", sy(pts.at(-1).rmm2));
}

// ---------------------------------------------------------------- map
export function drawMap(sel, data, state) {
  const LAT = 35, W = 1200, H = Math.round(W * 2 * LAT / 360);
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
    svg.append("text").attr("class", "empty").attr("x", W / 2).attr("y", H / 2).text(msg);
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
