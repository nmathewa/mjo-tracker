// Interactive map of LPT tracks: pan/zoom, a time slider with playback, systems drawn at
// their real rain-area size, and an optional layer of non-MJO LPT systems for context.
// The current time is broadcast as a "mjo:time" event so the Hovmöller and phase
// diagram can show a matching cursor (charts.js).
import { DAY_MS, fmtDay, phaseLon, PHASE_REGION, parseDay, hashFor, loadOthers, loadLand50, coverageText } from "./data.js";
import { showTip, hideTip, describe } from "./charts.js";

const LAT = 40;          // map shows ±LAT at the widest zoom
const STEP_H = 6;        // slider step, hours (the track resolution)
const KM_PER_DEG = 111.2;

// survives redraws, so changing the window keeps your zoom and layers
const ui = { transform: null, width: 0, showOthers: false, t: null, playing: null, land50: null };

const inWindow = (s, st) => s.t1 > st.t0 && s.t0 < st.t1;
const fmtTime = d3.utcFormat("%-d %b %Y %H UTC");
const fmtLon = (l) => { l = ((Math.round(l) % 360) + 360) % 360; return l === 0 || l === 180 ? `${l}°` : l < 180 ? `${l}°E` : `${360 - l}°W`; };

export function drawMap(sel, data, state) {
  const root = d3.select(sel), card = root.node().closest(".card");
  stop();
  root.selectAll("*").remove();
  const off = !state.methods.has("lpt");
  const sys = data.lpt.filter((s) => s.track && inWindow(s, state));
  card.classList.toggle("is-empty", off);
  if (off) {
    root.append("p").attr("class", "empty-line").text("LPT tracking is switched off.");
    return;
  }

  // ---- controls: zoom, layers, playback
  const bar = root.append("div").attr("class", "map-bar");
  const zoomG = bar.append("div").attr("class", "map-zoom").attr("role", "group").attr("aria-label", "Zoom");
  const bIn = zoomG.append("button").attr("type", "button").attr("aria-label", "Zoom in").text("+");
  const bOut = zoomG.append("button").attr("type", "button").attr("aria-label", "Zoom out").text("−");
  const bFit = zoomG.append("button").attr("type", "button").attr("class", "fit").text("Fit tracks");
  const bAll = zoomG.append("button").attr("type", "button").attr("class", "fit").text("Whole tropics");
  const other = bar.append("label").attr("class", "map-other");
  const otherIn = other.append("input").attr("type", "checkbox").property("checked", ui.showOthers);
  other.append("span").html("Other rain systems <span class=\"dim\">(non-MJO LPTs)</span>");

  const W = Math.max(280, root.node().clientWidth || 1200);
  const Hbase = W * (2 * LAT) / 360;                       // whole 0–360° band at k = 1
  const H = Math.round(Math.max(Hbase, Math.min(460, Math.max(260, W * 0.36))));
  const k0 = H / Hbase;                                     // smallest zoom that fills the frame
  const svg = root.append("svg").attr("class", "map-svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("tabindex", 0).attr("role", "img")
    .attr("aria-label", `Map of ${sys.length} MJO rain-system tracks. Drag to pan, scroll or plus and minus to zoom.`);
  const proj = d3.geoEquirectangular().rotate([-180, 0]).scale(W / (2 * Math.PI)).translate([W / 2, Hbase / 2]);
  const geo = d3.geoPath(proj);
  const pxPerDeg = W / 360;

  svg.append("clipPath").attr("id", "map-clip").append("rect").attr("width", W).attr("height", H);
  const vp = svg.append("g").attr("clip-path", "url(#map-clip)");
  const world = vp.append("g");
  world.append("rect").attr("class", "ocean").attr("width", W).attr("height", Hbase);
  world.append("path").attr("class", "gridline map-grid").attr("d", geo(d3.geoGraticule().step([30, 10]).extent([[-180, -LAT], [180.01, LAT + 0.01]])()));
  const landPath = world.append("path").attr("class", "land");
  const setLand = (topo) => landPath.attr("d", geo(topojson.feature(topo, topo.objects.land)));
  setLand(ui.land50 ?? data.land);
  world.append("line").attr("class", "equator").attr("x1", 0).attr("x2", W).attr("y1", Hbase / 2).attr("y2", Hbase / 2);
  const rmmBand = world.append("g").attr("class", "rmm-only rmm-band");
  const gOther = world.append("g").attr("class", "lpt-other-layer");
  const gTracks = world.append("g").attr("class", "lpt-only");
  const gNow = world.append("g").attr("class", "lpt-only");
  const axis = svg.append("g").attr("class", "map-axis");
  svg.append("rect").attr("class", "frame").attr("width", W).attr("height", H);

  // line through a track, broken where it crosses the 0°/360° seam
  const xy = (p) => proj([p.lon, p.lat]);
  const trackLine = d3.line().defined((p, i, a) => i === 0 || Math.abs(p.lon - a[i - 1].lon) < 180).x((p) => xy(p)[0]).y((p) => xy(p)[1]);

  const sysG = gTracks.selectAll("g").data(sys).join("g").attr("class", "lpt-sys mark tip-target").attr("data-id", (s) => s.id)
    .on("mousemove", (ev, s) => showTip(ev, describe(s) + "<br><i>click for details</i>")).on("mouseleave", hideTip)
    .on("click", (ev, s) => { showTip(ev, describe(s)); document.dispatchEvent(new CustomEvent("mjo:select", { detail: s.id })); });
  sysG.append("path").attr("class", "lpt-casing").attr("d", (s) => trackLine(s.track));
  sysG.selectAll("line").data((s) => s.track.slice(1).map((p, i) => [s.track[i], p]).filter(([a, b]) => Math.abs(a.lon - b.lon) < 180))
    .join("line").attr("class", "seg")
    .attr("x1", ([a]) => xy(a)[0]).attr("y1", ([a]) => xy(a)[1]).attr("x2", ([, b]) => xy(b)[0]).attr("y2", ([, b]) => xy(b)[1]);
  const starts = sysG.append("circle").attr("class", "lpt-start")
    .attr("cx", (s) => xy(s.track[0])[0]).attr("cy", (s) => xy(s.track[0])[1]);

  const radius = (p) => Math.sqrt(p.area / Math.PI) / KM_PER_DEG * pxPerDeg;

  // no tracks here: say why, prominently, and offer windows that have them
  if (!sys.length) {
    const outside = state.t0 >= d3.max(data.lpt, (s) => s.t1) || state.t1 <= d3.min(data.lpt, (s) => s.t0);
    const link = (from, text) => `<a class="btn" href="${hashFor(parseDay(from), 120, new Set([...state.methods, "lpt"]))}">${text}</a>`;
    root.append("div").attr("class", "map-empty").html(
      `<p><b>${outside ? "No LPT tracks for this period." : "No MJO rain systems in this window."}</b> ` +
      `${outside ? `The ${data.lptSrc.label} LPT database covers ${coverageText(data.lptSrc)}.` : ""}</p>` +
      `<p>${link(d3.utcFormat("%Y-%m-%d")(new Date(d3.max(data.lpt, (s) => s.t1) - 120 * DAY_MS)), "Latest LPT systems")} ${link("2011-10-01", "DYNAMO, Oct 2011")} ${link("2015-11-01", "El Niño winter 2015–16")}</p>`);
  }

  // ---- non-MJO systems (lazy)
  async function drawOthers() {
    gOther.selectAll("*").remove();
    if (!ui.showOthers) return;
    const others = (await loadOthers(data.lptSrc, state.t0, state.t1)).filter((s) => inWindow(s, state));
    gOther.selectAll("path").data(others).join("path").attr("class", "lpt-other tip-target")
      .attr("d", (s) => trackLine(s.track))
      .on("mousemove click", (ev, s) => showTip(ev, `<b>LPT system ${s.lpt_index}</b> (not MJO)<br>${fmtDay(s.t0)} – ${fmtDay(s.t1)} (${Math.round(s.duration_days)} d)`))
      .on("mouseleave", hideTip);
    applyZoomStyles();
    setTime(ui.t);
  }
  otherIn.on("change", (ev) => { ui.showOthers = ev.target.checked; drawOthers(); });

  // ---- zoom
  let k = 1;
  const zoom = d3.zoom().scaleExtent([k0, 24]).extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, Hbase]])
    .filter((ev) => (!ev.ctrlKey || ev.type === "wheel") && !ev.button)
    .on("zoom", (ev) => {
      world.attr("transform", ev.transform);
      k = ev.transform.k;
      ui.transform = ev.transform;
      applyZoomStyles();
      drawAxis(ev.transform);
      if (k > 3 && !ui.land50) loadLand50().then((t) => { ui.land50 = t; setLand(t); });
    });
  function applyZoomStyles() {
    starts.attr("r", 3.5 / k);
    // the RMM band label is drawn in world units; keep it 11px on screen at any zoom
    rmmBand.selectAll("text").attr("y", 14 / k).style("font-size", `${11 / k}px`);
    world.style("--k", k);
  }
  function drawAxis(t) {
    // longitude labels along the bottom edge, recomputed for the visible span
    const lonAt = (px) => (t.invertX(px) / pxPerDeg);
    const a = lonAt(0), b = lonAt(W), span = b - a;
    const step = [60, 30, 20, 10, 5, 2].find((s) => span / s >= 4) ?? 2;
    const ticks = d3.range(Math.ceil(a / step) * step, b, step);
    axis.selectAll("text").data(ticks).join("text").attr("class", "halo")
      .attr("x", (l) => t.applyX(l * pxPerDeg)).attr("y", H - 6).attr("text-anchor", "middle").text(fmtLon);
  }
  svg.call(zoom).on("dblclick.zoom", null);

  const fitTo = (lons, lats, dur = 600) => {
    let a = d3.min(lons) - 8, b = d3.max(lons) + 8, c = d3.min(lats) - 8, d = d3.max(lats) + 8;
    const kk = Math.max(k0, Math.min(24, W / ((b - a) * pxPerDeg), H / ((d - c) * pxPerDeg)));
    const cx = ((a + b) / 2) * pxPerDeg, cy = Hbase / 2 - ((c + d) / 2) * pxPerDeg;
    svg.transition().duration(dur).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - kk * cx, H / 2 - kk * cy).scale(kk));
  };
  const fitTracks = (dur) => {
    if (!sys.length) return svg.transition().duration(dur).call(zoom.transform, d3.zoomIdentity.scale(k0).translate(0, 0));
    const pts = sys.flatMap((s) => s.track);
    fitTo(pts.map((p) => p.lon), pts.map((p) => p.lat), dur);
  };
  bIn.on("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1.6));
  bOut.on("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6));
  bFit.on("click", () => fitTracks(600));
  bAll.on("click", () => svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(0, (H - Hbase * k0) / 2).scale(k0)));
  svg.on("keydown", (ev) => {
    if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); bIn.dispatch("click"); }
    if (ev.key === "-") { ev.preventDefault(); bOut.dispatch("click"); }
    const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[ev.key];
    if (pan) { ev.preventDefault(); ev.stopPropagation(); svg.transition().duration(150).call(zoom.translateBy, pan[0] / k, pan[1] / k); }
  });

  // keep the zoom across window changes; first draw (or a resize) fits the tracks
  if (ui.transform && ui.width === W) svg.call(zoom.transform, ui.transform);
  else fitTracks(0);
  ui.width = W;

  // ---- time: slider, playback, systems at their real size
  const steps = Math.round((state.t1 - state.t0) / (STEP_H * 3600e3));
  const tl = root.append("div").attr("class", "map-time");
  const bPlay = tl.append("button").attr("type", "button").attr("class", "play").attr("aria-label", "Play").text("▶");
  const slider = tl.append("input").attr("type", "range").attr("min", 0).attr("max", steps).attr("step", 1)
    .attr("aria-label", "Time in window");
  const label = tl.append("output").attr("class", "map-now");
  const idx = (t) => Math.round((t - state.t0) / (STEP_H * 3600e3));
  if (!ui.t || ui.t < state.t0 || ui.t > state.t1) ui.t = state.t1;

  function setTime(t) {
    ui.t = t;
    slider.property("value", idx(t));
    label.text(+t >= +state.t1 ? "whole window · press ▶ to play" : fmtTime(t));
    // each system alive at t: its track so far (bold) and a disc of its rain area
    const alive = [];
    for (const s of sys) {
      if (t < s.t0 || t > s.t1) continue;
      const i = d3.bisector((p) => p.t).right(s.track, t) - 1;
      if (i >= 0) alive.push({ s, p: s.track[i], past: s.track.slice(0, i + 1) });
    }
    const playing = +t < +state.t1;
    world.classed("is-playing", playing);
    if (playing) {
      sysG.selectAll("line.seg").classed("is-past", ([, b]) => b.t <= t);
    }
    gNow.selectAll("circle.lpt-now").data(alive, (d) => d.s.id).join("circle").attr("class", "lpt-now mark tip-target")
      .attr("data-id", (d) => d.s.id)
      .attr("cx", (d) => xy(d.p)[0]).attr("cy", (d) => xy(d.p)[1])
      .attr("r", (d) => radius(d.p))
      .on("mousemove click", (ev, d) => showTip(ev, `${describe(d.s)}<br>at ${fmtTime(t)}: ${Math.round(d.p.area / 1e3).toLocaleString()} thousand km² of heavy rain, ${d.p.lat.toFixed(1)}°, ${fmtLon(d.p.lon)}`))
      .on("mouseleave", hideTip);
    // non-MJO systems alive now
    gOther.selectAll("path.lpt-other").classed("is-alive", (s) => t >= s.t0 && t <= s.t1);
    // RMM: shade the approximate longitude of the current phase when active
    const day = data.days[Math.floor((t - data.days[0].date) / DAY_MS)];
    const on = day && day.amp !== null && day.amp >= 1;
    rmmBand.selectAll("*").remove();
    if (on) {
      const x = phaseLon(day.angle) * pxPerDeg, w = 30 * pxPerDeg;
      rmmBand.append("rect").attr("x", x - w / 2).attr("width", w).attr("y", 0).attr("height", Hbase);
      rmmBand.append("text").attr("class", "halo").attr("x", x).attr("y", 14 / k)
        .style("font-size", `${11 / k}px`).attr("text-anchor", "middle")
        .text(`RMM phase ${day.phase} (approx.)`)
        .append("title").text(`RMM is an index, not a location: phase ${day.phase} usually means enhanced rain over the ${PHASE_REGION[day.phase]}`);
    }
    document.dispatchEvent(new CustomEvent("mjo:time", { detail: t }));
  }

  slider.on("input", (ev) => { stop(); setTime(new Date(+state.t0 + ev.target.value * STEP_H * 3600e3)); });
  bPlay.on("click", () => (ui.playing ? stop() : play()));
  function play() {
    if (idx(ui.t) >= steps) setTime(state.t0);
    bPlay.text("❚❚").attr("aria-label", "Pause");
    let last = 0;
    ui.playing = d3.timer((el) => {
      if (el - last < 45) return;       // ~22 steps (5.5 days) per second
      last = el;
      const n = idx(ui.t) + 1;
      if (n > steps) return stop();
      setTime(new Date(+state.t0 + n * STEP_H * 3600e3));
    });
    ui.stopBtn = bPlay;
  }
  root.append("p").attr("class", "caption").html("Centroid tracks of MJO rain systems from Large-scale Precipitation Tracking " +
    `(Kerns &amp; Chen; ${data.lptSrc.label}, ${coverageText(data.lptSrc)}); open circles mark where each system began. ` +
    "Pressing ▶ plays the window: discs show each system's rain area at that moment as a circle of equal area, not its real shape, " +
    "and the shaded band marks the <em>approximate</em> longitude of the current RMM phase when the MJO is active. " +
    "Drag to pan, scroll or +/− to zoom; click a track for that system's details.");

  setTime(ui.t);
  drawOthers();
  applyZoomStyles();
}

function stop() {
  if (ui.playing) { ui.playing.stop(); ui.playing = null; }
  ui.stopBtn?.text("▶").attr("aria-label", "Play");
}
