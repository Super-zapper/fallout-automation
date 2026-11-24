// ==========================================================
// Первая помощь и ремонт (бывшие мировые скрипты «14_First_aid_button» и «17_Repair_button»).
// Один движок на два режима:
//   medicine: Медицина, цель живое существо; препараты (стимпаки, мази, антирадин), аптечка, перк «Целитель»;
//   repair:   Ремонт, цель машина (робот, техника); ремонтный набор (работает как стимулятор).
// Порядок: проверки (цель, бой, дистанция) -> выбор препарата или набора -> бросок (runFalloutCheck, результат
// подтверждает ГМ, как раньше) -> при успехе меню: восстановить ОЗ / лечить травму / стабилизация.
// При провале с препаратом или набором применяется его базовый эффект (он расходуется в любом случае).
//
// Запуск: кнопки «Первая помощь» в Argon HUD (перехват Dialog2d20.createDialog), макрос из компендиума модуля
// или window.falloutFirstAid({ mode }) без параметров режим выбирается по цели.
// Малое действие «принять химию» без проверки находится в take-chem.js.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc, alertBox, row } from "../utils/html.js";
import { totalOpenInjuries } from "../utils/injuries.js";
import { register as registerTakeChem } from "./take-chem.js";
import { register as registerMacros } from "./macros.js";
import {
    MODES, aidDialog, heading, postChat, pointsDialog, injuryDialog, apTypeOf, setActorData,
    consume, skillValue, isMachine, isAdjacent, getRepairKit, availableMedicines, hasNamed, stabilizeEffects, setNamed,
    healTarget, treatInjuries, injuryLines, aidState, aidMenuFlags, needsWake, resolveChemBasic, chemResultLines
} from "./aid-shared.js";

// ==========================================================
// МЕНЮ ДЕЙСТВИЙ после успешной проверки (общее для медицины и ремонта)
// По правилам стимулятор (и ремонтный набор) применяется в составе первой помощи и вместо 4 ОЗ может залечить
// травму, а само действие тоже лечит либо ОЗ, либо травму. Поэтому выбор «на что пойдёт стимулятор» (ctx.stimMode)
// отделён от кнопок действия: он влияет на оба окна действий и на провал проверки. Умирающую цель стимулятор
// стабилизирует в любом случае.
// ==========================================================

/** Возврат из окна действия в меню (антирадин при этом не откатывается). */
const backToMenu = ctx => () => { ctx.backing = true; showMenu(ctx); };

/** Закрытие окна действия: если действие не применено и это не «Назад», радиация возвращается. */
const onCloseOf = ctx => async () => {
    const backing = ctx.backing;
    ctx.backing = false;
    if (!ctx.applied && !backing) await ctx.rollback?.();
};

const applyLabel = ctx => ctx.mode === "repair" ? t("firstAid.repair.btnApply") : t("firstAid.apply");
const chemBonusLabel = ctx => t(ctx.chem?.kind === "kit" ? "firstAid.repairKitBonus" : "firstAid.medBonus");
const chemUsedLines = ctx => ctx.chem ? [esc(ctx.chem.kind === "kit" ? t("firstAid.chat.kitUsed") : t("firstAid.chat.used", { item: ctx.chem.name }))] : [];
const wakeLinesFor = (s, wakeUp) => needsWake(s) ? [esc(t(wakeUp ? "firstAid.chat.woke" : "firstAid.chat.stayUnconscious"))] : [];
const apLine = spent => spent > 0 ? [esc(t("firstAid.chat.apSpent", { count: spent }))] : [];

/** Антирадин снимает радиацию сразу (один раз за процесс), при отмене возвращается. */
async function prepareChem(ctx) {
    if (ctx.prepared) return;
    ctx.prepared = true;
    ctx.applied = false;

    const rads = ctx.chem?.stats?.rads ?? 0;
    const originalRads = Number(ctx.target.system?.radiation) || 0;
    let radsHealed = 0;
    if (rads > 0) {
        radsHealed = Math.min(originalRads, rads);
        await setActorData(ctx.target, { "system.radiation": originalRads - radsHealed });
        ui.notifications.info(t("firstAid.medicine.radsPreliminary", { count: radsHealed }));
    }
    ctx.rollback = async () => {
        if (radsHealed > 0) {
            await setActorData(ctx.target, { "system.radiation": originalRads });
            ui.notifications.info(t("firstAid.medicine.radsRollback"));
        }
    };
}

