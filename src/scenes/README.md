# Main Street Scene Animation Helpers

This folder uses reusable UI helpers from `src/ui`:

- `popTextOrIcon` for short HUD/event feedback pops
- `moveGameObject` for card transfer animations from market to street/hand
- `attachSelection` + `createSingleSelectionManager` for persistent card selection highlights
- `runSceneTransition` helper exists in `src/ui`, but scene fades are currently disabled in Main Street
- `MainStreetAnimator.animateMarketDealIn` for the market deal-in animation
  (week-start refill and Discover/Research row swaps: incoming cards deal in
  with a staggered deal SFX; outgoing row cards fade/shrink out).
  Triggered by `MainStreetTurnController` after the final market render.
- `MainStreetAnimator.animateMarketDealIn` for the market deal-in animation
  (week-start refill and Discover/Research row swaps: incoming cards deal in
  with a staggered deal SFX; outgoing row cards fade/shrink out).
  Triggered by `MainStreetTurnController` after the final market render.
- `flashFeedback` / `flashError` / `flashConfirmation`
  (`MainStreetFeedback.ts`) for the transient pop-text feedback channel that
  replaced the instruction line.

## Opaque play panels and the player-hand panel (MS-0MVPWQIPZ002PHPD)

`MainStreetConstants.ts` is the single authority for the opaque panel
treatment shared by the market box, the player hand and the HUD strip:

- Fill `PANEL_FILL` `0x1a1408` at `PANEL_FILL_ALPHA` `0.85`; 1 px
  `BOX_STROKE` `0x665544` border at `PANEL_STROKE_ALPHA` `0.5`; `BOX_RADIUS`
  corners. The Activity Log is the reference treatment.
- `MainStreetRendererStreet.drawHandPanel()` — a persistent, non-interactive
  panel (`ms-hand-panel`, depth `HAND_PANEL_DEPTH` −100) behind the hand band,
  sized from the capacity row (`maxSlots × (handCardW + HAND_SLOT_PITCH_PAD)`,
  padded by `HAND_PANEL_PAD`), centred on `handCenterX`. The hand band is
  bottom-anchored to the SLL `hand` zone anchor; the action row keeps its own
  `actionRow` anchor (MS-0MVPWQMTL004J3GB).
- `MainStreetRendererHud.refreshHud()` — the HUD strip is an opaque rectangle
  aligned to `hudLeft`..`hudRight` with the same treatment.
- `MainStreetRendererMarket` — the market section background spans
  `marketLeft`..`marketRight` with the same treatment (the old `BOX_FILL` @ 0.3
  wash was replaced).

## Transient pop-text feedback channel (MS-0MVPWQK3U003DIR6, MS-0MVRDBD3P0026CXH)

`MainStreetFeedback.ts` replaces the persistent instruction line: former
instruction-line messages are surfaced as a readable toast centred over the
main content area (`logX / 2`) and lifted clear of the hand-card band
(`handY − handCardH / 2 − 20 px`), never a hard-coded pixel position. The
toast fades/scales in (160 ms), holds fully opaque for `words × 500 ms` (from
`feedbackHoldMs`), then fades out (300 ms) and is destroyed, at
`FEEDBACK_TOAST_DEPTH` (3000 — above every layer). A new message replaces the
previous toast; long messages word-wrap within the viewport. `error` and
`confirmation` kinds toast; `guidance` and `progress` kinds are dropped.
Reduced motion shows the same static toast for the same hold with no tweens.
Every surfaced message records `scene.lastFeedback` and
`scene.feedbackHistory` for tests/QA.

## End-of-turn income collection

