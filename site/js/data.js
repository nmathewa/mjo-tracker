// Loads the JSON written by pipeline/build.py and puts it in one shape for the charts.
const DAY = 86400000;

const get = (f) => fetch(`data/${f}`).then((r) => {
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json();
});

// srcId picks the LPT database (manifest.methods[1].sources); unknown ids fall back to the first
export async function loadAll(srcId) {
  const [manifest, rmm, rmmEvents, land] = await Promise.all([
    get("manifest.json"), get("rmm.json"), get("rmm_events.json"),
    fetch("vendor/land-110m.json").then((r) => r.json()),
  ]);
  const lptSources = manifest.methods.find((m) => m.id === "lpt").sources;
  const lptSrc = lptSources.find((x) => x.id === srcId) ?? lptSources[0];
  const lpt = await loadLpt(lptSrc.id);

  const t0 = parseDay(rmm.start);
  const days = rmm.rmm1.map((r1, i) => {
    const r2 = rmm.rmm2[i];
    const ok = r1 !== null && r2 !== null;
    const angle = ok ? Math.atan2(r2, r1) * 180 / Math.PI : null;
    return {
      date: new Date(t0.getTime() + i * DAY),
      rmm1: r1, rmm2: r2,
      amp: ok ? Math.hypot(r1, r2) : null,
      angle,
      phase: ok ? phaseOf(angle) : null,
      event: null,
    };
  });
  for (const e of rmmEvents) {
    e.method = "rmm";
    e.t0 = parseDay(e.start);
    e.t1 = new Date(parseDay(e.end).getTime() + DAY);
    const i0 = Math.round((e.t0 - t0) / DAY), i1 = Math.round((e.t1 - t0) / DAY);
    for (let i = i0; i < i1; i++) days[i].event = e.id;
  }
  return { manifest, days, t0, rmmEvents, lpt, land, lptSources, lptSrc };
}

// MJO systems of one LPT database, prepared once and cached
const lptCache = {};
export function loadLpt(id) {
  lptCache[id] ??= get(`lpt_mjo_${id}.json`).then((list) => {
    for (const s of list) {
      s.method = "lpt";
      s.t0 = new Date(s.begin);
      s.t1 = new Date(s.end);
      for (const e of s.eprop) { e.t0 = new Date(e.begin); e.t1 = new Date(e.end); }
      if (s.track) s.track = unpackTrack(s.track);
    }
    return list;
  });
  return lptCache[id];
}

// "Jan 1998 – Aug 2026"
export const coverageText = (src) => src.coverage.map((d) => d3.utcFormat("%b %Y")(parseDay(d))).join(" – ");

// {t0, p: [[hours, lat, lon, area 1e3 km2], ...]} -> [{ t, lat, lon, area (km2) }]
function unpackTrack({ t0, p }) {
  const base = new Date(t0).getTime();
  return p.map(([h, lat, lon, a]) => ({ t: new Date(base + h * 3600e3), lat, lon, area: a * 1e3 }));
}

// Non-MJO LPT systems, stored by start year and loaded only for the years a window needs
// (plus the year before, for systems that started earlier).
const otherCache = {};
export async function loadOthers(src, t0, t1) {
  const years = d3.range(t0.getUTCFullYear() - 1, t1.getUTCFullYear() + 1).map(String)
    .filter((y) => src.other_years.includes(y));
  const lists = await Promise.all(years.map((y) => {
    otherCache[`${src.id}/${y}`] ??= get(`lpt_other/${src.id}/${y}.json`).then((list) => list.map((s) => ({
      ...s, method: "lpt-other", t0: new Date(s.begin), t1: new Date(s.end), track: unpackTrack(s.track),
    })));
    return otherCache[`${src.id}/${y}`];
  }));
  return lists.flat();
}

// Real rain-area outlines of one system (pipeline/outlines.py), or null if not extracted.
// -> [{ t, rings: [[[lon, lat], ...], ...] }]
export async function loadOutline(src, id) {
  if (!src.outlines) return null;
  const r = await fetch(`data/outlines/${src.id}/${id}.json`);
  if (!r.ok) return null;
  const d = await r.json(), base = new Date(d.t0).getTime();
  return d.h.map((h, i) => ({
    t: new Date(base + h * 3600e3),
    rings: d.rings[i].map((flat) => d3.range(0, flat.length, 2).map((k) => [flat[k], flat[k + 1]])),
  }));
}

// Higher-resolution coastlines for zoomed-in maps, loaded on first zoom.
let land50P = null;
export const loadLand50 = () => (land50P ??= fetch("vendor/land-50m.json").then((r) => r.json()));

export const parseDay = (s) => new Date(`${s}T00:00Z`);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const DAY_MS = DAY;

export function phaseOf(angleDeg) {
  return (Math.floor((angleDeg + 180) / 45) % 8 + 8) % 8 + 1;
}

// Approximate longitude of enhanced convection for an RMM phase angle, from the
// Wheeler & Hendon (2004) composites: phases 2–3 Indian Ocean, 4–5 Maritime
// Continent, 6–7 western Pacific, 8–1 western hemisphere and Africa.
// Knots sit at the phase centres; between them it is linear.
const KNOT_ANGLE = [-157.5, -112.5, -67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5];
const KNOT_LON = [20, 65, 85, 105, 125, 145, 165, 210, 380];
export function phaseLon(angleDeg) {
  let a = angleDeg < KNOT_ANGLE[0] ? angleDeg + 360 : angleDeg;
  let k = 0;
  while (k < KNOT_ANGLE.length - 2 && a > KNOT_ANGLE[k + 1]) k++;
  const f = (a - KNOT_ANGLE[k]) / (KNOT_ANGLE[k + 1] - KNOT_ANGLE[k]);
  return (KNOT_LON[k] + f * (KNOT_LON[k + 1] - KNOT_LON[k])) % 360;
}

export const PHASE_REGION = {
  1: "Western Hemisphere and Africa", 2: "Indian Ocean", 3: "Indian Ocean", 4: "Maritime Continent",
  5: "Maritime Continent", 6: "Western Pacific", 7: "Western Pacific", 8: "Western Hemisphere and Africa",
};

export const REGIONS = [
  { name: "Africa", lon: [10, 45] },
  { name: "Indian Ocean", lon: [50, 95] },
  { name: "Maritime Cont.", lon: [95, 150] },
  { name: "W. Pacific", lon: [150, 190] },
  { name: "E. Pacific", lon: [190, 270] },
  { name: "Americas / Atl.", lon: [270, 350] },
];

const fmt = d3.utcFormat("%-d %b %Y");
export const fmtDay = (d) => fmt(d);
export const fmtRange = (a, b) => `${fmt(a)} – ${fmt(b)}`;

// The URL hash for a view (main.js reads and writes it; charts use it for "see …" links).
export function hashFor(t0, days, methods) {
  return `#from=${d3.utcFormat("%Y-%m-%d")(t0)}&days=${days}&m=${["rmm", "lpt"].filter((k) => methods.has(k)).join(",")}`;
}
