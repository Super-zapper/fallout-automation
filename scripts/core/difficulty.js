// ==========================================================
// Difficulty Engine: сложность броска, диалог, вердикт успех/провал, добавление ОД
// Перенесено из world-скрипта «49_27_DIFFICULTY_ENGINE». Логика не менялась,
// кроме замены хука renderChatMessage на onChatRender (см. utils/hooks.js).
// ==========================================================
import { onChatRender } from "../utils/hooks.js";
import * as fx from "./effects.js";
import { addAP } from "./ap.js";
import { t as tr } from "../utils/i18n.js";
import { esc, row } from "../utils/html.js";


// ==========================================================
// Разбор сложности в окне броска атаки одной строкой.
// Базовые значения (защита цели, база взрыва) показываются нейтрально, поправки красным (+, сложнее)
// или зелёным (-, проще). Нулевые значения не выводятся. Если слагаемых много, шрифт слегка
// уменьшается, чтобы строка не переносилась. Цвета заданы здесь, потому что окно броска светлое,
// а не терминальное, и зелёный в нём означает именно «проще».
// ==========================================================
const BD_RED = "#c62828";
const BD_GREEN = "#2e7d32";

function renderBreakdown(html) {
    const el = html.find(".fa-bd");
    const bd = el.data("bd");
    if (!el.length || !bd) return;

    const terms = [...bd.base.map(b => ({ ...b, base: true })), ...bd.mods];

    // Штраф +1 за выбранную часть тела: только если зона не случайная и нет V.A.T.S.
    const loc = html.find('[name="hit-location"]').val();
    if (loc && loc !== "random" && !bd.vats) terms.push({ label: tr("difficulty.bd.zone"), value: 1 });

    // Скрытная атака: -1
    if (html.find('[name="sneak-attack"]').is(":checked")) terms.push({ label: tr("difficulty.bd.sneak"), value: -1 });

    const parts = terms
        .filter(x => x.value !== 0)
        .map(x => {
            if (x.base) return `<span>${esc(x.label)} <b>${x.value}</b></span>`;
            const color = x.value > 0 ? BD_RED : BD_GREEN;
            const sign = x.value > 0 ? "+" : "\u2212";
            return `<span>${esc(x.label)} <b style="color: ${color};">${sign}${Math.abs(x.value)}</b></span>`;
        });
    if (bd.attr) parts.push(`<span style="color: #777;">[${esc(bd.attr)}]</span>`);
    if (bd.note) parts.push(`<span style="color: #777;">${esc(bd.note)}</span>`);

    const size = parts.length <= 3 ? "0.82em" : parts.length === 4 ? "0.78em" : parts.length === 5 ? "0.72em" : "0.66em";
    el.css({ "white-space": "nowrap", "font-size": size })
      .html(parts.join(' <span style="color: #999;">\u00b7</span> '));
}

