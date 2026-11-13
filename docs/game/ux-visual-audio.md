# Main Street: UX, Visual, Animation, and Audio Notes

## Scope

This document captures the current implementation-level guidance for Main Street UI feedback polish in Milestone 4.

## ToneForge runtime audio (opt-in + fallback)

Main Street's SFX play through `SoundManager` on the **WAV/Phaser path by
default**. ToneForge synth integration is **opt-in per session**
(MS-0MV76P7BN00164RF):

- **Off by default.** The scene boots without attaching a synth player and
  without fetching the runtime module: `SoundManager.isSynthActive()` is
  `false` and no ToneForge lazy chunk is requested.
- **Dev-only opt-in.** The dev-only debug **ToneForge** entry (Settings →
  Debug Tools) is the enable path. Switching it on calls
  `loadMainStreetTfIntegration()` (`src/debug/MainStreetDebugTools.ts`), which
  lazily resolves the committed module (`loadMainStreetTfModule()` in
  `src/tf/mainStreetTfModule.ts`) and attaches it via `createTfPlayer()` /
  `setSynthIntegration()`. The status line then reports `Active`; switching it
  off detaches the synth player without a scene restart, reverting mapped keys
  to WAV/Phaser.
- **Loud failures.** A load/normalisation failure emits a `console.warn` with
  the reason and is retained by `getMainStreetTfDiagnostics()`
  (`loaded` / `factoryCount` / `lastLoadError`), which the opt-in loader
  forwards to `SoundManager.setSynthDiagnostics()` so the status line shows
  `Inactive · … · load error: <reason>`.
- **Missing-factory fallback.** `MAIN_STREET_TF_SFX_MAPPING` maps 16 logical
  keys and the committed runtime module ships all 16 factories
  (MS-0MV8PDNDT0033TH8), so every mapped key plays through the synth. A mapped
  key whose factory is missing would still fall back to the WAV/Phaser path
  instead of going silent (`tfAdapter` reports whether it handled the key;
  `SoundManager.play()` falls through when it did not) — engine item
  CG-0MUU9PSWC009CW76. The Main Street TF logger (`src/tf/tfLogger.ts`)
  suppresses the per-play `[tfAdapter] Missing tf factory …` warning for any
  key declared in `MAIN_STREET_TF_FACTORYLESS_KEYS`
  (`src/sfx-tf-mapping.ts`, plus the derived
  `MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS`) while still forwarding every
  unexpected missing factory or other adapter warning (MS-0MV26MOWT004ZCQC).
  That list is currently **empty** — the mechanism is retained so a future
  intentional fallback cannot reintroduce console noise.

## Tutorial layout composition (quiet by design)

The tutorial highlight overlay composes the base shell layout with the
scene-specific `main-street-tutorial.layout.json` using `sceneWins` (see
`MainStreetTutorialHints.ts`). Three zones — `hand`, `endTurnButton` and
`incidentQueue` — are deliberately reused by the tutorial layout so its rects
override the base rects; this is the documented alignment contract, and the
tutorial rects are the source of truth for those highlights.

`composeResolvedLayouts()` reports every name collision as a developer warning,
so resolving the tutorial used to emit three benign `Zone collision …`
warnings on every call. The tutorial passes the `reportTutorialLayoutIssue`
hook (`src/scenes/tutorialLayoutIssues.ts`) instead: it suppresses only the
collisions for the documented override set (`TUTORIAL_INTENTIONAL_OVERRIDE_ZONES`)
and re-emits every other issue (validation errors, namespace collisions and
unexpected zone collisions) exactly as the default reporter would, so genuine
diagnostics stay visible (MS-0MV26MOWT004ZCQC). `sceneWins` semantics and the
tutorial rects are unchanged.

## Play panel treatment (opaque panels, MS-0MVPWQIPZ002PHPD)

The market box, the persistent player-hand panel and the HUD strip all share
the Activity Log's opaque treatment, so the play surface reads as
self-contained sections instead of letting the street/road grid show through:

| Element | Value |
|---|---|
| Fill | `PANEL_FILL` `0x1a1408` at `PANEL_FILL_ALPHA` `0.85` |
| Border | 1 px `BOX_STROKE` `0x665544` at `PANEL_STROKE_ALPHA` `0.5` |
| Corner radius | `BOX_RADIUS` (6 px) |

The literals live in `src/scenes/MainStreetConstants.ts` as the single
authority (`PANEL_FILL`, `PANEL_FILL_ALPHA`, `PANEL_STROKE_ALPHA`), promoted
out of the Activity Log so the three panels cannot drift apart. The Activity
Log is the reference; the incident queue and the challenge tracker reuse the
same fill and border with their own 4 px radius, and their title bars keep the
`0x332816` @ 0.9 band.

- **Market** — the section background spans `marketLeft`..`marketRight` (the
  single layout authority, never recomputed inline) and replaced the previous
  `BOX_FILL` @ 0.3 wash that let roads and grid lines read through the row.
