// Experimental track forecast (one test event), made in GitHub Actions by the trained rain-track
// corrector (pipeline/forecast.py): (a) a cone on a map — median track, the distance from it that holds
// 50 % and 90 % of 50 sampled tracks, the follow-the-GEFS-rain track and what happened; (b) the chance of
// reaching 150°E for each start against climatology, with the Brier skill score for this event.
import { DAY_MS, loadLpt } from "./data.js";
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
  const [fc, imerg] = await Promise.all([load(), loadLpt("imerg")]);
  root.selectAll("*").remove();
  if (!fc.starts.length) {
    root.append("p").attr("class", "empty-line").text("The forecast has not been built yet (pipeline/forecast.py).");
    return;
  }
  const sys = imerg.find((s) => s.id === EVENT);
  const t0s = fc.starts.map((s) => new Date(s.t0));
  const clim = climatology(imerg);
  // per start: model chance of reaching 150°E, climatology for that longitude, what happened
  const cross = fc.starts.map((s, i) => s.p_reach_150E === null ? null : {
    i, t0: t0s[i], p: s.p_reach_150E, c: clim(s.lon0), o: s.observed.some((o) => s.lon0 + o[0] >= 150) ? 1 : 0 });
  const scored = cross.filter(Boolean);
  const bs = (f) => d3.mean(scored, (d) => (f(d) - d.o) ** 2);
  const bss = 1 - bs((d) => d.p) / bs((d) => d.c);

  root.append("p").attr("class", "fc-intro").html(
    `Where will an MJO rain system go next, and will it cross the Maritime Continent? A test on one system, ` +
    `<b>${EVENT.replace("LPT-I-", "")}</b> (${fmtT(sys ? sys.t0 : t0s[0])} – ${fmtT(sys ? sys.t1 : t0s.at(-1))}), ` +
    `which crossed it in late December 2011. Move the slider to change the forecast start. ` +
    `<a href="#from=2011-12-10&days=80&m=rmm,lpt&src=imerg&sel=${EVENT}">Show it in the figures above →</a>`);

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
  mapBox.append("h3").html('<span class="panel-letter">(a)</span> Track and forecast cone');
  const mapDiv = mapBox.append("div");
  const xBox = grid.append("div").attr("class", "fc-panel");
  xBox.append("h3").html('<span class="panel-letter">(b)</span> Chance of crossing the Maritime Continent');
  const xDiv = xBox.append("div");
  root.append("div").attr("class", "legend fc-legend").html(
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2" width="26" height="10" class="fc-c90"/></svg>where 90 % of forecast tracks fall (to day 10)</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2" width="26" height="10" class="fc-c50"/></svg>50 %</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-med"/></svg>model forecast (middle track, day marks)</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-rain"/></svg>follow the GEFS rain</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="2" y1="7" x2="26" y2="7" class="fc-obs"/></svg>what happened</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><rect x="8" y="1" width="12" height="12" class="fc-pbar"/></svg>model chance of reaching 150°E</span>' +
    '<span class="key"><svg class="sw" viewBox="0 0 28 14" aria-hidden="true"><line x1="3" y1="7" x2="25" y2="7" class="fc-clim"/></svg>climatology</span>');
  const stats = root.append("dl").attr("class", "fc-stats");

  function update() {
    const s = fc.starts[ui.i], t0 = t0s[ui.i], x = cross[ui.i];
    lab.text(`start ${fmtT(t0)} 00 UTC · ${fmtLon(s.lon0)}`);
    drawMap(mapDiv, data, sys, s, t0);
    drawCross(xDiv, cross, t0s, ui.i, go);
    const rows = [x
      ? ["Chance it reaches 150°E within 15 days", `model ${Math.round(100 * x.p)} % · climatology ${Math.round(100 * x.c)} % · it ${x.o ? "did" : "did not"}`]
      : ["Chance it reaches 150°E within 15 days", "— already east of 150°E"],
      [`Brier skill against climatology, this event (${scored.length} starts)`, `${bss >= 0 ? "+" : "−"}${Math.abs(bss).toFixed(2)} · 21 winters: +0.13`]];
    stats.selectAll("div").data(rows).join("div").html(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`);
  }
  update();
}

// Climatological chance of reaching 150°E within 15 days, from DJF 6-hourly positions of IMERG MJO systems
// within ±10° of a start longitude west of 150°E (the test event left out).
function climatology(list) {
  const norm = (l) => ((l % 360) + 360) % 360, east = (l) => l >= 150 && l < 260;
  const pts = [];
  for (const s of list) {
    if (s.id === EVENT || !s.track) continue;
    const tr = s.track;
    tr.forEach((p, i) => {
      const m = p.t.getUTCMonth(), l = norm(p.lon);
      if (!(m === 11 || m <= 1) || l >= 150) return;
      let hit = 0;
      for (let j = i + 1; j < tr.length && tr[j].t - p.t <= 15 * DAY_MS; j++) if (east(norm(tr[j].lon))) { hit = 1; break; }
      pts.push([l, hit]);
    });
  }
  return (lon0) => d3.mean(pts.filter(([l]) => Math.abs(l - lon0) <= 10), (p) => p[1]) ?? NaN;
}

function drawCross(div, cross, t0s, cur, go) {
  div.selectAll("*").remove();
  const W = Math.max(280, div.node().clientWidth || 420), H = Math.round(Math.min(320, Math.max(220, W * 0.66)));
  const m = { t: 22, r: 10, b: 40, l: 44 };
  const x = d3.scaleBand().domain(t0s.map((_, i) => i)).range([m.l, W - m.r]).padding(0.25);
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const svg = div.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", "Model and climatological chance of reaching 150°E for each forecast start");
  const fmtD = d3.utcFormat("%-d %b");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).tickValues(t0s.map((_, i) => i).filter((i) => i % 3 === 0)).tickFormat((i) => fmtD(t0s[i])).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)} %`).tickSizeOuter(0));
  axisTitle(svg, (m.l + W - m.r) / 2, H - 6, "Forecast start");
  const g = svg.append("g");
  cross.forEach((d, i) => {
    const x0 = x(i), bw = x.bandwidth();
    const col = g.append("g").attr("class", i === cur ? "fc-col is-cur" : "fc-col").style("cursor", "pointer").on("click", () => go(i));
    col.append("rect").attr("x", x0 - x.step() * x.padding() / 2).attr("width", x.step()).attr("y", m.t).attr("height", H - m.b - m.t).attr("class", "fc-hit");
    if (!d) { col.append("text").attr("class", "fc-east").attr("x", x0 + bw / 2).attr("y", H - m.b - 4).attr("text-anchor", "middle").text("E"); return; }
    col.append("rect").attr("class", "fc-pbar").attr("x", x0).attr("width", bw).attr("y", y(d.p)).attr("height", y(0) - y(d.p));
    col.append("line").attr("class", "fc-clim").attr("x1", x0 - 2).attr("x2", x0 + bw + 2).attr("y1", y(d.c)).attr("y2", y(d.c));
    col.append("text").attr("class", "fc-out").attr("x", x0 + bw / 2).attr("y", m.t - 7).attr("text-anchor", "middle").text(d.o ? "✓" : "✗");
    col.on("mousemove", (ev) => showTip(ev, `<b>${fmtT(d.t0)}</b><br>model ${Math.round(100 * d.p)} %<br>climatology ${Math.round(100 * d.c)} %<br>reached 150°E: ${d.o ? "yes" : "no"}`))
      .on("mouseleave", hideTip);
  });
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
  const x150 = xy(unwrap(150, lon0), cy)[0];
  if (x150 > 0 && x150 < W) {
    g.append("line").attr("class", "fc-ref").attr("x1", x150).attr("x2", x150).attr("y1", 0).attr("y2", H);
    g.append("text").attr("class", "halo fc-daylab").attr("x", x150 + 4).attr("y", 14).text("150°E");
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