async function showMenu(ctx) {
    await prepareChem(ctx);
    const s0 = aidState(ctx);

    const actions = { hp: aidHeal, injury: aidInjury, stabilize: aidStabilize };
    const hasStimChoice = s0.isStim && s0.openInjuries > 0;

    // Если доступно ровно одно действие и выбирать химии не из чего, меню пропускаем
    if (!hasStimChoice) {
        const f = aidMenuFlags(ctx);
        const open = [["hp", f.canHeal], ["injury", f.canInjury], ["stabilize", f.canStabilize]].filter(([, ok]) => ok).map(([k]) => k);
        ctx.menuSkipped = open.length === 1;
        if (ctx.menuSkipped) return actions[open[0]](ctx);
    } else ctx.menuSkipped = false;

    const m = ctx.mode;
    const stimChoice = hasStimChoice ? `
        <div class="fa-box">
            <label>${esc(t(`firstAid.${m}.stimQuestion`, { name: ctx.chem.name }))}</label>
            <label class="fa-check"><input type="radio" name="fa-stim" value="hp"${ctx.stimMode !== "injury" ? " checked" : ""}> ${esc(t(`firstAid.${m}.stimHp`, { count: s0.stats.hp }))}</label>
            <label class="fa-check"><input type="radio" name="fa-stim" value="injury"${ctx.stimMode === "injury" ? " checked" : ""}> ${esc(t(`firstAid.${m}.stimInjury`, { count: Math.min(s0.stats.injuries, s0.openInjuries) }))}</label>
        </div>` : "";

    let transitioning = false;
    const go = key => () => { transitioning = true; actions[key](ctx); };

    aidDialog({
        title: t(`firstAid.${m}.menuTitle`, { name: ctx.target.name }),
        width: 480,
        body: `
            ${heading(t(`firstAid.${m}.menuHeader`))}
            ${m === "repair" ? `<p class="fa-center">${esc(t("firstAid.repair.menuText", { name: ctx.target.name }))}</p>` : ""}
            ${row(esc(t(`firstAid.${m}.menuMed`)), esc(ctx.chem?.name || t("firstAid.none")))}
            ${stimChoice}
            <div id="fa-stim-note"></div>`,
        buttons: {
            hp: { label: t("firstAid.btnHeal"), callback: go("hp") },
            injury: { label: t(`firstAid.${m}.btnInjury`), callback: go("injury") },
            // У транспорта кнопки стабилизации нет совсем
            ...(s0.isVehicle ? {} : { stabilize: { label: t("firstAid.btnStabilize"), callback: go("stabilize") } })
        },
        render: html => {
            const refresh = () => {
                const f = aidMenuFlags(ctx);
                const lock = (sel, off, reason) => html.find(`.dialog-button.${sel}`)
                    .prop("disabled", !!off).attr("title", off ? reason : "");
                lock("hp", !f.canHeal, f.effectiveHp <= 0 ? t("firstAid.reasonAtZero") : t("firstAid.reasonFull"));
                lock("injury", !f.canInjury, t("firstAid.reasonNoInjury"));
                lock("stabilize", !f.canStabilize, t("firstAid.reasonStable"));
                html.find("#fa-stim-note").html(f.s.stimStabilizes ? alertBox(esc(t(`firstAid.${m}.menuStim`)), "warn") : "");
            };
            html.find('input[name="fa-stim"]').on("change", e => { ctx.stimMode = e.currentTarget.value; refresh(); });
            refresh();
        },
        close: async () => { if (!transitioning) await ctx.rollback?.(); }
    });
}

