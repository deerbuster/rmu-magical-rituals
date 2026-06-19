import { MODULE_ID } from "./ritual-calculator.js";

export class RitualActorAdapter {
  static #spellCompendiumCache = null;
  static #spellCompendiumCachePromise = null;
  static #spellCompendiumCacheBuiltAt = 0;
  static #spellCompendiumCacheStats = { packs: 0, lists: 0, spells: 0 };

  static getSetting(key) {
    try { return game.settings.get(MODULE_ID, key); }
    catch { return undefined; }
  }

  static paths(kind) {
    const configured = this.getSetting(`${kind}PathMapping`);
    if (configured) return configured.split(",").map(s => s.trim()).filter(Boolean);
    return {
      skill: [
        "system.skills.magicalRitual.total", "system.skills.magicalritual.total",
        "system.skills.Magical Ritual.total", "system.skillBonuses.magicalRitual",
        "system.skills.magicalRitual.bonus", "system.skills.magicalRitual.value"
      ],
      pp: [
        "system.health.power.value", "system.power.value", "system.powerPoints.value", "system.pp.value", "system.powerpoints.value",
        "system.resources.powerpoints.value", "system.resources.pp.value", "system.resources.power.value"
      ],
      level: [
        "system.experience.level", "system.level", "system.level.value", "system.profession.level",
        "system.stats.level.value", "system.details.level"
      ],
      endurance: [
        "system.skills.endurance.total", "system.skills.Endurance.total",
        "system.skills.endurance.bonus", "system.skills.Endurance.bonus"
      ],
      mentalFocus: [
        "system.skills.mentalFocus.total", "system.skills.Mental Focus.total",
        "system.skills.mentalfocus.total"
      ]
    }[kind] ?? [];
  }

  static getFirst(actor, kind, fallback = 0) {
    if (!actor) return fallback;
    for (const path of this.paths(kind)) {
      const value = foundry.utils.getProperty(actor, path);
      if (value !== undefined && value !== null && value !== "") return Number(value) || value;
    }
    return fallback;
  }

  static getLevel(actor) { return Number(this.getFirst(actor, "level", 1)) || 1; }
  static getPP(actor) { return Number(this.getFirst(actor, "pp", 0)) || 0; }

