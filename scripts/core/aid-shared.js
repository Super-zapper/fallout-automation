// ==========================================================
// Общая часть первой помощи, ремонта и приёма химии (малое действие):
// справочники препаратов, эффекты, состояние цели, окна и сообщения в чат.
// Режимы: medicine (Медицина, живая цель) и repair (Ремонт, машина). Ремонтный набор работает как стимулятор:
// 4 ОЗ или одна травма, автоматическая стабилизация умирающей цели.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc, alertBox, row } from "../utils/html.js";
import { openInjuryParts, totalOpenInjuries, treatInjuriesUpdate, partLabel } from "../utils/injuries.js";
import { addAP } from "./ap.js";
import { mountBodyPicker, PICKER_KEYS } from "./body-picker.js";

// ---------- Настройки режимов и справочники ----------

export const MODES = {
    medicine: { skill: "FALLOUT.SKILL.Medicine", skillNames: ["Medicine", "Медицина"], baseDiff: 0 },
    repair:   { skill: "FALLOUT.SKILL.Repair",   skillNames: ["Repair", "Ремонт"],      baseDiff: 2 }
};

// Препараты: названия предметов в русской и английской версиях. hp: ОЗ, stabilize: стимулятор,
// rads: снимает радиации, injuries: сколько травм стимулятор может залечить вместо ОЗ (по правилам вместо 4 ОЗ
// стимпак лечит травму; для суперстимулятора указано две, поправьте число здесь, если у вас иначе).
export const MEDICINE_DB = [
    { names: ["Стимулятор", "Stimpak"],                          hp: 4, stabilize: true,  rads: 0, injuries: 1 },
    { names: ["Стимулятор (Разбавленный)", "Stimpak (Diluted)"], hp: 2, stabilize: true,  rads: 0, injuries: 1 },
    { names: ["Суперстимулятор", "Super Stimpak"],               hp: 8, stabilize: true,  rads: 0, injuries: 2 },
    { names: ["Целебная Мазь", "Healing Salve"],                 hp: 2, stabilize: false, rads: 0, injuries: 0 },
    { names: ["Антирадин", "RadAway"],                           hp: 0, stabilize: false, rads: 4, injuries: 0 },
    { names: ["Антирадин (Разбавленный)", "RadAway (Diluted)"],  hp: 0, stabilize: false, rads: 2, injuries: 0 }
];

export const REPAIR_KIT_NAMES = ["Ремонтный Набор для Роботов", "Robot Repair Kit", "Ремонтный набор", "Repair Kit"];
export const HEALER_PERK_NAMES = ["Целитель", "Healer"];
export const ROBOT_ORIGINS = ["робот", "роботизированный синт", "robot", "robotic synth"];

// Названия эффектов (в Convenient Effects и на актёре): русские и английские
export const EFFECT_NAMES = {
    dead:        { ru: ["Смерть", "Уничтожен"], en: ["Dead", "Destroyed"] },
    dying:       { ru: ["При Смерти"],          en: ["Dying"] },
    unconscious: { ru: ["Без Сознания"],        en: ["Unconscious"] },
    kit:         { ru: ["Аптечка Первой Помощи"], en: ["First Aid Kit"] }
};

// ---------- Эффекты ----------

/** Названия эффекта, язык интерфейса первым. */
export function effectNames(key) {
    const { ru, en } = EFFECT_NAMES[key];
    return game.i18n.lang === "ru" ? [...ru, ...en] : [...en, ...ru];
}

export const effectName = e => e.name ?? e.label;
export const hasNamed = (actor, key) => actor.effects.some(e => effectNames(key).includes(effectName(e)) && !e.disabled);

/** Накладывает или снимает эффект по ключу (через Convenient Effects, если он есть). */
export async function setNamed(actor, key, shouldHave) {
    const names = effectNames(key);
    const existing = actor.effects.find(e => names.includes(effectName(e)) && !e.disabled);
    const ce = game.dfreds?.effectInterface;

    if (shouldHave && !existing) {
        if (ce) {
            const name = names.find(n => ce.findEffect?.({ effectName: n })) ?? names[0];
            await ce.addEffect({ effectName: name, uuid: actor.uuid });
        } else {
            await actor.createEmbeddedDocuments("ActiveEffect", [{
                name: names[0],
                img: key === "unconscious" ? "icons/svg/unconscious.svg" : "icons/svg/blood.svg"
            }]);
        }
    } else if (!shouldHave && existing) {
        if (ce) await ce.removeEffect({ effectName: effectName(existing), uuid: actor.uuid });
        else await existing.delete();
    }
}