/** Восстановить ОЗ. */
function aidHeal(ctx) {
    const s = aidState(ctx);
    const kitBonus = (s.kit && s.canHealHp) ? 2 : 0;
    const stabBonus = s.stimStabilizes ? 1 : 0;
    const skillVal = skillValue(ctx.actor, ctx.mode);
    const base = skillVal + s.chemHp + kitBonus + s.healer + stabBonus;
    const rate = s.stimHeals ? 2 : 1;

    const rows = [[t(`firstAid.${ctx.mode}.skillRow`), skillVal]];
    if (s.chemHp > 0) rows.push([chemBonusLabel(ctx), s.chemHp]);
    if (kitBonus > 0) rows.push([t("firstAid.kitBonus"), kitBonus]);
    if (s.healer > 0) rows.push([t("firstAid.healerBonus"), s.healer]);
    if (stabBonus > 0) rows.push([t(ctx.chem?.kind === "kit" ? "firstAid.kitStabBonus" : "firstAid.stabBonus"), stabBonus]);

    pointsDialog({
        target: ctx.target,
        title: t(`firstAid.${ctx.mode}.healTitle`, { name: ctx.target.name }),
        header: t("firstAid.healHeader"),
        rows, notes: [],
        base, apRate: rate,
        apLabel: t("firstAid.apLabel", { rate }),
        stimCount: s.stimToInjury ? Math.min(s.stats.injuries, s.openInjuries) : 0,
        hp: s.hp, maxHp: s.maxHp, apType: ctx.apType,
        wake: { show: needsWake(s), allowed: true },
        applyLabel: applyLabel(ctx),
        onBack: ctx.menuSkipped ? null : backToMenu(ctx),
        onClose: onCloseOf(ctx),
        onApply: async ({ spentAP, wakeUp, healAmount, stimParts }) => {
            ctx.applied = true;
            await consume(ctx.chem?.item);
            await healTarget(ctx, healAmount);
            const treated = await treatInjuries(ctx, s.stimToInjury ? stimParts : []);
            if (s.stimStabilizes) await stabilizeEffects(ctx.target, wakeUp);
            else if (wakeUp) await setNamed(ctx.target, "unconscious", false);

            await postChat(ctx, {
                title: t(`firstAid.${ctx.mode}.chatHeal`, { actor: ctx.actor.name, target: ctx.target.name }),
                lines: [...chemUsedLines(ctx), ...injuryLines(treated), ...wakeLinesFor(s, wakeUp), ...apLine(spentAP)],
                alert: t("firstAid.chat.healed", { count: healAmount })
            });
        }
    });
}

/** Стабилизация умирающей цели (без химии-стимулятора: она стабилизирует сама). */
function aidStabilize(ctx) {
    const s = aidState(ctx);
    const kitBonus = s.kit ? 2 : 0;
    const base = 1 + s.chemHp + kitBonus + s.healer;

    const rows = [[t("firstAid.baseStabilize"), 1]];
    if (s.chemHp > 0) rows.push([chemBonusLabel(ctx), s.chemHp]);
    if (kitBonus > 0) rows.push([t("firstAid.kitBonus"), kitBonus]);
    if (s.healer > 0) rows.push([t("firstAid.healerBonus"), s.healer]);

    pointsDialog({
        target: ctx.target,
        title: t(`firstAid.${ctx.mode}.stabTitle`, { name: ctx.target.name }),
        header: t("firstAid.stabHeader"),
        rows, notes: [],
        base, apRate: 1,
        apLabel: t("firstAid.stabApLabel"),
        stimCount: s.stimToInjury ? Math.min(s.stats.injuries, s.openInjuries) : 0,
        hp: s.hp, maxHp: s.maxHp, apType: ctx.apType,
        wake: { show: needsWake(s), allowed: true },
        applyLabel: t("firstAid.btnStabilize"),
        onBack: ctx.menuSkipped ? null : backToMenu(ctx),
        onClose: onCloseOf(ctx),
        onApply: async ({ spentAP, wakeUp, healAmount, stimParts }) => {
            ctx.applied = true;
            await consume(ctx.chem?.item);
            await healTarget(ctx, healAmount);
            const treated = await treatInjuries(ctx, s.stimToInjury ? stimParts : []);
            await stabilizeEffects(ctx.target, wakeUp);

            await postChat(ctx, {
                title: t(`firstAid.${ctx.mode}.chatStabilize`, { actor: ctx.actor.name, target: ctx.target.name }),
                lines: [...chemUsedLines(ctx), ...injuryLines(treated), ...wakeLinesFor(s, wakeUp), ...apLine(spentAP)],
                alert: t("firstAid.chat.stabilized", { count: healAmount }),
                variant: "warn"
            });
        }
    });
}

