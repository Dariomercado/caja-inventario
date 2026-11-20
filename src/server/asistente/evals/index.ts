/**
 * Public surface of the eval machinery, consumed by `scripts/evals.mjs`.
 *
 * `caso` holds the versioned case/fixture contract, `transporte` the two offline
 * transports and `runner` the orchestration against the database.
 */
export * from './caso'
export * from './transporte'
export * from './runner'
