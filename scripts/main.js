// ==========================================================
// Fallout Automation — точка входа.
// Чтобы добавить новый блок: положите файл в scripts/core/
// с функцией register(), импортируйте его здесь и добавьте
// строку в список BLOCKS. Название и описание блока для
// настроек берутся из lang/*.json (FALLOUT_AUTO.settings.blocks.<id>).
// ==========================================================
import { MODULE_ID, registerSettings, isEnabled } from "./settings.js";
import * as library from "./core/library.js";
import * as distance from "./core/distance.js";
import * as skillCheck from "./core/skill-check.js";
import * as rollEngine from "./core/roll-engine.js";
import * as difficulty from "./core/difficulty.js";
import * as damage from "./core/damage.js";
import * as gmApproval from "./core/gm-approval.js";
import * as persistentDamage from "./core/persistent-damage.js";
import * as sockets from "./core/sockets.js";
import * as effects from "./core/effects.js";

// Порядок важен только для данных: сначала библиотека.
const BLOCKS = [
    { id: "library",          core: true, register: library.register },
    { id: "distance",         core: true, register: distance.register },
    { id: "skillCheck",       register: skillCheck.register },
    { id: "rollEngine",       register: rollEngine.register },
    { id: "difficulty",       register: difficulty.register },
    { id: "damage",           register: damage.register },
    { id: "gmApproval",       register: gmApproval.register },
    { id: "persistentDamage", register: persistentDamage.register },
];

// Если Foundry не подхватил lang/*.json из module.json (так бывает, пока сервер
// не перезапущен после обновления модуля), подгружаем переводы вручную.
Hooks.once("i18nInit", async () => {
    if (game.i18n.has("FALLOUT_AUTO.effects.stun.name")) return;
    console.warn(`${MODULE_ID} | Переводы не подхватились из module.json. Подгружаю вручную; перезапустите сервер Foundry, чтобы так не было.`);
    for (const lang of ["en", game.i18n.lang]) {
        try {
            const res = await fetch(`modules/${MODULE_ID}/lang/${lang}.json`);
            if (res.ok) foundry.utils.mergeObject(game.i18n.translations, await res.json());
        } catch (err) { /* нет такого языка, пропускаем */ }
    }
});

Hooks.once("init", () => {
    registerSettings(BLOCKS);

    const loaded = [];
    for (const block of BLOCKS) {
        if (!isEnabled(block)) continue;
        try {
            block.register();
            loaded.push(block.id);
        } catch (err) {
            // Ошибка в одном блоке не должна ронять остальные
            console.error(`${MODULE_ID} | Блок «${block.id}» не загрузился:`, err);
        }
    }

    game.modules.get(MODULE_ID).api = { blocks: loaded, effects };
    console.log(`${MODULE_ID} | Загружено блоков: ${loaded.join(", ")}`);
});

// socketlib вызывает этот хук сам, регистрировать сокеты нужно именно в нём
Hooks.once("socketlib.ready", () => {
    try { sockets.register(); }
    catch (err) { console.error(`${MODULE_ID} | Сокеты не зарегистрировались:`, err); }
});

// Добавляем в список Convenient Effects эффекты, которых там ещё нет (существующие не трогаем)
Hooks.once("ready", async () => {
    await effects.loadShippedTexts();
    if (game.user.isGM && game.settings.get(MODULE_ID, "ceRegister")) effects.registerMissingInCE();
});
