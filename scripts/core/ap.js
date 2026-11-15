// ==========================================================
// Начисление очков действий (ОД) в трекер системы Fallout.
//
// В системе 11.16.5 трекер переписан на ApplicationV2 и теперь называется
// fallout.APTrackerV2 (старого fallout.APTracker больше нет). Его методы не
// документированы, поэтому порядок такой:
//   1. adjustAP, если он есть (старый API);
//   2. setAP(тип, текущее + добавка), если он есть;
//   3. иначе пишем настройку системы (partyAP / gmAP) напрямую и перерисовываем трекер.
// Менять мировые настройки может только ГМ, поэтому у игрока работа идёт через сокет к ГМу.
// ==========================================================

const AP_TYPES = ["partyAP", "gmAP"];

const trackerClass = () => globalThis.fallout?.APTracker ?? globalThis.fallout?.APTrackerV2 ?? null;

function methodNames(obj) {
    const names = new Set();
    for (let o = obj; o && o !== Function.prototype && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        Object.getOwnPropertyNames(o).forEach(n => { try { if (typeof obj[n] === "function") names.add(n); } catch (e) { /* геттер */ } });
    }
    return [...names];
}

function refreshTrackers(tracker) {
    try {
        for (const app of foundry.applications.instances.values()) {
            if (tracker && app instanceof tracker) app.render();
        }
    } catch (e) { /* трекер не открыт или перерисовка не нужна */ }
}

/** Часть, которая выполняется на стороне ГМа */
export async function addAPAsGM(type, amount) {
    if (!AP_TYPES.includes(type)) throw new Error(`Неизвестный тип ОД: ${type}`);
    const tracker = trackerClass();

    if (typeof tracker?.adjustAP === "function") return tracker.adjustAP(type, amount);

    const current = Number(game.settings.get("fallout", type)) || 0;
    if (typeof tracker?.setAP === "function") return tracker.setAP(type, current + amount);

    console.info(`Fallout Automation | У трекера ОД нет adjustAP/setAP (методы: ${tracker ? methodNames(tracker).join(", ") : "трекер не найден"}), пишу настройку «${type}» напрямую.`);
    await game.settings.set("fallout", type, current + amount);
    refreshTrackers(tracker);
}

/** Добавить ОД: у ГМа напрямую, у игрока через сокет */
export async function addAP(type, amount) {
    if (game.user.isGM) return addAPAsGM(type, amount);
    if (!window.falconSocket) throw new Error("сокет ещё не готов");
    return window.falconSocket.executeAsGM("addAP", type, amount);
}
