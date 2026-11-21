// ==========================================================
// Универсальная проверка навыка с подтверждением ГМа (window.runFalloutCheck)
// Перенесено из world-скрипта «02_11_Universal_skill_check_engine». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc, row, alertBox } from "../utils/html.js";
import { getSkillModel } from "./skill-selectors.js";

/**
 * Открывает окно проверки навыка для актёра: в одном окне броска выбираются навык, атрибут и
 * сложность. Это обычный бросок без подтверждения ГМом (подтверждение даёт runFalloutCheck ниже).
 * Доступно из макросов как window.openFalloutSkillCheck(actor, { skillName, attrKey, diff }).
 */
async function openSkillCheck(actor, { skillName = "FALLOUT.SKILL.Athletics", attrKey, diff = 1, complication = 20 } = {}) {
    if (!actor) return ui.notifications.warn(t("skillCheck.noActor"));

    const model = getSkillModel(actor);
    if (!model) return ui.notifications.warn(t("skillCheck.noActor"));

    // Навык по умолчанию: заданный (по умолчанию Атлетика), иначе первый из списка
    const engName = skillName.split(".").pop();
    const localizedName = game.i18n.localize(skillName);
    const skill = model.skills.find(s => s.name && (s.name === engName || s.name === localizedName)) ?? model.skills[0];
    const attr = model.attributes.find(a => a.key === (attrKey ?? skill.attr)) ?? model.attributes[0];

    window.tempVehicleDiff = diff;
    window.tempFaSkillCheck = { skillId: skill.id, attrKey: attr.key, actor };
    try {
        await fallout.Dialog2d20.createDialog({
            rollName: t("skillCheck.rollName", { skill: skill.label, attr: attr.label }),
            diceNum: 2,
            attribute: attr.value,
            skill: skill.value,
            tag: skill.tag,
            complication,
            // Существам актёра в окно не передаём, как делал прежний макрос: он нужен только нашим строкам выбора
            ...(actor.type === "creature" ? {} : { actor })
        });
    } finally {
        delete window.tempVehicleDiff;
        delete window.tempFaSkillCheck;
    }
}

// Иконка кнопки «Проверка» (Test) в Argon HUD: ею помечено только сообщение этой кнопки
const HUD_TEST_ICON = "enhancedcombathud-fallout/icons/dice-twenty-faces-twenty.svg";

