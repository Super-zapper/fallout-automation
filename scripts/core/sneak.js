// ==========================================================
// Скрытная атака: бонус к урону.
// Правило: скрытная атака даёт оружию эффект Жестокий (Vicious), а если он у оружия
// уже есть, то +2 БК (кубика урона) к броску урона.
// Сам флажок «Скрытная атака» ставит Difficulty Engine (flags.world.fallout-sneak на сообщении атаки).
//
// Как работает:
//  1. Окно броска урона (DialogD6): если последняя атака этим оружием была скрытной
//     и у оружия уже есть Жестокий, в поле «Дополнительные кубы» подставляется +2.
//  2. Сообщение урона: если Жестокого у оружия нет, система его не учитывает, поэтому
//     модуль после броска сам прибавляет к урону по 1 за каждый выпавший эффект,
//     дописывает Жестокий в список эффектов и обновляет флаги для Damage Engine.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc, alertBox } from "../utils/html.js";

const FLAG_SNEAK = "fallout-sneak";

/** ID оружия, которым сделана атака (из флага Roll Engine или из разметки карточки). */
function attackItemId(message) {
    return message.flags?.rollengine?.itemId
        ?? message.content?.match(/data-item-id="([^"]+)"/)?.[1]
        ?? null;
}

/** Последняя атака (d20) этим оружием: была ли она скрытной. */
function lastAttackWith(weaponId) {
    if (!weaponId) return null;
    const messages = game.messages.contents;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.flags?.falloutroll?.diceFace !== "d20") continue;
        if (attackItemId(m) !== weaponId) continue;
        return { message: m, sneak: m.getFlag("world", FLAG_SNEAK) === true };
    }
    return null;
}

function isVicious(weapon) {
    return Number(weapon?.system?.damage?.damageEffect?.vicious?.value) > 0;
}

const weaponIdOf = weapon => weapon?._id ?? weapon?.id ?? null;

export function register() {
    // --- 1. Окно броска урона: +2 БК, если оружие уже Жестокое ---
    Hooks.on("renderDialogD6", (app, html) => {
        // Только первичный бросок урона оружием (при добавлении кубов falloutRoll заполнен)
        if (!app.weapon || app.falloutRoll) return;

        const attack = lastAttackWith(weaponIdOf(app.weapon));
        if (!attack?.sneak) return;

        const dialog = html.find(".fallout-dialog");
        if (!dialog.length || dialog.find(".fa-dialog-note").length) return;

        if (isVicious(app.weapon)) {
            const input = html.find(".extra-dice");
            input.val((parseInt(input.val()) || 0) + 2);
            dialog.prepend(`<div class="fa-dialog-note" style="flex: 0 0 100%;">${esc(t("sneak.dialogCd"))}</div>`);
        } else {
            dialog.prepend(`<div class="fa-dialog-note" style="flex: 0 0 100%;">${esc(t("sneak.dialogVicious"))}</div>`);
        }
        app.setPosition({ height: "auto" });
    });

    // --- 2. Сообщение урона: добавляем Жестокий, если его у оружия не было ---
    Hooks.on("createChatMessage", async (message, options, userId) => {
        if (userId !== game.user.id) return;
        if (message.flags?.falloutroll?.diceFace !== "d6") return;

        const weapon = message.flags?.weapon;
        const weaponId = weaponIdOf(weapon);
        if (!weaponId) return;

        const attack = lastAttackWith(weaponId);
        if (!attack?.sneak) return;

        const baseDamage = Number(message.flags.falloutroll.damage) || 0;
        const effects = Number(message.flags.falloutroll.effects) || 0;
        const doc = new DOMParser().parseFromString(message.content || "", "text/html");
        const update = {};

        if (isVicious(weapon)) {
            // Жестокий уже был: +2 БК ушли в бросок через окно, здесь только пометка в карточке
            doc.body.appendChild(noteNode(doc, alertBox(esc(t("sneak.noteCd")))));
        } else {
            const bonus = effects; // Жестокий: +1 к урону за каждый эффект
            const newDamage = baseDamage + bonus;

            // Число урона в плашке («Урон: X | Эффекты: Y»)
            const plaqText = doc.querySelector(".damage-plaq p");
            if (plaqText) plaqText.innerHTML = plaqText.innerHTML.replace(/(:\s*)(\d+)/, `$1<b>${newDamage}</b>`);

            // Жестокий в список эффектов урона
            const list = doc.querySelector("p.hit-location-label");
            if (list) {
                const effectName = game.i18n.localize(CONFIG.FALLOUT?.DAMAGE_EFFECTS?.vicious ?? "vicious");
                const span = doc.createElement("span");
                span.className = "effect hover";
                span.dataset.key = "vicious";
                const tooltip = CONFIG.FALLOUT?.DAMAGE_EFFECT_TOOLTIPS?.vicious;
                if (tooltip) span.dataset.tooltip = tooltip;
                span.textContent = effectName;

                if (list.querySelector("span.effect")) list.appendChild(doc.createTextNode(", "));
                else list.innerHTML = list.innerHTML.replace(/(&mdash;|—)\s*$/, "");   // убираем прочерк «нет эффектов»
                list.appendChild(span);
            }

            doc.body.appendChild(noteNode(doc, alertBox(esc(t("sneak.noteVicious", { bonus })))));

            // Флаги для остальных блоков (Damage Engine читает falloutroll.damage)
            update["flags.falloutroll.damage"] = newDamage;
            update["flags.weapon.system.damage.damageEffect.vicious.value"] = 1;
        }

        update.content = doc.body.innerHTML;
        await message.update(update);
    });
}

/** Оборачивает плашку в терминальную карточку и возвращает DOM-узел. */
function noteNode(doc, innerHtml) {
    const wrap = doc.createElement("div");
    wrap.className = "fa-term";
    wrap.innerHTML = innerHtml;
    return wrap;
}
