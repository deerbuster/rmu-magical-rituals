export const MODULE_ID = "rmu-magical-rituals";

export const RITUAL_CATEGORIES = [
  "Alteration", "Creation", "Defensive", "Destruction", "Elemental", "Healing",
  "Informational", "Summoning & Transportation"
];

export const REALMS = ["Channeling", "Essence", "Mentalism", "Hybrid", "Arcane/Other"];

export const LIST_TYPES = {
  ownBase: { label: "Own Base", mod: 10 },
  open: { label: "Open", mod: 0 },
  closed: { label: "Closed", mod: -10 },
  evilKnown: { label: "Evil Known", mod: -20 },
  evilUnknown: { label: "Evil Unknown", mod: -50 },
  otherBase: { label: "Other Base", mod: -40 },
  wrongRealm: { label: "Wrong Realm", mod: -50 }
};

export const KNOWLEDGE = {
  unknownList: { label: "Does not know list", mod: -50 },
  knowsListNotSpell: { label: "Knows list but not spell", mod: -30 },
  knowsToLevel: { label: "Knows list to spell level", mod: 0 },
  knowsBeyondLevel: { label: "Knows beyond spell level", mod: 0 }
};

export const TIME_TABLE = [
  { id: "3m", label: "3 minutes", minutes: 3, mod: 0, endurance: "" },
  { id: "7m", label: "7 minutes", minutes: 7, mod: 5, endurance: "" },
  { id: "30m", label: "30 minutes", minutes: 30, mod: 10, endurance: "" },
  { id: "1h", label: "1 hour", minutes: 60, mod: 15, endurance: "" },
  { id: "2h", label: "2 hours", minutes: 120, mod: 20, endurance: "" },
  { id: "4h", label: "4 hours", minutes: 240, mod: 25, endurance: "" },
  { id: "8h", label: "8 hours", minutes: 480, mod: 30, endurance: "Routine" },
  { id: "16h", label: "16 hours", minutes: 960, mod: 35, endurance: "Routine" },
  { id: "24h", label: "24 hours", minutes: 1440, mod: 40, endurance: "Easy" },
  { id: "3d", label: "3 days", minutes: 4320, mod: 45, endurance: "Medium" },
  { id: "7d", label: "7 days", minutes: 10080, mod: 50, endurance: "Hard" },
  { id: "9d", label: "9 days", minutes: 12960, mod: 55, endurance: "Hard" },
  { id: "1mo", label: "1 month", minutes: 43200, mod: 60, endurance: "Very Hard" },
  { id: "3mo", label: "3 months", minutes: 129600, mod: 65, endurance: "Very Hard" },
  { id: "1y", label: "1 year", minutes: 525600, mod: 70, endurance: "Extremely Hard" }
];

export const ITEM_TABLES = {
  tools: [
    { gp: 0, label: "<10 gp", mod: 0 }, { gp: 10, label: "10 gp", mod: 5 },
    { gp: 100, label: "100 gp", mod: 10 }, { gp: 1000, label: "1,000 gp", mod: 15 },
    { gp: 10000, label: "10,000 gp", mod: 20 }, { gp: 100000, label: "100,000 gp", mod: 25 },
    { gp: 1000000, label: "1,000,000 gp", mod: 30 }, { gp: 10000000, label: "10,000,000 gp", mod: 35 }
  ],
  sacrifices: [
    { sp: 0, label: "<1 sp", mod: 0 }, { sp: 1, label: "1 sp", mod: 5 },
    { sp: 10, label: "10 sp", mod: 10 }, { sp: 100, label: "100 sp", mod: 15 },
    { sp: 1000, label: "1,000 sp", mod: 20 }, { sp: 10000, label: "10,000 sp", mod: 25 },
    { sp: 100000, label: "100,000 sp", mod: 30 }, { sp: 1000000, label: "1,000,000 sp", mod: 35 }
  ]
};

export const DURATION_LADDER = [
  "1 round", "1 minute", "10 minutes", "30 minutes", "1 hour", "1 day",
  "1 week", "1 month", "1 year", "1 decade", "1 century", "1 millennium", "Permanent"
];

