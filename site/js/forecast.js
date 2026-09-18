// Experimental analog forecast of one MJO LPT system, computed in the browser.
// For a start time on a system's track, the K most similar starts from OTHER seasons (position,
// recent motion, rain area, RMM state, time of year) are found, and their next 15 days, moved to
// the current position, form the ensemble. Same method as the "analogs" baseline in mjopredict.
import { DAY_MS, fmtDay } from "./data.js";
import { axisTitle, showTip, hideTip } from "./charts.js";

const K = 50, T = 60, MIN_HIST = 9, MC_LON = 150;   // MIN_HIST: 2-day motion needs 8 steps back
const libs = {};
const ui = { id: null, i: null };
const fmtT = d3.utcFormat("%-d %b %Y %H UTC");
const fmtLon = (l) => { l = ((Math.round(l) % 360) + 360) % 360; return l === 0 || l === 180 ? `${l}°` : l < 180 ? `${l}°E` : `${360 - l}°W`; };
const season = (t) => (t.getUTCMonth() >= 5 ? t.getUTCFullYear() : t.getUTCFullYear() - 1);

function prep(s) {
  if (s._u) return;
  let prev;
  s._u = s.track.map((p) => {
    let l = p.lon;
    if (prev !== undefined) { while (l - prev > 180) l -= 360; while (l - prev < -180) l += 360; }
    return (prev = l);
  });
  s._season = season(s.t0);
}

function rmmContext(days, t) {
  const k = Math.floor((t - days[0].date) / DAY_MS) - 1;      // day before t: no look-ahead
  const w = days.slice(Math.max(0, k - 9), k + 1).map((d) => [d.rmm1 ?? 0, d.rmm2 ?? 0]);
  if (!w.length) return [0, 0, 0, 1, 0, 0];
  const [r1, r2] = w.at(-1), ang = w.map(([a, b]) => Math.atan2(b, a));
  let dph = 0;
  for (let j = 1; j < ang.length; j++) { let d = ang[j] - ang[j - 1]; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; dph += d; }
  return [r1, r2, Math.hypot(r1, r2), Math.cos(ang.at(-1)), Math.sin(ang.at(-1)), dph / Math.max(1, ang.length - 1)];
}

function features(s, i, days) {
  const u = s._u, tr = s.track, t = tr[i].t, rad = (u[i] * Math.PI) / 180;
  const doy = (2 * Math.PI * ((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS)) / 365.25;
  return [Math.sin(rad), Math.cos(rad), tr[i].lat / 10, u[i] - u[i - 4], u[i] - u[i - 8], tr[i].lat - tr[i - 8].lat,
    Math.log(Math.max(tr[i].area / 1e3, 1)), ...rmmContext(days, t), Math.sin(doy), Math.cos(doy)];
}

function library(data) {
  const key = data.lptSrc.id;
  if (libs[key]) return libs[key];
  const rows = [], feats = [];
  data.lpt.forEach((s) => {
    if (!s.track) return;
    prep(s);
    for (let i = MIN_HIST - 1; i < s.track.length - 1; i++) { rows.push([s, i]); feats.push(features(s, i, data.days)); }
  });
  const F = feats[0].length, mu = new Array(F).fill(0), sd = new Array(F).fill(0);
  feats.forEach((f) => f.forEach((v, j) => { mu[j] += v / feats.length; }));
  feats.forEach((f) => f.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / feats.length; }));
  for (let j = 0; j < F; j++) sd[j] = Math.sqrt(sd[j]) + 1e-6;
  const X = new Float32Array(feats.length * F);
  feats.forEach((f, r) => f.forEach((v, j) => { X[r * F + j] = (v - mu[j]) / sd[j]; }));
  return (libs[key] = { rows, X, F, mu, sd });
}

export function analogForecast(data, s, i) {
  const lib = library(data), { F, X } = lib;
  prep(s);
  const q = features(s, i, data.days).map((v, j) => (v - lib.mu[j]) / lib.sd[j]);
  const dist = new Float32Array(lib.rows.length);
  for (let r = 0; r < lib.rows.length; r++) {
    if (lib.rows[r][0]._season === s._season) { dist[r] = Infinity; continue; }   // other seasons only
    let d = 0;
    for (let j = 0; j < F; j++) { const e = X[r * F + j] - q[j]; d += e * e; }
    dist[r] = d;
  }
  const idx = Array.from(dist.keys()).sort((a, b) => dist[a] - dist[b]).slice(0, K);
  return idx.map((r) => {
    const [s2, i2] = lib.rows[r], u = s2._u, tr = s2.track;
    const m = { dx: [0], dy: [0], alive: [true], from: s2, t0: tr[i2].t };
    for (let k = 1; k <= T; k++) {
      const j = Math.min(i2 + k, tr.length - 1);
      m.dx.push(u[j] - u[i2]); m.dy.push(tr[j].lat - tr[i2].lat); m.alive.push(i2 + k < tr.length);
    }
    return m;
  });
}

