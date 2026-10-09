/**
 * Main Street: Card test framework — result column definitions.
 *
 * Kept free of Node-only imports so both the Node result writer and the
 * browser test suite can import the column contract.
 *
 * @module
 */

/** The four result columns, in the order they are appended. */
export const RESULT_COLUMNS = [
  'unitTestStatus',
  'unitTestFailReason',
  'browserTestStatus',
  'browserTestFailReason',
] as const;

/** Column name → value, used to target a specific writer (unit vs browser). */
export interface ResultColumnTargets {
  readonly statusColumn: string;
  readonly reasonColumn: string;
}

/** Column targets for the unit integration results. */
export const UNIT_RESULT_TARGETS: ResultColumnTargets = {
  statusColumn: RESULT_COLUMNS[0],
  reasonColumn: RESULT_COLUMNS[1],
};

/** Column targets for the browser integration results. */
export const BROWSER_RESULT_TARGETS: ResultColumnTargets = {
  statusColumn: RESULT_COLUMNS[2],
  reasonColumn: RESULT_COLUMNS[3],
};
