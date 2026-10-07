import { MODULE_ID, RitualCalculator } from "./ritual-calculator.js";
import { ritualSpellDuration } from "./ritual-duration.js";
import { RitualActorAdapter } from "./actor-integration.js";

export class RitualResolution {
  static canApplySpell(resolution = {}) {
    const band = String(resolution?.band ?? "").trim().toLowerCase();
    if (["partial success", "success", "absolute success"].includes(band)) return true;
    if (["failure", "absolute failure"].includes(band)) return false;

    const final = Number(resolution?.final);
    if (Number.isFinite(final)) return final >= 76;
    return resolution?.success === true;
  }

  static protectionsVariableSpell(spell = {}) {
    const spellName = String(spell?.spellName ?? spell?.name ?? "").trim().toLowerCase();
    const listName = String(spell?.spellListName ?? spell?.spellList ?? "").trim().toLowerCase();
    if (listName !== "protections") return null;
    const displayName = String(spell?.spellName ?? spell?.name ?? spellName).trim();
    const match = spellName.match(/^(prayer|bless|resistance) (i|iii|v)$/);
    if (match) {
      const tiers = { i: [5, 1], iii: [15, 3], v: [25, 5] };
      const [totalBonus, maxTargets] = tiers[match[2]];
      return { name: displayName, family: match[1], totalBonus, maxTargets };
    }
    if (["heat resistance", "cold resistance"].includes(spellName)) {
      return { name: displayName, family: "conditional", totalBonus: 20, maxTargets: 1 };
    }
    return null;
  }

