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

## Transient pop-text feedback channel (MS-0MVPWQK3U003DIR6)

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
  area (`logX / 2`) and lifts it 20 px above the hand band (`handY − 20`), so
  it follows the bottom-anchored hand instead of hard-coding a pixel position.
- **Presentation:** `popTextOrIcon` (rise 20 px, scale 1.1) for 1100 ms by
  default. Reduced motion shows the same text as a static label for the same
  duration — never silently dropped.
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
- Behavior: every occupied street slot is outlined — **green** (`0x44ff66`)
  for a business the upgrade can legally target (matching `targetBusiness` at
  `requiredLevel`, below `maxLevel`) and **red** (`0xff4444`) otherwise. Empty
  slots are skipped entirely and are no longer rendered as selectable while an
  upgrade is pending, so only real businesses appear as targets.
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
  passed the same anchor `x` from `refreshHud`.
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
- Lifecycle: the layer is created with the scene, re-attached after every
  street rebuild (`refreshStreetGrid`), driven from the scene `update` loop,
  re-clamped on resize and destroyed on scene shutdown.
- Performance (MS-0MUYGFXMK009L1UU): the count is uncapped by producer
  decision; a single shared texture and constant per-figure work (position +
  bob) keep the frame cost low. Measured per-frame **model** cost (pure step
  loop, 16-core host, 60 fps): 10 figures ≈ 0.003 ms, 100 figures ≈ 0.007 ms,
  1,000 figures ≈ 0.013 ms and 10,000 figures ≈ 0.13 ms per frame — all
  negligible against a 16.6 ms frame budget. The measurement covers the
  per-figure model update, not GPU sprite rendering; at representative
  reputations (tens of figures) the layer is immaterial, so the uncapped
  population remains an accepted risk rather than a blocker.

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
  deferred-mutation guards; reduced-motion, tutorial and replay/headless paths
  never initialise the counters, so they keep the existing instant-final
  fallback. The incident's reputation share is flown once (the `upcoming`
  phase) and re-enacted by the reveal bubbles, so it is counted once
  (`scene.displayedIncomeCounted` guards the replay); the reputation phase
  therefore excludes the incident share from its HUD pip flight.
- Week-start deferral: the controller polls `incomeCollectionActive` on a
  250ms cadence (with a 16s safety cap) before starting the next week, so
  the street refresh + HUD update never cut the show short; the street
  render itself is deferred via `refreshAllExceptStreet` while the show runs.
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
  lines replace it.
- Bounded / non-blocking (AC6): the primitive waits for the combined
  choreography to finish collecting before the day advances
  (`waitForIncomeCollection`), clamped to the global fast-forward bound
  (`COMPETITIVE_CLOSING_MAX_TOTAL_MS`) so a large roster cannot stall the game
  — once the bound is reached the closing stops waiting and advances the day.
  With no per-owner data the condensed shared summary is kept.
- Accessibility (reduced motion), replay and headless: the per-seat
  animations are skipped, the per-seat text is still shown and the day always
  advances.
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
- Sell-price formula (CG-0MT5XO7DI0066QCT): refund = `ceil((cost + totalUpgradeCost) * 1.5) + max(0, currentIncome − effectiveBase) + max(0, currentRep − (repPerTurn + repBonus))`; `effectiveBase = (baseIncome + incomeBonus) * 0.6` when same-type adjacent, else ×1; applies to business + community-space. The **Manage Card** dialog (`showSellConfirmation`, panel 480×360, [Sell] [Close] [Cancel]) shows the sell breakdown (base / synergy-income / synergy-rep) plus the explicit Close cost line before confirm; log mirrors the breakdown.
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
    (`ownerId` / `playerId`, `label`, `isHuman`, count + wallet). The dialog
    currently renders the single human seat (`humanOwner`); the multi-owner
    rows are already present for a future per-player panel.
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
- Read-only: never mutates state, consumes no RNG, and never touches the
  save-point ordering (the checkpoint stays in `finalizeTurn`).
- Competitive closings carry no ledger, so `buildTurnSummary` returns `null`
  and the dialog is not presented (parent AC4).
- Tests: `tests/main-street/turn-summary-model.test.ts` (one test per
  surfaced value, owner-keyed shape, and a real-engine
  `processEndOfTurn` integration test); engine ledger coverage lives in
  `tests/main-street/end-of-turn-ledger.test.ts`.

### Turn Summary dialog and the closing gate

