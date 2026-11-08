// ==========================================================
// Обёртки над хуками Foundry
// ==========================================================

/**
 * Рендер сообщения чата. В Foundry v13 хук называется renderChatMessageHTML
 * и отдаёт обычный HTMLElement. Старые скрипты написаны под jQuery
 * (html.find(...), html.append(...)), поэтому здесь элемент оборачивается
 * обратно в jQuery. Скрипты менять не нужно: они вызывают onChatRender
 * вместо Hooks.on("renderChatMessage", ...).
 *
 * Когда-нибудь можно переписать конкретный скрипт на нативный DOM,
 * заменив $(element) на element, но срочности в этом нет.
 */
export function onChatRender(handler) {
    return Hooks.on("renderChatMessageHTML", (message, element, context) => {
        handler(message, $(element), context);
    });
}
