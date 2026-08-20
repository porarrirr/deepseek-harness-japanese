# SessionTelemetryBackend

[English](session-telemetry.md) | [中文](session-telemetry.zh.md) | 日本語

outbound session reportingは[capability seam](../capability-seams.md)として分割されています。Service Definitionとcapture coordinator（[dsh-session-telemetry](../../packages/session/session-telemetry)、`ctx.sessionTelemetry`）がcapture point、fixed chunk projection、`session-telemetry/record` redaction waterfall、handoff cursor、minimum backend contractを所有します。deploymentがloadするService Provider（[dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)）は、設定をそのまま適用したOpenTelemetry JS SDKのlog pipelineです。agent-loop spineの一部ではない任意capabilityで、ここからmodel requestへ到達するものはありません。harnessのaspectは`emit()`で終わり、batching、retry、queueing、loss policyはreporting SDKに属するという原則と、却下した代替案は[revival Agent Note](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)に固定しています。capture point、cursor、projection contractは[Service Definition README](../../packages/session/session-telemetry/README.md)にあります。

Source: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## Logical record

```ts type-equiv
/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */
type SessionTelemetrySeverity = 'info' | 'warn' | 'error'
```

```ts type-equiv
/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
interface SessionTelemetryRecord {
  /** Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes. */
  channel: 'ledger' | 'ops'
  /** Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records. */
  time: number
  /** Pre-mapped alerting severity; see {@link SessionTelemetrySeverity}. */
  severity: SessionTelemetrySeverity
  /**
   * Identity attributes, deliberately minimal: ledger records carry
   * `session.id`, `event.type`, `event.seq`, plus `session.cwd` /
   * `session.parent_id` / `session.seed_length` when the header has them;
   * ops records carry `telemetry.op`, `session.id`, and (for `agent-error`)
   * `agent.id`, `turn`, `step`, `error.name`. Anything recoverable from the
   * body is intentionally NOT duplicated here.
   */
  attributes: Record<string, string | number>
  /**
   * The complete payload: a deep copy of the session event's `data` for
   * ledger records (JSON-serializable by `Session.append`'s own
   * validation), or the op payload for ops records. Never mutated after
   * handoff.
   */
  body: unknown
}
```

各`(turn, step)`の最初の`assistant/chunk`だけを送ります。これはstream-started signalで、残りはcapture時にdropされます。そのためwire上の`seq` gapは通常あり、loss signalではありません。その他の[session event](session.md) typeは、seamが知らないplugin-merged typeも含めてそのまま通過します。deliveryはbest-effortです。cursorが示すのはhand-off済みであってdelivery済みではなく、recordはloss（crash、reload window）やduplicate（cursorなしのre-adoption、SDK retry）になる可能性があります。そのためreceiverは`(session.id, event.seq)`でledger recordをdedupeします。ops recordは意図的にそのidentityを持たず、合計するentryではなくalert用のsignalなのでduplicateを許容します。

## Sharing disclosure

