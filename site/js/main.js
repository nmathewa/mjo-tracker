// Page state, URL hash, and wiring between the views.
// The hash (#from=2011-10-01&days=120&m=rmm,lpt) makes every view a shareable link.
import { loadAll, parseDay, addDays, DAY_MS, fmtRange, hashFor } from "./data.js";
import { drawTimeline, drawHovmoller, drawPhase, drawMap, drawList, hideTip } from "./charts.js";

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
  // "m=" (both methods off) is a valid state; only a missing m means the default
  const m = p.has("m") ? p.get("m").split(",").filter((k) => k === "rmm" || k === "lpt") : ["rmm", "lpt"];
  return { t0, t1: addDays(t0, days), methods: new Set(m) };
}

// Window changes push a history entry so Back returns to the previous window.
// push = true | "burst" | false; a quick run of "burst" steps (holding an arrow key)
// collapses into one entry.
let lastBurst = 0;
function writeHash(push) {
  const h = hashFor(state.t0, Math.round((state.t1 - state.t0) / DAY_MS), state.methods);
  if (h === location.hash) return;
  const now = Date.now(), coalesce = push === "burst" && now - lastBurst < 800;
  lastBurst = push === "burst" ? now : 0;
  if (push && !coalesce) history.pushState(null, "", h);
  else history.replaceState(null, "", h);
}

function setWindow(a, b, push = true) {
  [state.t0, state.t1] = clampWindow(a, b);
  render(push);
}

function render(push = false) {
  writeHash(push);
  hideTip();
  drawTimeline("#timeline", data, state, setWindow);
  drawHovmoller("#hovmoller", data, state);
  drawPhase("#phase", data, state);
  drawMap("#map", data, state);
  drawList("#events", data, state, pickEvent);
  fitHovmoller();
  const label = fmtRange(state.t0, addDays(state.t1, -1));
  document.getElementById("window-label").value = label;
  document.getElementById("timeline").setAttribute("aria-valuetext", label);
  applyMethods();
}

// Two-column layout: grow the Hovmöller so its card ends level with the phase + list
// column instead of leaving a blank block under its legend.
function fitHovmoller() {
  const hov = document.querySelector(".hov-card");
  if (getComputedStyle(document.querySelector(".grid")).gridTemplateColumns.split(" ").length < 2) return;
  const phase = document.querySelector(".phase-card").getBoundingClientRect();
  const list = document.querySelector(".list-card"), ul = list.querySelector("ul");
  const listH = ul.getBoundingClientRect().bottom - list.getBoundingClientRect().top + parseFloat(getComputedStyle(list).paddingBottom) + 1;
  const gap = parseFloat(getComputedStyle(document.querySelector(".grid")).rowGap);
  const extra = Math.floor(phase.height + gap + listH - hov.getBoundingClientRect().height);
  if (extra > 4) drawHovmoller("#hovmoller", data, state, extra);
}

function pickEvent(ev) {
  const len = Math.max(MIN_DAYS, Math.round((ev.t1 - ev.t0) / DAY_MS) + 20);
  const t0 = addDays(ev.t0, -10);
  setWindow(t0, addDays(t0, len));
  highlight(ev.id);
  // the list was redrawn; keep keyboard focus on the row that was picked
  document.querySelector(`#events li[data-id="${ev.id}"]`)?.focus({ preventScroll: true });
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
// touch: a tap on a mark shows its tooltip (charts.js); a tap anywhere else clears it,
// and a scroll hides it so it never floats over the wrong chart
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".tip-target")) { hideTip(); if (!ev.target.closest(".mark")) highlight(null); }
});
addEventListener("scroll", hideTip, { passive: true });

// controls
document.querySelectorAll('input[name="method"]').forEach((el) => el.addEventListener("change", () => {
  el.checked ? state.methods.add(el.value) : state.methods.delete(el.value);
  render();
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
  setWindow(new Date(+state.t0 + dir * len / 2), new Date(+state.t1 + dir * len / 2), "burst");
};
document.getElementById("prev").addEventListener("click", () => step(-1));
document.getElementById("next").addEventListener("click", () => step(1));
document.addEventListener("keydown", (ev) => {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return; // leave Alt+← (browser Back) alone
  if (ev.target.closest("input, select, textarea")) return;
  if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
  if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
});
// the archive strip is a keyboard control too: ←/→ step, PgUp/PgDn a full window,
// Home/End first/latest, +/− narrower/wider window
const tl = document.getElementById("timeline");
tl.setAttribute("tabindex", "0");
tl.setAttribute("role", "slider");
tl.setAttribute("aria-label", "Archive window. Arrow keys move it, plus and minus change its length, Home and End jump to the start or latest data");
tl.addEventListener("keydown", (ev) => {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
  const len = state.t1 - state.t0, mid = (+state.t0 + +state.t1) / 2;
  const act = {
    PageUp: () => setWindow(new Date(state.t0 - len), state.t0),
    PageDown: () => setWindow(state.t1, new Date(+state.t1 + len)),
    Home: () => setWindow(first, new Date(+first + len)),
    End: () => setWindow(new Date(last - len), last),
    "+": () => setWindow(new Date(mid - len / 4), new Date(mid + len / 4)),
    "=": () => setWindow(new Date(mid - len / 4), new Date(mid + len / 4)),
    "-": () => setWindow(new Date(mid - len), new Date(mid + len)),
  }[ev.key];
  if (act) { ev.preventDefault(); act(); }
});
// Back/Forward and pasted or clicked links (#from=…) land here
window.addEventListener("hashchange", () => {
  const s = readHash();
  if (s) { state.methods = s.methods; setWindow(s.t0, s.t1, false); }
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