/** Снимает состояние «при смерти» и ставит или снимает «без сознания». */
export async function stabilizeEffects(target, wakeUp) {
    await setNamed(target, "dying", false);
    await setNamed(target, "unconscious", !wakeUp);
}

// ---------- Общие помощники ----------

export const apTypeOf = actor => (!actor?.hasPlayerOwner ? "gmAP" : "partyAP");
export const currentAP = type => game.settings.get("fallout", type) || 0;
export const setActorData = (actor, data) => window.falconSocket.executeAsGM("updateDocument", actor.uuid, data);
export const itemQty = item => Number(item?.system?.quantity) || 0;

/** Потратить ОД (у игрока через сокет к ГМу, как в кнопке начисления ОД). false, если не вышло. */
export async function spendAP(type, cost) {
    if (cost <= 0) return true;
    try {
        await addAP(type, -cost);
        return true;
    } catch (err) {
        console.error("Fallout Automation | Не удалось потратить ОД:", err);
        ui.notifications.error(t("firstAid.apFailed"));
        return false;
    }
}

export async function consume(item) {
    if (!item) return;
    const left = itemQty(item) - 1;
    if (left <= 0) await item.delete();
    else await item.update({ "system.quantity": left });
}

export function skillValue(actor, mode) {
    const skill = actor.items.find(i => i.type === "skill" && MODES[mode].skillNames.includes(i.name));
    return Number(skill?.system?.value) || 0;
}

export function healerBonus(actor) {
    const perk = actor.items.find(i => HEALER_PERK_NAMES.includes(i.name));
    return Number(perk?.system?.rank?.value) || 0;
}

export function isMachine(actor) {
    if (["vehicle", "robot"].includes(actor.type)) return true;
    const origin = String(actor.system?.origin ?? "").trim().toLowerCase();
    return ["creature", "npc"].includes(actor.type) && ROBOT_ORIGINS.includes(origin);
}

/** Токены рядом вплотную (с учётом размера, диагональ считается как 1,5 клетки). */
export function isAdjacent(a, b) {
    const size = canvas.grid.size;
    const box = tk => ({
        x: Math.round(tk.x / size), y: Math.round(tk.y / size),
        w: Math.max(1, Math.round(tk.w / size)), h: Math.max(1, Math.round(tk.h / size))
    });
    const p = box(a), q = box(b);
    const dx = Math.max(0, Math.max(p.x - (q.x + q.w - 1), q.x - (p.x + p.w - 1)));
    const dy = Math.max(0, Math.max(p.y - (q.y + q.h - 1), q.y - (p.y + p.h - 1)));
    const min = Math.min(dx, dy), max = Math.max(dx, dy);
    return Math.floor(min * 1.5) + (max - min) <= 1;
}

// Ремонтный набор: как стимулятор. 4 ОЗ или одна травма, стабилизирует умирающую цель.
const KIT_STATS = { hp: 4, stabilize: true, rads: 0, injuries: 1 };

/** Предмет-химия: препарат или ремонтный набор. { kind: "med"|"kit", name, item, qty, stats } или null. */
export function chemFromItem(item) {
    if (!item) return null;
    const med = MEDICINE_DB.find(e => e.names.includes(item.name));
    if (med) return { kind: "med", name: item.name, item, qty: itemQty(item), stats: med };
    if (REPAIR_KIT_NAMES.includes(item.name)) return { kind: "kit", name: item.name, item, qty: itemQty(item), stats: KIT_STATS };
    return null;
}

export const getRepairKit = actor => chemFromItem(actor.items.find(i => REPAIR_KIT_NAMES.includes(i.name)));

/** Препараты в инвентаре (количество больше нуля). */
export function availableMedicines(actor) {
    return actor.items.map(chemFromItem).filter(c => c && c.kind === "med" && c.qty > 0);
}

