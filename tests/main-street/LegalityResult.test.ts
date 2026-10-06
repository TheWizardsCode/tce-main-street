
// <!-- REFACTOR-CG-0MTP6KUL80008VMR
// smell: unused_eslint_disable
// severity: low
// description: Stale disable batch: Applicant 44, community-space-types 226, LegalityResult 43,50 — remove or convert to valid handling; part of CG-0MTP6KUL80008VMR.
// -->
import { describe, it, expect } from 'vitest';
import type { LegalityResult } from '@rule-engine/index';
import { RULE_ENGINE_VERSION } from '@rule-engine/index';
// The legalAction/illegalAction helper constructors are imported dynamically in
// the tests below so the suite exercises the real rule-engine exports.

describe('rule-engine / LegalityResult', () => {
  it('should export the rule-engine version', () => {
    expect(RULE_ENGINE_VERSION).toBe('0.1.0');
  });

  it('games can build validators on the legalAction/illegalAction helpers', async () => {
    const { legalAction, illegalAction } = await import(
      '@rule-engine/index'
    );
    const validateMove = (rank: number): LegalityResult =>
      rank > 0 ? legalAction() : illegalAction('rank must be positive');

    expect(validateMove(1)).toEqual({ legal: true });
    expect(validateMove(-1)).toEqual({
      legal: false,
      reason: 'rank must be positive',
    });
  });

  describe('legalAction / illegalAction helpers', () => {
    // Exercised through dynamic import of the real rule-engine exports.

    it('legalAction() returns { legal: true }', async () => {
      const { legalAction } = await import(
        '@rule-engine/index'
      );
      const result = legalAction();
      expect(result).toEqual({ legal: true });
      // Discriminant check
      if (result.legal) {
        expect(result.legal).toBe(true);
      } else {
        throw new Error('expected legal action');
      }
    });

    it('illegalAction(reason) returns { legal: false, reason }', async () => {
      const { illegalAction } = await import(
        '@rule-engine/index'
      );
      const result = illegalAction('not allowed');
      expect(result).toEqual({ legal: false, reason: 'not allowed' });
      // Discriminant check
      if (!result.legal) {
        expect(typeof result.reason).toBe('string');
        expect(result.reason).toBe('not allowed');
      } else {
        throw new Error('expected illegal action');
      }
    });

    it('illegalAction accepts empty string reason', async () => {
      const { illegalAction } = await import(
        '@rule-engine/index'
      );
      const result = illegalAction('');
      expect(result).toEqual({ legal: false, reason: '' });
    });

    it('illegalAction handles special characters in reason', async () => {
      const { illegalAction } = await import(
        '@rule-engine/index'
      );
      const reason = '🚫 invalid: card <9> not in hand!';
      const result = illegalAction(reason);
      expect(result).toEqual({ legal: false, reason });
    });

    it('legalAction result narrows correctly with if/else', async () => {
      const { legalAction, illegalAction } = await import(
        '@rule-engine/index'
      );
      const legal = legalAction();
      const illegal = illegalAction('nope');

      // Legal branch
      if (legal.legal) {
        expect(legal).toEqual({ legal: true });
      } else {
        throw new Error('should not reach illegal branch');
      }

      // Illegal branch
      if (!illegal.legal) {
        expect(illegal.reason).toBe('nope');
      } else {
        throw new Error('should not reach legal branch');
      }
    });
  });
});