function n(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function row(label, value, group = "General", detail = "") {
  return { label, value: n(value), group, detail };
}

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function collectionToArray(value) {
  if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null);
  if (value && typeof value === "object") {
    return Object.entries(value)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .filter(v => v !== undefined && v !== null);
  }
  return [];
}

function realmKey(value) {
  const raw = norm(value);
  if (!raw) return "";
  if (raw.includes("channel")) return "channeling";
  if (raw.includes("essence")) return "essence";
  if (raw.includes("mental")) return "mentalism";
  if (raw.includes("hybrid")) return "hybrid";
  if (raw.includes("arcane") || raw.includes("other")) return "arcane";
  return raw.replace(/\s+/g, "-");
}

function isSameRealm(a, b) {
  const ak = realmKey(a);
  const bk = realmKey(b);
  if (!ak || !bk) return true;
  if (ak === "hybrid" || bk === "hybrid") return true;
  if (ak === "arcane" || bk === "arcane") return true;
  return ak === bk;
}

export class RitualCalculator {
  static defaultData(actor = null) {
    return {
      version: "2.1.0",
      name: "New Magical Ritual",
      category: "Healing",
      targetEffect: "",
      selectedSpellId: "",
      selectedSpellLabel: "",
      selectedSpells: [],
      selectedSpellList: "",
      selectedSpellCategory: "",
      spellLevel: 1,
      spellRealm: "Mentalism",
      casterRealm: actor ? (foundry.utils.getProperty(actor, "system.realm") ?? "") : "",
      spellListType: "open",
      spellKnowledge: "knowsToLevel",
      ranksBeyond: 0,
      casterLevel: 1,
      baseSkillBonus: 0,
      includedSpellEffects: 1,
      participants: actor ? [{
        actorId: actor.id,
        actorUuid: actor.uuid,
        actorName: actor.name,
        role: "primary",
        realm: foundry.utils.getProperty(actor, "system.realm") ?? "",
        ritualSkillBonus: 0,
        ritualRanks: 0,
        complementarySkillName: "",
        complementarySkillRanks: 0,
        ppContributed: 0,
        spellAdderChargesUsed: 0,
        bloodDice: 0,
        criticalSeverityBloodInvestment: 0
      }] : [],
      ppInvestment: { additionalPP: 0 },
      timeInvestment: { id: "3m" },
      bloodInvestment: { concussionDice: 0, criticalSeverity: 0 },
      itemInvestment: {
        toolValueGp: 0,
        sacrificeValueSp: 0,
        toolAppropriateness: "generally",
        sacrificeAppropriateness: "generally"
      },
      parameterExtensions: {
        weightDoublings: 0,
        criticalSeveritySteps: 0,
        concussionMultiplier: 1,
        areaDecrease: false,
        areaIncreaseDoublings: 0,
        rangeDoublings: 0,
        noDurationToOneRound: false,
        concentrationToRoundsPerLevel: false,
        removeConcentration: false,
        durationSteps: 0,
        selfSpellExpanded: false
      },
      realmsUsed: { channeling: false, essence: false, mentalism: false, hybrid: false, arcane: false },
      circumstances: [],
      notes: "",
      resistible: false
    };
  }

