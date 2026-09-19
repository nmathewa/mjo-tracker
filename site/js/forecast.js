// Experimental track forecast (one test event), made in GitHub Actions by the trained rain-track
// corrector (pipeline/forecast.py) and drawn here as a cone: median track, the distance from it that
// holds 50 % and 90 % of 50 sampled tracks, the follow-the-GEFS-rain track and what happened.
import { DAY_MS } from "./data.js";
import { axisTitle, showTip, hideTip } from "./charts.js";

const EVENT = "LPT-I-2010-70.2000";
const MARK_DAYS = [1, 3, 5, 7, 10, 15];
const CONE_STEPS = 40;          // map cone to day 10; beyond that it covers most of the region (panel b has 15 d)
const ui = { i: 0, fc: null };
const fmtT = d3.utcFormat("%-d %b %Y");
const fmtLon = (l) => { l = ((Math.round(l) % 360) + 360) % 360; return l === 0 || l === 180 ? `${l}°` : l < 180 ? `${l}°E` : `${360 - l}°W`; };

async function load() {
  if (!ui.fc) {
    const r = await fetch(`data/forecast/${EVENT}.json`);
    ui.fc = r.ok ? await r.json() : { starts: [] };
  }
  return ui.fc;
}

export async function drawForecast(sel, data) {
  const root = d3.select(sel);
  const fc = await load();
  root.selectAll("*").remove();
  if (!fc.starts.length) {
    root.append("p").attr("class", "empty-line").text("The forecast has not been built yet (pipeline/forecast.py).");
    return;
  }
  const sys = data.lpt.find((s) => s.id === EVENT);
  const t0s = fc.starts.map((s) => new Date(s.t0));

  root.append("p").attr("class", "fc-intro").html(
    `Test case: MJO rain system <b>${EVENT.replace("LPT-I-", "")}</b>, ${fmtT(sys ? sys.t0 : t0s[0])} – ` +
    `${fmtT(sys ? sys.t1 : t0s.at(-1))}, which crossed the Maritime Continent in late December 2011. ` +
    `The model never saw this winter. <a href="#from=2011-12-10&days=80&m=rmm,lpt&src=imerg&sel=${EVENT}">Show it in the figures above →</a>`);

  const bar = root.append("div").attr("class", "fc-bar");
  const st = bar.append("div").attr("class", "fc-start");
  const back = st.append("button").attr("type", "button").attr("aria-label", "Earlier start").text("◀");
  const slider = st.append("input").attr("type", "range").attr("id", "fc-start").attr("min", 0)
    .attr("max", fc.starts.length - 1).attr("step", 1).property("value", ui.i).attr("aria-label", "Forecast start");
  const fwd = st.append("button").attr("type", "button").attr("aria-label", "Later start").text("▶");
  const lab = st.append("output").attr("class", "fc-when");
  const go = (i) => { ui.i = Math.max(0, Math.min(fc.starts.length - 1, i)); slider.property("value", ui.i); update(); };
  back.on("click", () => go(ui.i - 1));
  fwd.on("click", () => go(ui.i + 1));
  slider.on("input", (ev) => go(+ev.target.value));

  const grid = root.append("div").attr("class", "fc-grid");
  const mapBox = grid.append("div").attr("class", "fc-panel");
  mapBox.append("h3").html('<span class="panel-letter">(a)</span> Forecast cone');
  const mapDiv = mapBox.append("div");
  const fanBox = grid.append("div").attr("class", "fc-panel");
  fanBox.append("h3").html('<span class="panel-letter">(b)</span> Eastward move by lead time');
  const fanDiv = fanBox.append("div");
  root.append("div").attr("class", "legend fc-legend").html(
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2" width="26" height="10" class="fc-c90"/></svg>90 % of forecast tracks (map: to day 10)</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2" width="26" height="10" class="fc-c50"/></svg>50 %</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-med"/></svg>median forecast (day marks)</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-rain"/></svg>follow the GEFS rain (no model)</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-obs"/></svg>what happened</span>');
  const stats = root.append("dl").attr("class", "fc-stats");
  root.append("p").attr("class", "caption").html(
    `<b>Experimental.</b> A trained rain-track corrector (CNN-Transformer, v${fc.model.version}) run in GitHub Actions: ` +
    `for each start, the GEFS v12 reforecast (${fc.starts[0].members} members) is followed from the system's position ` +
    `(“follow the GEFS rain”), and the model — which sees the GEFS fields in a window moving with the system, the ` +
    `system's last 5 days and the RMM state — predicts how the real track departs from that, as 50 sampled tracks. ` +
    `(a) Shaded: the distance from the median that holds 50 % and 90 % of the tracks at each lead; (b) the same as ` +
    `eastward move, with the 150°E line (crossing the Maritime Continent). Measured skill, retraining with each of 21 ` +
    `DJF winters of the GEFS reforecast held out in turn (1,073 starts): the model is the best of the methods tried ` +
    `from day 3 to day 15, with 18–41 % lower CRPS than following the GEFS rain (90 % intervals over systems exclude ` +
    `zero), and the only one with skill at saying whether a system crosses the Maritime Continent (Brier skill +0.13; ` +
    `the others are negative). At day 1 it is worse than persistence or analogs. Its settings were chosen while ` +
    `looking at this winter, so a clean test on later, operational GEFS winters is still to do. This page shows one ` +
    `test event. Trained on ${fc.model.trained_on}; held out: ${fc.model.held_out}.`);

  function update() {
    const s = fc.starts[ui.i], t0 = new Date(s.t0);
    lab.text(`start ${fmtT(t0)} 00 UTC · ${s.lon0.toFixed(0)}°E`);
    drawMap(mapDiv, data, sys, s, t0);
    drawFan(fanDiv, s);
    const move = (k) => s.median[k][0];
    const obs = (k) => (s.observed[k] ? s.observed[k][0] : null);
    const rows = [
      ["Median eastward move, 5 d / 10 d", `${move(19).toFixed(0)}° / ${move(39).toFixed(0)}°`],
      ["Observed, 5 d / 10 d", [19, 39].map((k) => (obs(k) === null ? "—" : `${obs(k).toFixed(0)}°`)).join(" / ")],
      ["Still alive at 5 / 10 / 15 d", [19, 39, 59].map((k) => `${Math.round(100 * s.p_alive[k])} %`).join(" / ")],
    ];
    if (s.p_reach_150E !== null) {
      const reached = s.observed.some((o) => s.lon0 + o[0] >= 150);
      rows.push(["Reaches 150°E within 15 d", `${Math.round(100 * s.p_reach_150E)} % of tracks · observed: ${reached ? "yes" : "no"}`]);
    }
    stats.selectAll("div").data(rows).join("div").html(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`);
  }
  update();
}

function unwrap(lon, ref) { let l = lon; while (l - ref > 180) l -= 360; while (l - ref < -180) l += 360; return l; }

function drawMap(div, data, sys, s, t0) {
  div.selectAll("*").remove();
  const lon0 = s.lon0, lat0 = s.lat0;
  const hist = sys ? sys.track.filter((p) => p.t <= t0 && p.t >= new Date(+t0 - 5 * DAY_MS)) : [];
  const pts = [...s.median.map((m, k) => [lon0 + m[0], lat0 + m[1], k < CONE_STEPS ? s.r90_km[k] / 111.2 : 0]),
    ...s.observed.map((o) => [lon0 + o[0], lat0 + o[1], 0]), ...hist.map((p) => [unwrap(p.lon, lon0), p.lat, 0])];
  const W = Math.max(300, div.node().clientWidth || 600);
  let a = d3.min(pts, (p) => p[0] - p[2]) - 6, b = d3.max(pts, (p) => p[0] + p[2]) + 6;
  const c = Math.max(-40, d3.min(pts, (p) => p[1] - p[2]) - 6), d = Math.min(40, d3.max(pts, (p) => p[1] + p[2]) + 6);
  if (b - a < 60) { const mid = (a + b) / 2; a = mid - 30; b = mid + 30; }
  const H = Math.round(Math.min(W * 0.62, Math.max(230, W * (d - c) / (b - a))));
  const ppd = Math.min(W / (b - a), H / (d - c)), cx = (a + b) / 2, cy = (c + d) / 2;
  const proj = d3.geoEquirectangular().rotate([-cx, 0]).center([0, cy]).scale(ppd * 180 / Math.PI).translate([W / 2, H / 2]);
  const xy = (lo, la) => proj([lo, la]);
  const svg = div.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `Forecast cone from ${fmtLon(lon0)} on ${fmtT(t0)}`);
  svg.append("clipPath").attr("id", "fc-clip").append("rect").attr("width", W).attr("height", H);
  const g = svg.append("g").attr("clip-path", "url(#fc-clip)");
  g.append("rect").attr("class", "ocean").attr("width", W).attr("height", H);
  g.append("path").attr("class", "gridline").attr("fill", "none").attr("d", d3.geoPath(proj)(d3.geoGraticule().step([15, 15])()));
  g.append("path").attr("class", "land").attr("d", d3.geoPath(proj)(topojson.feature(data.land, data.land.objects.land)));
  // cone: union of ellipses (km radius, wider in longitude by 1/cos lat), in one path so the fill is even
  const cone = (radii) => s.median.slice(0, CONE_STEPS).map((m, k) => {
    const [x, y] = xy(lon0 + m[0], lat0 + m[1]);
    const ry = radii[k] / 111.2 * ppd, rx = ry / Math.cos((lat0 + m[1]) * Math.PI / 180);
    return `M${x - rx},${y}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0`;
  }).join("");
  g.append("path").attr("class", "fc-c90").attr("d", cone(s.r90_km));
  g.append("path").attr("class", "fc-c50").attr("d", cone(s.r50_km));
  const line = d3.line();
  g.append("path").attr("class", "fc-rain").attr("d", line([[0, 0], ...s.rain].map((r) => xy(lon0 + r[0], lat0 + r[1]))));
  if (hist.length > 1) g.append("path").attr("class", "fc-hist").attr("d", line(hist.map((p) => xy(unwrap(p.lon, lon0), p.lat))));
  if (s.observed.length) g.append("path").attr("class", "fc-obs").attr("d", line([[0, 0], ...s.observed].map((o) => xy(lon0 + o[0], lat0 + o[1]))));
  g.append("path").attr("class", "fc-med").attr("d", line([[0, 0], ...s.median].map((m) => xy(lon0 + m[0], lat0 + m[1]))));
  for (const day of MARK_DAYS) {
    const m = s.median[day * 4 - 1], [x, y] = xy(lon0 + m[0], lat0 + m[1]);
    g.append("circle").attr("class", "fc-daydot").attr("cx", x).attr("cy", y).attr("r", 3.5)
      .on("mousemove", (ev) => showTip(ev, `<b>Day ${day}</b><br>median ${fmtLon(lon0 + m[0])}, ${(lat0 + m[1]).toFixed(1)}°<br>` +
        `50 % within ${Math.round(s.r50_km[day * 4 - 1])} km · 90 % within ${Math.round(s.r90_km[day * 4 - 1])} km`))
      .on("mouseleave", hideTip);
    g.append("text").attr("class", "halo fc-daylab").attr("x", x + 5).attr("y", y - 5).text(`${day}d`);
  }
  const [sx, sy] = xy(lon0, lat0);
  g.append("circle").attr("class", "fc-dot").attr("r", 5).attr("cx", sx).attr("cy", sy);
  const ax = svg.append("g").attr("class", "map-axis");
  for (let l = Math.ceil(a / 15) * 15; l < b; l += 15) {
    const x = xy(l, cy)[0];
    if (x > 20 && x < W - 20) ax.append("text").attr("class", "halo").attr("x", x).attr("y", H - 5).attr("text-anchor", "middle").text(fmtLon(l));
  }
  svg.append("rect").attr("class", "frame").attr("width", W).attr("height", H);
}

function drawFan(div, s) {
  div.selectAll("*").remove();
  const W = Math.max(280, div.node().clientWidth || 420), H = Math.round(Math.min(360, Math.max(240, W * 0.72)));
  const m = { t: 10, r: 14, b: 40, l: 56 }, n = s.median.length;
  const [q10, q25, q50, q75, q90] = s.lon_q;
  const obs = s.observed.map((o) => o[0]);
  const x = d3.scaleLinear().domain([0, n / 4]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain(d3.extent([0, ...q10, ...q90, ...obs, ...s.rain.map((r) => r[0])])).nice().range([H - m.b, m.t]);
  const svg = div.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Eastward move by lead time");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickSizeOuter(0).tickFormat((v) => `${v}°`));
  axisTitle(svg, (m.l + W - m.r) / 2, H - 6, "Lead (days)");
  axisTitle(svg, 12, (m.t + H - m.b) / 2, "Eastward move (° lon)", -90);
  svg.append("line").attr("class", "zero").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));
  if (s.lon0 < 150 && y.domain()[1] >= 150 - s.lon0) {
    const yy = y(150 - s.lon0);
    svg.append("line").attr("class", "fc-ref").attr("x1", m.l).attr("x2", W - m.r).attr("y1", yy).attr("y2", yy);
    svg.append("text").attr("class", "halo").attr("x", W - m.r - 4).attr("y", yy - 4).attr("text-anchor", "end").text("150°E");
  }
  const lead = (k) => x((k + 1) / 4);
  const area = (lo, hi) => d3.area().x((_, k) => lead(k)).y0((_, k) => y(lo[k])).y1((_, k) => y(hi[k]))(lo);
  svg.append("path").attr("class", "fc-band90").attr("d", area(q10, q90));
  svg.append("path").attr("class", "fc-band50").attr("d", area(q25, q75));
  svg.append("path").attr("class", "fc-rain").attr("d", d3.line().x((_, k) => lead(k)).y((r) => y(r[0]))(s.rain));
  svg.append("path").attr("class", "fc-med").attr("d", d3.line().x((_, k) => lead(k)).y((v) => y(v))(q50));
  if (obs.length) svg.append("path").attr("class", "fc-obs").attr("d", d3.line().x((_, k) => lead(k)).y((v) => y(v))(obs));
  const rule = svg.append("line").attr("class", "hover-rule").attr("y1", m.t).attr("y2", H - m.b).style("display", "none");
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove click", (ev) => {
      const k = Math.max(0, Math.min(n - 1, Math.round(x.invert(d3.pointer(ev)[0]) * 4) - 1));
      rule.style("display", null).attr("x1", lead(k)).attr("x2", lead(k));
      showTip(ev, `<b>+${((k + 1) / 4).toFixed(2)} d</b><br>median ${q50[k].toFixed(1)}°<br>50 %: ${q25[k].toFixed(0)}° to ${q75[k].toFixed(0)}°<br>` +
        `90 %: ${q10[k].toFixed(0)}° to ${q90[k].toFixed(0)}°<br>rain track ${s.rain[k][0].toFixed(1)}°` +
        (obs[k] !== undefined ? `<br>observed ${obs[k].toFixed(1)}°` : ""));
    })
    .on("mouseleave", () => { rule.style("display", "none"); hideTip(); });
}
