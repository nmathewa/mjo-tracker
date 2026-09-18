// Page state, URL hash, and wiring between the views.
// The hash (#from=2011-10-01&days=120&m=rmm,lpt) makes every view a shareable link.
import { loadAll, parseDay, addDays, DAY_MS, fmtRange } from "./data.js";
import { drawTimeline, drawHovmoller, drawPhase, drawMap, drawList } from "./charts.js";

const MIN_DAYS = 30, MAX_DAYS = 365, DEFAULT_DAYS = 120;
const data = await loadAll().catch((err) => {
  document.querySelector(".grid").innerHTML = `<p class="card">Could not load data: ${err.message}</p>`;
  throw err;
});
const first = data.days[0].date, last = addDays(data.days.at(-1).date, 1);

const state = readHash() ?? {
  t0: addDays(last, -DEFAULT_DAYS), t1: last, methods: new Set(["rmm", "lpt"]),
};

function clampWindow(a, b) {
  let len = Math.round((b - a) / DAY_MS);
  len = Math.max(MIN_DAYS, Math.min(MAX_DAYS, len));
  let t0 = d3.utcDay.round(a);
  if (t0 < first) t0 = first;
  if (addDays(t0, len) > last) t0 = addDays(last, -len);
  return [t0, addDays(t0, len)];
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has("from")) return null;
  const t0 = parseDay(p.get("from"));
  if (isNaN(t0)) return null;
  const days = +p.get("days") || DEFAULT_DAYS;
  const m = p.get("m");
  return { t0, t1: addDays(t0, days), methods: new Set(m ? m.split(",") : ["rmm", "lpt"]) };
}

function writeHash() {
  const p = new URLSearchParams({
    from: d3.utcFormat("%Y-%m-%d")(state.t0),
    days: Math.round((state.t1 - state.t0) / DAY_MS),
    m: [...state.methods].join(","),
  });
  history.replaceState(null, "", `#${p}`);
}

function setWindow(a, b) {
  [state.t0, state.t1] = clampWindow(a, b);
  // charts are sized to their containers, so redraw when the width changes
let lastW = innerWidth, resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; render(); } }, 150);
});

render();
}

function render() {
  writeHash();
  drawTimeline("#timeline", data, state, setWindow);
  drawHovmoller("#hovmoller", data, state);
  drawPhase("#phase", data, state);
  drawMap("#map", data, state);
  drawList("#events", data, state, pickEvent);
  document.getElementById("window-label").value = fmtRange(state.t0, addDays(state.t1, -1));
  applyMethods();
}

function pickEvent(ev) {
  const len = Math.max(MIN_DAYS, Math.round((ev.t1 - ev.t0) / DAY_MS) + 20);
  const t0 = addDays(ev.t0, -10);
  setWindow(t0, addDays(t0, len));
  highlight(ev.id);
}

function applyMethods() {
  for (const m of ["rmm", "lpt"]) {
    document.querySelectorAll(`.${m}-only`).forEach((el) => el.classList.toggle("hidden-method", !state.methods.has(m)));
  }
  document.querySelectorAll('input[name="method"]').forEach((el) => { el.checked = state.methods.has(el.value); });
}

// cross-view highlight by data-id
function highlight(id) {
  document.querySelectorAll(".mark").forEach((el) => {
    const on = id && el.dataset.id === id;
    el.classList.toggle("is-hl", !!on);
    el.classList.toggle("is-dim", !!id && !on && el.dataset.id !== undefined && !el.matches("li"));
  });
}
document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest(".mark[data-id]");
  highlight(el ? el.dataset.id : null);
});
document.addEventListener("focusin", (ev) => {
  const el = ev.target.closest(".mark[data-id]");
  if (el) highlight(el.dataset.id);
});

// controls
document.querySelectorAll('input[name="method"]').forEach((el) => el.addEventListener("change", () => {
  el.checked ? state.methods.add(el.value) : state.methods.delete(el.value);
  drawList("#events", data, state, pickEvent);
  applyMethods();
  writeHash();
}));
document.getElementById("preset").addEventListener("change", (ev) => {
  const v = ev.target.value;
  if (!v) return;
  if (v === "latest") setWindow(addDays(last, -DEFAULT_DAYS), last);
  else setWindow(parseDay(v), addDays(parseDay(v), DEFAULT_DAYS));
  ev.target.value = "";
});
const step = (dir) => {
  const len = state.t1 - state.t0;
  setWindow(new Date(+state.t0 + dir * len / 2), new Date(+state.t1 + dir * len / 2));
};
document.getElementById("prev").addEventListener("click", () => step(-1));
document.getElementById("next").addEventListener("click", () => step(1));
document.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input, select, textarea")) return;
  if (ev.key === "ArrowLeft") step(-1);
  if (ev.key === "ArrowRight") step(1);
});
window.addEventListener("hashchange", () => {
  const s = readHash();
  if (s) { Object.assign(state, s); setWindow(s.t0, s.t1); }
});

// about
const [rmmM, lptM] = data.manifest.methods;
const r = rmmM.event_rule;
document.getElementById("about").innerHTML = `<dl>
  <dt>RMM</dt><dd>${rmmM.long_name}, daily, ${rmmM.coverage.join(" to ")}. Source: <a href="${rmmM.source}">Bureau of Meteorology</a>.
    ${rmmM.note} An <em>event</em> here is a spell with amplitude ≥ ${r.min_amp} (dips ≤ ${r.gap_days} days allowed)
    lasting at least ${r.min_days} days and moving at least ${r.min_east_deg}° eastward around the phase diagram
    (${rmmM.n_events} events).</dd>
  <dt>LPT</dt><dd>${lptM.long_name}: rain systems tracked in ${lptM.source}. ${lptM.n_systems} MJO systems, ${lptM.coverage.join(" to ")};
    full centroid tracks loaded for ${lptM.n_full_tracks} of them (Jun 2011 – Jun 2012).</dd>
  <dt>Hovmöller</dt><dd>RMM is an index, not a location. Its days are placed at the longitude where each phase's
    rain usually sits (Wheeler &amp; Hendon 2004 composites), so read the orange dots as approximate.</dd>
</dl>`;
document.getElementById("built").textContent = `Data built ${data.manifest.built}.`;

// charts are sized to their containers, so redraw when the width changes
let lastW = innerWidth, resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; render(); } }, 150);
});

render();
