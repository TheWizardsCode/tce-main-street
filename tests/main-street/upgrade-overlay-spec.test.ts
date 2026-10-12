/**
 * Main Street: Upgrade Overlay Spec Tests (CG-0MT24MHGZ0025O20)
 *
 * Validates that `buildUpgradeOverlaySpec()` produces NO name overlay for
 * either base or upgraded cards — the upgraded name is baked into the card's
 * SVG texture (display-name variant) rather than rendered as a Phaser overlay.
 *
 * Acceptance criteria (as updated per manual review — the name must be part
 * of the card image, not an overlay):
 *   AC1  Upgraded cards display the upgraded name as part of the card face.
 *   AC2  The upgraded name is derived from the BusinessCard's `displayName`
 *        field, which is populated when upgrades are applied.
 *   AC3  Multi-level upgrades show the name from the most recently applied upgrade.
 *   AC4  Base (un-upgraded) cards have no name overlay (`nameText` absent).
 *   AC6  `buildUpgradeOverlaySpec` no longer carries a `nameText` overlay
 *        (the name moved into the card SVG); the upgraded-name display is
 *        covered by card-face tests (card-svg-generator.replaceCardTitleInSvg /
 *        generateBusinessCardSvg).
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { buildUpgradeOverlaySpec, sampleShaderGradient } from '../../src/scenes/UpgradeOverlaySpec';
import type { BusinessCard, CommunitySpaceCard } from '../../src/MainStreetCards';
import { getUpgradeTemplates } from '../../src/MainStreetCards';

// ── Test helpers ──────────────────────────────────────────────

const WIDTH = 120;
const HEIGHT = 160;

/** Creates a minimal BusinessCard for testing. */
function makeBusiness(overrides: Partial<BusinessCard> = {}): BusinessCard {
  const base: BusinessCard = {
    family: 'business',
    id: 'test-biz',
    name: 'Test Business',
    cost: 3,
    baseIncome: 0.5,
    synergyTypes: [],
    maxLevel: 2,
    description: 'A test business.',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  };
  return base;
}

/** Creates a minimal CommunitySpaceCard for testing. */
function makeCommunitySpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  const base: CommunitySpaceCard = {
    family: 'community-space',
    id: 'test-cs',
    name: 'Test Community Space',
    cost: 4,
    baseIncome: 0.3,
    ongoingCost: 0,
    synergyTypes: [],
    maxLevel: 2,
    description: 'A test community space.',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    ...overrides,
  };
  return base;
}

// ── AC1, AC2, AC4: No name overlay on any card ────────────────

describe('No nameText overlay (name is part of the card face, AC1/AC2/AC4)', () => {
  it('returns no nameText for a base BusinessCard', () => {
    const biz = makeBusiness({ level: 0 });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);
    expect(spec).not.toHaveProperty('nameText');
  });

  it('returns no nameText for a base CommunitySpaceCard', () => {
    const cs = makeCommunitySpace({ level: 0 });
    const spec = buildUpgradeOverlaySpec(cs, WIDTH, HEIGHT);
    expect(spec).not.toHaveProperty('nameText');
  });

  it('returns no nameText for an upgraded card (Bakery → Patisserie)', () => {
    const biz = makeBusiness({
      level: 1,
      name: 'Bakery',
      displayName: 'Patisserie',
    });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);
    // The upgraded name is baked into the card SVG, so the overlay spec must
    // not carry a name overlay at all (AC1 mechanism per manual review).
    expect(spec).not.toHaveProperty('nameText');
  });

  it('keeps the non-name overlay fields intact for upgraded cards', () => {
    const biz = makeBusiness({
      level: 1,
      name: 'Bakery',
      displayName: 'Patisserie',
    });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);
    expect(spec.levelBadge).not.toBeNull();
    expect(spec.levelBadge!.text).toBe('Lvl 1');
    expect(spec.levelAccent).not.toBeNull();
    expect(spec).not.toHaveProperty('upgradeBorder');
  });
});

// ── AC2: CSV data-driven newDisplayName ───────────────────────

