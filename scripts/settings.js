// Настройки модуля: каждый блок можно выключить отдельно,
// для эффектов можно указать свои иконки.
import { EFFECT_KEYS } from "./core/effects.js";

import { MODULE_ID } from "./constants.js";
export { MODULE_ID };

export function registerSettings(blocks) {
    for (const b of blocks) {
        if (b.core) continue; // ядро (библиотека, сокеты) не отключается
        game.settings.register(MODULE_ID, `enable.${b.id}`, {
            name: `FALLOUT_AUTO.settings.blocks.${b.id}.name`,
            hint: `FALLOUT_AUTO.settings.blocks.${b.id}.hint`,
            scope: "world",
            config: true,
            type: Boolean,
            default: true,
            requiresReload: true,
        });
    }

    game.settings.register(MODULE_ID, "ceRegister", {
        name: "FALLOUT_AUTO.settings.ceRegister.name",
        hint: "FALLOUT_AUTO.settings.ceRegister.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    // Какие эффекты модуль уже добавил в CE (служебная настройка, в интерфейсе не показывается)
    game.settings.register(MODULE_ID, "ceRegistered", {
        scope: "world",
        config: false,
        type: Array,
        default: [],
    });

    for (const key of EFFECT_KEYS) {
        game.settings.register(MODULE_ID, `icon.${key}`, {
            name: `FALLOUT_AUTO.settings.icon.${key}.name`,
            hint: "FALLOUT_AUTO.settings.icon.hint",
            scope: "world",
            config: true,
            type: String,
            default: "",
            filePicker: "image",
        });
    }
}

export function isEnabled(block) {
    return block.core || game.settings.get(MODULE_ID, `enable.${block.id}`);
}
