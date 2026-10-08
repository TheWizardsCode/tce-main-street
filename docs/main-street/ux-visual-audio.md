# Main Street: UX, Visual, Animation, and Audio Notes

## Scope

This document captures the current implementation-level guidance for Main Street UI feedback polish in Milestone 4.

## ToneForge runtime audio (activation + fallback)

Main Street's SFX play through `SoundManager` with an optional ToneForge synth
integration:

- **Async activation.** `loadMainStreetTfModule()`
  (`src/tf/mainStreetTfModule.ts`) resolves the committed runtime module after
  scene boot and attaches it via `createTfPlayer()` / `setSynthIntegration()`.
  After it settles, `SoundManager.isSynthActive()` is `true` and the debug
  **ToneForge** entry reports `Active` (and can toggle synthesis without a scene
  restart).
- **Loud failures.** A load/normalisation failure emits a `console.warn` with
  the reason and is retained by `getMainStreetTfDiagnostics()`
  (`loaded` / `factoryCount` / `lastLoadError`), which the scene forwards to
  `SoundManager.setSynthDiagnostics()`.
- **Missing-factory fallback.** `MAIN_STREET_TF_SFX_MAPPING` maps 16 logical
  keys but the runtime module ships only 12 factories. A mapped key with no
  matching factory now falls back to the WAV/Phaser path instead of going
  silent (`tfAdapter` reports whether it handled the key;
  `SoundManager.play()` falls through when it did not) — engine item
  CG-0MUU9PSWC009CW76.

## Player hand layout

Main Street renders the player hand with the core engine's single `HandView`
(`MainStreetRendererStreet.ts`), anchored on `handCenterX` and declaring the
hand's capacity up front with `maxSlots: state.maxHandSize`.

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
- Illegal attempt: `playIllegalFeedback()` (ILLEGAL_MOVE SFX + shake) plus an
  instruction-text reason **precedes any mutation** — no coins, action, hand or
  grid change, and the current selection/`uiPhase` is retained so the player
  can immediately retarget.
- Click paths use the shared predicates `canPlaceFromHand`
  (`MainStreetEngineCommands.ts`) and `canPlayUpgradeFromHand`
  (`MainStreetMarketPurchase.ts`) before `onSlotClick` / `applyHandUpgradeToSlot`
  animate. Drag paths are gated by the drop zone's `canAccept`
  (`canDropBusinessCard` / `canDropUpgradeCard`); `@ui/dragDrop` only invokes
  the `onDrop` handler after `canAccept` returns true, so the transfer starts
  strictly after the gate.
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
- Clearing: `cancelPendingPlacement()` (Escape / switching card) calls
  `clearTargetHighlights()`; applying the upgrade rebuilds the street without
  a pending card, dropping the overlays. Both targeting flows share the
  `dragHighlightRects` pool, so drag-drop and click-to-place highlights render
  identically and clear together.
- Reuse: the existing `dragHighlightRects` infrastructure and
  `isEligibleUpgradeTarget()` predicate; no new engine primitives.

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
- Deliberate shop entry (MS-0MUZ6CGSV002WTYM): when a figure chooses an
  **occupied** cell (`occupiedShops`, a truthy `streetGrid` entry) it switches
  to `entering` and **walks** to the shop (`beginShopEntry`,
  `stepPedestrianFigure`), becoming `inside` only on arrival — it never
  teleports. Once inside it stays there.
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
  figures always enter from a block corner.
- Turn lifecycle (MS-0MUZ4WB290024ZGQ, polished by MS-0MUZ6CGSV002WTYM): at the
  end of the turn `MainStreetPedestrians.beginEndOfTurn()` sends every
  non-shopping figure **walking off the block** (`directFigureOffBlock`, removed
  once clear) rather than vanishing in place, while enough figures walk into
  occupied shops. At the start of the new turn (`startTurnPhase`)
  `startNewTurn()` clears any leftovers and spawns a fresh set that wanders
  onto the street from the four corners of the block (`network.corners`).
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
  landing, the `+total` pop and the phase pacing (`INCOME_PHASE_GAP_MS`) are
  unchanged — the pedestrians are a visual source only, so the phase-sum
  invariant and the deferred-mutation economy are untouched.
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
    pedestrians (see *Ambient street pedestrians* above); event contributions
    fly in/out of the grids and also light up their `Upcoming`-panel effect
    lines (`animateUpcomingEffectLine`).
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
  - Phase pace: `INCOME_PHASE_GAP_MS` (default 2200ms) between phases;
    collection lands at ≈11s — **this pacing is part of the feature's
    acceptance criteria and MUST NOT be shortened** (the turn controller
    defers the week start until the show completes, so gameplay timing is
    unaffected).
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
- Reuse: `createCoinGrid` (`example-games/main-street/coin-grid.ts`) +
  `moveGameObject` + `SoundManager` + `popTextOrIcon`; no new engine
  infrastructure.
- Reuse: `moveGameObject` + `SoundManager` + `popTextOrIcon`, `SFX_KEYS`
  (`COMMON_SFX_KEYS` convention); no new SFX keys or engine infrastructure.

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
  (`example-games/main-street/scenes/synergyLineEndpoints.ts`) — the
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
- Accessibility (reduced motion): skipped entirely — the current behaviour
  (instruction text only) is preserved (spec AC3).
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

### Game-over panel (two-column summary)

- Renderer: `MainStreetOverlayContent.showGameOverOverlay()`.
- Model: `src/scenes/MainStreetGameOverSummary.ts` (pure, no Phaser import) —
  `formatEndReason`, `buildGameOverPlayerRows` and
  `buildGameOverChallengeSummary`, reusing
  `buildCompetitiveScoreboard` for the per-seat rows.
- Layout:
  - **Top band:** the title (`You Win!` / `Game Over`) plus a plain-language
    end-reason headline derived from `state.endReason` (e.g. *Bankruptcy*,
    *Reputation collapse*, *Score threshold reached*, *All challenges
    completed*, *Last standing*, *Turn limit exhausted*). In competitive mode a
    per-seat failure names the player concerned (e.g. `Bankruptcy — You`,
    `Reputation collapse — AI 1`), preferring the human seat.
  - **Left "Game State" column:** one row per player — `You` for the human
    seat, `AI <n>` for AI seats — showing coins, reputation and score read
    directly from each `PlayerRecord` (single-player synthesises the sole
    `You` row from the shared wallet). A failing or eliminated seat carries a
    `Bankrupt`, `Reputation collapse` or `Eliminated` badge (cause before
    consequence; reputation collapse applies only after turn 1). The run's
    challenges met follow below — challenges are run-global in the engine, so
    they are shown once per run rather than per player.
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
  <action>" pop appears just above the hint bar (bottom-centre,
  `popTextOrIcon` riseY −16) with a UI click SFX (`SFX_KEYS.CLICK`).
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
