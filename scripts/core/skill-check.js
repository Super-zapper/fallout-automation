// ==========================================================
// Универсальная проверка навыка с подтверждением ГМа (window.runFalloutCheck)
// Перенесено из world-скрипта «02_11_Universal_skill_check_engine». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { t } from "../utils/i18n.js";

export function register() {
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
                
                    resolve({ success: successes >= finalDiff, successes, diff: finalDiff, complications });
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

        if (!rollResult) return { status: "cancelled" };

        // ==========================================================
        // 3. МАГИЯ ПОДТВЕРЖДЕНИЯ ГМ-ОМ
        // ==========================================================
    
        // Формируем контент для ГМа
        const gmContent = `
            <div style="font-weight:bold; text-align:center; border-bottom:1px solid #444; margin-bottom:5px;">
                ${t("skillCheck.requestTitle")}
            </div>
            <div><b>${t("skillCheck.player")}</b> ${game.user.name}</div>
            <div><b>${t("skillCheck.skill")}</b> ${localizedSkillName}</div>
            <div><b>${t("skillCheck.realResult")}</b> ${rollResult.success ? `<span style='color:green'>${t("skillCheck.success")}</span>` : `<span style='color:red'>${t("skillCheck.fail")}</span>`} (${rollResult.successes} vs ${rollResult.diff})</div>
            <div style="font-size:0.9em; margin-top:5px; font-style:italic; color:#aaa;">
                ${t("skillCheck.expected")} ${rollResult.success ? successLabel : failLabel}
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

                    await msg.update({ content: msg.content + `<br><b style='color:green'>✅ ${t("skillCheck.done")}${overrideText}</b>` });
                    resolve({ status: "done", success: finalSuccess, successes: rollResult.successes, complications: rollResult.complications });
                } 
                else if (statusData.status === "rejected") {
                    clearInterval(checkInterval);
                    await msg.update({ content: msg.content + `<br><b style='color:red'>❌ ${t("skillCheck.rejected")}</b>` });
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
