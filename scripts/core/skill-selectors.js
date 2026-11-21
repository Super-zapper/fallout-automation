// ==========================================================
// Выбор навыка и атрибута прямо в окне броска навыка (Dialog2d20).
// Раньше для проверок было два окна: свой диалог макроса (навык, атрибут, сложность) и потом окно
// системы с теми же числами. Теперь окно одно: сверху две строки выбора, цифры, кубы, сложность.
// При смене навыка или атрибута числа в окне, название броска и сложность обновляются на лету.
//
// Модель данных бывает двух видов:
//  - персонаж / NPC / робот: атрибуты system.attributes, навыки это предметы типа skill;
//  - существо (creature): атрибуты Тело / Разум и три «навыка»: ближний бой, дальний бой, другое.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc } from "../utils/html.js";

// Цвета взяты из прежнего макроса «Проверка Навыка»: текст и свечение для каждого атрибута.
export const ATTR_COLORS = {
    str:  { color: "#ff4d4d", shadow: "#ff0000" },
    per:  { color: "#ffffff", shadow: "#adebff" },
    end:  { color: "#ffb642", shadow: "#ff8000" },
    cha:  { color: "#ff4df2", shadow: "#ff00ff" },
    int:  { color: "#4db8ff", shadow: "#0066ff" },
    agi:  { color: "#18ff62", shadow: "#00ff00" },
    luc:  { color: "#ffff4d", shadow: "#ffff00" },
    body: { color: "#ff4d4d", shadow: "#ff0000" },
    mind: { color: "#4db8ff", shadow: "#0066ff" }
};
const DEFAULT_COLOR = { color: "#18ff62", shadow: "#00ff00" };
const ATTR_ORDER = ["str", "per", "end", "cha", "int", "agi", "luc", "body", "mind"];

const colorOf = key => ATTR_COLORS[key] ?? DEFAULT_COLOR;

// ---------- Модель: какие атрибуты и навыки есть у актёра ----------

/**
 * Возвращает { kind, attributes: [{key, label, value}], skills: [{id, label, attr, value, tag, name}] }
 * или null, если для этого типа актёра выбор не поддерживается.
 * skill.name это имя предмета (английское, как в системе): из него строится ключ эффекта сложности.
 */
export function getSkillModel(actor) {
    if (!actor) return null;

    if (actor.type === "creature") {
        const attributes = ["body", "mind"].map(key => ({
            key, label: t(`skillSelect.creature.${key}`), value: Number(foundry.utils.getProperty(actor, `system.${key}.value`)) || 0
        }));
        const skills = [
            { id: "melee", attr: "body" },
            { id: "guns",  attr: "body" },
            { id: "other", attr: "mind" }
        ].map(s => ({
            ...s, label: t(`skillSelect.creature.${s.id}`), name: "",
            value: Number(foundry.utils.getProperty(actor, `system.${s.id}.value`)) || 0, tag: false
        }));
        // У существ есть «Другое», отдельного пункта «без навыка» не нужно
        return { kind: "creature", attributes, skills };
    }

    const stats = actor.system?.attributes;
    if (!stats) return null;

    const attributes = Object.keys(CONFIG.FALLOUT.ATTRIBUTES)
        .filter(key => stats[key])
        .map(key => ({ key, label: game.i18n.localize(CONFIG.FALLOUT.ATTRIBUTES[key]), value: Number(stats[key].value) || 0 }));

    const skills = actor.items
        .filter(i => i.type === "skill")
        .map(i => {
            const locKey = `FALLOUT.SKILL.${i.name}`;
            return {
                id: i.id,
                name: i.name,
                label: game.i18n.has(locKey) ? game.i18n.localize(locKey) : i.name,
                attr: i.system?.defaultAttribute || "str",
                value: Number(i.system?.value) || 0,
                tag: !!i.system?.tag
            };
        })
        .sort((a, b) => (ATTR_ORDER.indexOf(a.attr) - ATTR_ORDER.indexOf(b.attr)) || a.label.localeCompare(b.label));

    skills.push(noneSkill("luc"));
    return { kind: "character", attributes, skills };
}

/** Пункт «без навыка»: проверка одним атрибутом (по умолчанию Удача). */
function noneSkill(attr) {
    return { id: "", name: "", label: t("skillSelect.none"), attr, value: 0, tag: false };
}

// ---------- Бонус сложности от активных эффектов ----------

