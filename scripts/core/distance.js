// ==========================================================
// Расчёт дистанции по правилам Fallout 2d20 (window.getFalloutDistance)
// Перенесено из world-скрипта «31_Distance_measure». Нужен Difficulty Engine.
// ==========================================================
export function register() {
    /**
     * ГЛОБАЛЬНАЯ ФУНКЦИЯ РАСЧЕТА ДИСТАНЦИИ FALLOUT 2d20
     * Доступна из любого макроса или модуля через window.getFalloutDistance()
     */

        window.getFalloutDistance = function(t1, t2) {
            if (!t1 || !t2) return 0;
        
            // Получаем координаты в клетках
            const x1 = Math.round(t1.x / canvas.grid.size);
            const y1 = Math.round(t1.y / canvas.grid.size);
            const w1 = Math.max(1, Math.round(t1.w / canvas.grid.size));
            const h1 = Math.max(1, Math.round(t1.h / canvas.grid.size));

            const x2 = Math.round(t2.x / canvas.grid.size);
            const y2 = Math.round(t2.y / canvas.grid.size);
            const w2 = Math.max(1, Math.round(t2.w / canvas.grid.size));
            const h2 = Math.max(1, Math.round(t2.h / canvas.grid.size));

            // Ищем минимальную дистанцию между краями токенов по X и Y
            const dx = Math.max(0, Math.max(x1 - (x2 + w2 - 1), x2 - (x1 + w1 - 1)));
            const dy = Math.max(0, Math.max(y1 - (y2 + h2 - 1), y2 - (y1 + h1 - 1)));

            // Расчет 1-2-1 по диагонали (правило 5-10-5)
            const min = Math.min(dx, dy);
            const max = Math.max(dx, dy);
            const gridDist = Math.floor(min * 1.5) + (max - min);
        
            // Если токены в одной клетке или стоят вплотную — это Reach (1)
            return gridDist === 0 ? 1 : gridDist;
        };
    
        console.log("Fallout Engine | Глобальный расчет дальности загружен.");
}
