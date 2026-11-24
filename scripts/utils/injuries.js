// ==========================================================
// Травмы по зонам тела: чтение и лечение. Раны хранятся по-разному:
//  - персонажи и роботы: только массив system.body_parts.<зона>.injuries (0 нет, 1 залечена, 2 открыта);
//    счётчики injuryOpenCount и injuryTreatedCount у них не учитываются (бывают неверными);
//  - NPC и существа (creature): только числа injuryOpenCount и injuryTreatedCount;
//  - техника: лист меняет счётчики, а движок урона пишет и массив, поэтому берётся большее из двух.
// ==========================================================

const ARRAY_ONLY_TYPES = ["character", "robot"];
const countOf = (list, value) => list.filter(v => v === value).length;

/** Сколько открытых и залеченных травм в зоне. */
export function partInjuries(actor, partData) {
    const list = Array.isArray(partData?.injuries) ? partData.injuries : [];
    const fromList = { open: countOf(list, 2), treated: countOf(list, 1) };
    if (ARRAY_ONLY_TYPES.includes(actor?.type)) return fromList;
    return {
        open: Math.max(fromList.open, Math.max(0, Number(partData?.injuryOpenCount) || 0)),
        treated: Math.max(fromList.treated, Math.max(0, Number(partData?.injuryTreatedCount) || 0))
    };
}

/** Подпись зоны тела: из данных зоны, из библиотеки модуля (по типу тела), из локализации системы, иначе ключ. */
export function partLabel(actor, key, partData) {
    if (partData?.label) return partData.label;
    const library = window.FALLOUT_CUSTOM_LIBRARY;
    const byType = library?.getPartLabel?.(actor, key);
    if (byType && byType !== key) return byType;
    if (library?.BODY_LABELS?.[key]) return library.BODY_LABELS[key];
    const locKey = `FALLOUT.BODYLOCATION.${actor?.type === "robot" ? "robot" : "character"}.${key}`;
    return game.i18n.has(locKey) ? game.i18n.localize(locKey) : key;
}

/** Все зоны, где есть хотя бы одна открытая травма: [{ key, label, open }]. */
export function openInjuryParts(actor) {
    const parts = actor?.system?.body_parts || {};
    return Object.entries(parts)
        .filter(([, data]) => data && typeof data === "object")
        .map(([key, data]) => ({ key, label: partLabel(actor, key, data), open: partInjuries(actor, data).open }))
        .filter(p => p.open > 0);
}

/** Общее число открытых травм у актёра. */
export function totalOpenInjuries(actor) {
    return openInjuryParts(actor).reduce((sum, p) => sum + p.open, 0);
}

/**
 * Данные для actor.update, которые переводят по одной открытой травме в каждой из перечисленных зон
 * в «залечена» (ключ можно повторять, если в зоне несколько травм). Все правки собираются в один update.
 * Возвращает { update, treated: [ключи зон] } или null, если лечить нечего.
 */
export function treatInjuriesUpdate(actor, keys) {
    const work = new Map();
    const treated = [];

    for (const key of keys) {
        const data = actor?.system?.body_parts?.[key];
        if (!data) continue;
        if (!work.has(key)) {
            const counts = partInjuries(actor, data);
            work.set(key, {
                list: Array.isArray(data.injuries) ? [...data.injuries] : null,
                open: counts.open, treated: counts.treated
            });
        }
        const state = work.get(key);
        if (state.open < 1) continue;

        if (state.list) {
            const index = state.list.indexOf(2);
            if (index !== -1) state.list[index] = 1;
        }
        state.open -= 1;
        state.treated += 1;
        treated.push(key);
    }

    if (!treated.length) return null;

    const update = {};
    for (const [key, state] of work) {
        const path = `system.body_parts.${key}`;
        if (state.list) update[`${path}.injuries`] = state.list;
        update[`${path}.injuryOpenCount`] = state.open;
        update[`${path}.injuryTreatedCount`] = state.treated;
        update[`${path}.status`] = state.open > 0 ? "crippled" : (state.treated > 0 ? "wounded" : "healthy");
    }
    return { update, treated };
}
