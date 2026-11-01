import {
  SaveLoadStore,
  CheckpointManager,
  type SaveSerializer,
} from '@core-engine';
import {
  type MainStreetCampaignProgress,
  type MainStreetSerializedState,
  type MainStreetState,
  migrateMainStreetSerializedState,
  serializeMainStreetState,
  deserializeMainStreetState,
} from './MainStreetState';
import {
  TIER_DEFINITIONS,
  ORDERED_TIER_DEFINITIONS,
  deriveUnlockedCardIds,
} from './MainStreetTiers';

/**
 * Current run-checkpoint schema version.
 *
 * Bumped to **3** by the loan-persistence slice (MS-0MVPWSE0E003QLKE) when the
 * payload gained `loans` / `pendingLoanOffer`. Older saves are accepted through
 * `mainStreetStateSerializer.migrate` (and the idempotent backfill inside
 * `deserializeMainStreetState`), so a pre-loan v2 save still loads unchanged.
 *
 * Campaign progress has its own, independently versioned schema below — do not
 * tie the two together.
 */
export const MAIN_STREET_SAVE_SCHEMA_VERSION = 3;
export const MAIN_STREET_CAMPAIGN_SCHEMA_VERSION = 3;
export const MAIN_STREET_GAME_TYPE = 'main-street';
export const MAIN_STREET_RUN_SLOT = 'turn-start';
export const MAIN_STREET_CAMPAIGN_SLOT = 'campaign-default';

export const mainStreetStateSerializer: SaveSerializer<
  MainStreetState,
  MainStreetSerializedState
> = {
  schemaVersion: MAIN_STREET_SAVE_SCHEMA_VERSION,
  serialize: serializeMainStreetState,
  deserialize: deserializeMainStreetState,
  // v1 → v2 (CG-0MTMYIHKO001QCWL): the day→week terminology rename maps the
  // legacy 'DayStart' phase and dayStartCoins/dayStartRep/dayStartScore fields
  // to their week equivalents inside migrateSerializedState(), which runs as
  // part of deserializeMainStreetState().
  // v2 → v3 (MS-0MVPWSE0E003QLKE): active bank loans and the pending bailout
  // offer. A v2 payload carries neither field; the migration adds the empty
  // defaults so a pre-loan save resumes with no loans and no offer (parent
  // AC9). The per-entry validation happens on the way into the runtime state.
  migrate: migrateMainStreetSerializedState,
};

export const mainStreetCampaignSerializer: SaveSerializer<
  MainStreetCampaignProgress,
  MainStreetCampaignProgress
> = {
  schemaVersion: MAIN_STREET_CAMPAIGN_SCHEMA_VERSION,
  serialize: (state) => structuredClone(state),
  deserialize: (data) => {
    // v1 → v2 migration: add schemaVersion, unlockedCardIds, milestoneHistory
    // v2 → v3 migration: terminology rename (no field shape change)
    // (CG-0MTMYIHKO001QCWL)
    let working = data as any;
    if (!working.schemaVersion || working.schemaVersion < 2) {
      working = {
        ...working,
        schemaVersion: 2,
        unlockedCardIds: deriveUnlockedCardIds(working.unlockedTiers),
        milestoneHistory: [],
      };
    }
    if (working.schemaVersion < MAIN_STREET_CAMPAIGN_SCHEMA_VERSION) {
      working = { ...working, schemaVersion: MAIN_STREET_CAMPAIGN_SCHEMA_VERSION };
    }

    // Ensure tutorialSeen flag exists on returned object for runtime code.
    const cloned = structuredClone(working) as any;
    if (typeof cloned.tutorialSeen === 'undefined') {
      cloned.tutorialSeen = false;
    }
    return cloned as MainStreetCampaignProgress;
  },
  // v1/v2 → v3 (CG-0MTMYIHKO001QCWL): the campaign shape is unchanged by the
  // terminology rename; the field upgrades are applied by deserialize above.
  migrate: (data) => data,
};

export function createDefaultCampaignProgress(): MainStreetCampaignProgress {
  return {
    schemaVersion: MAIN_STREET_CAMPAIGN_SCHEMA_VERSION,
    unlockedTiers: ['tier-1'],
    unlockedCardIds: TIER_DEFINITIONS['tier-1'].cumulativeCardIds.slice(),
    milestoneHistory: [],
    persistentReputation: 0,
    highestScore: 0,
    totalRuns: 0,
    totalWins: 0,
    lastUpdatedAt: new Date().toISOString(),
    tutorialSeen: false,
  };
}

/**
 * Create a canonical {@link CheckpointManager} for Main Street run checkpoints.
 *
 * Uses the existing {@link mainStreetStateSerializer} and the shared
 * `MAIN_STREET_GAME_TYPE` / `MAIN_STREET_RUN_SLOT` constants so that all
 * checkpoint operations follow the same pattern as Feudalism and
 * Beleaguered Castle.
 *
 * @param store - Initialized SaveLoadStore instance.
 * @returns A new CheckpointManager bound to Main Street's slot and serializer.
 */