/** Лечить травму (ремонт повреждения). */
function aidInjury(ctx) {
    const s = aidState(ctx, 1);
    const kitBonus = (s.kit && s.canHealHp) ? 2 : 0;
    const stabBonus = s.stimStabilizes ? 1 : 0;

    // Если цель при смерти и химия не стабилизирует, бонус к ОЗ обнуляется; бонус перка идёт только при наличии лечения
    let bonusHp = s.canHealHp ? (s.chemHp + kitBonus + stabBonus) : 0;
    if (bonusHp > 0) bonusHp += s.healer;

    const notes = [];
    if (stabBonus) notes.push(t("firstAid.noteStab"));
    if (kitBonus > 0) notes.push(t("firstAid.noteKit", { count: kitBonus }));
    if (s.healer > 0 && bonusHp > 0) notes.push(t("firstAid.noteHealer", { count: s.healer }));
    if (ctx.mode === "repair" && s.chemHp > 0) notes.push(t("firstAid.repair.noteKit", { count: bonusHp }));

    // Единственная травма уходит действию: химия, выбранная для травм, лечит ОЗ
    if (ctx.stimMode === "injury" && s.isStim && !s.stimToInjury) notes.push(t("firstAid.noteStimToHp"));

    // Действие лечит одну травму, остальные (если химия лечит травмы) выбираются отдельно
    const stimCount = s.stimToInjury ? Math.min(s.stats.injuries, Math.max(0, s.openInjuries - 1)) : 0;

    injuryDialog({
        target: ctx.target,
        title: t(`firstAid.${ctx.mode}.injuryTitle`, { name: ctx.target.name }),
        header: t(`firstAid.${ctx.mode}.injuryHeader`),
        text: t(`firstAid.${ctx.mode}.injuryText`),
        bonusHp, bonusNotes: notes, stimCount,
        wake: { show: needsWake(s) && (ctx.mode === "medicine" || !!ctx.chem), allowed: true },
        apType: ctx.apType,
        applyLabel: applyLabel(ctx),
        onBack: ctx.menuSkipped ? null : backToMenu(ctx),
        onClose: onCloseOf(ctx),
        onApply: async ({ partKey, stimParts, wakeUp }) => {
            const treated = await treatInjuries(ctx, [partKey, ...(s.stimToInjury ? stimParts : [])]);
            if (!treated.length) return ui.notifications.warn(t("firstAid.noInjurySelected"));

            ctx.applied = true;
            await consume(ctx.chem?.item);
            await healTarget(ctx, bonusHp);
            if (s.stimStabilizes) await stabilizeEffects(ctx.target, wakeUp);
            else if (wakeUp) await setNamed(ctx.target, "unconscious", false);

            await postChat(ctx, {
                title: t(`firstAid.${ctx.mode}.chatInjury`, { actor: ctx.actor.name, target: ctx.target.name }),
                lines: [
                    ...chemUsedLines(ctx),
                    ...(ctx.mode === "repair"
                        ? treated.map(label => esc(t("firstAid.repair.partFixed", { part: label })))
                        : injuryLines(treated)),
                    ...(bonusHp > 0 ? [esc(t("firstAid.chat.hpBonus", { count: bonusHp }))] : []),
                    ...wakeLinesFor(s, wakeUp)
                ]
            });
        }
    });
}