function quantile(a, p) { const s = [...a].sort((x, y) => x - y); const h = (s.length - 1) * p, l = Math.floor(h); return s[l] + (s[Math.min(l + 1, s.length - 1)] - s[l]) * (h - l); }

// ---------------------------------------------------------------------- drawing
export function drawForecast(sel, data, state) {
  const root = d3.select(sel);
  root.selectAll("*").remove();
  const inWin = data.lpt.filter((s) => s.track && s.track.length > MIN_HIST && s.t1 > state.t0 && s.t0 < state.t1);
  if (!state.methods.has("lpt") || !inWin.length) {
    root.append("p").attr("class", "empty-line").text(state.methods.has("lpt")
      ? "No MJO LPT systems in this window to forecast. Choose a window with LPT tracks."
      : "LPT tracking is switched off.");
    return;
  }
  let s = inWin.find((x) => x.id === ui.id);
  if (!s) { s = inWin.at(-1); ui.i = null; }
  if (ui.i == null) {  // default start: where the eastward (MJO) propagation begins
    const e = s.eprop[0]?.t0;
    ui.i = e ? d3.bisector((p) => p.t).left(s.track, e) : MIN_HIST - 1;
  }
  ui.id = s.id;
  ui.i = Math.max(MIN_HIST - 1, Math.min(ui.i ?? MIN_HIST - 1, s.track.length - 2));
  prep(s);

  // ---- controls
  const bar = root.append("div").attr("class", "fc-bar");
  const pick = bar.append("label").attr("class", "fc-pick").text("System ");
  const selEl = pick.append("select").attr("id", "fc-system");
  selEl.selectAll("option").data(inWin).join("option").attr("value", (x) => x.id)
    .property("selected", (x) => x.id === s.id)
    .text((x) => `LPT ${x.lpt_index} · ${fmtDay(x.t0)} – ${fmtDay(x.t1)}`);
  selEl.on("change", (ev) => { ui.id = ev.target.value; ui.i = null; drawForecast(sel, data, state); });
  const st = bar.append("div").attr("class", "fc-start");
  const back = st.append("button").attr("type", "button").attr("aria-label", "One day earlier").text("◀");
  const slider = st.append("input").attr("type", "range").attr("id", "fc-start")
    .attr("min", MIN_HIST - 1).attr("max", s.track.length - 2).attr("step", 1).property("value", ui.i)
    .attr("aria-label", "Forecast start time");
  const fwd = st.append("button").attr("type", "button").attr("aria-label", "One day later").text("▶");
  const lab = st.append("output").attr("class", "fc-when");
  const step = (d) => { ui.i = Math.max(MIN_HIST - 1, Math.min(s.track.length - 2, ui.i + d)); slider.property("value", ui.i); update(); };
  back.on("click", () => step(-4));
  fwd.on("click", () => step(4));
  slider.on("input", (ev) => { ui.i = +ev.target.value; update(); });

  const grid = root.append("div").attr("class", "fc-grid");
  const mapBox = grid.append("div").attr("class", "fc-panel");
  mapBox.append("h3").html('<span class="panel-letter">(a)</span> Ensemble tracks');
  const mapDiv = mapBox.append("div");
  const fanBox = grid.append("div").attr("class", "fc-panel");
  fanBox.append("h3").html('<span class="panel-letter">(b)</span> Eastward displacement');
  const fanDiv = fanBox.append("div");
  const stats = root.append("dl").attr("class", "fc-stats");
  root.append("p").attr("class", "caption").html(
    `<b>Experimental.</b> Analog forecast for MJO LPT system ${s.lpt_index} (${data.lptSrc.label}): from the chosen start, the ${K} most similar ` +
    `starts in <em>other</em> seasons — matched on position, 1- and 2-day motion, rain area, RMM state (day before) and time of year — ` +
    `and their next 15 days, moved to today's position. (a) Blue lines: ensemble members (several can come from one past system, so they look alike); ` +
    `black: the observed track (thick before the start, dashed after). (b) Eastward displacement from the start: 10–90 % and ` +
    `25–75 % ranges, the median (dashed) and what happened (dotted). Cross-validated over 1998–2022 this method's 5-day zonal error is about 13° ` +
    `(persistence 13.5°) and 19° at 10 days (persistence 20.5°), and it does not forecast Maritime Continent crossing better than ` +
    `chance — read the plume as a range of past behaviour, not an operational forecast. LPT data run to ${d3.utcFormat("%-d %b %Y")(d3.max(data.lpt, (x) => x.t1))}.`);

  function update() {
    const i = ui.i, tr = s.track, u = s._u, t0 = tr[i].t;
    lab.text(`start ${fmtT(t0)} · day ${((t0 - s.t0) / DAY_MS).toFixed(1)} of ${Math.round(s.duration_days)}`);
    const mem = analogForecast(data, s, i);
    const obs = d3.range(0, Math.min(T, tr.length - 1 - i) + 1).map((k) => ({ k, dx: u[i + k] - u[i], dy: tr[i + k].lat - tr[i].lat }));
    drawMap(mapDiv, data, s, i, mem, obs);
    drawFan(fanDiv, mem, obs, u[i]);
    // stats
    const lon0 = ((u[i] % 360) + 360) % 360;
    const pAlive = (k) => d3.mean(mem, (m) => m.alive[k]);
    const med = (k) => quantile(mem.map((m) => m.dx[k]), 0.5);
    const rows = [
      ["Median eastward move, 5 d / 10 d", `${med(20).toFixed(0)}° / ${med(40).toFixed(0)}°`],
      ["Still alive at 5 / 10 / 15 d", `${Math.round(100 * pAlive(20))} % / ${Math.round(100 * pAlive(40))} % / ${Math.round(100 * pAlive(60))} %`],
    ];
    if (lon0 < MC_LON && lon0 > 40) {
      const p = d3.mean(mem, (m) => m.dx.some((d, k) => m.alive[k] && d >= MC_LON - lon0));
      const o = obs.some((o) => lon0 + o.dx >= MC_LON);
      rows.push([`Reaches ${MC_LON}°E within 15 d`, `${Math.round(100 * p)} % of members` + (obs.length > 1 ? ` · observed: ${o ? "yes" : "no"}` : "")]);
    }
    rows.push(["Observed after the start", obs.length > 1 ? `${((obs.length - 1) / 4).toFixed(1)} days of track` : "none (end of data or of the system)"]);
    stats.selectAll("div").data(rows).join("div").html(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`);
  }
  update();
}

function drawMap(div, data, s, i, mem, obs) {
  div.selectAll("*").remove();
  const u = s._u, tr = s.track, lon0 = u[i], lat0 = tr[i].lat;
  const W = Math.max(300, div.node().clientWidth || 600);
  const h0 = Math.max(0, i - 20);
  const lons = [...mem.flatMap((m) => m.dx.map((d) => lon0 + d)), ...u.slice(h0, i + T + 1)];
  const lats = [...mem.flatMap((m) => m.dy.map((d) => lat0 + d)), ...tr.slice(h0, i + T + 1).map((p) => p.lat)];
  let a = d3.min(lons) - 6, b = d3.max(lons) + 6, c = Math.max(-40, d3.min(lats) - 6), d = Math.min(40, d3.max(lats) + 6);
  if (b - a < 60) { const m = (a + b) / 2; a = m - 30; b = m + 30; }
  const H = Math.round(Math.min(W * 0.62, Math.max(220, W * (d - c) / (b - a))));
  const ppd = Math.min(W / (b - a), H / (d - c)), cx = (a + b) / 2, cy = (c + d) / 2;
  const proj = d3.geoEquirectangular().rotate([-cx, 0]).center([0, cy]).scale(ppd * 180 / Math.PI).translate([W / 2, H / 2]);
  const xy = (lon, lat) => proj([lon, lat]);
  const svg = div.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `Ensemble of ${mem.length} analog tracks from ${fmtLon(lon0)}`);
  svg.append("clipPath").attr("id", "fc-clip").append("rect").attr("width", W).attr("height", H);
  const g = svg.append("g").attr("clip-path", "url(#fc-clip)");
  g.append("rect").attr("class", "ocean").attr("width", W).attr("height", H);
  g.append("path").attr("class", "gridline").attr("fill", "none").attr("d", d3.geoPath(proj)(d3.geoGraticule().step([15, 15])()));
  g.append("path").attr("class", "land").attr("d", d3.geoPath(proj)(topojson.feature(data.land, data.land.objects.land)));
  const line = d3.line();
  g.append("g").selectAll("path").data(mem).join("path").attr("class", "fc-member")
    .attr("d", (m) => line(m.dx.map((dx, k) => xy(lon0 + dx, lat0 + m.dy[k]))))
    .on("mousemove", (ev, m) => showTip(ev, `<b>Analog</b>: LPT ${m.from.lpt_index}<br>from ${fmtT(m.t0)}`))
    .on("mouseleave", hideTip);
  g.append("path").attr("class", "fc-hist").attr("d", line(d3.range(h0, i + 1).map((j) => xy(u[j], tr[j].lat))));
  if (obs.length > 1) g.append("path").attr("class", "fc-obs").attr("d", line(obs.map((o) => xy(lon0 + o.dx, lat0 + o.dy))));
  g.append("circle").attr("class", "fc-dot").attr("r", 5).attr("cx", xy(lon0, lat0)[0]).attr("cy", xy(lon0, lat0)[1]);
  const ax = svg.append("g").attr("class", "map-axis");
  for (let l = Math.ceil(a / 15) * 15; l < b; l += 15) {
    const x = xy(l, cy)[0];
    if (x > 20 && x < W - 20) ax.append("text").attr("class", "halo").attr("x", x).attr("y", H - 5).attr("text-anchor", "middle").text(fmtLon(l));
  }
  svg.append("rect").attr("class", "frame").attr("width", W).attr("height", H);
}

function drawFan(div, mem, obs, lonStart) {
  div.selectAll("*").remove();
  const W = Math.max(280, div.node().clientWidth || 420), H = Math.round(Math.min(360, Math.max(240, W * 0.7)));
  const m = { t: 10, r: 14, b: 40, l: 54 };
  const q = (p) => d3.range(0, T + 1).map((k) => quantile(mem.map((mm) => mm.dx[k]), p));
  const [q10, q25, q50, q75, q90] = [0.1, 0.25, 0.5, 0.75, 0.9].map(q);
  const ys = [...q10, ...q90, ...obs.map((o) => o.dx), 0];
  const x = d3.scaleLinear().domain([0, T / 4]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain(d3.extent(ys)).nice().range([H - m.b, m.t]);
  const svg = div.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Eastward displacement by lead time");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickSizeOuter(0).tickFormat((v) => `${v}°`));
  axisTitle(svg, (m.l + W - m.r) / 2, H - 6, "Lead (days)");
  axisTitle(svg, 12, (m.t + H - m.b) / 2, "Eastward move (° lon)", -90);
  svg.append("line").attr("class", "zero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
  const lon0 = ((lonStart % 360) + 360) % 360;
  if (lon0 < MC_LON && lon0 > 40 && y.domain()[1] >= MC_LON - lon0) {
    const yy = y(MC_LON - lon0);
    svg.append("line").attr("class", "fc-ref").attr("x1", m.l).attr("x2", W - m.r).attr("y1", yy).attr("y2", yy);
    svg.append("text").attr("class", "halo").attr("x", W - m.r - 4).attr("y", yy - 4).attr("text-anchor", "end").text(`${MC_LON}°E`);
  }
  const area = (lo, hi) => d3.area().x((_, k) => x(k / 4)).y0((_, k) => y(lo[k])).y1((_, k) => y(hi[k]))(lo);
  svg.append("path").attr("class", "fc-band90").attr("d", area(q10, q90));
  svg.append("path").attr("class", "fc-band50").attr("d", area(q25, q75));
  svg.append("path").attr("class", "fc-median").attr("d", d3.line().x((_, k) => x(k / 4)).y((v) => y(v))(q50));
  if (obs.length > 1) svg.append("path").attr("class", "fc-obs").attr("d", d3.line().x((o) => x(o.k / 4)).y((o) => y(o.dx))(obs));
  // hover: values at the nearest lead
  const rule = svg.append("line").attr("class", "hover-rule").attr("y1", m.t).attr("y2", H - m.b).style("display", "none");
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove click", (ev) => {
      const k = Math.max(0, Math.min(T, Math.round(x.invert(d3.pointer(ev)[0]) * 4)));
      rule.style("display", null).attr("x1", x(k / 4)).attr("x2", x(k / 4));
      const o = obs.find((oo) => oo.k === k);
      showTip(ev, `<b>+${(k / 4).toFixed(2)} d</b><br>median ${q50[k].toFixed(1)}°<br>25–75 %: ${q25[k].toFixed(0)}° to ${q75[k].toFixed(0)}°<br>10–90 %: ${q10[k].toFixed(0)}° to ${q90[k].toFixed(0)}°` +
        (o ? `<br>observed ${o.dx.toFixed(1)}°` : ""));
    })
    .on("mouseleave", () => { rule.style("display", "none"); hideTip(); });
}

// a system chosen elsewhere (map, Hovmöller, events table) becomes the forecast's system
export function selectForecastSystem(id) { if (id) { ui.id = id; ui.i = null; } }
