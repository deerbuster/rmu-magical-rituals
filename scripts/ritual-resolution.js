import { MODULE_ID, RitualCalculator } from "./ritual-calculator.js";

export class RitualResolution {
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
        text: "Catastrophic failure. Roll spell failure for the primary caster and all major contributors; add total ritual PP to each spell failure roll.",
        spellFailureRequired: true,
        spellFailurePPModifier: RitualCalculator.getTotalPP(data)
      };
    } else if (final <= 75) {
      resolution = {
        band: "Failure",
        success: false,
        text: "Ritual fails. Roll spell failure for the primary caster and all major contributors.",
        spellFailureRequired: true,
        spellFailurePPModifier: 0
      };
    } else if (final <= 100) {
      resolution = {
        band: "Partial Success",
        success: true,
        text: "Ritual succeeds, but roll spell failure for the primary caster and all major contributors; ignore PP-loss and effect-loss results.",
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
    };

    Hooks.on("renderChatMessageHTML", handler);
  }

  static async #onRollSpellFailure(event, message) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button.classList.contains("rmumr-disabled")) return;

    const flagData = message.getFlag(MODULE_ID, "template") ?? {};
    const resolution = message.getFlag(MODULE_ID, "resolution") ?? {};
    const targetId = button.dataset.targetId;
    const targets = this.#spellFailureTargets(flagData, resolution);
    const selected = targetId === "all" ? targets : targets.filter(t => t.id === targetId);

    if (!selected.length) {
      ui.notifications.warn("No eligible ritual participants were found for spell failure.");
      return;
    }

    for (const target of selected) {
      await this.#rollSpellFailureForTarget(target, flagData, resolution);
    }

    const rolled = foundry.utils.deepClone(message.getFlag(MODULE_ID, "spellFailureRolled") ?? {});
    for (const target of selected) rolled[target.id] = true;
    await message.setFlag(MODULE_ID, "spellFailureRolled", rolled);

    button.classList.add("rmumr-disabled");
    button.setAttribute("disabled", "disabled");
    if (targetId === "all") {
      button.closest(".chat-message")?.querySelectorAll("[data-rmumr-action='roll-spell-failure']").forEach(b => {
        b.classList.add("rmumr-disabled");
        b.setAttribute("disabled", "disabled");
      });
    }
  }

  static async #rollSpellFailureForTarget(target, data, resolution) {
    const token = this.#targetToken(target);
    if (!token?.actor) {
      ui.notifications.warn(`Could not find an active token for ${target.name}; place or select a token before rolling spell failure.`);
      return;
    }

    const totalModifier = Number(resolution?.spellFailurePPModifier ?? 0) || 0;
    const realm = this.#spellFailureRealm(target, data);
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
          <p><strong>Roll:</strong> ${failureRoll.total} ${totalModifier ? `(includes ${totalModifier >= 0 ? "+" : ""}${totalModifier})` : ""}</p>
          <p>Native RMU spell failure table could not be resolved. Use the RMU Spell Failure table manually.</p>
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
    const realm = String(target.realm || data.spellRealm || data.casterRealm || "Channeling");
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
