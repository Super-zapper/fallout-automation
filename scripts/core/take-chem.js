// ==========================================================
// Малое действие «принять химию» (Take Chem): без проверки, эффект сразу.
// По правилам стимулятор моментально восстанавливает 4 ОЗ или лечит одну травму (выбор игрока), умирающего
// стабилизирует. Остальная химия работает без хитростей: мазь даёт ОЗ (только стабильной цели),
// антирадин снимает радиацию. Ремонтный набор для роботов работает как стимулятор.
//
// Запуск:
//  - кнопка «Принять химию» в Argon HUD и кнопка потребления на листе персонажа: вызывают actor.consumeItem,
//    мы подменяем его для нашей химии (для остальных предметов остаётся системное поведение);
//  - макрос из компендиума модуля или window.falloutTakeChem({ item, actor, targetToken }).
// Цель: сам персонаж или выбранный (target) токен рядом вплотную; если вариантов несколько, спрашиваем.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc } from "../utils/html.js";
import {
    aidDialog, heading, postChat, hasNamed, isMachine, isAdjacent, apTypeOf, itemQty,
    availableChems, chemFromItem, resolveChemBasic, chemResultLines
} from "./aid-shared.js";

/** Краткое описание эффекта химии для списка выбора. */
function chemSummary(chem) {
    const bits = [];
    if (chem.stats.hp > 0) bits.push(t("firstAid.medicine.effHp", { count: chem.stats.hp }));
    if (chem.stats.injuries > 0) bits.push(t("firstAid.medicine.effInjury"));
    if (chem.stats.rads > 0) bits.push(t("firstAid.medicine.effRads", { count: chem.stats.rads }));
    if (chem.stats.stabilize) bits.push(t("firstAid.medicine.effStab"));
    return t("firstAid.medicine.medOption", { name: chem.name, qty: chem.qty, effects: bits.join(" | ") });
}

/** Выбор из списка в маленьком окне: вернёт индекс или null. */
function chooseFromList({ title, header, text, labels, applyLabel }) {
    return new Promise(resolve => {
        let answered = false;
        const answer = value => { if (!answered) { answered = true; resolve(value); } };
        aidDialog({
            title,
            width: 450,
            body: `
                ${heading(header)}
                <p class="fa-center">${esc(text)}</p>
                <select id="fa-list">${labels.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join("")}</select>`,
            buttons: {
                apply: { label: applyLabel, callback: html => answer(parseInt(html.find("#fa-list").val())) },
                cancel: { label: t("firstAid.cancel"), callback: () => answer(null) }
            },
            close: () => answer(null)
        });
    });
}

/**
 * Принять химию. actor: кто принимает; item: предмет (иначе спрашиваем); targetToken: на кого (иначе на себя
 * или на выбранный рядом токен).
 */
export async function startTakeChem(actor, { item = null, targetToken = null } = {}) {
    const warn = text => { ui.notifications.warn(text); return null; };
    actor ??= canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!actor) return warn(t("firstAid.noActor"));

    // --- Химия ---
    let chem = chemFromItem(item);
    if (!chem) {
        const chems = availableChems(actor);
        if (!chems.length) return warn(t("firstAid.chem.noChem"));
        const index = await chooseFromList({
            title: t("firstAid.chem.pickTitle"), header: t("firstAid.chem.pickHeader"), text: t("firstAid.chem.pickText"),
            labels: chems.map(chemSummary), applyLabel: t("firstAid.continue")
        });
        if (index === null) return null;
        chem = chems[index];
    }
    if (itemQty(chem.item) <= 0) return warn(t("firstAid.chem.noneLeft", { name: chem.name }));

    // --- Цель: сам или выбранный токен рядом ---
    const selfToken = actor.getActiveTokens()[0] ?? null;
    const picked = targetToken ? [targetToken] : Array.from(game.user.targets);
    const candidates = [];
    if (!hasNamed(actor, "dead")) candidates.push({ actor, token: selfToken, self: true });
    for (const tk of picked) {
        if (!tk.actor || tk.actor.id === actor.id) continue;
        if (selfToken && !isAdjacent(selfToken, tk)) { warn(t("firstAid.chem.tooFar", { name: tk.name })); continue; }
        candidates.push({ actor: tk.actor, token: tk, self: false });
    }

    // Препараты только живым, ремонтный набор только машинам; мёртвым химия не нужна
    const valid = candidates.filter(c => !hasNamed(c.actor, "dead") && (chem.kind === "kit") === isMachine(c.actor));
    if (!valid.length) return warn(t(chem.kind === "kit" ? "firstAid.chem.wrongKit" : "firstAid.chem.wrongMed"));

    let choice = valid[0];
    if (valid.length > 1) {
        const index = await chooseFromList({
            title: t("firstAid.chem.targetTitle"), header: t("firstAid.chem.targetHeader", { name: chem.name }),
            text: t("firstAid.chem.targetText"), applyLabel: t("firstAid.continue"),
            labels: valid.map(c => c.self ? t("firstAid.chem.targetSelf", { name: c.actor.name }) : c.actor.name)
        });
        if (index === null) return null;
        choice = valid[index];
    }

    // --- Эффект сразу ---
    const ctx = { mode: chem.kind === "kit" ? "repair" : "medicine", actor, target: choice.actor, chem, stimMode: "hp", apType: apTypeOf(actor) };
    // Закрытие окна выбора это отмена: химия не тратится
    const res = await resolveChemBasic(ctx, {
        title: "firstAid.chem.choiceTitle", header: "firstAid.chem.choiceHeader", text: "firstAid.chem.choiceText"
    }, { cancelable: true });
    if (!res) return null;

    await postChat(ctx, {
        header: t("firstAid.chem.chatHeader"),
        title: choice.self
            ? t("firstAid.chem.chatSelf", { actor: actor.name, item: chem.name })
            : t("firstAid.chem.chatOther", { actor: actor.name, item: chem.name, target: choice.actor.name }),
        lines: chemResultLines(ctx, res, false)
    });
    return null;
}

export function register() {
    window.falloutTakeChem = (opts = {}) => startTakeChem(opts.actor, opts);

    // Кнопка химии в Argon HUD и кнопка потребления на листе вызывают actor.consumeItem(item).
    // Для нашей химии подменяем его малым действием «принять химию», остальное остаётся системным.
    const patch = () => {
        const proto = CONFIG.Actor.documentClass?.prototype;
        if (!proto?.consumeItem || proto._faChemPatched) return;

        const original = proto.consumeItem;
        proto.consumeItem = async function (item) {
            if (this.type === "character" && chemFromItem(item) && itemQty(item) > 0) {
                await startTakeChem(this, { item });
                return false;   // предмет уже израсходован нашим процессом
            }
            return original.apply(this, arguments);
        };
        proto._faChemPatched = true;
    };

    if (game.ready) patch();
    else Hooks.once("ready", patch);
}