  static distributeProtectionsBonus(targetCount, total = 15, maxTargets = 3) {
    const count = Math.max(1, Math.min(maxTargets, Math.trunc(Number(targetCount) || 1)));
    const points = Math.max(0, Math.trunc(Number(total) || 0));
    const base = Math.floor(points / count);
    const remainder = points % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  static protectionsResistanceEffects(value, spellName = "Resistance") {
    const bonus = Math.max(0, Math.trunc(Number(value) || 0));
    const resistances = ["Channeling", "Essence", "Mentalism", "Physical", "Fear"];
    return [
      ...resistances.map(name => ({
        effect: "stat-bonus",
        upgrade: true,
        hint: `RMU.Resistance.${name}`,
        key: `system.resist.${name}.bonus`,
        value: bonus,
        description: `${spellName} resistance-roll bonus`
      })),
      {
        effect: "stat-bonus",
        upgrade: true,
        hint: "RMU.Effects.DB",
        key: "system.defense.db.aura.bonus",
        value: bonus,
        description: `${spellName} Defensive Bonus`
      }
    ];
  }

  static protectionsManeuverEffects(target, value, spellName = "Prayer") {
    const bonus = Math.max(0, Math.trunc(Number(value) || 0));
    const categories = new Set();
    const combatTrainingSkills = [];
    for (const item of target?.actor?.system?._skills ?? []) {
      const skill = item?.system ?? item;
      const category = String(skill?.category ?? "").trim();
      const name = String(skill?.name ?? item?.name ?? "").trim();
      const specialization = String(skill?.specialization ?? "").trim();
      if (!category || !name) continue;
      categories.add(category);
      if (category === "Combat Training") combatTrainingSkills.push({ name, specialization });
    }
    const paths = new Set(Array.from(categories)
      .filter(category => category !== "Combat Training")
      .map(category => `system.skills.${category}.bonus`));
    if (categories.has("Combat Training")) {
      if (!categories.has("Melee Combat")) {
        paths.add("system.skills.Combat Training.bonus");
      } else {
        const carried = new Set(["Unarmed", "Melee Weapons", "Shield"]);
        for (const { name, specialization } of combatTrainingSkills) {
          if (!carried.has(name)) paths.add(`system.skills.Combat Training.${name}${specialization ? `.${specialization}` : ""}.bonus`);
        }
      }
    }
    return Array.from(paths, key => ({
      effect: "skill-bonus",
      upgrade: true,
      hint: "all maneuver rolls",
      key,
      value: bonus,
      description: `${spellName} maneuver-roll bonus`
    }));
  }

  static async roll(data, calculation) {
    const primaryActor = this.#primaryActor(data);
    const totalModifier = Number(calculation?.total ?? 0);

    let roll = null;
    try {
      roll = await new Roll("d100oe", {}, {
        rmuContext: "RMU.ManualInputRolls.Maneuver",
        window: primaryActor?.sheet?.window
      }).roll({});
    } catch (err) {
      console.warn(`${MODULE_ID} | RMU open-ended d100 failed; falling back to Roll("1d100").`, err);
      roll = await new Roll("1d100").evaluate();
    }

    await this.#showDiceSoNice(roll);

    const naturalTotal = Number(roll.total ?? roll.result ?? 0);
    const final = naturalTotal + totalModifier;
    const rmuManeuver = await this.#resolveRMUMagicalRitualManeuver(primaryActor, roll, data, totalModifier, final);

    return {
      roll,
      rollTotal: naturalTotal,
      modifierTotal: totalModifier,
      final,
      rmuManeuver,
      ...this.resolve(final, naturalTotal, data, rmuManeuver)
    };
  }

  static resolve(final, natural = null, data = {}, rmuManeuver = null) {
    let resolution = {};
    if (final < 1) {
      resolution = {
        band: "Absolute Failure",
        success: false,
        text: "Catastrophic failure. Make one spell failure roll and apply the result to the primary caster and all major contributors; add total ritual PP to that roll.",
        spellFailureRequired: true,
        spellFailurePPModifier: RitualCalculator.getTotalPP(data)
      };
    } else if (final <= 75) {
      resolution = {
        band: "Failure",
        success: false,
        text: "Ritual fails. Make one spell failure roll and apply the result to the primary caster and all major contributors.",
        spellFailureRequired: true,
        spellFailurePPModifier: 0
      };
    } else if (final <= 100) {
      resolution = {
        band: "Partial Success",
        success: true,
        text: "Ritual succeeds, but make one spell failure roll and apply the result to the primary caster and all major contributors; ignore PP-loss and effect-loss results.",
        spellFailureRequired: true,
        spellFailurePPModifier: 0
      };
    } else if (final <= 175) {
      resolution = { band: "Success", success: true, text: "Ritual works.", spellFailureRequired: false, spellFailurePPModifier: 0 };
    } else {
      resolution = { band: "Absolute Success", success: true, text: "Ritual works. Casting level increased by 50%.", spellFailureRequired: false, spellFailurePPModifier: 0, castingLevelMultiplier: 1.5 };
    }

    if (rmuManeuver?.decision) {
      resolution.rmuDecision = rmuManeuver.decision;
      resolution.rmuDescription = rmuManeuver.description;
      resolution.rmuTableName = rmuManeuver.tableName;
    }

    if (natural === 66) resolution.unusualEvent = "UM 66: Unusual Event. Ritual disturbs Essence; GM should determine side effect.";
    resolution.spellApplicationAllowed = this.canApplySpell({ ...resolution, final });
    if (resolution.spellApplicationAllowed) {
      const spells = Array.isArray(data.selectedSpells) ? data.selectedSpells : Object.values(data.selectedSpells ?? {});
      resolution.spellDurations = spells.map(spell => ({
        name: spell.spellName || spell.name || "Spell",
        ...ritualSpellDuration(
          spell,
          data.parameterExtensions?.durationSteps,
          data.casterLevel,
          data.parameterExtensions?.concentrationToRoundsPerLevel === true
        )
      })).filter(entry => entry.label);
    }
    if (data.resistible) {
      resolution.resistance = {
        SCR: 50,
        attackLevel: Number(data.casterLevel ?? 1),
        note: "Use SCR 50 and Primary Caster Level as attack level."
      };
    }
    return resolution;
  }

  static async sendChat(data, calculation, resolution) {
    const affectedSpellFailureTargets = this.#spellFailureTargets(data, resolution);
    const affectedSpellFailureParticipants = affectedSpellFailureTargets.map(t => t.name);
    if (resolution?.spellFailureRequired) {
      resolution.spellFailureParticipants = affectedSpellFailureParticipants;
      resolution.spellFailureTargets = affectedSpellFailureTargets;
    }

    const template = `modules/${MODULE_ID}/templates/ritual-chat-card.hbs`;
    const context = { data, calculation, resolution, affectedSpellFailureParticipants, affectedSpellFailureTargets };
    const renderer = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    const content = await renderer(template, context);

    const speaker = ChatMessage.getSpeaker({ actor: this.#primaryActor(data) });
    return ChatMessage.create({
      speaker,
      content,
      rolls: resolution?.roll ? [resolution.roll] : [],
      flags: {
        [MODULE_ID]: {
          isRitualResult: true,
          template: data,
          calculation,
          resolution
        }
      }
    });
  }


  static registerChatListeners() {
    const handler = (message, html) => {
      const root = html?.querySelector ? html : html?.[0];
      if (!root) return;
      if (!message?.getFlag?.(MODULE_ID, "isRitualResult")) return;

      root.querySelectorAll("[data-rmumr-action='roll-spell-failure']").forEach(button => {
        button.addEventListener("click", ev => this.#onRollSpellFailure(ev, message));
      });
      root.querySelectorAll("[data-rmumr-action='apply-spell']").forEach(button => {
        button.addEventListener("click", ev => this.#onApplySpell(ev, message));
      });
    };

    Hooks.on("renderChatMessageHTML", handler);
  }

  static async #onApplySpell(event, message) {
    event.preventDefault();
    const resolution = message.getFlag(MODULE_ID, "resolution") ?? {};
    const data = message.getFlag(MODULE_ID, "template") ?? {};
    await this.applySpellToTargets(data, resolution, Number(event.currentTarget.dataset.spellIndex), message.uuid);
  }

  static async applySpellToTargets(data, resolution, index, origin = null) {
    if (!this.canApplySpell(resolution)) return ui.notifications.warn("Only a Partial Success or better can apply a ritual spell.");
    const duration = resolution.spellDurations?.[index];
    if (!duration?.supported) return ui.notifications.warn("This spell duration cannot be applied automatically.");
    const targets = Array.from(game.user?.targets ?? []);
    if (!targets.length) return ui.notifications.warn("Target one or more tokens before applying the ritual spell.");
    const selected = Array.isArray(data.selectedSpells) ? data.selectedSpells : Object.values(data.selectedSpells ?? {});
    let spell = selected[index];
    if (!spell) return ui.notifications.warn("The ritual spell could not be found.");
    if (!spell.effects?.length) {
      const options = await RitualActorAdapter.getSpellOptions(this.#primaryActor(data));
      spell = options.find(opt => opt.id === spell.id)
        ?? options.find(opt => opt.spellName === spell.spellName && opt.spellListName === spell.spellListName && Number(opt.level) === Number(spell.level))
        ?? spell;
    }
    const sourceEffects = Array.isArray(spell.effects) ? spell.effects : [];
    const protectionsConfig = this.protectionsVariableSpell(spell);
    if (protectionsConfig) {
      return this.#applyProtectionsVariableSpell(data, spell, protectionsConfig, targets, origin);
    }
    if (!sourceEffects.length) return ui.notifications.warn(`${duration.name} has no automatic RMU effect data to apply.`);

    const primaryActor = this.#primaryActor(data);
    const casterToken = Array.from(canvas.tokens?.placeables ?? []).find(token => token.actor?.id === primaryActor?.id)
      ?? primaryActor?.getActiveTokens?.()[0]
      ?? null;
    if (!casterToken) {
      return ui.notifications.warn("Place the primary caster's token on the active scene before applying ritual spell effects.");
    }

    const timedEffects = sourceEffects.map(effect => {
      const timed = {
        ...foundry.utils.deepClone(effect),
        name: duration.name
      };
      delete timed.rounds;
      delete timed.durationByCasterLevelBy;
      delete timed.seconds;
      delete timed.units;
      if (Number.isFinite(duration.seconds)) {
        timed.seconds = duration.seconds;
        timed.units = "seconds";
      }
      return timed;
    });

    /*
     * Hand the effects to RMU's normal spell-target workflow. RMU creates its
     * standard utility card for each target; that card's Apply action uses the
     * system ownership checks and SocketLib GM proxy instead of requiring this
     * player to create ActiveEffect documents directly on another actor.
     */
    const systemPath = game.system?.id === "rmu" ? "systems/rmu" : `systems/${game.system?.id}`;
    const { processSCRTargets } = await import(`/${systemPath}/module/rmu/chat/render-scr.js`);
    const nativeSpell = {
      ...foundry.utils.deepClone(spell),
      name: duration.name,
      _translatedName: duration.name,
      _translatedDescription: spell.description ?? "",
      spellType: spell.spellType ?? "U",
      effects: timedEffects,
      _castingLevel: Number(data.casterLevel ?? 1),
      _modifiedDuration: {
        duration: duration.totalLabel,
        temporalFactor: 1,
        hasConcentrate: duration.concentration === true
      },
      _modifiedRange: { range: "target" }
    };
    const nativeResult = {
      resultCode: 1,
      resistibleSpell: false,
      effectName: "",
      spell: nativeSpell
    };
    await processSCRTargets(
      casterToken,
      nativeSpell,
      nativeResult,
      targets.map(token => ({ tokenId: token.id })),
      timedEffects,
      { apply: true, renderData: { token: casterToken, scr: nativeResult } }
    );
    ui.notifications.info(`Created RMU effect application card${targets.length === 1 ? "" : "s"} for ${duration.name} (${duration.totalLabel}).`);
  }

  static async #applyProtectionsVariableSpell(data, spell, config, targets, origin = null) {
    if (targets.length > config.maxTargets) return ui.notifications.warn(`${config.name} can affect no more than ${config.maxTargets} target${config.maxTargets === 1 ? "" : "s"}.`);
    if (config.family === "conditional") {
      return ui.notifications.warn(`${config.name}'s bonuses only apply against ${config.name.startsWith("Heat") ? "heat" : "cold"}. RMU has no conditional resistance/DB Active Effect field, so this spell must be tracked manually.`);
    }

    const primaryActor = this.#primaryActor(data);
    const casterToken = Array.from(canvas.tokens?.placeables ?? []).find(token => token.actor?.id === primaryActor?.id)
      ?? primaryActor?.getActiveTokens?.()[0]
      ?? null;
    if (!casterToken) {
      return ui.notifications.warn("Place the primary caster's token on the active scene before applying ritual spell effects.");
    }

    const choices = await this.#promptProtectionsApplication(targets, config);
    if (!choices) return;
    if (choices.bonuses.some(value => !Number.isInteger(value) || value < 1) || choices.bonuses.reduce((sum, value) => sum + value, 0) !== config.totalBonus) {
      return ui.notifications.warn(`${config.name} bonuses must be positive whole numbers totaling ${config.totalBonus}.`);
    }
    if (choices.durationMode === "self" && targets.some(token => token.actor?.id !== primaryActor?.id)) {
      return ui.notifications.warn("The 1 minute per level duration is only available when the caster is the target.");
    }

    const duration = this.#protectionsDuration(choices.durationMode, data);
    const systemPath = game.system?.id === "rmu" ? "systems/rmu" : `systems/${game.system?.id}`;
    const { processSCRTargets } = await import(`/${systemPath}/module/rmu/chat/render-scr.js`);

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const bonus = choices.bonuses[index];
      const resistanceEffects = ["prayer", "resistance"].includes(config.family)
        ? this.protectionsResistanceEffects(bonus, config.name).filter(effect => config.family === "resistance" || !effect.key.includes("defense.db"))
        : [];
      const defensiveEffects = config.family === "bless"
        ? this.protectionsResistanceEffects(bonus, config.name).filter(effect => effect.key.includes("defense.db"))
        : [];
      const maneuverEffects = ["prayer", "bless"].includes(config.family)
        ? this.protectionsManeuverEffects(target, bonus, config.name)
        : [];
      const effects = [...resistanceEffects, ...defensiveEffects, ...maneuverEffects].map(effect => {
        const timed = { ...effect, name: config.name };
        if (Number.isFinite(duration.seconds)) {
          timed.seconds = duration.seconds;
          timed.units = "seconds";
        }
        return timed;
      });
      const nativeSpell = {
        ...foundry.utils.deepClone(spell),
        name: config.name,
        _translatedName: config.name,
        _translatedDescription: spell.description ?? "",
        spellType: spell.spellType ?? "U",
        effects,
        _castingLevel: Number(data.casterLevel ?? 1),
        _modifiedDuration: {
          duration: duration.totalLabel,
          temporalFactor: 1,
          hasConcentrate: duration.concentration === true
        },
        _modifiedRange: { range: "target" }
      };
      const nativeResult = { resultCode: 1, resistibleSpell: false, effectName: "", spell: nativeSpell };
      await processSCRTargets(
        casterToken,
        nativeSpell,
        nativeResult,
        [{ tokenId: target.id }],
        effects,
        { apply: true, renderData: { token: casterToken, scr: nativeResult } }
      );
    }

    ui.notifications.info(`Created RMU effect application card${targets.length === 1 ? "" : "s"} for ${config.name} (${duration.totalLabel}).`);
  }

  static #protectionsDuration(mode, data) {
    const casterLevel = Math.max(1, Math.trunc(Number(data.casterLevel) || 1));
    const steps = Math.max(0, Math.trunc(Number(data.parameterExtensions?.durationSteps) || 0));
    if (mode === "self") return ritualSpellDuration({ duration: "1 min/lvl" }, steps, casterLevel);
    if (mode === "stationary") return ritualSpellDuration({ duration: "10 min/lvl" }, steps, casterLevel);
    if (data.parameterExtensions?.concentrationToRoundsPerLevel) {
      return ritualSpellDuration({ duration: "1 rnd/lvl" }, steps, casterLevel);
    }
    return {
      label: "Concentration",
      totalLabel: "Concentration (remove when concentration ends)",
      seconds: null,
      supported: true,
      concentration: true
    };
  }

  static async #promptProtectionsApplication(targets, config) {
    const defaults = this.distributeProtectionsBonus(targets.length, config.totalBonus, config.maxTargets);
    const escape = value => foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "");
    const rows = targets.map((token, index) => `
      <label style="display:grid;grid-template-columns:1fr 7em;gap:.5em;align-items:center;margin:.35em 0">
        <span>${escape(token.name ?? token.actor?.name ?? `Target ${index + 1}`)}</span>
        <input type="number" name="bonus-${index}" min="1" max="${config.totalBonus}" step="1" value="${defaults[index]}">
      </label>`).join("");
    const content = `
      <form>
        <p>Distribute ${escape(config.name)}'s total +${config.totalBonus} bonus among the targeted tokens.</p>
        ${rows}
        <label style="display:grid;grid-template-columns:1fr 14em;gap:.5em;align-items:center;margin-top:.75em">
          <span>Prayer I duration condition</span>
          <select name="durationMode">
            <option value="mobile">Mobile target — Concentration</option>
            <option value="stationary">Stationary target — 10 minutes/level</option>
            <option value="self">Caster is target — 1 minute/level</option>
          </select>
        </label>
      </form>`;

    return new Promise(resolve => {
      new Dialog({
        title: `Apply ${config.name}`,
        content,
        buttons: {
          apply: {
            label: "Create RMU Apply Cards",
            callback: html => {
              const root = html?.[0] ?? html;
              const bonuses = targets.map((_, index) => Number(root?.querySelector?.(`[name='bonus-${index}']`)?.value));
              const durationMode = root?.querySelector?.("[name='durationMode']")?.value ?? "mobile";
              resolve({ bonuses, durationMode });
            }
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "apply",
        close: () => resolve(null)
      }).render(true);
    });
  }

  static async #onRollSpellFailure(event, message) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.classList.contains("rmumr-disabled")) return;

    const flagData = message.getFlag(MODULE_ID, "template") ?? {};
    const resolution = message.getFlag(MODULE_ID, "resolution") ?? {};
    const targets = this.#spellFailureTargets(flagData, resolution);

    if (!targets.length) {
      ui.notifications.warn("No eligible ritual participants were found for spell failure.");
      return;
    }

    await this.#rollSpellFailureForTargets(targets, flagData, resolution);

    const rolled = foundry.utils.deepClone(message.getFlag(MODULE_ID, "spellFailureRolled") ?? {});
    rolled.all = true;
    for (const target of targets) rolled[target.id] = true;
    await message.setFlag(MODULE_ID, "spellFailureRolled", rolled);

    button.classList.add("rmumr-disabled");
    button.setAttribute("disabled", "disabled");
    button.closest(".chat-message")?.querySelectorAll("[data-rmumr-action='roll-spell-failure']").forEach(b => {
      b.classList.add("rmumr-disabled");
      b.setAttribute("disabled", "disabled");
    });
  }

  static async #rollSpellFailureForTargets(targets, data, resolution) {
    const valid = [];
    for (const target of targets) {
      const token = this.#targetToken(target);
      if (!token?.actor) {
        ui.notifications.warn(`Could not find an active token for ${target.name}; place or select a token before rolling spell failure.`);
        continue;
      }
      valid.push({ target, token });
    }

    if (!valid.length) return;

    const totalModifier = Number(resolution?.spellFailurePPModifier ?? 0) || 0;
    const realm = this.#spellFailureRealm(valid[0].target, data);
    const spellType = this.#spellFailureType(data);

    let failureRoll;
    try {
      failureRoll = await new Roll("d100ou + @modifiers", { modifiers: totalModifier }, {
        rmuContext: "RMU.ManualInputRolls.SpellFailure"
      }).roll({});
    } catch (err) {
      console.warn(`${MODULE_ID} | RMU spell failure roll failed; falling back to 1d100 + modifier.`, err);
      failureRoll = await new Roll("1d100 + @modifiers", { modifiers: totalModifier }).evaluate();
    }

    await this.#showDiceSoNice(failureRoll);

    for (const entry of valid) {
      await this.#applySpellFailureResult(entry.target, entry.token, data, resolution, failureRoll, totalModifier, realm, spellType);
    }
  }