/** Вся химия актёра: препараты и ремонтный набор. */
export function availableChems(actor) {
    return actor.items.map(chemFromItem).filter(c => c && c.qty > 0);
}

// ---------- Окна ----------

/** Окно в терминальном стиле: стиль накладывается на всё окно (класс fa-window). */
export function aidDialog({ title, body, buttons, render, close, width = 420 }) {
    let dialog;
    dialog = new Dialog({
        title,
        content: `<div class="fa-term fa-flat">${body}</div>`,
        buttons,
        default: Object.keys(buttons)[0],
        render: html => render?.(html, dialog),
        close
    }, { classes: ["fa-window"], width });
    return dialog.render(true);
}

/** Список зон с открытыми травмами для выпадающего списка. */
export const partOptionsHtml = target => openInjuryParts(target)
    .map(p => `<option value="${esc(p.key)}" data-open="${p.open}">${esc(t("firstAid.partOption", { label: p.label, count: p.open }))}</option>`).join("");

/**
 * Выпадающие списки травм (действие и стимулятор) не должны выбирать одну и ту же травму дважды:
 * в зоне можно выбрать не больше раз, чем в ней открытых травм. Лишние варианты отключаются,
 * а по умолчанию травмы раздаются по разным зонам.
 */
export function syncInjurySelects(html) {
    const selects = html.find("select.fa-injury-select").toArray();
    const used = {};
    for (const sel of selects) {
        const options = [...sel.options];
        const room = opt => Number(opt.dataset.open) - (used[opt.value] || 0);
        if (sel.selectedOptions[0] && room(sel.selectedOptions[0]) < 1) {
            const alt = options.find(o => room(o) >= 1);
            if (alt) sel.value = alt.value;
        }
        used[sel.value] = (used[sel.value] || 0) + 1;
    }
    for (const sel of selects) {
        const others = {};
        for (const other of selects) if (other !== sel) others[other.value] = (others[other.value] || 0) + 1;
        for (const opt of sel.options) opt.disabled = opt.value !== sel.value && (Number(opt.dataset.open) - (others[opt.value] || 0)) < 1;
    }
}

export const bindInjurySelects = html => {
    html.find("select.fa-injury-select").on("change", () => syncInjurySelects(html));
    syncInjurySelects(html);
};

/** Блок выбора травм, которые залечит химия (count выпадающих списков). Место host нужно картинке тела. */
export const stimPartsHtml = (target, count) => count > 0 ? `
    <div class="fa-box">
        <label>${esc(t("firstAid.stimInjuryLabel", { count }))}</label>
        ${Array.from({ length: count }, (_, i) => `<select class="fa-stim-part fa-injury-select" data-slot="${esc(t("firstAid.slotChem", { n: i + 1 }))}">${partOptionsHtml(target)}</select>`).join("")}
    </div>
    <div class="fa-picker-host"></div>` : "";

export const stimPartsValue = html => html.find(".fa-stim-part").map((i, el) => el.value).get();

export const heading = text => `<div class="fa-title">${esc(text)}</div>`;

/** Блок с кнопками «-» и «+» для траты ОД. */
export function stepperHtml(label) {
    return `
        <div class="fa-box">
            <label>${esc(label)}</label>
            <div class="fa-stepper">
                <button type="button" class="fa-btn" data-step="-1">-</button>
                <input type="number" id="fa-spent-ap" value="0" min="0" readonly>
                <button type="button" class="fa-btn" data-step="1">+</button>
            </div>
            ${row(esc(t("firstAid.apAvailable")), `<span id="fa-ap-pool">...</span>`)}
        </div>`;
}

export const wakeHtml = () => `<label class="fa-check"><input type="checkbox" id="fa-wake"> ${esc(t("firstAid.wakeUp"))}</label>`;

/** Сообщение в чат в терминальном стиле: заголовок по режиму, первая строка это фраза «кто что сделал». */
export function postChat(ctx, { title, lines = [], alert = "", variant = "", header = null }) {
    const rowsHtml = [esc(title), ...lines]
        .map(l => `<div class="fa-row"><span class="fa-v" style="text-align: left;">${l}</span></div>`).join("");
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: ctx.actor }),
        content: `<div class="fa-term">${heading(header ?? t(`firstAid.${ctx.mode}.chatHeader`))}${rowsHtml}${alert ? alertBox(esc(alert), variant) : ""}</div>`
    });
}

