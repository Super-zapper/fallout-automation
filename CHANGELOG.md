# Changelog

## 0.3.8
- One window for skill checks. The roll dialog now has a skill row and an attribute row (colored by attribute) at the top, the usual numbers and dice, and the difficulty row (GM base and final). Changing the skill switches the attribute to the skill's default one (you can override it), and the attribute value, skill value, tag, roll name and difficulty modifiers are updated on the fly. It appears on skill rolls from the character sheet and on the Argon HUD "Test" check. Plain attribute rolls, initiative and weapon attacks are not changed.
- The Argon HUD "Test" button now opens this window by itself (the module watches for the button's chat message, so the world script `2_HUD_buttons` is not needed for it, and the macro "Проверка Навыка" is no longer needed). It is a normal roll, no GM confirmation. A macro can open it with `window.openFalloutSkillCheck(actor)`.
- `runFalloutCheck` (roll whose result the GM confirms) is kept for GM macros; its confirmation card shows the skill and attribute that were actually chosen in the window.
- Creatures: the window offers Body / Mind and Melee / Guns / Other (no "No skill" entry).
- Fix: the difficulty engine no longer throws on actors without `system.attributes` (creatures).

## 0.3.7
- New effect "Radiation" (Облучение). It is taken from Convenient Effects if you already have one with that name, otherwise the built-in one is used (icon from the Fallout system, `-1` to `system.health.max`) and it is added to the CE list like Stunned, Persistent and Prone. The icon can be changed in settings.
- New block "Radiation" (`scripts/core/radiation.js`), replaces the world macro `Radiation_for_NPCs` (**disable that macro**). When an actor's `system.radiation` changes, the actor gets a "Radiation N" effect that lowers max HP by N, current HP is cut to the new maximum, and the effect is removed when radiation drops to 0. Effects made by the old macro (flag `world.isRadiationEffect`) are recognized, so no duplicates appear. Works for all actor types, like the macro. Does not need a custom CE effect to exist.
- NPC and creature sheets get a "Radiation" field next to HP on the Abilities tab (initiative and defense move to the row below, full width). The system has this field only on character sheets. The field writes to `system.radiation`, so the effect above is added, updated and removed as usual. It is part of the "Radiation" block.

## 0.3.6
- Fix: the damage roll dialog threw `Cannot read properties of undefined (reading 'some')` (hook `renderDialogD6`). Sneak attack with the Big Leagues perk did not add the +2 CD in the damage roll dialog (only the chat note appeared). The system passes the actor to that dialog as a UUID string, not as an actor document, so the perk was not found there. The actor is now resolved first.

## 0.3.5
- New block "Damage extra rules" (`scripts/core/damage-rules.js`). It replaces the old sneak attack block and the world macro `2_Damage_extra_rules`, so **disable that world macro** after updating:
  - Blast miss: for weapons with the Blast quality, if the attack did not reach the difficulty, the damage dice are halved and the damage effects are cancelled.
  - Big Leagues perk: a two-handed melee weapon with effects rolled gains Vicious.
  - Sneak attack: unchanged rules, now handled in the same pass as the two above, so they no longer overwrite each other's changes to the damage message.
- Fix: in the damage roll dialog the halved dice count of a blast miss is now written to the dice field the roll actually reads (the old macro only changed the label).
- Fix: `game.messages.contents.reverse()` reversed the shared message list in place. The module now iterates a copy.
- Sneak attack with the Big Leagues perk: the perk already makes the weapon Vicious, so the sneak attack gives +2 CD instead of a second Vicious.
- Dialog: halved dice are shown as `6 → 3` (old value dimmed, new one in red). The perk is found by name: "Высшая Лига" or "Big Leagues".
- Long explanations (sneak attack, blast miss, Big Leagues) moved into tooltips; chat notes and dialog notes are short and use the terminal style, no emoji.

## 0.3.4
- Release workflow: `styles/` is now included in `module.zip`. Without it the new chat styling (terminal look) is missing in a downloaded release.
- Reopening of treated wounds: the roll is now public. The CD pool is posted to chat as a normal roll message (with a short flavor line), so every player sees it and Dice So Nice animates it by itself. The damage result card waits until the 3D dice stop.

## 0.3.3
- Grenades: after the blast point is chosen, every token touched by the blast circle is targeted automatically (the thrower's own token too, if it is inside; untarget it by hand before rolling if needed). The count of targets is shown in a notification. Targets are set as a group, so no per-token "Target: ..." notifications.
- Wounds: reopening of treated wounds (and the new-wound slots) now also works for actors of type `creature`. They share the NPC sheet and store wounds as counters. As a safety net, any body part without an `injuries` array is treated the same way.
- Sneak attack damage is now really applied (new block "Sneak attack: damage bonus", `scripts/core/sneak.js`):
  - weapon already has Vicious: the damage roll dialog gets +2 CD in "Extra dice";
  - weapon has no Vicious: after the roll the module adds +1 damage per effect rolled, lists Vicious among the damage effects and updates the message flags, so the Damage Engine panel shows the correct number.
  The bonus follows the last attack made with the same weapon (re-rolls and added dice included).
- Visuals: one terminal style for everything the module adds to chat (`styles/fallout-automation.css`, classes `fa-*`): damage result card, damage panel, targets plaque, roll verdict with sneak attack note, skill-check request, GM decision panel.
- Emoji removed from chat cards, notifications and settings. Damage types now use the icons of the Fallout system itself (`fo-physical`, `fo-energy`, `fo-radiation`, `fo-poison`).
- Attack roll dialog: the difficulty breakdown is now one line (for example `Defense 2 · Range +1 · Prone −1 · Eff. +1 · Aim +1 · Sneak −1 [PER]`). Zero values are hidden, increases are red, decreases are green, base values stay neutral. The aiming penalty (+1, specific body part without V.A.T.S.) and the sneak attack bonus (−1) are part of the line and update live. The font shrinks a little when there are many terms so the line never wraps.
- Removed the "Attack data" plaque (targets, hit location) from the damage message; the data is still passed to the damage roll internally.
- New language keys: `damage.panelTitle`, `damage.applyBtn`, `damage.card.title`, `damage.card.type`, `rollEngine.title`, `difficulty.blastTargets`, `difficulty.bd.*`, `sneak.*`, `settings.blocks.sneak.*`.

## 0.3.2
- Fix: the AP button works with the Fallout system 11.16.x tracker (`fallout.APTrackerV2`, which has no public `setAP`/`adjustAP`): the module now updates the system's `partyAP` / `gmAP` setting and redraws the tracker. Players' clicks are executed by the GM through a socket.
- Fix: grenades. `User#updateTokenTargets` no longer exists in Foundry v13, which stopped the blast-point selection; targets are now cleared with `Token#setTarget`.
- Fix: reopening of treated wounds on NPCs. NPCs store wounds only as counters (`injuryOpenCount`, `injuryTreatedCount`) and have no `injuries` array, so the module read no treated wounds. NPC wounds are now read from and written to the counters; characters and vehicles still use the array.

## 0.3.1
- AP button in the roll verdict: works with both known APTracker APIs (`adjustAP`, or `setAP` as in newer system versions) and shows an error instead of failing silently.
- Grenades: blast-point placement now supports the canvas mouse events of newer Foundry versions (`getLocalPosition`, `canvas.app.canvas`), and a warning is logged when an explosive has no recognised Blast quality.
- Damage: debug log of the injuries on the hit location (helps to diagnose reopening of treated wounds).

## 0.3.0 — first public release
- Roll Engine: remembers targets and hit location of an attack and passes them to the damage roll.
- Difficulty Engine: difficulty, range, sneak attack, success/failure verdict and AP buttons in roll dialogs and chat.
- Damage Engine: damage application with armor, injuries, radiation, stun and persistent damage.
- GM-confirmed skill checks (`runFalloutCheck`) and the GM decision panel in chat.
- Persistent damage at the end of the turn.
- Built-in effects (Stunned, Persistent, Prone) that prefer your Convenient Effects versions and are added to the CE list when missing.
- English and Russian interface, per-block switches and effect icons in module settings.
- Roll skills from the actor sheet (the actor is detected from the open sheet).
