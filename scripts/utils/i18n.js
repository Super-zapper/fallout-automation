// Короткая обёртка над game.i18n. Все строки модуля лежат в lang/*.json
// под ключом FALLOUT_AUTO.*, а здесь пишем ключ без этого префикса.
//   t("rollEngine.noTargets")
//   t("skillCheck.rollName", { skill: "Medicine", attr: "INT" })
import { MODULE_ID } from "../constants.js";

export const ROOT = "FALLOUT_AUTO";

export function t(key, data) {
    const full = `${ROOT}.${key}`;
    return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function hasKey(key) {
    return game.i18n.has(`${ROOT}.${key}`);
}

const flatten = (obj, prefix = "") => Object.entries(obj).reduce((acc, [k, v]) =>
    (v && typeof v === "object") ? Object.assign(acc, flatten(v, `${prefix}${k}.`)) : (acc[`${prefix}${k}`] = v, acc), {});

/**
 * Загружает ВСЕ языковые файлы модуля (а не только текущий язык) в виде плоских словарей
 * { "effects.stun.name": "Оглушение", ... }. Нужно, чтобы узнавать тексты по умолчанию на любом языке.
 */
export async function loadShippedTranslations() {
    let paths = [...(game.modules.get(MODULE_ID)?.languages ?? [])].map(l => l.path).filter(Boolean);
    if (!paths.length) paths = ["lang/en.json", "lang/ru.json"];
    const result = [];
    for (const path of paths) {
        try {
            const res = await fetch(path.startsWith("modules/") ? path : `modules/${MODULE_ID}/${path}`);
            if (res.ok) result.push(flatten((await res.json())[ROOT] ?? {}));
        } catch (e) { /* файла нет или недоступен, пропускаем */ }
    }
    return result;
}