  static calculate(data = {}, options = {}) {
    const rows = [];
    const selectedSpells = collectionToArray(data.selectedSpells);
    const spellLevel = selectedSpells.length
      ? selectedSpells.reduce((s, sp) => s + Math.max(1, n(sp.level, 1)), 0)
      : n(data.spellLevel, 1);
    const casterLevel = n(data.casterLevel, 1);

    rows.push(row("Magical Ritual skill", data.baseSkillBonus, "Base", "Primary caster final roll skill bonus"));

    const diff = casterLevel - spellLevel;
    const relative = diff >= 0 ? diff : diff * 5;
    rows.push(row("Relative level", relative, "Base", diff >= 0 ? "+1 per level caster is above the spell" : "-5 per level caster is below the spell"));

    const know = KNOWLEDGE[data.spellKnowledge] ?? KNOWLEDGE.knowsToLevel;
    rows.push(row(`Knowledge: ${know.label}`, know.mod, "Base"));
    if (data.spellKnowledge === "knowsBeyondLevel") {
      rows.push(row("Ranks beyond spell level", data.ranksBeyond, "Base", "+1 per rank"));
    }

    const list = LIST_TYPES[data.spellListType] ?? LIST_TYPES.open;
    rows.push(row(`Spell list type: ${list.label}`, list.mod, "Base"));

    if (!isSameRealm(data.casterRealm, data.spellRealm)) {
      rows.push(row("Spell not from caster's own Realm", -50, "Base", `${data.casterRealm || "Unknown caster realm"} vs ${data.spellRealm || "Unknown spell realm"}`));
    }

    const effects = selectedSpells.length ? selectedSpells.length : Math.max(1, n(data.includedSpellEffects, 1));
    if (effects > 1) rows.push(row("Additional spell effects", -25 * (effects - 1), "Base", "-25 each spell included after the first"));
    if (selectedSpells.length > 1) {
      rows.push(row("Combined spell level", 0, "Base", selectedSpells.map(s => `${s.spellName || s.name || "Spell"} ${n(s.level, 1)}`).join(" + ")));
    }

    this.#participantRows(data, rows);
    this.#powerRows(data, rows);
    this.#investmentRows(data, rows, options);
    this.#parameterRows(data, rows);

    const ppRealms = this.getPPRealms(data);
    rows.push(row("PP sources by realm", this.ppRealmModifier(ppRealms.count), "Modifier Engine", ppRealms.label));

    for (const c of collectionToArray(data.circumstances)) {
      if (!c) continue;
      rows.push(row(c.label || "Manual circumstance", c.value, "Circumstances", c.detail || ""));
    }

    const total = rows.reduce((s, r) => s + n(r.value), 0);
    return {
      rows,
      total,
      baseTotal: rows.filter(r => r.group === "Base").reduce((s, r) => s + n(r.value), 0),
      endurance: this.getEnduranceRequirement(data),
      ppTotal: this.getTotalPP(data),
      requiredPP: this.getRequiredPP(data),
      additionalPP: this.getAdditionalPP(data),
      ppInvestmentModifier: this.ppInvestmentModifier(this.getAdditionalPP(data)),
      ppRealms,
      blood: this.getBloodSummary(data),
      parameterSummary: this.getParameterSummary(data),
      parameterTotal: rows.filter(r => r.group === "Parameters").reduce((s, r) => s + n(r.value), 0)
    };
  }

