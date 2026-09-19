// Page state, URL hash, and wiring between the views.
// The hash (#from=2011-10-01&days=120&m=rmm,lpt&src=imerg&sel=…) makes every view a shareable link.
import { loadAll, loadLpt, parseDay, addDays, DAY_MS, fmtRange, hashFor, coverageText } from "./data.js";
import { nowSentence } from "./now.js";
import { drawTimeline, drawHovmoller, drawPhase, drawList, hideTip } from "./charts.js";
import { drawMap } from "./map.js";
import { drawDetail } from "./detail.js";
import { drawForecast } from "./forecast.js";

const MIN_DAYS = 30, MAX_DAYS = 365, DEFAULT_DAYS = 120;
const hashParam = (k) => new URLSearchParams(location.hash.slice(1)).get(k);
const data = await loadAll(hashParam("src")).catch((err) => {
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
  const h = hashFor(state.t0, Math.round((state.t1 - state.t0) / DAY_MS), state.methods) +
    `&src=${data.lptSrc.id}` + (selected ? `&sel=${selected}` : "");
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
  renderDetail();
  drawForecast("#forecast", data);
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

// the selected LPT system (details panel); part of the URL as &sel=
let selected = hashParam("sel");
let byId = new Map(data.lpt.map((s) => [s.id, s]));

// switch the LPT database (IMERG V7 / TMPA); selection ids differ between them
async function setSource(id, push = true) {
  const src = data.lptSources.find((x) => x.id === id);
  if (!src || src === data.lptSrc) return;
  data.lptSrc = src;
  data.lpt = await loadLpt(src.id);
  byId = new Map(data.lpt.map((s) => [s.id, s]));
  if (!byId.has(selected)) selected = null;
  document.getElementById("lpt-src").value = src.id;
  writeAbout();
  render(push);
}
const srcSel = document.getElementById("lpt-src");
srcSel.innerHTML = data.lptSources.map((x) => `<option value="${x.id}">${x.label}, ${coverageText(x)}</option>`).join("");
srcSel.value = data.lptSrc.id;
srcSel.addEventListener("change", () => setSource(srcSel.value));
function renderDetail() {
  drawDetail("#detail", data, byId.get(selected), {
    onClose: () => select(null),
    onShow: () => { const s = byId.get(selected); if (s) pickEvent(s); },
  });
}
function select(id, scroll = true) {
  selected = byId.has(id) ? id : null;
  writeHash(false);
  renderDetail();
  if (selected && scroll) document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.addEventListener("mjo:select", (ev) => select(ev.detail));

function pickEvent(ev) {
  const len = Math.max(MIN_DAYS, Math.round((ev.t1 - ev.t0) / DAY_MS) + 20);
  const t0 = addDays(ev.t0, -10);
  setWindow(t0, addDays(t0, len));
  highlight(ev.id);
  // the list was redrawn; keep keyboard focus on the row that was picked
  document.querySelector(`#events li[data-id="${ev.id}"]`)?.focus({ preventScroll: true });
  if (ev.method === "lpt" && selected !== ev.id) select(ev.id, false);
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
  if (s) {
    selected = hashParam("sel");
    state.methods = s.methods;
    const src = hashParam("src");
    if (src && src !== data.lptSrc.id) { [state.t0, state.t1] = clampWindow(s.t0, s.t1); setSource(src, false); }
    else setWindow(s.t0, s.t1, false);
  }
});

// data and methods (the About content, laid out as a methods section)
function writeAbout() {
  const [rmmM, lptM] = data.manifest.methods, src = data.lptSrc;
  const r = rmmM.event_rule;
  const cite = (id, txt) => `<a href="#ref-${id}">${txt}</a>`;
  const srcRows = data.lptSources.map((x) => `<li><b>${x.label}</b>${x === src ? " (shown)" : ""}: ${x.long_name},
    ${coverageText(x)}; ${x.n_systems} MJO systems and ${x.n_other} other systems lasting ≥ 3 days${x.outlines ? "; real rain-area outlines from the per-system mask files" : ""}.</li>`).join("");
  document.getElementById("about").innerHTML = `
  <h3>RMM index</h3>
  <p>The ${rmmM.long_name.replace("(Wheeler & Hendon 2004)", `(${cite("wh04", "Wheeler &amp; Hendon 2004")})`)} is used daily
    from ${rmmM.coverage.join(" to ")}, as published by the <a href="${rmmM.source}">Australian Bureau of Meteorology</a>.
    An <em>RMM event</em> here is a spell with amplitude ≥ ${r.min_amp} (dips of ≤ ${r.gap_days} days allowed) that lasts
    at least ${r.min_days} days and advances at least ${r.min_east_deg}° eastward around the phase diagram; the record
    contains ${rmmM.n_events} such events.</p>
  <h3>Large-scale Precipitation Tracking</h3>
  <p>${lptM.long_name.replace("(Kerns & Chen 2016, 2020)", `(${cite("kc16", "Kerns &amp; Chen 2016")}, ${cite("kc20", "2020")})`)}
    follows contiguous areas of heavy time-averaged rain. Two databases are available (switch with the selector next to the
    LPT button); both come from <a href="${src.source_url}">LPT data access (Kerns, University of Washington)</a>:</p>
  <ul>${srcRows}</ul>
  <p>The non-MJO systems are shown on the map when switched on. A system can have several eastward-propagation
    segments, and the event table lists one row per segment. The two databases use different rainfall products and
    tracking settings, so their systems and identifiers differ.</p>
  <h3>Caveats</h3>
  <ul class="caveats">
    <li><b>Approximate RMM longitude.</b> RMM is an index, not a location. On the Hovmöller diagram and map its days are
      placed at the longitude where each phase's rain usually sits (${cite("wh04", "Wheeler &amp; Hendon 2004")} composites),
      so read the RMM marks as approximate.</li>
    <li><b>LPT coverage.</b> The ${src.label} tracks shown cover ${coverageText(src)} only; windows outside that period show RMM alone.</li>
    <li><b>Rain areas.</b> ${src.outlines ? "Outlines in the system detail figure are the real mask edges, every 6 h; the map's moving discs are circles of equal area." : "Rain areas are drawn as circles of equal area, not the systems' real shapes (real outlines are available for IMERG V7)."}</li>
    <li><b>ENSO removal.</b> ${rmmM.note}</li>
  </ul>`;
  document.querySelectorAll(".lpt-cov").forEach((el) => { el.textContent = coverageText(src); });
}
writeAbout();
document.getElementById("cite-url").textContent = location.href.split("#")[0];
document.getElementById("cite-date").textContent = d3.utcFormat("%-d %B %Y")(new Date());
document.getElementById("now").innerHTML = nowSentence(data.days);
document.getElementById("built").textContent = `Data built ${data.manifest.built}.`;

// colour theme: auto (system) → light → dark; charts redraw because some colours are computed
const themeBtn = document.getElementById("theme");
const THEMES = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };
function setTheme(t, save = true) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  themeBtn.textContent = THEMES[t];
  themeBtn.setAttribute("aria-label", `Colour theme: ${t}. Click to change.`);
  if (save) try { localStorage.setItem("theme", t); } catch {}
}
setTheme(document.documentElement.dataset.theme ?? "auto", false);
themeBtn.addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  setTheme(order[(order.indexOf(document.documentElement.dataset.theme ?? "auto") + 1) % 3]);
  render();
});

// charts are sized to their containers, so redraw when the width changes
let lastW = innerWidth, resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; render(); } }, 150);
});

render();
