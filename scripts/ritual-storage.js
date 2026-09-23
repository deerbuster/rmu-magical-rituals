import { MODULE_ID, RitualCalculator } from "./ritual-calculator.js";

export class RitualStorage {
  static flagPath = "templates";

  /**
   * Return the persistent ritual model without actor-derived UI caches.
   * Actor skill lists are rebuilt whenever a ritual is loaded.
   */
  static prepareTemplate(data) {
    const record = foundry.utils.deepClone(data ?? RitualCalculator.defaultData());
    record.participants = Array.from(record.participants ?? []).map(participant => {
      const {
        supportSkills,
        supportSkillGroups,
        ritualSkillBonus,
        ritualRanks,
        complementarySkillLabel,
        complementarySkillActualRanks,
        complementarySkillBonus,
        complementarySkillRanks,
        ...persistent
      } = participant ?? {};
      return persistent;
    });
    delete record.newParticipantActor;
    delete record.newParticipantRole;
    delete record.savedTemplateId;
    return record;
  }

  static async saveTemplate(actor, data) {
    if (!actor) throw new Error("An actor is required to save a ritual template.");
    const templates = foundry.utils.deepClone(actor.getFlag(MODULE_ID, this.flagPath) ?? []);
    const id = data.id || foundry.utils.randomID();
    const record = { ...this.prepareTemplate(data), id, savedAt: new Date().toISOString() };
    const index = templates.findIndex(t => t.id === id);
    if (index >= 0) templates[index] = record;
    else templates.push(record);
    await actor.setFlag(MODULE_ID, this.flagPath, templates);
    return record;
  }

  static listTemplates(actor) {
    return foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, this.flagPath) ?? []);
  }

  static async deleteTemplate(actor, id) {
    const templates = this.listTemplates(actor).filter(t => t.id !== id);
    await actor.setFlag(MODULE_ID, this.flagPath, templates);
  }

  static cloneTemplate(data) {
    const clone = foundry.utils.deepClone(data ?? RitualCalculator.defaultData());
    clone.id = foundry.utils.randomID();
    clone.name = `${clone.name || "Ritual"} (Copy)`;
    return clone;
  }

  static exportTemplate(data) {
    const template = this.prepareTemplate(data);
    delete template.id;
    delete template.savedAt;
    return JSON.stringify({
      flags: {
        rmuMagicalRituals: {
          schemaVersion: 2,
          fullTemplate: template
        }
      }
    }, null, 2);
  }

  static importTemplate(jsonText) {
    const parsed = JSON.parse(jsonText);
    const flagData = parsed?.flags?.rmuMagicalRituals;
    if (flagData?.fullTemplate) return flagData.fullTemplate;
    if (flagData) return { ...RitualCalculator.defaultData(), ...flagData };
    return { ...RitualCalculator.defaultData(), ...parsed };
  }

  static async promptImport() {
    return new Promise(resolve => {
      new Dialog({
        title: game.i18n.localize("RMUMR.ImportTemplate"),
        content: `<form><textarea name="json" rows="14" style="width:100%" placeholder="Paste exported ritual JSON"></textarea></form>`,
        buttons: {
          import: {
            label: game.i18n.localize("RMUMR.Import"),
            callback: html => {
              const value = html.find?.("[name=json]").val?.() ?? html.querySelector?.("[name=json]")?.value;
              resolve(this.importTemplate(value));
            }
          },
          cancel: { label: game.i18n.localize("Cancel"), callback: () => resolve(null) }
        },
        default: "import"
      }).render(true);
    });
  }

  static async promptImportFile() {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          resolve(this.importTemplate(await file.text()));
        } catch (err) {
          console.error(`${MODULE_ID} | Unable to import ritual JSON`, err);
          ui.notifications.error(`Could not import ${file.name}: ${err.message}`);
          resolve(null);
        }
      }, { once: true });
      input.click();
    });
  }

  static downloadTemplate(data) {
    const blob = new Blob([this.exportTemplate(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.name || "ritual").slugify?.() || "ritual"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
