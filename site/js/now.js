// The plain-language "right now" line at the top of the page, from the latest RMM day.
// RMM only, dated, and descriptive: it says where the MJO is, never where it will go.
import { DAY_MS, fmtDay, PHASE_REGION } from "./data.js";

const STALE_DAYS = 4; // BoM usually lags 1–2 days

export function nowSentence(days) {
  const i = days.findLastIndex((d) => d.amp !== null);
  const d = days[i];
  const strength = `strength ${d.amp.toFixed(1)}`;
  let text;
  if (d.amp >= 1) {
    text = `the MJO is <b>active over the ${PHASE_REGION[d.phase]}</b> (phase ${d.phase}, ${strength})${motion(days, i)}.`;
  } else {
    text = `the MJO is <b>weak</b> (${strength}; below 1 counts as inactive).`;
    const j = days.findLastIndex((x) => x.amp !== null && x.amp >= 1);
    if (j >= 0) {
      const p = days[j];
      text += ` It was last active over the ${PHASE_REGION[p.phase]} around ${fmtDay(p.date)}.`;
    }
  }
  const age = Math.floor((Date.now() - d.date) / DAY_MS);
  const stale = age > STALE_DAYS
    ? ` <span class="stale">Data is ${age} days old — the daily update may have failed.</span>` : "";
  return `<span class="now-label">Current state (RMM, ${fmtDay(d.date)}).</span> ${text[0].toUpperCase()}${text.slice(1)}${stale}`;
}

// eastward / westward / stalled over the last week, from the unwrapped phase angle
function motion(days, i) {
  const wk = days.slice(Math.max(0, i - 7), i + 1).filter((d) => d.angle !== null);
  if (wk.length < 5) return "";
  let turn = 0;
  for (let k = 1; k < wk.length; k++) {
    let da = wk[k].angle - wk[k - 1].angle;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    turn += da;
  }
  const dAmp = wk.at(-1).amp - wk[0].amp;
  const dir = turn > 20 ? "moving east" : turn < -20 ? "drifting west" : "roughly stationary";
  const trend = dAmp > 0.3 ? ", strengthening" : dAmp < -0.3 ? ", weakening" : "";
  return ` and ${dir}${trend} over the past week`;
}
