import { MODULE_ID, RitualCalculator, RITUAL_CATEGORIES, REALMS, LIST_TYPES, KNOWLEDGE, TIME_TABLE, DURATION_LADDER } from "./ritual-calculator.js";
import { RitualResolution } from "./ritual-resolution.js";
import { RitualStorage } from "./ritual-storage.js";
import { RitualActorAdapter } from "./actor-integration.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications?.api ?? {};
const BaseApp = ApplicationV2 ? HandlebarsApplicationMixin(ApplicationV2) : Application;

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

export class RitualSpellPicker extends BaseApp {
  constructor(ritualApp, options = {}) {
    super(options);
    this.ritualApp = ritualApp;
    this.data = foundry.utils.deepClone(ritualApp.data ?? {});
    this.selected = collectionToArray(this.data.selectedSpells);
  }

  static DEFAULT_OPTIONS = {
    id: "rmu-magical-rituals-spell-picker",
    classes: ["rmu-magical-rituals", "rmu-ritual-spell-picker"],
    tag: "div",
    window: { title: "Select Ritual Spells", resizable: true },
    position: { width: 900, height: 720 },
    actions: {
      addSpell: RitualSpellPicker.#addSpell,
      removeSpell: RitualSpellPicker.#removeSpell,
      useSpells: RitualSpellPicker.#useSpells,
      closePicker: RitualSpellPicker.#closePicker
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spell-picker.hbs` }
  };

  async _prepareContext() {
    const primaryActor = await this.ritualApp._getPrimaryActorForChild();
    const allSpellOptions = await RitualActorAdapter.getSpellOptions(primaryActor ?? this.ritualApp.actor);
    const selector = this.#selectorContext(allSpellOptions);
    return {
      data: this.data,
      selected: this.selected,
      realms: REALMS,
      spellListCategories: selector.categories,
      spellLists: selector.lists,
      spellOptions: selector.spells,
      spellSelector: selector
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("select").forEach(el => {
      el.addEventListener("change", () => {
        this.#readForm();
        if (el.name === "spellRealm") {
          this.data.selectedSpellCategory = "";
          this.data.selectedSpellList = "";
          this.data.selectedSpellId = "";
        }
        if (el.name === "selectedSpellCategory") {
          this.data.selectedSpellList = "";
          this.data.selectedSpellId = "";
        }
        if (el.name === "selectedSpellList") this.data.selectedSpellId = "";
        this.render({ force: false });
      });
    });
  }

  #readForm() {
    const form = this.element?.querySelector("form");
    if (!form) return;
    const fd = new FormData(form);
    Object.assign(this.data, Object.fromEntries(fd.entries()));
  }

  #selectorContext(allSpellOptions = []) {
    const realm = this.data.spellRealm || "";
    const category = this.data.selectedSpellCategory || "";
    const selectedList = this.data.selectedSpellList || "";

    const sameRealm = s => !realm || String(s.realm ?? "") === String(realm);
    const sameCategory = s => !category || String(s.categoryLabel ?? "") === String(category);
    const sameList = s => !selectedList || String(s.spellListName ?? "") === String(selectedList);

    const categoryMap = new Map();
    for (const spell of allSpellOptions.filter(s => sameRealm(s))) {
      const name = spell.categoryLabel || "Uncategorized";
      if (!categoryMap.has(name)) categoryMap.set(name, { name, label: name, realm: spell.realm });
    }

    const listMap = new Map();
    for (const spell of allSpellOptions.filter(s => sameRealm(s) && sameCategory(s))) {
      const name = spell.spellListName || "Unknown List";
      if (!listMap.has(name)) listMap.set(name, { name, label: name, realm: spell.realm, categoryLabel: spell.categoryLabel });
    }

    const categoryOrder = label => {
      const lower = String(label).toLowerCase();
      if (lower.startsWith("open ")) return 0;
      if (lower.startsWith("closed ")) return 1;
      if (lower.includes(" base")) return 2;
      if (lower.startsWith("evil ")) return 3;
      return 4;
    };

    const categories = Array.from(categoryMap.values()).sort((a, b) => categoryOrder(a.label) - categoryOrder(b.label) || a.label.localeCompare(b.label));
    const lists = Array.from(listMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    const spells = allSpellOptions
      .filter(s => sameRealm(s) && sameCategory(s) && sameList(s))
      .sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0) || a.spellName.localeCompare(b.spellName));

    return { realm, category, selectedList, categories, lists, spells, categoryCount: categories.length, listCount: lists.length, spellCount: spells.length, totalSpellCount: allSpellOptions.length };
  }

  static async #addSpell() {
    this.#readForm();
    const primaryActor = await this.ritualApp._getPrimaryActorForChild();
    const options = await RitualActorAdapter.getSpellOptions(primaryActor ?? this.ritualApp.actor);
    const selected = options.find(o => o.id === this.data.selectedSpellId);
    if (!selected) return ui.notifications.warn("Choose a spell first.");
    if (!this.selected.some(s => s.id === selected.id)) {
      this.selected.push({
        id: selected.id,
        spellName: selected.spellName,
        spellListName: selected.spellListName,
        categoryLabel: selected.categoryLabel,
        level: selected.level,
        realm: selected.realm,
        ritualListType: selected.ritualListType,
        knowledge: selected.knowledge,
        ranksBeyond: selected.ranksBeyond,
        uuid: selected.uuid,
        listType: selected.listType,
        listProfession: selected.listProfession
      });
    }
    this.render({ force: false });
  }

  static #removeSpell(event, target) {
    const index = Number(target.dataset.index);
    this.selected.splice(index, 1);
    this.render({ force: false });
  }

  static async #useSpells() {
    this.#readForm();
    await this.ritualApp.applySelectedSpellsFromPicker(this.selected);
    this.close();
  }

  static #closePicker() {
    this.close();
  }
}

export class RitualApp extends BaseApp {
  constructor(actorOrToken = null, options = {}) {
    super(options);
    const actor = actorOrToken?.actor ?? actorOrToken ?? null;
    this.actor = actor?.documentName === "Actor" ? actor : null;
    this.data = foundry.utils.mergeObject(RitualCalculator.defaultData(this.actor), options.template ?? {}, { inplace: false });
    this.#normalizeCollections(this.data);
    if (this.actor) {
      this.data.casterLevel = RitualActorAdapter.getLevel(this.actor);
      this.data.casterRealm = RitualActorAdapter.getRealm(this.actor);
      this.data.baseSkillBonus = RitualActorAdapter.getRitualSkill(this.actor, this.data.category);
      const primary = this.data.participants.find(p => p.role === "primary");
      if (primary) Object.assign(primary, RitualActorAdapter.buildParticipant(this.actor, "primary", this.data.category));
    }
    this.activeTab = "setup";
    this.lastCalculation = RitualCalculator.calculate(this.data, this.#settings());
    this.lastResolution = null;
  }

  static DEFAULT_OPTIONS = {
    id: "rmu-magical-rituals-app",
    classes: ["rmu-magical-rituals", "rmu-ritual-app"],
    tag: "div",
    window: {
      title: "RMUMR.Title",
      resizable: true,
      controls: [
        { icon: "fas fa-save", label: "RMUMR.SaveTemplate", action: "saveTemplate" },
        { icon: "fas fa-file-export", label: "RMUMR.ExportTemplate", action: "exportTemplate" },
        { icon: "fas fa-file-import", label: "RMUMR.ImportTemplate", action: "importTemplate" }
      ]
    },
    position: { width: 1040, height: 900 },
    actions: {
      changeTab: RitualApp.#changeTab,
      addParticipant: RitualApp.#addParticipant,
      removeParticipant: RitualApp.#removeParticipant,
      calculate: RitualApp.#calculate,
      rollRitual: RitualApp.#rollRitual,
      saveTemplate: RitualApp.#saveTemplate,
      loadTemplate: RitualApp.#loadTemplate,
      deleteTemplate: RitualApp.#deleteTemplate,
      exportTemplate: RitualApp.#exportTemplate,
      importTemplate: RitualApp.#importTemplate,
      cloneTemplate: RitualApp.#cloneTemplate,
      addCircumstance: RitualApp.#addCircumstance,
      removeCircumstance: RitualApp.#removeCircumstance,
      openSpellPicker: RitualApp.#openSpellPicker
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/ritual-app.hbs` }
  };