/** Провал проверки, но химия выбрана: она всё равно расходуется, срабатывает её базовый эффект. */
async function aidFailure(ctx) {
    const m = ctx.mode;
    const res = await resolveChemBasic(ctx, {
        title: `firstAid.${m}.failChoiceTitle`, header: `firstAid.${m}.failChoiceHeader`, text: `firstAid.${m}.failChoiceText`
    });
    await postChat(ctx, {
        title: t(`firstAid.${m}.chatFail`, { actor: ctx.actor.name, target: ctx.target.name }),
        lines: chemResultLines(ctx, res, true),
        variant: "danger"
    });
}

// ==========================================================
// ЗАПУСК: проверки, выбор препарата или набора, бросок
// ==========================================================

/** Выбор препарата перед броском: вернёт предмет, null (без препарата) или "CANCEL". */
function pickMedicine(meds) {
    return new Promise(resolve => {
        const options = meds.map((m, i) => {
            const bits = [];
            if (m.stats.hp > 0) bits.push(t("firstAid.medicine.effHp", { count: m.stats.hp }));
            if (m.stats.rads > 0) bits.push(t("firstAid.medicine.effRads", { count: m.stats.rads }));
            if (m.stats.injuries > 0) bits.push(t("firstAid.medicine.effInjury"));
            if (m.stats.stabilize) bits.push(t("firstAid.medicine.effStab"));
            return `<option value="${i}">${esc(t("firstAid.medicine.medOption", { name: m.name, qty: m.qty, effects: bits.join(" | ") }))}</option>`;
        }).join("");

        let answered = false;
        const answer = value => { if (!answered) { answered = true; resolve(value); } };

        aidDialog({
            title: t("firstAid.medicine.pickTitle"),
            width: 450,
            body: `
                ${heading(t("firstAid.medicine.pickHeader"))}
                <p class="fa-center">${esc(t("firstAid.medicine.pickText"))}</p>
                <p class="fa-note fa-center">${esc(t("firstAid.medicine.pickFailNote"))}</p>
                <select id="fa-med"><option value="none">${esc(t("firstAid.medicine.pickNone"))}</option>${options}</select>`,
            buttons: {
                apply: {
                    label: t("firstAid.continue"),
                    callback: html => {
                        const value = html.find("#fa-med").val();
                        answer(value === "none" ? null : meds[parseInt(value)]);
                    }
                },
                cancel: { label: t("firstAid.cancel"), callback: () => answer("CANCEL") }
            },
            close: () => answer("CANCEL")
        });
    });
}

/** Вопрос про ремонтный набор перед броском. */
function askRepairKit(qty) {
    return new Promise(resolve => {
        let answered = false;
        const answer = value => { if (!answered) { answered = true; resolve(value); } };
        aidDialog({
            title: t("firstAid.repair.kitTitle"),
            width: 360,
            body: `${heading(t("firstAid.repair.kitHeader"))}<p class="fa-center">${esc(t("firstAid.repair.kitText", { qty }))}</p>`,
            buttons: {
                yes: { label: t("firstAid.yes"), callback: () => answer(true) },
                no: { label: t("firstAid.no"), callback: () => answer(false) }
            },
            close: () => answer(false)
        });
    });
}

/** Режим по цели: машина это ремонт, остальные медицина. */
function autoMode(targetActor) {
    return isMachine(targetActor) ? "repair" : "medicine";
}

