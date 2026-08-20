# Session Projections

[English](session-projection.md) | [中文](session-projection.zh.md) | 日本語

session-projection seamは[capability seam](../capability-seams.md)です。domain host pluginがlog由来のsession単位stateの現在値全体をclient carrierへ提供します。Service Definitionとregistry（[dsh-session-projection](../../packages/session/session-projection)、`ctx.sessionProjections`）、domain contributor（各自が1つのpure unitを登録）、carrier（[dsh-host-apiproxy](../../packages/host/apiproxy)のhistory tail pageと`session/projection` push frame）で構成されます。agent-loop spineの一部ではない任意capabilityです。frameworkがdriveし、domainがcomputeします。registryは`session/event`を1回subscribeし、commit済みeventをすべてのunitでfoldします。domainはsubscriptionを持たず、clientもdomain eventをfoldしません。完成したvalueを受け取ります。設計のauthorityは[session-projection RFC](../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md)、drive／cache／feedの約束は[package README](../../packages/session/session-projection/README.md)です。

Source: [`packages/session/session-projection/src/index.ts`](../../packages/session/session-projection/src/index.ts)

## Unit

`SessionProjectionMap`はchain全体（host unit、wire block、client hook）のmerge-extensible type tableです。valueはwire-JSONの全体値で、renderingはslot systemの責務であり、このlayerの責務ではありません。domainはkeyごとに1つの`ProjectionDefinition`を提供します。

```ts type-equiv
/**
 * One domain's state-driven computation unit: three pure synchronous
 * functions plus declarations — never an opaque getter. The framework drives
 * `apply` on every committed session event; the domain holds no
 * subscriptions and owns only the mathematics. All three functions MUST be
 * synchronous (an async unit would tear the carriers' consistency cut) and
 * `state` MUST be plain JSON (the persisted-cache precondition).
 */
interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  /** The projection key this unit owns (its `SessionProjectionMap` entry). */
  key: K
  /** Validates the wire payload (`view` output) before it leaves the host. */
  schema: ZodType<SessionProjectionMap[K]>
  /**
   * State for the empty log.
   * @returns the initial state.
   */
  init(): S
  /**
   * Pure transition: previous state + one committed event → next state. A
   * unit uninterested in an event MUST return the same state reference — an
   * unchanged reference (`Object.is`) produces zero downstream work.
   * @param state - the state covering all prior events.
   * @param event - the next committed session event.
   * @returns the next state (same reference when the event is not the unit's).
   */
  apply(state: S, event: SessionEvent): S
  /**
   * State → wire payload (the read-side projection).
   * @param state - the current state.
   * @returns the whole current value for this unit's key.
   */
  view(state: S): SessionProjectionMap[K]
  /**
   * Persisted-cache invalidation version: bump whenever the serialized state fields or the
   * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
   * rows from an older unit are discarded instead of being forward-applied
   * into garbage. Non-negative integer.
   */
  stateVersion: number
}
```

whole-value event ruleは重要です。stateを運ぶlog eventはbare deltaではなく、変更後のstate全体を持ちます。各transitionを単純かつ低コストにし、提供するvalueをself-describingにします（consumerではlast-wins）。

## Snapshotとchange feed

```ts type-equiv
/**
 * One consistent read cut over every registered unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered key. */
  values: Partial<SessionProjectionMap>
}
```

```ts type-equiv
/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: number,
) => void
```

`snapshot(session)`は完全に同期です。carrierはpage sliceと同じtickで読み取るため、`asOfSeq`は両方のreadを1つのsequence numberでカバーします。すべてのvalueはreturn前にunitのschemaを通過します。誤ってasyncになった`view`はPromiseを返し、schema validationがrejectします。change feedはcommit済みeventごとにstate *reference*が変わったunitにつき1回発火します。stateが変わらない場合、`apply`は同じreferenceを返さなければなりません。

## Registry：`ctx.sessionProjections`

