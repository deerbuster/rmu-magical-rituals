import { MODULE_ID, RitualCalculator } from "./ritual-calculator.js";
import { RitualApp } from "./ritual-app.js";
import { RitualStorage } from "./ritual-storage.js";
import { RitualResolution } from "./ritual-resolution.js";
import { registerActorIntegration, RitualActorAdapter } from "./actor-integration.js";

function setting(key, data) {
  game.settings.register(MODULE_ID, key, data);
}

Hooks.once("init", () => {
  Handlebars.registerHelper("rmumrEq", (a, b) => a === b);
  Handlebars.registerHelper("rmumrChecked", v => v ? "checked" : "");
  Handlebars.registerHelper("rmumrSelected", (a, b) => String(a ?? "") === String(b ?? "") ? "selected" : "");
  Handlebars.registerHelper("rmumrSigned", v => {
    const n = Number(v);
    return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n}` : v;
  });
  Handlebars.registerHelper("rmumrJson", v => JSON.stringify(v ?? {}, null, 2));
  Handlebars.registerHelper("rmumrPpRealmMod", count => RitualCalculator.ppRealmModifier(Number(count) || 1));

  Handlebars.registerHelper("rmumrParamMod", (kind, value) => {
    const n = Number(value) || 0;
    switch (kind) {
      case "weight": return -10 * n;
      case "critical": return -30 * n;
      case "concussion": return Math.max(0, n - 1) * -10;
      case "areaIncrease": return -20 * n;
      case "range": return -15 * n;
      case "duration": return -20 * n;
      case "areaDecrease": return value ? -10 : 0;
      case "noDuration": return value ? -50 : 0;
      case "concentrationToRounds": return value ? -20 : 0;
      case "removeConcentration": return value ? -25 : 0;
      default: return 0;
    }
  });

  setting("showSheetButton", {
    name: "RMUMR.Settings.ShowSheetButton.Name",
    hint: "RMUMR.Settings.ShowSheetButton.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  setting("gmOnlyButton", {
    name: "RMUMR.Settings.GMOnlyButton.Name",
    hint: "RMUMR.Settings.GMOnlyButton.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  setting("buttonLabel", {
    name: "RMUMR.Settings.ButtonLabel.Name",
    scope: "world", config: true, type: String, default: "Magical Ritual"
  });
  setting("buttonIcon", {
    name: "RMUMR.Settings.ButtonIcon.Name",
    scope: "world", config: true, type: String, default: "fas fa-hat-wizard"
  });

  setting("proportionalItemBonus", { name: "RMUMR.Settings.ProportionalItemBonus.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("requireKnownSpellList", { name: "RMUMR.Settings.RequireKnownSpellList.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("requireRitualBook", { name: "RMUMR.Settings.RequireRitualBook.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("requireRitualScroll", { name: "RMUMR.Settings.RequireRitualScroll.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("autoDeductPP", { name: "RMUMR.Settings.AutoDeductPP.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("autoApplyBloodDamage", { name: "RMUMR.Settings.AutoApplyBloodDamage.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("useNativeRMUPaths", { name: "RMUMR.Settings.UseNativeRMUPaths.Name", scope: "world", config: true, type: Boolean, default: false });
  setting("preloadSpellCompendiums", {
    name: "RMUMR.Settings.PreloadSpellCompendiums.Name",
    hint: "RMUMR.Settings.PreloadSpellCompendiums.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  for (const [key, label] of Object.entries({
    skillPathMapping: "Skill path mapping",
    ppPathMapping: "PP path mapping",
    levelPathMapping: "Level path mapping",
    endurancePathMapping: "Endurance path mapping",
    mentalFocusPathMapping: "Mental Focus path mapping",
    hpPathMapping: "Hit point path mapping"
  })) {
    setting(key, {
      name: label,
      hint: "Comma-separated actor property paths. The first readable path is used.",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });
  }
  registerActorIntegration();
});

Hooks.once("ready", () => {
  RitualResolution.registerChatListeners();

  game.rmuMagicalRituals = {
    RitualApp,
    RitualCalculator,
    RitualStorage,
    open: actor => {
      const app = new RitualApp(actor);
      foundry.utils.debounce(() => app.render({ force: true }), 1)();
      return app;
    },
    openForSelectedToken: () => {
      const token = canvas.tokens?.controlled?.[0] ?? canvas.tokens?.ownedTokens?.[0];
      if (!token?.actor) return ui.notifications.warn(game.i18n.localize("RMUMR.SelectToken"));
      const app = new RitualApp(token);
      foundry.utils.debounce(() => app.render({ force: true }), 1)();
      return app;
    },
    createTemplate: actor => RitualCalculator.defaultData(actor),
    importTemplate: json => RitualStorage.importTemplate(json),
    exportTemplate: data => RitualStorage.exportTemplate(data),
    preloadSpellCompendiums: options => RitualActorAdapter.preloadSpellCompendiums(options),
    refreshSpellCompendiumCache: () => RitualActorAdapter.preloadSpellCompendiums({ force: true }),
    getSpellCompendiumCacheStats: () => RitualActorAdapter.getSpellCompendiumCacheStats()
  };

  if (game.settings.get(MODULE_ID, "preloadSpellCompendiums")) {
    RitualActorAdapter.preloadSpellCompendiums().catch(err => {
      console.warn(`${MODULE_ID} | Spell compendium preload failed`, err);
    });
  }

  console.log(`${MODULE_ID} | Ready`);
});
