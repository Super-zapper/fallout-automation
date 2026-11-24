// ==========================================================
// Выбор травм по картинке тела, как на экране Пип-Боя в листе персонажа.
// Картинки не входят в модуль: они берутся из установленной системы Fallout
// (systems/fallout/assets/ui/pipboy-body/character/<статус>/<часть>.png, слои 600x600 с прозрачным фоном).
// Статус части: здоровая / залеченная (wounded) / открытая травма (crippled).
//
// Как пользоваться: левая кнопка добавляет лечение в выбранную часть (у части с несколькими травмами можно
// нажимать несколько раз), правая убирает последнее. Под картинкой список: что и куда пойдёт.
// Окно с выпадающими списками остаётся запасным вариантом: если картинки не загрузились, список виден.
// Работает только для людей (персонаж, NPC с обычными частями тела): у роботов, существ и техники картинки другие.
// ==========================================================
import { t } from "../utils/i18n.js";
import { esc } from "../utils/html.js";
import { partInjuries, partLabel } from "../utils/injuries.js";

export const PICKER_KEYS = ["head", "torso", "armL", "armR", "legL", "legR"];

const IMAGE_DIR = "systems/fallout/assets/ui/pipboy-body/character";
const SIZE = 600;
// Цветовой фильтр картинок такой же, как в листе персонажа
const FILTER = "invert(63%) sepia(9%) saturate(1297%) hue-rotate(154deg) brightness(93%) contrast(86%)";

const route = path => foundry.utils.getRoute?.(path) ?? path;
const imageUrl = (status, key) => route(`${IMAGE_DIR}/${status}/${key}.png`);

const shapeCache = new Map();

/** Габариты и центр части тела по непрозрачным пикселям (картинки это контуры, поэтому попадание считаем по габаритам). */
function loadShape(key) {
    if (!shapeCache.has(key)) {
        shapeCache.set(key, new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = SIZE;
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, SIZE, SIZE);
                const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
                let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0, sx = 0, sy = 0, n = 0;
                for (let i = 0; i < SIZE * SIZE; i++) {
                    if (data[i * 4 + 3] <= 40) continue;
                    const x = i % SIZE, y = Math.floor(i / SIZE);
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    sx += x; sy += y; n++;
                }
                if (!n) return reject(new Error(`empty image ${key}`));
                resolve({ minX, minY, maxX, maxY, cx: sx / n, cy: sy / n });
            };
            img.onerror = () => reject(new Error(`image ${key} not loaded`));
            img.src = imageUrl("healthy", key);
        }));
    }
    return shapeCache.get(key);
}

/** Где стоит плашка с числом травм (в системе 600x600). */
function badgePosition(key, s) {
    switch (key) {
        case "head":  return [s.minX - 40, s.cy];
        case "torso": return [s.cx, s.cy];
        case "armL":
        case "armR":  return [s.cx, s.maxY + 28];
        case "legL":  return [s.minX - 38, s.cy];
        case "legR":  return [s.maxX + 38, s.cy];
        default:      return [s.cx, s.cy];
    }
}

/** Какая часть тела под точкой (координаты в системе 600x600): среди подходящих по габаритам ближайшая к центру. */
function partAt(x, y, shapes) {
    const pad = 12;
    let best = null, bestScore = Infinity;
    PICKER_KEYS.forEach((key, i) => {
        const s = shapes[i];
        if (x < s.minX - pad || x > s.maxX + pad || y < s.minY - pad || y > s.maxY + pad) return;
        const w = Math.max(1, (s.maxX - s.minX) / 2), h = Math.max(1, (s.maxY - s.minY) / 2);
        const score = ((x - s.cx) / w) ** 2 + ((y - s.cy) / h) ** 2;
        if (score < bestScore) { bestScore = score; best = key; }
    });
    return best;
}

/**
 * Подключает картинку тела вместо выпадающих списков травм.
 * html: окно; target: цель; dialog: окно (для подгонки высоты).
 * Слоты: выпадающие списки .fa-injury-select (действие, стимулятор). Картинка выставляет их значения.
 */