/** Сумма бонусов system.difficulty.<атрибут>.bonus и system.difficulty.<навык>.bonus с активных эффектов актёра. */
export function difficultyBonus(actor, attrKey, skillName) {
    const keys = [];
    if (attrKey) keys.push(`system.difficulty.${attrKey.toLowerCase().substring(0, 3)}.bonus`);
    if (skillName) keys.push(`system.difficulty.${skillName.toLowerCase().replace(/\s+/g, "")}.bonus`);

    let total = 0;
    actor?.effects.filter(e => !e.disabled).forEach(eff => {
        eff.changes.forEach(c => { if (keys.includes(c.key)) total += parseInt(c.value) || 0; });
    });
    return total;
}

// ---------- Окно: строки выбора ----------

function optionHtml(value, label, attr, selected) {
    const c = colorOf(attr);
    return `<option value="${esc(value)}" data-attr="${esc(attr)}" style="color: ${c.color}; background: #000;"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

function paintSelect(select, attrKey) {
    const c = colorOf(attrKey);
    select.css({ color: c.color, "border-color": c.color, "box-shadow": `0 0 6px ${c.shadow}` });
}

/**
 * Добавляет в окно броска строки выбора навыка и атрибута и вешает обновление цифр.
 *
 *  app, html     окно Dialog2d20
 *  actor         актёр, который бросает
 *  skillItem     предмет-навык, определённый по названию броска (бросок с листа персонажа), или null
 *  attrKey       атрибут, определённый для этого броска, или null
 *  forced        { skillId, attrKey } от нашей точки входа (кнопка «Проверка», runFalloutCheck) или null
 *  onChange      колбэк ({ skill, attr }), в нём пересчитывается сложность
 *
 * Возвращает true, если строки добавлены. Для бросков, где навык определить нельзя (чистая проверка
 * атрибута, инициатива и т. п.), ничего не добавляется, и окно остаётся как в системе.
 */
export function setupSkillSelectors({ app, html, actor, skillItem = null, attrKey = null, forced = null, onChange = () => {} }) {
    const model = getSkillModel(actor);
    if (!model) return false;
    if (!forced && !skillItem) return false;

    const dialog = html.find(".fallout-dialog");
    if (!dialog.length || dialog.find(".fa-skillsel").length) return false;

    const startSkill = model.skills.find(s => s.id === (forced ? forced.skillId : skillItem.id)) ?? model.skills.at(-1);
    const startAttr = forced?.attrKey ?? attrKey ?? startSkill.attr;

    const skillOptions = model.skills.map(s => optionHtml(s.id, s.label, s.attr, s === startSkill)).join("");
    const attrOptions = model.attributes.map(a => optionHtml(a.key, a.label, a.key, a.key === startAttr)).join("");

    dialog.prepend(`
        <div class="fa-skillsel">
            <div class="fa-sel">
                <label>${esc(t("skillSelect.skill"))}</label>
                <select name="fa-skill">${skillOptions}</select>
            </div>
            <div class="fa-sel">
                <label>${esc(t("skillSelect.attr"))}</label>
                <select name="fa-attr">${attrOptions}</select>
            </div>
        </div>`);

    const skillSel = html.find('[name="fa-skill"]');
    const attrSel = html.find('[name="fa-attr"]');
    paintSelect(skillSel, startSkill.attr);
    paintSelect(attrSel, startAttr);

    // Применить выбор к числам, названию броска и сложности
    const apply = () => {
        const skill = model.skills.find(s => s.id === skillSel.val()) ?? startSkill;
        const attr = model.attributes.find(a => a.key === attrSel.val()) ?? model.attributes[0];

        html.find('[name="attribute"]').val(attr.value);
        html.find('[name="skill"]').val(skill.value);
        html.find('[name="tag"]').prop("checked", skill.tag);

        app.rollName = t("skillCheck.rollName", { skill: skill.label, attr: attr.label });
        html.closest(".app").find(".window-title").text(app.rollName);

        paintSelect(skillSel, skill.attr);
        paintSelect(attrSel, attr.key);
        onChange({ skill, attr });
    };

    // Смена навыка переключает атрибут на «родной» для этого навыка; потом атрибут можно переопределить
    skillSel.on("change", () => {
        const skill = model.skills.find(s => s.id === skillSel.val());
        if (skill && model.attributes.some(a => a.key === skill.attr)) attrSel.val(skill.attr);
        apply();
    });
    attrSel.on("change", apply);

    app.setPosition({ height: "auto" });
    return true;
}
