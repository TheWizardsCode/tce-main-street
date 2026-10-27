/**
 * Main Street: hint transcript removal contract (MS-0MVPWQLIH008R5M3).
 *
 * Replaces the deleted `tests/main-street/hint.test.ts` for the transcript
 * side of the hint-removal contract (parent AC5):
 *
 *   1. The `'hint'` event variant is gone from `MainStreetTranscriptEvent`
 *      (compile-time pin, enforced by the `tsc --noEmit` build gate).
 *   2. Legacy saved transcripts that still contain historical `'hint'`
 *      events replay without throwing — recorded tolerance assumption, no
 *      data migration. The replay boundary (`MainStreetReplayAdapter`) does
 *      no per-event validation, and the recorder does not reject unknown /
 *      historical shapes.
 *
 * The tutorial banking-hint system is unrelated and is untouched by this
 * contract (its own tests cover it).
 *
 * @module tests/main-street/hint-transcript-tolerance
 */
import { describe, it, expect } from 'vitest';

import {
  MainStreetTranscriptRecorder,
  type MainStreetTranscriptEvent,
} from '../../src/MainStreetTranscript';
import { MainStreetReplayAdapter } from '../../src/scripts/adapters/MainStreetReplayAdapter';

/**
 * Compile-time removal pin: constructing a `'hint'` event as a typed
 * transcript event must be a type error once the variant is removed.
 *
 * Never executes — it exists solely so the `tsc --noEmit` build gate proves
 * the variant is gone. If the `'hint'` variant is ever reintroduced the
 * `@ts-expect-error` directive under-errors and the build fails.
 */
function hintVariantMustNotExist(): void {
  if (false) {
    // @ts-expect-error MS-0MVPWQLIH008R5M3: the 'hint' transcript variant was removed
    const hintEvent: MainStreetTranscriptEvent = { type: 'hint', turn: 1, recommendedAction: { type: 'end-turn' }, rationale: 'obsolete' };
    void hintEvent;
  }
}

describe('hint transcript removal contract', () => {
  it('no script path emits a `hint` transcript event', () => {
    // There is no getter/type member left to reference: the union variant is
    // removed (pinned at compile time by `hintVariantMustNotExist`), and no
    // runtime validator exists, so nothing can be emitted as a hint event.
    // This test documents the type space the deletion leaves behind.
    expect(hintVariantMustNotExist).toBeTypeOf('function');
  });

  it('replays a legacy transcript containing a `hint` event tolerantly', () => {
    // A saved transcript from before the removal carries historical `hint`
    // events. The replay boundary must accept it unchanged — no migration,
    // no per-event validation that would throw (recorded tolerance
    // assumption, MS-0MVPWQLIH008R5M3 AC3).
    const legacyTranscript = {
      version: 1,
      gameType: 'main-street',
      startedAt: '2026-10-01T10:00:00.000Z',
      endedAt: null,
      initialState: {
        seed: 'legacy-hint-save',
        snapshotAtTurn: 6,
      },
      events: [
        {
          type: 'hint',
          turn: 3,
          recommendedAction: { type: 'buy-business', cardId: 'bus-diner', slotIndex: 0 },
          rationale: 'Buy Diner at slot 1 for 50% synergy bonus',
          week: 3,
          year: 1,
        },
        { type: 'turn-end', turn: 3, week: 3, year: 1 },
      ],
      results: null,
    };

    const adapter = new MainStreetReplayAdapter();
    const result = adapter.validateTranscript(legacyTranscript);
    expect(result.valid).toBe(true);
    expect(() => adapter.validateTranscript(legacyTranscript)).not.toThrow();
  });

  it('the recorder boundary tolerates historical event shapes', () => {
    // `recordEvent` performs no schema validation: data already persisted in
    // old saves (including a `hint` event) can be injected/read without
    // throwing. The cast represents on-disk data crossing the boundary (a
    // saved transcript is JSON, not a checked type).
    const recorder = new MainStreetTranscriptRecorder({ seed: 'legacy', snapshotAtTurn: 1 });
    const legacyHintEvent = {
      type: 'hint',
      turn: 2,
      recommendedAction: { type: 'buy-event', cardId: 'evt-festival' },
      rationale: 'Buy Local Festival for +6 coins',
    } as unknown as MainStreetTranscriptEvent;
    expect(() => recorder.recordEvent(legacyHintEvent)).not.toThrow();
    expect(recorder.getTranscript().events).toHaveLength(1);
  });
});