export function createMainStreetCheckpointManager(
  store: SaveLoadStore,
): CheckpointManager<MainStreetState, MainStreetSerializedState> {
  return new CheckpointManager(
    store,
    MAIN_STREET_GAME_TYPE,
    MAIN_STREET_RUN_SLOT,
    mainStreetStateSerializer,
  );
}

/**
 * Remove the saved turn-start checkpoint.
 *
 * Safe to call even when no checkpoint exists. Delegates to
 * {@link CheckpointManager.clear}.
 *
 * @param store - Initialized SaveLoadStore instance.
 */
export async function clearTurnStartCheckpoint(
  store: SaveLoadStore,
): Promise<void> {
  const mgr = createMainStreetCheckpointManager(store);
  await mgr.clear();
}

/**
 * Evaluates tier unlocks and updates campaign progress after a completed run.
 *
 * Called after EndCheck phase determines the game result.
 * Mutates the campaign progress in place, then persists it.
 *
 * @param campaign  Current campaign progress (loaded from storage).
 * @param state     Completed game state (after EndCheck).
 * @param store     Save/Load store for persistence (optional; if provided, saves automatically).
 * @returns The updated campaign progress.
 */
export async function updateCampaignAfterRun(
  campaign: MainStreetCampaignProgress,
  state: MainStreetState,
  store?: SaveLoadStore,
): Promise<MainStreetCampaignProgress> {
  const now = new Date().toISOString();

  // Update statistics
  campaign.totalRuns += 1;
  if (state.gameResult === 'win') campaign.totalWins += 1;
  if (state.finalScore > campaign.highestScore) {
    campaign.highestScore = state.finalScore;
  }
  if (state.resourceBank.reputation > campaign.persistentReputation) {
    campaign.persistentReputation = state.resourceBank.reputation;
  }

  // Evaluate tier unlocks (ordered by tier number). At most ONE tier unlocks
  // per completed run (MS-0MV88T4I6000HQZG): the lowest newly-eligible locked
  // tier, whichever path made it eligible — reputation, challenge, or both.
  // This paces the ladder so a single strong run cannot burst through several
  // rungs at once; later runs continue from the next locked tier.
  for (const tierDef of ORDERED_TIER_DEFINITIONS) {
    // Skip tier-1 (always unlocked) and already-unlocked tiers
    if (tierDef.id === 'tier-1') continue;
    if (campaign.unlockedTiers.includes(tierDef.id)) continue;

    const reputationMet =
      state.resourceBank.reputation >= tierDef.reputationThreshold;
    const challengeMet = tierDef.challengeCondition(state);

    if (!reputationMet && !challengeMet) continue;

    campaign.unlockedTiers.push(tierDef.id);
    campaign.milestoneHistory.push({
      tierId: tierDef.id,
      triggerType: reputationMet ? 'reputation' : 'challenge',
      reputationAtUnlock: reputationMet
        ? state.resourceBank.reputation
        : null,
      challengeIdsAtUnlock: challengeMet
        ? [...state.challengesCompleted]
        : null,
      runFinalScore: state.finalScore,
      runSeed: state.seed,
      unlockedAt: now,
    });
    break; // one tier unlock per completed run
  }

  // Derive updated card list from all unlocked tiers
  campaign.unlockedCardIds = deriveUnlockedCardIds(campaign.unlockedTiers);
  campaign.lastUpdatedAt = now;

  // Persist if store is provided
  if (store) {
    await saveCampaignProgress(store, campaign);
  }

  return campaign;
}

export async function saveTurnStartCheckpoint(
  store: SaveLoadStore,
  state: MainStreetState,
  _slotId: string = MAIN_STREET_RUN_SLOT,
): Promise<void> {
  const mgr = createMainStreetCheckpointManager(store);
  await mgr.save(state);
}

export async function loadTurnStartCheckpoint(
  store: SaveLoadStore,
  _slotId: string = MAIN_STREET_RUN_SLOT,
): Promise<MainStreetState | null> {
  const mgr = createMainStreetCheckpointManager(store);
  return mgr.load();
}

export async function saveCampaignProgress(
  store: SaveLoadStore,
  progress: MainStreetCampaignProgress,
  slotId: string = MAIN_STREET_CAMPAIGN_SLOT,
): Promise<void> {
  await store.saveCampaignProgress(
    MAIN_STREET_GAME_TYPE,
    slotId,
    mainStreetCampaignSerializer,
    progress,
  );
}

export async function loadCampaignProgress(
  store: SaveLoadStore,
  slotId: string = MAIN_STREET_CAMPAIGN_SLOT,
): Promise<MainStreetCampaignProgress | null> {
  return store.loadCampaignProgress(
    MAIN_STREET_GAME_TYPE,
    slotId,
    mainStreetCampaignSerializer,
  );
}