  static getRealm(actor) {
    if (!actor) return "";
    const paths = [
      "system.realm", "system.realms", "system.profession.realm", "system.profession.realms",
      "system._profession.system.realms", "system._profession.system.realm"
    ];
    for (const path of paths) {
      const value = foundry.utils.getProperty(actor, path);
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value) && value.length) return value.join(", ");
    }
    for (const item of actor?.items?.contents ?? actor?.items ?? []) {
      if (item?.type !== "profession") continue;
      const realm = item.system?.realms ?? item.system?.realm;
      if (typeof realm === "string" && realm.trim()) return realm.trim();
      if (Array.isArray(realm) && realm.length) return realm.join(", ");
    }
    return "";
  }

  static getEndurance(actor) { return Number(this.getFirst(actor, "endurance", 0)) || 0; }

  static #skillMatches(value, wantedName, wantedSpec = "") {
    const name = this.#norm(value?.system?.name ?? value?.name);
    const category = this.#norm(value?.system?.category ?? value?.category);
    const spec = this.#norm(value?.system?.specialization ?? value?.specialization);
    const wanted = this.#norm(wantedName);
    const wspec = this.#norm(wantedSpec);
    const nameMatches = name === wanted || value?.name && this.#norm(value.name) === wanted;
    const categoryMatches = !wanted || category === wanted || name === wanted;
    const specMatches = !wspec || spec === wspec;
    return (nameMatches || categoryMatches) && specMatches;
  }

  static #skillValue(value, fallback = 0) {
    const candidates = [
      value?._bonus,
      value?._totalBonus,
      value?._total,
      value?.total,
      value?.bonus,
      value?.value,
      value?.system?._bonus,
      value?.system?._totalBonus,
      value?.system?._total,
      value?.system?.total,
      value?.system?.bonus,
      value?.system?.value
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
    const ranks = Number(value?.system?._totalRanks ?? value?._totalRanks ?? value?.system?.totalRanks ?? value?.totalRanks ?? value?.system?.ranks ?? value?.ranks);
    if (Number.isFinite(ranks)) return this.#rankBonus(ranks);
    return fallback;
  }

  static #rankBonus(ranks) {
    const n = Number(ranks) || 0;
    if (n <= 0) return -25;
    if (n <= 10) return n * 5;
    if (n <= 20) return 50 + ((n - 10) * 3);
    if (n <= 30) return 80 + ((n - 20) * 2);
    return 100 + (n - 30);
  }

  static #skillRanks(value, fallback = 0) {
    const candidates = [
      value?._totalRanks,
      value?.totalRanks,
      value?.ranks,
      value?.rank,
      value?.system?._totalRanks,
      value?.system?.totalRanks,
      value?.system?.ranks,
      value?.system?.rank
    ];
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  static findOwnedOrPreparedSkill(actor, skillName, specialization = "") {
    if (!actor) return null;
    const wanted = this.#norm(skillName);
    const wantedSpec = this.#norm(specialization);

    const directPools = [
      actor.items?.contents ?? actor.items,
      actor.system?._skills,
      actor.system?.skills,
      actor._skills
    ].filter(Boolean);

    for (const pool of directPools) {
      const values = Array.isArray(pool) ? pool : Object.values(pool);
      for (const value of values) {
        if (!value) continue;
        if (this.#skillMatches(value, wanted, wantedSpec)) return value;
      }
    }

    const groups = [
      actor.system?._skillGroups,
      actor._skillGroups,
      foundry.utils.getProperty(actor, "system.skillGroups")
    ].filter(Boolean);

    const seen = new Set();
    const walk = value => {
      if (!value || typeof value !== "object") return null;
      if (seen.has(value)) return null;
      seen.add(value);
      if (this.#skillMatches(value, wanted, wantedSpec)) return value;
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };

    for (const group of groups) {
      const found = walk(group);
      if (found) return found;
    }

    if (wantedSpec) return this.findOwnedOrPreparedSkill(actor, skillName, "");
    return null;
  }

  static getRitualSkill(actor, specialization = "") {
    const skill = this.findOwnedOrPreparedSkill(actor, "Magical Ritual", specialization);
    if (skill) return this.#skillValue(skill, 0);
    return Number(this.getFirst(actor, "skill", 0)) || 0;
  }

  static getRitualRanks(actor, specialization = "") {
    const skill = this.findOwnedOrPreparedSkill(actor, "Magical Ritual", specialization);
    return skill ? this.#skillRanks(skill, 0) : 0;
  }

  static #norm(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  static #number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  static getActorProfession(actor) {
    const paths = [
      "system.profession.name",
      "system.profession",
      "system.info.profession",
      "system.identity.profession",
      "system.details.profession",
      "system._profession.profession",
      "system._profession.name",
      "system._profession.system.profession"
    ];
    for (const path of paths) {
      const value = foundry.utils.getProperty(actor, path);
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value?.name) return value.name;
      if (value?.profession) return value.profession;
    }
    for (const item of actor?.items?.contents ?? actor?.items ?? []) {
      if (item?.type !== "profession") continue;
      const prof = item.system?.profession ?? item.name;
      if (prof) return String(prof).trim();
    }
    return "";
  }

  static findSpellListRanks(actor, spellListName) {
    if (!actor || !spellListName) return 0;
    const wanted = this.#norm(spellListName);

    for (const item of actor?.items?.contents ?? actor?.items ?? []) {
      if (item?.type !== "skill") continue;
      const name = this.#norm(item.system?.name ?? item.name);
      const spec = this.#norm(item.system?.specialization);
      const category = this.#norm(item.system?.category);
      if (spec === wanted && (category === "spellcasting" || ["base", "open", "closed", "restricted", "evil", "arcane"].includes(name))) {
        return this.#skillRanks(item, 0);
      }
    }

    const pools = [
      actor.system?._skillGroups,
      actor._skillGroups,
      foundry.utils.getProperty(actor, "system.skillGroups"),
      foundry.utils.getProperty(actor, "system.skills")
    ].filter(Boolean);

    const seen = new Set();
    const walk = value => {
      if (!value || typeof value !== "object") return 0;
      if (seen.has(value)) return 0;
      seen.add(value);

      const name = this.#norm(value.name);
      const spec = this.#norm(value.specialization);
      const label = this.#norm(value.label);
      const key = this.#norm(value.key);
      const matches = spec === wanted || name === wanted || label === wanted || key === wanted;

      if (matches) {
        return this.#number(
          value._totalRanks ??
          value.totalRanks ??
          value.ranks ??
          value.rank ??
          value.system?.ranks ??
          value.system?.rank ??
          value.system?._totalRanks,
          0
        );
      }

      if (Array.isArray(value)) {
        for (const child of value) {
          const found = walk(child);
          if (found) return found;
        }
      } else {
        for (const child of Object.values(value)) {
          const found = walk(child);
          if (found) return found;
        }
      }
      return 0;
    };

    for (const pool of pools) {
      const ranks = walk(pool);
      if (ranks) return ranks;
    }
    return 0;
  }

  static #mapListType(listType, listProfession, actor) {
    const raw = String(listType ?? "").toLowerCase();
    const profession = this.#norm(listProfession);
    const actorProfession = this.#norm(this.getActorProfession(actor));

    if (raw.includes("open")) return "open";
    if (raw.includes("closed")) return "closed";
    if (raw.includes("evil")) return actorProfession && profession && actorProfession === profession ? "evilKnown" : "evilUnknown";
    if (raw.includes("arcane")) return "wrongRealm";
    if (raw.includes("base")) {
      if (profession && actorProfession && profession === actorProfession) return "ownBase";
      return "otherBase";
    }
    if (raw.includes("restricted")) return "otherBase";
    return "open";
  }

  static #knowledgeFor(actor, spellListName, spellLevel, actorHasList = false) {
    const ranks = this.findSpellListRanks(actor, spellListName);
    const level = this.#number(spellLevel, 1);
    if (ranks > level) return { knowledge: "knowsBeyondLevel", ranksBeyond: ranks - level, ranks };
    if (ranks >= level) return { knowledge: "knowsToLevel", ranksBeyond: 0, ranks };
    if (ranks > 0 || actorHasList) return { knowledge: "knowsListNotSpell", ranksBeyond: 0, ranks };
    return { knowledge: "unknownList", ranksBeyond: 0, ranks: 0 };
  }

  static #cleanI18nPathName(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    /*
     * RMU spell-list data commonly stores spell names as localization keys:
     *   RMU_SL.Blood Mastery.spells.Cut Repair V.name
     *
     * When the localization dictionary is not loaded or the key is not found,
     * game.i18n.localize returns the original key. The UI should still display
     * only the human-facing spell name, so extract the segment between
     * ".spells." and ".name" as a safe fallback.
     */
    const spellMatch = raw.match(/(?:^|\.)spells\.([^.]*)\.name$/i);
    if (spellMatch?.[1]) return spellMatch[1];

    const nameMatch = raw.match(/\.([^.]*)\.name$/i);
    if (nameMatch?.[1]) return nameMatch[1];

    const parts = raw.split(".");
    if (parts.length > 1) {
      const last = parts.at(-1);
      if (/^(name|label|title)$/i.test(last ?? "") && parts.at(-2)) return parts.at(-2);
      return parts.at(-1) || raw;
    }

    return raw;
  }

  static #displayName(value, fallback = "Unnamed Spell") {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;

    const localized = game.i18n.localize(raw);
    if (localized && localized !== raw) return localized;

    return this.#cleanI18nPathName(raw) || fallback;
  }

  static #spellName(spell) {
    const label = spell?._translatedName ?? spell?.label ?? spell?.name ?? spell?.spellName;
    return this.#displayName(label, "Unnamed Spell");
  }

  static #displayRealm(spellRealm, listRealm, listProfession = "") {
    const raw = String(spellRealm ?? listRealm ?? "").trim();
    const prof = this.#norm(listProfession);
    if (["healer", "mystic", "sorcerer"].includes(prof)) return "Hybrid";
    if (/hybrid/i.test(raw)) return "Hybrid";

    const parts = raw
      .split(/[,/;&]+|\band\b/i)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => p.replace(/\s+realm$/i, ""));

    const major = parts.filter(p => /^(channeling|essence|mentalism)$/i.test(p));
    if (major.length > 1) return "Hybrid";
    if (major.length === 1) return major[0].replace(/^./, c => c.toUpperCase());

    const first = parts[0] || raw || "Channeling";
    if (/arcane|other/i.test(first)) return "Arcane/Other";
    if (/essence/i.test(first)) return "Essence";
    if (/mentalism/i.test(first)) return "Mentalism";
    if (/channeling/i.test(first)) return "Channeling";
    return first;
  }

  static #listCategoryLabel(listType, listProfession, realm) {
    const raw = String(listType ?? "").trim();
    const lower = raw.toLowerCase();
    const prof = String(listProfession ?? "").trim();
    const displayRealm = realm || "Channeling";

    if (lower.includes("open")) return `Open ${displayRealm}`;
    if (lower.includes("closed")) return `Closed ${displayRealm}`;
    if (lower.includes("evil")) return `Evil ${displayRealm}`;
    if (lower.includes("base")) return prof ? `${prof} Base` : "Base";
    if (lower.includes("restricted")) return prof ? `${prof} Base` : "Restricted";
    if (lower.includes("arcane")) return "Arcane";
    if (prof) return `${prof} Base`;
    return raw || `Open ${displayRealm}`;
  }

  static #makeSpellOption({ actor, spell, listName, listUuid, listRealm, listType, listProfession, source, actorHasList = false }) {
    const spellName = this.#spellName(spell);
    const level = this.#number(spell?.level ?? spell?.lvl ?? spell?.spellLevel, 1);
    const rawRealm = spell?._realms ?? spell?.realm ?? listRealm ?? "Channeling";
    const rawListType = spell?.listType ?? listType ?? "";
    const realm = this.#displayRealm(rawRealm, listRealm, listProfession);
    const categoryLabel = this.#listCategoryLabel(rawListType, listProfession, realm);
    const ritualListType = this.#mapListType(rawListType, listProfession, actor);
    const knowledge = this.#knowledgeFor(actor, listName, level, actorHasList);
    const id = [
      source || "spell",
      listUuid || listName || "list",
      categoryLabel,
      spellName,
      level
    ].map(s => String(s).replaceAll("|", "/")).join("|");

    return {
      id,
      spellName,
      spellListName: this.#displayName(listName || spell?.spellList || "", listName || spell?.spellList || ""),
      level,
      realm,
      categoryLabel,
      listType: rawListType,
      listProfession: listProfession ?? "",
      ritualListType,
      knowledge: knowledge.knowledge,
      ranksBeyond: knowledge.ranksBeyond,
      ranks: knowledge.ranks,
      uuid: listUuid || "",
      label: spellName,
      source
    };
  }

  static #isSpellListDocument(doc) {
    const type = this.#norm(doc?.type).replaceAll("-", "").replaceAll("_", "");
    const sys = doc?.system ?? {};
    if (["spelllist", "spelllistitem"].includes(type)) return true;
    if (Array.isArray(sys.spells) || Array.isArray(sys.spellList) || Array.isArray(sys.levels)) return true;
    if (sys.listType || sys.realms || sys.realm || sys.profession) {
      const name = this.#norm(doc?.name ?? sys.name);
      if (name && !["race", "profession", "talent", "skill"].includes(type)) return true;
    }
    return false;
  }

  static #spellsFromListDocument(doc) {
    const sys = doc?.system ?? {};
    const raw = sys.spells ?? sys.spellList ?? sys.levels ?? [];
    if (Array.isArray(raw)) return raw;

    // Some RMU builds store spells by level in an object map.
    if (raw && typeof raw === "object") {
      const out = [];
      for (const [level, value] of Object.entries(raw)) {
        const values = Array.isArray(value) ? value : Object.values(value ?? {});
        for (const spell of values) {
          if (spell && typeof spell === "object") out.push({ level: spell.level ?? spell.lvl ?? Number(level), ...spell });
        }
      }
      return out;
    }

    // Last resort: find array-valued fields containing spell-ish objects.
    const out = [];
    for (const value of Object.values(sys)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (entry && typeof entry === "object" && (entry.name || entry.label || entry.spellName) && (entry.level || entry.lvl || entry.spellLevel)) {
          out.push(entry);
        }
      }
    }
    return out;
  }


  static #withActorSpellContext(opt, actor = null) {
    const copy = foundry.utils.deepClone(opt ?? {});
    const knowledge = this.#knowledgeFor(actor, copy.spellListName, copy.level, false);
    copy.ritualListType = this.#mapListType(copy.listType, copy.listProfession, actor);
    copy.knowledge = knowledge.knowledge;
    copy.ranksBeyond = knowledge.ranksBeyond;
    copy.ranks = knowledge.ranks;
    return copy;
  }

  static async preloadSpellCompendiums({ force = false } = {}) {
    if (!force && Array.isArray(this.#spellCompendiumCache)) return this.#spellCompendiumCache;
    if (!force && this.#spellCompendiumCachePromise) return this.#spellCompendiumCachePromise;

    this.#spellCompendiumCachePromise = (async () => {
      const started = performance.now();
      const options = [];
      const seen = new Set();
      let packsRead = 0;
      let listsRead = 0;

      const add = opt => {
        if (!opt?.spellName) return;
        const key = `${opt.spellName}|${opt.spellListName}|${opt.level}|${opt.realm}`;
        if (seen.has(key)) return;
        seen.add(key);
        options.push(opt);
      };

      for (const pack of game.packs ?? []) {
        try {
          if (pack.documentName !== "Item") continue;
          const collection = String(pack.collection ?? "");
          const meta = pack.metadata ?? {};
          const label = String(meta.label ?? "").toLowerCase();
          const looksRMU =
            meta.packageName === "rmu" ||
            meta.system === "rmu" ||
            collection.startsWith("rmu.") ||
            label.includes("core law") ||
            label.includes("spell law") ||
            label.includes("treasure law") ||
            game.system?.id === "rmu";
          if (!looksRMU) continue;

          packsRead += 1;
          const index = await pack.getIndex({
            fields: [
              "type", "name", "system.realms", "system.realm", "system.listType",
              "system.profession", "system.spells", "system.spellList", "system.levels"
            ]
          });

          let candidates = index.filter(e => {
            const type = String(e.type ?? "").toLowerCase().replaceAll("-", "").replaceAll("_", "");
            return type.includes("spelllist") ||
              e.system?.listType ||
              e.system?.realms ||
              e.system?.realm ||
              e.system?.spells ||
              e.system?.spellList ||
              e.system?.levels;
          });

          if (!candidates.length && (collection.startsWith("rmu.") || game.system?.id === "rmu")) {
            candidates = Array.from(index);
          }

          for (const entry of candidates) {
            const doc = await pack.getDocument(entry._id);
            if (!this.#isSpellListDocument(doc)) continue;

            listsRead += 1;
            const sys = doc.system ?? {};
            for (const spell of this.#spellsFromListDocument(doc)) {
              add(this.#makeSpellOption({
                actor: null,
                spell,
                listName: doc.name,
                listUuid: doc.uuid,
                listRealm: sys.realms ?? sys.realm,
                listType: sys.listType ?? sys.type,
                listProfession: sys.profession,
                source: "compendium",
                actorHasList: false
              }));
            }
          }
        } catch (err) {
          console.warn(`${MODULE_ID} | Unable to preload spell compendium ${pack.collection}`, err);
        }
      }

      this.#spellCompendiumCache = options.sort((a, b) => a.label.localeCompare(b.label));
      this.#spellCompendiumCacheBuiltAt = Date.now();
      this.#spellCompendiumCacheStats = { packs: packsRead, lists: listsRead, spells: this.#spellCompendiumCache.length };
      const elapsed = Math.round(performance.now() - started);
      console.log(`${MODULE_ID} | Preloaded ${this.#spellCompendiumCache.length} spell options from ${listsRead} lists in ${elapsed} ms.`);
      return this.#spellCompendiumCache;
    })();

    try {
      return await this.#spellCompendiumCachePromise;
    } finally {
      this.#spellCompendiumCachePromise = null;
    }
  }

  static getSpellCompendiumCacheStats() {
    return foundry.utils.deepClone({
      ...this.#spellCompendiumCacheStats,
      builtAt: this.#spellCompendiumCacheBuiltAt,
      ready: Array.isArray(this.#spellCompendiumCache),
      loading: Boolean(this.#spellCompendiumCachePromise)
    });
  }

  static async getSpellOptions(actor = null) {
    const options = [];
    const seen = new Set();

    const add = opt => {
      if (!opt?.spellName) return;
      const key = `${opt.spellName}|${opt.spellListName}|${opt.level}|${opt.realm}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push(opt);
    };

    // Preferred live RMU source: a currently rendered RMU actor sheet has already
    // prepared _castableSpells/_spellGroups using RMU's native spell builder.
    for (const app of Object.values(actor?.apps ?? {})) {
      const groups = app?._spellGroups ?? [];
      for (const group of groups) {
        for (const list of group.spellLists ?? []) {
          for (const spell of list.spells ?? []) {
            add(this.#makeSpellOption({
              actor,
              spell,
              listName: list.spellListName ?? spell.spellList,
              listUuid: list.uuid,
              listRealm: list.realms,
              listType: list.listType ?? spell.listType,
              source: "actor-sheet",
              actorHasList: Boolean(list.known)
            }));
          }
        }
      }

      for (const spell of app?._castableSpells ?? []) {
        add(this.#makeSpellOption({
          actor,
          spell,
          listName: spell.spellList,
          listRealm: spell._realms ?? spell.realm,
          listType: spell.listType,
          source: "actor-sheet",
          actorHasList: true
        }));
      }
    }

    // Owned spell-list Items, if the actor has them.
    for (const item of actor?.items ?? []) {
      if (!this.#isSpellListDocument(item)) continue;
      const sys = item.system ?? {};
      const listName = item.name ?? sys.name;
      for (const spell of this.#spellsFromListDocument(item)) {
        add(this.#makeSpellOption({
          actor,
          spell,
          listName,
          listUuid: item.uuid,
          listRealm: sys.realms,
          listType: sys.listType,
          listProfession: sys.profession,
          source: "actor-item",
          actorHasList: true
        }));
      }
    }

    /*
     * Compendium spell lists are expensive to read because many RMU packs do not
     * expose all useful spell data in the index. They are now loaded once at
     * table startup and cached. Opening the ritual UI only re-applies
     * actor-specific knowledge/list-type context to those cached entries.
     */
    const cached = await this.preloadSpellCompendiums();
    for (const opt of cached) add(this.#withActorSpellContext(opt, actor));

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }


  static #walkPreparedSkills(actor) {
    const src = actor?.system?._skills;
    if (!src) return [];
    const out = [];
    const visited = new WeakSet();

    const walk = value => {
      if (!value || typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);

      if (Array.isArray(value)) {
        for (const child of value) walk(child);
        return;
      }

      if (value.system && typeof value.system === "object") {
        out.push(value);
        return;
      }

      for (const child of Object.values(value)) walk(child);
    };

    walk(src);
    return out;
  }

  static #skillDataForSelector(rawSkill) {
    const s = rawSkill?.system ?? {};
    const baseName = String(s.name ?? rawSkill?.name ?? game.i18n?.localize?.("RMUMR.UnknownSkill") ?? "Unknown Skill").trim();
    const specialization = String(s.specialization ?? "").trim();
    const fullName = specialization ? `${baseName} (${specialization})` : baseName;
    const uuid = rawSkill?._id || s._groupSkillId || rawSkill?.uuid || s._originUUID || fullName;
    const category = String(s.category ?? rawSkill?.category ?? game.i18n?.localize?.("RMUMR.Other") ?? "Other").trim();
    const ranks = this.#skillRanks(rawSkill, 0);
    const bonus = this.#skillValue(rawSkill, this.#rankBonus(ranks));
    return {
      uuid,
      key: uuid,
      label: fullName,
      name: baseName,
      fullName,
      specialization,
      category,
      ranks,
      bonus,
      disabledBySystem: s._disableSkillRoll === true,
      raw: rawSkill
    };
  }

  static #sortSkillData(a, b) {
    const categoryCompare = String(a.category ?? "").localeCompare(String(b.category ?? ""));
    if (categoryCompare !== 0) return categoryCompare;
    return String(a.label ?? a.name ?? "").localeCompare(String(b.label ?? b.name ?? ""));
  }

  static getKnownSkills(actor) {
    if (!actor) return [];
    const seen = new Set();
    const skills = [];

    const addRawSkill = raw => {
      if (!raw || typeof raw !== "object") return;

      /*
       * Match the Complementary Skills module first: use RMU's prepared
       * actor.system._skills tree, where the system has already calculated
       * _totalRanks, _bonus, disabled state, category, and specializations.
       */
      const data = this.#skillDataForSelector(raw);
      if (!data.label || data.disabledBySystem) return;
      const key = `${data.uuid}|${data.label}|${data.category}`;
      if (seen.has(key)) return;
      seen.add(key);
      skills.push(data);
    };

    for (const raw of this.#walkPreparedSkills(actor)) addRawSkill(raw);

    /*
     * Fallback for worlds where the RMU prepared skill tree has not been
     * hydrated yet. This keeps the module system-agnostic while preferring the
     * same RMU data source as Complementary Skills whenever it exists.
     */
    if (!skills.length) {
      const pools = [
        actor.items?.contents ?? actor.items,
        actor.system?.skills,
        actor._skills
      ].filter(Boolean);

      for (const pool of pools) {
        const values = Array.isArray(pool) ? pool : Object.values(pool);
        for (const value of values) {
          const type = String(value?.type ?? "").toLowerCase();
          const category = value?.system?.category ?? value?.category ?? "";
          const looksSkill = type === "skill" || category || value?.system?.ranks !== undefined || value?.ranks !== undefined;
          if (looksSkill) addRawSkill(value);
        }
      }
    }

    return skills.sort(this.#sortSkillData);
  }

  static getKnownSkillGroups(actor) {
    const skills = this.getKnownSkills(actor);
    const groups = new Map();

    for (const skill of skills) {
      const category = skill.category || "Other";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(skill);
    }

    return Array.from(groups.entries())
      .map(([label, skills]) => ({ label, skills }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  static getKnownSkillByLabel(actor, label) {
    const wanted = String(label ?? "").trim();
    if (!wanted) return null;
    return this.getKnownSkills(actor).find(s =>
      s.key === wanted ||
      s.uuid === wanted ||
      s.label === wanted ||
      s.fullName === wanted ||
      s.name === wanted
    ) ?? null;
  }

  static buildParticipant(actor, role = "primary", specialization = "") {
    return {
      actorId: actor?.id ?? null,
      actorUuid: actor?.uuid ?? null,
      actorName: actor?.name ?? "Unknown Actor",
      role,
      realm: this.getRealm(actor),
      ritualSkillBonus: this.getRitualSkill(actor, specialization),
      ritualRanks: this.getRitualRanks(actor, specialization),
      complementarySkillName: "",
      complementarySkillLabel: "",
      complementarySkillActualRanks: 0,
      complementarySkillBonus: 0,
      complementarySkillRanks: 0,
      ppContributed: 0,
      spellAdderChargesUsed: 0,
      bloodDice: 0,
      criticalSeverityBloodInvestment: 0
    };
  }

  static async deductPP(actor, amount) {
    const requested = Math.max(0, Number(amount) || 0);
    if (!actor || !requested) {
      return { applied: false, requested, deducted: 0, before: null, after: null, path: "", reason: actor ? "No PP requested" : "No actor" };
    }

    for (const path of this.paths("pp")) {
      const raw = foundry.utils.getProperty(actor, path);
      const current = Number(raw);
      if (Number.isFinite(current)) {
        const after = Math.max(0, current - requested);
        const deducted = current - after;
        try {
          await actor.update({ [path]: after });
          return { applied: true, requested, deducted, before: current, after, path };
        } catch (err) {
          console.warn(`${MODULE_ID} | Failed to deduct PP at ${path} for ${actor.name}.`, err);
          return { applied: false, requested, deducted: 0, before: current, after: current, path, reason: err?.message ?? String(err) };
        }
      }
    }

    return {
      applied: false,
      requested,
      deducted: 0,
      before: null,
      after: null,
      path: "",
      reason: `No numeric PP path found. Configure the PP path mapping setting. Tried: ${this.paths("pp").join(", ")}`
    };
  }

  static async applyBloodDamage(actor, dice, criticalSeverity) {
    if (!actor) return false;
    const payload = { dice, criticalSeverity, appliedAt: new Date().toISOString() };
    const history = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "bloodDamageLog") ?? []);
    history.push(payload);
    await actor.setFlag(MODULE_ID, "bloodDamageLog", history);
    return true;
  }

  static async rollAndApplyBlood(actor, dice = 0, criticalSeverity = 0) {
    if (!actor) return { applied: false, rollTotal: 0, rollFormula: "", reason: "No actor" };

    const count = Math.max(0, Number(dice) || 0);
    let roll = null;
    let rollTotal = 0;

    if (count > 0) {
      roll = await new Roll(`${count}d10`).evaluate();
      rollTotal = Number(roll.total) || 0;
      try {
        if (game.modules.get("dice-so-nice")?.active && game.dice3d) {
          await game.dice3d.showForRoll(roll, game.user, true);
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | Dice So Nice blood roll failed.`, err);
      }
    }

    const appliedDamage = rollTotal > 0 ? await this.applyDamage(actor, rollTotal) : true;

    const payload = {
      dice: count,
      criticalSeverity: Number(criticalSeverity) || 0,
      rollFormula: roll?.formula ?? (count ? `${count}d10` : ""),
      rollTotal,
      appliedDamage,
      appliedAt: new Date().toISOString()
    };
    const history = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "bloodDamageLog") ?? []);
    history.push(payload);
    await actor.setFlag(MODULE_ID, "bloodDamageLog", history);

    return {
      applied: appliedDamage,
      rollTotal,
      rollFormula: payload.rollFormula,
      criticalSeverity: payload.criticalSeverity
    };
  }

  static async applyDamage(actor, amount) {
    if (!actor || !amount) return false;

    const configured = this.getSetting("hpPathMapping");
    const paths = configured ? configured.split(",").map(s => s.trim()).filter(Boolean) : [
      "system.health.hp.value",
      "system.hp.value",
      "system.hits.value",
      "system.resources.hp.value",
      "system.resources.hits.value"
    ];

    for (const path of paths) {
      const current = Number(foundry.utils.getProperty(actor, path));
      if (Number.isFinite(current)) {
        await actor.update({ [path]: Math.max(0, current - Number(amount)) });
        return true;
      }
    }

    return false;
  }
}