  static #participantRows(data, rows) {
    for (const p of collectionToArray(data.participants)) {
      const role = p.role || "minor";
      if (role === "major") {
        const ritualSupport = this.complementaryBonus(p.ritualRanks);
        if (ritualSupport) rows.push(row(`${p.actorName || "Major contributor"} Magical Ritual support`, ritualSupport, "Participants", "Major contributor complementary support from ritual ranks"));
      }
      if (role === "major" && p.complementarySkillName) {
        const supportLabel = p.complementarySkillLabel || p.complementarySkillFullName || p.supportSkillLabel || p.supportSkillName || "Support skill";
        const actualRanks = n(p.complementarySkillActualRanks);
        const usedRanks = n(p.complementarySkillRanks);
        const detail = actualRanks
          ? `Support uses greater of support skill ranks (${actualRanks}) or Magical Ritual ranks; using ${usedRanks}`
          : "Support uses greater of support skill ranks or Magical Ritual ranks";
        rows.push(row(`${p.actorName || "Participant"} support: ${supportLabel}`, this.complementaryBonus(p.complementarySkillRanks), "Participants", detail));
      }
      if (role === "primary" && n(p.ritualSkillBonus) && !n(data.baseSkillBonus)) {
        rows.push(row(`${p.actorName || "Primary caster"} stored ritual skill`, p.ritualSkillBonus, "Participants"));
      }
      if (role !== "setDressing" && n(p.bloodDice)) rows.push(row(`${p.actorName || "Participant"} blood`, this.bloodDiceModifier(p.bloodDice), "Blood"));
      if (role !== "setDressing" && n(p.criticalSeverityBloodInvestment)) rows.push(row(`${p.actorName || "Participant"} critical blood`, Math.min(100, 20 * n(p.criticalSeverityBloodInvestment)), "Blood", "+20 per severity, max +100"));
      if (role === "minor" && p.complementarySkillName) rows.push(row(`${p.actorName || "Minor contributor"} skill ignored`, 0, "Participants", "Minor contributors provide PP only"));
    }
  }


  static #powerRows(data, rows) {
    const requiredPP = this.getRequiredPP(data);
    const participantPP = this.getParticipantPP(data);
    const legacyAdditionalPP = n(data.ppInvestment?.additionalPP);
    const extraPP = participantPP + legacyAdditionalPP;
    const mod = this.ppInvestmentModifier(extraPP);
    const detailParts = [
      `Additional participant PP/adder ${participantPP}`,
      `Required spell PP ${requiredPP} (not subtracted)`,
      `Additional PP ${extraPP}`,
      "n² PP = +3n"
    ];
    rows.push(row("Additional PP investment", mod, "Power", detailParts.join(", ")));
  }

  static #investmentRows(data, rows, options) {
    const time = TIME_TABLE.find(t => t.id === data.timeInvestment?.id) ?? TIME_TABLE[0];
    rows.push(row(`Time investment: ${time.label}`, time.mod, "Time", time.endurance ? `Endurance: ${time.endurance}` : ""));

    const item = data.itemInvestment ?? {};
    const toolBase = this.valueTableModifier(ITEM_TABLES.tools, n(item.toolValueGp), "gp");
    const sacBase = this.valueTableModifier(ITEM_TABLES.sacrifices, n(item.sacrificeValueSp), "sp");
    rows.push(row("Ritual tools/fixtures", this.appropriatenessAdjusted(toolBase, item.toolAppropriateness, options.proportionalItemBonus), "Items"));
    rows.push(row("Sacrifice or expended component", this.appropriatenessAdjusted(sacBase, item.sacrificeAppropriateness, options.proportionalItemBonus), "Items"));
  }

  static #parameterRows(data, rows) {
    const p = data.parameterExtensions ?? {};
    if (n(p.weightDoublings)) rows.push(row("Weight limit extension", -10 * n(p.weightDoublings), "Parameters", "-10 per doubling"));
    if (n(p.criticalSeveritySteps)) rows.push(row("Critical severity extension", -30 * n(p.criticalSeveritySteps), "Parameters", "-30 per step altered"));
    if (n(p.concussionMultiplier, 1) > 1) rows.push(row("Concussion damage/healing extension", -10 * (n(p.concussionMultiplier) - 1), "Parameters", "x2=-10, x3=-20, x4=-30, x5=-40 max"));
    if (p.areaDecrease) rows.push(row("Area decrease", -10, "Parameters", "-10 maximum"));
    if (n(p.areaIncreaseDoublings)) rows.push(row("Area increase", -20 * n(p.areaIncreaseDoublings), "Parameters", "-20 per doubling"));
    if (n(p.rangeDoublings)) rows.push(row("Range increase", -15 * n(p.rangeDoublings), "Parameters", "-15 per doubling"));
    if (p.noDurationToOneRound) rows.push(row("No duration to 1 round", -50, "Parameters"));
    if (p.concentrationToRoundsPerLevel) rows.push(row("Concentration to 1 round/level", -20, "Parameters"));
    if (p.removeConcentration) rows.push(row("Remove concentration limitation", -25, "Parameters"));
    if (n(p.durationSteps)) rows.push(row("Duration ladder extension", -20 * n(p.durationSteps), "Parameters", "-20 per step"));
    if (p.selfSpellExpanded) rows.push(row("Self spell expanded", 0, "Parameters", "Only major contributors may be included"));
  }

  static complementaryBonus(ranks = 0) {
    // Rules clarification example: 10 ranks provide +10 support; 20 ranks provide +20.
    return Math.max(0, n(ranks));
  }

  static ppInvestmentModifier(pp) {
    return 3 * Math.floor(Math.sqrt(Math.max(0, n(pp))));
  }

  static ppRealmModifier(count) {
    const c = n(count, 1);
    if (c <= 1) return 0;
    if (c === 2) return -10;
    return -25;
  }

  static valueTableModifier(table, value, key) {
    let mod = 0;
    for (const r of table) if (value >= r[key]) mod = r.mod;
    return mod;
  }

  static appropriatenessAdjusted(base, appropriateness = "generally", proportional = false) {
    if (!proportional) {
      return base + ({ less: -5, generally: 0, broadly: 5, specifically: 10 }[appropriateness] ?? 0);
    }
    if (appropriateness === "less") return base - 5;
    if (appropriateness === "broadly") return Math.floor(base * 1.5);
    if (appropriateness === "specifically") return base * 2;
    return base;
  }

  static bloodDiceModifier(dice) {
    const d = n(dice);
    if (d <= 0) return 0;
    const powers = [1, 2, 4, 8, 16, 32];
    let idx = powers.findIndex(p => d <= p);
    if (idx < 0) idx = powers.length - 1;
    return Math.min(30, 5 * (idx + 1));
  }

  static getPPRealms(data) {
    const detected = new Set();
    const manualSet = new Set();

    const add = (set, value) => {
      const key = realmKey(value);
      if (key) set.add(key);
    };

    /*
     * The rules modifier is for PP sources by realm, but at the workflow level
     * any active participant can become a PP source. Detect realms from all
     * Primary/Major/Minor participants so the UI accurately previews the realm
     * mix and grays those boxes as automatic. Set Dressing is ignored.
     */
    for (const p of collectionToArray(data.participants)) {
      if (!p || p.role === "setDressing") continue;
      add(detected, p.realm);
    }

    const manual = data.realmsUsed ?? {};
    for (const [key, used] of Object.entries(manual)) if (used) add(manualSet, key);

    const combined = new Set([...detected, ...manualSet]);
    const labels = Array.from(combined).filter(Boolean);
    const labelize = r => {
      if (r === "arcane") return "Arcane/Other";
      return r.replace(/^./, c => c.toUpperCase());
    };

    const detectedObj = Object.fromEntries(Array.from(detected).map(r => [r, true]));
    const manualObj = Object.fromEntries(Array.from(manualSet).map(r => [r, true]));

    return {
      realms: labels,
      detected: detectedObj,
      manual: manualObj,
      count: labels.length || 1,
      label: labels.length ? labels.map(labelize).join(", ") : "Single realm"
    };
  }

  static getEnduranceRequirement(data) {
    const time = TIME_TABLE.find(t => t.id === data.timeInvestment?.id) ?? TIME_TABLE[0];
    return {
      label: time.label,
      difficulty: time.endurance || "None",
      rolls: time.endurance ? "Required" : "None",
      primaryFailure: "Ritual immediately fails. No spell failure roll.",
      majorFailure: "Lose skill contribution; keep PP and blood contribution."
    };
  }

  static getRequiredPP(data) {
    const selectedSpells = collectionToArray(data.selectedSpells);
    if (selectedSpells.length) {
      return selectedSpells.reduce((s, sp) => s + Math.max(1, n(sp.level, 1)), 0);
    }
    return Math.max(1, n(data.spellLevel, 1));
  }

  static getParticipantPP(data) {
    return collectionToArray(data.participants).reduce((s, p) => {
      if (p.role === "setDressing") return s;
      return s + n(p.ppContributed) + n(p.spellAdderChargesUsed);
    }, 0);
  }

  static getAdditionalPP(data) {
    return this.getParticipantPP(data) + n(data.ppInvestment?.additionalPP);
  }

  static getTotalPP(data) {
    const participantPP = collectionToArray(data.participants).reduce((s, p) => {
      if (p.role === "setDressing") return s;
      return s + n(p.ppContributed) + n(p.spellAdderChargesUsed);
    }, 0);
    return this.getRequiredPP(data) + participantPP + n(data.ppInvestment?.additionalPP);
  }

  static getBloodSummary(data) {
    const active = collectionToArray(data.participants).filter(p => p.role !== "setDressing");
    const pDice = active.reduce((s, p) => s + n(p.bloodDice), 0);
    const pCrit = active.reduce((s, p) => s + n(p.criticalSeverityBloodInvestment), 0);
    return {
      concussionDice: pDice + n(data.bloodInvestment?.concussionDice),
      criticalSeverity: pCrit + n(data.bloodInvestment?.criticalSeverity)
    };
  }

  static getParameterSummary(data) {
    const p = data.parameterExtensions ?? {};
    return Object.entries(p).filter(([,v]) => Boolean(v) && Number(v) !== 0).map(([k,v]) => ({ key: k, value: v }));
  }
}