`MainStreetAnimator.animateIncomeCollection({ income, repSources })` animates
end-of-turn income: one coin icon per producing slot arcs to the HUD coins
counter (staggered `sfx-coin-pop`), rep-earning cards fly a pip to the rep
counter, and a final `+total` pop lands when collection completes. See
`MainStreetTurnController.endTurn()` for the trigger and
`docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: flights skipped; the HUD refresh shows the single final
  pop + income sound.

## Shared end-of-turn closing presentation

`presentTurnClosing(tcCtx, result, onComplete, options)` in
`MainStreetTurnControllerAnimation.ts` is the single closing presentation
primitive (MS-0MUYFX7Q2004JQ5R). It owns the closing text (`closingSummary` /
`perSeatClosingSummary`), the incident reveal and the day-advance callback, and
is shared by single-player (`finishTurnPresentation`,
`MainStreetTurnControllerTurnFlow.ts`) and competitive
(`presentCompetitiveClosing`, `MainStreetTurnControllerCompetitive.ts`) so the
two flows cannot drift. Presentation-only: it consumes no RNG and mutates no
engine state.

In competitive mode (MS-0MUXAQQON006XA6I) the closing surfaces the
authoritative per-owner income on `TurnResult.playerIncome`
(`OwnerIncomeResult[]` from `applyCompetitiveIncome`, non-eliminated seats
only, in seat order). `presentCompetitiveClosing` then runs one **phase-major**
`animateIncomePhases` choreography: every seat's own
`phaseBreakdown.perSlotBreakdown` is concatenated in seat order and passed to a
single `animateIncomePhases` call, so each phase (base → synergy → reputation →
events → upcoming → collection) plays for the human seat, then AI 1, then AI 2
before the next phase begins. The presentation reports per-seat income
(`Player N: +X coins`). The shared incident reveal and day advance are
delegated to the primitive with the shared income line suppressed
(`incomeSummary: ''`).

- Bounded/non-blocking: the primitive waits for the combined choreography to
  finish collecting before the day advances (`waitForIncomeCollection`),
  clamped to `COMPETITIVE_CLOSING_MAX_TOTAL_MS`, so a large roster cannot
  stall the day and the animation is never left running in the background.
- Reduced motion / replay / headless: the per-seat animations are skipped,
  the per-seat text is still shown and the day always advances.
- No per-owner data (single-player-free / legacy results): the condensed
  shared summary is kept.
- See `docs/game/ux-visual-audio.md` for the design notes.

## Ambient street pedestrians (reputation crowd)

`MainStreetPedestrians` (MS-0MTV9AS15004AC1E; reworked MS-0MUZ4WB290024ZGQ;
polished MS-0MUZ6CGSV002WTYM) renders a presentation-only crowd of small
solid-colour silhouettes that walk the road bands between and around the
street cells, each keeping to one side of the road (a lane offset). The
population is a pure function of reputation (`pedestrianCount`, 1 figure per
50, uncapped, `#88bbff`); the crowd tracks the HUD reputation value live
(fade in/out) and persists across street rebuilds. People always walk to the
**nearest occupied cell** (re-resolved each frame, so a cell filled mid-turn
is picked up) and **walk** deliberately into it, where each spreads to its own
random spot inside the cell and stays (no teleporting). At the end of the
turn the non-shoppers walk off the block and enough figures walk into shops;
at the start of the next turn the leftovers clear and a fresh set enters from
the block corners. During the phased income
show, the `reputation` phase first sends at least 25% of the crowd walking
into occupied cells, then dissolves the in-shop figures into the coin stream
that lands in each business's coin grid (`dissolveIntoCoins`, street-anchor
fallback when no shops/figures — never the HUD counter). All producing
businesses' reputation flights launch **near-simultaneously** — only
`INCOME_FLIGHT_STAGGER_MS` (60ms) between businesses, mirroring the synergy
phase (MS-0MV8LHN0W0017XU1) — so the reputation income reads as one
collective event rather than a card-by-card crawl. One runtime-generated
texture is shared by every figure. See `docs/game/ux-visual-audio.md`
for the design notes.

- Presentation-only: never mutates state/transcript; every method is
  defensive.
- No gameplay RNG: road-walk randomness uses a module-local seeded PRNG.
- Reduced motion: no pedestrians or flights; replay/headless renders nothing.

