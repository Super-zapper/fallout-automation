// ==========================================================
// Мелкие помощники для HTML-вставок в чат. Классы fa-* описаны в styles/fallout-automation.css.
// ==========================================================

/** Экранирует текст, который попадает в HTML (имена токенов, названия предметов). */
export function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Иконка типа урона из шрифта системы Fallout: physical, energy, radiation, poison. */
export function damageIcon(type) {
    return `<i class="fo-${esc(type)}" title="${esc(type)}"></i>`;
}

/** Строка «ключ ... значение» внутри терминальной карточки. */
export function row(key, value) {
    return `<div class="fa-row"><span class="fa-k">${key}</span><span class="fa-v">${value}</span></div>`;
}

/** Цветная плашка-уведомление внутри карточки. variant: "", "warn", "danger", "rad", "pink", "muted". */
export function alertBox(text, variant = "", note = "") {
    return `<div class="fa-alert${variant ? ` fa-${variant}` : ""}">${text}${note ? `<span class="fa-note">${note}</span>` : ""}</div>`;
}
