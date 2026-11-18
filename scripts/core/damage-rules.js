// ==========================================================
// Дополнительные правила урона (бывший мировой макрос «2_Damage_extra_rules» и блок скрытной атаки).
// Всё собрано в одном обработчике сообщения урона, чтобы правки не затирали друг друга:
//
//  1. Скрытная атака. Оружие уже Жестокое: +2 БК в окне броска урона. Иначе оружию добавляется
//     эффект Жестокий (+1 к урону за каждый выпавший эффект).
//  2. Перк «Высшая Лига» (Big Leagues). Двуручное оружие ближнего боя с выпавшими эффектами
//     получает Жестокий, если его у оружия не было.
//  3. Промах взрывом (оружие со свойством Blast). Если атака не набрала нужных успехов:
//     кубы урона делятся пополам, эффекты урона отменяются.
//
// Данные об атаке берутся из последнего сообщения атаки этим же оружием
// (флаги world.fallout-sneak и world.fallout-difficulty, ставит Difficulty Engine).
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc, alertBox } from "../utils/html.js";

const FLAG_SNEAK = "fallout-sneak";
const FLAG_DIFFICULTY = "fallout-difficulty";
const BLAST_WINDOW_MS = 60 * 1000;                       // как в исходном макросе: промах учитывается в течение минуты
const PERK_NAMES = ["высшая лига", "big leagues"]; // название перка в русской и английской версиях

// ---------- Поиск данных об атаке ----------

/** ID оружия, которым сделана атака (из флага Roll Engine или из разметки карточки). */
function attackItemId(message) {
    return message.flags?.rollengine?.itemId
        ?? message.content?.match(/data-item-id="([^"]+)"/)?.[1]
        ?? null;
}

const weaponIdOf = weapon => weapon?._id ?? weapon?.id ?? null;

/** Успешна ли атака: успехи на кубах против сложности из флага. null, если данных нет. */
function attackHit(message) {
    const diff = message.getFlag("world", FLAG_DIFFICULTY);
    const dice = message.flags?.falloutroll?.dicesRolled;
    if (diff === undefined || diff === null || !dice) return null;
    return dice.reduce((total, d) => total + (d.success || 0), 0) >= diff;
}

/**
 * Последняя атака (d20) этим оружием. Для оружия Blast, если по ID не нашлось (у гранаты ID в карточке
 * может отличаться), берётся последний d20 этого же пользователя, как делал исходный макрос.
 * Проходим массив с конца, не разворачивая его: reverse() изменил бы общий кэшированный список сообщений.
 */
function findAttack(weaponId, allowFallback = false) {
    const messages = game.messages.contents;
    let fallback = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.flags?.falloutroll?.diceFace !== "d20") continue;
        if (weaponId && attackItemId(m) === weaponId) return describe(m);
        if (allowFallback && !fallback && m.author?.id === game.user.id) fallback = m;
    }
    return fallback ? describe(fallback) : null;
}

function describe(message) {
    return {
        message,
        sneak: message.getFlag("world", FLAG_SNEAK) === true,
        hit: attackHit(message),
        recent: (Date.now() - message.timestamp) <= BLAST_WINDOW_MS
    };
}

const isVicious = weapon => Number(weapon?.system?.damage?.damageEffect?.vicious?.value) > 0;
const isBlast = weapon => {
    const v = weapon?.system?.damage?.weaponQuality?.blast?.value;
    return v === 1 || v === true || Number(v) > 0;
};

/** Промах взрывом: оружие Blast, атака есть, свежая и не набрала успехов. */
function isBlastMiss(weapon, attack) {
    return isBlast(weapon) && attack?.hit === false && attack.recent;
}

// ---------- Мелкие помощники для вывода ----------

const dialogNote = (text, tip, warn = false) =>
    `<div class="fa-dialog-note${warn ? " fa-warn" : ""}" style="flex: 0 0 100%;" data-tooltip="${esc(tip)}">${esc(text)}</div>`;

/**
 * В окно броска урона система передаёт актёра не документом, а строкой UUID (актёр или токен),
 * в сообщении урона это документ Actor. Приводим всё к актёру.
 */
function resolveActor(ref) {
    if (!ref) return null;
    const doc = typeof ref === "string" ? fromUuidSync(ref) : ref;
    return doc?.actor ?? doc ?? null;
}

function hasMajorLeague(actorRef, weapon) {
    const actor = resolveActor(actorRef);
    if (!actor?.items) return false;
    const melee = weapon?.system?.weaponType === "meleeWeapons";
    const twoHanded = weapon?.system?.damage?.weaponQuality?.two_handed?.value;
    if (!melee || !(twoHanded === 1 || twoHanded === true)) return false;
    return actor.items.some(i => PERK_NAMES.includes(i.name?.trim().toLowerCase()));
}

