# Fallout Automation

**English** · [Русский](#русский)

Automation for the **Fallout 2d20** system on **Foundry VTT v13**. It links attack rolls to damage rolls, calculates roll difficulty and shows the success verdict, applies damage with armor, stun and persistent damage, and lets the GM confirm skill checks. The interface is available in English and Russian.

> Early release. It was built around one table's rules and workflow, so please report anything that looks wrong in [Issues](../../issues).

## Requirements

- Foundry VTT **v13**
- Game system **Fallout** (tested on 11.16.6)
- Module **socketlib** (required)
- Recommended: **Convenient Effects** (8.x), **Times Up** (removes effects when their duration ends), **Tagger**

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL and press Install:

```
https://github.com/OWNER/REPO/releases/latest/download/module.json
```

Then enable the module in your world (it also needs socketlib).

## What it does

Every block can be switched off in the module settings.

| Block | What it does |
|---|---|
| Roll Engine | Remembers the targets and hit location of an attack and passes them to the damage roll. |
| Difficulty Engine | Adds difficulty, range, defense, sneak attack and hit-zone controls to roll dialogs; shows a success/failure verdict and AP buttons in chat. |
| Damage Engine | Applies damage with armor, injuries, radiation, stun and persistent damage from the chat card (GM only). |
| GM approval | Skill checks the GM can accept, force to success or failure, or cancel. |
| Persistent damage | Rolls damage from the Persistent effect at the end of the turn. |

### Effects

Stunned, Persistent and Prone are used by the blocks above.

- If your Convenient Effects list already has an effect with that name, **your version is used** (name, icon, description, duration). Nothing in CE is changed or overwritten.
- If not, the module uses a built-in effect with icons from the Fallout system, and adds the missing effects to the CE list (can be switched off in settings).
- If an effect keeps the module's default texts, it is applied in the current interface language. Texts you edited yourself are kept.
- Without Convenient Effects the module still works with its built-in effects.

### Languages

English and Russian (`lang/en.json`, `lang/ru.json`). To add a language, copy `en.json`, translate the values, and list the file under `languages` in `module.json`.

## Notes

- This is an unofficial, fan-made module. It is not affiliated with or endorsed by Bethesda Softworks, Modiphius Entertainment or the authors of the Fallout system. *Fallout* and related names are trademarks of their respective owners.
- The module bundles no game art. Effect icons are referenced from the installed Fallout system.
- Code is released under the MIT license.

---

## Русский

Автоматизация системы **Fallout 2d20** для **Foundry VTT v13**: связывает бросок атаки с броском урона, считает сложность и показывает вердикт «успех / провал», применяет урон с бронёй, оглушением и продолжительным уроном, а также позволяет мастеру подтверждать проверки навыков. Интерфейс на русском и английском.

> Ранняя версия. Модуль сделан под правила и процесс одного стола, поэтому о всём странном пишите в [Issues](../../issues).

### Требования

- Foundry VTT **v13**
- Система **Fallout** (проверено на 11.16.6)
- Модуль **socketlib** (обязателен)
- Рекомендуются: **Convenient Effects** (8.x), **Times Up** (снимает эффекты по окончании длительности), **Tagger**

### Установка

В Foundry: **Модули → Установить модуль**, вставьте ссылку на манифест и нажмите «Установить»:

```
https://github.com/OWNER/REPO/releases/latest/download/module.json
```

Затем включите модуль в мире (нужен также socketlib).

### Что делает

Каждый блок можно отключить в настройках модуля.

| Блок | Что делает |
|---|---|
| Roll Engine | Запоминает цели и зону попадания атаки и передаёт их в бросок урона. |
| Difficulty Engine | Добавляет в окно броска сложность, дистанцию, защиту, скрытную атаку и выбор зоны; показывает вердикт и кнопки ОД в чате. |
| Damage Engine | Применяет урон с бронёй, травмами, радиацией, оглушением и продолжительным уроном из карточки чата (только ГМ). |
| Окно решения ГМа | Проверки навыков, которые ГМ может принять, засчитать как успех или провал, либо отменить. |
| Продолжительный урон | В конце хода бросает урон от эффекта «Продолжительный». |

#### Эффекты

Оглушение, Продолжительный и Распластанность используются блоками выше.

- Если в списке Convenient Effects уже есть эффект с таким именем, **берётся ваш вариант** (имя, иконка, описание, длительность). В CE ничего не меняется и не перезаписывается.
- Если нет, берётся встроенный эффект с иконками из системы Fallout, а недостающие эффекты добавляются в список CE (это можно отключить в настройках).
- Если у эффекта остались тексты модуля по умолчанию, он накладывается на языке интерфейса. Тексты, изменённые вами, сохраняются.
- Без Convenient Effects модуль тоже работает на встроенных эффектах.

#### Языки

Русский и английский (`lang/ru.json`, `lang/en.json`). Чтобы добавить язык, скопируйте `en.json`, переведите значения и впишите файл в `languages` в `module.json`.

### Примечания

- Это неофициальный модуль от фанатов. Он не связан с Bethesda Softworks, Modiphius Entertainment и авторами системы Fallout и не одобрен ими. *Fallout* и связанные названия принадлежат их владельцам.
- В модуль не входит игровая графика. Иконки эффектов берутся из установленной системы Fallout.
- Код распространяется по лицензии MIT.