/**
 * Пока при выборе травм по картинке назначены не все лечения, кнопка «Применить» отключена
 * (кроме случая, когда травм меньше, чем лечений). isActive: нужна ли проверка сейчас.
 * Вернёт функцию пересчёта (вызывать при смене режима).
 */
export function bindSlotGate(html, isActive = () => true) {
    let state = null;
    const gate = () => {
        const blocked = !!state && isActive() && state.assigned < state.required;
        html.closest(".app").find(".dialog-button.apply")
            .prop("disabled", blocked)
            .attr("title", blocked ? t("firstAid.assignAll") : "");
    };
    html.on("fa:picker", (event, st) => { state = st; gate(); });
    return gate;
}

/** Картинку тела можно показывать для людей (персонаж, NPC): у машин и существ другие части тела. */
export function canUsePicker(target) {
    if (!["character", "npc"].includes(target?.type) || isMachine(target)) return false;
    const parts = target.system?.body_parts ?? {};
    return PICKER_KEYS.every(k => parts[k]);
}

/** Подключает выбор травм по картинке тела; если картинки не загрузились, остаются списки. */
export function attachPicker(html, target, dialog) {
    if (!canUsePicker(target)) return;
    mountBodyPicker({ html, target, dialog }).catch(err => console.warn("fallout-automation | Картинка тела не подключена:", err));
}

// ---------- Окно с тратой ОД (восстановление ОЗ и стабилизация) ----------

/**
 * spec: { title, header, rows: [[подпись, значение]], notes: [текст], base, apRate, apLabel, hp, maxHp,
 *         wake: { show, allowed } | null, stimCount (сколько травм залечит стимулятор), target, applyLabel,
 *         onBack, onApply({ spentAP, wakeUp, healAmount, stimParts }), apType, onClose }
 */
export function pointsDialog(spec) {
    const { base, apRate, hp, maxHp, apType } = spec;
    const rows = spec.rows.map(([label, value]) => row(esc(label), `+${value}`)).join("");
    const notes = spec.notes.map(n => `<p class="fa-note">${esc(n)}</p>`).join("");

    const buttons = {
        apply: {
            label: spec.applyLabel,
            callback: async html => {
                const spentAP = parseInt(html.find("#fa-spent-ap").val()) || 0;
                const wakeUp = !!spec.wake?.show && html.find("#fa-wake").is(":checked");
                const healAmount = base + spentAP * apRate;
                if (!(await spendAP(apType, spentAP + (wakeUp ? 1 : 0)))) return;
                await spec.onApply({ spentAP, wakeUp, healAmount, stimParts: stimPartsValue(html) });
            }
        },
        back: spec.onBack
            ? { label: t("firstAid.back"), callback: () => spec.onBack() }
            : { label: t("firstAid.cancel") }
    };

    let hookId;
    aidDialog({
        title: spec.title,
        width: 400,
        body: `
            ${heading(spec.header)}
            ${rows}${notes}
            ${stimPartsHtml(spec.target, spec.stimCount || 0)}
            ${stepperHtml(spec.apLabel)}
            ${spec.wake?.show ? wakeHtml() : ""}
            <div class="fa-total">${esc(t("firstAid.total"))} <span id="fa-total">0</span></div>
            <div class="fa-slot"><div id="fa-overheal" class="fa-alert fa-warn" style="visibility: hidden;">${esc(t("firstAid.overheal"))}</div></div>`,
        buttons,
        render: (html, dialog) => {
            bindInjurySelects(html);
            bindSlotGate(html);
            attachPicker(html, spec.target, dialog);
            const update = () => {
                const pool = currentAP(apType);
                const wakeBox = html.find("#fa-wake");
                let wakeChecked = wakeBox.is(":checked");

                if (spec.wake?.show) {
                    if (!spec.wake.allowed || (!wakeChecked && pool <= 0)) {
                        wakeBox.prop("disabled", true);
                        if (!spec.wake.allowed) { wakeBox.prop("checked", false); wakeChecked = false; }
                    } else wakeBox.prop("disabled", false);
                }

                const missing = maxHp - (hp + base);
                const maxUseful = Math.max(0, Math.ceil(missing / apRate));
                const limit = Math.max(0, Math.min(pool - (wakeChecked ? 1 : 0), maxUseful));

                const input = html.find("#fa-spent-ap");
                let value = parseInt(input.val()) || 0;
                if (value > limit) { value = limit; input.val(value); }

                html.find("#fa-ap-pool").text(pool);
                html.find("#fa-total").text(base + value * apRate);
                html.find("#fa-overheal").css("visibility", (value >= maxUseful && maxUseful > 0 && missing > 0) ? "visible" : "hidden");
            };

            hookId = Hooks.on("updateSetting", () => update());
            html.find("[data-step]").on("click", e => {
                e.preventDefault();
                const input = html.find("#fa-spent-ap");
                input.val(Math.max(0, (parseInt(input.val()) || 0) + Number(e.currentTarget.dataset.step)));
                update();
            });
            html.find("#fa-wake").on("change", update);
            update();
        },
        close: async () => {
            if (hookId) Hooks.off("updateSetting", hookId);
            await spec.onClose?.();
        }
    });
}

