/**
 * Public surface of the eval machinery, consumed by `scripts/evals.mjs`.
 *
 * `caso` holds the versioned case/fixture contract, `transporte` the two offline
 * transports, `runner` the orchestration against the database and `tabla` the
 * per-tier rendering rules.
 */
export * from './caso'
export * from './transporte'
export * from './runner'
export * from './tabla'