  static async #applySpellFailureResult(target, token, data, resolution, failureRoll, totalModifier, realm, spellType) {
    try {
      const systemPath = game.system?.path ?? "systems/rmu";
      const spellFailureModule = await import(`/${systemPath}/module/rmu/spell-casting/spell-failure.js`);
      const renderModule = await import(`/${systemPath}/module/rmu/chat/render-spell-failure.js`);
      const sf = new spellFailureModule.SpellFailure(token);
      const result = await sf.resolveSpellFailure(failureRoll, {
        totalModifier,
        spellType,
        realm,
        alchemicalFailureType: "General"
      });

      await renderModule.renderSpellFailure(token, result, failureRoll);
      return;
    } catch (err) {
      console.warn(`${MODULE_ID} | Native RMU spell failure renderer failed; posting fallback result.`, err);
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token }),
      content: `
        <div class="rmumr-chat-card rmumr-chat-card-compact">
          <h3>Ritual Spell Failure: ${target.name}</h3>
          <p><strong>Realm:</strong> ${realm} <strong>Type:</strong> ${spellType}</p>
          <p><strong>Shared Roll:</strong> ${failureRoll.total} ${totalModifier ? `(includes ${totalModifier >= 0 ? "+" : ""}${totalModifier})` : ""}</p>
          <p>Native RMU spell failure table could not be resolved. Use the RMU Spell Failure table manually and apply this shared result to this participant.</p>
        </div>`
    });
  }

  static #targetToken(target) {
    if (target.tokenId) {
      const byId = canvas.tokens?.get?.(target.tokenId) ?? canvas.tokens?.placeables?.find(t => t.id === target.tokenId || t.document?.id === target.tokenId);
      if (byId) return byId;
    }

    const actor = target.actorUuid && typeof fromUuidSync === "function" ? fromUuidSync(target.actorUuid) : game.actors?.get(target.actorId);
    const active = actor?.getActiveTokens?.()?.[0];
    if (active) return active;

    return canvas.tokens?.controlled?.find(t => t.actor?.id === actor?.id) ??
      canvas.tokens?.placeables?.find(t => t.actor?.id === actor?.id || t.actor?.uuid === actor?.uuid) ??
      null;
  }

  static #spellFailureRealm(target, data) {
    const selected = Array.isArray(data.selectedSpells) ? data.selectedSpells[0] : null;
    const realm = String(selected?.realm || data.spellRealm || data.casterRealm || target.realm || "Channeling");
    if (/essence/i.test(realm)) return "Essence";
    if (/mental/i.test(realm)) return "Mentalism";
    if (/arcane/i.test(realm)) return "Arcane";
    if (/channel/i.test(realm)) return "Channeling";
    return "Channeling";
  }

  static #spellFailureType(data) {
    const selected = Array.isArray(data.selectedSpells) ? data.selectedSpells[0] : null;
    const raw = String(selected?.spellType ?? selected?.type ?? data.spellType ?? "U").trim();
    const first = raw.charAt(0).toUpperCase();
    return ["I", "F", "U", "E", "A"].includes(first) ? first : "U";
  }

  static #spellFailureTargets(data, resolution = {}) {
    const existing = Array.isArray(resolution?.spellFailureTargets) ? resolution.spellFailureTargets : null;
    if (existing?.length) return existing;

    return (data.participants ?? [])
      .filter(p => p?.role === "primary" || p?.role === "major")
      .map((p, i) => ({
        id: String(p.actorUuid || p.actorId || p.actorName || i),
        actorId: p.actorId ?? null,
        actorUuid: p.actorUuid ?? null,
        tokenId: p.tokenId ?? p.tokenDocumentId ?? null,
        name: p.actorName || p.name || p.actorId || p.actorUuid || "Participant",
        role: p.role,
        realm: p.realm || data.casterRealm || data.spellRealm || "Channeling"
      }))
      .filter(t => t.name);
  }

  static async #showDiceSoNice(roll) {
    try {
      if (game.modules.get("dice-so-nice")?.active && game.dice3d) {
        await game.dice3d.showForRoll(roll, game.user, true);
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Dice So Nice animation failed.`, err);
    }
  }

  static async #resolveRMUMagicalRitualManeuver(actor, roll, data, modifierTotal, final) {
    try {
      const pack = game.packs.get("rmu-spell-law.roll-tables") ?? game.packs.get("rmu.roll-tables");
      if (!pack) return null;
      if (!pack.index?.size) await pack.getIndex();
      const entry = pack.index.find(e => e.name === "Magical Ritual") ?? pack.index.find(e => String(e.name ?? "").toLowerCase().includes("magical ritual"));
      if (!entry) return null;
      const table = await pack.getDocument(entry._id);
      const results = this.#getTableResults(table, final);
      const result = results.find(r => r.flags?.rmu?.um !== true) ?? results[0];

      const flags = result?.flags?.rmu ?? {};
      const lang = game.settings.get("core", "language");
      const description = (flags?.[lang] ?? flags.description ?? result?.description ?? "").trim();

      return {
        actorId: actor?.id,
        tableName: flags.name ?? table.name ?? "Magical Ritual",
        skillName: "Magical Ritual",
        skillCategory: "Spellcasting",
        specialization: data.category ?? "",
        skillBonus: Number(data.baseSkillBonus ?? 0),
        totalBonus: modifierTotal,
        totalModifier: modifierTotal,
        rollTotal: Number(roll.total ?? 0),
        total: final,
        decision: flags.result ?? result?.text ?? result?.name ?? "",
        description,
        effects: flags.effects ?? []
      };
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not resolve RMU Magical Ritual maneuver table.`, err);
      return null;
    }
  }

  static #getTableResults(table, total) {
    if (!table) return [];
    if (typeof table.getResultsForRoll === "function") return table.getResultsForRoll(total) ?? [];
    const results = Array.from(table.results ?? []);
    return results.filter(r => {
      const range = r.range ?? [];
      const lo = Number(range[0] ?? -Infinity);
      const hi = Number(range[1] ?? Infinity);
      return total >= lo && total <= hi;
    });
  }


  static #primaryActor(data) {
    const p = (data.participants ?? []).find(p => p.role === "primary");
    return p?.actorUuid && typeof fromUuidSync === "function" ? fromUuidSync(p.actorUuid) : game.actors?.get(p?.actorId);
  }
}