- Overlay: `MainStreetOverlayContent.showTurnSummaryDialog()`
  (MS-0MVP46AMO002SZUT) renders the model above — instant (no fade-in, so it
  is reduced-motion safe), overlay-pattern compliant (`hudContainer`
  parenting, depths 199/200/201, dismissal via `s.overlayObjects`). It shows
  a `Turn Summary` / `Day <n>` title, then two columns: **left** income per
  phase (base / synergy / reputation / events) with its total, ongoing
  expenses per category (staff / community / business) with its total, and
  **businesses owned** for the human seat; **right** the resolved incident
  (name + coin/reputation delta), the one-off changes, the net coin /
  reputation / score change and the closing coin / reputation / score
  balances. The actions are **[ Next Turn ]** (primary) and an
  always-disabled **[ Bank Loan ]** carrying the hint *“Bank loans are not
  available yet — coming in a future update.”* — the seam reserved for
  MS-0MVL6DZI0000F6CG (Bank Loans), which replaces only the
  `onBankLoanAction` wiring; this item never enables it.
  `MainStreetScene.showTurnSummaryDialog()` delegates to it and, with no
  overlay manager (headless), continues the closing instead of stranding the
  turn.
- When it appears (MS-0MVP46Q8X003419R): `shouldGateTurnSummary()` /
  `presentTurnSummaryGate()` in `MainStreetTurnControllerTurnFlow.ts`, after
  every closing animation (phased income show + incident reveal) has finished.
  `finishTurnPresentation` hands the shared closing primitive
  (`presentTurnClosing`) a gate callback instead of `advanceTurn` directly, so
  the dialog is presented only after all end-of-turn animations complete and
  the next day starts only when the player clicks **[ Next Turn ]** — that
  click runs `advanceTurn`, which presents any pending banking hint first, then
  waits out any running income choreography (bounded) and runs `finalizeTurn`
  (checkpoint + `startTurnPhase`).
- Scope: deferred single-player closings only. Reduced motion, the tutorial,
  replay/headless and the resumed event-choice/piggyback tails keep the
  existing auto-advance pacing, and competitive closings never present it
  (per-seat `perSeatClosingSummary` text is unchanged; parent AC4).
- Idempotence: the deferred deltas are applied under the scene's
  `endOfTurnDeltasApplied` exactly-once guard before the panel renders (the
  income/incident animation completions normally got there first), and the
  gate also waits out a running income choreography (bounded by
  `INCOME_COLLECTION_CAP_MS`) so the panel never opens over live animation.
- Never stalls: a result without a ledger, a failing model build or a missing
  dialog surface advances immediately, matching the pre-gate pacing.
- Tests: `tests/main-street/turn-summary-gate.test.ts` (gate on/off per mode,
  `onNextTurn` continuation, delta ordering/idempotence, banking-hint
  ordering) and `tests/main-street/turn-summary-dialog.browser.test.ts`
  (overlay rendering in a real Phaser scene).

### Game-over panel (two-column summary)

- Renderer: `MainStreetOverlayContent.showGameOverOverlay()`.
- Model: `src/scenes/MainStreetGameOverSummary.ts` (pure, no Phaser import) —
  `formatEndReason`, `buildGameOverPlayerRows` and
  `buildGameOverChallengeSummary`, reusing
  `buildCompetitiveScoreboard` for the per-seat rows.
- Layout:
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
  - **Right "Summary" column:** the retained score breakdown (coins,
    reputation, challenges, final score), per-challenge details, tier-unlock
    notifications, current tier + campaign stats and the difficulty selector,
    with the `[ Play Again ]` / `[ Menu ]` buttons anchored at the panel
    bottom.
- Presentation contract: reads committed state only (never mutates it); uses
  `createOverlayBackground` / `createOverlayButton` from `@ui`; all elements
  are parented into `s.hudContainer`; depths follow the shared overlay
  convention (199 backdrop / 200 box / 201 interactive); everything is pushed
  into `s.overlayObjects` for dismissal.
- Reduced motion: the panel itself adds no animation; the game-over feedback
  below is unchanged.
- Headless/replay exemption (AGENTS.md rule 8): the panel returns immediately
  in replay/headless mode (`scene.replayMode`).
- The panel widens to 900 px and computes its height from the taller of the
  two columns so both fit the 1280×720 game layout without clipping or
  vertical overflow.

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
  Commerce `#2E7D32`, Service `#6A1B9A`, Entertainment `#C62828`,
  Health `#00838F`, default `#2f2f2f`. The bright `synergyColor` palette stays
  the accent for the header bar, 64×64 art backing and synergy icons, so the
  white title / stat text remains legible on the darker face.
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

## Scene Transitions

- Main Street scene-level fade transitions are currently disabled.
- The reusable helper `runSceneTransition()` remains available in `src/ui/sceneTransition.ts` for future use once the fade issue is addressed.

## Accessibility

### Reduced motion

A `Reduced Motion` toggle is available in the Settings panel.

- Storage key: `tce-ui-reduced-motion`
- Behavior:
  - resource pop animations are skipped
  - scene transitions are skipped
- Helpers also respect OS `prefers-reduced-motion` when no explicit override is provided.

## Asset pipeline notes

- Current implementation uses existing SVG card placeholders.
- Animation helpers are asset-agnostic and will accept final art replacements without API changes.
