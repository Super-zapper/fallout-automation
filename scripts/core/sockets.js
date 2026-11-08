// ==========================================================
// Сокеты (socketlib). Раньше: world-скрипт «44_Sockets».
// Сокет регистрируется как сокет МОДУЛЯ fallout-automation
// (в module.json включено "socket": true).
// Снаружи всё по-прежнему доступно как window.falconSocket.
// ==========================================================

export function register() {
    const socket = socketlib.registerModule("fallout-automation");
    window.falconSocket = socket;

    // Универсальная функция для ГМа: действия над токеном
    socket.register("doVehicleActionGM", async (tokenId, action, payload) => {
        // Ищем токен по ID, а не по имени (так надежнее)
        const token = canvas.tokens.placeables.find(t => t.id === tokenId);
        if (!token) {
            console.warn("[Falcon Socket] Токен не найден:", tokenId);
            return false;
        }

        const doc = token.document;
        try {
            if (action === "update") await doc.update(payload.updates);
            else if (action === "setFlag") await doc.setFlag(payload.scope, payload.key, payload.value);
            else if (action === "unsetFlag") await doc.unsetFlag(payload.scope, payload.key);
            else if (action === "addEffect") await game.dfreds?.effectInterface?.addEffect({ effectName: payload.effectName, uuid: doc.uuid });
            else if (action === "removeEffect") await game.dfreds?.effectInterface?.removeEffect({ effectName: payload.effectName, uuid: doc.uuid });

            console.log(`[Falcon Socket] Выполнено: ${action}`);
            return true;
        } catch (err) {
            console.error("[Falcon Socket] Ошибка:", err);
            return false;
        }
    });

    // Добавление/удаление тегов (Tagger)
    socket.register("updateTags", async (tokenIds, action, tag) => {
        const tokens = canvas.tokens.placeables.filter(t => tokenIds.includes(t.id));
        if (action === "add") await Tagger.addTags(tokens, tag);
        if (action === "remove") await Tagger.removeTags(tokens, tag);
    });

    // Обновление документа токена (разворот и т.п.)
    socket.register("updateToken", async (tokenId, updateData) => {
        const token = canvas.tokens.get(tokenId);
        if (token) await token.document.update(updateData);
    });

    // Бросок проверки на машине игрока
    socket.register("runFalloutCheckSocket", async (data) => {
        const actor = await fromUuid(data.actorUuid);
        if (!actor) return { status: "error" };
        return await window.runFalloutCheck({ ...data, actor: actor });
    });

    // Смена масштаба тайла
    socket.register("updateTileScale", async (tileUuid, scaleX) => {
        const tileDoc = await fromUuid(tileUuid);
        if (tileDoc) return await tileDoc.update({ "texture.scaleX": scaleX });
    });

    // Универсальное обновление документа (Scene, AmbientLight, актёр и т.д.)
    socket.register("updateDocument", async (uuid, updateData) => {
        const doc = await fromUuid(uuid);
        if (!doc) return false;
        // await гарантирует, что база обновится до того, как сокет вернет управление
        return await doc.update(updateData);
    });

    // Синхронизация терминалов
    socket.register("syncFalloutTerminal", (terminalId, screenId, newState) => {
        // Триггерим локальный хук для всех, у кого пришел сокет
        Hooks.callAll("falloutTerminalSync", terminalId, screenId, newState);
    });

    // Диалог лечения травмы (renderInjuryDialog живёт в скрипте End of day)
    socket.register("showHealInjuryDialogSocket", async (actorUuid, choices, currentAP, apType) => {
        const actor = await fromUuid(actorUuid);
        if (!actor) return [];
        return await window.FalconRest.renderInjuryDialog(actor, choices, currentAP, apType);
    });

    console.log("🚀 [Falcon Socket] Зарегистрирован через socketlib (модуль fallout-automation)");
}
