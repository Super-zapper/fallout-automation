// ==========================================================
// Эффекты модуля: Оглушение, Продолжительный, Распластанность.
//
// Откуда берутся данные эффекта (по порядку):
//   1. Из Convenient Effects, если там уже есть такой эффект
//      (ваши настройки, иконка и описание не трогаются и не перезаписываются).
//   2. Иначе встроенное описание модуля (иконки берутся из системы Fallout).
//
// Модуль узнаёт свои эффекты на актёре по флагу flags.fallout-automation.effect,
// а эффекты, созданные раньше через CE, ещё и по имени.
// ==========================================================
import { MODULE_ID } from "../constants.js";
import { t, hasKey, loadShippedTranslations } from "../utils/i18n.js";

const DEFS = {
    stun:       { defaultIcon: "systems/fallout/assets/icons/conditions/stunned.svg", duration: { rounds: 1 },
                  legacyNames: ["оглушение", "stunned"],           ceNames: ["Оглушение", "Stunned"] },
    persistent: { defaultIcon: "systems/fallout/assets/icons/conditions/burning.svg",
                  legacyNames: ["продолжительный", "persistent"],  ceNames: ["Продолжительный", "Persistent"] },
    prone:      { defaultIcon: "systems/fallout/assets/icons/conditions/prone.svg",
                  legacyNames: ["распластанность", "prone"],       ceNames: ["Распластанность", "Prone"] },
};

export const EFFECT_KEYS = Object.keys(DEFS);

/** Папка, которую CE создаст, если рядом с вашими эффектами положить нечего */
const CE_FOLDER_NAME = "Fallout";

/** Название эффекта на языке интерфейса */
export function effectName(key) {
    return t(`effects.${key}.name`);
}

/** Иконка: своя из настроек модуля или иконка системы Fallout */
export function iconFor(key) {
    let custom = "";
    try { custom = game.settings.get(MODULE_ID, `icon.${key}`); } catch (e) { /* настройка ещё не зарегистрирована */ }
    return custom || DEFS[key].defaultIcon;
}

// ---------- Convenient Effects (только чтение + добавление недостающих) ----------

/**
 * API Convenient Effects. Начиная с CE 8.0 он живёт в game.modules.get("dfreds-convenient-effects").api,
 * а game.dfreds.effectInterface оставлен как устаревший урезанный вариант (его уберут в CE 9.0).
 */
function ceApi() {
    return game.modules.get("dfreds-convenient-effects")?.api ?? game.dfreds?.effectInterface ?? null;
}

/** Ищет эффект в CE по имени (ваше название и стандартные названия). */
function findInCE(key) {
    const api = ceApi();
    if (!api && !game.dfreds?.effects?.all) return null;
    const names = [...new Set([effectName(key), ...DEFS[key].ceNames])];
    for (const name of names) {
        let ce = null;
        try {
            if (api?.findEffect) ce = api.findEffect({ effectName: name });
            if (!ce && api?.findEffectByName) ce = api.findEffectByName(name);
            if (!ce && game.dfreds?.effects?.all) ce = game.dfreds.effects.all.find(e => e.name === name);
        } catch (e) { console.warn(`${MODULE_ID} | CE: ошибка поиска «${name}»`, e); }
        if (ce) return ce;
    }
    return null;
}

// Тексты по умолчанию на всех языках модуля: { names: {stun: Set}, descriptions: {stun: Set} }
let shipped = null;
// пробелы и переводы строк, в том числе рядом с тегами, на сравнение не влияют
const norm = v => String(v ?? "").replace(/\s+/g, " ").replace(/>\s+/g, ">").replace(/\s+</g, "<").trim();

export async function loadShippedTexts() {
    const all = await loadShippedTranslations();
    console.debug(`${MODULE_ID} | Загружены тексты по умолчанию: ${all.length} яз.`);
    shipped = { names: {}, descriptions: {} };
    for (const key of EFFECT_KEYS) {
        shipped.names[key] = new Set(all.map(l => norm(l[`effects.${key}.name`])).filter(Boolean));
        shipped.descriptions[key] = new Set(all.map(l => norm(l[`effects.${key}.description`])).filter(Boolean));
    }
}

/**
 * Эффект в CE мог быть создан модулем на другом языке. Если его имя и описание совпадают с нашими
 * текстами по умолчанию (на любом языке), показываем их на текущем языке. Всё, что вы изменили
 * сами (другое имя, свой текст), остаётся как есть; сам эффект в списке CE не меняется.
 */
function localizeDefaultTexts(data, key) {
    if (!shipped) return data;
    if (shipped.names[key].has(norm(data.name))) data.name = effectName(key);
    if (hasKey(`effects.${key}.description`) && shipped.descriptions[key].has(norm(data.description))) {
        data.description = t(`effects.${key}.description`);
    }
    return data;
}

function dataFromCE(ce, key) {
    const raw = ce.toObject?.() ?? ce.convertToObject?.() ?? JSON.parse(JSON.stringify(ce));
    const data = JSON.parse(JSON.stringify(raw));
    delete data._id;
    delete data._stats;
    data.transfer = false;                       // на актёре это уже не шаблон
    data.flags = data.flags ?? {};
    data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), effect: key };
    return localizeDefaultTexts(data, key);
}

function builtInData(key) {
    const def = DEFS[key];
    const data = {
        name: effectName(key),
        img: iconFor(key),
        type: "base",
        disabled: false,
        transfer: false,
        statuses: [],
        changes: [],
        flags: { [MODULE_ID]: { effect: key } },
    };
    if (def.duration) data.duration = { ...def.duration };
    if (hasKey(`effects.${key}.description`)) data.description = t(`effects.${key}.description`);
    return data;
}