describe('CSV data: upgrade templates carry newDisplayName (AC2)', () => {
  it('every upgrade template has a non-empty newDisplayName', () => {
    const templates = getUpgradeTemplates();
    const missing = templates.filter(t => !t.newDisplayName || t.newDisplayName.trim() === '');
    if (missing.length > 0) {
      console.warn(`Missing newDisplayName for: ${missing.map(t => t.id).join(', ')}`);
    }
    expect(missing.length).toBe(0);
  });

  it('Bakery upgrade (upg-patisserie) has displayName "Patisserie"', () => {
    const upg = getUpgradeTemplates().find(t => t.id === 'upg-patisserie');
    expect(upg).toBeDefined();
    expect(upg!.newDisplayName).toBe('Patisserie');
  });

  it('Diner upgrade (upg-bistro) has displayName "Bistro"', () => {
    const upg = getUpgradeTemplates().find(t => t.id === 'upg-bistro');
    expect(upg).toBeDefined();
    expect(upg!.newDisplayName).toBe('Bistro');
  });

  it('multi-level upgrade (upg-home-improvement) has displayName "Home Improvement"', () => {
    const upg = getUpgradeTemplates().find(t => t.id === 'upg-home-improvement');
    expect(upg).toBeDefined();
    expect(upg!.newDisplayName).toBe('Home Improvement');
  });
});

// ── Overlay spec structural integrity ─────────────────────────

describe('Overlay spec structure', () => {
  it('base card: levelBadge and levelAccent are null, cashLine is present', () => {
    const biz = makeBusiness({ level: 0, baseIncome: 1 });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);

    expect(spec.levelBadge).toBeNull();
    expect(spec.levelAccent).toBeNull();
    expect(spec.cashLine).not.toBeNull();
    expect(spec.cashLine!.text).toBe('+1');
  });

  it('upgraded card: cash/reputation/level/accent overlays present when income > 0', () => {
    const biz = makeBusiness({
      level: 1,
      name: 'Bakery',
      displayName: 'Patisserie',
      baseIncome: 0.5,
      incomeBonus: 1,
    });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);

    expect(spec.levelBadge).not.toBeNull();
    expect(spec.levelBadge!.text).toBe('Lvl 1');
    expect(spec.levelAccent).not.toBeNull();
    expect(spec.cashLine).not.toBeNull();
    expect(spec.cashLine!.text).toBe('+1.5');
    // The full-card upgrade border was removed in F4
    // (MS-0MV34MIUY009WRME): the owner's seat colour now owns the frame.
    expect(spec).not.toHaveProperty('upgradeBorder');
  });

  it('reputation overlay reflects upgrade reputationBonus', () => {
    const biz = makeBusiness({
      level: 1,
      reputationPerTurn: 20,
      reputationBonus: 10,
    });
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT);
    expect(spec.reputationText).not.toBeNull();
    expect(spec.reputationText!.text).toBe('+30/turn');
  });
});

// ── AC2: Pure shader-effect spec (MS-0MV5I4NTU002D3V4) ─────────

/**
 * The `shaderEffect` field is the pure, Phaser-free contract that the
 * rendering slices (MS-0MV5I4O8U001SU5J / MS-0MV5I4ONA000Z7NV) consume. These
 * tests pin the base-vs-upgraded boundary, the pure-data shape (gradient stops,
 * animation parameters, reduced-motion static form flag) and the constraints
 * that no full-card `upgradeBorder` and no per-level texture-cache key return.
 */
describe('shaderEffect: base vs upgraded output (AC2)', () => {
  it('is null for a base BusinessCard (level 0)', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 0 }), WIDTH, HEIGHT);
    expect(spec.shaderEffect).toBeNull();
  });

  it('is null for a base CommunitySpaceCard (level 0)', () => {
    const spec = buildUpgradeOverlaySpec(makeCommunitySpace({ level: 0 }), WIDTH, HEIGHT);
    expect(spec.shaderEffect).toBeNull();
  });

  it('is populated for an upgraded BusinessCard (level > 0)', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    expect(spec.shaderEffect).toBeDefined();
    expect(spec.shaderEffect).not.toBeNull();
  });

  it('is populated for an upgraded CommunitySpaceCard (level > 0)', () => {
    const spec = buildUpgradeOverlaySpec(makeCommunitySpace({ level: 2 }), WIDTH, HEIGHT);
    expect(spec.shaderEffect).toBeDefined();
    expect(spec.shaderEffect).not.toBeNull();
  });
});