**Layer ownership and attach contract (MS-0MVRMI1EQ002I24K).** The owning
module is `src/scenes/MainStreetPedestrians.ts` (`MainStreetPedestrians`). The
layer is constructed in `MainStreetLifecycleManagerLifecycle.create()` (the
pre-reset and post-scaffolding assignments — the latter is the live layer),
destroyed on scene shutdown, re-clamped on resize, driven from
`MainStreetScene.update()`, and re-attached **last** by its attach hook
`MainStreetRendererStreet.refreshStreetGrid` →
`s.msPedestrians.attachToStreet()` after `streetContainer.removeAll(true)`
(which destroys the layer's container). The population is reconciled only
from the HUD path — `MainStreetAnimatorIncome.animateHudValueChanges` →
`syncPedestrianPopulation` → `setPopulation(pedestrianCount(reputation))` — so
skipping or early-returning that path leaves an attached but empty layer,
silently. Reduced Motion and replay/headless render nothing. Full contract and
the root-cause note: `docs/game/ux-visual-audio.md` § *Ambient street
pedestrians (reputation crowd)*.

## Incident reveal presentation

`MainStreetAnimator.animateIncidentReveal({ cardId, incidentName, coinChange,
repChange, from })` animates an end-of-turn incident resolution: a snapshot
card visual flies from the face-down incident-deck panel (CG-0MSTOATDP000JNHH) to the board centre, a brief red
flash pulses, the warning sting plays (`sfx-income-negative`), the incident's
coin/rep losses pop on the HUD, and the ⚠ active-effects indicator pulses
once. The resource deltas come from `TurnResult.incidentCoinChange` /
`incidentRepChange` (surfaced by `processEndOfTurn`). Triggered by
`MainStreetTurnController.endTurn()`; see
`docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: sting + HUD loss pops retained; flight, flash, and
  indicator pulse skipped.

## Synergy link formation

`MainStreetAnimator.animateSynergyFormation({ fromIndex, toIndex,
sharedSynergy })` animates a newly-formed synergy link: the line fades in,
a spark expands at the midpoint, the paired cards pulse, a "Synergy!" pop
appears, and a chime plays (`sfx-income-positive`). The placement paths in
`MainStreetTurnController` diff `computeSynergyPairs()` before/after the
placement (`diffNewSynergyPairs`) so ONLY new pairs animate. See
`docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: chime + minimal "Synergy!" pop retained; line, spark, and
  pulse skipped.
- Replay/headless: returns immediately (documented exemption, AGENTS.md
  rule 8) — presentation-only, never mutates state or transcript.
- Income conduit (CG-0MTV6LZEA003YS3E): the SAME clipped `p1`/`p2` geometry is
  reused by the end-of-turn synergy phase's bidirectional coin flights
  (`synergyPhaseFlights` / `flyCoinsAlongLine`), so the animated income streams
  ride exactly on the static lines.

## Resource delta pop

```ts
const text = this.add.text(x, y, '+2', {
  fontSize: '16px',
  fontStyle: 'bold',
  color: '#ffdd66',
  fontFamily: FONT_FAMILY,
}).setOrigin(0.5);

void popTextOrIcon({
  scene: this,
  target: text,
  duration: 1500,
  riseY: 22,
  scale: 1.2,
  reducedMotion: this.settingsPanel?.reducedMotion,
});
```


## Upgrade level-up burst

`MainStreetAnimator.animateLevelUp({ slotIndex, level })` fires when an
upgrade lands on a business: a gold sparkle burst on the card plus a
"Level N" pop text. Triggered by `MainStreetTurnController.onUpgradeCardClick()`
in the transfer's `afterTransfer` hook (only when the upgrade command
succeeded). The arrival chime is the transfer's existing end SFX
(`sfx-upgrade-end`) — not replayed, so no double sound. See
`docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: "Level N" pop retained; sparkle burst skipped.

## Sell demolition + refund coin fly

`MainStreetAnimator.animateSell({ slotIndex, refund, cardId, family })`
plays when a sale is confirmed: a brief demolition on the sold card (a
pre-sold card snapshot shrinks/fades over ~380ms, revealing the dimmed SOLD
state after), then a refund coin flies from the sold slot to the HUD coins
counter with `sfx-coin-pop` and a "+€refund" pop lands at the counter.
Triggered by `MainStreetOverlayContent.showSellConfirmation()`'s Sell button
(only when the sell command succeeded). See
`docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: single "+€refund" pop + coin SFX retained; demolition and
  coin flight skipped.

## Manage Card dialog: Sell / Close / Cancel

Clicking a non-sold street card during MarketPhase opens the **Manage Card**
dialog (`MainStreetOverlayContent.showSellConfirmation`, panel 480×360):

- **[Sell]** — free; refunds coins (`sellBusinessCommand`) and leaves the card
  on the grid as an inert *sold* marker (existing behaviour).
- **[Close]** — costs **1 action, no coins** (`closeBusinessCommand` via the
  shared `consumeAction` enforcement point); removes the card from `streetGrid`
  into `discardPile`, recalculates neighbours, and frees the slot. Closing also
  applies a **reputation consequence** (MS-0MURC6XO8005W57D): reputation changes
  by `−(cardReputationPerTurn × closeReputationMultiplier)` (default 20, floored
  at 0), so a reputation-positive card is a penalty and a nuisance card is a
  boost; the result is undoable and shown in the log. Illegal closes (no
  actions, sold slot, empty slot) produce illegal-move feedback and no state
  change.