// ---------- Окно лечения травмы ----------

/**
 * spec: { target, title, header, text, bonusHp, bonusNotes: [текст], wake: { show, allowed }, stimCount, apType,
 *         applyLabel, onBack, onApply({ partKey, stimParts, wakeUp }), onClose }
 */
export function injuryDialog(spec) {
    const { apType } = spec;

    const buttons = {
        apply: {
            label: spec.applyLabel,
            callback: async html => {
                const wakeUp = !!spec.wake?.show && html.find("#fa-wake").is(":checked");
                if (!(await spendAP(apType, wakeUp ? 1 : 0))) return;
                await spec.onApply({ partKey: html.find("#fa-injury-part").val(), stimParts: stimPartsValue(html), wakeUp });
            }
        },
        back: spec.onBack
            ? { label: t("firstAid.back"), callback: () => spec.onBack() }
            : { label: t("firstAid.cancel") }
    };

    let hookId;
    aidDialog({
        title: spec.title,
        width: 400,
        body: `
            ${heading(spec.header)}
            <p>${esc(spec.text)}</p>
            <div class="fa-picker-host"></div>
            <select id="fa-injury-part" class="fa-injury-select" data-slot="${esc(t("firstAid.slotAction"))}">${partOptionsHtml(spec.target)}</select>
            ${stimPartsHtml(spec.target, spec.stimCount || 0)}
            ${spec.wake?.show ? wakeHtml() : ""}
            <div class="fa-total">${esc(t("firstAid.hpBonus"))} +${spec.bonusHp}</div>
            ${spec.bonusNotes.map(n => `<p class="fa-note fa-center">${esc(n)}</p>`).join("")}`,
        buttons,
        render: (html, dialog) => {
            bindInjurySelects(html);
            bindSlotGate(html);
            attachPicker(html, spec.target, dialog);
            const update = () => {
                const wakeBox = html.find("#fa-wake");
                if (!spec.wake?.show) return;
                if (!spec.wake.allowed) wakeBox.prop("disabled", true).prop("checked", false);
                else wakeBox.prop("disabled", !wakeBox.is(":checked") && currentAP(apType) <= 0);
            };
            hookId = Hooks.on("updateSetting", () => update());
            html.find("#fa-wake").on("change", update);
            update();
        },
        close: async () => {
            if (hookId) Hooks.off("updateSetting", hookId);
            await spec.onClose?.();
        }
    });
}

// ---------- Контекст и общие действия ----------

/** Восстановить ОЗ цели (не выше максимума). */
export async function healTarget(ctx, amount) {
    if (amount <= 0) return;
    const hp = ctx.target.system.health.value, max = ctx.target.system.health.max;
    await setActorData(ctx.target, { "system.health.value": Math.min(max, hp + amount) });
}

/** Залечить травмы в перечисленных зонах одним обновлением; вернёт подписи залеченных зон. */
export async function treatInjuries(ctx, keys) {
    const result = treatInjuriesUpdate(ctx.target, keys.filter(Boolean));
    if (!result) return [];
    await setActorData(ctx.target, result.update);
    return result.treated.map(key => partLabel(ctx.target, key, ctx.target.system.body_parts[key]));
}

