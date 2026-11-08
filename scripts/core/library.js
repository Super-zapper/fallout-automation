// ==========================================================
// Общая библиотека данных: зоны попадания, названия частей тела, базы эффектов травм (window.FALLOUT_CUSTOM_LIBRARY)
// Перенесено из world-скрипта «13_5_FALLOUT_CUSTOM_LIBRARY». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { t } from "../utils/i18n.js";

/**
 * Таблица названий, которая берёт текст из lang-файла при каждом обращении.
 * Для остальных скриптов она выглядит как обычный объект: BODY_LABELS.head,
 * Object.keys(...), Object.entries(...) работают как раньше, а язык можно сменить без перезагрузки.
 */
function localized(prefix, keys) {
    const table = {};
    for (const key of keys) {
        Object.defineProperty(table, key, { get: () => t(`${prefix}.${key}`), enumerable: true });
    }
    return table;
}

export function register() {
    /**
     * FALLOUT_CUSTOM_LIBRARY 
     * Хранилище общих данных для всех движков (Difficulty, Damage и т.д.)
     */

    window.FALLOUT_CUSTOM_LIBRARY = window.FALLOUT_CUSTOM_LIBRARY || {};

    window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS = {
        "humanoid": { "head": [1, 2], "torso": [3, 8], "armL": [9, 11], "armR": [12, 14], "legL": [15, 17], "legR": [18, 20] },
        "robot": { "head": [1, 2], "torso": [3, 8], "armL": [9, 11], "armR": [12, 14], "legL": [15, 17], "legR": [18, 20] },
        "quadruped": { "head": [1, 2], "torso": [3, 8], "armL": [9, 11], "armR": [12, 14], "legL": [15, 17], "legR": [18, 20] },
        "flyingInsect": { "head": [1, 2], "torso": [3, 8], "armL": [9, 11], "armR": [12, 14], "legL": [15, 17], "legR": [18, 20] },
        "apc": {
            "chassis": [1, 10], "wheelFL": [11, 11], "wheelFR": [12, 12], 
            "engine": [13, 16], "wheelML": [17, 17], "wheelMR": [18, 18], 
            "wheelRL": [19, 19], "wheelRR": [20, 20]
        },
        "carTruck": { "chassis": [1, 8], "wheelFL": [9, 10], "wheelFR": [11, 12], "engine": [13, 16], "wheelRL": [17, 18], "wheelRR": [19, 20] },
        "motorcycle": { "chassis": [1, 7], "wheelF": [8, 11], "engine": [12, 16], "wheelR": [17, 20] },
        "sportsCar": { "chassis": [1, 7], "wheelFL": [8, 9], "wheelFR": [10, 11], "engine": [12, 16], "wheelRL": [17, 18], "wheelRR": [19, 20] },
        "bus": { "chassis": [1, 8], "wheelFL": [9, 10], "wheelFR": [11, 12], "engine": [13, 16], "wheelRL1": [17, 17], "wheelRR1": [18, 18], "wheelRL2": [19, 19], "wheelRR2": [20, 20] },
        "armored": { "chassis": [1, 8], "wheelFL": [9, 10], "wheelFR": [11, 12], "engine": [13, 16], "wheelRL": [17, 18], "wheelRR": [19, 20] },
        "vertibird": { "engineL": [1, 2], "engineR": [3, 4], "chassis": [5, 10], "wingL": [11, 13], "wingR": [14, 16], "weaponNG": [17, 18], "weaponDG": [19, 20] }
    };

    window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS = localized("bodyLabels", ["head", "torso", "armL", "armR", "legL", "legR", "Head_Optics_Head_Head", "LeftArm_Arm1_LeftFrontLeg_LeftWingAsLeg", "LeftLeg_Arm3_LeftHindLeg_Legs", "RightArm_Arm2_RightFrontLeg_RightWingAsLeg", "RightLeg_Thruster_RightHindLeg_Legs", "Torso_MainBody_Torso_Torso", "chassis", "engine", "wheelFL", "wheelFR", "wheelML", "wheelMR", "wheelRL", "wheelRR"]);

    // База названий для эффектов травм (в родительном падеже: "Травма [Чего?]")
    window.FALLOUT_CUSTOM_LIBRARY.EFFECT_BASES = {
        "humanoid": localized("injuryBases.humanoid", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "quadruped": localized("injuryBases.quadruped", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "flyingInsect": localized("injuryBases.flyingInsect", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "robot": localized("injuryBases.robot", ["head", "torso", "armL", "armR", "legL", "legR"])
    };

    /**
     * ДОПОЛНЕНИЕ БИБЛИОТЕКИ: Специфичные названия частей тела по типам
     * Старый объект BODY_LABELS не трогаем для обратной совместимости.
     */

    window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS_BY_TYPE = {
        "humanoid": localized("bodyLabelsByType.humanoid", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "robot": localized("bodyLabelsByType.robot", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "quadruped": localized("bodyLabelsByType.quadruped", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "flyingInsect": localized("bodyLabelsByType.flyingInsect", ["head", "torso", "armL", "armR", "legL", "legR"]),
        "vehicle": localized("bodyLabelsByType.vehicle", ["chassis", "engine", "engineL", "engineR", "weaponDG", "weaponNG", "wheelF", "wheelFL", "wheelFR", "wheelML", "wheelMR", "wheelR", "wheelRL", "wheelRR", "wheelRL1", "wheelRL2", "wheelRR1", "wheelRR2", "wingL", "wingR"])
    };

    /**
     * ФУНКЦИЯ 1: Получить все правильные лейблы для конкретного актера (или токена)
     * Вызов: window.FALLOUT_CUSTOM_LIBRARY.getLabelsList(actor)
     */
    window.FALLOUT_CUSTOM_LIBRARY.getLabelsList = function(actorOrToken) {
        const actor = actorOrToken.actor || actorOrToken; // Поддержка передачи как токена, так и актера
        if (!actor) return window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS_BY_TYPE["humanoid"];

        // Если это транспорт
        if (actor.type === "vehicle") {
            return window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS_BY_TYPE["vehicle"];
        }

        // Если это существо/робот/персонаж
        const bType = actor.type === "robot" ? "robot" : (actor.system?.bodyType || "humanoid");
    
        return window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS_BY_TYPE[bType] || window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS_BY_TYPE["humanoid"];
    };

    /**
     * ФУНКЦИЯ 2: Получить правильное название конкретной части (например "legL") для актера
     * Вызов: window.FALLOUT_CUSTOM_LIBRARY.getPartLabel(actor, "legL")
     */
    window.FALLOUT_CUSTOM_LIBRARY.getPartLabel = function(actorOrToken, partKey) {
        const labels = window.FALLOUT_CUSTOM_LIBRARY.getLabelsList(actorOrToken);
    
        // Ищем в новом детальном списке, если нет — ищем в старом общем списке, если нет — возвращаем сам ключ
        return labels[partKey] || window.FALLOUT_CUSTOM_LIBRARY.BODY_LABELS[partKey] || partKey;
    };

    console.log("FALLOUT_CUSTOM_LIBRARY | Specific labels and helper functions loaded.");

    console.log("FALLOUT_CUSTOM_LIBRARY CORE LIBRARY | Databases loaded.");
}
