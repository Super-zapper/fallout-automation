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
        <div class="gm-approval-actions fa-term">
            <div class="fa-controls" style="flex-direction: column; align-items: stretch; margin-top: 0;">
                <select class="gm-override-select">
                    <option value="none" selected>${t("gmApproval.accept")}</option>
                    <option value="success">${t("gmApproval.forceSuccess")}</option>
                    <option value="fail">${t("gmApproval.forceFail")}</option>
                    <option value="cancel">${t("gmApproval.cancel")}</option>
                </select>
                <button class="apply-roll fa-btn" style="height: 28px;"><i class="fas fa-check-circle"></i> ${t("gmApproval.apply")}</button>
            </div>
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