export const injuryLines = labels => labels.map(label => esc(t("firstAid.chat.injuryHealed", { part: label })));

export const wakeLines = wakeUp => wakeUp ? [esc(t("firstAid.chat.woke"))] : [];


// ==========================================================
// Состояние цели и химия
// ==========================================================

/**
 * Что происходит с целью сейчас. ctx: { mode, actor, target, chem, stimMode }.
 * actionTreats: сколько травм займёт само действие (лечение травмы = 1).
 * Стимулятор и ремонтный набор: вместо 4 ОЗ можно залечить травму (stimMode "injury"), а умирающую цель
 * они стабилизируют в любом случае (+1 ОЗ, без «при смерти»).
 */
export function aidState(ctx, actionTreats = 0) {
    const medicine = ctx.mode === "medicine";
    const stats = ctx.chem?.stats ?? { hp: 0, stabilize: false, rads: 0, injuries: 0 };
    const target = ctx.target;
    const hp = Number(target.system?.health?.value) || 0;
    const maxHp = Number(target.system?.health?.max) || (medicine ? 0 : 10);
    const isVehicle = target.type === "vehicle";
    const openInjuries = totalOpenInjuries(target);
    const isStim = stats.stabilize === true;
    // Если единственную травму лечит само действие, химии лечить нечего, и она идёт на ОЗ
    const stimToInjury = isStim && ctx.stimMode === "injury" && (openInjuries - actionTreats) > 0;
    const dying = hp <= 0 && !isVehicle;

    return {
        stats, hp, maxHp, isVehicle, openInjuries, isStim, stimToInjury, dying,
        stimHeals: isStim && !stimToInjury,
        stimStabilizes: isStim && dying,
        chemHp: stimToInjury ? 0 : stats.hp,              // ОЗ от химии
        canHealHp: isVehicle || !dying || isStim,          // ОЗ лечатся только у стабильной цели
        unconscious: !isVehicle && hasNamed(target, "unconscious"),
        kit: medicine && hasNamed(ctx.actor, "kit"),       // эффект «Аптечка первой помощи»
        healer: medicine ? healerBonus(ctx.actor) : 0      // перк «Целитель»
    };
}

/** Показывать ли «Привести в сознание»: только если цель без сознания или умирает (у техники нет). */
export const needsWake = s => !s.isVehicle && (s.dying || s.unconscious);

/** Какие кнопки меню доступны. */
export function aidMenuFlags(ctx) {
    const s = aidState(ctx);
    const effectiveHp = (s.dying && s.isStim) ? 1 : s.hp;
    const isRadAway = s.stats.rads > 0;
    return {
        s, effectiveHp,
        // Техника не бывает «при смерти»: ОЗ восстанавливаются и на нуле, стабилизации нет
        canHeal: s.isVehicle ? s.hp < s.maxHp : (effectiveHp > 0 && (effectiveHp < s.maxHp || s.unconscious || isRadAway)),
        canInjury: s.openInjuries > 0,
        canStabilize: !s.isVehicle && effectiveHp <= 0 && s.maxHp > 0
    };
}

/**
 * Окно выбора для химии, которая может лечить ОЗ или травмы (стимулятор, ремонтный набор).
 * keys: { title, header, text } полные ключи локализации. Вернёт { mode: "hp"|"injury", parts: [зоны] }.
 * cancelable: закрытие окна или «Отмена» возвращают null (ничего не делать); иначе закрытие равно выбору ОЗ.
 */