  setPosition(position = {}) {
    /*
     * Foundry v13/v14 may invoke SceneControlTool#onChange during the control
     * state transition. In that path ApplicationV2 can briefly call setPosition
     * before the application element is attached. Guarding here prevents the
     * core _updatePosition offsetWidth null crash while preserving normal
     * positioning once the element exists.
     */
    if (!this.element) return this.position;
    return super.setPosition(position);
  }

  async _prepareContext() {
    this.#normalizeCollections(this.data);
    this.#refreshParticipantActorData();
    this.lastCalculation = RitualCalculator.calculate(this.data, this.#settings());
    const primaryActor = await this.#primaryActor();
    const allSpellOptions = await RitualActorAdapter.getSpellOptions(primaryActor ?? this.actor);
    const spellSelector = this.#spellSelectorContext(allSpellOptions);
    return {
      app: this,
      data: this.data,
      primaryCasterId: (this.data.participants ?? []).find(p => p.role === "primary")?.actorId ?? "",
      selectedSpells: collectionToArray(this.data.selectedSpells),
      calculation: this.lastCalculation,
      resolutionSummary: this.#resolutionSummary(this.lastCalculation?.total ?? 0),
      spellKnowledgeLabel: (KNOWLEDGE[this.data.spellKnowledge]?.label ?? this.data.spellKnowledge ?? ""),
      resolution: this.lastResolution,
      tabs: [
        ["setup", "Ritual Setup"], ["investments", "Time and Items"],
        ["parameters", "Spell Parameter Extension"], ["modifiers", "Modifier Engine"], ["resolution", "Resolution"]
      ],
      activeTab: this.activeTab,
      categories: RITUAL_CATEGORIES,
      realms: REALMS,
      listTypes: Object.entries(LIST_TYPES).map(([id, v]) => ({ id, ...v })),
      spellListCategories: spellSelector.categories,
      knowledge: Object.entries(KNOWLEDGE).map(([id, v]) => ({ id, ...v })),
      times: TIME_TABLE,
      durationLadder: DURATION_LADDER,
      actors: game.actors?.contents ?? [],
      spellOptions: spellSelector.spells,
      allSpellOptions,
      spellLists: spellSelector.lists,
      spellSelector,
      realmRows: this.#realmRows(),
      savedTemplates: this.#savedTemplates(),
      isGM: game.user.isGM
    };
  }



  #resolutionSummary(total = 0) {
    const mod = Number(total) || 0;
    const full = Math.max(1, 101 - mod);
    const partialLow = Math.max(1, 76 - mod);
    const partialHigh = Math.max(0, 100 - mod);
    if (full <= 1) return "1+ Full Success";
    if (partialLow <= partialHigh) return `${full}+ Full | ${partialLow}-${partialHigh} Partial`;
    return `${full}+ Full`;
  }