export function register() {
    window.openFalloutSkillCheck = openSkillCheck;

    // Кнопка «Проверка» в Argon HUD пишет сообщение в чат; по нему открываем наше окно
    Hooks.on("createChatMessage", async (message, options, userId) => {
        if (userId !== game.user.id) return;
        if (!message.content?.includes(HUD_TEST_ICON)) return;

        const actor = ChatMessage.getSpeakerActor(message.speaker) || game.user.character;
        await openSkillCheck(actor);
    });

    // ==========================================================
    // 1. ГЛОБАЛЬНАЯ ФУНКЦИЯ-ДВИЖОК (с перехватом в Blind Roll)
    // ==========================================================
    window.runFalloutCheck = async function({ skillName, diff, attrKey, successLabel, failLabel, actor, complication = 20 }) {
        if (!actor) return ui.notifications.warn(t("skillCheck.noActor"));
        const localizedSkillName = game.i18n.localize(skillName);
        const engSkillName = skillName.split('.').pop(); // Извлечет "Medicine" из "FALLOUT.SKILL.Medicine"

        const skill = actor.items.find(i => 
            i.type === "skill" && 
            (i.name === localizedSkillName || i.name === engSkillName || i.name === skillName)
        );

        const actionId = foundry.utils.randomID();
        window.tempActionId = actionId;
        window.tempVehicleDiff = diff;


        // 1. Ловушка броска
        const rollPromise = new Promise((resolve) => {
            const hookId = Hooks.on("createChatMessage", (message) => {
                const isMyMsg = message.author.id === game.user.id && message.speaker?.actor === actor.id;
                if (!isMyMsg) return;

                if (!message.rolls?.length && !message.flags?.falloutroll) return;

                // Бросок пойман, отключаем хуки
                Hooks.off("createChatMessage", hookId);

                // Ждем чуть-чуть для верности
                setTimeout(() => {
                    const updatedMsg = game.messages.get(message.id);
                    const rollData = updatedMsg?.flags?.falloutroll;
                    const finalDiff = updatedMsg?.getFlag("world", "fallout-difficulty") ?? diff;
                    const successes = rollData?.dicesRolled?.reduce((t, d) => t + (d.success || 0), 0) || 0;
                    const complications = rollData?.dicesRolled?.reduce((t, d) => t + (d.complication || 0), 0) || 0;
                
                    const skillLabel = updatedMsg?.getFlag("world", "fallout-skill-label") ?? localizedSkillName;
                    resolve({ success: successes >= finalDiff, successes, diff: finalDiff, complications, skillLabel });
                }, 500);
            });
        
            // Тайм-аут ожидания броска (если игрок закрыл окно диалога крестиком)
            setTimeout(() => { 
                Hooks.off("createChatMessage", hookId); 
                resolve(null); 
            }, 60000);
        });

        // 2. Запускаем диалог системы
        const defaultAttrKey = skill?.system?.defaultAttribute ?? "int"; 
        const finalAttrValue = attrKey ? actor.system.attributes[attrKey].value : actor.system.attributes[defaultAttrKey].value;
        // === ОПРЕДЕЛЯЕМ КЛЮЧ И ЛОКАЛИЗОВАННОЕ ИМЯ АТРИБУТА ===
        const finalAttrKey = attrKey ?? defaultAttrKey;
        const attrLabel = game.i18n.localize(CONFIG.FALLOUT.ATTRIBUTES[finalAttrKey]);

        // Окно броска покажет строки выбора навыка и атрибута с этими значениями по умолчанию
        window.tempFaSkillCheck = { skillId: skill?.id ?? "", attrKey: finalAttrKey, actor };

        await fallout.Dialog2d20.createDialog({
            rollName: t("skillCheck.rollName", { skill: localizedSkillName, attr: attrLabel }),
            diceNum: 2,
            attribute: finalAttrValue,
            skill: skill?.system?.value ?? 0, // 0 если навыка нет
            tag: skill?.system?.tag ?? false,  // false если навыка нет
            complication: complication, // <-- Добавлено здесь
            actor: actor
        });

        const rollResult = await rollPromise;
        delete window.tempActionId;
        delete window.tempVehicleDiff;
        delete window.tempFaSkillCheck;

        if (!rollResult) return { status: "cancelled" };

        // ==========================================================
        // 3. МАГИЯ ПОДТВЕРЖДЕНИЯ ГМ-ОМ
        // ==========================================================
    
        // Формируем контент для ГМа
        const gmContent = `
            <div class="fa-term">
                <div class="fa-title">${t("skillCheck.requestTitle")}</div>
                ${row(t("skillCheck.player"), esc(game.user.name))}
                ${row(t("skillCheck.skill"), esc(rollResult.skillLabel ?? localizedSkillName))}
                ${row(t("skillCheck.realResult"), `<span style="color: ${rollResult.success ? "var(--fa-bright)" : "var(--fa-danger)"};">${rollResult.success ? t("skillCheck.success") : t("skillCheck.fail")}</span> (${rollResult.successes} vs ${rollResult.diff})`)}
                <div class="fa-note" style="margin-top: 4px;">${t("skillCheck.expected")} ${esc(rollResult.success ? successLabel : failLabel)}</div>
            </div>
        `;

        // Создаем сообщение-виспа ГМу (blind скрывает его от отправителя-игрока)
        const approvalMsg = await ChatMessage.create({
            content: gmContent,
            whisper: ChatMessage.getWhisperRecipients("GM"),
            blind: true, 
            speaker: { alias: t("skillCheck.speaker") },
            flags: {
                "world": {
                    "fallout-approval-request": { status: "pending", actorId: actor.id }
                }
            }
        });

        ui.notifications.info(t("skillCheck.rolled"));

        // 4. Ждем решение Мастера
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                const msg = game.messages.get(approvalMsg.id);
                if (!msg) { clearInterval(checkInterval); resolve({ status: "cancelled" }); return; }
            
                const statusData = msg.getFlag("world", "fallout-approval-request");
            
                if (statusData.status === "approved") {
                    clearInterval(checkInterval);
                
                    // Проверяем, перезаписал ли ГМ результат
                    let finalSuccess = rollResult.success;
                    let overrideText = "";

                    if (statusData.override === "success") {
                        finalSuccess = true;
                        overrideText = ` <i>(${t("skillCheck.forcedSuccess")})</i>`;
                    } else if (statusData.override === "fail") {
                        finalSuccess = false;
                        overrideText = ` <i>(${t("skillCheck.forcedFail")})</i>`;
                    }

                    await msg.update({ content: msg.content + `<div class="fa-term">${alertBox(`${t("skillCheck.done")}${overrideText}`)}</div>` });
                    resolve({ status: "done", success: finalSuccess, successes: rollResult.successes, complications: rollResult.complications });
                } 
                else if (statusData.status === "rejected") {
                    clearInterval(checkInterval);
                    await msg.update({ content: msg.content + `<div class="fa-term">${alertBox(t("skillCheck.rejected"), "danger")}</div>` });
                    resolve({ status: "rejected" });
                }
            }, 500);

            setTimeout(() => {
                clearInterval(checkInterval);
                ui.notifications.error(t("skillCheck.timeout"));
                resolve({ status: "timeout" });
            }, 120000);
        });
    };
}