`SessionProjectionRegistry`（[signature](#ctxsessionprojections--sessionprojectionregistry)）がdriveを所有します。1つの`session/event` subscription、登録済みunit全体へのeager `apply`、sessionごと／unitごとのwatermark cellです。cellはlazyに構築されます。eventが流れた後に登録されたunit、またはregistryより古いsessionは、最初のtouch（eventまたはread）でin-memory logに対して`init`をfoldします。registrationはcalling fiberに属するeffectで、disposerもそのfiberに従います。unloadしたdomain pluginのkey（cache済みcellを含む）は後続のdriveとsnapshotから消え、clientはcapability absenceとして認識します。duplicate keyはthrowします。domain pluginは`ctx.inject(['sessionProjections'], …)`配下でregisterするため、registryのないheadless assemblyには影響しません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus two mandatory points — `turn/end` and session disposal (the live-to-cold moment) — and serves the cold-read ladder: cached row, persistence `readFrom` tail, registry `restore`, durable write-back. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write or cold read.

```ts cordis-catalog
/**
 * The zero-I/O listing read: whole values viewed straight from the stored
 * rows (version-matching keys only), each cut carried with its watermark
 * so a client value store can seed under its higher-seq-wins rule — as
 * stale as the last durable checkpoint but never wrong, and never from an
 * unrelated log (the caller's header is the identity witness). Fresher
 * paths (the history tail baseline, {@link coldSnapshot}) supersede these
 * values whenever a session is actually opened.
 * @param meta - the listed session's header (identity witness; no log read).
 * @returns the cut (`asOfSeq` = lowest served-row watermark), or
 *   `undefined` when no usable row exists for this lifecycle.
 */
cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined

/**
 * Durably checkpoint one live session NOW (both mandatory points call
 * this; tests and carriers may too). The registry cut is snapshotted at
 * this boundary (states are live references), then the whole record is
 * replaced. NOT fail-soft — callers on the fail-soft paths contain it.
 * @param session - the live session to checkpoint.
 * @returns resolution after durability and event emission.
 */
async write(session: Session): Promise<void>

/**
 * Cold-read one persisted session's projections with zero full-log load:
 * cached rows + a persistence `readFrom` tail from the registry's restore
 * floor, refolded by the registry and written back (fail-soft) so the next
 * cold read starts closer. A cache row invalidated by a shrunk log
 * (crash-repair truncation) triggers one full re-read from seq 0 — the
 * ladder's slow rung, still no crash. Rejects when the session has no
 * persisted log (`not found` from the persistence seam).
 * @param id - the persisted session to read.
 * @param signal - optional cancellation for the persistence reads.
 * @returns the snapshot cut at the stored log end.
 */
async coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot>
```

Types: [Session](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md)

Source: [`packages/session/session-projection-cache/src/index.ts:71`](../../packages/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

`ctx.sessionProjections`: the projection unit table and its drive. The service subscribes to `session/event` once; every committed event passes every registered unit's `apply` (eager drive), and a changed state reference notifies the change feed with the schema-validated view. Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch (event or read). Registration is an effect (disposer rides the calling fiber): an unloaded domain plugin's key disappears from snapshots and clients read it as capability absence. Domain plugins register under `ctx.inject(['sessionProjections'], …)` so headless assemblies without the registry stay unaffected. Registrants sharing a key share one unit and are counted: the same tool package mounted in N agent presets registers N times, and the key survives until the last one unloads.

```ts cordis-catalog
/**
 * Register one domain's unit. The registration is an effect on the calling
 * context's fiber: disposing the fiber (or calling the returned disposer)
 * removes the key — and the unit's cached cells — from subsequent drives
 * and snapshots.
 * @param definition - key, state schema, pure unit functions, and stateVersion.
 * @returns the exact disposer that unregisters this unit.
 */
register<K extends keyof SessionProjectionMap, S>(definition: ProjectionDefinition<K, S>): () => void

/**
 * Subscribe to the change feed. The registration is an effect on the
 * calling context's fiber.
 * @param listener - called once per unit whose state reference changed, per committed event.
 * @returns the exact disposer that unsubscribes.
 */
onChanged(listener: ProjectionChangeListener): () => void

/**
 * One consistent cut over every registered unit for one session, read from
 * the watermark cache (missing cells fold lazily over the in-memory log).
 * Fully synchronous — every value and `asOfSeq` reflect the same log
 * position. Each value passes its unit's schema before leaving.
 * @param session - the session whose projection values are read.
 * @returns the snapshot; `values` is empty when no unit is registered.
 */
snapshot(session: Session): ProjectionSnapshot

/**
 * State-level checkpoint of every registered unit for one session, read
 * from the watermark cache (missing cells fold lazily over the in-memory
 * log). This is the write side of the persisted projection cache: the
 * returned rows are the `(key → {ver, seq, val})` part of the durable
 * `(sessionId, key, ver, seq, val)`
 * rows. Every `val` is a DETACHED structured clone — never the live
 * cell reference: the watermark cache is this registry's authoritative
 * mutable state, and a caller reaching the live reference could corrupt
 * every subsequent snapshot and frame through it (plain JSON by the unit
 * contract, so the clone is total).
 * @param session - the session whose unit states are checkpointed.
 * @returns one row per registered key; empty when no unit is registered.
 */
checkpoint(session: Session): ProjectionCheckpoint

/**
 * The stored seq a {@link restore} tail read over `checkpoint` must start
 * at: one event BELOW the lowest usable watermark (a row is usable when
 * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
 * pulls the floor to `0` — that key must refold the full log). The
 * one-below anchor is load-bearing: the tail then proves how far the
 * stored log still extends, so {@link restore} can detect a log that
 * shrank below a row's watermark (crash-repair truncation) instead of
 * serving the stale row as current — an empty tail read from the anchor
 * yields an end below every watermark and the restore rejects for a full
 * re-read.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns the seq to hand the persistence `readFrom`, or `undefined`
 *   when no unit is registered (no read needed — {@link restore} would
 *   serve empty values regardless).
 */
restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined

/**
 * View a checkpoint's rows without any log read: for every registered
 * unit whose row's `ver` matches, serve the schema-validated
 * `view` of the stored state; mismatched or absent rows leave their key
 * absent (a cold or listing consumer treats it as not-yet-available and a
 * fuller read path refolds it). The zero-I/O rung of the read ladder —
 * values are as stale as their rows, never wrong.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns whole values per key with a usable row; empty when none.
 */
viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap>

/**
 * Cold read: fold every registered unit over a stored log suffix, seeding
 * each from its checkpoint row when usable — the one read recipe (cached
 * state + forward tail replay + `view`) applied without a live `Session`.
 * Call with the events returned by a persistence
 * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
 * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
 * so a shrunk log is detected here. A row is usable iff its
 * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
 * (`seq >= baseSeq - 1`), and it does not claim events past the
 * supplied end (`seq <= endSeq`); an unusable row is discarded
 * and its key refolds from `init` — which is only sound over the full
 * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
 * from seq 0, e.g. after a crash-repair truncation shrank the log below
 * a row's watermark).
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @param events - the stored events with `seq >= baseSeq`, in seq order.
 * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
 * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
 *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
 *   refreshed checkpoint rows at that cut, ready for a durable write-back.
 */
restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/session/session-projection/src/index.ts:171`](../../packages/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