  #realmRows() {
    const pp = this.lastCalculation?.ppRealms ?? RitualCalculator.getPPRealms(this.data);
    const rows = [
      ["channeling", "Channeling"],
      ["essence", "Essence"],
      ["mentalism", "Mentalism"],
      ["hybrid", "Hybrid"],
      ["arcane", "Arcane/Other"]
    ];

    return rows.map(([key, label]) => {
      const detected = Boolean(pp.detected?.[key]);
      const manual = Boolean(this.data.realmsUsed?.[key] || pp.manual?.[key]);
      return {
        key,
        label,
        checked: detected || manual,
        detected,
        disabled: detected,
        title: detected ? "Detected automatically from active ritual participants" : "Manual realm override/addition"
      };
    });
  }

  #spellSelectorContext(allSpellOptions = []) {
    const realm = this.data.spellRealm || "";
    const category = this.data.selectedSpellCategory || "";
    const selectedList = this.data.selectedSpellList || "";

    const sameRealm = s => !realm || String(s.realm ?? "") === String(realm);
    const sameCategory = s => !category || String(s.categoryLabel ?? "") === String(category);
    const sameList = s => !selectedList || String(s.spellListName ?? "") === String(selectedList);

    const categoryMap = new Map();
    for (const spell of allSpellOptions.filter(s => sameRealm(s))) {
      const name = spell.categoryLabel || "Uncategorized";
      if (!categoryMap.has(name)) categoryMap.set(name, { name, label: name, realm: spell.realm });
    }

    const listMap = new Map();
    for (const spell of allSpellOptions.filter(s => sameRealm(s) && sameCategory(s))) {
      const name = spell.spellListName || "Unknown List";
      if (!listMap.has(name)) {
        listMap.set(name, {
          name,
          realm: spell.realm,
          categoryLabel: spell.categoryLabel,
          label: name
        });
      }
    }

    const categoryOrder = label => {
      const lower = String(label).toLowerCase();
      if (lower.startsWith("open ")) return 0;
      if (lower.startsWith("closed ")) return 1;
      if (lower.includes(" base")) return 2;
      if (lower.startsWith("evil ")) return 3;
      return 4;
    };

    const categories = Array.from(categoryMap.values()).sort((a, b) => {
      const ao = categoryOrder(a.label);
      const bo = categoryOrder(b.label);
      return ao - bo || a.label.localeCompare(b.label);
    });
    const lists = Array.from(listMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    const spells = allSpellOptions
      .filter(s => sameRealm(s) && sameCategory(s) && sameList(s))
      .sort((a, b) => {
        const la = Number(a.level) || 0;
        const lb = Number(b.level) || 0;
        return la - lb || a.spellName.localeCompare(b.spellName);
      });

    return {
      realm,
      category,
      selectedList,
      categories,
      lists,
      spells,
      categoryCount: categories.length,
      listCount: lists.length,
      spellCount: spells.length,
      totalSpellCount: allSpellOptions.length
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("input, select, textarea").forEach(el => {
      el.addEventListener("change", async ev => {
        /*
         * The add-participant controls are transient launch controls, not part
         * of the persisted ritual form. Re-rendering as soon as the user picks
         * an actor resets the selection before Add Participant can read it.
         */
        if (["newParticipantActor", "newParticipantRole", "savedTemplateId"].includes(el.name)) {
          if (el.name === "savedTemplateId") this.data.savedTemplateId = el.value;
          return;
        }

        this.#readForm();

        if (el.name === "primaryCasterId") {
          await this.#setPrimaryCaster(el.value);
          this.render({ force: true });
          return;
        }

        if (["spellRealm"].includes(el.name)) {
          this.data.selectedSpellCategory = "";
          this.data.selectedSpellList = "";
          this.data.selectedSpellId = "";
          this.render({ force: true });
          return;
        }

        if (el.name === "selectedSpellCategory") {
          this.data.selectedSpellList = "";
          this.data.selectedSpellId = "";
          this.render({ force: true });
          return;
        }

        if (el.name === "selectedSpellList") {
          this.data.selectedSpellId = "";
          this.render({ force: true });
          return;
        }

        if (el.name === "selectedSpellId") {
          await this.#applySelectedSpell();
          this.render({ force: true });
          return;
        }

        if (el.name === "category") {
          await this.#refreshPrimaryCasterDerived();
          this.render({ force: true });
          return;
        }

        if (/^participants\.\d+\.role$/.test(el.name) && el.value === "primary") {
          this.#makeParticipantIndexPrimary(el.name);
          await this.#refreshPrimaryCasterDerived();
          this.render({ force: true });
          return;
        }

        this.render({ force: false });
      });
    });
  }


  async _getPrimaryActorForChild() {
    return this.#primaryActor();
  }

  async #primaryActor() {
    const primary = (this.data.participants ?? []).find(p => p.role === "primary") ?? this.data.participants?.[0];
    if (primary?.actorUuid) {
      try {
        const actor = await fromUuid(primary.actorUuid);
        if (actor?.documentName === "Actor") return actor;
      } catch (err) {
        console.warn(`${MODULE_ID} | Unable to resolve primary caster UUID`, err);
      }
    }
    if (primary?.actorId) return game.actors?.get(primary.actorId) ?? this.actor ?? null;
    return this.actor ?? null;
  }


  async #setPrimaryCaster(actorId) {
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    this.#normalizeCollections(this.data);
    for (const p of this.data.participants) {
      if (p.role === "primary") p.role = "major";
    }
    const existing = this.data.participants.find(p => p.actorId === actor.id);
    const built = RitualActorAdapter.buildParticipant(actor, "primary", this.data.category);
    if (existing) Object.assign(existing, built, { role: "primary" });
    else this.data.participants.unshift(built);

    this.actor = actor;
    this.data.casterLevel = RitualActorAdapter.getLevel(actor);
    this.data.casterRealm = RitualActorAdapter.getRealm(actor);
    this.data.baseSkillBonus = RitualActorAdapter.getRitualSkill(actor, this.data.category);

    if (collectionToArray(this.data.selectedSpells).length) {
      await this.applySelectedSpellsFromPicker(this.data.selectedSpells);
    }
  }

  async applySelectedSpellsFromPicker(spells = []) {
    this.#normalizeCollections(this.data);
    const selected = collectionToArray(spells);
    this.data.selectedSpells = selected;
    this.data.includedSpellEffects = Math.max(1, selected.length || 1);

    if (!selected.length) {
      this.data.selectedSpellId = "";
      this.data.selectedSpellLabel = "";
      return;
    }

    const first = selected[0];
    this.data.selectedSpellId = first.id ?? "";
    this.data.targetEffect = selected.map(s => s.spellName || s.name || "Spell").join(", ");
    this.data.selectedSpellLabel = this.data.targetEffect;
    this.data.selectedSpellList = first.spellListName ?? this.data.selectedSpellList ?? "";
    this.data.selectedSpellCategory = first.categoryLabel ?? this.data.selectedSpellCategory ?? "";
    this.data.spellLevel = selected.reduce((sum, s) => sum + (Number(s.level) || 1), 0);
    this.data.spellRealm = first.realm || this.data.spellRealm;
    this.data.spellListType = first.ritualListType || this.data.spellListType;
    this.data.spellKnowledge = first.knowledge || this.data.spellKnowledge;
    this.data.ranksBeyond = Number(first.ranksBeyond) || 0;
    await this.#refreshPrimaryCasterDerived();
    this.render({ force: true });
  }

  async #refreshSelectedSpellsForPrimary(primaryActor = null) {
    this.#normalizeCollections(this.data);
    const selected = collectionToArray(this.data.selectedSpells);
    if (!selected.length) return;

    const actor = primaryActor ?? await this.#primaryActor();
    const options = await RitualActorAdapter.getSpellOptions(actor ?? this.actor);

    const findUpdated = old => {
      const oldLevel = Number(old.level) || 1;
      return options.find(o => o.id === old.id)
        ?? options.find(o =>
          String(o.spellName ?? "") === String(old.spellName ?? old.name ?? "") &&
          String(o.spellListName ?? "") === String(old.spellListName ?? "") &&
          (Number(o.level) || 1) === oldLevel
        )
        ?? options.find(o =>
          String(o.uuid ?? "") === String(old.uuid ?? "") &&
          String(o.spellName ?? "") === String(old.spellName ?? old.name ?? "")
        );
    };

    const updated = selected.map(old => {
      const match = findUpdated(old);
      if (!match) return old;
      return {
        ...old,
        id: match.id ?? old.id,
        spellName: match.spellName ?? old.spellName,
        spellListName: match.spellListName ?? old.spellListName,
        categoryLabel: match.categoryLabel ?? old.categoryLabel,
        level: match.level ?? old.level,
        realm: match.realm ?? old.realm,
        ritualListType: match.ritualListType ?? old.ritualListType,
        knowledge: match.knowledge ?? old.knowledge,
        ranksBeyond: match.ranksBeyond ?? old.ranksBeyond,
        ranks: match.ranks ?? old.ranks,
        uuid: match.uuid ?? old.uuid,
        listType: match.listType ?? old.listType,
        listProfession: match.listProfession ?? old.listProfession
      };
    });

    this.data.selectedSpells = updated;
    this.data.includedSpellEffects = Math.max(1, updated.length || 1);
    this.data.targetEffect = updated.map(s => s.spellName || s.name || "Spell").join(", ");
    this.data.selectedSpellLabel = this.data.targetEffect;
    this.data.spellLevel = updated.reduce((sum, s) => sum + (Number(s.level) || 1), 0);

    const first = updated[0];
    if (first) {
      this.data.selectedSpellId = first.id ?? this.data.selectedSpellId ?? "";
      this.data.selectedSpellList = first.spellListName ?? this.data.selectedSpellList ?? "";
      this.data.selectedSpellCategory = first.categoryLabel ?? this.data.selectedSpellCategory ?? "";
      this.data.spellRealm = first.realm || this.data.spellRealm;
      this.data.spellListType = first.ritualListType || this.data.spellListType;
      this.data.spellKnowledge = first.knowledge || this.data.spellKnowledge;
      this.data.ranksBeyond = Number(first.ranksBeyond) || 0;
    }
  }

  async #refreshPrimaryCasterDerived() {
    const primaryActor = await this.#primaryActor();
    if (!primaryActor) return;
    this.data.casterLevel = RitualActorAdapter.getLevel(primaryActor);
    this.data.casterRealm = RitualActorAdapter.getRealm(primaryActor);
    this.data.baseSkillBonus = RitualActorAdapter.getRitualSkill(primaryActor, this.data.category);

    await this.#refreshSelectedSpellsForPrimary(primaryActor);

    const primary = this.data.participants.find(p => p.role === "primary");
    if (primary) {
      const previous = foundry.utils.deepClone(primary);
      const refreshed = RitualActorAdapter.buildParticipant(primaryActor, "primary", this.data.category);
      Object.assign(primary, refreshed, {
        ppContributed: previous.ppContributed ?? refreshed.ppContributed,
        spellAdderChargesUsed: previous.spellAdderChargesUsed ?? refreshed.spellAdderChargesUsed,
        bloodDice: previous.bloodDice ?? refreshed.bloodDice,
        criticalSeverityBloodInvestment: previous.criticalSeverityBloodInvestment ?? refreshed.criticalSeverityBloodInvestment,
        complementarySkillName: previous.complementarySkillName ?? "",
        complementarySkillLabel: previous.complementarySkillLabel ?? "",
        complementarySkillActualRanks: previous.complementarySkillActualRanks ?? 0,
        complementarySkillBonus: previous.complementarySkillBonus ?? 0,
        complementarySkillRanks: previous.complementarySkillRanks ?? 0
      });
    }
  }

  async #applySelectedSpell() {
    if (!this.data.selectedSpellId) return;
    const primaryActor = await this.#primaryActor();
    const options = await RitualActorAdapter.getSpellOptions(primaryActor ?? this.actor);
    const selected = options.find(o => o.id === this.data.selectedSpellId);
    if (!selected) return;

    this.data.selectedSpells = [{
      id: selected.id,
      spellName: selected.spellName,
      spellListName: selected.spellListName,
      categoryLabel: selected.categoryLabel,
      level: selected.level,
      realm: selected.realm,
      ritualListType: selected.ritualListType,
      knowledge: selected.knowledge,
      ranksBeyond: selected.ranksBeyond,
      uuid: selected.uuid,
      listType: selected.listType,
      listProfession: selected.listProfession
    }];
    this.data.includedSpellEffects = 1;
    this.data.targetEffect = selected.spellName;
    this.data.selectedSpellLabel = selected.label ?? selected.spellName;
    this.data.selectedSpellList = selected.spellListName ?? this.data.selectedSpellList ?? "";
    this.data.selectedSpellCategory = selected.categoryLabel ?? this.data.selectedSpellCategory ?? "";
    this.data.spellLevel = Number(selected.level) || this.data.spellLevel || 1;
    this.data.spellRealm = selected.realm || this.data.spellRealm;
    this.data.spellListType = selected.ritualListType || this.data.spellListType;
    this.data.spellKnowledge = selected.knowledge || this.data.spellKnowledge;
    this.data.ranksBeyond = Number(selected.ranksBeyond) || 0;

    if (primaryActor) {
      this.data.casterLevel = RitualActorAdapter.getLevel(primaryActor);
      this.data.casterRealm = RitualActorAdapter.getRealm(primaryActor);
      this.data.baseSkillBonus = RitualActorAdapter.getRitualSkill(primaryActor, this.data.category);
      const primary = this.data.participants.find(p => p.role === "primary");
      if (primary) Object.assign(primary, RitualActorAdapter.buildParticipant(primaryActor, "primary", this.data.category));
    }
  }

  #refreshParticipantActorData() {
    for (const p of this.data.participants ?? []) {
      if (!p) continue;
      let actor = null;
      if (p.actorId) actor = game.actors?.get(p.actorId) ?? null;

      const actorRealm = actor ? RitualActorAdapter.getRealm(actor) : "";
      if (actorRealm && (!p.realm || String(p.realm).trim() === "")) p.realm = actorRealm;

      p.supportSkills = actor ? RitualActorAdapter.getKnownSkills(actor) : [];
      p.supportSkillGroups = actor ? RitualActorAdapter.getKnownSkillGroups(actor) : [];

      /*
       * RMU developer clarification: the support skill contribution uses the
       * better of the chosen support skill ranks and the selected Magical
       * Ritual specialization ranks. This avoids a weaker support skill reducing
       * the contributor below their ritual training baseline.
       */
      if (actor && p.complementarySkillName) {
        const skill = RitualActorAdapter.getKnownSkillByLabel(actor, p.complementarySkillName);
        const supportRanks = Number(skill?.ranks ?? p.complementarySkillRanks ?? 0) || 0;
        const ritualRanks = Number(p.ritualRanks ?? 0) || 0;
        p.complementarySkillRanks = Math.max(ritualRanks, supportRanks);
        p.complementarySkillActualRanks = supportRanks;
        p.complementarySkillBonus = Number(skill?.bonus ?? 0) || 0;
        p.complementarySkillLabel = skill?.label ?? skill?.fullName ?? skill?.name ?? p.complementarySkillLabel ?? "";
      } else if (!p.complementarySkillName) {
        p.complementarySkillLabel = "";
        p.complementarySkillActualRanks = 0;
        p.complementarySkillBonus = 0;
      }
    }
  }


  #makeParticipantIndexPrimary(fieldName) {
    const match = String(fieldName ?? "").match(/^participants\.(\d+)\.role$/);
    if (!match) return;
    const primaryIndex = Number(match[1]);
    this.#normalizeCollections(this.data);
    this.data.participants.forEach((p, i) => {
      if (!p) return;
      if (i === primaryIndex) p.role = "primary";
      else if (p.role === "primary") p.role = "major";
    });
    const primary = this.data.participants[primaryIndex];
    const actor = primary?.actorId ? game.actors?.get(primary.actorId) : null;
    if (actor) this.actor = actor;
  }


  #templateActor() {
    const primaryId = (this.data.participants ?? []).find(p => p.role === "primary")?.actorId;
    return (primaryId ? game.actors?.get(primaryId) : null) ?? this.actor ?? null;
  }

  #savedTemplates() {
    const actor = this.#templateActor();
    return RitualStorage.listTemplates(actor).map(t => ({
      id: t.id,
      name: t.name || "Unnamed Ritual",
      savedAt: t.savedAt || ""
    }));
  }

  #settings() {
    return {
      proportionalItemBonus: game.settings.get(MODULE_ID, "proportionalItemBonus")
    };
  }

  #readForm() {
    const form = this.element.querySelector("form");
    if (!form) return;
    const fd = new FormData(form);
    const obj = foundry.utils.expandObject(Object.fromEntries(fd.entries()));
    const checked = name => Boolean(form.querySelector(`[name="${name}"]`)?.checked);
    this.data = foundry.utils.mergeObject(this.data, obj, { inplace: false, insertKeys: true, overwrite: true });
    this.data.parameterExtensions ??= {};
    for (const key of ["areaDecrease", "noDurationToOneRound", "concentrationToRoundsPerLevel", "removeConcentration", "selfSpellExpanded"]) {
      this.data.parameterExtensions[key] = checked(`parameterExtensions.${key}`);
    }
    this.data.realmsUsed = {
      channeling: checked("realmsUsed.channeling"),
      essence: checked("realmsUsed.essence"),
      mentalism: checked("realmsUsed.mentalism"),
      hybrid: checked("realmsUsed.hybrid"),
      arcane: checked("realmsUsed.arcane")
    };
    this.data.resistible = checked("resistible");
    this.#normalizeCollections(this.data);
    this.#refreshParticipantActorData();
    this.#coerceNumbers(this.data);
  }

  #normalizeCollections(data) {
    // Foundry v12+ FormData + expandObject returns dotted numeric collections as
    // plain objects ({0:{...},1:{...}}), while the ritual engine expects arrays.
    const toArray = value => {
      if (Array.isArray(value)) return value.filter(v => v !== undefined && v !== null);
      if (value && typeof value === "object") {
        return Object.entries(value)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, v]) => v)
          .filter(v => v !== undefined && v !== null);
      }
      return [];
    };

    data.participants = toArray(data.participants);
    data.circumstances = toArray(data.circumstances);
    data.selectedSpells = toArray(data.selectedSpells);
  }

  #isSafePlainObject(value) {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return true;

    // Do not recurse into Foundry Documents, Collections, Folders, Items, Actors,
    // JQuery objects, HTMLElements, or other class instances. Some Foundry objects
    // expose getters such as documentName which can recurse when Object.entries is
    // called during form processing.
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  #coerceNumbers(obj) {
    if (!this.#isSafePlainObject(obj)) return;

    const keysToKeepAsStrings = new Set([
      "actorId",
      "actorUuid",
      "uuid",
      "id",
      "supportSkillId",
      "supportSkillUuid",
      "complementarySkillName",
      "complementarySkillLabel",
      "ritualSkillId",
      "ritualSkillUuid",
      "spellUuid",
      "listUuid"
    ]);

    for (const [k, v] of Object.entries(obj ?? {})) {
      if (this.#isSafePlainObject(v)) {
        if (Array.isArray(v)) {
          for (const entry of v) this.#coerceNumbers(entry);
        } else {
          this.#coerceNumbers(v);
        }
      } else if (
        typeof v === "string" &&
        v.trim() !== "" &&
        !Number.isNaN(Number(v)) &&
        !keysToKeepAsStrings.has(k)
      ) {
        obj[k] = Number(v);
      }
    }
  }

  static #changeTab(event, target) {
    this.#readForm();
    this.activeTab = target.dataset.tab;
    this.render({ force: false });
  }

  static #addParticipant(event, target) {
    this.#readForm();
    const actorId = this.element.querySelector("[name='newParticipantActor']")?.value;
    const role = this.element.querySelector("[name='newParticipantRole']")?.value ?? "minor";
    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.warn(game.i18n.localize("RMUMR.SelectActor"));
    this.#normalizeCollections(this.data);
    this.data.participants.push(RitualActorAdapter.buildParticipant(actor, role, this.data.category));
    this.render({ force: false });
  }

  static #removeParticipant(event, target) {
    this.#readForm();
    const index = Number(target.dataset.index);
    this.#normalizeCollections(this.data);
    this.data.participants.splice(index, 1);
    if (!this.data.participants.some(p => p.role === "primary") && this.data.participants[0]) this.data.participants[0].role = "primary";
    this.render({ force: false });
  }

  static #openSpellPicker() {
    this.#readForm();
    const picker = new RitualSpellPicker(this);
    picker.render({ force: true });
  }

  static #calculate() {
    this.#readForm();
    this.lastCalculation = RitualCalculator.calculate(this.data, this.#settings());
    this.render({ force: false });
  }

  static async #rollRitual() {
    this.#readForm();
    this.lastCalculation = RitualCalculator.calculate(this.data, this.#settings());
    this.lastResolution = await RitualResolution.roll(this.data, this.lastCalculation);
    this.lastResolution.costApplication = await this.#applyRitualCosts(this.lastCalculation);
    await RitualResolution.sendChat(this.data, this.lastCalculation, this.lastResolution);
    this.render({ force: false });
  }

  async #applyRitualCosts(calculation) {
    const result = {
      requiredPP: Number(calculation?.requiredPP ?? RitualCalculator.getRequiredPP(this.data)) || 0,
      additionalPP: Number(calculation?.additionalPP ?? RitualCalculator.getAdditionalPP(this.data)) || 0,
      pp: [],
      blood: []
    };

    const participants = Array.isArray(this.data.participants) ? this.data.participants : Object.values(this.data.participants ?? {});
    const primary = participants.find(p => p?.role === "primary");

    for (const p of participants) {
      if (!p || p.role === "setDressing") continue;
      const actor = p.actorUuid ? await fromUuid(p.actorUuid) : game.actors.get(p.actorId);
      if (!actor) continue;

      const additionalPP = Number(p.ppContributed) || 0;
      const requiredPP = p === primary ? result.requiredPP : 0;
      const totalPP = additionalPP + requiredPP;

      if (totalPP > 0) {
        const ppResult = await RitualActorAdapter.deductPP(actor, totalPP);
        result.pp.push({
          actorId: actor.id,
          actorUuid: actor.uuid,
          actorName: actor.name,
          requiredPP,
          additionalPP,
          totalPP,
          applied: Boolean(ppResult?.applied),
          deducted: Number(ppResult?.deducted ?? 0),
          before: ppResult?.before ?? null,
          after: ppResult?.after ?? null,
          path: ppResult?.path ?? "",
          reason: ppResult?.reason ?? ""
        });
        if (!ppResult?.applied) {
          ui.notifications.warn(`RMU Magical Rituals could not deduct ${totalPP} PP from ${actor.name}. ${ppResult?.reason ?? ""}`);
        }
      }

      const bloodDice = Number(p.bloodDice) || 0;
      const critSeverity = Number(p.criticalSeverityBloodInvestment) || 0;
      if (bloodDice > 0 || critSeverity > 0) {
        const blood = await RitualActorAdapter.rollAndApplyBlood(actor, bloodDice, critSeverity);
        result.blood.push({
          actorId: actor.id,
          actorUuid: actor.uuid,
          actorName: actor.name,
          bloodDice,
          critSeverity,
          ...blood
        });
      }
    }

    return result;
  }

  static async #saveTemplate() {
    this.#readForm();
    const actor = this.#templateActor();
    if (!actor) return ui.notifications.warn(game.i18n.localize("RMUMR.NoPrimaryCaster"));
    const record = await RitualStorage.saveTemplate(actor, this.data);
    this.data.id = record.id;
    this.data.savedAt = record.savedAt;
    this.data.savedTemplateId = record.id;
    ui.notifications.info(game.i18n.localize("RMUMR.TemplateSaved"));
    this.render({ force: false });
  }

  static #loadTemplate(event, target) {
    // Do not rely solely on the last rendered state; read the current select value.
    const select = this.element?.querySelector("[name='savedTemplateId']");
    const id = select?.value || this.data.savedTemplateId || "";
    if (!id) return ui.notifications.warn("Choose a saved ritual template first.");

    const actor = this.#templateActor();
    if (!actor) return ui.notifications.warn(game.i18n.localize("RMUMR.NoPrimaryCaster"));

    const template = RitualStorage.listTemplates(actor).find(t => String(t.id) === String(id));
    if (!template) return ui.notifications.warn("Saved ritual template was not found for the current primary caster.");

    const loaded = foundry.utils.deepClone(template);
    loaded.savedTemplateId = id;
    this.data = foundry.utils.mergeObject(RitualCalculator.defaultData(this.actor), loaded, { inplace: false });
    this.#normalizeCollections(this.data);
    this.#coerceNumbers(this.data);
    this.lastResolution = null;
    ui.notifications.info(`Loaded ritual template: ${this.data.name || "Unnamed Ritual"}`);
    this.render({ force: true });
  }

  static async #deleteTemplate() {
    const select = this.element?.querySelector("[name='savedTemplateId']");
    const id = select?.value || this.data.savedTemplateId || "";
    if (!id) return ui.notifications.warn("Choose a saved ritual template first.");
    const actor = this.#templateActor();
    if (!actor) return ui.notifications.warn(game.i18n.localize("RMUMR.NoPrimaryCaster"));
    await RitualStorage.deleteTemplate(actor, id);
    if (String(this.data.savedTemplateId) === String(id)) this.data.savedTemplateId = "";
    ui.notifications.info("Ritual template deleted.");
    this.render({ force: true });
  }

  static #exportTemplate() {
    this.#readForm();
    RitualStorage.downloadTemplate(this.data);
  }

  static async #importTemplate() {
    const imported = await RitualStorage.promptImport();
    if (imported) {
      this.data = foundry.utils.mergeObject(RitualCalculator.defaultData(this.actor), imported, { inplace: false });
      this.render({ force: true });
    }
  }

  static #cloneTemplate() {
    this.#readForm();
    this.data = RitualStorage.cloneTemplate(this.data);
    this.data.savedTemplateId = "";
    this.lastResolution = null;
    this.render({ force: true });
  }

  static #addCircumstance() {
    this.#readForm();
    this.data.circumstances ??= [];
    this.#normalizeCollections(this.data);
    this.data.circumstances.push({ label: "Manual modifier", value: 0, detail: "" });
    this.render({ force: false });
  }

  static #removeCircumstance(event, target) {
    this.#readForm();
    this.#normalizeCollections(this.data);
    this.data.circumstances.splice(Number(target.dataset.index), 1);
    this.render({ force: false });
  }
}