seamのacknowledgement contract（[Service Definition READMEのsharing-disclosure section](../../packages/session/session-telemetry/README.md#the-sharing-disclosure)が所有）は次のとおりです。すべてのbackendは`ctx.sessionTelemetry`のrequired abstract `sharing` memberを通じてdeployment-selected sharing policyを公開し、consumerはtelemetry serviceがmountされていない場合だけ「not configured」と表示します。disclosureが示すのはcurrent policyであり、deliveryやretentionではありません。handoffはnon-blocking enqueueで、batching、retry、loss policyはreporting SDKに残ります。

```ts type-equiv
/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The seam owns the vocabulary so
 * any backend can disclose a policy without depending on the OTel package;
 * the values mirror the OTel backend's serialized `SessionTelemetryMode` choices.
 */
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

## Backend contract

```ts type-equiv
/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
interface SessionTelemetrySink {
  /**
   * Hand one record to the backend's pipeline. MUST be a non-blocking
   * enqueue — the coordinator calls this synchronously from the
   * `session/event` hot path or an explicit canonical-log capture, so anything
   * slower than a queue push would tax the agent loop or feedback handling.
   * Errors thrown here are contained by the coordinator and logged; they
   * never reach the loop.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  emit(record: SessionTelemetryRecord): void
  /**
   * Optional hint that a turn ended. A backend may forward it to its SDK's
   * flush so records are exported after each turn. Called
   * fire-and-forget; implementations must not block and must not throw
   * meaningfully (the coordinator contains exceptions). Most backends should
   * leave this unimplemented and let their SDK's own batching cadence govern
   * export timing: a backend that does implement it owns the interaction
   * between its concurrent flushes and {@link shutdown}'s drain (the OTel
   * backend leaves it unimplemented for exactly that hazard — see the
   * revival Agent Note).
   */
  flush?(): void
  /**
   * Forward the fiber's disposal to the SDK: flush whatever is queued and
   * reach quiescence, per the SDK's own shutdown contract. Everything
   * emitted before this call must still be delivered — including records
   * enqueued while a {@link flush} hint is in flight, so a backend whose SDK
   * guards against concurrent flushes orders behind the outstanding one (the
   * coordinator emits its dispose-time `shutdown` markers immediately before
   * calling this). Awaited by the coordinator's dispose; a rejection is
   * logged as a warning and never fails application teardown.
   * The coordinator captures dispose-time shutdown markers immediately before
   * this call for live capture; on-demand capture creates no ops records.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  shutdown(): Promise<void>
}
```

`SessionTelemetryBackend`（`ctx.sessionTelemetry`、[signature](#ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam)）は約束のload可能な形式です。contextごとに1 implementationで、duplicate loadはthrowします。backendはconstructorでseamの`SessionTelemetryCoordinator`をcomposeし、capture sideをinstallします。

## Redact waterfall：`session-telemetry/record`

すべてのrecordはprojectionと`emit()`の間で`session-telemetry/record` [waterfall](../cordis-primer.md#cordis-waterfall-semantics)を通ります（[event entry](#session-telemetryrecord--waterfall)）。seam自身はruleを一切提供しません。listenerがmountされていなければrecordはcapture時のままbackendへ届くため、export dataのcleanさはdeploymentがmountしたruleそのものです。listenerは`next()`のreturn valueをtransformしてstackし、`next()`を呼ばずreturnすると下流をすべてreplaceします。throwするlistenerはcoordinatorのcontainment内でそのrecordだけをfail-closedにします。redactionが適用されるのはexport copyだけで、canonical session logは書き換えません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam"></a>

### `ctx.sessionTelemetry` — `SessionTelemetryBackend` (abstract seam)

Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the `telemetry` key throws on a duplicate, cordis' standard behavior. A backend composes a SessionTelemetryCoordinator in its constructor to install the capture side.

```ts cordis-catalog
/**
 * See {@link SessionTelemetrySink.emit} — that declaration is the contract's one home.
 * @param record - the logical record to report; owned by the backend after the call.
 */
abstract emit(record: SessionTelemetryRecord): void

/** See {@link SessionTelemetrySink.flush}. */
flush?(): void

/**
 * See {@link SessionTelemetrySink.shutdown}.
 * @returns resolves when the backend's pipeline has quiesced.
 */
abstract shutdown(): Promise<void>
```

Source: [`packages/session/session-telemetry/src/index.ts:148`](../../packages/session/session-telemetry/src/index.ts)

<a id="session-telemetry-events"></a>

### `session-telemetry/*` events

<a id="session-telemetryrecord--waterfall"></a>

#### `session-telemetry/record` — waterfall

Transform one outbound record before it reaches the backend. This waterfall is the Service Definition's redaction extension point. It ships NO rules of its own: the innermost `next()` passes the record through unchanged, and with no listener mounted records reach the backend as captured, so exported data is exactly as clean as the rules a deployment mounts. Listeners stack by transforming `next()`'s return value; returning without `next()` replaces everything beneath. Dispatched synchronously on the capture hot path inside the coordinator's containment: a throwing listener withholds that one record (fail-closed) and never reaches the agent loop. Live capture dispatches at append time; on-demand capture dispatches while reading the canonical log. Redaction applies to the exported copy only; the canonical session log is never rewritten.

```ts cordis-catalog
/**
 * Transform one outbound record before it reaches the backend. This
 * waterfall is the Service Definition's redaction extension point. It ships NO rules
 * of its own: the
 * innermost `next()` passes the record through unchanged, and with no
 * listener mounted records reach the backend as captured, so exported
 * data is exactly as clean as the rules a deployment mounts. Listeners
 * stack by transforming `next()`'s return value; returning without
 * `next()` replaces everything beneath. Dispatched synchronously on the
 * capture hot path inside the coordinator's containment: a throwing
 * listener withholds that one record (fail-closed) and never reaches the
 * agent loop. Live capture dispatches at append time; on-demand capture
 * dispatches while reading the canonical log. Redaction applies to the
 * exported copy only; the canonical session log is never rewritten.
 * @param record - the candidate record, already the coordinator's own deep
 *   copy; listeners return a (possibly new) record and must not mutate it.
 * @mode waterfall
 */
'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord
```

Source: [`packages/session/session-telemetry/src/index.ts:43`](../../packages/session/session-telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
