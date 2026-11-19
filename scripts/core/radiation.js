// ==========================================================
// Облучение (бывший мировой макрос «Radiation_for_NPCs»).
// Когда у любого актёра меняется system.radiation:
//   - радиация больше 0: актёру накладывается эффект «Облучение N» (берётся из Convenient Effects,
//     если он там есть, иначе встроенный), который уменьшает максимум ОЗ на N;
//     текущие ОЗ при этом урезаются до нового максимума;
//   - радиация упала до 0: эффект снимается.
// Эффект узнаётся по флагу flags.world.isRadiationEffect (его ставил старый макрос),
// по флагу модуля или по имени «Облучение» / «Radiation».
//
// Кроме того, в листы NPC и существ (creature) добавляется поле «Радиация»: в системе оно есть
// только у персонажей, а без него радиацию NPC можно менять лишь макросом. Поле пишет в
// system.radiation, а дальше работает тот же хук, что описан выше.
// ==========================================================
import { findEffects, applyEffect, effectName } from "./effects.js";

/**
 * Поле радиации в листе NPC / creature. Верхняя строка листа: ОЗ и радиация (по половине ширины),
 * инициатива и защита переносятся на следующую строку и растягиваются на всю ширину.
 */
function addRadiationField(app, html) {
    const actor = app.actor;
    if (!actor || !["npc", "creature"].includes(actor.type)) return;
    if (html.find(".fa-npc-radiation").length) return;

    const hpRow = html.find('[name="system.health.value"]').first().closest(".resource-row");
    if (!hpRow.length) return;

    const label = game.i18n.localize("FALLOUT.TEMPLATES.RADIATION");
    const value = Number(actor.system.radiation) || 0;
    const disabled = app.isEditable ? "" : "disabled";
    const radiationBox = $(`
        <div class="box no-padding bgEven fa-npc-radiation">
            <h4 class="box-header text-center"><i class="fo-radiation"></i> ${label}</h4>
            <div class="text-center">
                <input class="num-short-2" type="number" min="0" name="system.radiation" data-dtype="Number" value="${value}" ${disabled}>
            </div>
        </div>`);

    // Всё, кроме блока ОЗ (инициатива, защита), уходит во вторую строку. Узлы переносятся целиком,
    // поэтому кнопки и обработчики на них продолжают работать.
    const hpBox = hpRow.children().filter((i, el) => $(el).find('[name="system.health.value"]').length).first();
    const others = hpRow.children().not(hpBox);

    // Блок ОЗ стал шире: «10 / 15» собираем в центре, а не растягиваем по краям (стили в fallout-automation.css)
    hpBox.children(".flexrow").addClass("fa-hp-compact");

    hpRow.append(radiationBox);
    if (others.length) hpRow.after($('<div class="flexrow resource-row"></div>').append(others));
}

export function register() {
    // Поле радиации в листах NPC и существ (creature наследует лист NPC, поэтому хук один)
    Hooks.on("renderFalloutNpcSheet", addRadiationField);

    Hooks.on("updateActor", async (actor, changes, options, userId) => {
        // Чтобы код не выполнялся у каждого игрока одновременно
        if (game.user.id !== userId) return;

        const radValue = foundry.utils.getProperty(changes, "system.radiation");
        if (radValue === undefined) return;

        let existingEffect = findEffects(actor, "radiation")[0];

        if (radValue > 0) {
            // 1. Добавляем эффект (из CE или встроенный), если его ещё нет
            if (!existingEffect) {
                [existingEffect] = await applyEffect(actor, "radiation");
                if (!existingEffect) return console.warn("fallout-automation | Не удалось добавить эффект облучения");
            }

            // 2. Редактируем эффект «на лету»
            await existingEffect.update({
                name: `${effectName("radiation")} ${radValue}`,
                changes: [{
                    key: "system.health.max",
                    mode: 2, // ADD
                    value: `-${radValue}`
                }],
                flags: {
                    world: { isRadiationEffect: true } // Флаг, чтобы не потерять эффект после переименования
                }
            });

            // 3. Текущие ОЗ не выше нового максимума (максимум уже пересчитан с учётом всех бонусов и штрафов)
            const currentHp = actor.system.health?.value || 0;
            const finalMaxHp = actor.system.health?.max || 0;
            if (currentHp > finalMaxHp) {
                await actor.update({ "system.health.value": finalMaxHp });
                console.log(`fallout-automation | Текущие ОЗ урезаны до нового максимума (${finalMaxHp})`);
            }
        } else if (existingEffect) {
            // 4. Радиацию вылечили до 0: удаляем эффект
            await existingEffect.delete();
            console.log("fallout-automation | Радиация вылечена, эффект облучения снят");
        }
    });
}
