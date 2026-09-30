/**
 * Main Street help/rules content.
 *
 * Phaser-free so the help copy is defined once and consumed by both the help
 * panel (`MainStreetLifecycleManagerLifecycle`) and its content tests
 * (test-review C5, MS-0MUMO3BDE000QDXJ). Keeping the copy here stops the test
 * from silently drifting against a private mirror of the scene content.
 *
 * @module
 */

/** The PRD-required help section headings, in order (PRD milestone 5 §6). */
export const REQUIRED_HELP_SECTION_HEADINGS = [
  'How to Play',
  'Card Types',
  'Synergy and Placement',
  'Turn Flow',
  'Win / Loss Conditions',
  'Tools',
] as const;

/** The configuration the Win/Loss copy interpolates. */
export interface HelpContentConfig {
  /** Points needed to win. */
  winThreshold: number;
  /** Challenges needed for an instant win. */
  challengesPerRun: number;
}

/** A single help section's author-controlled content. */
export interface HelpSectionContent {
  heading: string;
  /** Body text for text-only sections (undefined for custom-rendered ones). */
  body?: string;
  /** Paragraph for the custom-rendered 'Synergy and Placement' section. */
  synergyParagraph?: string;
}

/** Synergy icon keys + labels rendered under the Synergy section paragraph. */
export const SYNERGY_HELP_ICONS = [
  { key: 'ms-icon-food', label: 'Food' },
  { key: 'ms-icon-culture', label: 'Culture' },
  { key: 'ms-icon-commerce', label: 'Commerce' },
  { key: 'ms-icon-service', label: 'Service' },
  { key: 'ms-icon-entertainment', label: 'Entertainment' },
] as const;

/**
 * Builds the ordered Main Street help/rules sections.
 *
 * @param cfg  The active game configuration (Win/Loss thresholds).
 * @returns The ordered help sections; the 'Synergy and Placement' section has
 *          `synergyParagraph` set instead of `body` because the scene renders
 *          it with a custom icon-decorated renderer.
 */
export function buildMainStreetHelpContent(cfg: HelpContentConfig): HelpSectionContent[] {
  return [
    {
      heading: 'How to Play',
      body:
        'Buy businesses from the market and place them on the 2x5 street.\n' +
        'Earn income and score through card value + synergy + reputation.\n' +
        'Buy upgrades to improve existing businesses.\n' +
        'Hold event cards and play them when timing is best.\n' +
        'Complete challenges for bonus points and instant-win conditions.\n' +
        'Challenges are checked after every action, so completing one updates\n' +
        'your score and tracker immediately; the end of turn only catches\n' +
        'challenges satisfied by income or incidents.\n' +
        'Manage coins and reputation to build the best street — games end\n' +
        'when you win (score threshold / all challenges) or lose\n' +
        '(bankruptcy / reputation collapse). There is no turn limit.',
    },
    {
      heading: 'Card Types',
      body:
        'Business (green): persistent board value, placed on your street.\n' +
        'Upgrade (orange): enhances an existing business on the street.\n' +
        'Event / Investment (brown): one-time effects, held in your hand.\n' +
        'Incident: hidden in a face-down deck; the top card is revealed and\n' +
        'resolves at the end of each turn. A peek staff member can look at the\n' +
        'top card once per turn (CG-0MSTOATDP000JNHH).\n' +
        'Each card has a cost, value, and one or more synergy types.',
    },
    {
      heading: 'Synergy and Placement',
      synergyParagraph:
        'Adjacent matching synergy types yield bonus income. ' +
        'Adjacency is 8-way: orthogonal AND diagonally adjacent slots count (including diagonal). ' +
        'Synergy bonuses stack additively per matching neighbor. ' +
        'Some cards bridge multiple synergy types and count for both. ' +
        'Upgrades can increase range and value. ' +
        'Plan placements to cluster synergies for higher returns. ' +
        'Selling a business stops its own income, but it stays on the street ' +
        'and keeps providing synergy to its neighbours (CG-0MT5XUE2200047IJ).',
    },
    {
      heading: 'Staff & Specialization Skills',
      body:
        'Staff cards in the market row are applicants. Each one carries 1-3\n' +
        'specialization skills (shown as colored chips on the card) that are\n' +
        'randomized once per game and locked. Color key: green = income,\n' +
        'blue = reputation, amber = cost reduction, red = incident mitigation.\n' +
        'Every applicant keeps the Town Gossip baseline (peek the incident\n' +
        'deck once per turn). No applicant may hold more than 1 income boost\n' +
        'AND 1 reputation boost, so stacks stay balanced. Hover a staff card\n' +
        'for its full skill list (I5, CG-0MT4WXX1Q00860VP).',
    },
    {
      heading: 'Turn Flow',
      body:
        'Week Start: market refreshes and income is calculated. Each turn\n' +
        'is one week of the Irish year (weeks 1–52), shown in the HUD as\n' +
        '"Week W · Year Y". Seasonal and holiday cards only appear during\n' +
        'their real-world windows (e.g. Harvest Festival in autumn).\n' +
        'Market Actions: buy businesses, upgrades, or events; place businesses\n' +
        'on the street grid to earn future income.\n' +
        'You get 1 action per week, plus 1 per action-granting staff\n' +
        '(Manager, Director, General Manager). Taking a card to hand costs\n' +
        '1 action, as does playing or placing it from hand — but a same-week\n' +
        'move + play/place pair costs 1 action total.\n' +
        'Card costs are paid when a card is placed or played, not when taken\n' +
        'to hand.\n' +
        'End Turn: resolves income, incidents, and advances to the next week.',
    },
    {
      heading: 'Win / Loss Conditions',
      body:
        `Reach ${cfg.winThreshold} points to win (coins + reputation + challenges).\n` +
        `Complete all ${cfg.challengesPerRun} challenges for an instant win.\n` +
        'No turn limit: keep playing until you win or lose.\n' +
        'Bankruptcy (coins < 0) or reputation collapse (rep <= 0) loses the game.',
    },
    {
      heading: 'Tools',
      body:
        'Hint: get a suggested move (once per turn).\n' +
        'Undo / Redo: step back or forward through market actions.\n' +
        'Refresh Market: re-roll the market row for coins (5, less with the Accountant).\n' +
        'Keyboard shortcuts: End Turn key configurable in Settings.',
    },
  ];
}