export function register() {
    // ------------------------------------------------------
    // 1. Окно броска урона
    // ------------------------------------------------------
    Hooks.on("renderDialogD6", (app, html) => {
        // Только первичный бросок урона оружием (при добавлении кубов falloutRoll заполнен)
        if (!app.weapon || app.falloutRoll) return;

        const dialog = html.find(".fallout-dialog");
        if (!dialog.length || dialog.find(".fa-dialog-note").length) return;

        const attack = findAttack(weaponIdOf(app.weapon), isBlast(app.weapon));

        // Промах взрывом: кубы урона пополам
        if (isBlastMiss(app.weapon, attack)) {
            const oldDice = Number(app.diceNum) || 0;
            const newDice = Math.floor(oldDice / 2);
            app.diceNum = newDice;
            // Бросок берёт число кубов из этого поля, а не из app.diceNum
            const input = html.find(".damage-dice");
            input.val(newDice);
            const label = input.closest(".resource").find("label.title-label").first();
            label.html(`${esc(label.text().trim())} <span style="opacity: 0.55;">${oldDice}</span> &rarr; <b style="color: #c62828;">${newDice}</b>`);

            dialog.prepend(dialogNote(t("rules.blastMiss"), t("rules.blastMissTip"), true));
            app.setPosition({ height: "auto" });
            return;
        }

        // Скрытная атака
        if (!attack?.sneak) return;
        // Перк «Высшая Лига» делает двуручное оружие ближнего боя Жестоким, поэтому скрытная атака даёт +2 БК
        if (isVicious(app.weapon) || hasMajorLeague(app.actor, app.weapon)) {
            const input = html.find(".extra-dice");
            input.val((parseInt(input.val()) || 0) + 2);
            dialog.prepend(dialogNote(t("rules.sneakCd"), t("rules.sneakCdTip")));
        } else {
            dialog.prepend(dialogNote(t("rules.sneakVicious"), t("rules.sneakViciousTip")));
        }
        app.setPosition({ height: "auto" });
    });

    // ------------------------------------------------------
    // 2. Сообщение урона: один проход, одно обновление
    // ------------------------------------------------------
    Hooks.on("createChatMessage", async (message, options, userId) => {
        if (userId !== game.user.id) return;
        if (message.flags?.falloutroll?.diceFace !== "d6") return;

        const weapon = message.flags?.weapon;
        const weaponId = weaponIdOf(weapon);
        if (!weaponId) return;

        const attack = findAttack(weaponId, isBlast(weapon));
        const baseDamage = Number(message.flags.falloutroll.damage) || 0;
        const effects = Number(message.flags.falloutroll.effects) || 0;

        const doc = new DOMParser().parseFromString(message.content || "", "text/html");
        const update = {};
        const notes = [];

        const setDamage = value => {
            update["flags.falloutroll.damage"] = value;
            const plaq = doc.querySelector(".damage-plaq p");
            if (plaq) plaq.innerHTML = plaq.innerHTML.replace(/(:\s*)(\d+)/, `$1<b>${value}</b>`);
        };

        if (isBlastMiss(weapon, attack)) {
            // ---- Промах взрывом: эффекты отменяются ----
            if (isVicious(weapon) && effects > 0) setDamage(baseDamage - effects);   // вычитаем бонус Жестокого

            const damageEffects = foundry.utils.getProperty(message, "flags.weapon.system.damage.damageEffect");
            for (const [key, eff] of Object.entries(damageEffects ?? {})) {
                if (eff?.value > 0 || eff?.rank > 0) {
                    update[`flags.weapon.system.damage.damageEffect.${key}.value`] = 0;
                    update[`flags.weapon.system.damage.damageEffect.${key}.rank`] = 0;
                }
            }
            if (effects > 0) update["flags.falloutroll.effects"] = 0;

            // «Урон: X | Эффекты: Y» -> «Урон: X», список эффектов убираем
            const plaq = doc.querySelector(".damage-plaq p");
            if (plaq) plaq.innerHTML = plaq.innerHTML.replace(/\s*\|[\s\S]*$/, "");
            doc.querySelector("p.hit-location-label")?.remove();

            notes.push(alertBox(esc(t("rules.blastMiss")), "danger", "", t("rules.blastMissTip")));
        } else {
            // ---- Скрытная атака и «Высшая Лига» ----
            const alreadyVicious = isVicious(weapon);
            const sneak = attack?.sneak === true;
            // Перк делает оружие Жестоким: если и скрытная атака, то она даёт +2 БК, а не второй Жестокий
            const perk = !alreadyVicious && hasMajorLeague(ChatMessage.getSpeakerActor(message.speaker), weapon);
            const effectivelyVicious = alreadyVicious || perk;
            const addVicious = !alreadyVicious && ((sneak && !perk) || (perk && effects > 0));

            if (addVicious) {
                // Жестокий: +1 к урону за каждый выпавший эффект
                setDamage(baseDamage + effects);
                update["flags.weapon.system.damage.damageEffect.vicious.value"] = 1;

                const list = doc.querySelector("p.hit-location-label");
                if (list) {
                    const span = doc.createElement("span");
                    span.className = "effect hover";
                    span.dataset.key = "vicious";
                    const tooltip = CONFIG.FALLOUT?.DAMAGE_EFFECT_TOOLTIPS?.vicious;
                    if (tooltip) span.dataset.tooltip = tooltip;
                    span.textContent = game.i18n.localize(CONFIG.FALLOUT?.DAMAGE_EFFECTS?.vicious ?? "vicious");

                    if (list.querySelector("span.effect")) list.appendChild(doc.createTextNode(", "));
                    else list.innerHTML = list.innerHTML.replace(/(&mdash;|—)\s*$/, "");   // убираем прочерк «нет эффектов»
                    list.appendChild(span);
                }
            }

            if (sneak) {
                // Оружие уже Жестокое (само или из-за перка): +2 БК ушли в бросок через окно, здесь пометка.
                // Иначе скрытная атака дала Жестокий.
                notes.push(effectivelyVicious
                    ? alertBox(esc(t("rules.sneakCd")), "", "", t("rules.sneakCdTip"))
                    : alertBox(esc(t("rules.sneakNote")), "", "", t("rules.sneakViciousTip")));
            }
            if (perk && addVicious) notes.push(alertBox(esc(t("rules.majorLeague")), "", "", t("rules.majorLeagueTip")));
        }

        if (!notes.length && !Object.keys(update).length) return;

        if (notes.length) {
            const wrap = doc.createElement("div");
            wrap.className = "fa-term";
            wrap.innerHTML = notes.join("");
            doc.body.appendChild(wrap);
        }
        update.content = doc.body.innerHTML;
        await message.update(update);
    });
}
