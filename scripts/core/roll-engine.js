// ==========================================================
// Roll Engine: запоминает цели и зону попадания атаки и передаёт их в бросок урона
// Перенесено из world-скрипта «01_1_ROLL_ENGINE». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { onChatRender } from "../utils/hooks.js";
import { t } from "../utils/i18n.js";
import { esc } from "../utils/html.js";

export function register() {
    // ==========================================
    // ROLL ENGINE: ЯДРО СОХРАНЕНИЯ ДАННЫХ
    // ==========================================
    Hooks.on("createChatMessage", async (message, options, userId) => {
        // Выполняет только тот, кто кидает кубики
        if (userId !== game.user.id) return;

        const fallout = message.flags?.falloutroll;
        if (!fallout) return;

        // 1. ЕСЛИ ЭТО АТАКА (d20)
        if (fallout.diceFace === "d20") {
            const match = message.content.match(/data-item-id="([^"]+)"/);
            const itemId = match ? match[1] : null;
        
            // Собираем цели: берем и имя, и уникальный ID (uuid), чтобы потом применять урон
            const targets = Array.from(game.user.targets).map(t => ({
                name: t.name,
                uuid: t.document.uuid
            }));
        
            // Берем результат попадания (число 1-20)
            const hitLoc = fallout.hitLocationResult;

            // Намертво записываем в сообщение
            await message.update({
                "flags.rollengine": {
                    isAttack: true,
                    itemId: itemId,
                    targets: targets,
                    hitLocation: hitLoc
                }
            });
            console.log("ROLL ENGINE | Данные атаки сохранены в базу:", {itemId, hitLoc, targets});
        }

        // 2. ЕСЛИ ЭТО УРОН (d6)
        if (fallout.diceFace === "d6") {
            const weaponId = message.flags?.weapon?._id;
            if (!weaponId) return;

            // Ищем последнюю атаку ИМЕННО ЭТИМ оружием в истории чата
            const messages = game.messages.contents;
            let lastAttackData = null;
        
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                const reFlags = msg.flags?.rollengine;
                if (reFlags?.isAttack && reFlags.itemId === weaponId) {
                    lastAttackData = reFlags;
                    break;
                }
            }

            // Если нашли атаку — копируем её цели и локацию в сообщение урона
            if (lastAttackData) {
                await message.update({
                    "flags.rollengine": {
                        isDamage: true,
                        targets: lastAttackData.targets,
                        hitLocation: lastAttackData.hitLocation
                    }
                });
                console.log("ROLL ENGINE | Данные успешно перенесены в урон:", lastAttackData);
            }
        }
    });

    // ==========================================
    // ROLL ENGINE: ОТРИСОВКА В ИНТЕРФЕЙСЕ
    // ==========================================
    onChatRender((message, html, data) => {
        const reFlags = message.flags?.rollengine;
        if (!reFlags) return;

        // Отрисовка для Атаки
        if (reFlags.isAttack) {
            html.find('h2').first().append(` <i class="fas fa-crosshairs" title="${esc(t('rollEngine.targetsCaptured'))}" style="color: #18ff62; font-size: 0.7em; text-shadow: 0 0 4px #18ff62;"></i>`);
        }
    });
}