async function startFirstAid(mode, opts = {}) {
    const T = key => t(`firstAid.${mode}.${key}`);
    const warn = text => { ui.notifications.warn(text); return null; };

    const targetToken = opts.targetToken ?? Array.from(game.user.targets)[0];
    if (!targetToken) return warn(T("noTarget"));
    const target = targetToken.actor;

    if (hasNamed(target, "dead")) return warn(T("dead"));

    const actor = opts.actor ?? canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!actor) return warn(t("firstAid.noActor"));
    if (!actor.inCombat) return warn(t("firstAid.notInCombat"));

    const machine = isMachine(target);
    if ((mode === "medicine") === machine) return warn(T("wrongKind"));

    const healerToken = opts.token ?? canvas.tokens.controlled[0] ?? actor.getActiveTokens()[0];
    if (healerToken && !isAdjacent(healerToken, targetToken)) return warn(T("tooFar"));

    const injuries = totalOpenInjuries(target);
    const hp = target.system.health.value, maxHp = target.system.health.max;
    const rad = target.system.radiation || 0;
    const unconscious = hasNamed(target, "unconscious");

    const nothingToDo = mode === "medicine"
        ? (hp >= maxHp && injuries === 0 && rad === 0 && !unconscious)
        : (hp >= maxHp && injuries === 0);
    if (nothingToDo) { ui.notifications.info(t(`firstAid.${mode}.nothingToDo`, { name: target.name })); return null; }

    const diff = MODES[mode].baseDiff + injuries + (actor.id === target.id ? 1 : 0);

    // Что используем в броске
    const ctx = { mode, actor, target, apType: apTypeOf(actor), chem: null, stimMode: "hp" };
    if (mode === "medicine") {
        const meds = availableMedicines(actor);
        if (meds.length > 0) {
            const picked = await pickMedicine(meds);
            if (picked === "CANCEL") return null;
            ctx.chem = picked;
        }
    } else {
        const kit = getRepairKit(actor);
        if (kit && kit.qty > 0 && hp < maxHp && await askRepairKit(kit.qty)) ctx.chem = kit;
    }

    if (!window.runFalloutCheck) return warn(t("firstAid.noCheck"));
    const result = await window.runFalloutCheck({
        actor,
        skillName: MODES[mode].skill,
        attrKey: "int",
        diff,
        successLabel: T("rollSuccess"),
        failLabel: T("rollFail")
    });

    if (result?.success) {
        await showMenu(ctx);
    } else if (result && !result.success) {
        if (ctx.chem) await aidFailure(ctx);
        else ui.notifications.info(T("failedNoItem"));
    }
    return null;
}

// ---------- Регистрация ----------

export function register() {
    registerTakeChem();
    registerMacros();

    window.falloutFirstAid = (opts = {}) => {
        const target = (opts.targetToken ?? Array.from(game.user.targets)[0])?.actor;
        return startFirstAid(opts.mode ?? (target ? autoMode(target) : "medicine"), opts);
    };

    // Кнопки «Первая помощь» в Argon HUD открывают Dialog2d20 с названием броска «First Aid - Medicine» /
    // «First Aid - Repair» (в русской версии худа это «Первая Помощь - Медицина» / «... - Ремонт»).
    // Сравниваем по смыслу, чтобы подходили оба варианта и любые другие переводы с теми же словами.
    const MODE_PATTERNS = {
        medicine: /(first\s*aid|перв\S*\s+помощ\S*).*(medicine|медицин)/i,
        repair:   /(first\s*aid|перв\S*\s+помощ\S*).*(repair|ремонт)/i
    };
    const modeOf = name => {
        if (!name || typeof name !== "string") return null;
        const mode = Object.keys(MODE_PATTERNS).find(m => MODE_PATTERNS[m].test(name)) ?? null;
        // Название похоже на первую помощь, но не распознано: пишем в консоль, чтобы было видно, что пришло от худа
        if (!mode && /first\s*aid|помощ/i.test(name)) console.warn("fallout-automation | Не распознано название броска первой помощи:", name);
        return mode;
    };

    const patch = () => {
        const dialog = window.fallout?.Dialog2d20;
        if (!dialog || dialog._faAidPatched) return;

        const original = dialog.createDialog;
        dialog.createDialog = async function (data) {
            const mode = modeOf(data?.rollName);
            if (mode) {
                await startFirstAid(mode, { actor: data.actor });
                return null;
            }
            return original.apply(this, arguments);
        };
        dialog._faAidPatched = true;
    };

    if (game.ready) patch();
    else Hooks.once("ready", patch);
}
