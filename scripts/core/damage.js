// ==========================================================
// Damage Engine: расчёт и применение урона (window.applyFalconDamage) и кнопки в чате
// Перенесено из world-скрипта «50_43_DAMAGE_ENGINE». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { onChatRender } from "../utils/hooks.js";
import { t as tr, hasKey } from "../utils/i18n.js";
import * as fx from "./effects.js";
import { esc, row, alertBox, damageIcon } from "../utils/html.js";

export function register() {
    // Название типа урона на языке интерфейса (physical -> «Физический» / «Physical»)
    const damageTypeLabel = type => hasKey(`damageTypes.${type}`) ? tr(`damageTypes.${type}`) : String(type);

    /**
     * WORLD DAMAGE ENGINE v3.0 (Inline UI & RollEngine Integration)
     * Подключен к FALLOUT_CUSTOM_LIBRARY
     */

    // Проверяем, загружена ли библиотека
    if (!window.FALLOUT_CUSTOM_LIBRARY || !window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS) {
        ui.notifications.error(tr("damage.libraryMissing"));
    }

    // Вытаскиваем константы из нашей библиотеки (DRY!)
    const { HIT_LOCATIONS, BODY_LABELS } = window.FALLOUT_CUSTOM_LIBRARY;

    // 1. ГЛОБАЛЬНАЯ ФУНКЦИЯ ПРИМЕНЕНИЯ УРОНА
    // Изменено: теперь принимает массив UUID целей
    window.applyFalconDamage = async function(amount, damageTypes, manualLocationKey, targetUuids, armorPenetration = 0, applyStun = false, extraRadiation = 0, persistentData = null) {
        // Получаем объекты токенов по UUID
        const targets = targetUuids.map(uuid => fromUuidSync(uuid)?.object).filter(t => t);
    
        if (!targets.length) return ui.notifications.warn(tr("damage.noTargetsOnScene"));

        const types = Array.isArray(damageTypes) ? damageTypes : [damageTypes];

        for (const target of targets) {
            const actor = target.actor;
            let locationKey = manualLocationKey;

            // Если целей больше одной ИЛИ передан ключ "random", роллим локацию
            if (targets.length > 1 || locationKey === "random") {
                let bodyType = "humanoid";
                const sys = actor.system;
                if (sys.bodyType) bodyType = (typeof sys.bodyType === 'string') ? sys.bodyType : (sys.bodyType.value || "humanoid");
                if (sys.creatureType === "robot" && (!sys.bodyType || sys.bodyType === "default")) bodyType = "robot";
            
                // Проверка на наличие в базе библиотеки без toLowerCase (чтобы не ломать ключи вроде carTruck)
                if (!HIT_LOCATIONS[bodyType]) {
                    bodyType = (actor.type === "vehicle" && HIT_LOCATIONS["apc"]) ? "apc" : "humanoid";
                }

                const hitTable = HIT_LOCATIONS[bodyType];
                const roll = (await new Roll("1d20").evaluate()).total;

                for (let [key, range] of Object.entries(hitTable)) {
                    if (roll >= range[0] && roll <= range[1]) {
                        locationKey = key;
                        break;
                    }
                }
            }

            const bodyParts = foundry.utils.getProperty(actor, "system.body_parts") || {};
            const immunities = foundry.utils.getProperty(actor, "system.immunities") || {};
        
            const validTypes = types.filter(t => !immunities[t]);
        
            if (validTypes.length === 0) {
                ChatMessage.create({
                    content: `<div class="fa-term">${alertBox(`${esc(target.name)} ${tr("damage.immune")}`, "muted")}</div>`,
                    author: game.user.id
                });
                continue;
            }

            const partData = bodyParts[locationKey];
            let bestResistance = Infinity;
            let appliedType = validTypes[0];

            for (let t of validTypes) {
                let res = partData?.resistance?.[t] ?? 0;
                if (res < bestResistance) {
                    bestResistance = res;
                    appliedType = t;
                }
            }
            if (bestResistance === Infinity) bestResistance = 0;

            // --- ЛОГИКА ПРОБИТИЯ БРОНИ (PIERCING) ---
            // СУ не может опуститься ниже нуля
            const effectiveResistance = Math.max(0, bestResistance - armorPenetration);

            // Итоговый урон: (Урон - Остаточная Броня)
            const finalDamage = Math.max(0, amount - effectiveResistance);
            const health = foundry.utils.getProperty(actor, "system.health");
        
            // --- РАЗДЕЛЕНИЕ ТИПА УРОНА (HP / РАДИАЦИЯ) ---
            const isRadiation = appliedType === "radiation";
            let updateData = {};
        
            // Считаем "виртуальный" newHP. 
            // Если это радиация, мы не будем писать его напрямую в хп, 
            // но он нужен движку травм ниже, чтобы понять, упала ли цель в 0.
            const newHP = Math.max(0, (health?.value || 0) - finalDamage);

            const currentRad = Number(foundry.utils.getProperty(actor, "system.radiation")) || 0;
        
            if (isRadiation) {
                updateData["system.radiation"] = currentRad + finalDamage + extraRadiation;
            } else {
                updateData["system.health.value"] = newHP;
                if (extraRadiation > 0 && !immunities.radiation) {
                    // ФИКС: Считываем рад. сопротивление локации и уменьшаем урон от эффекта
                    const radResist = partData?.resistance?.radiation || 0;
                    extraRadiation = Math.max(0, extraRadiation - radResist);
                
                    if (extraRadiation > 0) {
                        updateData["system.radiation"] = currentRad + extraRadiation;
                    }
                }
            }

            // ==========================================
            // ЛОГИКА ТРАВМ
            // ==========================================
            let injuryHtml = "";
            let reopenHtml = "";

            // ДОБАВЛЯЕМ ПРОВЕРКУ ЗДЕСЬ:
            const skipTrauma = locationKey === "none" || locationKey === "bypass" || locationKey === "bleed";

            if (!skipTrauma) {

            // Определяем транспорт и порог травмы
            const scale = foundry.utils.getProperty(actor, "system.scale.value") || 0;
            const isVehicle = actor.type === "vehicle" || scale > 0;
            const injuryThreshold = 5 + scale;

            // ВЫНОСИМ ПЕРЕМЕННЫЕ ВЫШЕ, чтобы использовать в механике открытия ран
            const partPath = `system.body_parts.${locationKey}`;
            // У персонажей и транспорта раны лежат массивом (0 нет, 1 залечена, 2 открыта).
            // У NPC и существ (creature) массива нет: хранятся только два числа, injuryOpenCount и injuryTreatedCount,
            // поэтому для них собираем такой же массив из чисел и по итогам записываем обратно числа.
            // Тип creature использует тот же лист, что и NPC, поэтому раны у него тоже счётчиками.
            // Запасной признак: если у зоны нет массива injuries, считаем, что раны хранятся числами.
            const countsModel = ["npc", "creature"].includes(actor.type) || !Array.isArray(partData?.injuries);
            const injuries = countsModel
                ? [
                    ...Array(Math.max(0, Number(partData?.injuryOpenCount) || 0)).fill(2),
                    ...Array(Math.max(0, Number(partData?.injuryTreatedCount) || 0)).fill(1),
                ]
                : [...(partData?.injuries || [])];
            if (countsModel) while (injuries.length < 5) injuries.push(0);

            // Записывает раны зоны в обновление актёра и возвращает счётчики
            const writeInjuries = () => {
                const openCount = injuries.filter(v => v === 2).length;
                const treatedCount = injuries.filter(v => v === 1).length;
                if (!countsModel) updateData[`${partPath}.injuries`] = injuries;
                updateData[`${partPath}.injuryOpenCount`] = openCount;
                updateData[`${partPath}.injuryTreatedCount`] = treatedCount;
                return { openCount, treatedCount };
            };

            // --- НАЧАЛО: МЕХАНИКА ОТКРЫТИЯ РАН ---
            if (finalDamage > 0) { 
                const treatedIndexes = injuries.map((v, i) => v === 1 ? i : -1).filter(i => i !== -1);
                console.debug(`Fallout Automation | Раны в зоне «${locationKey}»:`, JSON.stringify(injuries), "залеченных:", treatedIndexes.length);
            
                if (treatedIndexes.length > 0) {
                    // Бросок открытый: уходит в чат отдельным сообщением, поэтому его видят все,
                    // а Dice So Nice подхватывает его сам. Кубы «dc» (боевые кубы Fallout), как и в броске урона.
                    const reopenRoll = await new Roll(`${treatedIndexes.length}dc`).evaluate();
                    const reopenMessage = await reopenRoll.toMessage({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        flavor: tr("damage.reopenRollFlavor", { name: target.name, count: treatedIndexes.length })
                    });
                    // Ждём конца 3D-анимации, чтобы карточка расчёта не появилась раньше, чем остановятся кубы
                    try { await game.dice3d?.waitFor3DAnimationByMessageID(reopenMessage.id); } catch (e) { /* без Dice So Nice */ }

                    // Считаем эффекты (выпало 5 или 6 на d6, что в dc является гранью с иконкой Fallout)
                    const effectsRolled = reopenRoll.terms[0].results.reduce((acc, d) => acc + (d.result >= 5 ? 1 : 0), 0);
                
                    if (effectsRolled > 0) {
                        const reopenedCount = Math.min(effectsRolled, treatedIndexes.length);
                        for (let i = 0; i < reopenedCount; i++) {
                            injuries[treatedIndexes[i]] = 2; 
                        }
                    
                        const { openCount } = writeInjuries();
                        updateData[`${partPath}.status`] = openCount > 0 ? "crippled" : "wounded";

                        reopenHtml = alertBox(tr("damage.woundReopened", { count: reopenedCount }), "danger");
                    }
                }
            }

            // --- КОНЕЦ: МЕХАНИКА ОТКРЫТИЯ РАН ---

            // ==========================================
            // ЛОГИКА НАЛОЖЕНИЯ НОВЫХ ТРАВМ (v4.0)
            // ==========================================
            let injuriesToApply = 0;
            let injuryReasons = [];

            const currentHP = health?.value || 0;
            const wasAtZero = currentHP <= 0;

            // СЦЕНАРИЙ А: Цель была жива (HP > 0)
            if (!wasAtZero) {
                // 1. Проверка на порог критического урона
                if (finalDamage >= injuryThreshold) {
                    injuriesToApply++;
                    injuryReasons.push(tr("damage.reasonCrit"));
                }
                // 2. Проверка на падение в 0 ОЗ этим ударом
                if (newHP === 0 && finalDamage > 0) {
                    injuriesToApply++;
                    injuryReasons.push(tr("damage.reasonDrop"));
                }
            } 
            // СЦЕНАРИЙ Б: Цель уже была при 0 ОЗ
            else if (finalDamage > 0) {
                // Любой урон по цели с 0 ОЗ дает ровно одну травму
                injuriesToApply = 1;
                injuryReasons.push(tr("damage.reasonAtZero"));
            }

            if (injuriesToApply > 0) {
                let appliedInjuriesCount = 0;

                for (let i = 0; i < injuriesToApply; i++) {
                    const hasOpenInjury = injuries.includes(2);

                    // Транспорт не может иметь больше одной открытой травмы в одной локации
                    if (isVehicle && hasOpenInjury) {
                        if (i === 0) {
                            injuryHtml += alertBox(tr("damage.vehicleInjuryCancelled"), "warn");
                        }
                        break; 
                    } else {
                        // Ищем слот: сначала пытаемся «вскрыть» леченную (1), если нет — берем пустую (0)
                        const targetIndex = injuries.indexOf(1) !== -1 ? injuries.indexOf(1) : injuries.indexOf(0);
            
                        if (targetIndex !== -1) {
                            injuries[targetIndex] = 2; // 2 = открытая травма
                            appliedInjuriesCount++;
                        } else {
                            if (appliedInjuriesCount === 0) {
                                injuryHtml += alertBox(tr("damage.noInjurySlots"), "muted");
                            }
                            break; 
                        }
                    }
                }

                if (appliedInjuriesCount > 0) {
                    const { openCount, treatedCount } = writeInjuries();
                    let status = openCount > 0 ? "crippled" : (treatedCount > 0 ? "wounded" : "healthy");

                    updateData[`${partPath}.status`] = status;

                    const reasonsText = injuryReasons.join(" + ");
                    injuryHtml += alertBox(tr("damage.injuries", { count: appliedInjuriesCount }), "danger", `(${esc(reasonsText)})`);
                }
            }
            }

            // Выполняем одно общее обновление (ХП + Травмы)
            await actor.update(updateData);
            // --- ОЗВУЧКА ПОЛУЧЕНИЯ УРОНА ---
            if (finalDamage > 0 && newHP > 0 && !isRadiation && typeof playHurtSound === "function") {
                playHurtSound(target);
            }
            // Иконки типов урона берём из шрифта системы (fo-physical, fo-energy, fo-radiation, fo-poison)
            const typeLabel = validTypes.map(t => damageIcon(t)).join("");
            const appliedLabel = appliedType ? damageTypeLabel(appliedType).toLocaleUpperCase() : "N/A";

            // Формируем красивую строку брони, если сработало пробитие
            let armorText = `-${effectiveResistance}`;
            if (armorPenetration > 0) {
                armorText += ` <span class="fa-note">${tr("damage.armorDetail", { base: bestResistance, ignore: armorPenetration })}</span>`;
            }

            // --- ЛОГИКА ОГЛУШЕНИЯ (С ДЕБАГОМ) ---
            let stunHtml = "";
            if (applyStun) {
                const hasStun = fx.hasEffect(actor, "stun");

                if (!hasStun) {
                    await fx.applyEffect(actor, "stun");
                    stunHtml = alertBox(tr("damage.stunApplied"), "warn");
                } else {
                    stunHtml = alertBox(tr("damage.stunAlready"), "muted");
                }
            }


            // --- ЛОГИКА ПРОДОЛЖИТЕЛЬНОГО УРОНА ---
            let persistentHtml = "";
            if (persistentData) { 
                // Эффект создаёт сам модуль (Convenient Effects не нужен)
                const effectData = fx.effectData("persistent");
                effectData.name = `${effectData.name} ${persistentData.duration}`;
                effectData.duration = { rounds: persistentData.duration };
                foundry.utils.setProperty(effectData, "flags.fallout.persistentWeapon", persistentData.weapon);
            
                // Накладываем эффект напрямую
                await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
            
                persistentHtml = alertBox(tr("damage.persistentDamage", { rounds: persistentData.duration }), "pink");
            }

            // Получаем красивый лейбл из библиотеки
            const locLabel = window.FALLOUT_CUSTOM_LIBRARY.getPartLabel(actor, locationKey);

            const showRadEffect = extraRadiation > 0 && !isRadiation && !immunities.radiation;
            const chatMsg = `
                <div class="fa-term">
                    <div class="fa-title">${tr("damage.card.title")}</div>
                    ${row(tr("damage.card.target"), esc(target.name))}
                    ${row(tr("damage.card.location"), `${skipTrauma ? `<span style="color: var(--fa-pink);">${tr("damage.card.noLocation")}</span>` : esc(locLabel)}${targets.length > 1 ? ` <span class="fa-note">${tr("damage.card.auto")}</span>` : ""}`)}
                    ${row(tr("damage.card.damage"), `${amount} ${typeLabel}`)}
                    ${row(tr("damage.card.armor", { type: appliedLabel }), armorText)}
                    <div class="fa-total">${isRadiation ? tr("damage.totalRad", { value: finalDamage + extraRadiation }) : tr("damage.totalHp", { value: finalDamage })}</div>
                    ${showRadEffect ? alertBox(tr("damage.radiationEffect", { value: extraRadiation }), "rad") : ""}
                    ${stunHtml}
                    ${persistentHtml}
                    ${reopenHtml}${injuryHtml}
                </div>
            `;

            await ChatMessage.create({
                content: chatMsg,
                author: game.user.id,
                speaker: ChatMessage.getSpeaker({token: target.document}),
                whisper: ChatMessage.getWhisperRecipients("GM") // Отправляет сообщение только ГМам
            });
        }
    };

    // 2. ХУК RENDER CHAT MESSAGE (ВСТРАИВАНИЕ ИНТЕРФЕЙСА)
    onChatRender((msg, html, data) => {
        if (!game.user.isGM) return;

        const rollData = msg.flags?.falloutroll;
        const engineData = msg.flags?.rollengine;
        const isDamage = rollData?.diceFace === "d6" || engineData?.isDamage === true;
        if (!rollData || !isDamage) return;

        // Базовые данные
        let damageValue = rollData.damage ?? 0;
        const effectsCount = rollData.effects || 0;
        const weaponData = msg.flags?.weapon;
        const attackerActor = ChatMessage.getSpeakerActor(msg.speaker);

        // =========================================================
        // БЛОК 1: ОБРАБОТКА ЭФФЕКТОВ УРОНА (Vicious, Piercing и т.д.)
        // =========================================================
        let extraDamage = 0;

        if (effectsCount > 0 && attackerActor && weaponData) {
        
            // --- 1.1 Сюда добавляем эффекты (Piercing и т.д.) ---
            // if (damageEffects.piercing?.value > 0) { ... }
        }

        // Применяем бонус к значению для UI
        damageValue += extraDamage;

        // ПЕРЕЗАПИСЬ ДЕФОЛТНОГО HTML (Обновляем большое число в чате)
        if (extraDamage > 0) {
            const totalDisplay = html.find('.damage-total');
            if (totalDisplay.length > 0) {
                totalDisplay.text(damageValue);
                totalDisplay.css({
                    "color": "#4caf50", 
                    "text-shadow": "0 0 5px #2e7d32",
                    "transition": "all 0.3s"
                });
                totalDisplay.attr('title', tr("damage.totalTooltip", { base: rollData.damage, bonus: extraDamage }));
            }
        }
        // =========================================================
    
        // =========================================================
        // БЛОК 1.1: РАСЧЕТ ЭФФЕКТОВ УРОНА
        // =========================================================
        let armorPenetration = 0;
        let applyStun = false;
        let extraRadiation = 0;
        let persistentData = null;
        let spreadHits = 0;

        if (weaponData && effectsCount > 0) {
            // Radioactive (1 очко за каждый выпавший эффект)
            const radData = weaponData.system?.damage?.damageEffect?.radioactive;
            if (radData?.value > 0) {
                extraRadiation = effectsCount;
            }
            // Piercing (теперь проверяем строго наличие через value)
            const pData = weaponData.system?.damage?.damageEffect?.piercing_x;
            if (pData?.value > 0) { 
                const piercingRating = pData.rank || 0;
                armorPenetration = piercingRating * effectsCount;
            }

            // Stun
            const stunData = weaponData.system?.damage?.damageEffect?.stun;
            if (stunData?.value > 0) { // Здесь тоже лучше проверять value для надежности
                applyStun = true;
            }
        
            // Spread (Разброс)
            const spreadData = weaponData.system?.damage?.damageEffect?.spread;
            if (spreadData?.value > 0) {
                spreadHits = effectsCount; // По 1 доп. попаданию за каждый эффект
            }
            // Persistent (Продолжительный)
            const persistentEffectData = weaponData.system?.damage?.damageEffect?.persistent;
            if (persistentEffectData?.value > 0) {
                // Делаем глубокий клон оружия
                let weaponClone = foundry.utils.deepClone(weaponData);
            
                // Удаляем оригинальный ID и отключаем свойство persistent
                delete weaponClone._id;
                if (weaponClone.system?.damage?.damageEffect?.persistent) {
                    weaponClone.system.damage.damageEffect.persistent.value = 0;
                }
            
                // --- ЛОГИКА РАНГОВ ДЛЯ ТИПА УРОНА ---
                const pRank = persistentEffectData.rank || 0;
                if (pRank >= 1 && pRank <= 4 && weaponClone.system?.damage?.damageType) {
                    // Выключаем все текущие типы урона
                    for (let typeKey of Object.keys(weaponClone.system.damage.damageType)) {
                        weaponClone.system.damage.damageType[typeKey] = false;
                    }
                    // Включаем нужный в зависимости от rank
                    if (pRank === 1) weaponClone.system.damage.damageType.physical = true;
                    if (pRank === 2) weaponClone.system.damage.damageType.energy = true;
                    if (pRank === 3) weaponClone.system.damage.damageType.radiation = true;
                    if (pRank === 4) weaponClone.system.damage.damageType.poison = true;
                }
            
                persistentData = {
                    duration: effectsCount,
                    weapon: weaponClone
                };
            }
        }

        // ДОСТАЕМ ЦЕЛИ ИЗ ФЛАГА
        let targets = engineData?.targets || [];
        let targetUuids = targets.map(t => t.uuid);
        let targetNames = targets.map(t => t.name).join(", ") || tr("damage.noTargetSelect");
    
        // ДОСТАЕМ ПОПАДАНИЕ ИЗ ФЛАГА (только если цель одна)
        let autoHitLocation = (targets.length === 1 && engineData?.hitLocation) ? engineData.hitLocation : "";

        // ОПРЕДЕЛЕНИЕ ТИПОВ УРОНА
        let dmgTypes = [];
        const dmgTypeObj = foundry.utils.getProperty(msg, "flags.weapon.system.damage.damageType");
        if (dmgTypeObj) {
            for (let [type, active] of Object.entries(dmgTypeObj)) {
                if (active === true) dmgTypes.push(type);
            }
        }
        if (dmgTypes.length === 0) dmgTypes.push("physical");
        const baseTypeString = dmgTypes.map(type => `${damageIcon(type)} ${damageTypeLabel(type).toLocaleUpperCase()}`).join(" ");
        // Формируем красивые теги для интерфейса
        let effectTags = [];
        if (armorPenetration > 0) effectTags.push(tr("damage.tagPierce", { value: armorPenetration }));
        if (applyStun) effectTags.push(fx.effectName("stun"));
        if (extraRadiation > 0) effectTags.push(tr("damage.tagRad", { value: extraRadiation }));
        if (persistentData) effectTags.push(tr("damage.tagPersistent", { rounds: persistentData.duration }));

        const uiTypeString = effectTags.length > 0 
            ? `${baseTypeString} <span class="fa-tags">(${effectTags.join(", ")})</span>` 
            : baseTypeString;

    

        // =========================================================
        // ЛОГИКА ОПРЕДЕЛЕНИЯ ТИПА ТЕЛА И СПИСКА (для интерфейса)
        // =========================================================
        let bodyType = "humanoid";
        let hitTable = HIT_LOCATIONS["humanoid"];
        let realBodyParts = {};
        let targetActor = null;

        // Если цель ровно одна, подгружаем её данные
        if (targets.length === 1) {
            const targetDoc = fromUuidSync(targetUuids[0]);
            targetActor = targetDoc?.actor;
        
            if (targetActor) {
                const sys = targetActor.system;
            
                // Единое определение типа тела (подходит и для существ, и для транспорта)
                    if (sys.bodyType) {
                        bodyType = (typeof sys.bodyType === 'string') ? sys.bodyType : (sys.bodyType.value || "humanoid");
                    }
                    if (sys.creatureType === "robot" && (!sys.bodyType || sys.bodyType === "default")) bodyType = "robot";

                    // Проверка на наличие в базе библиотеки (с фолбэком на apc для транспорта)
                    if (!HIT_LOCATIONS[bodyType]) {
                        bodyType = (targetActor.type === "vehicle" && HIT_LOCATIONS["apc"]) ? "apc" : "humanoid";
                    }
            
                hitTable = HIT_LOCATIONS[bodyType];
                realBodyParts = sys.body_parts || {};
            }
        }

        // Собираем HTML выпадающего списка
        let optionsHtml = `<option value="bypass">${tr("damage.pureDamage")}</option>`;
    
        // ВАЖНО: Берем ключи ТОЛЬКО из hitTable. 
        // Это отсечет все фантомные крылья и колеса, которые система пихает в чарник транспорта
        const validKeys = Object.keys(hitTable);
    
        let preSelectedKey = "";

        // Определяем, какая часть тела соответствует числу hitLocation
        if (autoHitLocation === "bypass" || autoHitLocation === "none") {
            preSelectedKey = autoHitLocation;
        } else if (autoHitLocation) {
            for (let [key, range] of Object.entries(hitTable)) {
                if (autoHitLocation >= range[0] && autoHitLocation <= range[1]) {
                    preSelectedKey = key;
                    break;
                }
            }
        }

        for (let key of validKeys) {
            const rangeStr = hitTable[key] ? ` [${hitTable[key][0]}-${hitTable[key][1]}]` : "";
        
            // ФИКС: Если целей несколько, targetActor = null. Передаем пустой объект, чтобы не крашить библиотеку.
            let label = window.FALLOUT_CUSTOM_LIBRARY.getPartLabel(targetActor || {}, key);
        
            let selected = "";
            if (preSelectedKey) {
                selected = (key === preSelectedKey) ? "selected" : "";
            } else {
                selected = (key === 'torso' || key === 'chassis') ? "selected" : "";
            }

            optionsHtml += `<option value="${key}" ${selected}>${label}${rangeStr}</option>`;
        }

        // БЛОК ИНТЕРФЕЙСА В ЧАТЕ
        const panelId = `falcon-panel-${msg.id}`;
        const uiHtml = $(`
            <div id="${panelId}" class="fa-term">
                <div class="fa-title" style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <span style="flex: 1 1 auto;">${tr("damage.panelTitle")}</span>
                    <select class="f-target-mode" style="flex: 0 1 140px; min-width: 0; height: 20px; font-size: 10px; text-transform: none; letter-spacing: 0;">
                        <option value="message">${tr("damage.fromRoll", { count: targets.length })}</option>
                        <option value="current">${tr("damage.currentSelection")}</option>
                    </select>
                </div>
                <div class="fa-targets" title="${esc(targetNames)}">${tr("damage.targetsLabel")}: ${esc(targetNames)}</div>

                <div class="fa-controls">
                    <input type="number" class="f-dmg fa-dmg-input" value="${damageValue}" title="${tr("damage.titleDamage")}">
                    <span class="fa-types">${uiTypeString}</span>
                    ${targets.length === 1 ? `
                        <input type="number" class="f-hit-die fa-hit-die" value="${autoHitLocation}" placeholder="d20" title="${tr("damage.titleD20")}">
                    ` : `
                        <span class="fa-note" style="flex: 0 0 38px; text-align: center;">${tr("damage.autoUpper")}</span>
                    `}
                </div>

                <div class="fa-controls">
                    <select class="f-hit-loc" ${targets.length > 1 ? 'disabled' : ''}>
                        ${targets.length > 1 ? `<option value="auto">${tr("damage.autoRollEach")}</option>` : optionsHtml}
                    </select>
                    <button type="button" class="f-apply-btn fa-btn" title="${tr("damage.applyBtn")}" style="flex: 0 0 34px;">
                        <i class="fas fa-crosshairs"></i>
                    </button>
                </div>
            </div>
        `);

        // ЛОГИКА: Синхронизация числа d20 и выпадающего списка (только если 1 цель)
        if (targets.length === 1) {
            uiHtml.find('.f-hit-die').on('input', (e) => {
                const roll = parseInt(e.target.value);
                if (!roll) return;

                for (let [key, range] of Object.entries(hitTable)) {
                    if (roll >= range[0] && roll <= range[1]) {
                        const select = uiHtml.find('.f-hit-loc');
                        if (select.find(`option[value="${key}"]`).length > 0) {
                            select.val(key);
                        }
                        break;
                    }
                }
            });
        }

        // ЛОГИКА: Кнопка "Нанести урон"
        uiHtml.find('.f-apply-btn').click(async (event) => {
            event.preventDefault();
        
            // 1. ВЫБОР ЦЕЛЕЙ (В зависимости от переключателя)
            const targetMode = uiHtml.find('.f-target-mode').val();
            let finalUuids = (targetMode === "message" && targetUuids.length > 0) 
                ? targetUuids 
                : Array.from(game.user.targets).map(t => t.document?.uuid).filter(u => u);

            const val = parseInt(uiHtml.find('.f-dmg').val());
            const loc = uiHtml.find('.f-hit-loc').val();
        
            // 2. ПРИМЕНЕНИЕ УРОНА (только если есть по кому)
            if (finalUuids.length > 0) {
                // Основной урон
                await window.applyFalconDamage(val, dmgTypes, loc, finalUuids, armorPenetration, applyStun, extraRadiation, persistentData);
            
                // Дополнительный урон от Spread (Разлет)
                if (spreadHits > 0) {
                    const spreadVal = Math.floor(val / 2); // Половина урона с округлением вниз
                    if (spreadVal > 0) {
                        for (let i = 0; i < spreadHits; i++) {
                            // Передаем "random" как локацию и сбрасываем все эффекты (нули и false)
                            await window.applyFalconDamage(spreadVal, dmgTypes, "random", finalUuids, 0, false, 0, null);
                        }
                    }
                }
            } else {
                ui.notifications.warn(tr("damage.noTargetsSelected"));
            }

            // 3. УДАЛЕНИЕ ВЗРЫВЧАТКИ (вынесено из условия наличия целей)
            const weaponData = msg.flags?.weapon;
            const attackerActor = game.actors.get(msg.speaker?.actor);
        
            if (weaponData?.system?.weaponType === "explosives" && attackerActor) {
                const explosiveItem = attackerActor.items.get(weaponData._id);
                if (explosiveItem && (explosiveItem.system.quantity || 0) <= 0) {
                    await explosiveItem.delete();
                    ui.notifications.info(tr("damage.explosiveRemoved", { name: explosiveItem.name }));
                }
            }
        });

        // Добавляем панель в сообщение
        html.find('.message-content').append(uiHtml);
    });
}