export async function mountBodyPicker({ html, target, dialog }) {
    const host = html.find(".fa-picker-host").first();
    const selects = html.find("select.fa-injury-select").toArray();
    if (!host.length || !selects.length || host.data("faMounted")) return false;

    const shapes = await Promise.all(PICKER_KEYS.map(loadShape));   // ошибка: остаются списки

    const parts = {};
    for (const key of PICKER_KEYS) {
        const data = target.system.body_parts[key];
        const counts = partInjuries(target, data);
        parts[key] = { open: counts.open, treated: counts.treated, label: partLabel(target, key, data) };
    }

    // В списках появляется пустой вариант: слот можно оставить без травмы
    const slots = selects.map(sel => sel.value || null);
    for (const sel of selects) {
        $(sel).prepend(`<option value="">-</option>`);
        const box = $(sel).closest(".fa-box");
        (box.length ? box : $(sel)).hide();
    }

    const screen = $(`<div class="fa-body-screen"></div>`);
    PICKER_KEYS.forEach(key => screen.append(`<div class="fa-body-layer" data-part="${key}"></div>`));
    // Плашки с числом стоят рядом с картинкой, как в листе: слева от головы, торс по центру,
    // под руками, левее левой и правее правой ноги
    PICKER_KEYS.forEach((key, i) => {
        const [x, y] = badgePosition(key, shapes[i]);
        screen.append(`<div class="fa-body-badge" data-part="${key}" style="left: ${(x / SIZE) * 100}%; top: ${(y / SIZE) * 100}%;"></div>`);
    });
    const info = $(`<div class="fa-body-info"></div>`);
    host.data("faMounted", true).empty().append($(`<div class="fa-body"></div>`).append(screen, info));

    const assignedTo = key => slots.filter(k => k === key).length;
    let cursor = 0;

    const render = () => {
        PICKER_KEYS.forEach(key => {
            const p = parts[key];
            const assigned = assignedTo(key);
            // Предпросмотр: часть, где назначены все травмы, показывается как залеченная
            const status = (p.open - assigned) > 0 ? "crippled" : ((p.treated + assigned) > 0 ? "wounded" : "healthy");
            screen.find(`.fa-body-layer[data-part="${key}"]`)
                .css({ "background-image": `url("${imageUrl(status, key)}")`, filter: FILTER })
                .toggleClass("fa-selected", assigned > 0)
                .toggleClass("fa-hurt", (p.open - assigned) > 0);
            screen.find(`.fa-body-badge[data-part="${key}"]`)
                .text(p.open > 0 ? `${assigned}/${p.open}` : "")
                .toggleClass("fa-active", assigned > 0)
                .toggle(p.open > 0);
        });

        selects.forEach((sel, i) => { sel.value = slots[i] ?? ""; });

        // Сколько назначений нужно сделать: все слоты, но не больше, чем есть открытых травм.
        const totalOpen = PICKER_KEYS.reduce((sum, key) => sum + parts[key].open, 0);
        host.trigger("fa:picker", [{ assigned: slots.filter(Boolean).length, required: Math.min(slots.length, totalOpen) }]);

        info.html(`
            <p class="fa-note fa-center">${esc(t("firstAid.picker.hint"))}</p>
            ${slots.map((key, i) => `<div class="fa-row"><span class="fa-k">${esc(selects[i].dataset.slot ?? "")}</span><span class="fa-v">${key ? esc(parts[key].label) : "-"}</span></div>`).join("")}`);
    };

    const flash = () => {
        screen.addClass("fa-flash");
        setTimeout(() => screen.removeClass("fa-flash"), 250);
    };

    const pointOf = event => {
        const rect = screen[0].getBoundingClientRect();
        return [((event.clientX - rect.left) / rect.width) * SIZE, ((event.clientY - rect.top) / rect.height) * SIZE];
    };

    screen.on("mousemove", e => screen.css("cursor", partAt(...pointOf(e), shapes) ? "pointer" : "default"));

    // Левая кнопка: назначить лечение в часть (если все слоты заняты, заменяется самое старое назначение)
    screen.on("click", e => {
        const key = partAt(...pointOf(e), shapes);
        if (!key) return;

        let index = slots.findIndex(k => !k);
        if (index === -1) { index = cursor % slots.length; cursor++; }

        const previous = slots[index];
        slots[index] = null;
        if (parts[key].open - assignedTo(key) < 1) {      // в этой части нет свободных открытых травм
            slots[index] = previous;
            return flash();
        }
        slots[index] = key;
        render();
    });

    // Правая кнопка: убрать последнее назначение в этой части
    screen.on("contextmenu", e => {
        e.preventDefault();
        const key = partAt(...pointOf(e), shapes);
        if (!key) return;
        const index = slots.lastIndexOf(key);
        if (index !== -1) { slots[index] = null; render(); }
    });

    render();
    dialog?.setPosition({ height: "auto" });
    return true;
}
