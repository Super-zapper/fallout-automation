// ==========================================================
// Компендиум макросов модуля. Он создаётся в мире при запуске (ГМом), чтобы названия были на языке
// интерфейса, как у эффектов Convenient Effects: готовый компендиум модуля имел бы одно фиксированное имя.
// Если макрос ещё имеет название по умолчанию (на любом из языков), оно обновляется под текущий язык;
// переименованные вами макросы не трогаются. Текст макроса обновляется, когда меняется его версия.
// ==========================================================
import { MODULE_ID } from "../constants.js";
import { t } from "../utils/i18n.js";

const PACK_NAME = "fallout-automation-macros";
const MACRO_VERSION = 1;   // увеличить, когда меняется текст макросов

const MACROS = {
    firstAid: {
        // Названия по умолчанию на всех языках (чтобы узнать, что макрос не переименован)
        defaults: ["First Aid / Repair", "Первая помощь / Ремонт", "First Aid / Первая помощь"],
        command: `// First aid for a living target (Medicine) or repair for a machine (Repair), chosen by the target.
// Target the patient, control the token that gives the help, and run this macro.
if (window.falloutFirstAid) window.falloutFirstAid();
else ui.notifications.warn(game.i18n.localize("FALLOUT_AUTO.macros.disabled"));
`
    },
    takeChem: {
        defaults: ["Take Chem", "Принять химию", "Take Chem / Принять химию"],
        command: `// Take Chem (minor action, no check). Control the token that takes the chem; to use it on someone else,
// target an adjacent token.
if (window.falloutTakeChem) window.falloutTakeChem();
else ui.notifications.warn(game.i18n.localize("FALLOUT_AUTO.macros.disabled"));
`
    }
};

async function ensureMacros() {
    if (!game.user.isGM) return;

    const Collection = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
    let pack = game.packs.get(`world.${PACK_NAME}`);
    if (!pack) {
        pack = await Collection.createCompendium({
            name: PACK_NAME,
            label: t("macros.packLabel"),
            type: "Macro",
            ownership: { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }
        });
    }

    const docs = await pack.getDocuments();
    for (const [key, def] of Object.entries(MACROS)) {
        const name = t(`macros.${key}`);
        const existing = docs.find(d => d.getFlag(MODULE_ID, "macro") === key);

        if (!existing) {
            await pack.documentClass.create({
                name,
                type: "script",
                scope: "global",
                img: "systems/fallout/assets/icons/items/skill.webp",
                command: def.command,
                flags: { [MODULE_ID]: { macro: key, version: MACRO_VERSION } }
            }, { pack: pack.collection });
            continue;
        }

        const update = {};
        if (existing.name !== name && def.defaults.includes(existing.name)) update.name = name;
        if ((existing.getFlag(MODULE_ID, "version") ?? 0) < MACRO_VERSION) {
            update.command = def.command;
            update[`flags.${MODULE_ID}.version`] = MACRO_VERSION;
        }
        if (Object.keys(update).length) await existing.update(update);
    }
}

export function register() {
    const run = () => ensureMacros().catch(err => console.warn(`${MODULE_ID} | Не удалось подготовить макросы:`, err));
    if (game.ready) run();
    else Hooks.once("ready", run);
}