/** Данные для actor.createEmbeddedDocuments("ActiveEffect", [data]) */
export function effectData(key, overrides = {}) {
    if (!DEFS[key]) throw new Error(`${MODULE_ID} | Неизвестный эффект: ${key}`);
    const ce = findInCE(key);
    const base = ce ? dataFromCE(ce, key) : builtInData(key);
    return foundry.utils.mergeObject(base, overrides);
}

/**
 * Добавляет в список CE те эффекты, которых там ещё нет.
 * Существующие эффекты CE не изменяются и не перезаписываются.
 * Это «лучшая попытка»: если у вашей версии CE нет нужного метода, ничего не делаем.
 */
/**
 * Есть ли эффект уже где-то в мире на предмете CE (не на актёре).
 * Нужен и чтобы не создавать дубли, и чтобы проверить, что CE правда создал эффект:
 * при ошибке валидации Foundry молча возвращает пустой результат вместо исключения.
 */
function existsInWorld(key) {
    return !!game.items?.some(item => item.effects?.some(e =>
        matches(e, key) && (e.getFlag?.(MODULE_ID, "effect") === key || e.flags?.["dfreds-convenient-effects"])));
}

/**
 * CE хранит эффекты на служебном предмете («папке»). Система Fallout требует у предмета тип,
 * а CE его не задаёт, поэтому выбираем сами: что-то безобидное вроде «Разное», иначе первый подходящий.
 */
function pickFolderItemType() {
    const types = (game.documentTypes?.Item ?? []).filter(t => t !== "base");
    return types.find(t => /^(misc|miscellaneous|object|loot|gear|junk|other|generic)/i.test(t)) ?? types[0];
}

export async function registerMissingInCE() {
    if (!game.user.isGM) return [];

    // CE поднимается в своём ready-хуке, ждём его до пяти секунд
    for (let i = 0; i < 20 && !ceApi(); i++) await new Promise(r => setTimeout(r, 250));
    const api = ceApi();
    if (!api) return [];

    // Что мы уже добавляли раньше (только для информации: от дублей защищает проверка existsInWorld)
    let done = [];
    try { done = game.settings.get(MODULE_ID, "ceRegistered") ?? []; } catch (e) { /* настройка не зарегистрирована */ }

    const missing = EFFECT_KEYS.filter(k => !findInCE(k) && !existsInWorld(k));
    if (!missing.length) return [];

    const effectsData = missing.map(k => builtInData(k));
    // Кладём рядом с вашими эффектами: в ту же папку CE, где уже лежит один из трёх.
    // Если таких нет (или папка не нашлась), CE создаст новую папку CE_FOLDER_NAME.
    const sibling = EFFECT_KEYS.map(k => findInCE(k)).find(Boolean);
    const existingFolderId = sibling?.parent?.id;
    const newFolderData = { name: CE_FOLDER_NAME, type: pickFolderItemType() };

    try {
        if (typeof api.createNewEffects === "function") {
            // CE 8.x: createNewEffects({ existingFolderId, newFolderData, effectsData })
            await api.createNewEffects({ existingFolderId, newFolderData, effectsData });
        } else if (typeof api.createNewCustomEffectsWith === "function") {
            // CE до 8.0
            await api.createNewCustomEffectsWith({ activeEffects: effectsData });
        } else {
            const methods = new Set();
            for (let o = api; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
                Object.getOwnPropertyNames(o).forEach(n => { try { if (typeof api[n] === "function" && n !== "constructor") methods.add(n); } catch (e) { /* геттер */ } });
            }
            const version = game.modules.get("dfreds-convenient-effects")?.version ?? "?";
            console.warn(`${MODULE_ID} | В этой версии CE (${version}) нет известного метода создания эффектов; эффекты остаются встроенными. Методы CE: ${[...methods].join(", ")}`);
            return [];
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Не удалось добавить эффекты в CE:`, e);
        return [];
    }

    // Проверяем по факту: создался ли эффект (ошибки Foundry при создании предмета не бросают исключение)
    const created = missing.filter(k => existsInWorld(k) || findInCE(k));
    if (!created.length) {
        console.warn(`${MODULE_ID} | CE не создал эффекты (${missing.join(", ")}). Причина, скорее всего, в ошибке выше; тип предмета для папки: «${newFolderData.type}».`);
        return [];
    }
    await game.settings.set(MODULE_ID, "ceRegistered", [...new Set([...done, ...created])]);
    console.info(`${MODULE_ID} | Добавлено в список CE: ${created.join(", ")} (${existingFolderId ? "в папку ваших эффектов" : `в новую папку «${CE_FOLDER_NAME}», тип «${newFolderData.type}»`})`);
    return created;
}

// ---------- Работа с эффектами на актёре ----------

function matches(effect, key) {
    if (effect.getFlag?.(MODULE_ID, "effect") === key) return true;
    const name = String(effect.name ?? effect.label ?? "").toLowerCase();
    const names = [...DEFS[key].legacyNames, effectName(key).toLowerCase()];
    // «Продолжительный 3» тоже считается: имя может заканчиваться длительностью
    return names.some(n => name === n || name.startsWith(n + " "));
}

/** Все эффекты такого вида на актёре */
export function findEffects(actor, key) {
    return actor?.effects?.filter(e => matches(e, key)) ?? [];
}

export function hasEffect(actor, key) {
    return findEffects(actor, key).some(e => !e.disabled);
}

export async function applyEffect(actor, key, overrides = {}) {
    return actor.createEmbeddedDocuments("ActiveEffect", [effectData(key, overrides)]);
}

/** Распластан: статус prone (если система/другой модуль его ставит) или эффект с таким именем */
export function isProne(actor) {
    if (!actor) return false;
    return !!actor.statuses?.has?.("prone") || hasEffect(actor, "prone");
}