export function register() {
    /** Снять все цели игрока. User#updateTokenTargets есть не во всех версиях Foundry (в v13 его нет). */
    function clearTargets() {
        if (typeof game.user.updateTokenTargets === "function") return game.user.updateTokenTargets([]);
        for (const token of [...game.user.targets]) token.setTarget(false, { releaseOthers: false, groupSelection: true });
        game.user.broadcastActivity?.({ targets: [] });
    }

    /**
     * Граната: выбирает целями все токены, которых касается круг взрыва.
     * Центр и радиус даны в пикселях сцены. Токен считается внутри, если его рамка пересекает круг.
     * Цели ставятся группой (groupSelection), чтобы не сыпались уведомления «Цель: ...» на каждый токен.
     */
    function targetTokensInCircle(cx, cy, radiusPx) {
        clearTargets();
        const chosen = [];
        for (const token of canvas.tokens.placeables) {
            if (!token.actor) continue;
            if (!game.user.isGM && (!token.visible || token.document.hidden)) continue;
            const b = token.bounds;
            const nearestX = Math.max(b.x, Math.min(cx, b.x + b.width));
            const nearestY = Math.max(b.y, Math.min(cy, b.y + b.height));
            if (Math.hypot(cx - nearestX, cy - nearestY) <= radiusPx) chosen.push(token);
        }
        for (const token of chosen) token.setTarget(true, { releaseOthers: false, groupSelection: true });
        game.user.broadcastActivity?.({ targets: chosen.map(tk => tk.id) });
        return chosen;
    }

    /**
     * Определяем актёра, который кидает бросок.
     * Для оружия и макросов система передаёт актёра в диалог (app.actor).
     * Бросок навыка с листа персонажа актёра НЕ передаёт: тогда берём открытый
     * лист актёра (если открыто несколько, то тот, что выше всех), а если листов
     * нет, то актёра, от чьего имени система напишет в чат.
     */
    function resolveActor(app) {
        if (app.actor) return app.actor;

        const sheets = Object.values(ui.windows ?? {})
            .filter(w => w?.rendered && w.actor?.documentName === "Actor")
            .sort((a, b) => (Number(b.element?.[0]?.style.zIndex) || 0) - (Number(a.element?.[0]?.style.zIndex) || 0));
        if (sheets.length) return sheets[0].actor;

        return ChatMessage.getSpeakerActor(ChatMessage.getSpeaker()) ?? null;
    }

    /**
     * FALLOUT 2d20 DIFFICULTY ENGINE: АВТОМАТИЗАЦИЯ АТАКИ, СКРЫТНОСТИ И ЭФФЕКТОВ
     */

    let lastSelectedDiff = 1;
    let lastSneakStatus = false; // Добавляем глобальную переменную для скрытности

    const rangeData = [
        { max: 1, get name() { return tr("difficulty.range.reach"); }, key: "reach", color: "#cc0000" },      
        { max: 6, get name() { return tr("difficulty.range.close"); }, key: "close", color: "#00aa00" },        
        { max: 13, get name() { return tr("difficulty.range.medium"); }, key: "medium", color: "#daa520" },      
        { max: 20, get name() { return tr("difficulty.range.long"); }, key: "long", color: "#42a5f5" },        
        { max: Infinity, get name() { return tr("difficulty.range.extreme"); }, key: "extreme", color: "#9400d3" } 
    ];

    const getRangeIndex = (r) => ({ "reach": 0, "close": 0, "medium": 1, "long": 2, "extreme": 3 }[r] ?? 0);

    // --- ФУНКЦИЯ ОПРЕДЕЛЕНИЯ АТРИБУТА ---
    function getFalloutAttribute(app, html) {
        const actor = resolveActor(app);
        if (!actor) return null;
        const title = (app.rollName || "").toLowerCase();

        if (app.item?.type === "weapon") {
            const item = app.item;
            if (item.system.weaponType === "custom") return item.system.attribute || "str";
            const skillName = CONFIG.FALLOUT.WEAPON_SKILLS[item.system.weaponType];
            const skillItem = actor.items.find(i => i.name === skillName);
            return skillItem?.system?.defaultAttribute || "str";
        }

        const skillItems = actor.items.filter(i => i.type === "skill");
        for (let skill of skillItems) {
            const skillKey = `FALLOUT.SKILL.${skill.name}`;
            const skillLabel = (game.i18n.has(skillKey) ? game.i18n.localize(skillKey) : skill.name).toLowerCase();
            if (title.includes(skillLabel)) return skill.system.defaultAttribute;
        }

        for (let [key, path] of Object.entries(CONFIG.FALLOUT.ATTRIBUTES)) {
            const localizedAttr = game.i18n.localize(path).toLowerCase();
            if (title.includes(localizedAttr)) return key;
        }

        const valInInput = parseInt(html.find('[name="attribute"]').val());
        return Object.keys(actor.system.attributes).find(k => actor.system.attributes[k].value === valInInput) || null;
    }

    // ==========================================
    // БЛОК 2: UI УВЕДОМЛЕНИЯ ПРИ ВЫБОРЕ ЦЕЛИ
    // ==========================================
    Hooks.on("targetToken", (user, token, targeted) => {
        if (game.user.id !== user.id || !targeted) return;
        const sourceToken = canvas.tokens.controlled[0];
        if (!sourceToken) return;

        const distance = window.getFalloutDistance(sourceToken, token);
        const range = rangeData.find(r => distance <= r.max);
        const defense = token.actor?.system?.defense?.value ?? 1;

        ui.notifications.info(`
            ${tr("difficulty.target", { name: token.name, defense })}<br>
            ${tr("difficulty.distance", { distance, range: `<span style="color: ${range.color}; font-weight: bold;">${range.name}</span>` })}
        `);
    });

    // ==========================================
    // БЛОК 3: ИНТЕРФЕЙС ДИАЛОГА И РАСЧЕТ СЛОЖНОСТИ
    // ==========================================
    Hooks.on("renderDialog2d20", async (app, html, data) => {
        // 1. СБРОС ФЛАГА СКРЫТНОСТИ ПРИ ОТКРЫТИИ ОКНА (Лечит баг "через раз")
        game.user.setFlag("world", "lastSneakStatus", false);

        if (html.find('[name="difficulty"]').length > 0) return;

        const actor = resolveActor(app);
        const weapon = app.object?.item || app.item;
        const isWeaponRoll = weapon?.type === "weapon"; // Проверка: это атака?const isWeaponRoll = weapon?.type === "weapon"; 

        // --- ПОИСК V.A.T.S. ЧЕРЕЗ ПРЕДМЕТ "Пип-Бой" ---
        const hasVats = actor?.items.some(i => 
            /пип-?бой|pip-?boy/i.test(i.name) && 
            (i.system.equipped === true || i.type === "miscellany") 
        ) || false;
    
        console.log(`Fallout Engine | Actor: ${actor?.name} | Pip-Boy found: ${hasVats}`);
        // ---------------------------------------
        // =========================================================
        // ПРОВЕРКА НА ВЗРЫВЧАТКУ: ПРЕРЫВАЕМ, ЕСЛИ ЗАКОНЧИЛАСЬ
        // =========================================================
        if (isWeaponRoll && weapon.system.weaponType === "explosives") {
            const qty = weapon.system.quantity || 0;
            if (qty <= 0) {
                ui.notifications.warn(tr("difficulty.explosivesEmpty", { name: weapon.name }));
                // Используем минимальный таймаут, чтобы Foundry успел отрендерить DOM перед его уничтожением
                setTimeout(() => app.close(), 10); 
                return; // Полностью прерываем дальнейшее выполнение скрипта
            }
        }
        // =========================================================
        // ПРОВЕРКА НА ВЗРЫВ И СКРЫТИЕ ОКНА
        // =========================================================
        let isBlast = false;
        if (isWeaponRoll) {
            // 1. Точная проверка на качество Взрыв (Blast)
            const blastQuality = weapon.system?.damage?.weaponQuality?.blast;
            isBlast = !!(blastQuality === true || blastQuality?.value === true || blastQuality?.value === 1);
            if (!isBlast && weapon.system?.weaponType === "explosives") {
                // Помощь в диагностике: у взрывчатки нет качества Blast в том виде, как его читает модуль
                console.warn("Fallout Automation | Взрывчатка без распознанного качества Blast:", weapon.name, weapon.system?.damage?.weaponQuality);
            }
        }

        if (isBlast && !app._blastTemplatePlaced) {
            app._blastTemplatePlaced = true; // Защита от зацикливания
            clearTargets(); // Очищаем цели, пока игрок выбирает точку взрыва
            html.closest(".window-app").hide(); // Прячем окно целиком, чтобы не ломать верстку

            const radiusCells = 3.5; 
            const distance = radiusCells * (canvas.scene.grid.distance || 1);
            const templateData = {
                t: "circle", user: game.user.id, distance: distance, direction: 0,
                x: canvas.mousePosition?.x || 0, y: canvas.mousePosition?.y || 0,
                fillColor: game.user.color || "#ff0000"
            };
        
            const doc = new CONFIG.MeasuredTemplate.documentClass(templateData, { parent: canvas.scene });
            const template = new CONFIG.MeasuredTemplate.objectClass(doc);
        
            canvas.templates.activate();
            canvas.templates.preview.addChild(template);
            await template.draw();
        
            // Событие мыши на холсте: в новых версиях Foundry оно отдаёт getLocalPosition само, в старых через event.data
            const localPosition = ev => ev.getLocalPosition ? ev.getLocalPosition(canvas.app.stage) : ev.data.getLocalPosition(canvas.app.stage);
            // PIXI-холст: в новых версиях canvas.app.canvas, в старых canvas.app.view
            const gameCanvas = () => canvas.app.canvas ?? canvas.app.view;

            const handlers = {};
            handlers.move = (event) => {
                event.stopPropagation();
                const pos = localPosition(event);
                const snapped = canvas.grid.getCenterPoint(pos); 
                template.document.updateSource({ x: snapped.x, y: snapped.y });
                template.renderFlags.set({ refreshPosition: true, refreshShape: true });
            };
        
            handlers.leftClick = async (event) => {
                if ((event.button ?? event.data?.originalEvent?.button) !== 0) return; 
                event.stopPropagation();
                cleanup();
                const pos = localPosition(event);
                const snapped = canvas.grid.getCenterPoint(pos);
                templateData.x = snapped.x; templateData.y = snapped.y;
                template.destroy();
            
                // Создаем шаблон на сцене
                const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);

                if (created.length) {
                    // Запоминаем ID шаблона в самом диалоге, чтобы потом удалить
                    html.find('.fallout-dialog').attr("data-blast-template-id", created[0].id);
                }

                // --- АВТОВЫБОР ЦЕЛЕЙ В ЗОНЕ ВЗРЫВА ---
                const radiusPx = distance * canvas.dimensions.distancePixels;
                const inBlast = targetTokensInCircle(snapped.x, snapped.y, radiusPx);
                ui.notifications.info(tr("difficulty.blastTargets", { count: inBlast.length }));

                // --- ФИКС ДЛЯ ВЗРЫВА: Авторасчет сложности до точки ---
                const shooterToken = actor?.getActiveTokens()[0] || canvas.tokens.controlled[0];
                if (shooterToken) {
                    // Создаем "фейковый" токен размером 1х1 клетку в точке взрыва
                    const fakeTarget = {
                        x: snapped.x - (canvas.grid.size / 2),
                        y: snapped.y - (canvas.grid.size / 2),
                        w: canvas.grid.size,
                        h: canvas.grid.size
                    };
                
                    // Считаем дистанцию и штраф
                    const distance = window.getFalloutDistance(shooterToken, fakeTarget);
                    const currentRange = rangeData.find(r => distance <= r.max);
                    const weaponRangeKey = weapon.system.range || "close";
                    const rPenalty = Math.abs(getRangeIndex(weaponRangeKey) - getRangeIndex(currentRange.key));
                
                    // База 2 + штраф за дальность + эффекты атакующего (Защита и Распластанность игнорируются)
                    const finalDiff = Math.max(0, 2 + rPenalty + effectDiffBonus);
                
                    // Обновляем HTML окна "на лету" перед его показом
                    const diffSelect = html.find('[name="difficulty"]');
                    diffSelect.val(finalDiff);
                    diffSelect.attr('data-base-diff', finalDiff); // Запоминаем базу для скрытности
                
                    html.find('.fa-bd').data("bd", {
                        base: [{ label: tr("difficulty.bd.blast"), value: 2 }],
                        mods: [
                            { label: tr("difficulty.bd.range"), value: rPenalty },
                            { label: tr("difficulty.bd.effects"), value: effectDiffBonus }
                        ],
                        vats: true,
                        attr: attrKey ? attrKey.toUpperCase() : ""
                    });
                    renderBreakdown(html);
                }
                // ------------------------------------------------------
            
                restoreWindow();
            };
        
            handlers.rightClick = (event) => {
                event.preventDefault();
                cleanup();
                template.destroy();
    
                // 1. Если на сцене уже был создан документ шаблона (а не просто превью)
                const existingTemplateId = html.find('.fallout-dialog').attr("data-blast-template-id");
                if (existingTemplateId) {
                    canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [existingTemplateId]);
                    html.find('.fallout-dialog').removeAttr("data-blast-template-id");
                }
                // 2. Вместо restoreWindow() делаем только "уборку" интерфейса:
                    canvas.tokens.activate(); // Возвращаем слой токенов
                    const attackerToken = actor?.getActiveTokens()[0];
                    if (attackerToken) attackerToken.control({releaseOthers: true}); // Выделяем атакующего
    
                app.close();
            };

            const cleanup = () => {
                canvas.stage.off("mousemove", handlers.move);
                canvas.stage.off("mousedown", handlers.leftClick);
                gameCanvas().oncontextmenu = null;
            };

           // Функция восстановления интерфейса
            const restoreWindow = () => {
                canvas.tokens.activate(); // 4. Возвращаем слой токенов
            
                // ФИКС №3: Принудительно выделяем токен атакующего
                const attackerToken = actor?.getActiveTokens()[0];
                if (attackerToken) attackerToken.control({releaseOthers: true});

                html.closest(".window-app").show(); // Показываем окно обратно
                app.setPosition({ height: "auto" }); // 2. Нормализуем высоту окна
            };

            canvas.stage.on("mousemove", handlers.move);
            canvas.stage.on("mousedown", handlers.leftClick);
            gameCanvas().oncontextmenu = handlers.rightClick;

                    app.options.close = () => {
                        const templateId = html.find('.fallout-dialog').attr("data-blast-template-id");
                        if (templateId) {
                            canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
                        }
                        cleanup(); // На всякий случай снимаем слушатели мыши
                    };
        }
        // =========================================================
        const targets = Array.from(game.user.targets);
    
        // ОПРЕДЕЛЯЕМ АТРИБУТ И БОНУС ЭФФЕКТОВ
        const attrKey = getFalloutAttribute(app, html);
        // === ДОБАВИТЬ В ЗАГОЛОВОК НАВЫК + АТРИБУТ ===
        if (attrKey && app.rollName && !app.rollName.includes("[")) {
            const attrLabel = game.i18n.localize(CONFIG.FALLOUT.ATTRIBUTES[attrKey]);
            app.rollName = `${app.rollName} [${attrLabel}]`;
            html.closest(".app").find(".window-title").text(app.rollName);
        }

        // --- НОВОЕ: РАСЧЕТ БОНУСОВ (АТРИБУТ + НАВЫК) ---
        let effectDiffBonus = 0;
        let effectKeys = [];
    
        // 1. Добавляем ключ атрибута (как было: per, str, agi)
        if (attrKey) effectKeys.push(`system.difficulty.${attrKey.toLowerCase().substring(0, 3)}.bonus`);
    
        // 2. Ищем название навыка
        let skillNameForEffect = null;
        const title = (app.rollName || "").toLowerCase();
    
        if (isWeaponRoll) {
            skillNameForEffect = weapon.system.weaponType === "custom" ? weapon.system.skill : CONFIG.FALLOUT.WEAPON_SKILLS[weapon.system.weaponType];
        } else {
            const skillItem = actor?.items.find(i => i.type === "skill" && title.includes((game.i18n.has(`FALLOUT.SKILL.${i.name}`) ? game.i18n.localize(`FALLOUT.SKILL.${i.name}`) : i.name).toLowerCase()));
            if (skillItem) skillNameForEffect = skillItem.name;
        }
    
        // 3. Формируем ключ навыка
        if (skillNameForEffect) {
            // Убираем пробелы, делаем строчными (например "Small Guns" -> "smallguns", "Repair" -> "repair")
            const formattedSkillKey = skillNameForEffect.toLowerCase().replace(/\s+/g, '');
            effectKeys.push(`system.difficulty.${formattedSkillKey}.bonus`);
        }

        // 4. Суммируем все найденные эффекты (если есть бафф и на Восприятие, и на Ремонт — они сложатся)
        actor?.effects.filter(e => !e.disabled).forEach(eff => {
            eff.changes.forEach(c => {
                if (effectKeys.includes(c.key)) effectDiffBonus += parseInt(c.value) || 0;
            });
        });
        // ----------------------------------------------

        let diffHtml = "";
        let autoDiff = 1;
        let bd = null; // данные для строки разбора сложности (только для оружия)
    
        // ============================
        // ВАРИАНТ А: ОРУЖИЕ (Старый вид)
        // ============================
        if (isWeaponRoll) {
            bd = { base: [], mods: [], vats: hasVats, attr: attrKey ? attrKey.toUpperCase() : "" };
            let meleeWarning = "";
            let rangePenalty = 0;
            let proneMod = 0;
            let targetDefense = 0;

            // Расчет дистанции и защиты
            if (isBlast) {
                autoDiff = Math.max(0, 2 + effectDiffBonus);
                bd.base.push({ label: tr("difficulty.bd.blast"), value: 2 });
                bd.mods.push({ label: tr("difficulty.bd.effects"), value: effectDiffBonus });
                bd.note = tr("difficulty.blastPending");
                bd.vats = true;
            } else if (targets.length > 0) {
                const target = targets[0];
                const shooterToken = actor?.getActiveTokens()[0] || canvas.tokens.controlled[0];
            
                if (shooterToken) {
                    targetDefense = target.actor?.system?.defense?.value ?? 1;
                    const distance = window.getFalloutDistance(shooterToken, target);
                    const currentRange = rangeData.find(r => distance <= r.max);
                    const isMelee = ["meleeWeapons", "unarmed"].includes(weapon?.system?.weaponType);
                
                    // Распластанность
                    const isProne = fx.isProne(target.actor);
                    proneMod = isProne ? (["reach", "close"].includes(currentRange.key) ? -1 : 1) : 0;
                
                    // Дистанция
                    const weaponRangeKey = weapon.system.range || "close";
                    const hasCQ = weapon.system.damage?.weaponQuality?.close_quarters?.value || weapon.system.damage?.weaponQuality?.closeQuarters?.value;
                    const hasCloseQuarters = hasCQ === 1 || hasCQ === true;
                
                    rangePenalty = Math.abs(getRangeIndex(weaponRangeKey) - getRangeIndex(currentRange.key));
                
                    if (currentRange.key === "reach" && !isMelee && !hasCloseQuarters) {
                        rangePenalty += 2;
                        meleeWarning = `<div class="fa-dialog-note fa-warn" style="margin: 4px 0 0;">${tr("difficulty.pointBlank")}</div>`;
                    } else if (isMelee && distance > 1) {
                        meleeWarning = `<div class="fa-dialog-note fa-warn" style="margin: 4px 0 0;">${tr("difficulty.outOfMelee")}</div>`;
                    }

                    bd.base.push({ label: tr("difficulty.bd.defense"), value: targetDefense });
                    bd.mods.push(
                        { label: tr("difficulty.bd.range"), value: rangePenalty },
                        { label: tr("difficulty.bd.prone"), value: proneMod },
                        { label: tr("difficulty.bd.effects"), value: effectDiffBonus }
                    );
                }
            } else {
                autoDiff = Math.max(0, 1 + effectDiffBonus);
                bd.base.push({ label: tr("difficulty.bd.base"), value: 1 });
                bd.mods.push({ label: tr("difficulty.bd.effects"), value: effectDiffBonus });
            }

            // Итоговая сложность для оружия
            if (isBlast) {
                autoDiff = Math.max(0, 2 + effectDiffBonus);
            } else if (targets.length > 0) {
                autoDiff = Math.max(0, targetDefense + rangePenalty + proneMod + effectDiffBonus);
            }

            let options = "";
            for (let i = 0; i <= 10; i++) options += `<option value="${i}" ${i === autoDiff ? 'selected' : ''}>${i}</option>`;
            // --- ГЕНЕРАЦИЯ СПИСКА ЗОН ПОРАЖЕНИЯ ---
            let hitLocationHtml = "";

            if (isBlast) {
                // ТОЧЕЧНЫЙ ФИКС: Скрываем выбор зоны для взрыва и НЕ пытаемся генерировать список
                hitLocationHtml = `<input type="hidden" name="hit-location" value="random">`;
            } else {
                let targetActor = targets.length > 0 ? targets[0].actor : null;
                let bodyType = targetActor?.system?.bodyType ? targetActor.system.bodyType : "humanoid";
            
                // Если такого bodyType нет в базе HIT_LOCATIONS:
                if (!window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS[bodyType]) {
                    // Для транспорта фолбэк на apc, для всех остальных на humanoid
                    bodyType = (targetActor?.type === "vehicle" && window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS["apc"]) ? "apc" : "humanoid";
                }
            
                let hitLocOptions = `<option value="random">${tr("difficulty.random")}</option>`;
                for (let part of Object.keys(window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS[bodyType])) {
                    // ИСПОЛЬЗУЕМ НОВУЮ ФУНКЦИЮ ИЗ БИБЛИОТЕКИ:
                    let partLabel = window.FALLOUT_CUSTOM_LIBRARY.getPartLabel(targetActor, part);
                    hitLocOptions += `<option value="${part}">${partLabel}</option>`;
                }

                hitLocationHtml = `<div class="flexrow resource" style="padding: 2px 5px; align-items: center;">
                    <label style="flex: 0 0 40%; font-weight: bold; font-size: 0.9em;">${tr("difficulty.hitZone")}</label>
                    <select name="hit-location" style="flex: 1; height: 24px;">${hitLocOptions}</select>
                   </div>`;
            }

            let vatsBadge = hasVats ? `<div class="fa-dialog-note">${tr("difficulty.vatsActive")}</div>` : "";

            diffHtml = `
                <div class="flexrow resource" style="padding: 5px; border-top: 1px solid #7a7971; align-items: center;">
                    <label style="flex: 0 0 25%; font-weight: bold;">${tr("difficulty.difficulty")}</label>
                    <select name="difficulty" class="d-number" data-base-diff="${autoDiff}" data-specific-aim="false" style="flex: 0 0 15%; height: 24px;">${options}</select>
                    <div style="flex: 1; display: flex; justify-content: flex-end; align-items: center; gap: 5px;">
                        <label style="font-size: 0.9em; cursor: pointer;">${tr("difficulty.sneakAttack")}</label>
                        <input type="checkbox" name="sneak-attack" style="width: 16px; height: 16px; margin: 0; cursor: pointer;">
                    </div>
                </div>
                ${vatsBadge}
                ${hitLocationHtml}
                <div id="range-info-row" style="padding: 2px 5px 5px 5px; color: #444;">
                    <div class="fa-bd" style="overflow: hidden;"></div>
                    ${meleeWarning}
                </div>`;
        } 
    
        // ============================
        // ВАРИАНТ Б: НАВЫКИ (Новый вид: ГМ + Итоговая)
        // ============================
        else {
            // Читаем сложность из макроса (если есть), иначе ставим базу 1
            let baseDiff = window.tempVehicleDiff !== undefined ? window.tempVehicleDiff : 1;
            delete window.tempVehicleDiff; // Съели и удалили, чтобы не влияло на другие броски

            let dynamicMod = effectDiffBonus; 
        
            const createOptions = (selected) => {
                let opt = "";
                for (let i = 0; i <= 10; i++) opt += `<option value="${i}" ${i === selected ? 'selected' : ''}>${i}</option>`;
                return opt;
            };

            // Дропдауны: База (ГМ) и Итоговая (База + Эффекты)
            diffHtml = `
                <div class="flexrow resource" style="padding: 5px; border-top: 1px solid #7a7971; align-items: center; gap: 5px;">
                    <label style="flex: 0 0 20%; font-weight: bold; font-size: 0.85em;">${tr("difficulty.baseGM")}</label>
                    <select name="gm-base-diff" style="flex: 0 0 15%; height: 24px;">${createOptions(baseDiff)}</select>
                
                    <label style="flex: 0 0 25%; font-weight: bold; text-align: right; font-size: 0.85em;">${tr("difficulty.finalDiff")}</label>
                    <select name="difficulty" class="d-number" style="flex: 0 0 15%; height: 24px; background: #fffde7;">${createOptions(Math.max(0, baseDiff + dynamicMod))}</select>
                    <div style="flex: 1;"></div>
                </div>
                <div style="padding: 2px 5px 5px 5px; font-size: 0.75em; color: #444; font-style: italic; text-align: right;">
                    ${tr("difficulty.modifiers", { value: `${effectDiffBonus > 0 ? '+' : ''}${effectDiffBonus}` })} ${attrKey ? `[${attrKey.toUpperCase()}]` : ""}
                </div>`;
        }

        // Вставка HTML
        const dialogElem = html.find(".fallout-dialog");
        if (dialogElem.length) {
            dialogElem.append(diffHtml);
            if (bd) {
                html.find(".fa-bd").data("bd", bd);
                renderBreakdown(html);
                // Зона поражения и скрытная атака меняют строку разбора
                html.find('[name="hit-location"], [name="sneak-attack"]').on("change", () => renderBreakdown(html));
            }
            if (window.tempActionId) {
                // Добавляем ID прямо в атрибут формы, так надежнее
                dialogElem.attr("data-action-id", window.tempActionId);
            }
            if (isWeaponRoll && weapon.system.weaponType === "explosives") {
                dialogElem.attr("data-explosive-id", weapon.id);
            }
            app.setPosition({ height: "auto" });
        }

        // ЛОГИКА ОБРАБОТЧИКОВ (Разная для оружия и навыков)
        if (isWeaponRoll) {
            const diffSelect = html.find('[name="difficulty"]');
        
            // Отслеживаем ручное изменение сложности, чтобы не сломать логику галочки
            diffSelect.on('change', (ev) => {
                const isSneak = html.find('[name="sneak-attack"]').is(':checked');
                let manualVal = parseInt(ev.currentTarget.value);
                // Если включен сник, то реальная база на 1 больше
                diffSelect.attr('data-base-diff', isSneak ? manualVal + 1 : manualVal);
            });

            // Логика прицельной атаки (зона поражения)
            html.find('[name="hit-location"]').on('change', (ev) => {
                const isSpecific = ev.currentTarget.value !== "random";
                const wasSpecific = diffSelect.attr('data-specific-aim') === "true";
            
                if (isSpecific && !wasSpecific) {
                    // Включили прицеливание
                    diffSelect.attr('data-specific-aim', "true");
                    if (!hasVats) { // Штраф применяется только если НЕТ V.A.T.S.
                        diffSelect.val(Math.min(10, parseInt(diffSelect.val()) + 1));
                        diffSelect.attr('data-base-diff', parseInt(diffSelect.attr('data-base-diff')) + 1);
                    }
                } else if (!isSpecific && wasSpecific) {
                    // Выключили прицеливание
                    diffSelect.attr('data-specific-aim', "false");
                    if (!hasVats) { // Штраф откатывается только если НЕТ V.A.T.S.
                        diffSelect.val(Math.max(0, parseInt(diffSelect.val()) - 1));
                        diffSelect.attr('data-base-diff', Math.max(0, parseInt(diffSelect.attr('data-base-diff')) - 1));
                    }
                }
            });

            // Логика чекбокса
            html.find('[name="sneak-attack"]').on('change', (ev) => {
                const isChecked = ev.currentTarget.checked;
                // Берем "чистую" базу, которую запомнили
                const baseVal = parseInt(diffSelect.attr('data-base-diff'));
            
                if (isChecked) {
                    diffSelect.val(Math.max(0, baseVal - 1));
                } else {
                    diffSelect.val(baseVal); // Возвращаем четко то, что было
                }
            });
        } else {
            // Для навыков: Обновление при смене Базы ГМ
            html.find('[name="gm-base-diff"]').on('change', () => {
                const base = parseInt(html.find('[name="gm-base-diff"]').val()) || 0;
                // effectDiffBonus мы вычислили выше, но он внутри замыкания, так что доступен
                const final = Math.max(0, base + effectDiffBonus);
                html.find('[name="difficulty"]').val(final);
            });
        }

   
    });

    // ==========================================
    // БЛОК 4: ГАРАНТИРОВАННЫЙ ПЕРЕХВАТ ДАННЫХ
    // ==========================================
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
        const roll = message.flags?.falloutroll;
        if (!roll || roll.diceFace === "d6") return;

        const dialogHtml = $(`.fallout-dialog`);
        if (dialogHtml.length === 0) return;

        // --- УДАЛЕНИЕ ШАБЛОНА ВЗРЫВА ---
        const blastTemplateId = dialogHtml.attr("data-blast-template-id");
        if (blastTemplateId) {
            // Удаляем не мгновенно, а через 500-1000мс. 
            // Этого хватит, чтобы Sequencer подхватил шаблон, 
            // но визуально он исчезнет почти сразу после начала анимации.
            setTimeout(() => {
                canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [blastTemplateId]);
            }, 800); 
            dialogHtml.removeAttr("data-blast-template-id");
        }
        // ------------------------------------------

        // 1. Читаем ID
        const actionId = dialogHtml.attr("data-action-id");
        let explosiveId = dialogHtml.attr("data-explosive-id");

        // 2. КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Удаляем ID из HTML сразу после чтения!
        dialogHtml.removeAttr("data-action-id");
        dialogHtml.removeAttr("data-explosive-id");

        let currentDiff = parseInt(dialogHtml.find('[name="difficulty"]').val());
        let isSneak = dialogHtml.find('[name="sneak-attack"]').is(':checked');
    
        // ФИКС 1: Сначала ищем актера именно на выделенном токене, а только потом в мире.
        // ChatMessage.getSpeakerActor делает это встроенными и самыми надежными средствами Foundry.
        const actor = ChatMessage.getSpeakerActor(message.speaker);

        // ФИКС 2: Перехватываем переброс (re-roll), чтобы подтянуть старую сложность
        const isReroll = roll.rollname && roll.rollname.includes("re-roll");
        if (isReroll) {
            explosiveId = null; // Гарантированно блокируем повторное списание гранаты при перебросе
        
            // Ищем последнее сообщение этого же игрока с нормальной сложностью
            const lastRollMsg = game.messages.contents.reverse().find(m => 
                m.isAuthor && 
                m.getFlag("world", "fallout-difficulty") !== undefined && 
                m.getFlag("world", "fallout-difficulty") !== null
            );
        
            if (lastRollMsg) {
                currentDiff = lastRollMsg.getFlag("world", "fallout-difficulty");
                isSneak = lastRollMsg.getFlag("world", "fallout-sneak");
            }
        }

        // Финальная защита от записи null (если окно сломано, всегда будет минимум 1)
        if (isNaN(currentDiff)) currentDiff = 1;

        // =========================================================
        // СПИСАНИЕ ВЗРЫВЧАТКИ
        // =========================================================
        if (explosiveId && actor) {
            const explosiveItem = actor.items.get(explosiveId);
            if (explosiveItem) {
                const currentQty = explosiveItem.system.quantity || 0;
                const newQty = Math.max(0, currentQty - 1); // Защита от отрицательных чисел
            
                // Обновляем количество в листе персонажа
                explosiveItem.update({ "system.quantity": newQty });
            
                if (newQty === 0) {
                    ui.notifications.warn(tr("difficulty.explosivesSpent", { name: explosiveItem.name }));
                }
            }
        }

        // Чистим глобалку (на всякий случай)
        delete window.tempActionId;

        let updates = { 
            "flags.world.fallout-difficulty": currentDiff, 
            "flags.world.fallout-sneak": isSneak,
            "flags.world.fallout-ap-type": (!actor?.hasPlayerOwner) ? "gmAP" : "partyAP"
        };

        // --- ПЕРЕХВАТ ЗОНЫ ПОРАЖЕНИЯ (Fix для APC и Рандома) ---
        const selectedLocation = dialogHtml.find('[name="hit-location"]').val();
        const targets = Array.from(game.user.targets);
        let targetActor = targets.length > 0 ? targets[0].actor : null;
        let bodyType = targetActor?.system?.bodyType ? targetActor.system.bodyType : "humanoid";
    
        // Синхронизируем фолбэк с окном броска
        if (!window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS[bodyType]) {
            bodyType = (targetActor?.type === "vehicle" && window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS["apc"]) ? "apc" : "humanoid";
        }
    
        const table = window.FALLOUT_CUSTOM_LIBRARY.HIT_LOCATIONS[bodyType];
        let finalKey = selectedLocation;

        // Если рандом — вычисляем ключ по числу d20 из библиотеки
        if (selectedLocation === "random") {
            const res = roll.hitLocationResult;
            finalKey = Object.keys(table).find(k => res >= table[k][0] && res <= table[k][1]);
        }

        if (finalKey) {
            updates["flags.falloutroll.hitLocation"] = finalKey;
            // Если выбирали вручную — подсовываем первое число из диапазона для Damage Engine
            if (selectedLocation !== "random") {
                updates["flags.falloutroll.hitLocationResult"] = table[finalKey][0];
            }
        }

        // Записываем ID только если он реально был в окне в этот момент
        if (actionId) {
            updates["flags.world.fallout-action-id"] = actionId;
        }

        message.updateSource(updates);
    });

    onChatRender((message, html, data) => {
        const diff = message.getFlag("world", "fallout-difficulty");
        const isSneak = message.getFlag("world", "fallout-sneak");
        const rollData = message.flags?.falloutroll;
        if (diff === undefined || !rollData?.dicesRolled) return;
        // === ВИЗУАЛЬНАЯ ПОДМЕНА ЗОНЫ (Прицельная и Рандом) ===
        const hitLabelElem = html.find(".hit-location-label");
        let locKey = rollData.hitLocation; 
    
        if (locKey) {
            // Пытаемся взять таргет, если он еще выделен, иначе берем актера-стрелка как фолбэк
            const currentTarget = Array.from(game.user.targets)[0]?.actor;
            const shooterActor = ChatMessage.getSpeakerActor(message.speaker);
            const actorToUse = currentTarget || shooterActor || null;

            // ИСПОЛЬЗУЕМ НОВУЮ ФУНКЦИЮ ИЗ БИБЛИОТЕКИ:
            const partName = window.FALLOUT_CUSTOM_LIBRARY.getPartLabel(actorToUse, locKey);

            const hitLabel = tr("difficulty.hitLocationLabel");
            // Подпись области попадания в карточке принадлежит системе и зависит от её языка
            const labelHints = ["Область", "Hit Location", hitLabel.replace(/:\s*$/, "")];
            hitLabelElem.each(function() {
                const text = $(this).text();
                if (labelHints.some(h => text.includes(h))) {
                    $(this).html(`<strong>${hitLabel}</strong> ${partName}`);
                }
            });
        }

        const successes = rollData.dicesRolled.reduce((total, d) => total + (d.success || 0), 0);
        const isSuccess = successes >= diff;
    
        // Вердикт в терминальном стиле: УСПЕХ / ПРОВАЛ, сложность и успехи, плашка скрытной атаки
        const sneakHtml = isSneak
            ? `<div class="fa-alert" style="text-align: left;">${esc(tr("difficulty.sneakTitle"))}<span class="fa-note">${esc(tr("difficulty.sneakText"))}</span></div>`
            : "";

        let verdictHtml = `<div class="difficulty-verdict fa-term fa-verdict">
            <div class="fa-result ${isSuccess ? "fa-ok" : "fa-fail"}">${isSuccess ? tr("difficulty.success") : tr("difficulty.fail")}</div>
            <div class="fa-note">${tr("difficulty.verdictDetail", { diff, successes })}</div>
            ${sneakHtml}
        `;

        const apType = message.getFlag("world", "fallout-ap-type") || "partyAP";
        const apGain = successes - diff;
        if (isSuccess && apGain > 0 && (apType !== "gmAP" || game.user.isGM)) {
            const isUsed = message.getFlag("world", "ap-added");
            const label = apType === "gmAP" ? tr("difficulty.apGM", { gain: apGain }) : tr("difficulty.apParty", { gain: apGain });
            verdictHtml += `<div class="fa-controls" style="justify-content: center;"><button class="add-party-ap fa-btn" ${isUsed ? "disabled" : ""} data-ap="${apGain}" data-type="${apType}"><i class="fas fa-plus"></i> ${isUsed ? tr("difficulty.apAdded") : label}</button></div>`;
        }
        verdictHtml += `</div>`;

        const target = html.find(".content");
        if (target.length && !html.find(".difficulty-verdict").length) {
            target.append(verdictHtml);
            html.find(".add-party-ap").click(async (ev) => {
                if (message.getFlag("world", "ap-added")) return;
                const { type, ap } = ev.currentTarget.dataset;
                try {
                    await addAP(type, parseInt(ap));
                    await message.setFlag("world", "ap-added", true);
                } catch (err) {
                    console.error("Fallout Automation | Не удалось добавить ОД:", err);
                    ui.notifications.error(tr("difficulty.apFailed"));
                }
            });
        }
    });
}
