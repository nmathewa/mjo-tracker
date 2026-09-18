// Loads the JSON written by pipeline/build.py and puts it in one shape for the charts.
const DAY = 86400000;

export async function loadAll() {
  const get = (f) => fetch(`data/${f}`).then((r) => {
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    return r.json();
  });
  const [manifest, rmm, rmmEvents, lpt, land] = await Promise.all([
    get("manifest.json"), get("rmm.json"), get("rmm_events.json"), get("lpt_mjo.json"),
    fetch("vendor/land-110m.json").then((r) => r.json()),
  ]);

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
  for (const s of lpt) {
    s.method = "lpt";
    s.t0 = new Date(s.begin);
    s.t1 = new Date(s.end);
    for (const e of s.eprop) { e.t0 = new Date(e.begin); e.t1 = new Date(e.end); }
    if (s.track) s.track = s.track.map(([t, lat, lon, area]) => ({ t: new Date(t), lat, lon, area }));
  }
  return { manifest, days, t0, rmmEvents, lpt, land };
}

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
  1: "W. Hemisphere & Africa", 2: "Indian Ocean", 3: "Indian Ocean", 4: "Maritime Continent",
  5: "Maritime Continent", 6: "Western Pacific", 7: "Western Pacific", 8: "W. Hemisphere & Africa",
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