export function chemChoiceDialog(ctx, s, keys, { cancelable = false } = {}) {
    return new Promise(resolve => {
        const count = Math.min(s.stats.injuries, s.openInjuries);
        let answered = false;
        const answer = value => { if (!answered) { answered = true; resolve(value); } };

        aidDialog({
            title: t(keys.title, { name: ctx.chem.name }),
            width: 440,
            body: `
                ${heading(t(keys.header, { name: ctx.chem.name }))}
                <p>${esc(t(keys.text, { name: ctx.chem.name }))}</p>
                <div class="fa-box">
                    <label class="fa-check"><input type="radio" name="fa-choice" value="hp" checked> ${esc(t(`firstAid.${ctx.mode}.stimHp`, { count: s.stats.hp }))}</label>
                    <label class="fa-check"><input type="radio" name="fa-choice" value="injury"> ${esc(t(`firstAid.${ctx.mode}.stimInjury`, { count }))}</label>
                </div>
                <div id="fa-choice-parts" style="display: none;">${stimPartsHtml(ctx.target, count)}</div>`,
            buttons: {
                apply: {
                    label: t("firstAid.apply"),
                    callback: html => answer(html.find('input[name="fa-choice"]:checked').val() === "injury"
                        ? { mode: "injury", parts: stimPartsValue(html) }
                        : { mode: "hp", parts: [] })
                },
                ...(cancelable ? { cancel: { label: t("firstAid.cancel"), callback: () => answer(null) } } : {})
            },
            render: (html, dialog) => {
                bindInjurySelects(html);
                const gate = bindSlotGate(html, () => html.find('input[name="fa-choice"]:checked').val() === "injury");
                attachPicker(html, ctx.target, dialog);
                html.find('input[name="fa-choice"]').on("change", e => {
                    html.find("#fa-choice-parts").toggle(e.currentTarget.value === "injury");
                    gate();
                    dialog?.setPosition({ height: "auto" });   // окно подстраивается под новое содержимое
                });
            },
            close: () => answer(cancelable ? null : { mode: "hp", parts: [] })
        });
    });
}

/**
 * Базовый эффект химии без проверки (провал первой помощи или малое действие «принять химию»):
 * препарат расходуется, снимает радиацию, лечит ОЗ или травмы (стимулятор: по выбору игрока), стабилизирует умирающего.
 * Вернёт сведения для сообщения в чат, а при отмене выбора (cancelable) null.
 */
export async function resolveChemBasic(ctx, choiceKeys, { cancelable = false } = {}) {
    const target = ctx.target;
    ctx.stimMode = "hp";
    const s = aidState(ctx);
    const currentRads = Number(target.system?.radiation) || 0;

    // Сначала выбор игрока: при отмене (малое действие) препарат не расходуется и ничего не происходит
    let choice = { mode: "hp", parts: [] };
    if (s.isStim && s.openInjuries > 0) {
        choice = await chemChoiceDialog(ctx, s, choiceKeys, { cancelable });
        if (!choice) return null;
    }

    await consume(ctx.chem.item);

    let radsHealed = 0;
    if (s.stats.rads > 0 && currentRads > 0) {
        radsHealed = Math.min(currentRads, s.stats.rads);
        await setActorData(target, { "system.radiation": currentRads - radsHealed });
    }

    let heal = 0, stabilized = false, treated = [];
    if (s.isStim) {
        if (choice.mode === "injury") treated = await treatInjuries(ctx, choice.parts);
        else heal += s.stats.hp;
        // Умирающего стимулятор стабилизирует в любом случае: +1 ОЗ и конец «при смерти» (сознание не возвращается)
        if (s.dying) { heal += 1; stabilized = true; }
    } else if (s.stats.hp > 0 && s.canHealHp) {
        heal += s.stats.hp;
    }
    await healTarget(ctx, heal);
    if (stabilized) await stabilizeEffects(target, false);

    return { s, heal, treated, stabilized, radsHealed, noEffect: s.stats.hp > 0 && !s.isStim && !s.canHealHp };
}

/** Строки сообщения в чат по итогу resolveChemBasic. failure: проверка провалена. */
export function chemResultLines(ctx, res, failure) {
    const kit = ctx.chem.kind === "kit";
    const usedKey = failure ? (kit ? "firstAid.chat.kitUsedFail" : "firstAid.chat.usedFail") : "firstAid.chat.used";
    const lines = [esc(t(usedKey, { item: ctx.chem.name }))];
    if (res.heal > 0) lines.push(esc(t("firstAid.chat.hpBase", { count: res.heal })));
    lines.push(...injuryLines(res.treated));
    if (res.radsHealed > 0) lines.push(esc(t("firstAid.chat.radsRemoved", { count: res.radsHealed })));
    if (res.stabilized) lines.push(esc(t(kit ? "firstAid.chat.stabilizedByKit" : "firstAid.chat.stabilizedByStim")));
    if (res.noEffect) lines.push(esc(t("firstAid.chat.medNoEffect")));
    return lines;
}
