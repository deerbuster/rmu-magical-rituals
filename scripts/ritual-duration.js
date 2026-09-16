import { DURATION_LADDER } from "./ritual-calculator.js";

const UNIT_SECONDS = [6, 60, 600, 1800, 3600, 86400, 604800, 2592000, 31536000, 315360000, 3153600000, 31536000000];

function unitIndex(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  const units = [
    /^rounds?\b|^rnds?\b/, /^minutes?\b|^mins?\b/, /^10\s*(?:minutes?|mins?)\b/,
    /^30\s*(?:minutes?|mins?)\b/, /^hours?\b|^hrs?\b/, /^days?\b/,
    /^weeks?\b/, /^months?\b/, /^years?\b/, /^decades?\b/, /^centur(?:y|ies)\b/,
    /^millenn(?:ium|ia)\b/
  ];
  if (/^(?:permanent|perm)\b/.test(raw)) return 12;
  const special = raw.match(/^(10|30)\s*(?:minutes?|mins?)\b/);
  if (special) return Number(special[1]) === 10 ? 2 : 3;
  return units.findIndex(pattern => pattern.test(raw));
}

export function ritualSpellDuration(spell, steps = 0, casterLevel = 1) {
  const source = String(spell?.duration ?? "").trim();
  if (!source) return null;
  const match = source.match(/^(\d+)?\s*(rounds?|rnds?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|decades?|centur(?:y|ies)|millenn(?:ium|ia)|permanent|perm)(?:\s*\/\s*(?:level|lvl|lv|l))?/i);
  if (!match) return { source, label: source, seconds: null, supported: false };
  const perLevel = /(?:\/\s*(?:level|lvl|lv|l)|\bper\s+level)\b/i.test(source);
  let count = Number(match[1] ?? 1);
  let base = unitIndex(match[2]);
  if (/^(?:minutes?|mins?)$/i.test(match[2]) && (count === 10 || count === 30)) {
    base = count === 10 ? 2 : 3;
    count = 1;
  }
  if (base < 0) return { source, label: source, seconds: null, supported: false };
  const stepCount = Math.max(0, Math.trunc(Number(steps) || 0));
  const index = Math.min(DURATION_LADDER.length - 1, base + stepCount);
  const unit = DURATION_LADDER[index];
  const formula = `${count === 1 ? unit : `${count} ${unit.replace(/^1 /, "")}`}${perLevel ? " per level" : ""}`;
  const level = Math.max(1, Math.trunc(Number(casterLevel) || 1));
  const seconds = index < UNIT_SECONDS.length ? count * UNIT_SECONDS[index] * (perLevel ? level : 1) : null;
  const amount = count * (perLevel ? level : 1);
  const singular = unit.replace(/^1 /, "");
  const totalLabel = `${amount} ${amount === 1 ? singular.replace(/s$/, "") : singular.replace(/s?$/, "s")}`;
  return { source, label: formula, totalLabel, seconds, supported: seconds !== null, perLevel, level };
}