- **[Cancel]** — dismisses with no state change.

All text/buttons are parented into `hudContainer` at depth 201 (backdrop 199,
box 200) per the project overlay convention. Sold cards never open the dialog.

## Close demolition (no refund)

`MainStreetAnimator.animateClose({ slotIndex, cardId, family })` plays when a
close is confirmed: a pre-close card snapshot shrinks/fades over ~380ms, then a
brief "Closed" pop marks the freed slot and `sfx-discard` plays. There is **no**
refund coin fly and no "+€" pop (closing grants no coins). Triggered by the
Manage dialog's Close button (only when the close command succeeded).

- Reduced motion: demolition skipped; "Closed" pop + discard SFX retained.
- Replay/headless: resolves immediately (presentation-only).

## Week transition banner

`MainStreetAnimator.animateWeekBanner({ turn })` plays at each week start: a
non-interactive "Week N" banner fades in at the board centre (~250ms), holds,
and fades out (~800ms total) with a week-chime SFX (reused `sfx-click`).
Triggered by `MainStreetTurnController.startTurnPhase()` (including week 1);
skipped while the tutorial is active and on checkpoint resume. It never
intercepts pointer events, never shifts layout, and leaves the market fully
interactive. See `docs/game/ux-visual-audio.md` for the design notes.

- Reduced motion: skipped entirely (no banner motion; the HUD week label
  remains the cue).

## Held-event play burst

`MainStreetAnimator.animateEventPlayed({ x, y, eventName })` plays when a
held event card is played from the hand: an 8-spark event-coloured burst at
the card's position as it leaves the hand plus an event-name pop with
`sfx-event-cheer`. Triggered by `MainStreetTurnController.onPlayHeldEvent()`
(only when the play command succeeded; the card's hand position is captured
before the hand re-renders). See `docs/game/ux-visual-audio.md` for
the design notes.

- Reduced motion: pop + cheer SFX retained; spark burst skipped.

## Game-over panel and win celebration / loss sting

`MainStreetOverlayContent.showGameOverOverlay()` renders the final panel as a
two-column summary (top band title + plain-language end-reason headline;
left **Game State** column of per-player rows with failure/elimination badges
and the run's challenges met; right **Summary** column with the retained score
breakdown, challenge details, tier/campaign stats, difficulty selector and the
Play Again / Menu buttons). The content is derived from committed state by the
pure `src/scenes/MainStreetGameOverSummary.ts` model (no Phaser import), read
from each `PlayerRecord` in competitive mode. Overlay conventions: elements
parented into `scene.hudContainer` at depths 199 backdrop / 200 box / 201
interactive; read-only and reduced-motion safe.

`MainStreetAnimator.animateGameOver({ win, width, height })` plays when the
panel is revealed:

- **Win** (`gameResult: 'win'`): a confetti burst (24 coloured rectangles)
  falls across the board (scene-level depth 100.5) with the victory fanfare
  `sfx-game-win`.
- **Loss** (`gameResult: 'loss'`): a brief full-board dark pulse (depth 99.5,
  under the backdrop — only the board dims) with the low sting `sfx-game-lost`.

Both SFX keys are convention keys (`docs/SFX_CONVENTION.md`) loaded from the
shared default audio dir (`assets/audio/default/game-win.wav` /
`game-lost.wav`); no new ToneForge factory. Reduced motion plays sound only;
replay/headless skips everything (presentation-only). Non-blocking
fire-and-forget. See `docs/game/ux-visual-audio.md` for design notes.

## Undo/redo feedback notification

`MainStreetAnimator.animateUndoRedo({ action, description })` plays when
`MainStreetTurnController.performUndo()` / `performRedo()` reverse or
reapply a command: a brief "Undid: <action>" / "Redid: <action>" pop
bottom-centre, 60 px above the viewport bottom — over the bottom-anchored
hand band (`popTextOrIcon`, riseY −16, 1200 ms) — plus the UI click SFX
(`sfx-ui-click`). The action label reuses the command's `description`
(already captured for the transcript). Reduced motion uses the pop
fallback only (SFX retained); replay/headless skips everything
(presentation-only). See `docs/game/ux-visual-audio.md` for design
notes.
