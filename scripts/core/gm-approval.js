// ==========================================================
// Окно решения ГМа (принять / принудительный успех / провал / отмена) в чате
// Перенесено из world-скрипта «36_GM_LISTENER». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { onChatRender } from "../utils/hooks.js";
import { t } from "../utils/i18n.js";

export function register() {
    // ==========================================================
    // 2. GLOBAL GM LISTENER (Выпадающий список с фиксом цветов)
    // ==========================================================
    onChatRender((message, html, data) => {
        if (!game.user.isGM) return;
        const approvalData = message.getFlag("world", "fallout-approval-request");
        if (!approvalData || approvalData.status !== "pending") return;

        if (html.find(".gm-approval-actions").length > 0) return;

        // Генерируем HTML с Select'ом (Изменил цвета на светлый фон + черный текст)
        const btnHtml = `
        <div class="gm-approval-actions" style="display:flex; flex-direction:column; gap:5px; margin-top:10px; border-top:1px solid #555; padding-top:10px;">
            <select class="gm-override-select" style="width: 100%; padding: 4px; background: #e9e9e9; color: #000; border: 1px solid #777; border-radius: 3px;">
                <option value="none" selected>${t("gmApproval.accept")}</option>
                <option value="success">${t("gmApproval.forceSuccess")}</option>
                <option value="fail">${t("gmApproval.forceFail")}</option>
                <option value="cancel">${t("gmApproval.cancel")}</option>
            </select>
            <button class="apply-roll" style="background:#444; color:white; border:1px solid #777; transition: 0.2s; border-radius: 3px;"><i class="fas fa-check-circle"></i> ${t("gmApproval.apply")}</button>
        </div>`;

        html.find(".message-content").append(btnHtml);

        // Обработчик кнопки "Применить"
        html.find(".apply-roll").click(async (ev) => {
            ev.currentTarget.disabled = true; 
        
            const selectValue = html.find(".gm-override-select").val();

            if (selectValue === "cancel") {
                await message.setFlag("world", "fallout-approval-request", { ...approvalData, status: "rejected" });
                ui.notifications.warn(t("gmApproval.cancelled"));
            } else {
                await message.setFlag("world", "fallout-approval-request", { 
                    ...approvalData, 
                    status: "approved",
                    override: selectValue 
                });
                ui.notifications.info(t("gmApproval.sent"));
            }
        });
    });
}
