// ==========================================================
// Продолжительный урон: в конце хода бросает урон от эффекта «Продолжительный».
// Перенесено из world-скрипта «41_Persistent_auto_damage». Эффект теперь ищется
// через effects.js, а не по русскому имени.
// ==========================================================
import { findEffects } from "./effects.js";
import { t } from "../utils/i18n.js";

export function register() {
    Hooks.on("preUpdateCombat", async (combat, update, options, userId) => {
        // 1. Только для ГМа и только если меняется ход/раунд
        if (!game.user.isGM) return;
        if (!("turn" in update || "round" in update)) return;

        // Защита от перемотки назад (если в обновлении номер хода меньше текущего)
        if (update.turn < combat.turn && !update.round) return;

        // 2. В preUpdateCombat "combat.combatant" — это тот, кто СЕЙЧАС заканчивает ход
        const actor = combat.combatant?.actor;
        const token = combat.combatant?.token;
        if (!actor || !token) return;

        // 3. Ищем эффекты
        const persistentEffects = findEffects(actor, "persistent");
        if (persistentEffects.length === 0) return;

        for (const effect of persistentEffects) {
            const weaponData = effect.getFlag("fallout", "persistentWeapon");
            if (!weaponData) continue;

            // --- ЗАЩИТА ОТ ПОВТОРОВ ---
            const currentRound = combat.round;
            const lastRoundTriggered = effect.getFlag("fallout", "lastRoundTriggered");
            if (lastRoundTriggered === currentRound) continue;

            // Если эффект удаляется прямо сейчас, Foundry может не дать поставить флаг
            try {
                await effect.setFlag("fallout", "lastRoundTriggered", currentRound);
            } catch (e) {
                console.log("[Fallout] Эффект удаляется, флаг не записан, но урон считаем.");
            }

            // 4. Логика урона (берем из rating)
            const diceCount = weaponData.system?.damage?.rating || 1;
            let totalDamage = 0;
            let totalEffects = 0;
            let diceHtml = "";

            for (let i = 0; i < diceCount; i++) {
                const roll = Math.floor(Math.random() * 6) + 1;
                let dmg = 0; let eff = 0;
                if (roll === 1) dmg = 1;
                else if (roll === 2) dmg = 2;
                else if (roll >= 5) { dmg = 1; eff = 1; }
                totalDamage += dmg;
                totalEffects += eff;
                diceHtml += `<span class="dice-icon d6 face-${roll} ${eff ? 'effect' : ''}">&nbsp;</span>`;
            }

            const vicious = weaponData.system?.damage?.damageEffect?.vicious;
            if (vicious?.value > 0) totalDamage += totalEffects;

            const hitLocation = Math.floor(Math.random() * 20) + 1;

            // 5. Флаги для Damage Engine
            const fakeFlags = {
                falloutroll: { damage: totalDamage, effects: totalEffects, diceFace: "d6", rollname: effect.name },
                rollengine: { isDamage: true, hitLocation: hitLocation, targets: [{ name: token.name, uuid: token.uuid }] },
                weapon: weaponData
            };

            // 6. Визуал чата
            const dmgTypes = weaponData.system?.damage?.damageType || {};
            let typesHtml = "";
            for (const [type, active] of Object.entries(dmgTypes)) {
                if (active) typesHtml += `<i class="fo-${type}" title="${type}"></i> `;
            }

            const contentHtml = `
            <div class="fallout-chat-message">
                <div class="content">
                    <h2>🔥 ${effect.name}</h2>
                    <div class="damage-plaq flexrow">
                        <p class="flexlarge" style="margin:0;">
                            ${t("persistentDamage.summary", { damage: totalDamage, effects: totalEffects })}
                        </p>
                        <div style="text-align:end">${typesHtml}</div>
                    </div>
                    <div class="dices-result" style="display:flex; flex-wrap:wrap; margin-top: 5px;">
                        ${diceHtml}
                    </div>
                </div>
            </div>`;

            await ChatMessage.create({
                content: contentHtml,
                flags: fakeFlags,
                speaker: ChatMessage.getSpeaker({ token: token })
            });
        }
    });
}