- **Hand** — `drawHandPanel()` draws a persistent opaque panel behind the hand
  cards and ghost capacity outlines (see
  [Player hand layout](#player-hand-layout)).
- **HUD** — the top resource strip uses the same fill/alpha/border so it
  matches the market box exactly.
- **Presentation-only in every case** — no panel calls `setInteractive`, no
  panel mutates state, and the panels are static so reduced motion and replay
  are unaffected.
- **Tests** — `tests/main-street/panel-opacity.browser.test.ts`,
  `tests/main-street/hand-panel.browser.test.ts` and
  `tests/main-street/hud-strip-layout.browser.test.ts`.

## Player hand layout

Main Street renders the player hand with the core engine's single `HandView`
(`MainStreetRendererStreet.ts`), anchored on `handCenterX` and declaring the
hand's capacity up front with `maxSlots: state.maxHandSize`.

- **Bottom-anchored hand (MS-0MVPWQMTL004J3GB).** The hand band is anchored at
  the bottom of the viewport in `src/layouts/main-street.layout.json` (SLL
  `hand` zone `topLeft` `y` ≈ 0.872 — 628 px at 1280×720) while `handCenterX`
  stays centred on the street block. `handY` is read from that anchor, so the
  hand sits below the street plot and its bottom road band. The End Turn /
  Peek action row keeps its **own** `actionRow` anchor (≈ 0.9) precisely so
  moving the hand does not drag the action button — and with it the tutorial
  `endTurnButton` highlight and the button hit area — along.
- **Persistent opaque panel (MS-0MVPWQIPZ002PHPD).** `drawHandPanel()` renders
  exactly one graphics object named `ms-hand-panel` behind the hand: fill
  `PANEL_FILL` @ `PANEL_FILL_ALPHA`, 1 px `BOX_STROKE` border, `BOX_RADIUS`
  corners. It is sized from the capacity row (`maxSlots × (handCardW +
  HAND_SLOT_PITCH_PAD)` wide, `handCardH + 2 × HAND_PANEL_PAD` tall) so a staff
  hire/lay-off grows or shrinks it without clipping cards or ghost outlines,
  sits at `HAND_PANEL_DEPTH` (-100 — below every hand-layer object, including
  the negative-depth ghosts) and is never interactive, so hand-card clicks,
  hand→street drags and market→hand drops behave exactly as before.
- **Capacity-stable slots (CG-0MUAYBB4E007LWEQ).** Because `maxSlots` is set,
  the card row is placed into the *same fixed capacity template* the empty hand
  renders rather than being re-centred on the current card count. Adding or
  drawing a card therefore fills the next empty slot to the **right** without
  re-laying the row — every already-placed card and every ghost outline slot
  keeps its exact position and rotation, up to capacity. `setMaxSlots()` (driven
  by `refreshPlayerHand()` from `state.maxHandSize`, e.g. after hiring a staff
  card) is the only mutation that may move existing cards.
- **Left-anchored partial hand.** A partially-filled hand sits left-anchored in
  the capacity row (cards fill left-to-right) instead of being centred on the
  current card count. Click / drag / hand-to-street transfer paths that use the
  hand centre (`handCenterX`) or hide the transfer source
  (`hiddenTransferSourceCardIds`) must therefore read the card's actual
  `HandView` position rather than assuming a symmetric centred row; the
  capacity template guarantees that position is stable across adds.
- **Ghost outlines.** `showPositionOutlines: true` renders one ghost slot per
  `maxSlots`; the outlines are purely visual, so toggling them never moves a
  card. Occupied slots ghost their card exactly (same centre and rotation);
  extra capacity slots continue the same row to the right, below every card.
- See the core `docs/DEVELOPER.md` § *Hand capacity outlines* for the full
  `HandView` semantics and browser coverage in
  `tests/main-street/hand-outlines.browser.test.ts` (including the
  slot/card-position stability assertion).

## Staff Pile (management-company staff, MS-0MWBWKZ1G006IBH2)

Hired staff come in two types: **business staff** (an `employedAtSlot` link,
buffed onto one business and surfaced by that slot's corner count badge) and
**management-company staff** (no slot; hand-slot, action, market and incident
effects scoped to the player). Until this feature the management-company half
of the roster had no surface of its own — it was only inferable from hand size
and action counts. The **Staff Pile** gives it one.

- **Position — SLL-first.** The pile is drawn from the `staffPile` zone in
  `src/layouts/main-street.layout.json` (tutorial parity in
  `main-street-tutorial.layout.json`), resolved by `MainStreetLayoutAdapter`
  into `SceneLayout.staffPileX/Y/W/H` — 20,565 → 240,667 at the 1280×720 base
  viewport, i.e. against the left edge in the band left of the hand capacity
  row. No pixel offset is hard-coded in the renderer. The tutorial layout
  declares the same zone so tutorial highlights cannot drift; `staffPile` is a
  documented intentional tutorial override zone
  (`src/scenes/tutorialLayoutIssues.ts`), keeping the tutorial composition
  console-clean.
- **Contents.** A fanned stack of small card faces (56×80) capped at
  `STAFF_PILE_STACK_SIZE` (3), oldest of the shown slice first and the
  **newest hire on top**; a count badge (top-right of the stack) reporting the
  **whole** roster even when the stack is capped; and a portrait row (40×56)
  beneath the stack showing one portrait per member that fits the zone width.
  Card faces and portraits both come from the shared SVG renderer
  (`mainStreetRenderCardSvg`), so no new art assets exist for this surface.
- **Membership is derived, never persisted.** The pile is rebuilt from
  `state.staffCards` on every hand refresh
  (`refreshPlayerHand()` → `drawStaffPile()`), filtered by the two-type
  model's own test (`!isBusinessStaffCard`, via `selectManagementCompanyStaff`).
  Business staff never appear on the pile. There is no save field, engine
  command or gameplay rule behind it: hiring, laying off or changing
  `maxHandSize` is reflected on the next refresh.
- **Hover tooltip.** Hovering the pile — its stack or its portrait row — shows
  a management-company-only summary built by `buildStaffPileTooltip()`: a title,
  the member count, one line per member (name, served business types, effect,
  salary) reusing `formatStaffMemberLine()` — the same per-member formatter the
  business-slot tooltip uses — and the team's total salary per turn. Strings
  come from the `HUD_TOOLTIP_I18N_KEYS` / `HUD_TOOLTIP_STRINGS` English bundle,
  never hard-coded. Leaving the pile hides it; nothing is shown in replay mode.
- **Empty state.** No management-company staff ⇒ no pile at all (no placeholder
  tile, no hit area).
- **Overlap budget and z-order.** The pile sits at `STAFF_PILE_DEPTH` (-200),
  **below** the hand panel (`HAND_PANEL_DEPTH` -100) and every hand card, so a
  hand wider than the free band covers the pile's right edge rather than the
  pile covering a playable card. The free band left of the capacity row is
  245 px at the starting hand (3 slots), 171 px at 4, 97 px at 5 and gone from
  7 slots — so the pile (220 px wide) fits the band at the starting hand and is
  progressively covered as `maxHandSize` grows. The pile's **hover hit area is
  additionally clamped** to the free band (`staffPileHitBounds()`), so it can
  never sit over a capacity slot: at 8 slots it is dropped entirely while the
  pile itself still renders. Hand-card clicks, hand→street drags and
  market→hand drops are unaffected.
- **Click → Company Roster.** Pointer-down on the pile — its card-face stack
  or its portrait row — opens the **Company Roster** overlay (see below). The
  pile hands the click off through `renderer.onOpenCompanyRoster` to
  `MainStreetScene.showCompanyRoster()`; it carries **no** roster, salary or
  lay-off logic of its own. Hovering still shows the tooltip, and the hit area
  stays clamped to the free band, so hand-card clicks, hand→street drags and
  market→hand drops are unaffected.
- **Tests.** `tests/main-street/staff-pile.test.ts` (membership + tooltip
  content), `tests/main-street/staff-pile-renderer.test.ts` (stub-scene render
  contract) and the `Staff Pile` cases in
  `tests/main-street/MainStreetScene.browser.test.ts` (placement, count badge,
  hover tooltip, empty state, refresh and the capacity case at 4 and 8 slots).

## Company Roster overlay (MS-0MWC1T8K2000DWZA)

The **Company Roster** is the management-company team's own surface: it lists
every management-company staff member with their role, effective per-turn
salary and the exact cost of letting them go, and it is the only place a
management-company member can be dismissed.

- **Entry point — the Staff Pile.** Clicking the pile — its card-face stack or
  its portrait row — opens the roster (see the Staff Pile section above). The
  pile hands the click off to `MainStreetScene.showCompanyRoster()`; the roster
  and all lay-off wiring live in `src/MainStreetRoster.ts` and
  `MainStreetOverlayContent.showCompanyRosterDialog()`.
- **Rows.** One row per management-company member (`!isBusinessStaffCard`,
  staff-hire order, oldest first): the member's name, its role/benefit summary
  (the shared `formatStaffRoleSummary()` text the tooltips also use), its
  effective per-turn salary resolved through
  `computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost)`, and
  a `[ Lay off ]` button. Business staff never appear. Rows are capped at 10 with
  an "…and N more" overflow line; the footer always reports the whole team.
- **Footer.** States the member count and the team's total per-turn salary, both
  from `buildCompanyRoster()`, and both update in place after a lay-off.
- **Lay-off confirm step.** `[ Lay off ]` opens a confirm step quoting the
  member's name, one turn's salary in coins (clamped at 0) and the reputation
  cost — both read from the roster model, never recomputed in the overlay.
  `[ Confirm ]` runs `letGoStaffCommand()` through the scene's undo manager, so
  the lay-off stays undoable; `[ Cancel ]` changes nothing. After a confirm the
  dialog stays open and rebuilds its rows and footer in place: the fired row
  disappears and the Staff Pile's stack/count update on the same refresh.
- **Empty state.** When the last member leaves, the panel shows the explicit
  text "No management-company staff employed." rather than an empty list.
- **Replay/headless.** Suppressed entirely in `replayMode`, like every other
  overlay — it draws nothing and adds no overlay objects.
- **Tests.** `tests/main-street/company-roster.test.ts` (model: membership,
  ordering, salaries, totals and the reputation cost), and
  `tests/main-street/company-roster.browser.test.ts` (open from the pile click,
  rows, footer, confirm/cancel, post-lay-off refresh, empty state, replay
  suppression and hand-input pass-through).

## Transient pop-text feedback channel (MS-0MVPWQK3U003DIR6, MS-0MVRDBD3P0026CXH)

The persistent instruction line under the board is gone. Messages that used to
land there are routed through `src/scenes/MainStreetFeedback.ts`:

- `flashFeedback(scene, text, { kind })` is the single entry point;
  `flashError()` and `flashConfirmation()` are the convenience wrappers.
- **Message taxonomy** (producer decision Q4a): **error** refusals / illegal
  moves ("Not enough coins…", "Cannot hire…", "Hand full…") and
  **confirmation** outcomes ("Applied … to slot N", "Sold …") are surfaced;
  **guidance** phase-teaching lines ("Click an empty slot to place …", the
  standard market instruction) and **progress** lines ("Placing …",
  "Processing end of turn…") are dropped — they only told the player what to
  do, or self-resolved visually.
- **Anchor:** `feedbackAnchor(layout)` centres the text over the main content
  area (`logX / 2`) and lifts it clear of the hand-card band
  (`handY − handCardH / 2 − FEEDBACK_TOAST_MARGIN_PX`, margin 20 px), so it
  follows the bottom-anchored hand and its card size instead of hard-coding a
  pixel position. When the layout has no hand-card height it falls back to the
  historical plain lift above `handY`; with no finite metrics at all it falls
  back to the viewport centre/margin.
- **Readable hold:** `feedbackHoldMs(text)` is `max(1, words) × 500 ms`
  (`FEEDBACK_WORD_HOLD_MS`), where words are whitespace-delimited. Empty or
  whitespace-only text returns 0 and shows nothing. A 5-word refusal
  ("Not enough coins for Bakery") therefore holds for 2.5 s instead of the old
  1.1 s total lifetime.
- **Presentation sequence:** fade/scale in over
  `FEEDBACK_TOAST_FADE_IN_MS` (160 ms, alpha 0 → 1, scale 0.9 → 1) → the
  word-based fully-opaque hold (no fade or motion) → fade out over
  `FEEDBACK_TOAST_FADE_OUT_MS` (300 ms) → destroy. Total lifetime is
  `fadeIn + hold + fadeOut`. An explicit `holdMs` option overrides the
  word-based hold (tests/back-compat; `duration` is a deprecated alias).
- **Above everything:** the toast renders at `FEEDBACK_TOAST_DEPTH = 3000`,
  above hand cards (0…n), the hand panel (−100), the action row (100),
  overlays (200–201), stats (900–950), the HUD (1000) and the stats button
  (1100) — it is never covered by the hand or a HUD/overlay layer.
- **One toast, wrapped:** only one feedback toast is live per scene. A new
  message cancels the previous hold/fade timers and tweens and destroys the
  previous text before showing the new one, so repeated refusals never stack.
  Long messages word-wrap at `min(FEEDBACK_TOAST_MAX_WIDTH, gameW − 40)` and
  carry a dark stroke so they stay legible over any background. Scene
  shutdown/destroy cleanup cancels pending timers and text.
- **Reduced motion:** the same text is shown statically at alpha 1 at the same
  depth and anchor, held for the same `feedbackHoldMs(text)`, then destroyed —
  no tweens, never dropped.
- **Presentation-only:** the toast is never interactive and never intercepts
  pointer input.
- **Observability:** `scene.lastFeedback` (`{ text, kind }`) and
  `scene.feedbackHistory` record everything surfaced, so tests assert the
  channel without scraping rendered objects
  (`tests/main-street/feedback-pop-text.test.ts`,
  `tests/main-street/illegal-afford-feedback.test.ts`).
- **Activity Log is untouched** — this module owns only the on-screen channel;
  every message that was logged stays logged.

## Event Feedback Animations

### Card transfer feedback (market -> destination)

- Trigger: when buying cards from the market.
- Behavior:
  - Businesses animate from the market row to the selected street slot.
  - Investment events animate from the market row to the player hand.
  - Upgrades animate from the market row to the upgraded street slot.
- Accessibility: transfer animation is skipped when Reduced Motion is enabled.
- Duration:
  - Click-to-buy / place-from-hand / upgrade / event / AI flows use a fixed
    `1500ms` transfer (unchanged).
  - The drag-and-drop buy path derives its duration from the drop-to-slot
    distance via `computeDragTransferDuration()` (clamped to 250–1500ms,
    4ms per px), so a card released next to its slot settles into place
    quickly instead of taking the full fixed flight (CG-0MST2LS3E004BTPO).

#### Legality before animation (MS-0MUUDWIXG009IB0W)

A transfer animation only ever starts for a move that has already passed a
**non-mutating legality check**. The UI never animates a move that cannot
complete, so a rejected attempt leaves the scene exactly as it was instead of
playing a phantom card transfer.

- Order of operations: validate → (only if legal) clear the selection / set
  `uiPhase = 'animating'` → start `animateTransferFromMarket` → execute the
  undoable command. Affordability, target eligibility, occupancy and tutorial
  gating are all evaluated before any of these mutations.
- Illegal attempt: `playIllegalFeedback()` (ILLEGAL_MOVE SFX + shake) plus a
  pop-text error reason (`flashError()` — see
  [Transient pop-text feedback channel](#transient-pop-text-feedback-channel-ms-0mvpwqk3u003dir6))
  **precedes any mutation** — no coins, action, hand or grid change, and the
  current selection/`uiPhase` is retained so the player can immediately
  retarget.
- Click paths use the shared predicates `canPlaceFromHand`
  (`MainStreetEngineCommands.ts`) and `canPlayUpgradeFromHand`
  (`MainStreetMarketPurchase.ts`) before `onSlotClick` / `applyHandUpgradeToSlot`
  animate. Drag paths are gated by the drop zone's `canAccept`
  (`canDropBusinessCard` / `canDropUpgradeCard` for market-origin drags,
  `canDropHandCard` for hand-origin drags — MS-0MV76HVE4007AOO0);
  `@ui/dragDrop` only invokes the `onDrop` handler after `canAccept` returns
  true, so the transfer starts strictly after the gate.
- No failed attempt leaves `uiPhase === 'animating'`; every `afterTransfer`
  path (success or error) restores `uiPhase = 'market'`.
- Commit-before-feedback: the command layer is the single mutation point and
  is executed through the undo manager, which only pushes the command after
  `do()` succeeds. `snapshotAction.do()` restores the pre-action budget when
  the operation throws, so a failed command never spends an action — the
  command layer matches the engine `executeAction` restore-on-failure
  semantics (see [core-rules-and-mechanics.md](core-rules-and-mechanics.md)).

### Upgrade targeting highlights (click-to-place, CG-0MUDA70FK003J8YL)

- Helpers: `showTargetHighlights()` / `clearTargetHighlights()` in
  `MainStreetRendererDragDrop.ts` (re-exported through `MainStreetRenderer.ts`).
- Trigger: selecting a hand-held upgrade for targeting — `uiPhase ===
  'placing-from-hand'` and `state.hand[pendingHandIndex].family === 'upgrade'`.
  `refreshStreetGrid()` re-creates the overlays at the tail of its street
  rebuild, so they survive the `refreshAll()` that follows a selection (and
  any later refresh) instead of being destroyed with the container.
- Behavior: every occupied street slot owned by the acting seat is outlined —
  **green** (`0x44ff66`) for a business the upgrade can legally target
  (matching `targetBusiness` at `requiredLevel`, below `maxLevel`) and **red**
  (`0xff4444`) otherwise. Empty slots are skipped entirely and are no longer
  rendered as selectable while an upgrade is pending, so only real businesses
  appear as targets.
- Ownership (MS-0MVZC5V6L001OOXN): in competitive mode only the acting seat's
  own businesses are outlined. A slot whose `getSlotOwnerId()` differs from
  `state.activePlayerId` — the gate is `canActiveSeatActOnSlot()`, the same
  single source of truth used by upgrade placement — gets **no overlay at
  all**, never green and never red, because an opponent-owned business is not
  an upgrade target. Single-player states carry no `ownerTaggedGrid`, so every
  business still highlights exactly as before.
- Eligibility is business-level only, via the shared
  `isEligibleUpgradeTarget()` predicate in `MainStreetMarketUtils.ts`. The
  click is then additionally gated by the non-mutating
  `canPlayUpgradeFromHand()` predicate (`MainStreetMarketPurchase.ts`) — which
  also checks affordability against the per-business discounted cost — before
  any animation starts. Clicking an ineligible or unaffordable business shakes
  it back with feedback while the upgrade stays selected for a retry, and no
  action or coin is spent.
- Clearing: `cancelPendingPlacement()` (Escape / switching card / re-clicking the
  selected card — MS-0MV767QTO008JUDJ) calls
  `clearTargetHighlights()`; applying the upgrade rebuilds the street without
  a pending card, dropping the overlays. Both targeting flows share the
  `dragHighlightRects` pool, so drag-drop and click-to-place highlights render
  identically and clear together.
- Reuse: the existing `dragHighlightRects` infrastructure and
  `isEligibleUpgradeTarget()` predicate; no new engine primitives.

### Hand-drag gesture: upgrades and business cards (MS-0MV76HVE4007AOO0)

Hand-held **upgrade**, **business** and **community-space** cards are draggable
onto the street — the same one-gesture interaction as the market row — while
the click-to-apply / click-to-place flows keep working (drag and click
coexist, AC5; pure clicks below the drag threshold still reach
`onHandUpgradeCardClick` / `onHandBusinessCardClick`). Held **event** cards
are click-only: they keep the select-then-act `[Play]` / `[Discard]` flow and
are never registered as draggables.

Supported hand-drag families: **business**, **community-space** and
**upgrade**. Not supported (by design): **event** cards in hand.

- **Registration (invariant by construction, MS-0MVK4E5M00021XEY).**
  `MainStreetRendererStreet.ts` `renderCard` registers the hand card
  container as a `@ui/dragDrop` draggable (named `ms-hand-card-<id>`); the
  market row registers its own containers as `ms-market-card-<id>`. Both are
tracked in `renderer.dragDropRegistered`, and each refresh path unregisters
**only its own origin**: `refreshMarket` calls `unregisterDragDraggables`
(market-origin scope) and `refreshPlayerHand` calls
`unregisterHandDraggables` (hand-origin scope) before its rebuild destroys
the containers. A market-only refresh — e.g. the debug cheat overlay calling
`refreshMarket()` alone, or any future partial refresh — therefore leaves the
live hand containers registered and draggable, so the invariant does **not**
depend on the `refreshMarket` → `refreshPlayerHand` call order. Neither step
leaves destroyed/stale containers in the registry (no stale registrations
after any refresh path); see the code comment where the scoping is enforced
in `MainStreetRendererDragDrop.ts`.
- **Pickup gate (AC1/AC2).** `canPickUpHandCard` vetoes the drag with illegal
  feedback when the phase is not `market`, when a *different* card's
targeting / selection is pending, when tutorial gating (`apply-upgrade` /
  `place-business`) forbids it, when no eligible business exists on the street
  (upgrade), or when no affordable empty slot exists (business; action budget
  spent for held cards). A same-week composite (card just moved to hand this
  week) may be picked up at 0 actions to mirror the click-path premium
  placement. **Click-select then drag:** a click on a hand card arms
  `uiPhase === 'placing-from-hand'` with `pendingHandIndex`, and pickup is
  allowed for exactly that selected card — the drag continues the selection
  instead of being vetoed. Picking up a *different* hand card, or dragging in
  `placing-from-hand` with nothing pending, stays vetoed; deselecting (back to
  `uiPhase === 'market'`) restores normal pickup.
- **Drop handler (AC4).** `canDropHandCard` gates the drop zone (upgrade →
  the eligible business via `canPlayUpgradeFromHand`; business → an empty
  affordable slot via `canPlaceFromHand`, same-week premium included). The
  successful-drag handlers reuse the click-path post-drop source of truth:
  `onDragDropHandUpgrade` → `applyHandUpgradeToSlot` (hand→street transfer,
  undoable `playUpgradeFromHandCommand` — same-week composite free, held = 1
  action, level-up burst) and `onDragDropHandBusiness` → the shared
  `onSlotClick` hand-placement flow (listed cost, or the composite-premium
  explainer when 0 actions remain — exactly as the click path). Invalid drops
  snap the card back with illegal feedback and spend nothing.
- **Highlights (AC3).** `showDragHighlights` / `refreshDragDropZones` resolve
  the dragged card id from the HAND first (id → handIndex, then the market),
  so a hand-origin drag paints the shared `dragHighlightRects` correctly:
  upgrades → street businesses passing `canDropHandCard` (green `0x44ff66` /
  red `0xff4444`), businesses → empty slots; non-target slots are skipped.
  Upgrade drags are ownership-aware in competitive mode
  (MS-0MVZC5V6L001OOXN): a business owned by another seat
  (`getSlotOwnerId()` ≠ `state.activePlayerId`, gate:
  `canActiveSeatActOnSlot()`) is skipped entirely, so AI-owned businesses are
  never painted green or red. Single-player states are unaffected.
- **Replay / reduced motion.** Registration is skipped in replay mode; the
  drag manager's `setReducedMotion` governs snap-back, unchanged.

### Resource pop feedback (coins / reputation)

- Trigger: whenever HUD coin or reputation value changes.
- Helper: `popTextOrIcon()` from `src/ui/popTextOrIcon.ts`.
- Timing target: ~1500ms (~1.5 seconds).
- Motion: upward rise + fade + scale pop.
- Non-blocking: animation runs asynchronously and does not block game logic flow.

Example:

```ts
void popTextOrIcon({
  scene: this,
  target: deltaText,
  duration: 1500,
  riseY: 22,
  scale: 1.2,
  reducedMotion: this.settingsPanel?.reducedMotion,
});
```

### HUD resource anchors — single source of truth for flight destinations

(MS-0MUYT57J80021CWW)

- **Problem.** The HUD strip renders `Coins: N` left-aligned at
  `hudLeft + 10` and `Reputation: N` at `favourBandRight + 40`; those edges
  come from the SLL layout and the viewport, not fixed fractions of the
  screen width. Every coin/reputation → HUD flight used to target hard-coded
  `gameW * 0.25 + 70` (coins) / `gameW * 0.5` (reputation) coordinates, so
  the flights only coincidentally landed on the counters — most visibly for
  reputation, whose number sits near the right of a label that can be wider
  than the assumed position — and read as coins "missing" the counter.
- **Published anchors.** On every `refreshHud()` the render computes and
  publishes two live anchors on the scene:
  - `scene.hudCoinAnchor = { x, y }` — the centre of the **numeric portion**
    of the `Coins: N` label (`label.x + prefixWidth + numberWidth/2`), at the
    strip baseline `hudY`.
  - `scene.hudRepAnchor = { x, y }` — the same for `Reputation: N`.

  Widths are measured from the label's own Phaser canvas context
  (`measureTextWidth`), so the anchor uses the exact glyph metrics the label
  renders with. Anchors are recomputed on every HUD render, including
  viewport/window changes (`handleResize` → `refreshAll` → `refreshHud`), so
  later flights always target the current number positions.
- **Consumers.** Every coin/reputation → HUD flight resolves its destination
  through `hudFlightTarget(scene, kind, layout)`
  (`MainStreetAnimatorContext.ts`): the income collection
  (`animateIncomeCollection`), the phased collection (`collectIncomeGrids`),
  the `upcoming` phase (`runIncomePhase`), the incident-reveal delta bubbles
  (`animateIncidentReveal` → `animateIncidentDeltaBubbles`) and the sell
  refund (`animateSell`). The HUD delta pop (`animateHudValueChanges`) is
  passed the same anchor `x` from `refreshHud`. In competitive play the three
  **income** routes among these delegate to `flightTargetFor` instead, which
  keeps the human seat on `hudFlightTarget` and retargets AI-owned slots to
  their own seat anchor (see *Per-seat anchors and per-owner destination
  resolution* below); the incident-reveal bubbles and the sell refund (which
  concern the acting / human seat) keep the shared HUD anchor as documented
  here.
- **Fallback.** Before the first HUD render (`hudCoinAnchor` /
  `hudRepAnchor` still `null`) `hudFlightTarget` falls back to the legacy
  approximate coordinates, now centralised in `hudCoinFallback` /
  `hudRepFallback` (`MainStreetConstants.ts`) — so no
  `MainStreetAnimator*` module hard-codes a HUD-flight destination. The
  non-HUD `gameW * 0.5` uses (the `upcomingSource` queue origin and the
  centred phase label) are unaffected.
- **Presentation-only.** The anchors are display state: they never mutate
  game state, the transcript, or the deferred-mutation window; reduced-motion
  and replay/headless modes remain flight-free exactly as before. The anchor
  is captured at flight launch; a number that grows during the display-only
  count-up is handled by MS-0MUYAESVU007X2U8, not here.

#### Per-seat anchors and per-owner destination resolution

(MS-0MW083MAN004JSCH, MS-0MW083O38005B22F; parent MS-0MVWNS9L7007CTK9 AC2/AC3)

In competitive (N ≥ 2) play the shared HUD counters belong to the **human**
seat only, so every income flight that used to land on them resolves its HUD
side by the **owning seat** instead:

| Slot owner | Coin flight destination | Reputation flight destination |
|---|---|---|
| `0` (human) / no owner | `hudFlightTarget(s, 'coin', layout)` → `scene.hudCoinAnchor`, else `hudCoinFallback` | `hudFlightTarget(s, 'rep', layout)` → `scene.hudRepAnchor`, else `hudRepFallback` |
| `≥ 1` (AI seat) | `scene.hudSeatAnchors[ownerId]`, else `hudSeatFallback(layout, ownerId, seatCount)` | the same seat cell (one summary row = one bank) |

- **Published per-seat anchors.** `renderCompetitiveScoreboard`
  (`MainStreetRendererCompetitiveHud.ts`) publishes
  `scene.hudSeatAnchors: Record<playerId, { x, y }> | null` on every render —
  one live anchor per drawn row, keyed by `playerId`: the row's own centre `x`
  (`hudLeft + colWidth * index + colWidth / 2`) and row baseline `y`
  (`hudY - HUD_BAR_HEIGHT_PX / 2 - HUD_SEAT_ROW_OFFSET_PX`). That is the same
  anchor shape and lifecycle as `hudCoinAnchor` / `hudRepAnchor`, but per seat
  instead of shared.
- **Cleared with the transient HUD.** The map is **reassigned** (never merged)
  on each render, so a shrunk roster or a re-layout cannot leave stale seat
  geometry, and `refreshHud()` sets it back to `null` before re-rendering. It
  is `null` before the first competitive render, and single-player runs never
  publish it. Consumers must therefore treat it (and the roster hint) as
  optional.
- **Fallback.** While no anchor has been published (first frame, or the
  scoreboard was cleared mid-window) the deterministic, total
  `hudSeatFallback(layout, seatIndex, seatCount)` (`MainStreetConstants.ts`)
  resolves the same cell the renderer will draw: the evenly-divided HUD strip
  band centre at the shared row baseline, with `seatIndex` clamped inside the
  band. `seatCount` comes from `state.playerCount` / `state.players.length`
  when known, else `HUD_FALLBACK_SEAT_COUNT` (`4` = human + `MAX_AI_OPPONENTS`),
  always widened to at least `ownerId + 1` so an out-of-range owner still
  resolves its own cell. A partial layout degrades to the viewport width rather
  than a non-finite coordinate. `HUD_SEAT_ROW_OFFSET_PX` is shared by the
  renderer and the fallback so the two cannot drift.
- **Resolver.** `flightTargetFor(host, kind, layout, ownerId)`
  (`MainStreetAnimatorContext.ts`) sits next to `hudFlightTarget`:
  owner `0` (and every owner-less / legacy slot) delegates to
  `hudFlightTarget` unchanged, so **single-player behaviour is identical**; an
  AI owner reads the published seat anchor and falls back to
  `hudSeatFallback`. `hudFlightTarget` itself remains the only way to reach the
  shared counters — the anchor-source guard
  (`tests/main-street/hud-anchor-source-contract.test.ts`) still keeps every
  HUD-flight destination literal out of `src/scenes/MainStreetAnimator*`.
- **Consumers.** The three income routes that were HUD-bound — the grid → bank
  **collection** (`collectIncomeGrids`), the reputation phase's card → rep-bank
  pips (`flyRepPips`) and the `upcoming` coin/reputation flows
  (`flyCoinsToPoint` / `flyRepPips`) — all resolve through `flightTargetFor`.
  Owner identity travels as `SlotPhaseBreakdown.ownerId` (populated by
  `applyCompetitiveIncome`, absent for the single-player `applyIncome` path and
  for legacy constructors) and becomes `IncomePhaseSlot.ownerId` inside
  `animateIncomePhases`. Non-HUD flights (base/synergy/event landings on each
  seat's own card grid, and the non-HUD `gameW * 0.5` uses — the
  `upcomingSource` queue origin and the centred phase label) are unaffected.
- **Swappable anchor seam — not the animator.** The AI "bank" is, for now, the
  seat's own competitive-scoreboard summary row: a documented **stopgap**
  until a real AI bank exists. A future real AI bank replaces **only the anchor
  source** — the `hudSeatAnchors` publication (and, if it changes geometry, the
  `flightTargetFor` AI branch) — and never the animator, which keeps resolving
  every destination through `flightTargetFor`. Both coin and reputation share
  the seat cell because a row is one text object today; distinct per-seat
  coin/rep sub-anchors are an anchor-source change, not an animator change.
- **Related work (linked).** The per-seat closing choreography that produced
  this destination gap is `MS-0MUYFXA36009EMH0` (parent
  `MS-0MUXAQQON006XA6I`); the scoreboard rows the AI flights now target are
  `MS-0MUTU8J9T0034OT7`; the single shared HUD anchor contract this seam
  extends per seat is `MS-0MUYT57J80021CWW`; the owner identity is carried by
  `MS-0MW083KRZ009NJTA` and the per-owner resolver by `MS-0MW083O38005B22F`.
  The fuller per-seat **Turn Summary** is the competitive portion of the
  unified tabbed P&L overlay delivered by `MS-0MVRNV9Y8008IKGK` (competitive
  summary rows end-to-end) and `MS-0MW5ER6HC000HVQ8` (tabbed P&L overlay),
  parent `MS-0MVO1SFCM000ZLBI` (End of Turn summary dialog for competitive
  mode) — see
  [Competitive Turn Summary panel](#competitive-turn-summary-panel-per-seat-round-rows-ms-0mvrnv9y8008ikgk);
  that panel consumes `TurnResult.playerRoundLedger` and does **not** change
  this flight routing.
- **Tests.** `tests/main-street/income-owner-flight-routing.test.ts`
  (owner-aware destination resolution: human → HUD anchor, AI → seat anchor)
  and `tests/main-street/competitive-seat-anchors.test.ts` (per-seat anchor
  publication, clearing, fallback) pin the contract; the collection /
  reputation / `upcoming` animator suites cover the routing per route.

### Ambient street pedestrians (reputation crowd, MS-0MTV9AS15004AC1E)

- Purpose: give reputation a persistent, diegetic on-street presence. The
  street is always alive with a crowd of small solid-colour silhouette
  figures ("pedestrians") whose number scales with the player's reputation.
- Population rule (pure, uncapped): `pedestrianCount(reputation)` in
  `src/scenes/MainStreetPedestrians.ts` = `floor(reputation / 50)`, floored
  at 0 and **uncapped** (producer decision). The ratio is the named constant
  `PEDESTRIAN_REP_RATIO` (50) and the silhouette colour is
  `PEDESTRIAN_COLOR` (`#88bbff`), matching the existing reputation pip
  language.
- Rendering: one runtime-generated silhouette texture
  (`PEDESTRIAN_TEXTURE_KEY`, `graphics.generateTexture`) is shared by every
  figure; the layer is parented to the street container so it pans and clips
  with the map camera.
- Road-lane walking (MS-0MUZ4WB290024ZGQ, polished by MS-0MUZ6CGSV002WTYM):
  figures walk **only on the road bands** between and around the street cells —
  they follow the road network (`buildRoadNetwork`) of intersections and
  segments, never crossing a business cell. Each figure keeps to **one side of
  the road** — a per-figure perpendicular lane offset
  (`pedestrianLaneOffset`, `lanePoint`) — so they do not walk down the
  centre-line.
- Deliberate shop entry (MS-0MUZ6CGSV002WTYM, spread MS-0MUZ9CKT60094CXO,
  nearest-cell targeting MS-0MUZ9O1I00088JF2): a walking figure always
  resolves the **nearest occupied cell** (`nearestShop`, by cell-centre
  distance) — re-resolved every frame, so a cell filled mid-turn or any nearer
  cell is picked up — and walks the road network toward that cell's entry
  intersection (`nearestNodeToShop`, greedy `chooseNextToward`). On reaching it
  (`withinShopCapture`) it switches to `entering` and **walks** to a
  per-figure random point inside the cell (`beginShopEntry`,
  `stepPedestrianFigure`), becoming `inside` only on arrival — it never
  teleports. The random interior destination means a crowd in one business
  **spreads across it** rather than converging on one spot. Once inside it
  stays there.
- Crowd persistence (MS-0MUZ6CGSV002WTYM): a street rebuild (e.g. a card being
  played) re-parents the layer around the **existing** figures
  (`attachToStreet`), keeping each figure's position, lane and mode; the crowd
  does not reset.
- Live population rule: while a turn is in progress the crowd tracks the
  authoritative HUD reputation value — the same `animateHudValueChanges`
  reputation path that renders the HUD delta reconciles the layer to
  `pedestrianCount(reputation)`. Gains fade a figure in and losses fade a
  figure out (`PEDESTRIAN_FADE_MS`), and reconciliation is delta-only
  (retained figures keep their identity — the layer never rebuilds). New
  figures enter spread around the block perimeter (see below).
- Balanced entry distribution (MS-0MUZH6P0M00443G0): figures no longer enter
  only at the four block corners. `spawnPedestrianFigure` places each figure
  with `perimeterSpawnPoint`, which cycles the four sides of the road-network
  perimeter (`PEDESTRIAN_SPAWN_EDGES`: top → right → bottom → left) via a
  stratified round-robin on the spawn ordinal, then picks a random segment of
  that edge and a random position along it — including **mid-edge** positions.
  The ordinal is the running crowd size, so the distribution stays balanced on
  every spawn path: initial creation, `startNewTurn()` respawn, and mid-turn
  population reconciliation (`setPopulation` gains / `reconcile`). The position
  is interpolated along the edge's road lane, so every spawn still starts on a
  road lane heading along a valid road segment, and figures still seek the
  nearest occupied cell (`nearestShop`) — an evenly spread entry therefore
  yields a crowd spread across the shops rather than clustered in one.
- Turn lifecycle (MS-0MUZ4WB290024ZGQ, polished by MS-0MUZ6CGSV002WTYM): at the
  end of the turn `MainStreetPedestrians.beginEndOfTurn()` sends every
  non-shopping figure **walking off the block** (`directFigureOffBlock`, removed
  once clear) rather than vanishing in place, while enough figures walk into
  occupied shops. At the start of the new turn (`startTurnPhase`)
  `startNewTurn()` clears any leftovers and spawns a fresh set spread around
  the four edges of the block perimeter (`perimeterSpawnPoint`,
  `PEDESTRIAN_SPAWN_EDGES`) rather than only at the corners (`network.corners`).
- Reputation income conversion (MS-0MUYGFWXK003QFYB, reworked by
  MS-0MUZ4WB290024ZGQ / MS-0MUZ6CGSV002WTYM): the phased income show's
  `reputation` phase no longer starts its coin flight at the HUD reputation
  counter. `MainStreetPedestrians.dissolveIntoCoins(targets)` first directs at
  least `PEDESTRIAN_MIN_SHOP_RATIO` (25%) of the live crowd to **walk** into
  occupied cells (`prepareForIncomePhase` → `assignShopShoppers`, teleport-free),
  then returns a coin origin per business from a figure **inside that
  business** (falling back to a figure walking into it, then any shopper, then
  a street-area anchor (`pedestrianStreetAnchor`) **never** the HUD counter).
  The credited amounts (`iconsForAmount(repBonus)`), the on-card `revealInGrid`
  landing and the `+total` pop are unchanged — the pedestrians are a visual
  source only, so the phase-sum invariant and the deferred-mutation economy
  are untouched. Pacing (MS-0MV8LHN0W0017XU1): all producing businesses'
  reputation flights launch near-simultaneously with only
  `INCOME_FLIGHT_STAGGER_MS` (60ms) between businesses (no per-business
  `getCardDelay` accumulation and no full-grid pause), mirroring the synergy
  phase; the inter-phase gap (`INCOME_PHASE_GAP_MS`) is unchanged and the
  gentle per-card flight-duration decrease is retained.
- Presentation-only: the layer never mutates game state, the transcript or
  the turn flow; every method is defensive (a throwing layer is swallowed)
  so a bad frame can never stall the turn.
- Determinism / no gameplay RNG: wander motion uses a module-local seeded
  presentation PRNG (`createPresentationRng`, mulberry32,
  `PEDESTRIAN_RNG_SEED`) — never the seeded gameplay RNG or `Math.random`;
  seeded determinism and headless/AI parity are preserved.
- Accessibility and non-rendering modes: with Reduced Motion enabled, or in
  replay/headless mode (`scene.replayMode`), `shouldRenderPedestrians()`
  returns false and the layer renders nothing (no figures, no dissolve, no
  flights); the existing text/HUD feedback is unchanged.
- Performance (MS-0MUYGFXMK009L1UU): the count is uncapped by producer
  decision; a single shared texture and constant per-figure work (position +
  bob) keep the frame cost low. Measured per-frame **model** cost (pure step
  loop, 16-core host, 60 fps): 10 figures ≈ 0.003 ms, 100 figures ≈ 0.007 ms,
  1,000 figures ≈ 0.013 ms and 10,000 figures ≈ 0.13 ms per frame — all
  negligible against a 16.6 ms frame budget. The measurement covers the
  per-figure model update, not GPU sprite rendering; at representative
  reputations (tens of figures) the layer is immaterial, so the uncapped
  population remains an accepted risk rather than a blocker.

#### Lifecycle and attach contract (MS-0MVRMI1EQ002I24K)

Every link below is load-bearing: break one and the layer renders nothing,
**silently**, because every method is defensive (a thrown layer failure is
swallowed so it can never stall a turn). Preserve this contract when changing
the street renderer, the scene boot path or the HUD refresh.

- **Owning module:** `src/scenes/MainStreetPedestrians.ts` — the
  `MainStreetPedestrians` layer class plus its pure helpers (`pedestrianCount`,
  `shouldRenderPedestrians`, road network and shop occupancy).
- **Construction sites:** `MainStreetLifecycleManagerLifecycle.create()`
  assigns `s.msPedestrians = new MainStreetPedestrians(s)` twice — once in the
  pre-reset helper block and once in the post-scaffolding block. The
  post-scaffolding instance is the live layer (it is the one the HUD refresh,
  rebuild attach hook and scene update loop see); the earlier assignment keeps
  reset/early lifecycle callbacks safe before the scaffolding exists. Keep
  both assignments and do not add a third construction path.
- **Teardown, resize and frame drive:** the layer is destroyed on scene
  `SHUTDOWN` (`MainStreetLifecycleManagerLifecycle`), re-clamped on resize
  (`resize()`), driven each frame from `MainStreetScene.update()`
  (`msPedestrians.update(delta)`), and opened/closed by the turn hooks
  `MainStreetTurnControllerTurnFlow`: `startNewTurn()` on a new day,
  `beginEndOfTurn()` at end of turn, plus `dissolveIntoCoins()` in the
  `reputation` income phase.
- **Attach hook (street rebuild):** `MainStreetRendererStreet.refreshStreetGrid()`
  calls `streetContainer.removeAll(true)`, which destroys the layer's
  container along with the rest of the street. Its **last** step is therefore
  `s.msPedestrians?.attachToStreet?.()`. It must stay last: an early return,
  reorder or thrown step between the `removeAll(true)` and the attach leaves
  the layer detached (no crowd), and attaching before the roads/slots would
  render it underneath them. `attachToStreet()` is idempotent and re-parents
  the **existing** figures (positions, lanes, modes preserved), spawning only
  when `targetCount > 0` and no figures exist yet.
- **Population is reconciled only from the HUD path:**
  `MainStreetAnimatorIncome.animateHudValueChanges()` — reached from
  `MainStreetRendererHud.refreshHud()` — calls
  `syncPedestrianPopulation(scene, reputation)`, which calls
  `msPedestrians.setPopulation(pedestrianCount(reputation))`. `setPopulation()`
  is the **only** path that raises the layer's target count; nothing else sets
  it. If that path is skipped, early-returned, or fed a falsy reputation, the
  layer stays attached with a zero target and renders no figures — silently.
- **Modes that render nothing:** `shouldRenderPedestrians()` (used by
  `isEnabled()`) returns false when Reduced Motion is enabled or the scene is
  in replay/headless mode (`scene.replayMode`). In those modes the layer
  renders nothing at all — no figures, no dissolve and no reputation coin
  flights — and the text/HUD feedback is unchanged. Normal play (default
  settings, Reduced Motion off, not replay) must render the crowd.

#### Root cause note for the reported regression (MS-0MVRDVVH4001048Q)

The crowd was reported missing in `MS-0MVRDVVH4001048Q`, but the scene-level
guard is green on both the released `v0.1.22` build and on `dev`, so this
repository has no integration defect to restore: the only demonstrated way to
lose the crowd is to stop the HUD-path reconciliation above (zero target ⇒ an
attached layer renders nothing, with no error).
`tests/main-street/pedestrians-scene-visibility.browser.test.ts`
(`MS-0MVRMHTW6006KQKI`) pins that contract against a real scene boot and a
street rebuild.

### End-of-turn income presentation (phased coin-grid animation, CG-0MT23O6W8003AXWJ)

- Trigger: `MainStreetTurnController.endTurn()` after `processEndOfTurn()`
  resolves with `income.total > 0` (CG-0MSRGTUSK003GDGE).
- Primary helper (non-tutorial play):
  `MainStreetAnimator.animateIncomePhases(perSlotBreakdown, options)` — a
  phased choreography that breaks the income into its contribution phases
  (`IncomeResult.phaseBreakdown`, child 1) and reveals each phase in order:
  **base → synergy → reputation → events → upcoming → collect**.
  - Each producing street slot hosts an on-card coin grid
    (`createCoinGrid`, child 2) anchored to the card's left inset;
    the grid is left-aligned and grows rightwards (row-major,
    left→right, top→bottom) as base coins count out (staggered reveal,
    rounded to nearest whole coin at the animation layer only). Base income
    EXCLUDES board adjacency synergy: `SlotPhaseBreakdown.baseIncome` is
    base-only and `synergyBonus` carries the synergy
    (CG-0MTV6LZEA003YS3E), so the per-slot phase sum still equals the
    credited total.
  - Synergy contributions travel as coin flights ALONG the synergy lines
    (CG-0MTV6LZEA003YS3E): for every pair (`computeSynergyPairs`) BOTH
    directions animate — one stream from each card's clipped slot edge
    (`p1`) to the other's (`p2`), reusing the shared
    `synergyLineEndpoints` geometry so animated lines never drift from the
    static lines. Each traversal takes `INCOME_FLIGHT_MS` (600ms) with a
    60ms per-line stagger (`INCOME_FLIGHT_STAGGER_MS`). Each direction
    carries the receiver's per-neighbour share of its `synergyBonus`
    (`attributeSynergyShares`, split so the shares sum exactly to the
    credited bonus) and lands in the receiver's `CoinGrid` via
    `revealInGrid` with `sfx-coin-pop`.
  - Reputation contributions fly into the grids from the on-street
    pedestrians (see *Ambient street pedestrians* above), launched
    **near-simultaneously across all businesses** (MS-0MV8LHN0W0017XU1):
    only `INCOME_FLIGHT_STAGGER_MS` (60ms) separates one business's
    reputation flight from the next — mirroring the synergy phase — so the
    reputation income reads as one collective event instead of crawling from
    card to card; event contributions fly in/out of the grids and also light
    up their `Upcoming`-panel effect lines (`animateUpcomingEffectLine`).
  - **Upcoming phase routing (CG-0MUA1UH3A008M4BS).** The `upcoming` phase
    animates the end-of-turn Upcoming-card (incident/event) coin AND
    reputation deltas using **one uniform sign rule** for both resources
    (incident-reveal convention, CG-0MU41XVNV002N2D9, as clarified by the
    producer's manual review 2026-10-01): a card that **gives** coins or
    reputation flows **card → HUD**; one that **costs** flows **HUD → card**.
    - **Actor** (derived from the source `EventCard.target`) — the affected
      **business card** when the effect is attached (`SpecificSynergy` /
      `RandomBusiness`, i.e. `upcomingDeltas[i].attachedSlotIndex` is a
      number), otherwise the **Upcoming panel** (`target = All`).
    - **Coins** — every coin delta flies point-to-point between the actor and
      the **HUD coin counter** (`flyCoinsToPoint`), never via a business coin
      grid: a **gain** actor → HUD, a **loss** HUD → actor. (The on-card coin
      grid is reserved for credited income and is drained by the collection
      phase; Upcoming deltas never accumulate in it.)
    - **Reputation** — same actor and same direction rule, flying silent
      reputation pips between the actor and the **HUD reputation counter**
      (`flyRepPips`, matching the reputation income phase).
    - **Direction convention** (AC1/AC2/AC3): `gain = actor → HUD resource`,
      `loss = HUD resource → actor`. The pure decision is `resolveDeltaFlow`
      in `MainStreetAnimatorContext.ts`; the routing descriptors (with
      `kind` and `attachedSlotIndex`) are populated by `attachUpcomingDeltas`
      (`MainStreetAdjacencyScoring.ts`) from the resolved incident in
      `processEndOfTurn`. This supersedes the earlier coin-accumulation rule
      (attached gains landing on the card grid) and the reputation-only
      correction of the first rework.
    - **Presentational only** (AC4): the descriptors are additive and are
      deliberately **excluded** from `creditedIncomeTotal`, so the income
      phase-sum invariant (`base + synergy + repBonus + eventDeltas` = credited
      total) and the deferred-mutation economy are unchanged; reduced-motion
      and replay/headless modes keep their no-flight exemption.
  - **Empty phases are skipped (MS-0MUYT436C005B4QN).** A phase with no
    non-zero contribution across the producing slots is skipped outright: no
    phase label is shown and no `INCOME_PHASE_GAP_MS` gap is consumed for it.
    Emptiness reuses the exact per-phase predicate each `runIncomePhase` case
    uses — base = no slot with `baseIncome > 0`; synergy = no
    `synergyPhaseFlights`; reputation = no slot with `repBonus > 0`; events =
    no `eventDeltaEffects`; upcoming = no slot with a non-zero `upcomingDeltas`
    entry — so a skipped phase can never hide a contribution the flights would
    have shown. Non-empty phases keep the canonical order (base → synergy →
    reputation → events → upcoming) and the standard gap between consecutive
    *scheduled* phases; `collect` always runs after the last scheduled phase
    (immediately after `startDelayMs` when every phase is empty, so the day
    never hangs). `onPhase` fires only for scheduled phases plus `collect`,
    reporting the scheduled position (empty phases are not reported).
  - Phase pace: `INCOME_PHASE_GAP_MS` (default 2200ms) between **scheduled**
    phases. The show's total length is the sum over scheduled phases only, so
    an empty phase no longer adds a gap — the previous fixed ~11s figure
    (5 phases × 2200ms) applies only when every phase is non-empty, and is
    **superseded for empty phases** by the skip semantics above. Non-empty
    pacing is unchanged and the turn controller still defers the week start
    until the show completes, so gameplay timing is unaffected.
  - Non-blocking (AC9): VFX only — never mutates game state, the transcript,
    or the turn flow; every step is defensive and failures are swallowed so
    the turn always advances (a throwing animator cannot stall the week).
- Tutorial-mode helper (unchanged compact path):
  `MainStreetAnimator.animateIncomeCollection()` — the window-safe
  coin-fly-to-HUD used during the tutorial (the phased choreography is
  gated to non-tutorial play so E2E tutorial pacing is untouched, mirroring
  the week-banner skip precedent).
- SFX: per-action sounds via the scene `SoundManager` — staggered
  `SFX_KEYS.COIN_POP` (`sfx-coin-pop`) per count-out coin and per flight
  (`moveGameObject`'s `sfx.start`), and a final `SFX_KEYS.INCOME_POSITIVE`
  (`sfx-income-positive`) on collection. All keys follow the shared
  `COMMON_SFX_KEYS` convention (`sfx-` prefix, no game-scoped literals).
- Landing: collection finalizes with a `+total` pop (`popTextOrIcon`) at
  the coin counter. While the show is running
  (`scene.incomeCollectionActive === true`) the immediate HUD delta pop is
  suppressed so the final pop is the single landing feedback — the income
  sound/event routing (`income-gained` → `sfx-income-positive`) still runs.
- **HUD totals tick ONLY at HUD-bar arrivals (MS-0MUYAESVU007X2U8).** While
  the deferred window is active the HUD renders a pair of display-only running
  totals (`displayedCoins` / `displayedReputation`) instead of the static
  pre-animation value. Producer contract (manual review 2026-10-16): *the
  number ticks up only when the money is animating to the HUD — each time a
  coin reaches the HUD bar location the count ticks up.* So the total is
  **not** moved while coins/reputation are counted onto the business card
  grids (base / synergy / events phases); it moves only when a flight whose
  destination is the HUD arrives:
  - **coins** — the grid-to-HUD **collection** (`collectIncomeGrids` steps
    `displayedCoins` per icon landing) and gain flights to the HUD counter
    (`flyCoinsToPoint`);
  - **reputation** — the reputation-income pips flown card → HUD rep counter
    in the **reputation** phase (`runIncomePhase` calls `flyRepPips` with the
    income share), plus the Upcoming pip flights (`flyRepPips`) and the
    incident-reveal bubbles.
  Loss flights (HUD → card/panel) step **down** at departure. The totals
  start at `previousCoins` / `previousReputation` when the deferred end-of-turn
  path opens and are snapped to the authoritative post-reconciliation values
  at the final landing (collection finalize / incident-reveal cleanup), so the
  total is exact — per-icon rounding and unanimated ongoing costs are absorbed
  there. Presentation-only: nothing touches `state`, the transcript, or the
  deferred-mutation guards; the tutorial and replay/headless paths never
  initialise the counters, so they keep the existing instant-final fallback.
  Reduced motion **does** initialise them (MS-0MW20KSEG001DH1X): it takes the
  deferred closing path, and its counters land on the authoritative values at
  the instant collection, so the HUD still shows the exact post-delta totals.
  The incident's reputation share is flown once (the `upcoming`
  phase) and re-enacted by the reveal bubbles, so it is counted once
  (`scene.displayedIncomeCounted` guards the replay); the reputation phase
  therefore excludes the incident share from its HUD pip flight.
- **Per-owner destinations and human-only feedback (competitive,
  MS-0MW083O38005B22F / MS-0MW083PZ8001QEHS).** In competitive play the three
  HUD-bound income routes resolve their HUD side by the slot's owning seat
  through `flightTargetFor` (see *Per-seat anchors and per-owner destination
  resolution* above): the grid → bank **collection**
  (`collectIncomeGrids`), the reputation phase's card → rep-bank pips
  (`flyRepPips`) and the `upcoming` coin/reputation flows (`flyCoinsToPoint` /
  `flyRepPips`, routed per owner only when deltas are present).
  - **Owner identity.** `SlotPhaseBreakdown.ownerId` (populated by
    `applyCompetitiveIncome`) survives the competitive closing's combined
    phase-major sweep and becomes `IncomePhaseSlot.ownerId` in
    `animateIncomePhases`. An absent owner means owner `0`, so single-player
    and legacy phase data are unchanged.
  - **Human-only feedback.** The shared HUD's display-only running totals
    (`displayedCoins` / `displayedReputation`), its `+/-` delta pop and its
    `+total` landing pop are human-only: `ownsSharedHudFeedback(ownerId)`
    (`MainStreetAnimatorContext.ts`) gates the per-icon display stepping, so an
    AI flight carries **no display delta** and can never tick the human
    counters or pop a human-counter delta. The immediate HUD delta pop is also
    suppressed while the show runs (`incomeCollectionActive`), so the human
    never sees a combined multi-seat total at their own counter.
  - **Per-owner `+total`.** The collection's landing pop is emitted **per
    owning seat** at that seat's own target, from that seat's own credited
    amount instead of one combined multi-seat total. A human-only collection
    (single-player, or every slot owned by the human) keeps the unchanged
    legacy pop: one `+total` with the authoritative combined credited total at
    the HUD coin anchor. A net-zero / net-loss seat has no positive total to
    report and is suppressed. The `sfx-income-positive` landing sound is
    unchanged.
  - **Bounds unchanged.** Presentation-only: the engine economy, the closing
    order (Income → Incident → EndCheck), the shared-incident semantics, the
    transcript, RNG and the deferred-mutation window are untouched;
    `creditedIncomeTotal` and the `upcomingDeltas` exclusion are unchanged;
    reduced motion, replay/headless and tutorial paths remain flight-free
    (reduced motion's closing is deferred but its phases finalize instantly).
- Week-start deferral: the controller waits on `incomeCollectionActive`
  (via the shared wall-clock `deferUntilIncomeCollected` helper) before
  starting the next week, so the street refresh + HUD update never cut the
  show short; the street render itself is deferred via
  `refreshAllExceptStreet` while the show runs. The helper re-checks the flag
  on a 250ms scene-clock cadence and bounds the wait with a 16s **wall-clock**
  cap (MS-0MVMKEU2000639TG): under CPU starvation, or in a hidden/backgrounded
  document, the day start is forced once 16s of wall time have elapsed instead
  of waiting for the frame clock to catch up. Pacing itself is unchanged.
- Accessibility (reduced motion): the coin grids and flights are skipped;
  the phase labels still progress and the single final pop + income sound
  still play.
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — never
  mutates state or transcript; returns immediately in replay/headless mode
  (`scene.replayMode`), no rendering or audio.
- Reuse: `createCoinGrid` (`src/coin-grid.ts`) +
  `moveGameObject` + `SoundManager` + `popTextOrIcon`; no new engine
  infrastructure.
- Reuse: `moveGameObject` + `SoundManager` + `popTextOrIcon`, `SFX_KEYS`
  (`COMMON_SFX_KEYS` convention); no new SFX keys or engine infrastructure.

### Competitive phase-major closing presentation (MS-0MUXAQQON006XA6I)

In competitive (human-vs-AI) play the shared competitive closing is presented
**per seat, phase-major**, after the shared day resolves, instead of a single
condensed text-only summary.

- Trigger: `endCompetitiveTurnDay()` → `runCompetitiveClosing()` →
  `presentCompetitiveClosing()` (`MainStreetTurnControllerCompetitive.ts`).
- Phase-major animation: when the closing surfaces authoritative per-owner
  income (`TurnResult.playerIncome`, from `applyCompetitiveIncome`,
  non-eliminated seats only, in seat order) the presentation concatenates every
  seat's `income.phaseBreakdown.perSlotBreakdown` in seat order and calls
  `MainStreetAnimator.animateIncomePhases(combinedSlots)` **once** — the same
  phased choreography documented under
  [End-of-turn income presentation](#end-of-turn-income-presentation-phased-coin-grid-animation-cg-0mt23o6w8003axwj)
  (base → synergy → reputation → events → upcoming → collect). `runIncomePhase`
  walks the combined slot list per phase, so each phase plays for the human
  seat, then AI 1, then AI 2 before the next phase begins — rather than one
  full choreography per seat. The engine has already applied each seat's deltas
  to its `PlayerRecord`; the shared HUD's `incomeCollectionActive` gating
  preserves the deferred-delta window (the competitive scoreboard is not
  refreshed during the closing).
- Per-seat feedback text: the closing summary reports each seat's own income
  (`Player 1: +10 coins | Player 2: +7 coins`, built by
  `perSeatClosingSummary`), never the shared host total, which can differ from
  any seat's actual income. The human seat is included; eliminated seats are
  skipped.
- Incident reveal and day advance: delegated to the shared
  `presentTurnClosing` primitive (the **same** path used by single-player), so
  the single shared incident reveal and the next-day advance cannot drift. The
  shared income line is suppressed (`incomeSummary: ''`) because the per-seat
  lines replace it. In normal play the advance callback is the Turn Summary
  gate (below, `presentCompetitiveTurnSummaryGate`), so the closing hands over
  to the panel instead of starting the next day itself.
- Bounded / non-blocking (AC6): the primitive waits for the combined
  choreography to finish collecting before the day advances
  (`waitForIncomeCollection`), clamped to the global fast-forward bound
  (`COMPETITIVE_CLOSING_MAX_TOTAL_MS`) so a large roster cannot stall the game
  — once the bound is reached the closing stops waiting and advances the day.
  With no per-owner data the condensed shared summary is kept.
- Turn Summary gate (MS-0MVRNV9Y8008IKGK): the closing's completion callback is
  the gate, not the day advance — the owner-keyed per-seat panel appears once
  this presentation has finished and **[ Next Turn ]** starts the next shared
  day, so the day does **not** advance immediately. Reduced motion, replay and
  headless keep the advance-on-completion pacing described here, so this bound
  is unchanged for them. See
  [Competitive Turn Summary panel](#competitive-turn-summary-panel-per-seat-round-rows-ms-0mvrnv9y8008ikgk).
- Accessibility (reduced motion), replay and headless: the per-seat
  animations are skipped, the per-seat text is still shown and the day always
  advances on completion (no Turn Summary stop).
- Per-owner destinations: each seat's `SlotPhaseBreakdown.ownerId` survives the
  `flatMap` into the combined slot list, so the combined sweep keeps drawing
  each slot at its **own** seat's bank — the human's coins/pips land on the HUD
  counters, an AI seat's land on its own competitive-scoreboard summary anchor
  (see [HUD resource anchors](#hud-resource-anchors--single-source-of-truth-for-flight-destinations)
  → *Per-seat anchors and per-owner destination resolution*, and
  [End-of-turn income presentation](#end-of-turn-income-presentation-phased-coin-grid-animation-cg-0mt23o6w8003axwj)
  → *Per-owner destinations and human-only feedback*). Only the human seat's
  flights move or pop the shared HUD totals.
- Presentation-only: reads resolved state, consumes no RNG and mutates no
  engine state, so seeded replay determinism and the shared closing order
  (Income → Incident → EndCheck) are unchanged.

### Market deal-in (week-start refill / Discover / Research swap)

- Helper: `MainStreetAnimator.animateMarketDealIn()`.
- Trigger points (`MainStreetTurnController`):
  - `startTurnPhase()` — after the final (post-prewarm) market render, the
    single market row deals in (CG-0MSTOATDT009BRX2 merged the two rows).
    Skipped on checkpoint resume (`skipMarketRefill`), where the saved market
    is preserved.
  - `onRefreshMarketClick()` — after a successful refresh, the outgoing row
    cards fade/shrink out from their old slot positions (snapshot visuals via
    `createTransferCardVisual`) while the incoming row deals in.
- Behavior:
  - Incoming cards enter a "dealt" state synchronously in the same frame as
    the draw (scale 0.6, alpha 0.35, raised 24px — no flicker), then tween
    to full size/opacity with a staggered 80ms launch per card.
  - Each incoming card plays the shared deal SFX (`SFX_KEYS.DEAL`) via the
    scene `SoundManager` at launch.
  - Outgoing snapshots launch first (60ms stagger) and fade/shrink out over
    300ms, then are destroyed.
- Source positions: `MainStreetRenderer.getMarketSlotCenter()` mirrors
  `drawMarketRow`'s layout math; the rendered cards themselves come from
  `MainStreetRenderer.getMarketRowCards()` (rebuilt every `refreshMarket`).
- Accessibility: animation is skipped when Reduced Motion is enabled (cards
  appear instantly).
- Headless/replay exemption: returns immediately in replay/headless mode
  (`replayMode`) — presentation-only, never mutates game state or the
  transcript, and never blocks the turn flow.
### Incident reveal (flip + ~1920ms hold + delta bubbles)

- Helper: `MainStreetAnimator.animateIncidentReveal()`.
- Trigger: `MainStreetTurnController.endTurn()` when `TurnResult.incident` is
  non-null (after the final render).
- Resource deltas: `processEndOfTurn` surfaces the incident's own coin /
  reputation deltas on `TurnResult` (`incidentCoinChange` /
  `incidentRepChange`), captured around `resolveIncident()`.
- Behavior (reduced-motion OFF):
  1. A card-back-over-face container (`mainStreetRenderCardSvg` +
     `CARD_BACK_TEMPLATE`) is built at the face-down Upcoming card centre
     (`MainStreetRenderer.getFrontIncidentCardCenter()`).
  2. The container flies to the board centre (~550ms).
  3. The card back hinges open (`scaleX → 0`) to reveal the incident face.
  4. The face stays visible for **1920ms** (`INCIDENT_REVEAL_HOLD_MS`) so the player can read the
     incident. During the hold, resource-delta bubbles animate between the
     HUD score bar and the card: a **gain** starts at the card centre and
     lands on the HUD counter (`card → HUD`); a **loss** starts at the HUD
     counter and lands on the card (`HUD → card`). This applies to both the
     gold coin bubbles (`SFX_KEYS.COIN_POP`) and the silent blue reputation
     pips, and **both coordinate axes follow the sign** (CG-0MUA1UH3A008M4BS
     rework 3 — an earlier version moved only X, so a gain still travelled
     from the HUD's vertical band to the card and read as HUD → card). No
     bubbles when a delta is zero.
  5. The container returns to the Upcoming card centre and is destroyed;
     the reveal's `onComplete` then chains the week start.
- **Blocking timing (CG-0MTW18KFK000MM3I):** the reveal now **gates** the turn
  advance — `finishTurnPresentation` defers `startTurnPhase()` until the
  reveal's `onComplete` fires (flight + 550ms flip + 1920ms hold + 400ms
  return, then the existing income-show deferral or the ~800ms schedule).
  With no incident the reveal is skipped entirely and the ~800ms advance is
  unchanged (no delay, no animation).
- Accessibility (reduced motion): the flight, hinge flip and bubble travel
  are skipped — the card appears instantly face-up at board centre — but the
  1920ms hold, cleanup and `onComplete` are **preserved** so the player
  still has time to read the incident (producer-confirmed silent hold).
- **HUD totals count with the reveal (MS-0MUYAESVU007X2U8).** The reveal's
  delta bubbles step the display-only running totals like the `upcoming`
  phase flights do: a gain counts up as bubbles land on the HUD counter, a
  loss counts down as bubbles depart the HUD. Because the `upcoming` phase
  (which animates the same incident delta) already counted it in the phased
  show, the reveal is marked as counted (`scene.displayedIncomeCounted`) and
  the replay bubbles do not move the totals again — the final
  post-reconciliation snap still runs in the reveal's cleanup, which also
  covers the no-income show where the reveal bubbles are the only counting
  hook.
- Tutorial exemption: the reveal (and its hold) is skipped while the
  tutorial is active, preserving the tutorial's window-safe step pacing —
  the same precedent as the phased income show and the week banner being
  skipped during the tutorial.
- Legacy feedback removed: the red vignette flash, the `popTextOrIcon` HUD
  loss pops and the ⚠ indicator pulse are no longer part of the reveal. The
  warning sting SFX (`SFX_KEYS.INCOME_NEGATIVE`, `sfx-income-negative`) is
  retained as the reveal's sound effect per AGENTS.md rule 8 (optional
  secondary feedback per the parent AC); no new SFX key.
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Reuse: `mainStreetRenderCardSvg` + `animatePeekReveal` hinge pattern +
  `moveGameObject` + `SoundManager`; no new engine infrastructure.

### Synergy link formation

- Helper: `MainStreetAnimator.animateSynergyFormation()`.
- Trigger: `MainStreetTurnController` placement paths (`onDragDropBusiness`,
  `onSlotClick` place-from-hand, and the legacy direct-buy path) — each
  captures `computeSynergyPairs()` before the placement command and animates
  `diffNewSynergyPairs(before, after)` — ONLY newly-formed pairs animate;
  pre-existing pairs never re-trigger on a plain refresh.
- Geometry (CG-0MSVM3WCD007BRQP): both the static lines and the draw-in
  line use the shared `synergyLineEndpoints(pair, layout)` helper
  (`src/scenes/synergyLineEndpoints.ts`) — the
  centre-to-centre segment is clipped to the two SLOT rects, so lines run
  edge-to-edge for orthogonally adjacent slots and visually corner-to-corner
  for diagonally adjacent slots (extended-range pairs are clipped to the card
  boundaries; the straight line still crosses intermediate cells). There is
  no duplicated geometry to drift.
- Income conduit (CG-0MTV6LZEA003YS3E): the SAME clipped `p1`/`p2` geometry is
  reused as the path for the end-of-turn synergy coin flights, so the animated
  income streams ride exactly on top of the static lines (see
  [End-of-turn income presentation](#end-of-turn-income-presentation-phased-coin-grid-animation-cg-0mt23o6w8003axwj)).
- Behavior (reduced-motion OFF):
  1. The new synergy line fades in (same clipped edge/corner endpoints and
     colour as `MainStreetRenderer.drawSynergyLines()`, depth 10,
     alpha 0 → 0.7).
  2. A spark expands and fades at the pair midpoint.
  3. The two paired cards pulse (brief scale bounce) — street card
     containers are tagged with their slot index
     (`setData('streetSlotIndex', …)`) so the animator can find them.
  4. A "Synergy!" pop appears at the midpoint (`popTextOrIcon`).
  5. A chime SFX plays — reused `SFX_KEYS.INCOME_POSITIVE`
     (`sfx-income-positive`); no new SFX key (ToneForge pipeline untouched).
- Accessibility (reduced motion): the line draw-in, spark, and card pulse
  are skipped; the chime SFX and a minimal "Synergy!" pop are retained.
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Reuse: `synergyColor` + `SoundManager` + `popTextOrIcon`; no new engine

### Synergy link tooltip

- Content builder: `buildSynergyLinkTooltipInfo(grid, fromIndex, toIndex,
  sharedSynergy, config, soldSlots?, gridDims?)` in `MainStreetFormatting.ts`
  — a pure, headless-testable helper (mirrors `synergyLineEndpoints.ts`). It
  names the shared synergy type and, for EACH endpoint, states the per-turn
  coin and/or reputation effect of that one link:
  - **Coin** — the per-link marginal share
    (`effectiveBase × effectiveSynergyCoinBonus × config.synergyBonusPerNeighbor`),
    reusing `synergyCoinContributionPerNeighbor()` so the tooltip can never drift
    from `computeSynergyBonus()`. The engine rounds the card's TOTAL across all
    matching neighbours, so a per-link share is shown to at most one decimal and
    is documented as an approximation.
  - **Reputation** — synergy flows FROM the neighbour (`computeSynergyRepBonus`
    sums the neighbour's `synergyRepBonus`), so each endpoint's rep line reflects
    the other card's `synergyRepBonus`.
  - **Sold endpoint** — earns nothing from the link but still anchors the
    synergy for the other card (CG-0MT5XUE2200047IJ); its line says so.
  - **Zero-synergy opt-out** (e.g. the Pawn Shop) — returns `''` (no tooltip).
- Wiring: `MainStreetRenderer.drawSynergyLines()` adds one narrow (`12px`),
  rotated, invisible `Phaser.GameObjects.Zone` per pair on top of the line,
  parented into `streetContainer` so it is recreated/destroyed with the street
  layer (no listener leak). The band spans only the clipped edge-to-edge
  segment — the gap between the two cards — and is wired to
  `s.tooltipManager.show(...)` on `pointerover` / `.hide()` on `pointerout`.
- Guards: no band in `replayMode`, and no band when `s.tooltipManager` is
  absent — matching the business-slot tooltip guards. The
  `settingsPanel.showTooltips = false` toggle is enforced by `TooltipManager`
  itself.
- Interaction safety: the band is thin and confined to the gap between the two
  slot rects, so slot hover tooltips, click-to-place, sell and upgrade
  targeting keep working everywhere except immediately along the line. Reduced
  motion is unaffected (the tooltip appears/hides immediately; no animation).
- Reuse: `TooltipManager` (`@ui`) + the existing `synergyLineEndpoints`
  geometry; no new engine API.

### Upgrade level-up burst

- Helper: `MainStreetAnimator.animateLevelUp()`.
- Trigger: `MainStreetTurnController.onUpgradeCardClick()` — the `afterTransfer`
  hook fires `animateLevelUp({ slotIndex: targetSlot, level })` only when the
  `buyUpgradeCommand` actually succeeded (upgraded flag), after the final
  `refreshAll` (the newly-rendered level badge — top-left of the card — is
  visible underneath).
- Behavior (reduced-motion OFF):
  1. A small gold sparkle burst (six fixed-direction sparks, `0xffd700`)
     tweens outward and fades on the upgraded business card — deterministic
     directions, no RNG, so tests and replays are stable.
  2. A "Level N" pop text appears over the card (`popTextOrIcon`, gold).
  3. Arrival chime: the upgrade transfer's existing end SFX
     (`SFX_KEYS.UPGRADE_END`, played by `animateTransferFromMarket` on
     landing) IS the arrival chime — `animateLevelUp` deliberately does NOT
     replay it, so there is no double sound and no new SFX key (ToneForge
     pipeline untouched).
- Accessibility (reduced motion): the sparkle burst is skipped; the
  "Level N" pop text is retained (spec AC2 — "skip the burst, keep the pop
  text").
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Reuse: `popTextOrIcon` + `getStreetSlotCenter`; no new engine
  infrastructure.

### Effective card income and reputation display (MS-0MW6H9A47001B1QT)

- **Rule.** A card's face and every hover tooltip show the income and
  reputation the engine actually credits for that instance — never the static
  `baseIncome + incomeBonus` / `reputationPerTurn + reputationBonus` figures.
  The card face shows the effective **total**; the tooltip shows the total plus
  a **base + modifier breakdown** (upgrade, synergy, duplicate factor, staff).
- **Source of truth.** The read-only `computeEffectiveCardValues(state, card,
  slotIndex?)` helper (`src/MainStreetAdjacencyScoring.ts`) resolves both the
  totals and their additive components (whose parts sum exactly to the total)
  from the same primitives `applyIncome` uses — `computeBusinessIncomeParts`,
  `computeBusinessStaffBuffs` and `computePerBusinessSkillBuffs` — so display
  and credit cannot diverge. It never mutates the `currentIncome` /
  `currentReputationPerTurn` caches; staff buffs are recomputed on demand.
- **Consumers.** `buildUpgradeOverlaySpec()` takes an optional
  `EffectiveCardValues` argument (production call sites always pass it; the
  base + upgrade fallback is a test-only seam). `buildCardTooltipInfo()` takes
  an optional `CardTooltipContext` (`{ state, slotIndex }`) and, when given,
  renders `formatEffectiveIncomeLine()` / `formatEffectiveReputationLine()`.
  The street inline tooltip in `MainStreetRendererStreet.ts` uses the same
  two formatters, so the street, hand and market surfaces read identically.
- **Every location.** The street, hand and market call sites all pass their
  effective values. A hand/market instance has no board position, so
  position-dependent modifiers (adjacency synergy, the adjacent same-type
  penalty, slot-bound staff buffs) are zero, while the upgrade bonus and the
  duplicate/saturation factor for its business type still apply (the instance
  counts itself once, never twice).
- **No stale base-only surfaces.** The overlay/current-income values are passed
  on every production render path; the only base + upgrade output left is the
  explicit fallback used by pure-card unit tests that supply no context.

### Card upgrade shader effect

- Spec/renderer: the pure `shaderEffect` field in `buildUpgradeOverlaySpec()`
  (`src/scenes/UpgradeOverlaySpec.ts`), drawn by `applyUpgradeOverlays()`
  (`src/scenes/MainStreetRendererStreet.ts`).
- Trigger: any upgraded business / community-space card (`level > 0`). Base
  cards (level 0) render unchanged — no shader object is created.
- Behaviour (reduced-motion OFF): the top-left upgrade accent carries a
  Canvas-compatible **corner shard** (`ms-upgrade-shader`) — a translucent
  right triangle filling the card's top-left quadrant with a gold → pale →
  warm-white → gold gradient (sampled from the pure colour stops via
  `sampleShaderGradient()`) and a moving white highlight band. A deterministic
  sweep tween (`repeat: -1`, fixed duration/easing) drives a phase value whose
  `onUpdate` redraws the shard, so the highlight travels seamlessly across it
  (`wrapShaderPhase()` / `circularDistance()`). It works under `Phaser.CANVAS`
  with no renderer change and adds no per-level texture-cache keys.
  The warm-white foil stop is deliberate: the earlier shader reused the flat
  accent's exact position and gold colour, so manual review saw no difference
  (MS-0MUWNTQ5L0075Y38). The shard now measurably brightens the top-left
  quadrant (browser test: mean luminance ~16.6 → ~34.5).
- Behaviour (reduced-motion ON) and replay/headless: the same gradient renders
  in its static form and no tween is created, so transcripts and headless CI
  output are unchanged (gated by `shouldAnimateShaderEffect()`).
- Accessibility: upgrade state is also carried by shape/position (the corner
  shard and the `Lvl N` badge), so colour is never the sole carrier of meaning.
  The shard is confined strictly to the top-left quadrant and never forms a
  full-card stroke, so it coexists with the owner-coloured outer border (F4 of
  MS-0MUWNTN8W006C7EF) and never masks the 64×64 left-art zone or the
  right-hand text column.
- Reuse: `applyUpgradeOverlays()` + Phaser `Graphics`/tween; presentation-only,
  never mutates state, transcript or replay output.

### Sell demolition + refund coin fly

- Helper: `MainStreetAnimator.animateSell()`.
- Trigger: `MainStreetOverlayContent.showSellConfirmation()` — the Sell
  button handler fires `animateSell({ slotIndex, refund, cardId, family })`
  only when `sellBusinessCommand` succeeded (sold flag), after the overlay
  dismiss + synchronous `refreshAll` (the dimmed SOLD state renders
  immediately, hidden beneath the demolition snapshot).
- Behavior (reduced-motion OFF):
  1. Demolition: a pre-sold card snapshot (`createTransferCardVisual`,
     depth 10000 — above the SOLD overlay) shrinks and fades over ~380ms
     (`Cubic.easeIn`) so the dimmed SOLD state is visually revealed only
     AFTER the demolition.
  2. Refund coin flies from the sold slot to the HUD coins counter (same
     geometry as `animateIncomeCollection`: `coinX = gameW * 0.25 + 70`,
     `hudY`) with `SFX_KEYS.COIN_POP` via `moveGameObject`.
  3. A "+€refund" pop lands at the HUD counter (`popTextOrIcon`) and the
     coin SFX pops on landing.
- Sell-price formula (CG-0MT5XO7DI0066QCT): refund = `ceil((cost + totalUpgradeCost) * 1.5) + max(0, currentIncome − effectiveBase) + max(0, currentRep − (repPerTurn + repBonus))`; `effectiveBase = (baseIncome + incomeBonus) * 0.6` when same-type adjacent, else ×1; applies to business + community-space. `currentIncome` in the refund is the card's cached income **after** the street-wide duplicate (market-saturation) factor, so a saturated type refunds less synergy comp than an unsaturated one — the reduced refund is expected, not a bug (MS-0MVYG50V1007W8BP). The **Manage Card** dialog (`showSellConfirmation`, panel 520 wide, [Sell] [Close] [Cancel]) shows the sell breakdown (base / synergy-income / synergy-rep) plus the explicit Close cost line before confirm; log mirrors the breakdown.
- Accessibility (reduced motion): demolition + coin flight are skipped; a
  single "+€refund" pop + coin SFX remain (spec AC2).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — the
  returned promise resolves immediately in replay/headless mode
  (`scene.replayMode`), never mutates state or transcript.
- Non-blocking: fire-and-forget for the caller; the sold state and refund
  are already committed to game state.
- Reuse: `createTransferCardVisual` + `moveGameObject` + `popTextOrIcon` +
  `SFX_KEYS.COIN_POP`; no new engine infrastructure.

### Close demolition (no refund)

- Helper: `MainStreetAnimator.animateClose()` (CG-0MT5XT7K3005IBBV).
- Trigger: the **Manage Card** dialog's [Close] button — fires
  `animateClose({ slotIndex, cardId, family })` only when
  `closeBusinessCommand` succeeded, after the overlay dismiss + synchronous
  `refreshAll` (the freed empty slot renders immediately, hidden beneath the
  demolition snapshot).
- Behavior (reduced-motion OFF):
  1. Demolition: a pre-close card snapshot (`createTransferCardVisual`,
     depth 10000) shrinks and fades over ~380ms (`Cubic.easeIn`). The closed
     card is gone from `streetGrid`, so the snapshot is built from the captured
     `cardId`/`family`, not from live grid state.
  2. No refund coin fly and no "+€" pop — **closing grants no coins**. Instead
     a brief "Closed" pop marks the freed slot (`popTextOrIcon`).
  3. Discard SFX (`SFX_KEYS.DISCARD`) plays as the card lands in the discard
     pile.
- Accessibility (reduced motion): the demolition tween is skipped; a brief
  "Closed" pop + discard SFX remain (sound is not motion).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — resolves
  immediately in replay/headless mode (`scene.replayMode`), never mutates state
  or transcript.
- Non-blocking: fire-and-forget for the caller; the removal, discard-pile push,
  neighbour recalculation, and spent action are already committed by
  `closeBusinessCommand`.
- Reuse: `createTransferCardVisual` + `popTextOrIcon` + `SFX_KEYS.DISCARD`; no
  new engine infrastructure.

### Manage Card staff rows — business staff (MS-0MWC952QU000HQ11)

A business that employs staff lists **one row per employed member** at the
bottom of its **Manage Card** dialog, so releasing or relocating a member
always acts on the member the player picked — never "the most recently
hired" member.

- **Rows.** One row per member employed at this slot (`employedAtSlot ===
  slotIndex`, hire order — oldest first), each showing the member's name, its
  role/benefit summary (the shared `formatStaffRoleSummary()` text the
  tooltips also use), its effective per-turn salary and its own `[ Move ]` and
  `[ Lay off ]` buttons. Rows come from the pure `buildBusinessStaffRows()`
  model (`src/MainStreetBusinessStaff.ts`), so the row salary and lay-off
  figures are the engine's own arithmetic. Management-company members never
  appear here — they belong to the Company Roster overlay.
- **Panel sizing.** The dialog (520 wide) sizes its own height from the member
  count — the fixed sell/close/cancel block and costs line plus one 34px row
  per member — and keeps a flat 360px height when nobody is employed.
- **Costs line.** Stated once per dialog, under the buttons:
  `Move: 1 action · Lay off: 1 turn's salary + reputation` — neither cost is
  hidden behind a tooltip.
- **[ Move ].** Begins relocating **that** member (`beginStaffMove(memberId)`
  after dismissing the dialog); its tooltip lists the member's legal
  destination slots from the shared affordance builder, and the move costs
  1 action (undone via the undo stack).
- **[ Lay off ] → confirm step.** Opens a quoted confirm layer over the rows
  (member name, one turn's salary in coins clamped at 0, and the shared
  salary-scaled reputation cost — both read from the row model, never
  recomputed). `[ Confirm ]` runs `letGoStaffCommand()` through the scene's
  undo manager, so the lay-off stays undoable; `[ Cancel ]` changes nothing.
  The confirm re-resolves the row's member id against the live `staffCards`,
  so a stale row (member already gone, e.g. after an undo) flashes feedback
  and re-renders instead of acting on a shifted index.
- **In-place refresh.** After a confirm the dialog stays open and rebuilds its
  rows in place: the fired row disappears and the panel shrinks to fit the
  remaining members while its top edge stays put; the world and undo buttons
  refresh on the same cycle. The activity log records the applied charge as
  `Laid off <name> (−<coins> coins, −<reputation> reputation)`.
- **Empty state.** A card that employs nobody renders no rows, no buttons and
  no costs line — the section renders nothing at all and the dialog keeps its
  flat 360px height; `[ Sell ]`/`[ Close ]`/`[ Cancel ]` keep working.
- **Tests.** `tests/main-street/manage-card-dialog.browser.test.ts` (rows in
  hire order, per-row `[ Move ]`/`[ Lay off ]`, quoted confirm, in-place
  refresh down to the empty state, undo, stale-row guard, panel fit at
  maximum employment capacity, and coexistence with Sell/Close/Cancel).

### Week transition banner

- Helper: `MainStreetAnimator.animateWeekBanner()`.
- Trigger: `MainStreetTurnController.startTurnPhase()` — fires
  `animateWeekBanner({ turn: state.turn, week: state.week, year: state.year })` synchronously after the week-start
  refresh (the banner plays over the freshly-rendered board). Skipped on
  checkpoint resume (`skipMarketRefill` — the same week continues, not a new
  week) and while the tutorial is active (`tutorialController.isActive` —
  its step overlays carry the guidance). Includes week 1 (first-turn boot).
- Behavior (reduced-motion OFF):
  1. A "Week W · Year Y" banner (dark rounded box + gold "Week W · Year Y" text) fades in at
     the board centre (`Back.easeOut`, ~250ms), holds (~300ms), and fades
     out (`Quad.easeIn`, ~250ms) before being destroyed (~800ms total).
  2. A week-chime SFX plays — reused `SFX_KEYS.CLICK` (no new ToneForge
     key; the `sfx-` prefix convention is untouched).
  3. The banner is NON-interactive (never calls `setInteractive`) at depth
     600 — above the street/market cards, below the HUD container (1000)
     and any modal overlay (>1000) — so it never intercepts pointer
     events, never shifts layout, and leaves the market fully interactive
     (tutorial E2E safe; AC2).
- Accessibility (reduced motion): skipped entirely — the HUD week label is
  the cue instead (no banner motion).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Non-blocking: tweens are fire-and-forget; the market is interactive the
  whole time.
- Reuse: `SFX_KEYS.CLICK` + `popTextOrIcon` (via tween helpers); no new
  engine infrastructure.

### Held-event play burst

- Helper: `MainStreetAnimator.animateEventPlayed()`.
- Trigger: `MainStreetTurnController.onPlayHeldEvent()` — captures the
  played card's hand sprite position BEFORE the hand re-renders (the card
  leaves the hand on `refreshAll`), then fires
  `animateEventPlayed({ x, y, eventName })` after the play command
  succeeds (guarded by a `played` flag — no burst on failed plays).
- Behavior (reduced-motion OFF):
  1. An 8-spark burst in the event colour (`0xffdd88`) plays at the card's
     hand position as it leaves the hand (fixed deterministic directions,
     `Quad.easeOut`, ~400ms — no RNG, stable in tests/replays).
  2. The event name pops above the position (`popTextOrIcon`, riseY 28)
     and the cheer SFX plays — reused `SFX_KEYS.EVENT_CHEER` (already
     loaded via `sfx-tf-mapping.ts`; no new ToneForge key).
- Accessibility (reduced motion): the spark burst is skipped; a brief
  name pop + cheer SFX remain (spec AC2).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Non-blocking: fire-and-forget; the event effect is already committed to
  game state.
- Reuse: `popTextOrIcon` + tweened circles (same deterministic pattern as
  `animateLevelUp`) + `SFX_KEYS.EVENT_CHEER`; no new engine infrastructure.

### Turn Summary panel model (turn-ledger summary)

- Model: `src/scenes/MainStreetTurnSummary.ts` (pure, no Phaser import) —
  `buildTurnSummary(state, result)` turns the committed `TurnResult.turnLedger`
  (MS-0MVP45KZV006TMUK) plus `MainStreetState` into the whole Turn Summary
  dialog content (MS-0MVP45WBA001GAVY, parent MS-0MVL6HMDP004WI41).
- Reported values, for the turn just closed:
  - **Businesses owned** — one owner-keyed row per `businessesOwned` key
    (`ownerId` / `playerId`, `label`, `isHuman`, count + wallet), so every
    player's row already carries the figures its own tab renders.
  - **Income subtotals per phase** — base / synergy / reputation / events,
    plus `incomeTotal` (the four rows sum to the income phase's credited
    coins).
  - **Ongoing expenses per category** — staff / community / business, plus
    `expensesTotal` (signed: zero or negative).
  - **Incident and one-off deltas** — the resolved incident name plus its
    coin/reputation delta, and the non-recurring (market / event-play /
    other) coin/reputation delta.
  - **Net change** — coin / reputation / score for the day.
  - **Closing balances** — coin / reputation / score, derived as
    `day-start snapshot + ledger net`, the ledger's own reconciliation
    identity (the deferred closing refreshes the net rows against the final
    state, so closing balances are the post-turn values and stay
    integer-consistent with the displayed rows).
- Profit/loss projection (parent MS-0MW4XULA90002OEY, producer answers Q1=A,
  Q2=A, Q3=A): `buildPLProjection(state, result, playerKey)` re-projects one
  player's committed figures as an ordered, **coins-only** profit/loss
  statement, and `buildPLTabs(state, result)` builds the matching per-player
  tab model. Both are Phaser-free and re-project the committed ledger only —
  no new accounting data, no state mutation, no RNG.
  - **Statement shape** — the `Income` section lists base / synergy /
    reputation / events with a `Total income` row; `Less: Operating expenses`
    lists staff / community / business with a `Total operating expenses` row;
    the `Incident` and `One-off` adjustments follow; the statement closes with
    an emphasised `Net profit/loss` bottom line. Section totals come from the
    ledger's own subtotals (never a re-sum of the lines), so
    `income.total + expenses.total + incident.coins + oneOff.coins` equals
    `net.coins` — the ledger's own identity. Every label is UK English and
    matches the wording both panels already use (`Base income`, `Staff
    wages`, …).
  - **Supplementary context** — the non-monetary figures never become P&L
    lines: `context` carries the day's net reputation and score change, the
    closing coin balance and the businesses owned for the selected player.
  - **Tab model** — one `PLTab` per player: `{ id, label, colour?, isHuman,
    isDefault }`. `id` is the ledger owner key (`String(playerId)`), `label`
    is `You` for the human seat and `AI n` otherwise, `colour` is the seat's
    shared `resolveSeatColour` value (absent in single-player, where there is
    nothing to compare), and exactly one tab is the default: the human seat,
    else the first tab. A single-player player who owns no business yet still
    gets one `You` tab — staff wages, incidents and one-offs can move the
    day's result with an empty street.
  - **One source of truth for both entry points** — `buildPLTabs` /
    `buildPLProjection` resolve which ledger shape the result carries, and the
    tabbed dialog's own helpers (`buildPLTabsFromTurnSummary` /
    `buildPLTabsFromCompetitiveSummary`, `buildPLFromTurnSummary` /
    `buildPLFromCompetitiveRow`) project the same tabs and statement from the
    already-built summary it holds, so the two can never drift.
  - **Per-item tooltip breakdowns (MS-0MW6GZKZZ006PLLO)** — each income line
    carries an optional `breakdown` listing each owned business and its
    individual coin contribution (projected from `IncomeResult.breakdown` for
    base / synergy and `phaseBreakdown.perSlotBreakdown` for reputation /
    events), and each ongoing-expense line carries an optional `breakdown`
    listing each staff card / community space / business card and its running
    cost. The per-card costs are derived from the committed `streetGrid` /
    `staffCards` using the engine's own helpers (`computeStaffSalaryCost`,
    `getSalaryScopeSkills`), never invented by the UI, and sold slots are
    excluded. Both breakdowns are absent-safe: a hand-built or legacy result
    renders the statement with generic per-line tooltips instead. See the
    [ledger tooltips](#ledger-tooltips-in-the-turn-summary-ms-0mw6gzkzz006pllo)
    section below.
  - **Tooltip content and the documented one-off fallback** —
    `src/scenes/MainStreetTurnSummaryTooltips.ts` builds the localisable
    per-line tooltip copy (headings + per-item lists + reconciliation notes).
    The ledger stores one-off only as a **residual**
    (`netCoinChange - income - expenses - incident`) with no per-source
    breakdown, so its tooltip presents that reconciliation formula rather than
    inventing per-source attribution — the documented fallback permitted by the
    parent item (parent AC7). The same module builds the incident name/effect
    tooltip, the net reconciliation-identity tooltip
    (`income + expenses + incident + one-off = net`), and the explanatory
    supplementary-context tooltips.
  - **Read-only** — never mutates state, consumes no RNG, and never touches the
    save-point ordering (the checkpoint stays in `finalizeTurn`).
- Competitive closings carry no `turnLedger`, so `buildTurnSummary` returns
  `null` and the single-player summary is not presented (parent AC4). They
  carry `TurnResult.playerRoundLedger` instead, rendered by the competitive
  portion of the same
  [tabbed overlay](#competitive-turn-summary-panel-per-seat-round-rows-ms-0mvrnv9y8008ikgk)
  through its own row builder (`buildCompetitiveTurnSummary`) and the same
  P&L/tab projection.
- Tests: `tests/main-street/turn-summary-model.test.ts` (one test per
  surfaced value, owner-keyed shape, and a real-engine
  `processEndOfTurn` integration test), `tests/main-street/turn-summary-pl-model.test.ts`
  (one test per P&L line and section total, exact reconciliation for
  profitable / loss / zero days, the tab model and its default, and the
  supplementary context); engine ledger coverage lives in
  `tests/main-street/end-of-turn-ledger.test.ts`.

### Ledger tooltips in the Turn Summary (MS-0MW6GZKZZ006PLLO)

- Every P&L row in the Turn Summary — each income line, each expense line, the
  `Incident` and `One-off` adjustments, the `Net profit/loss` bottom line and
  the supplementary context rows — shows an explanation tooltip on hover
  (desktop) and on tap (touch), through the shared `attachHudTooltipZone` /
  `tooltipManager` helper. The seed-level entries below are implemented by
  `src/scenes/MainStreetTurnSummaryTooltips.ts` and wired into the overlay by
  `src/scenes/MainStreetTurnSummaryOverlay.ts`.
- **Per-business income** — the base / synergy / reputation / events tooltips
  list each owned business and its individual coin contribution, from the
  projection's per-line `breakdown` (projected from `IncomeResult`).
- **Per-card expenses** — the staff / community / business tooltips list each
  individual card and its running cost. The per-card figures mirror the
  engine's own `applyStaffOngoingCosts` / `applyCommunitySpaceOngoingCosts` /
  `applyBusinessOngoingCosts` scans (sold slots excluded), and the tooltip
  reconciles their sum to the committed category total with a street-wide
  reduction line (`Cost Cutter`) or a coins-limited note where applicable.
- **Incident** — names the resolved incident card and describes its coin and
  reputation effect.
- **One-off** — no per-source breakdown is stored in the ledger, so the
  tooltip presents the reconciliation formula that produces the residual
  (parent AC7's documented fallback; see the TSDoc on
  `MainStreetTurnSummaryTooltips.ts`).
- **Net profit/loss** — explains the reconciliation identity
  `income + expenses + incident + one-off = net`.
- **Supplementary context** — the reputation/score change, closing coins and
  businesses-owned rows carry explanatory tooltips.
- **i18n** — all copy resolves through the shared `t()` / `registerLocale`
  system; English defaults for every key are registered at module load, so the
  tooltips work without an explicit locale setup and can be overridden by any
  registered locale.
- **Non-blocking** — tooltips are pure presentation (no state mutation, no RNG)
  and are attached to already-inert text rows, so tab switching and the
  `[ Next Turn ]` / `[ Bank Loan ]` buttons are unaffected.
- **Styling** — the tooltips reuse the scene's shared `TooltipManager` rendering
  (dark background, readable font size) so they read consistently with the rest
  of the HUD; the tooltip's first line is the row heading and the following
  lines are the per-item list / formula. Content is built lazily on hover/tap,
  so unhovered rows cost nothing.

### Turn Summary dialog and the closing gate

- Overlay: one unified tabbed P&L panel (parent MS-0MW4XULA90002OEY, child
  MS-0MW5ER6HC000HVQ8) replaces the old flat two-column single-player dialog
  (`MainStreetOverlayContent.showTurnSummaryDialog()`, MS-0MVP46AMO002SZUT)
  and the old per-seat text block (`showCompetitiveTurnSummaryDialog()`).
  Both methods delegate to the same renderer, `presentTurnSummaryPanel()` in
  `src/scenes/MainStreetTurnSummaryOverlay.ts`, so the two layouts can never
  drift. It is instant (no fade-in, so it is reduced-motion safe) and
  overlay-pattern compliant (`hudContainer` parenting, depths 199/200/201,
  dismissal via `s.overlayObjects`).
  - **Tab strip** — a `Turn Summary` / `Day <n>` title, then a **`[ Summary ]`**
    tab (first and selected by default, MS-0MWBWRITL0089GGJ) followed by one
    tab per player, each in its seat colour where one exists (single-player
    uses the dialog gold). **Every** tab is drawn in the dialog's button form —
    `[ Label ]` — whether or not it is selected, so the player's own statement
    is always a visible button to switch back to
    (MS-0MW4XULA90002OEY: a rejected review found no button to return to the
    player's own tab). The selected tab is the **bold** one; the others keep
    their seat colour and brighten on hover, so every tab reads as a control.
    **Seat colours are used as text, so they are made legible on the black
    panel**: `ensureReadableSeatColour()` lightens a hue that would fall below
    the WCAG AA contrast ratio toward white, keeping the seat colour exactly
    wherever it already clears it. Without this the colour-blind-safe palette's
    Okabe–Ito black (`#000000`) made a `[ You ]` or `[ AI n ]` label invisible
    on the black panel — the producer saw the AI tabs but no `You` tab
    (MS-0MWBWRITL0089GGJ).
    Selecting any tab redraws the **whole** body (the Summary headline view or
    that player's statement) from the committed figures. Single-player renders
    an interactive `[ Summary ]` and `[ You ]` tab; competitive renders the
    `[ Summary ]` tab plus one interactive tab per non-eliminated seat. Tabs
    are operable by pointer **and** keyboard — the Left/Right arrow keys cycle
    Summary and the players' tabs with wrap-around — and a tab press plays
    `UI_CLICK` through `safePlaySound`.
  - **Summary tab (the default view)** — the closed turn's headline recap
    (MS-0MWBWRITL0089GGJ), in the confirmed section order **Major actions →
    Events → Income / Reputation / Score**:
    - **Major actions** — the turn's player- and AI-initiated actions
      (placing a business, hiring staff, playing an upgrade/event, moving a
      card to hand, selling, laying off, closing a street card, loans,
      challenge completions), attributed per seat (`You` / `AI n`). Selected
      structurally from `state.activityLog` by the new optional
      `LogEntry.actionType` marker, so turn headers and the per-turn monetary
      summary rows (which carry no marker) never appear. Bounded to six rows
      with an `…and N more` affordance.
    - **Events** — the resolved incident and the effect it applied, per seat
      (the competitive ledger does not name the incident, so it renders as a
      generic `Incident` label there).
    - **Income / Reputation / Score** — one row per metric, carrying **every**
      seat's signed change and closing balance (`+N` / `-N` / `0`). Each figure
      is its own hover/tap tooltip zone whose breakdown is built from that
      seat's `PLProjection` (the same source the per-player tab renders), so
      the two can never drift; figures wrap rather than overflow the fixed
      panel.
  - **Statement body** — the selected player's P&L projection: the **Income**
    section (base / synergy / reputation / events) with its `Total income`
    row, **Less: Operating expenses** (staff / community / business) with its
    `Total operating expenses` row, the **Incident** and **One-off**
    adjustments, and the emphasised **Net profit/loss** bottom line (green
    for a profit, red for a loss), followed by the non-monetary
    **supplementary context** — reputation/score change, closing
    coins/reputation/score, businesses owned and (single-player) the incident
    drawn — outside the monetary lines.

  The actions are **[ Next Turn ]** (primary) and **[ Bank Loan ]**,
  whose availability comes from the Phaser-free loans descriptor
  (`buildTurnSummaryLoanDescriptor()`, MS-0MVXYCICT0051LU7). Every button
  plays its `UI_CLICK` SFX through `safePlaySound`, so the Settings mute /
  volume controls are respected and no reduced-motion variant is needed. The
  **enabled/disabled matrix** is strictly two-way:
  - **Enabled** — normal colour, clickable, `UI_CLICK` SFX and no hint line —
    only when `config.loansEnabled` is `true` **and** the acting seat holds no
    active loan.
  - **Disabled** — muted, `input` disabled and inert — in every other case,
    with a reason-specific hint naming the cause: loans disabled in this game,
    no configured `config.loanOptions`, or the seat's outstanding obligation
    (`Loan: 110 coins/turn, 4 turns left`) (MS-0MVXYCJCK006UE62).

  Pressing the enabled button opens the mid-game loan selector below.
  **[ Next Turn ]** remains the only way to resume the deferred closing, so
  the day still advances only on that click. A loan taken in the selector
  re-renders this same panel in place from the same result against the
  post-take state, **preserving the selected tab**. No descriptor (a
  hand-built / legacy state) means disabled with no hint, because no reason is
  known. `MainStreetScene.showTurnSummaryDialog()` delegates to it and, with
  no overlay manager (headless), continues the closing instead of stranding
  the turn.
  **Pointer isolation (MS-0MW6GPRL6001DFCF):** the action row sits directly
  over the middle hand card, and the buttons act on `pointerdown` — dismissing
  the panel (and its input-blocking backdrop) before the matching `pointerup`
  arrives. Without a guard, that release hit-tests against the now-uncovered
  hand card beneath and selects it (entering "placing from hand"). Both
  **[ Next Turn ]** and the enabled **[ Bank Loan ]** therefore place a
  full-screen, transparent, interactive **pointer blocker** at depth 9999
  when they dismiss the panel. It absorbs the release — and destroys itself on
  it, with a 1.5 s safety timeout — so the ledger's action can never be
  interpreted as a hand-card click, even when the button geometrically
  overlaps a card, for mouse and touch alike. The blocker is anchored
  top-left at (0, 0) because Phaser derives an interactive rectangle's hit
  area in the object's origin space, so a centre-origin full-screen rectangle
  would only be hit-testable in its bottom-right quadrant.
- When it appears (MS-0MVP46Q8X003419R): `shouldGateTurnSummary()` /
  `presentTurnSummaryGate()` in `MainStreetTurnControllerTurnFlow.ts`, after
  every closing animation (phased income show + incident reveal) has finished
  and after any loan payoff congratulation has been dismissed — a retired
  loan's dialog is presented ahead of this gate (see [Loan payoff
  congratulation dialog](#loan-payoff-congratulation-dialog)), so the summary
  is never reachable behind it.
  `finishTurnPresentation` hands the shared closing primitive
  (`presentTurnClosing`) a gate callback instead of `advanceTurn` directly, so
  the dialog is presented only after all end-of-turn animations complete and
  the next day starts only when the player clicks **[ Next Turn ]** — that
  click runs `advanceTurn`, which presents any pending banking hint first, then
  waits out any running income choreography (bounded) and runs `finalizeTurn`
  (checkpoint + `startTurnPhase`).
- Scope: deferred single-player closings. The tutorial, replay/headless and
  the resumed event-choice/piggyback tails keep the existing auto-advance
  pacing, and competitive closings never present this single-player dialog —
  competitive play gates the same unified overlay through its own per-seat
  entry point under the same gate contract
  (`presentCompetitiveTurnSummaryGate`; per-seat `perSeatClosingSummary` text
  is unchanged; parent AC4; see
  [Competitive Turn Summary panel](#competitive-turn-summary-panel-per-seat-round-rows-ms-0mvrnv9y8008ikgk)).
  **Reduced motion is
  gated too** (MS-0MW20KSEG001DH1X): the dialog is instant-appearance, so
  those players get the summary instead of a silently auto-advanced day. That
  needs both halves of the fix — `shouldGateTurnSummary()` has no
  reduced-motion guard, and `endTurn()` takes the deferred closing path under
  reduced motion (so `requiresDeferredClosing` is set and the gate has
  something to gate). The deferred closing completes at the same wall-clock
  moment the day previously advanced on its own, so no new wait is added;
  the existing phase-label pacing under reduced motion is unchanged.
- Idempotence: the deferred deltas are applied under the scene's
  `endOfTurnDeltasApplied` exactly-once guard before the panel renders (the
  income/incident animation completions normally got there first), and the
  gate also waits out a running income choreography (bounded by
  `INCOME_COLLECTION_CAP_MS`) so the panel never opens over live animation.
- Never stalls: a result without a ledger, a failing model build or a missing
  dialog surface advances immediately, matching the pre-gate pacing.
- Tests: `tests/main-street/turn-summary-gate.test.ts` (gate on/off per mode
  incl. the reduced-motion × replay × tutorial × competitive guard matrix,
  `endTurn` closing-path selection, `onNextTurn` continuation, delta
  ordering/idempotence, banking-hint ordering),
  `tests/main-street/turn-summary-dialog.browser.test.ts` (overlay rendering in
  a real Phaser scene, the reduced-motion end-of-turn presenting the dialog,
  and the `[ Next Turn ]` pointer blocker leaving a hand card beneath the
  button unselected) and `tests/main-street/turn-summary-pl-overlay.browser.test.ts` (the
  tabbed P&L body, the default and per-seat tabs, tab switching by pointer and
  Left/Right keys, the single non-interactive `You` tab and the selected tab
  surviving the post-loan-take re-render).

### Competitive Turn Summary panel (per-seat round rows, MS-0MVRNV9Y8008IKGK)

Competitive play gets the same review-and-advance moment single-player has
(MS-0MVRNV9Y8008IKGK, parent MS-0MVO1SFCM000ZLBI): after the shared closing
presentation finishes, the **Turn Summary** panel opens on the human seat's
management-company P&L statement, with one owner-keyed **tab per non-eliminated
seat**, and the next shared day starts only on **[ Next Turn ]**. This is the
competitive portion of the same
[unified tabbed P&L overlay](#turn-summary-dialog-and-the-closing-gate) that
single-player uses — there is no separate competitive layout.

A **round** is one completed shared day: every non-eliminated seat has taken
its MarketPhase and the shared closing (Income → Incident → EndCheck) has run
(intake assumption, parent MS-0MVO1SFCM000ZLBI). The panel is presented per
completed round — a partial day, an early exit or a closing that carries no
round ledger advances as before — and every value on it is engine-computed and
owner-keyed, so the whole panel is testable without a browser.

- **Engine ledger (reporting-only).** `resolveCompetitiveClosingPhases`
  (`src/MainStreetEngineCompetitiveTurn.ts`) captures, per non-eliminated seat
  and in seat order, `businessesOwned`, the per-phase income subtotals
  (`incomeByPhase`, mirroring that seat's own `IncomeResult.phaseBreakdown`)
  with their `incomeTotal`, and `netCoinChange` measured from the seat's wallet
  **before** the closing's economy ran. It is surfaced as the optional
  `TurnResult.playerRoundLedger` (`CompetitiveRoundLedger` → `OwnerRoundLedger`
  in `src/MainStreetEngineTypes.ts`). The accumulator lives on the transient
  `state._competitiveRoundLedger` so the ledger is complete on the **deferred
  dual-choice resume** too (the resume re-enters `finishCompetitiveClosingTail`
  without the original result but still needs the pre-closing baseline).
  Nothing is deducted, credited, reordered or drawn differently: the coins,
  shared phase order (Income → Incident → EndCheck), RNG consumption and log
  lines are unchanged, and the field is absent for single-player, N=1,
  headless short-cuts and hand-built results.
- **Per-seat net and closing balances (MS-0MVRNW26W0070CP0).** The ledger also
  carries, per seat, the day-start wallet snapshot (`dayStart`), the closing
  wallet (`closing`), the net reputation and score change (`netRepChange` /
  `netScoreChange`) and the seat's own share of the resolved incident and of
  the non-recurring one-off deltas — the same figures, order and signed
  formatting the single-player panel shows, reconciling exactly
  (`dayStart + net == closing`, the ledger's own identity). Every field is
  optional and absent-safe: `buildCompetitiveTurnSummary` prefers the ledger's
  closing snapshot, falls back to `dayStart + net`, then to the seat's
  committed `PlayerRecord` wallet, and renders an absent figure as zero, so an
  older or hand-built ledger still shows that seat's standing instead of a
  gap.
- **Model (Phaser-free).** `buildCompetitiveTurnSummary(state, result)` in
  `src/scenes/MainStreetTurnSummary.ts` turns that ledger into one row per seat
  — seat label from the same `buildCompetitiveScoreboard` rows (`You` / `AI n`),
  colour from the shared `resolveSeatColour` lookup, businesses owned, the
  `base` / `synergy` / `reputation` / `events` income rows with their total, the
  per-category ongoing expenses with their total, the seat's incident and
  one-off deltas, its net coin / reputation / score change and its closing
  coin / reputation / score balances. `buildPLTabsFromCompetitiveSummary` turns
  those rows into the panel's tabs (seat order, seat colour, human default) and
  `buildPLFromCompetitiveRow` projects each one as that seat's P&L statement,
  so competitive and single-player share one statement shape. It returns `null`
  when the result carries no round ledger, so browser and single-player callers
  are unaffected. `buildSummaryTabModel` / `buildSummaryTabModelFromSummary`
  build the shared **Summary** tab from the same projections — actions from
  `state.activityLog` selected by the structural `LogEntry.actionType` marker,
  the incident's per-seat effect, and one metric row (Income / Reputation /
  Score) per seat — so the headline view and the per-player tabs never drift
  (MS-0MWBWRITL0089GGJ).
- **Dialog.** `MainStreetOverlayContent.showCompetitiveTurnSummaryDialog()`
  (delegated by `MainStreetScene.showCompetitiveTurnSummaryDialog()`) renders
  the competitive side of the unified tabbed panel
  (`presentTurnSummaryPanel()`): a `Turn Summary` / `Day <n>` title, a
  **`[ Summary ]`** tab (first and selected by default, MS-0MWBWRITL0089GGJ)
  followed by a tab per non-eliminated seat in its own colour (lightened toward
  white when the hue would be unreadable on the black panel, so the human `You`
  tab can never disappear — `ensureReadableSeatColour()`), and the selected
  tab's body. The **Summary** tab is the shared headline view — the day's major
  player/AI actions per seat, the resolved incident and its effect, and one row
  per metric (Income / Reputation / Score) carrying every seat's signed change
  and closing balance, each figure a hover/tap breakdown — and the per-seat
  tabs render that seat's P&L statement — Income (base / synergy /
  reputation / events) with its total, Less: Operating expenses (staff /
  community / business) with its total, the Incident and One-off adjustments,
  the emphasised net profit/loss, and the supplementary context (reputation /
  score change, closing balances and businesses owned). Every seat tab is
  always drawn as a `[ Label ]` button in its own `resolveSeatColour` colour;
  the selected one is bold, so switching from an AI seat back to the player's
  own statement is always an obvious button press
  (MS-0MW4XULA90002OEY). Selecting another
  seat's tab switches the **whole** statement body to that seat; the Left/Right
  arrow keys cycle the tabs. Overlay conventions are the single-player ones:
  `createOverlayBackground` / `createOverlayButton`, elements parented into
  `s.hudContainer` at depths 199/200/201, everything pushed into
  `s.overlayObjects` for dismissal, instant appearance (reduced-motion safe)
  and `safePlaySound` for the **[ Next Turn ]** click. **[ Bank Loan ]**
  mirrors the single-player button (MS-0MW4YUHOU00474HZ): enabled in normal
  colour exactly when the human seat's descriptor (`summary.loanDescriptor`,
  built by `buildTurnSummaryLoanDescriptor` for `summary.humanSeatId`) says it
  may borrow, otherwise muted and inert with the descriptor's reason-specific
  hint (loans disabled / an active obligation / no configured options).
  Pressing it opens the per-seat mid-game loan selector (the same
  `buildLoanSelectorModel` + `showLoanSelectorDialog` machinery as the
  single-player panel), books the take to the human seat via an explicit
  `ownerId`, and re-presents the same `TurnResult` panel with the obligation
  hint while **preserving the selected tab**. AI seats get no proactive
  affordance — bailout stays their only loan path.
- **Per-seat expenses (MS-0MVRNVHJ50095N9Y).** `applyCompetitiveOngoingCosts`
  (`src/MainStreetEngineCommands.ts`) now **returns** the per-owner breakdown it
  charges — `{ staff, community, business }`, signed zero-or-negative — instead
  of discarding it. It is reporting data only: the coins deducted, the log
  lines, the iteration order and the insufficiency (clamp) handling are
  byte-identical for every existing caller, and the combined community +
  business charge is split across the two categories by their raw cost shares
  (the rounding residual stays on the business share, so the parts always sum
  to the coins actually deducted). The closing threads it onto
  `OwnerRoundLedger.ongoingCosts` (optional and absent-safe — a ledger without
  it renders three zero rows), `buildCompetitiveTurnSummary` exposes
  `expenses` / `expensesTotal` per seat using the **single-player** labels
  (`Staff wages` / `Community spaces` / `Business costs`), order and signed
  formatting, and each seat's tab renders those three rows (in the
  single-player expense colour) under `Less: Operating expenses`, summing to
  that seat's `Total operating expenses`.
- **Gate.** `shouldGateCompetitiveTurnSummary()` /
  `presentCompetitiveTurnSummaryGate()` in
  `src/scenes/MainStreetTurnControllerCompetitive.ts` slot into
  `presentCompetitiveDayTail`: the closing's completion callback becomes the
  gate instead of `startTurnPhase`, so the panel appears only after
  `presentCompetitiveClosing` has finished and the next shared day starts only
  on **[ Next Turn ]**. The checkpoint save ordering (saved before the closing)
  and the bounded closing itself are unchanged, and the panel adds no save and
  mutates no state. **Reduced motion, replay and headless keep today's
  auto-advance pacing** (the competitive panel blocks the shared day, so those
  players are not given a new stop), and a closing with no round ledger — an
  early exit, a resumed-from-save closing — advances exactly as before.
- **Invariants (MS-0MVRNW5JT0046QI3).** Only non-eliminated seats get rows, and
  the gate never fires for single-player or N=1 (single-player has its own
  gate); a headless / AI-driven competitive day advances with no overlay
  surface. The panel adds no checkpoint save, mutates no engine state and
  consumes no RNG, and a failing model build or a presentation that throws
  advances immediately and exactly once — the panel can neither stall the
  shared day nor start it twice.
- **Tests.** `tests/main-street/competitive-turn-ledger.test.ts` (per-seat
  ledger for 2- and 3-seat closings, eliminated-seat omission, reconciliation
  with each seat's committed wallet, determinism, the dual-choice resume, the
  N=1 / single-player absent cases, the per-seat ongoing-expense breakdown —
  mixed street split, Cost Cutter reduction, sold-slot exclusion, clamp
  allocation and its reconciliation with the wallet movement — and the
  day-start / closing / net reputation / score reconciliation),
  `tests/main-street/turn-summary-competitive-model.test.ts` (row per seat,
  seat order, labels/colours, per-row values, the per-category expense rows and
  total including a zero-expense seat and an absent breakdown, the net
  reputation / score and closing balances including their absent-safe
  fallbacks, label parity with the single-player panel, `null` without a
  ledger),
  `tests/main-street/competitive-turn-summary-gate.test.ts` (panel after the
  closing, `startTurnPhase` only on the click, reduced-motion / replay /
  headless auto-advance, the invariants above) and
  `tests/main-street/turn-summary-competitive.browser.test.ts` (real Phaser
  overlay: one tab per seat, per-seat colours, depths/parenting, tab switching,
  the descriptor-driven **[ Bank Loan ]**, the per-seat expense rows and the
  incident / one-off / net / closing figures), plus the cross-mode
  `tests/main-street/turn-summary-pl-overlay.browser.test.ts`. The prose here is
  guarded by `tests/main-street/turn-summary-gate-docs.test.ts` (which also
  pins the single-player gate and the `docs/dev/testing.md` browser-test rule)
  and `tests/main-street/turn-summary-pl-docs.test.ts`.

### Mid-game loan selector

- Renderer: the bailout dialog's `MainStreetLoanOverlay` renderer in its
  `'select'` mode — `showLoanSelectorDialog()` — exposed as
  `MainStreetOverlayContent.showLoanSelectorDialog()`
  (MS-0MVXYCJVU000QBK1, parent MS-0MVPWSQMG004198C). One renderer serves both
  modes: the row loop (button construction, label text, depths 199/200/201,
  HUD parenting, `UI_CLICK` SFX) exists once, so the two dialogs can never
  drift apart (parent AC4). Modes differ only in their model content, the
  alternative action's label and the handler it calls — `[ Decline — end the
  run ]` (red, bailout) versus the neutral `[ Cancel ]` (select).
- Model: `src/scenes/MainStreetLoanSelectorModel.ts` (pure, no Phaser import) —
  `buildLoanSelectorModel(state)` builds **one row per `config.loanOptions`
  entry**, each showing the principal and term with its **per-turn repayment
  and total repayment**, through the **same** `buildLoanRows()` builder as the
  bailout dialog, so those figures and labels are identical for the same menu.
  The selector is driven by the configured menu only; `state.pendingLoanOffer`
  never leaks into it.
- Entry point and back-out: pressing the Turn Summary dialog's enabled
  **[ Bank Loan ]** dismisses that panel and presents the selector — one modal
  at a time, so no Turn Summary button can be pressed behind it. `[ Cancel ]`
  dismisses the selector and re-presents the Turn Summary dialog from the same
  summary model with **no** state change (no loan, no action point, no day
  advance).
- Confirming a row (MS-0MVXYCKFE000VF76): dispatches
  `takeLoanCommand(state, optionIndex, { allowDuringClosing: true })` for the
  acting seat — the deferred-closing opt-in is required because the selector is
  presented while the closing is paused outside `MarketPhase`. Taking a loan
  **costs no action point** and **does not advance the day**: the command is
  AP-neutral and reversible (it goes through the undo manager), so
  `actionsRemaining`/`bankedActions` are untouched, `state.turn` does not move
  and the closing is **not** resumed — the day advances only on
  **[ Next Turn ]**, exactly once. On success the Turn Summary panel is
  re-rendered in place from the **same** `TurnResult` against the post-take
  state, **preserving the selected tab** (single-player rebuilds through
  `buildTurnSummary`, competitive through `buildCompetitiveTurnSummary`), and
  its loans descriptor is re-derived from the live state, so the freshly
  booked obligation appears as the disabled **[ Bank Loan ]**
  with its `Loan: <n> coins/turn, <n> turns left` hint. A refused confirm
  (e.g. a race into an active loan) re-draws the selector with the engine's own
  reason in an extra red line and leaves every resource untouched, because the
  engine validates before it mutates.
- `MainStreetTurnControllerTurnFlow.presentTurnSummaryGate()` forwards the
  committed `TurnResult` as the dialog's fifth argument — the seam the in-place
  refresh rebuilds from.
- Overlay pattern: instant (no fade-in, reduced-motion safe), every element
  parented into `s.hudContainer` and tracked in `s.overlayObjects`, and never
  presented in `replayMode`.
- Tests: `tests/main-street/turn-summary-bank-loan.browser.test.ts` (selector
  content, cancel with no state change, shared row rendering with the bailout
  dialog, configured-menu-only content, replay/headless suppression, the
  `takeLoan` dispatch with its AP-neutral / no-day-advance rule, the in-place
  refresh and its leak check, and the refusal path) and the
  rewritten `[ Bank Loan ]` case in
  `tests/main-street/turn-summary-dialog.browser.test.ts`; the gate's
  `TurnResult` forwarding is pinned in `tests/main-street/turn-summary-gate.test.ts`.

### Bailout loan offer dialog

- Renderer: `MainStreetLoanOverlay.showLoanOfferDialog()`, exposed as
  `MainStreetOverlayContent.showLoanOfferDialog()` and delegated by
  `MainStreetScene.showLoanOfferDialog()` (MS-0MVPWSBLG006YMBA, parent
  MS-0MVL6DZI0000F6CG). Shares its row rendering with the mid-game loan
  selector (`mode: 'bailout' | 'select'`).
- Model: `src/scenes/MainStreetLoanOverlayModel.ts` (pure, no Phaser import) —
  `buildLoanOfferModel(state)` turns the outstanding
  `state.pendingLoanOffer` into a title, intro, one **row per presented loan
  option** (principal, term, per-turn repayment, total repayment and a
  self-contained button label) and a Decline action. Repayment figures reuse
  `MainStreetLoans.loanTotalRepayment` / `loanPerTurnRepayment`, so the dialog
  can never disagree with the loan the engine records on acceptance; a row's
  `principal`/`termTurns` are exactly the accepted `LoanOption`.
- When it appears: `finishTurnPresentation()` presents the dialog whenever the
  closing pauses on a pending offer (`result.pendingLoanOffer`) — or when
  `state.pendingLoanOffer` is already open — **instead of** the game-over
  summary. The deferred closing tail (`completeDeferredClosingTail`) also
  routes a freshly raised offer to the dialog rather than starting the next
  week, and `handleGameOver()` refuses to present the summary while an offer
  is open (`hasOpenBailoutOffer()` in `MainStreetGameOverSummary.ts`). The
  bankruptcy summary is therefore only shown after a decline.
- Resume: `onLoanOfferChoice()` resolves the offer through the engine's
  `acceptLoanOffer(optionIndex)` / `declineLoanOffer(state)` commands (both
  clear `state.pendingLoanOffer`, so the handler is idempotent), applies any
  outstanding deferred deltas under the `endOfTurnDeltasApplied` exactly-once
  guard, runs `finishDeferredTurnClosing()` **once** and completes the turn
  through the shared tail. No re-run of `processEndOfTurn` means the income,
  incident draw and loan repayment are never replayed, and the per-turn
  bailout guard prevents a duplicate offer.
- Competitive seats (MS-0MVPWSAMH005LV9R): the shared closing evaluates **every**
  seat before declaring failures. An AI seat at `coins < 0` with no active loan
  auto-accepts the largest option inline (no dialog) and is not eliminated, so a
  last-standing win is delayed accordingly; an AI seat already repaying a loan is
  eliminated exactly as before. A human seat's offer pauses the shared closing
  (`presentCompetitiveDayTail` presents the same dialog) and
  `resolveCompetitiveLoanOffer` resumes the **competitive** closing tail — never
  the single-player one, which reads the shared host wallet. The offer carries
  the failing seat's `ownerId`, and the principal lands on that seat's own
  `PlayerRecord` wallet (the shared mirror is left alone when it belongs to
  another seat). Offers are raised at most once per seat per turn, so a decline
  converges to the day's bankruptcy outcome in one pass.
- Overlay pattern: instant (no fade-in, reduced-motion safe),
  `createOverlayBackground` / `createOverlayButton` from `@ui`, every element
  parented into `s.hudContainer`, depths 199/200/201, every object tracked in
  `s.overlayObjects` for dismissal, and `safePlaySound` for the button SFX.
  Presented **once per offer** (the offer object is the guard), and a
  headless scene without an overlay surface falls back to the model's
  deterministic `recommendedIndex` (the AI/headless largest-option policy).
- Persistence (MS-0MVPWSE0E003QLKE): `loans` and `pendingLoanOffer` are part of
  the run checkpoint at `MAIN_STREET_SAVE_SCHEMA_VERSION = 3` — a mid-loan save
  resumes with the same remaining turns and per-turn amount (never a
  re-derived schedule), and a save taken while the dialog is open still
  presents the same menu. Both fields are omitted while empty, so a loan-free
  payload is unchanged from v2; a v2 save loads through the serializer's
  v2 → v3 migration with no loans and no offer. Loads are defensive
  (`restoreActiveLoans` / `restorePendingLoanOffer`): malformed entries are
  dropped, `turnsRemaining` is clamped to `termTurns`, and an unusable offer is
  discarded rather than stalling the closing.
- Tests: `tests/main-street/MainStreetLoanOverlay.test.ts` (model rows,
  presentation-once, accept/decline resume, post-closing pause) and
  `tests/main-street/MainStreetLoanOverlay.browser.test.ts` (rendering, button
  count, dismissal).

### Loan payoff congratulation dialog

- Renderer: `src/scenes/MainStreetLoanPayoffOverlay.ts` —
  `showLoanPayoffDialog(payoff, onDismiss)`, exposed as
  `MainStreetOverlayContent.showLoanPayoffDialog()` and delegated by
  `MainStreetScene.showLoanPayoffDialog()` (MS-0MW3SN2LK00537GN, parent
  MS-0MW1ZJDVE000MUID). It renders one `TurnResult.loanPayoffs` entry (engine
  slice MS-0MW3SMTRO006M86W) and owns **no copy**: every string comes from the
  model below.
- Model: `src/scenes/MainStreetLoanPayoffModel.ts` (pure, no Phaser import) —
  `buildLoanPayoffContent(payoff, ctx)` builds the headline `You are debt
  free!`, the two body lines `110 coins/week is no longer deducted.` and
  `660 coins repaid over 6 weeks.` from the payoff entry's own
  `perTurnRepayment` / `totalRepayment` / `termTurns` (so the dialog can never
  contradict the HUD figure that just disappeared), and the single-button
  `Continue` dismiss label (MS-0MW3SMVVP006ZD4V, producer Q2 = B: no separate
  interest line). `shouldPresentLoanPayoff(ctx)` is the one presentation gate
  (see *Gating* below), `deriveLoanPayoffContext(s, payoff)` is the one home
  for reading `replayMode`, the payoff's `ownerId`, `state.players` and
  `state.gameResult` off the scene, and `presentLoanPayoffDialogs(s, payoffs,
  next)` is the sequencer the turn-flow layer calls (MS-0MW3SN58E009HC84).
- When it appears: **once per retired loan**, after the closing animations and
  before the End of Turn summary (or before the next-week continuation where
  that summary gate is skipped), one modal per payoff and never one per turn.
  The single dismiss action resumes exactly the flow the dialog interrupted;
  a resumed/deferred closing carries its payoffs without re-running the
  repayment pass, so a payoff is never announced twice. A closing that ends
  the run presents the game-over overlay instead.
- Paused closings: the presentation slot sits **after** the event-choice and
  bankruptcy-bailout pauses, so a closing that pauses there never reaches it on
  the first pass (MS-0MW4887R4007XPGJ). The paused closing's `loanPayoffs` are
  carried across the pause — stashed on the scene alongside the
  `pendingBankingHint` arm for an event choice and consumed exactly once by
  `onEventChoice`, and carried through the paused result for a bailout — then
  presented on the **continuing** resume: `finishTurnPresentation` for the
  resumed event-choice closing and `completeDeferredClosingTail` for an
  accepted bailout. A declined bailout ends the run, so the game-over branch
  wins and no congratulation is shown. The deferred closing's presentation slot
  remains the single delivery point for an unpaused closing: its payoffs are
  stripped from the result handed to the deferred tail so a bailout raised
  there cannot replay them.
- Overlay pattern: `createOverlayBackground` / `createOverlayButton` from
  `@ui`, every element parented into `s.hudContainer`, depths 199/200/201,
  every created object tracked in `s.overlayObjects` for dismissal, and
  `safePlaySound(COMMON_SFX_KEYS.UI_CLICK)` on dismissal. It is instant (no
  fade-in) and therefore reduced-motion safe, and it has a **single dismiss
  action** — no other button — which removes the overlay, clears the tracked
  objects and calls its continuation **exactly once** (a guard makes a second
  press a no-op), so the closing can never be resumed twice. The sequencer
  presents the next payoff only after the previous one is dismissed, so no
  more than one modal is ever active and the summary's buttons are never
  reachable behind a congratulation.
- Gating: suppressed entirely in `replayMode` (headless/replay runs) and for
  any seat that is not the **human seat** — delegated to the existing
  `isHumanSeatCredit` seam, so competitive play congratulates the human seat
  and an AI seat's payoff changes nothing visible. A closing that already
  ended the run suppresses the dialog too (game over wins). A scene without
  the overlay surface simply continues the flow, so the closing can never be
  stranded.
- Tests: `tests/main-street/MainStreetLoanPayoff.browser.test.ts` (rendered
  copy, `hudContainer` parenting, depths and `overlayObjects` tracking, the
  single dismissal with its exactly-once continuation, and the suppressed
  cases), `tests/main-street/loan-payoff-notification.test.ts` (copy model and
  gate) and `tests/main-street/loan-payoff-turn-flow.test.ts` (once per
  retired loan, placement ahead of the summary, resume and gating).

### Loan obligation HUD readout

- Renderer: `refreshHud()` in `src/scenes/MainStreetRendererHud.ts`
  (MS-0MVPWSCRD004A6Z4, parent MS-0MVL6DZI0000F6CG).
- Copy: `MainStreetLoans.hudLoanReadout(state)` returns
  `Loan: 110 coins/turn, 6 turns left` for the seat bound to the shared wallet,
  or `null` when loans are disabled or the seat holds no active loan — so a
  loan-free (and every `loansEnabled: false` headless) HUD is
  pixel-identical to before the feature.
- Placement: a 13 px bold `#ff6699` label named `loan-hud-readout`, right-aligned
  immediately left of the `Score: N` label at the HUD strip baseline. Anchoring
  to the Score label's measured left edge (not a fixed x) keeps the readout
  clear of the score for every digit width; it is added to `hudContainer` so it
  follows the standard HUD lifecycle.
- Competitive play: each scoreboard row carries the compact variant
  (`Loan: 110/turn, 6 left`) via
  `formatCompetitiveScoreboardRow()` → `Loan: 110/turn, 6 left`, appended after
  the score so every seat's remaining debt is visible from one HUD line. The
  readout updates every refresh, so a repaid loan disappears immediately and
  each instalment ticks the remaining turns down.
- Acceptance: accepting a loan also logs the decision (amount, term, per-turn
  repayment) to the activity log, and every instalment logs its own `loss` row
  (see the rules documentation, §5.1).

### Game-over panel (three-column summary with stats graphs)

- Renderer: `MainStreetOverlayContent.showGameOverOverlay()`.
- Model: `src/scenes/MainStreetGameOverSummary.ts` (pure, no Phaser import) —
  `formatEndReason`, `buildGameOverPlayerRows`,
  `buildGameOverChallengeSummary` and `buildGameOverStatSeries`, reusing
  `buildCompetitiveScoreboard` for the per-seat rows.
- Chart layer: `src/scenes/MainStreetStatsChart.ts` — a thin wrapper around
  Chart.js (`chart.js/auto`, dynamically imported) that renders one line chart
  into a dedicated DOM `<canvas>` positioned over the Phaser canvas. It has no
  game-state import and never mutates the scene.
- Layout (three columns, 1200 px panel inside the 1280×720 game layout):
  - **Top band:** the title (`You Win!` / `Game Over`) plus a plain-language
    end-reason headline derived from `state.endReason` (e.g. *Bankruptcy*,
    *Reputation collapse*, *Score threshold reached*, *Last standing*,
    *Turn limit exhausted*). In competitive mode a
    per-seat failure names the player concerned (e.g. `Bankruptcy — You`,
    `Reputation collapse — AI 1`), preferring the human seat.
  - **Left "Game State" column:** one row per player — `You` for the human
    seat, `AI <n>` for AI seats — showing coins, reputation and score read
    directly from each `PlayerRecord` (single-player synthesises the sole
    `You` row from the shared wallet). A failing or eliminated seat carries a
    `Bankrupt`, `Reputation collapse` or `Eliminated` badge (cause before
    consequence; reputation collapse applies only after turn 1). The run's
    challenges met follow below. In competitive mode the challenge summary is
    **per seat** — each seat lists only the challenges it completed (the
    completions credited to it via `ActiveChallenge.completedBySeatId`), while
    single-player retains the historic run-global list shown once per run
    (MS-0MUWNTJIK009O6BZ).
  - **Middle "Summary" column:** the retained score breakdown (coins,
    reputation, challenges, final score), the **`Cash at end of turn: <n>`**
    line drawn directly after the breakdown, a keyboard-activatable
    `[ View detailed stats ]` affordance that adds a static focus frame around
    the stats column (no animation), per-challenge details, tier-unlock
    notifications, current tier + campaign stats and the difficulty selector,
    with the `[ Play Again ]` / `[ Menu ]` buttons anchored at the panel
    bottom.
  - **Right "Stats" column:** five stacked line charts fed from
    `buildGameOverStatSeries(state)`, in order — **profit per turn**, **cash at
    end of turn**, **businesses at end of turn**, **staff at end of turn** and
    **reputation at end of turn**. Each chart carries a visible title/legend
    label and axis ticks. An empty history (legacy save, or a run that ended
    before a turn closed) renders five empty series and still shows the cash
    line from the live wallet.
- Presentation contract: reads committed state only (never mutates it); uses
  `createOverlayBackground` / `createOverlayButton` from `@ui`; all elements
  are parented into `s.hudContainer`; depths follow the shared overlay
  convention (199 backdrop / 200 box / 201 interactive); everything (including
  each chart handle) is pushed into `s.overlayObjects` for dismissal, so
  closing the overlay removes every chart canvas.
- Reduced motion: the panel adds no tweens/rAF of its own; charts use
  `animation: false`, so reduced-motion users see the same static content. The
  game-over feedback below is unchanged.
- Headless/replay exemption (AGENTS.md rule 8): the panel returns immediately
  in replay/headless mode (`scene.replayMode`), and `createStatsChart` returns
  `null` (creating no DOM node and never resolving Chart.js) whenever
  `scene.replayMode` is set or `document` is unavailable.
- The panel widens to 1200 px and computes its height from the tallest of the
  three columns (capped to the 1280×720 layout with a 16 px margin) so all
  three fit without clipping or vertical overflow.
- **Competitive scope (working assumption):** the graphs plot the **human
  seat's** trajectory only. Per-seat series are a separate producer-confirmed
  decision (Open Question on MS-0MVAMU6OM008GJPV).

### Game-over overlay teardown and restart contract (MS-0MW6H5R340033GJJ)

Pressing `[ Play Again ]` after a game over must leave a clean restarted scene —
no result title, headline, columns, cash/score text, difficulty control,
buttons or chart canvases may survive. The teardown is a three-part contract;
keep all three in step when changing the game-over overlay.

1. **Tracking.** Every object the overlay creates — the 199 backdrop, the 200
   box, every text/rectangle/button, and each lazily-created stats-chart
   handle — is pushed into `s.overlayObjects` and parented into
   `s.hudContainer`. `s.overlayObjects` is the single authoritative teardown
   list.
2. **Game-over-local teardown.** `teardownGameOverOverlay(scene)` (in
   `src/scenes/MainStreetOverlayContent.ts`) runs immediately before
   `scene.restart()`:
   - it detaches every tracked object from its parent container (via
     `parentContainer.remove(obj, false)`) so a restart that rebuilds
     `hudContainer` cannot strand an orphaned child;
   - it calls the shared `dismissOverlay(objects)` with the **full**
     `overlayObjects` array, so each object is destroyed exactly once on the
     happy path;
   - if that shared loop throws (e.g. an object was already destroyed by a
     late callback), it falls back to a per-object `destroy()` so one stale
     handle can never block the restart;
   - it then reassigns `scene.overlayObjects = []` **before** `scene.restart()`.
   The shared `dismissOverlay` (`core/src/ui/Overlay.ts`, a pinned submodule) is
   deliberately a thin `for (const obj of objects) obj.destroy()` loop: it is
   not null-guarded and does not explicitly clear parent references. Destroying
   a Phaser object detaches it from its container as a side effect, so the
   helper is correct for well-formed arrays; the game-over path adds the
   detachment + idempotent fallback locally rather than changing shared
   semantics for every other overlay.
3. **Generation guard against late callbacks.** Phaser reuses the scene
   instance across `scene.restart()`, so a pending promise can still resolve
   against the new run. `MainStreetScene.sceneRestartGeneration` is a monotonic
   counter incremented first thing in `createScene()`
   (`src/scenes/MainStreetLifecycleManagerLifecycle.ts`) on every boot and
   restart. Two async paths capture it and discard their result when it has
   changed:
   - `showGameOverOverlay()` captures the generation at presentation. Each
     lazy stats-chart `.then(handle)` destroys the handle instead of attaching
     it when the generation moved on; the existing `overlayObjects` identity
     check remains as a second guard.
   - `handleGameOver()` (`src/scenes/MainStreetTurnControllerTurnFlow.ts`)
     captures the generation before the async `updateCampaignProgress()`
     write and skips the game-over presentation entirely if the scene
     restarted meanwhile — otherwise the finished run's overlay would be
     re-presented over a fresh run.

The contract is pinned by unit tests
(`tests/main-street/game-over-overlay.test.ts`,
`tests/main-street/game-over-play-again-async.test.ts`) and by a browser test
that drives the real `[ Play Again ]` `pointerdown` handler and asserts the new
HUD is free of every game-over marker
(`tests/main-street/MainStreetOverlay.browser.test.ts`).

### Game-over celebration / loss sting

- Helper: `MainStreetAnimator.animateGameOver()`.
- Trigger: `MainStreetOverlayContent.showGameOverOverlay()` — fires right
  after the overlay backdrop is created, with `win` derived from
  `result.gameResult`.
- Behavior (reduced-motion OFF):
  1. **Win:** a confetti burst (24 coloured rectangles) falls across the
     whole board, spinning + fading with a stagger (`Quad.easeIn`), plus the
     victory fanfare WAV (`SFX_KEYS.GAME_WIN` ← `assets/audio/default/game-win.wav`).
     Confetti is a scene-level effect at depth 100.5, created by the animator
     while the overlay backdrop/box (199/200) and text/buttons (201) are
     parented into `s.hudContainer`.
  2. **Loss:** a brief full-board dark pulse (the "sting beat", depth 99.5 —
     under the backdrop, so only the board dims) plus the low sting WAV
     (`SFX_KEYS.GAME_LOST` ← `assets/audio/default/game-lost.wav`). The
     overlay backdrop keeps the board dimmed afterwards.
- Accessibility (reduced motion): plays only the fanfare/sting sound — no
  particles/visuals (spec AC3).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Non-blocking: fire-and-forget tweens; the game-over state is already
  committed before the feedback plays.
- Reuse: convention keys `sfx-game-win` / `sfx-game-lost` (documented in
  `docs/SFX_CONVENTION.md`; Golf uses the same keys) loaded from the shared
  default audio dir — no new ToneForge factory.

### Undo/redo feedback notification

- Helper: `MainStreetAnimator.animateUndoRedo()`.
- Trigger: `MainStreetTurnController.performUndo()` / `performRedo()` —
  fires after the command was successfully reversed/reapplied, reusing the
  command's `description` (already captured for the transcript) as the
  action label.
- Behavior (reduced-motion OFF): a brief "Undid: <action>" / "Redid:
  <action>" pop appears bottom-centre 60 px above the viewport bottom — over
  the bottom-anchored hand band (`popTextOrIcon`, riseY −16, 1200 ms) — with
  a UI click SFX (`SFX_KEYS.CLICK`).
- Accessibility (reduced motion): the pop helper's reduced-motion fallback
  is used (no extra motion); the click SFX still plays (sound is not
  motion).
- Headless/replay exemption (AGENTS.md rule 8): presentation-only — returns
  immediately in replay/headless mode (`scene.replayMode`), never mutates
  state or transcript.
- Non-blocking: fire-and-forget; the undo/redo is already committed to
  game state.
- Reuse: `popTextOrIcon` + `SFX_KEYS.CLICK` (both already loaded); no new
  engine infrastructure.

### Challenge HUD tracker — live progress (MS-0MUI7ZJK8003HY9J)

- Renderer: `refreshChallengeTracker` (`src/scenes/MainStreetRendererHud.ts`)
  draws the challenge panel as compact rows (indicator + title + description)
  under a `Challenges (n/N)` header.
- Progress rows: a challenge that declares an optional `progress(state)`
  provider renders `<current>/<target>` (e.g. `2/3`) on its row, recomputed on
  every refresh so it updates live after each action. The pure formatter
  `formatChallengeProgress()` (`src/MainStreetChallenges.ts`) returns the label
  or `null` when the challenge has no provider.
- Layout: the progress label is **right-aligned** at the description column
  start (`challengeW * 0.42 - 6`) with a 10 px bold font, sharing the row colour
  (`#ccbbaa` open / `#44ff44` complete) so it never overlaps the right-hand
  description column. Rows without a progress provider are byte-for-byte
  unchanged, so the existing 12 challenges keep their historic appearance.
- Example: **Serial Seller** (`ch-serial-seller`) shows `0/3` → `1/3` → `2/3` →
  `3/3` as street businesses are sold (Manage Card → Sell).
- Presentation-only and deterministic: reads committed `state.soldSlots` (no
  mutation, no new state field), so it is safe in replay/headless rendering and
  is restored correctly by undo/redo snapshots.

## Competitive seat colours (F1/F2, MS-0MUWNTN8W006C7EF)

In competitive (human-vs-AI) play every seat — the human and each AI opponent —
is assigned a distinct colour so a player can identify who did what at a
glance. The colour is the single seat-identity token threaded through the
activity log, the competitive scoreboard/HUD and the placed-card borders, so a
seat has one colour everywhere.

- **Palette.** `SEAT_COLOUR_PALETTE` (`src/MainStreetSeatColours.ts`) is the
  Okabe–Ito colour-vision-deficiency-safe set (8 colours): orange `#E69F00`,
  sky blue `#56B4E9`, bluish green `#009E73`, yellow `#F0E442`, blue `#0072B2`,
  vermillion `#D55E00`, reddish purple `#CC79A7` and black `#000000`. The
  palette is fixed and never mutated; it is drawn from only to build an
  assignment.
- **Assignment.** `assignSeatColours(seats, rng)`
  (`src/MainStreetSeatColours.ts`) is a pure, Phaser-free helper. It takes the
  seat list (human first, then AI opponents) and an **injected seeded RNG**,
  Fisher–Yates-shuffles a copy of the palette and hands one colour to each seat
  in seat order, returning a `playerId → hex colour` map. The assignment is
  therefore deterministic for a given seed (repeatable in tests and replay) yet
  shuffled per game. A guard (`InsufficientSeatColoursError`) throws rather
  than silently reusing a colour when a game configures more seats than the
  palette has colours.
- **Persistence.** `createCompetitiveState` (`src/MainStreetStateSetup.ts`)
  derives the per-seat assignment from a dedicated seat-colour RNG stream
  (`deriveSeatColours`, salted with `SEAT_COLOUR_RNG_SALT` so it cannot disturb
  the game-play RNG) and stores each colour on `PlayerRecord.colour`
  (`src/MainStreetStateTypes.ts`). The colour is included in competitive state
  save/load (`src/MainStreetStateSerialize.ts`), so a seat keeps its colour
  across a reload instead of reshuffling.
- **Lookup contract.** `resolveSeatColour(state, ownerId)`
  (`src/MainStreetAdjacencyOwner.ts`) is the single source of truth for "which
  colour is this seat?"; `seatColourToNumber(hex)`
  (`src/MainStreetSeatColours.ts`) is the only place the hex string crosses into
  Phaser's numeric colour space. All seat-identity surfaces call the lookup
  rather than hard-coding a hex value.
- **Single-player is unchanged.** With one seat (the human only) there is no AI
  to distinguish, so `assignSeatColours` returns an empty map and
  `PlayerRecord.colour` stays undefined; no log prefix, scoreboard colour or
  owner border is applied.

### Colour-blind-friendly design decisions

- **Okabe–Ito palette.** The palette is a recognised
  colour-vision-deficiency-safe set, chosen so the seat colours remain mutually
  distinguishable under common forms of colour blindness (producer decision
  Q2 = A). It is large enough for the maximum supported AI opponent count.
- **Colour is never the sole carrier of meaning.** Every seat-identity surface
  pairs the colour with the seat label text — `You` for the human and `AI 1`,
  `AI 2`, … for AI opponents — so the game remains fully playable without
  colour perception.
- **Legibility is resolved per surface.** The activity-log prefix lightens a
  seat colour until it clears a minimum WCAG contrast ratio against the dark
  log panel and a minimum RGB distance from the gain/loss/neutral line colour,
  so even the darkest Okabe–Ito hues stay readable beside the body text (see
  [Activity log seat prefixes](#activity-log-seat-prefixes-f3-ms-0muwntn8w006c7ef)).
- **Ownership without obscuring content.** On the street the colour is carried
  by a stroke-only outer border rather than a fill, so it never hides the card
  face or the synergy two-tone colouring (see
  [Owner-coloured placed-card borders](#owner-coloured-placed-card-borders-f4-ms-0muwntn8w006c7ef)).

## Activity log seat prefixes (F3, MS-0MUWNTN8W006C7EF)

In competitive (multi-seat) games each activity-log entry that is attributable
to a seat is prefixed with that seat's label — `You` for the human, `AI 1`,
`AI 2`, ... for AI opponents — drawn in the seat's colour.

- Data: `addLog(state, seatId, text, type)` (`src/MainStreetStateLog.ts`) stamps
the `LogEntry` with `seatId`, `seatLabel` and `seatColour`. The label comes from
the shared `getSeatDisplayLabel` in `src/MainStreetAdjacencyOwner.ts`; the
colour is the seat's persisted `PlayerRecord.colour` (see
`src/MainStreetSeatColours.ts`), so a seat has one colour throughout the UI.
- Rendering: `refreshLog` (`src/scenes/MainStreetRendererHud.ts`) draws the
label as a bold prefix beside the body, which keeps the entry's gain/loss/
neutral line colour.
- Legibility: `resolveLogSeatColour` lightens a seat colour until it clears a
minimum WCAG contrast ratio against the dark log panel and a minimum RGB
distance from the line-type colour, so even the dark Okabe–Ito hues stay
readable. Colour is never the sole carrier of meaning — the seat label text is
always present.
- Single-player is unchanged: with no roster (or one seat) the seat argument is
ignored and entries render exactly as before.

## Activity Log filter controls (All / You / AI, MS-0MW3PFSMB002EIY6)

In competitive play (roster of 2+ seats) a compact filter-controls row sits
beneath the Activity Log title bar offering **All / You / AI**, backed by
`scene.logFilter` (`LogFilter = 'all' | 'human' | 'ai'`). The bucket semantics
(what each filter matches, which shared entries stay visible, session-only
reset) are documented in the game rules,
[`core-rules-and-mechanics.md`](core-rules-and-mechanics.md) (*Filtering
(All / You / AI)*); this section covers the control treatment.

- **Placement.** The row is a slim strip (`LOG_FILTER_ROW_H` = 26 px) directly
  beneath the log's title bar, holding three `createActionButton` controls
  (All / You / AI) laid out across the panel width with a small breathing
  margin. A solid strip behind the buttons (panel fill) keeps scrolled log
  lines from showing through the gaps between them.
- **Active/inactive treatment — not colour alone.** The active control uses a
  bright gold fill at full alpha, a thicker 2 px stroke and a bold bright
  label; inactive controls use a dimmed fill at reduced alpha, a 1 px stroke
  and a normal-weight dimmed label (constants in
  `MainStreetRendererStreet.ts`). Because fill alpha, stroke thickness and
  label weight/brightness all change together, the selected filter stays
  identifiable without colour perception.
- **Space taken from the log viewport.** In competitive play the row reserves
  its 26 px from the visible log area: `refreshLog` (`MainStreetRendererHud`)
  subtracts `LOG_FILTER_ROW_H` from the panel's content height, and the wheel
  handler (`MainStreetInputManager`) applies the same reservation, so scroll
  bounds stay correct around the hidden strip. Single-player / tutorial hide
  the row (`shouldShowLogFilterControls` = false) and consume no vertical
  space — the log renders exactly as it always has.
- **Interaction.** Clicking a control sets `scene.logFilter` and re-renders
  through `refreshLog`, which honours the end-of-turn deferral gate — a click
  during closing applies on the next render. Clicking the already-active
  control is a no-op (no state mutation, no re-render), and hidden modes
  leave the row inert.
- **Empty state.** A filter that matches nothing — not even shared
  entries — renders `No activity for this filter` in italic, neutral body
  colour instead of a blank log (`LOG_EMPTY_FILTER_MESSAGE`).
- **Session-only.** The selection is scene state, never persisted: it resets
  to **All** on every scene creation / new game (lifecycle reset in
  `MainStreetLifecycleManagerLifecycle`).

## Owner-coloured placed-card borders (F4, MS-0MUWNTN8W006C7EF)

In competitive (multi-seat) games every placed business/community-space card on
the street carries an outer border in the colour of the seat that owns it, so
ownership reads at a glance. The human and each AI seat have distinct colours,
so their cards are visually distinguishable.

- Data: `resolveSeatColour(state, ownerId)`
  (`src/MainStreetAdjacencyOwner.ts`) is the shared lookup for a seat's
  persisted `PlayerRecord.colour` (assigned from the Okabe–Ito palette in
  `src/MainStreetSeatColours.ts`, F1/F2). The slot's owner comes from
  `getSlotOwnerId(state, slotIndex)`. A seat therefore has one colour on the
  log, the scoreboard/HUD and the street.
- Rendering: `drawBusinessSlot` (`src/scenes/MainStreetRendererStreet.ts`)
  draws the border as a transparent-filled, full-card frame stroked in the
  owner's colour (`seatColourToNumber` converts the hex colour to Phaser's
  numeric space). Because the frame is only a stroke it never obscures the card
  face or the synergy two-tone colouring, and it is drawn last so it stays
  crisp on a sold (dimmed) card.
- Upgrade indicator: the former full-card gold upgrade border
  (`spec.upgradeBorder`) is removed. Upgrade state is now carried by the
  existing top-left level badge plus a small top-left corner accent
  (`spec.levelAccent`), drawn behind the badge by `applyUpgradeOverlays`. This
  keeps the outer frame reserved for the owner's colour (producer decision
  Q3 = A).
- Accessibility: colour is never the sole carrier of meaning — the owner's card
  still carries its own content/upgrade badge, and every seat-identity surface
  pairs the colour with the seat label text.
- Single-player is unchanged: with no roster (or one seat) there is no seat
  colour, so no owner border is drawn (and the upgrade accent/badge render as
  before).

## Synergy-coloured card faces (MS-0MUZH51PU007POJ4)

Every business / community-space card face is coloured by its **synergy type**
so a player can read a card's type(s) at a glance while scanning the market or
their street. Previously the face was a neutral dark grey (`#2f2f2f`) and only
the header bar, art backing and icons carried the synergy colour.

- **Palette.** A single shared dark palette, `CARD_FACE_PALETTE`
  (`src/MainStreetCardsUtils.ts`): Food `#5D4037`, Culture `#1565C0`,
  Commerce `#2E7D32`, Service `#AD1457`, Entertainment `#C62828`,
  Health `#00838F`, default `#2f2f2f`. The bright `synergyColor` palette stays
  the accent for the header bar, 64×64 art backing and synergy icons, so the
  white title / stat text remains legible on the darker face. Service is a
  pink / magenta (`#AD1457` face, `#C2185B` accent) rather than purple, so a
  service business can never be confused with an upgrade card
  (MS-0MW1ZSC7U000V5MW).
- **Single synergy.** One palette colour fills the rounded face rect.
- **Bridge (exactly two synergies).** The face is split horizontally —
  **top band = `synergyTypes[0]`, bottom band = `synergyTypes[1]`** — with both
  bands clipped to the rounded card rectangle so neither bleeds past the
  corners. The title/stat text and both synergy icons render on top.
- **Zero synergy** (event / upgrade / staff, and any untyped business) keeps
  its existing family colour. More than two synergy types is out of scope and
  degrades safely to the first colour rather than throwing.
- **One source of truth, three renderers.** The dynamic generator
  (`generateBusinessCardSvg`), the runtime CSV-row fallback
  (`generateCardSvgFromCsvRow`) and the static Node generator
  (`generate-main-street-card-svgs.mjs`) all colour/split the face the same
  way; the static SVGs and `csv-checksum.json` are regenerated with the CSV.
  The `.mjs` generator cannot import the TS module, so it duplicates the
  palette values and a test asserts the two copies agree.
- **Accessibility.** Both synergy icons are drawn bottom-left (one per type,
  18 px pitch), so colour is never the sole carrier of meaning. The rounded
  corners, inner gradient and header-bar treatment are preserved.

## Checkerboard upgrade card faces (MS-0MW1ZSC7U000V5MW)

Upgrade card faces are no longer a flat purple. Each upgrade face is a
**checkerboard** of the retained violet upgrade colour (`#6B4C9A`,
`UPGRADE_FACE_BASE_COLOUR`) and the face colour of the business the upgrade
**targets** — so a player can pick a relevant upgrade from their hand without
reading every title, and an upgrade card can never be mistaken for a service
business (now pink / magenta).

- **Derived, not stored.** Upgrade rows carry no synergy column of their own;
  the colours are resolved from `targetBusiness` by looking that name up among
  the business **and** community-space templates
  (`resolveUpgradeFaceColours()` in `src/MainStreetCardsUtils.ts`, mirrored in
  the static Node generator). No CSV schema change, so checksums and pack
  fixtures stay valid.
- **Single-synergy target.** A true two-colour checkerboard: violet on the
  even squares, the target's synergy face colour on the odd squares (20 px
  tiles, clipped to the rounded card rectangle).
- **Bridge target (two synergy types).** Three colours: violet on the even
  squares, and both synergy face colours alternating across the odd squares
  (violet plus both, producer answer Q3 = B).
- **Unresolvable target.** Unknown or missing `targetBusiness` degrades safely
  to the previous flat violet face — the resolver returns no colours and never
  throws. More than two synergy types degrades to the first two.
- **Legibility.** The pattern is drawn behind every overlay (inner gradient,
  header tint, art, title, "for <Business>" line, cost badge), and tile
  contrast is modest, so the card stays readable at the reduced hand / stacked
  scale. The title and target line remain a non-colour cue.
- **One pattern, three renderers.** `generateUpgradeCardSvg`,
  `generateCardSvgFromCsvRow` and the static `.mjs` generator emit identical
  checkerboard markup; a test compares the TS and mjs markup directly, and the
  shipped `public/assets/.../cards/*.svg` files are regenerated with the CSV.
- **Out of scope.** The in-game board upgrade accent (the gold corner shard on
  an upgraded business, `UpgradeOverlaySpec`) and the owner-coloured seat
  border are unchanged — they are a separate visual language
  (MS-0MUWNTN8W006C7EF).

## Scene Transitions

- Main Street scene-level fade transitions are currently disabled.
- The reusable helper `runSceneTransition()` remains available in `src/ui/sceneTransition.ts` for future use once the fade issue is addressed.

## Settings toggles

The in-game Settings panel exposes the player-facing toggles: the engine's
**Tooltips** and **Reduced Motion** toggles (see
[Accessibility](#accessibility) for Reduced Motion) plus Main Street's own
**Auto advance turn** toggle.

### Auto advance turn

- **Default: off (`false`).** A missing preference, an unavailable storage
  backend or any stored value other than `'true'` means the setting is off,
  which surfaces the out-of-actions explainer dialog instead
  (MS-0MW1ZDI8Z006GPFY AC1).
- **Persistence:** browser `localStorage` under the key
  `tce-main-street-auto-advance-turn` (`AUTO_ADVANCE_TURN_KEY` in
  `src/MainStreetPrefs.ts`). The value is always written explicitly
  (`'true'` / `'false'`), so opting out is a stored preference rather than an
  absent one. Toggling it in the Settings panel or from the out-of-actions
  dialog checkbox updates the same stored preference.
- **Behaviour:** when a player action spends the last action point and that
  action's animations and audio have completed, the game reacts **at most
  once per turn**:
  - **On** — the turn ends automatically, dispatching through the identical
    code path as the **End Turn** button (same phase flow,
    income/incident/event-choice resolution, turn-summary presentation and
    save/checkpoint behaviour).
  - **Off (default)** — a *No Actions Left* dialog explains the zero-action
    state (that some employed staff grant extra action points and that the
    player must press **End Turn** to break for the weekend) and offers
    **[ End Turn ]**, **[ Dismiss ]** and an unchecked
    `[ ] Automatically end my turn when I run out of actions` checkbox that
    turns the setting on immediately.
  - **Guards** — the trigger never fires mid-animation/audio, during the
    tutorial (unless the current tutorial step allows `end-turn`), for a
    non-human seat in competitive play, or in `uiPhase` values where End
    Turn is not offered (`placing-from-hand`, `event-selected`, `applicant`).
- **Wiring:** the toggle is supplied through the engine's generic
  `extraToggles` hook (`MainStreetScene.initSettingsPanel`), so the engine
  stays game-agnostic; Main Street owns the label and the persisted
  preference backing it.

See [core-rules-and-mechanics.md](core-rules-and-mechanics.md) §6.0 for the
action-economy context.

## Accessibility

### Reduced motion

A `Reduced Motion` toggle is available in the Settings panel.

- Storage key: `tce-ui-reduced-motion`
- Behavior:
  - resource pop animations are skipped
  - scene transitions are skipped
- **Dialogs are never suppressed.** Reduced motion removes *animation*, not
  *information*: the end-of-turn **Turn Summary** dialog still appears — it is
  instant-appearance, so it is reduced-motion safe — and the day still advances
  only when the player clicks **[ Next Turn ]** (MS-0MW20KSEG001DH1X). The
  incident reveal follows the same rule (the card appears instantly, its
  reading hold is preserved).
- Helpers also respect OS `prefers-reduced-motion` when no explicit override is provided.

## Asset pipeline notes

- Current implementation uses existing SVG card placeholders.
- Animation helpers are asset-agnostic and will accept final art replacements without API changes.