describe('shaderEffect: pure data shape', () => {
  it('exposes ordered gradient colour stops reusing the golden accent palette', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    const effect = spec.shaderEffect!;
    expect(Array.isArray(effect.colourStops)).toBe(true);
    expect(effect.colourStops.length).toBeGreaterThanOrEqual(2);

    const colours = effect.colourStops.map(stop => stop.color);
    expect(colours).toContain(0xffaa22); // existing levelAccent golden
    expect(colours).toContain(0xffe08a); // lighter highlight stop

    // Stops are ordered left-to-right for a renderable static gradient.
    const offsets = effect.colourStops.map(stop => stop.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    for (const stop of effect.colourStops) {
      expect(stop.offset).toBeGreaterThanOrEqual(0);
      expect(stop.offset).toBeLessThanOrEqual(1);
      expect(stop.alpha).toBeGreaterThanOrEqual(0);
      expect(stop.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('exposes deterministic animation parameters (duration/easing/amplitude)', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    const effect = spec.shaderEffect!;

    expect(typeof effect.animationDurationMs).toBe('number');
    expect(effect.animationDurationMs).toBeGreaterThanOrEqual(1800);
    expect(effect.animationDurationMs).toBeLessThanOrEqual(2400);

    expect(typeof effect.animationEasing).toBe('string');
    expect(effect.animationEasing.length).toBeGreaterThan(0);

    expect(typeof effect.animationAmplitude).toBe('number');
    expect(effect.animationAmplitude).toBeGreaterThan(0);
  });

  it('marks a static (reduced-motion) form as available', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    const effect = spec.shaderEffect!;
    expect(effect.staticForm).toBe(true);
    // The static form is renderable from the same gradient stops; a non-empty
    // stop list is what slice 2 draws when motion is disallowed.
    expect(effect.colourStops.length).toBeGreaterThan(0);
  });
});

describe('shaderEffect: no upgradeBorder, no per-level texture keys', () => {
  it('does not reintroduce a full-card upgradeBorder', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    expect(spec).not.toHaveProperty('upgradeBorder');
    expect(spec.shaderEffect).not.toHaveProperty('upgradeBorder');
  });

  it('exposes no per-level texture-cache key', () => {
    const spec = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT);
    expect(spec.shaderEffect).not.toHaveProperty('textureKey');
    expect(spec.shaderEffect).not.toHaveProperty('textureCacheKey');
    expect(Object.keys(spec.shaderEffect!)).not.toContain('textureKey');
  });

  it('produces an identical effect across levels (no per-level spec variants)', () => {
    const lvl1 = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT).shaderEffect;
    const lvl2 = buildUpgradeOverlaySpec(makeBusiness({ level: 2 }), WIDTH, HEIGHT).shaderEffect;
    expect(lvl1).toEqual(lvl2);
  });
});

// ── AC2/AC5: pure gradient sampler consumed by the renderer ─────

/**
 * `sampleShaderGradient` is the pure, Phaser-free helper the renderer uses to
 * approximate a Canvas gradient with vertical strips (MS-0MV5I4O8U001SU5J).
 * These tests pin interpolation, clamping and determinism so the rendering
 * slice has no hidden rendering logic to re-test.
 */
describe('sampleShaderGradient (AC2/AC5)', () => {
  const stops = [
    { offset: 0, color: 0xffaa22, alpha: 0.92 },
    { offset: 0.5, color: 0xffe08a, alpha: 1 },
    { offset: 1, color: 0xffaa22, alpha: 0.92 },
  ];

  it('returns the first stop at t=0 and the last stop at t=1', () => {
    expect(sampleShaderGradient(stops, 0)).toEqual({ color: 0xffaa22, alpha: 0.92 });
    expect(sampleShaderGradient(stops, 1)).toEqual({ color: 0xffaa22, alpha: 0.92 });
  });

  it('returns the highlight stop exactly at its offset', () => {
    expect(sampleShaderGradient(stops, 0.5)).toEqual({ color: 0xffe08a, alpha: 1 });
  });

  it('clamps positions below 0 and above 1 to the end stops', () => {
    expect(sampleShaderGradient(stops, -5)).toEqual({ color: 0xffaa22, alpha: 0.92 });
    expect(sampleShaderGradient(stops, 5)).toEqual({ color: 0xffaa22, alpha: 0.92 });
  });

  it('linearly interpolates colour and alpha between adjacent stops', () => {
    // Halfway between 0xffaa22 (a=0.92) and 0xffe08a (a=1).
    const mid = sampleShaderGradient(stops, 0.25);
    expect(mid.color).toBe(0xffc556);
    expect(mid.alpha).toBeCloseTo(0.96, 5);
  });

  it('returns a transparent black for an empty stop list (defensive)', () => {
    expect(sampleShaderGradient([], 0.5)).toEqual({ color: 0x000000, alpha: 0 });
  });

  it('samples the real upgraded spec deterministically', () => {
    const effect = buildUpgradeOverlaySpec(makeBusiness({ level: 1 }), WIDTH, HEIGHT).shaderEffect!;
    expect(sampleShaderGradient(effect.colourStops, 0).color).toBe(0xffaa22);
    expect(sampleShaderGradient(effect.colourStops, 1).color).toBe(0xffaa22);
  });
});