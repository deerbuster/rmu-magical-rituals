import { getSpellDuration } from "/systems/rmu/module/rmu/spells/spell-duration.js";
import { DURATION_LADDER } from "./ritual-calculator.js";

const UNIT_SECONDS = [6, 60, 600, 1800, 3600, 86400, 604800, 2592000, 31536000, 315360000, 3153600000, 31536000000];
const EVENT_UNITS = new Set(["action", "fall", "maneuver", "reading", "sleep", "vision"]);

function ladderPosition(parsed) {
  const unit = String(parsed?.unit ?? "").toLowerCase().replace(/\/lvl$/, "");
  const value = Math.max(1, Number(parsed?.value) || 1);
  if (["rnd", "rnds", "round", "rounds"].includes(unit)) return { index: 0, count: value };
  if (["min", "mins", "minute", "minutes"].includes(unit)) {
    if (value === 10) return { index: 2, count: 1 };
    if (value === 30) return { index: 3, count: 1 };
    return { index: 1, count: value };
  }
  if (["hr", "hrs", "hour", "hours"].includes(unit)) return { index: 4, count: value };
  if (["day", "days"].includes(unit)) return { index: 5, count: value };
  if (["wk", "wks", "week", "weeks"].includes(unit)) return { index: 6, count: value };
  if (["mo", "mon", "month", "months"].includes(unit)) return { index: 7, count: value };
  if (["year", "years"].includes(unit)) return { index: 8, count: value };
  if (["decade", "decades"].includes(unit)) return { index: 9, count: value };
  if (["century", "centuries"].includes(unit)) return { index: 10, count: value };
  if (["millennium", "millennia"].includes(unit)) return { index: 11, count: value };
  return null;
}

function permanentDuration(source, concentration = false) {
  return {
    source,
    label: `Permanent${concentration ? " (C)" : ""}`,
    totalLabel: `Permanent${concentration ? "; concentration required" : ""}`,
    seconds: null,
    supported: true,
    permanent: true,
    concentration
  };
}

function rejectedExtension(source, label, reason) {
  return {
    source,
    label,
    totalLabel: reason,
    seconds: null,
    supported: false,
    extensionRejected: true,
    rejectionReason: reason
  };
}

export function ritualSpellDuration(spell, steps = 0, casterLevel = 1, concentrationToRoundsPerLevel = false) {
  const source = String(spell?.duration ?? "").trim();
  if (!source) return null;
  const spellName = String(spell?.spellName ?? spell?.name ?? "").trim().toLowerCase();
  const listName = String(spell?.spellListName ?? spell?.spellList ?? "").trim().toLowerCase();
  const stepCount = Math.max(0, Math.trunc(Number(steps) || 0));
  const level = Math.max(1, Math.trunc(Number(casterLevel) || 1));
  const protectionsPrayerDuration = [
    "prayer i", "prayer iii", "prayer v",
    "bless i", "bless iii", "bless v",
    "resistance i", "resistance iii", "resistance v",
    "heat resistance", "cold resistance"
  ].includes(spellName);
  if (source.toLowerCase() === "varies" && listName === "protections" && protectionsPrayerDuration) {
    const stationary = ritualSpellDuration({ duration: "10 min/lvl" }, stepCount, level);
    const self = ritualSpellDuration({ duration: "1 min/lvl" }, stepCount, level);
    const mobile = concentrationToRoundsPerLevel
      ? ritualSpellDuration({ duration: "1 rnd/lvl" }, stepCount, level)
      : { label: "Concentration", totalLabel: "Concentration" };
    return {
      source,
      label: `Varies: ${mobile.label} while mobile; ${stationary.label} while stationary; ${self.label} when cast on self`,
      totalLabel: "Choose when applying",
      seconds: null,
      supported: true,
      choiceRequired: "protections-prayer-duration",
      perLevel: true,
      level
    };
  }

  const parsed = getSpellDuration(source, 1, 0, 0) ?? {};
  const normalized = source.toLowerCase();
  if (normalized === "p" || normalized === "p(c)") {
    if (stepCount) return rejectedExtension(source, source, "Permanent durations cannot be extended.");
    return permanentDuration(source, parsed.hasConcentrate === true);
  }

  if (normalized === "c") {
    if (concentrationToRoundsPerLevel) return ritualSpellDuration({ duration: "1 rnd/lvl" }, stepCount, level);
    if (stepCount) return rejectedExtension(source, "Concentration", "Convert Concentration to 1 round per level before applying duration steps.");
    return {
      source,
      label: "Concentration",
      totalLabel: "Concentration (remove when concentration ends)",
      seconds: null,
      supported: true,
      concentration: true
    };
  }

  if (!parsed.duration) return { source, label: source, seconds: null, supported: false };
  if (parsed.hasFail) {
    return {
      source,
      label: source,
      totalLabel: `Duration depends on RR failure by ${parsed.fail}`,
      seconds: null,
      supported: false,
      choiceRequired: "rr-failure-duration"
    };
  }
  if (parsed.note === "or" && parsed.hasConcentrate) {
    return {
      source,
      label: source,
      totalLabel: "Choose the fixed duration or Concentration when applying",
      seconds: null,
      supported: false,
      choiceRequired: "fixed-or-concentration"
    };
  }
  if (["varies", "varies(c)", "special"].includes(normalized)) {
    return { source, label: source, seconds: null, supported: false, concentration: parsed.hasConcentrate === true };
  }

  const eventUnit = String(parsed.unit ?? "").toLowerCase().replace(/\/lvl$/, "");
  if (EVENT_UNITS.has(eventUnit) || normalized === "sleep") {
    if (stepCount) return rejectedExtension(source, source, `${source} is event-based and has no duration-ladder step.`);
    return {
      source,
      label: source,
      totalLabel: `${source} (remove when the event ends)`,
      seconds: null,
      supported: true,
      eventBased: true,
      concentration: parsed.hasConcentrate === true
    };
  }

  const position = ladderPosition(parsed);
  if (!position) return { source, label: source, seconds: null, supported: false, concentration: parsed.hasConcentrate === true };
  const index = Math.min(DURATION_LADDER.length - 1, position.index + stepCount);
  if (index === DURATION_LADDER.length - 1) return permanentDuration(source, parsed.hasConcentrate === true);

  const unit = DURATION_LADDER[index];
  const perLevel = parsed.hasLvl === true;
  const formula = `${position.count === 1 ? unit : `${position.count} ${unit.replace(/^1 /, "")}`}${perLevel ? " per level" : ""}${parsed.hasConcentrate ? " (C)" : ""}`;
  const seconds = position.count * UNIT_SECONDS[index] * (perLevel ? level : 1);
  const amount = position.count * (perLevel ? level : 1);
  const singular = unit.replace(/^1 /, "");
  const totalLabel = `${amount} ${amount === 1 ? singular.replace(/s$/, "") : singular.replace(/s?$/, "s")}${parsed.hasConcentrate ? "; concentration required" : ""}`;
  return {
    source,
    label: formula,
    totalLabel,
    seconds,
    supported: true,
    perLevel,
    level,
    concentration: parsed.hasConcentrate === true
  };
}