function getSheetActor(app) {
  return app?.actor ?? app?.document ?? app?.object ?? null;
}

function shouldShowButton() {
  if (!game.settings.get(MODULE_ID, "showSheetButton")) return false;
  if (game.settings.get(MODULE_ID, "gmOnlyButton") && !game.user.isGM) return false;
  return true;
}

function injectButton(app, html) {
  try {
    if (!shouldShowButton()) return;
    const actor = getSheetActor(app);
    if (!actor?.documentName || actor.documentName !== "Actor") return;

    const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
    if (!root || root.querySelector?.(".rmu-magical-ritual-launch")) return;

    const label = game.settings.get(MODULE_ID, "buttonLabel") || "Magical Ritual";
    const icon = game.settings.get(MODULE_ID, "buttonIcon") || "fas fa-hat-wizard";
    const button = document.createElement("a");
    button.className = "rmu-magical-ritual-launch header-button control";
    button.innerHTML = `<i class="${icon}"></i> ${label}`;
    button.title = label;
    button.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      game.rmuMagicalRituals?.open(actor);
    });

    const targets = [
      root.querySelector(".window-header .window-title"),
      root.querySelector(".window-header"),
      root.querySelector("header.window-header"),
      root.querySelector(".sheet-header")
    ].filter(Boolean);

    if (targets[0]?.classList?.contains("window-title")) targets[0].after(button);
    else if (targets[0]) targets[0].appendChild(button);
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to inject actor sheet button`, err);
  }
}

export function registerActorIntegration() {
  Hooks.on("renderActorSheet", injectButton);
  Hooks.on("renderActorSheetV2", injectButton);
  Hooks.on("renderApplication", (app, html) => {
    if (getSheetActor(app)?.documentName === "Actor") injectButton(app, html);
  });

  /*
   * Scene control integration intentionally mirrors rmu-complementary-skills:
   * - use getSceneControlButtons
   * - find the existing Token Controls group named "tokens"
   * - assign a tool into tokenControls.tools by key
   *
   * The extra fallbacks keep it working on newer Foundry builds that may expose
   * the group as "token" or expose tools as an array.
   */
  Hooks.on("getSceneControlButtons", controls => {
    try {
      if (game.settings.get(MODULE_ID, "gmOnlyButton") && !game.user.isGM) return;

      let tokenControls = null;

      for (const key in controls) {
        const control = controls[key];
        if (
          control?.name === "tokens" ||
          control?.name === "token" ||
          key === "tokens" ||
          key === "token"
        ) {
          tokenControls = control;
          break;
        }
      }

      if (!tokenControls && Array.isArray(controls)) {
        tokenControls = controls.find(c => c?.name === "tokens" || c?.name === "token");
      }

      if (!tokenControls) {
        console.warn(`${MODULE_ID} | Token controls group was not found.`);
        return;
      }

      const tool = {
        name: "rmu-magical-rituals",
        title: game.settings.get(MODULE_ID, "buttonLabel") || "Magical Ritual",
        icon: game.settings.get(MODULE_ID, "buttonIcon") || "fas fa-hat-wizard",
        button: true,
        visible: !game.settings.get(MODULE_ID, "gmOnlyButton") || game.user.isGM,
        onChange: () => {
          if (!game.rmuMagicalRituals?.openForSelectedToken) {
            console.error(`${MODULE_ID} | Button clicked, but API is not registered.`);
            ui.notifications?.error("RMU Magical Rituals is not initialized.");
            return;
          }
          game.rmuMagicalRituals.openForSelectedToken();
        }
      };

      if (!tokenControls.tools) tokenControls.tools = {};

      // Match Complementary Skills exactly when tools is an object.
      if (!Array.isArray(tokenControls.tools)) {
        tokenControls.tools["rmu-magical-rituals"] = tool;
        return;
      }

      // Fallback for newer array-style controls.
      const existing = tokenControls.tools.findIndex(t => t?.name === tool.name);
      if (existing >= 0) tokenControls.tools[existing] = tool;
      else tokenControls.tools.push(tool);
    } catch (err) {
      console.warn(`${MODULE_ID} | Failed to add token control`, err);
    }
  });
}
