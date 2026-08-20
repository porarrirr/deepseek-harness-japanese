# Sessions

[English](session.md) | [中文](session.zh.md) | 日本語

これは[dsh-session](../../packages/core/session)のin-memoryでevent-sourcedなmodelです。`Session`はtyped `SessionEvent`の**append-only log**で、agentの全interaction historyに対するsingle source of truthです。LLM message historyはlogから*derived*され、別に保存しません。replayも同じeventからの再導出です。logを**durable**にする方法（persistence seam、backend、crash recovery）は兄弟ページの[persistence.md](persistence.md)で扱います。

Source: [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

## `SessionEventMap` — event vocabulary

append-only event typeです。merge-extensibleで、pluginはdeclaration mergingによって追加event typeを宣言します。たとえば[compaction seam](compaction.md)は`compaction/start`／`compaction/summary`／`compaction/end`を追加し、`@deepseek-ai/dsh-hook-protocol`はhook bridge用のlog-only `hook/invoked`／`hook/result` recordを追加します。`compaction/*`と同様に、これらは`SurfaceEventType`ではありません（`surfaceOp`なし）。coreとmerge済みの全memberは、payload、surface badge、declaration siteとともに生成された[persistence log event catalog](../persistence-catalog.md)に列挙されています。

```ts type-equiv
/** A user-role specialization of the one shared message representation. */
interface UserMessage extends Message {
  readonly role: 'user'
}
```

```ts type-equiv
/**
 * The merge-extensible, append-only source of truth for an agent interaction.
 * Message history is derived from this log. Every event is lossless JSON and
 * sequence numbers stay contiguous, including raw chunks, so persistence can
 * store the canonical log verbatim.
 */
interface SessionEventMap {
  /**
   * Opens turn `turn` before the loop claims queued input or runs pre-step.
   * Rejection, empty input, cancellation, or failure may close it with no
   * step; otherwise the following identified `user/message` event or batch
   * records the messages entering the step.
   */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn` with the {@link TurnEndReason} that ended it. A turn
   * with no entered step has no `step/start` or `step/end`. The loop does not await a
   * flush at turn boundaries: `dsh-session-checkpoint-policy` owns the
   * per-request durability checkpoint, and consumers that read storage after
   * `whenIdle()` flush themselves. Success commits the turn; rejection is
   * reported live and does not prevent later work.
   */
  'turn/end': { turn: number; reason: TurnEndReason }
  /** Opens step `step` of turn `turn` — one model call plus the tool executions it requested. */
  'step/start': { turn: number; step: number }
  /** Closes step `step` of turn `turn`. */
  'step/end': { turn: number; step: number }
  /**
   * A user-role message on the model-visible surface: a direct human prompt
   * (the queued message claimed for this turn), a synthetic `agent.inject()`
   * context (file-change notices, subdir AGENTS.md, skill content, cron
   * notifications, …), or an entered goal continuation round. All three
   * project their `content` verbatim; `source` tells them apart.
   */
  'user/message': UserMessage
  /** Raw stream chunk — token-level replay fidelity. */
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  /**
   * Assembled assistant message for one step (derived history uses this).
   * Carries the step's `usage` when the adapter reported token accounting, so
   * the model output and its accounting travel together (there is no separate
   * usage record). `usage` is absent when the adapter reported none. A turn
   * cancelled mid-stream finalizes its delivered text/reasoning prefix as this
   * event with `interrupted: true`; undispatched tool calls are absent. The
   * marker distinguishes that prefix without re-deriving interruption from turn
   * boundaries. An aborted turn with no such event streamed no visible content.
   */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true }
  /**
   * The model requested one tool invocation: `name` with the raw `arguments`
   * JSON string exactly as the model produced it (unparsed). `callId` pairs the
   * call with its `tool/result`.
   */
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  /**
   * A completed tool call's model-facing result, optional internal failure
   * identity, and optional tool-private `meta` presentation payload. `meta` is
   * opaque to the core (the producing tool owns its shape and reads it back in
   * `presentResult`) but MUST be JSON-serializable: `Session.append`
   * runtime-validates all event data with `isJsonValue`, so a non-serializable
   * `meta` is rejected at the source, and the durable log reproduces the
   * identical card on replay. Absent
   * unless the tool attaches one (e.g. `dsh-tool-fs` carries its result-time
   * contextual diff here).
   */
  'tool/result': {
    turn: number
    step: number
    message: ToolResultMessage
    error?: { name: string; code: string }
    meta?: JsonValue
  }
  /** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
  'todo/write': { todos: TodoItem[] }
  /**
   * Full header for the next request, appended inside its step before dispatch.
   * It is log-only; the latest snapshot reconstructs the request header.
   */
  'request/header': { header: EpochHeader; reason: RequestHeaderReason }
  /**
   * Route metadata for the next request, logged only when the route or capacity
   * changes. It does not participate in request reconstruction or header equality.
   */
  'request/context': RequestContext
  /**
   * Marks the end of a constructor seed. Events before it have smaller seq
   * values and came from the seed (resume, fork, or replay); this lifecycle
   * produced none of them. This log-only event is the durable projection of
   * {@link Session.firstLiveSeq}. Its payload is empty — position and `time`
   * carry the meaning.
   *
   * Locate the LAST one in stored history. A seed already ending in one is not
   * re-marked, so reopening an untouched session does not grow its log per
   * pickup and the event need not be at the current `firstLiveSeq`.
   *
   * `Session`'s constructor is the only legitimate writer. The invariant
   * companion deliberately constrains nothing here, so a plugin appending one
   * would silently classify every live bracket before it as seed history.
   *
   * An owner of a standalone open/close bracket (`compaction/start` …
   * `compaction/end`) reads it because seed history and live work are otherwise
   * byte-identical: an unmatched opening marker before this event belongs to
   * an ended lifecycle, whatever ended it. NOT a liveness signal about other
   * writers — a concurrently live session holds its own boundary elsewhere,
   * so tolerating concurrent writers needs a signal beyond the log.
   */
  'session/end-seed': Record<string, never>
}
```

`UserMessage`はordinary prompt、injected context、steering、live inbox eventで共有するidentifiedでfrozenなuser-role valueです。event wrapperが追加するのはevent-localなpositionまたはoutcomeの事実だけで、itemがpendingの間にloopが追加するのはdriver-owned routing stateだけです。

### `TodoItem` — todo-listの1 entry

`todo/write` eventのwhole-list snapshotのunitです。意図的に最小限で、`content` lineと3状態の`status`だけを持ちます（id、priority、`activeForm`なし）。writeごとにlist全体をreplaceするため、entryにstable identityは不要です。[todo_write Agent Note](../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.md)を参照してください。

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * {@link SessionEventMap} event's whole-list snapshot.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

<a id="the-request-header-event-requestheader"></a>

### Request header event：`request/header`

request envelopeである`EpochHeader`（call config、adapter-supplied defaultのmarker、render済みsystem prompt、assembled tool schema）はlogged session stateです。そのためすべてのconversation requestはlogのpure functionです（reconstructability Agent Note）。reasonが`'initial'`または`'resume'`の完全な`request/header` snapshotは各loop-instance boundaryを記録し、後で変更されたrequestはreason `'change'`の別の完全snapshotを記録します。`foldRequestHeader(events)`は最新snapshotを選択してheaderを再構築します。このeventは`SurfaceEventType`ではなく、LLM messageを生成しません。

```ts type-equiv
/**
 * Logged request state outside derived history: call config, system prompt, and
 * tools. The latest full `request/header` snapshot reconstructs it; canonical
 * empty optional fields are absent.
 */
interface EpochHeader {
  /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
  config: LlmCallConfig
  /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
  adapterDefaults?: LlmCallConfigAdapterDefaults
  /** Rendered system prompt text; absent for a system-less request. */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  tools?: ToolSchema[]
}
```

canonical formでは、empty system promptやtool listをabsent fieldで表現し、requestの構築方法と一致させます。legacy `request/header-delta` eventまたはfull-snapshotの`fallback` reasonを含むlegacy v0 logは、不完全にreplayせずseed、append、persistence-loadの各時点でrejectします。

### Route capacity event：`request/context`

requestがresolveしたrouteのcontext metadataは別のlogged stateです。同じstep内で`request/header`の隣にappendし、provider、model、capacityのいずれかが前recordと異なる場合だけ記録します。`EpochHeader`の外に置くのは、その型が`headerEquals`でfield単位に比較するreconstruction contractだからです。capacityはrouteを表しrequest inputではないため、foldするとcapacity changeがrequest-envelope `change`として記録され、adapter metadataがloopのreconstruction invariantに入り込んでしまいます。`request/header`と同じく`SurfaceEventType`ではなく、LLM messageを生成しません。`session.requestContext()`は最新recordをincrementalにfoldします。adapterがcapacityをadvertiseしないrouteは`contextWindow` absentで記録し、新しいrecordが古いrouteのcapacityをclearします。

```ts type-equiv
/** Registration-bound metadata for one resolved model route. */
interface RequestContext {
  /** Registered provider route the metadata belongs to. */
  provider: string
  /** Provider-owned model id the metadata belongs to. */
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  contextWindow?: number
}
```

## `SessionEvent<T>` — 1つのlog entry

独立した`type`／`data` unionではなく、`type`に対するproper discriminated unionです。そのため`switch (event.type)`でcastなしに`event.data`をnarrowできます。`seq`はlog内のmonotonic position（`seq = log.length`）、`time`はepoch msです。

```ts type-equiv
/**
 * One immutable entry in the session log.
 *
 * A proper discriminated union over `type` (not independent `type`/`data`
 * unions), so `switch (event.type)` narrows `event.data` without casts.
 *
 * The {@link sourceEventSeqs} and {@link surfaceOp} fields are conditional:
 * they only exist on {@link SurfaceEventType} variants (`user/message`,
 * `assistant/message`, `tool/result`).
 * Non-surface events (boundary markers, chunks, usage, errors) never carry
 * surface metadata — the compiler enforces this at `Session.append()`
 * call sites.
 */
type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    seq: number
    /** Unix epoch milliseconds. */
    time: number
    data: SessionEventMap[K]
    /**
     * Marks an event a reader may safely skip when it does not recognize
     * `type`. Absent means required: a reader meeting an unrecognized type
     * without this marker MUST refuse to reconstruct the session instead of
     * silently dropping the event, because an unrecognized required event may
     * change how the rest of the log is interpreted. A writer sets `true` only
     * on purely informational records whose loss cannot affect reconstruction;
     * defaulting to required means a forgotten marker over-refuses (an
     * inconvenience) rather than silently resuming a gutted session.
     */
    ignorable?: true
  } & (K extends SurfaceEventType ? {
    /**
     * Seq numbers of earlier events that this event cites as sources
     * (e.g. the `assistant/chunk` seqs that built an `assistant/message`,
     * or the surface nodes shadowed by a compaction replace node). An
     * `assistant/message` may carry a present empty array for a known empty
     * provider stream; when the field is absent, the event does not record which
     * earlier events produced the message.
     */
    sourceEventSeqs?: number[]
    /** How this event entered the surface; absent for non-surface events. */
    surfaceOp?: SurfaceOp
  } : object)
}[T]
```

`SessionEventType = keyof SessionEventMap`です。`SessionEventMap`はmerge-extensibleなので、`SessionEvent`のswitchで`assertNever`を使ってはいけません。pluginが追加したvariantはvalidなunknown valueです。既知のcaseを処理し、`default`へfall throughします。

`assistant/message`では、存在する`sourceEventSeqs: []`は既知の空provider streamを完全に表します。一方、fieldのないlegacyまたはforeign eventは、どの先行eventがmessageを生成したかを記録しません。loopは成功したmodel callごとにfieldを書き、その他のsurface eventはfieldを持つ場合non-empty listを要求します。

## Surface type

3つのmessage-producing type（`SurfaceEventType` — `user/message`、`assistant/message`、`tool/result`）は、ordered derived surfaceへの参加方法を示すsurface metadataを持ちます。[session surface Agent Note](../../.agents/notes/implemented/architecture/2026-06-18-session-surface.md)を参照してください。

### `SurfaceEventType` — messageを生成するevent typeのsubset

```ts type-equiv
/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp} and {@link SessionEvent.sourceEventSeqs}.
 */
type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
```

### `SurfaceOp` — eventがsurfaceに入った方法

```ts type-equiv
/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `start === end` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
```

`'append'`は通常のtail-append pathです。`replace`は`start`からinclusiveな`end`までのsurface entryをshadowし（両方ともvalidなsurface seqでなければなりません。`start === end`は1つのentryをreplaceします）、その場所に新しいeventをinsertします。

### `SurfaceIntent` — `session.append()`のparameter

```ts type-equiv
/**
 * Surface placement and cited source-event seqs for {@link Session.append}. Required on
 * message-producing events and forbidden on log-only events.
 */
interface SurfaceIntent {
  surfaceOp: SurfaceOp
  /**
   * Complete set of known source-event seqs. `assistant/message` may use a
   * present empty array for a known empty provider stream; when the field is
   * absent, the event does not record which earlier events produced the message.
   * Other surface events require a non-empty set when this field is present.
   */
  sourceEventSeqs?: number[]
}
```

`SurfaceEventType` eventには必須です。すべてのmessage-producing eventはsurfaceへの参加方法を宣言しなければならず、surfaceがderived model historyの唯一のsourceです。human-facing transcriptは別のprojectionで、logのappend-origin eventを読みます。replacementが要約するrangeをsurfaceが意図的にshadowするためです（[dsh-session](../../packages/core/session/README.md)の`isAppendSurfaceEvent`）。non-surface typeではcompile timeにrejectされます。

存在する空`sourceEventSeqs`を持てるのは`assistant/message`だけです。fieldがabsentの場合、eventはどの先行eventがmessageを生成したかを記録せず、providerがchunkをemit済みの場合もあります。

### `SessionSurface` — live readonly surface projection

`Session.surface`はsessionのstableな`SessionSurface` viewを返します。同じincremental managerがcommit前にappend candidateをvalidateし、commit済みeventからこのprojectionを進めます。callerはmembershipとreplacement generationを観測できますが、validationを呼び出せません。

`SurfaceManager(log, baseSeq?)`は、最初のeventがabsolute sequence `baseSeq`を持つcontiguousなloaded windowをfoldすることもできます。すべてのeventはそのabsolute sequence spaceでcontiguousのままで、window headをまたぐreplacementはdeclared rangeがないため失敗します。

```ts type-equiv
/** Readonly live projection of the message-producing session events. */
interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}
```

### `SurfaceFoldReplacement`と`SurfaceFoldResult` — complete surface replay

`foldSurface(events)`はdetachedなcurrent event sequenceと、各declared replacement rangeが実際にshadowしたsequenceを返します。live managerはreplacement historyを保持せず同じtransitionを使います。`replaceGeneration`はcommit済みreplacementごとにincrementするため、incremental consumerはpure tail growthとrewriteを区別できます。

```ts type-equiv
/** One replacement operation observed while folding a session surface. */
interface SurfaceFoldReplacement {
  /** Seq of the event that replaced the prior surface range. */
  seq: number
  /** Declared inclusive start seq of the replaced surface range. */
  start: number
  /** Declared inclusive end seq of the replaced surface range. */
  end: number
  /** Actual surface entries removed by the operation, in surface order. */
  shadowedSeqs: number[]
}
```

```ts type-equiv
/** Complete result of replaying the surface operations in a session log. */
interface SurfaceFoldResult {
  /** Current surface event sequences in model-visible order. */
  nodes: number[]
  /** Replacement operations in event order. */
  replacements: SurfaceFoldReplacement[]
}
```

## `Session` public API

bodyを除いたdeclarationはplain classのdetached factory、state accessor、append method、history projectionをsourceと同期させます。store operationは生成された[`ctx.sessions` section](#ctxsessions--sessionstore)にあります。

```ts public-api
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
declare class Session {
  /** The ordered surface over this session's event log. */
  get surface(): SessionSurface;
  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  readonly header: SessionHeader;
  /** The session identity, derived from its durable header's single copy. */
  get id(): SessionId;
  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit), so consumers
   * that replay the log as a publication substitute (telemetry adoption)
   * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
   * boundary: a resumed session's constructor seed is its full stored log,
   * while its header keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  readonly firstLiveSeq: number;
  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @returns a detached session.
   */
  static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session;
  /**
   * Restore a detached session by taking ownership of fresh persistence values.
   * The storage format, event envelopes, sequence continuity, surface transitions,
   * and header fields are validated before the restored objects are frozen.
   * @param id - restored session identity.
   * @param seed - fresh detached events whose ownership is transferred.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session;
  /**
   * An immutable snapshot of the append-only event log. The snapshot is reused
   * until the next append; a previously returned array does not grow later.
   * Events and their nested data are deep-frozen at acceptance, so neither a
   * cast nor ordinary JavaScript can rewrite durable history.
   */
  get events(): readonly SessionEvent[];
  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq(): number;
  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/chunk`.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One recursive pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T>;
  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.events)`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined;
  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined;
  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[];
  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null;
}
```

## Derived history：`deriveMessages()`と`deriveEventMessage()`

`Session.deriveMessages()`はevent logをmodelが見る`Message[]`へprojectionします。cacheされ（各surface nodeは最初に見た時に1回だけprojectionし、surface rewriteでrebuild）、freezeされます（callごとにsharedなdeep-frozen messageの新しいarrayを返すため、projection経由でlogged historyを変更することは表現できません）。`deriveEventMessage(event)`はfoldがnodeごとに適用するpure functionです。external reconstuctorとdev invariantも同じruleでlog prefixをprojectionし、cacheと食い違わないようpublicにしています。projection ruleは次のとおりです。

- `user/message` → exactな`content`を持つuser message。optional envelopeはlog-only display metadataです。
- `assistant/message` →生成したproviderとmodel、およびoptional adapter-private replay stateを持つassistant message。raw `assistant/chunk` eventはreplay／UI dataなので導出では**skip**します（assembled messageがauthoritativeです）。**empty-content**の`assistant/message`もskipします。contentのないmax-tokens stepでもusage、provider、modelを保持するため`assistant/message`は記録しますが、contentのないassistant turnをprovider transcriptに入れてはいけません。
- `tool/result` → `tool-result` blockを持つuser message。
- `user/message`（injected context、つまり`user`以外のsource）→ chronological positionで`content`をそのまま持つuser-role message。typed sourceがproducerを示し、producer-specific dataを運びます。

その他（`turn/*`、`step/*`、plugin-owned `llm/retry`）はstructuralでmessageにはprojectionしません。token accountingはstepごとの`assistant/chunk { type: 'usage' }` recordを読み、usage chunkがない場合は`assistant/message.usage`をcommit済みstepのfallbackとして扱います。失敗したmodel-request attemptにはassistant messageがないため、そのusage chunkがdurable accounting recordです。未releaseのこのformatはcompatibilityを意図的に保証しないため、seed／load validationはprovider／modelを省略したrequest headerとassistant messageをrejectし、historical dataのrouteを推測しません。

## Live-session fork API

`ctx.sessions.create(id, { seed, meta })`はlow-level replay／fork primitiveです。通常のlive-session forkには`SessionStore`が1つのpolicy APIを公開します。

- `fork(source, boundary?, childSessionId?)`はlive `Session` objectまたはlive `SessionId`を受け付け、inclusiveな`boundary` seq（default：current last event）までのsource eventを選びます。選択したprefixがopen turnの外で終わることを要求し、deep-cloneしたseed eventとchild metadata（`parentSession`、`seedLength`、inherited `cwd`）を持つlive child sessionを作成します。

explicitな`boundary`により、sourceに新しいeventやcurrent open turnがあっても、previous `turn/end`や後続standalone log-only eventを含む任意のstable between-turn positionからforkできます。open turn内で終わるprefixは、黙ってclipせずAPIがrejectします。より広いexecution-relation sanityは既存の`dsh-invariants` pluginとpersistence repair pathが担い、`fork()`には重複させません。`dsh-subagent-fork-in-process`はtool-time delegationがparent turn open中に始まることが多いためcompleted-prefix clippingを保持します。通常のsession branchingでは要求するboundaryを明示してください。

## Turnが終了した理由：`TurnEndReasonMap`

`turn/start`にはtrigger fieldがありません。入力された`user/message` batchが各stepに入った内容を記録し、`llm/retry`がrequest recoveryを記録し、idle injectionはwaking deliveryが後続pre-stepに到達するまでpendingのままです。live turnはdriverを停止したtyped [`AgentCancelCause`](core.md#the-agent-handle)を保持します。persistenceが追加の`{ kind: 'legacy' }` causeを使うのは、callerを保存していない対応済みcoarse cancellation recordをimportする場合だけです。

```ts type-equiv
/** Durable cancellation cause, including imports whose original coarse record carried no cause. */
type TurnEndCancelCause = AgentCancelCause | { readonly kind: 'legacy' }
```

```ts type-equiv
/**
 * Why a turn ended. Merge-extensible sum type.
 */
interface TurnEndReasonMap {
  completed: { kind: 'completed' }
  /** A cancellation request interrupted the live turn. */
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause }

  blocked: { kind: 'blocked' }
  /**
   * The turn failed. `error` is always a structured failure: the `LlmError`
   * facts verbatim, or `{ message: errorChain(error), code: 'UNKNOWN' }`
   * flattened from any other error.
   */
  error: { kind: 'error'; error: LlmFailure }
  /** At least one step reached its output-token ceiling, even if a plugin continued the turn. */
  'max-tokens': { kind: 'max-tokens' }
  /**
   * A persistence backend closed a crash-orphaned turn on reload. The loop never
   * emits this marker, and the events recorded before the crash remain intact.
   */
  interrupted: { kind: 'interrupted' }
}
```

`max-tokens`は同名のmodel-call `FinishReason`をmirrorします。turn内に`max-tokens` stepが1つでもあれば、後続continuationがあってもturn全体は`completed`ではなく`max-tokens`で終了します（cut-shortの事実が優先されます）。consumerはclean stopとtruncated stopを区別できます。cancelとerrorは別のoutcomeです。`interrupted`はloopがemitしない唯一のreasonで、crash recoveryがsynthesizeします（[persistence.md](persistence.md)）。mapはmerge-extensibleです。

## Execution enclosureとstandalone event

turnは1つのmodel-loop executionを囲みますが、session log全体を囲むわけではありません。AgentLoopはturn内でpre-step batchに入ったinjected `user/message` eventだけを記録します。plugin-owned log-only eventは`turn/end`と次の`turn/start`の間にも現れ、turn numberをincrementせずevent seqを消費することがあります。persistenceはcontiguousなaccepted eventをすべてbounded durable batchに入れ、crash repairは本当にopenなtrailing turnだけをcloseします。直ちにdurability barrierが必要なproducerは`ctx.sessions.flush(session)`を明示的にawaitします。

optionalな`dsh-session/invariant` companionはcoreが所有するrelation、つまりturn／step numbering、execution-event enclosure、same-step tool call／result pairingを強制します。merge-extensible event relationは宣言したpluginの責務なので、turnがopenでないだけでcoreがunknown eventをrejectすることはありません。[standalone-event decision](../../.agents/notes/implemented/simplification/2026-07-28-remove-synthetic-log-only-turns.md)を参照してください。

## End-seed boundary：`session/end-seed`

seed済みsession（resume、fork、replay）はconstructor seedの直後、最初のlive writeとしてこのlog-only eventをappendします。その前のeventはより小さいseqを持ちseed由来です。これは`firstLiveSeq`のdurable projectionです。fieldはobjectを保持するconsumerにlifecycleのwrite開始位置を示し、eventはstored byteだけを保持するconsumerに同じことを示します。payloadは空なのでpositionと`time`だけが意味を持ち、messageは生成しません。正当なwriterは`Session` constructorだけです。

明示的に指定したempty seedはseq 0に`session/end-seed`を書き、empty resumed sessionとfresh sessionを区別します。seedがすでに`session/end-seed`で終わっている場合は再markしないため、何もしていないsessionを再openしてもpickupごとにlogが増えません。`firstLiveSeq`にeventがあると仮定せず、stored history内のLAST `session/end-seed`を探してください。workなしのpickup後は、eventのseqが次のlifecycleの`firstLiveSeq`より小さくなります。

これはseed historyとlive workがそれ以外ではbyte-identicalであり、standalone open／close bracketを所有するpluginを困らせるため必要です。unmatchedな`compaction/start`は、writerがcompaction途中でcrashした場合も現在compacting中の場合も同じように読めます。`session/end-seed`より前のopening markerはconstructor seed由来で、crash、後続process、実行中parentからのforkなど、どのような理由であれ終了したlifecycleに属します。そのためownerはdeadとして扱えます。対象は*this* sessionがinheritしたbracketだけです。同じhistory上でopen bracketを持つ同時live sessionには別のboundaryがあるため、concurrent writerを許容するにはlog以外のliveness signalが必要です。coreはboundaryを書くだけで読みません。bracketのvocabularyはowner pluginに残るため、crash repairはturn／step／tool boundaryをcloseしますが`compaction/*`はcloseしません。

Sessionをhuman activity順に並べるconsumerはこのboundaryを除外します。Sessionをpickupすることはworkではないため、log tailでorderするとopenしたすべてのSessionが先頭に浮上してしまいます。

## Plugin-contributed log-only event

pluginは追加の`SessionEventMap` typeをdeclaration-mergeできます。これらは**log-only**で、`SurfaceEventType`ではありません（`surfaceOp`を持たずderived historyに寄与しません）。open execution turnに属するかturn間に置けるかはownerが決定し、relationは自身のinvariant companionで強制します。生成された[persistence log event catalog](../persistence-catalog.md)はcoreとplugin-contributed eventをpayload、surface badge、declaration site付きで列挙します。compaction seamの`compaction/*` semanticsは[compaction.md](compaction.md)で説明します。

1つのplugin-owned familyの複数eventが1つのWeb Client Conversation Nodeを構成する場合、そのfamilyのstart、update、result、resource、interruption eventはすべて同じstable business idを持つか、独立に導出できなければなりません。この要件はcorrelated Node familyに適用し、すべてのSession eventには適用しません。clientが隣接関係やhistory scanから推測せず各eventをgroupできます。[Conversation Node cookbook](../cookbook/adding-a-conversation-node.md)を参照してください。

hook bridgeの`hook/invoked`／`hook/result` pair（`@deepseek-ai/dsh-hook-protocol`由来）は`handlerId`でcorrelateします。`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`はloopのopen turn内で発火するため、`hook/*` recordは構造上turnに囲まれます。`SessionStart`はturn 1の前に実行されるため`hook/*` recordを持たず、contextはwaking deliveryがturnをopenするまでinboxでpendingのままです（[hook-bridges Agent Note](../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md)）。

## Durability contract

これはpersistence backendが依存する約束です。durable logは**`assistant/chunk`を含む**すべてのeventをlosslessに保持します。`seq`はcontiguousでなければならないため、chunkをcanonical logからfilterできません。`load`がexactなappend済みeventを返す限り、backendはevent batchのstorage encodingを選べます（JSONL backendのdefault packed chunk rowがその例です。[persistence.md](persistence.md)を参照）。すべての`event.data`はJSON-serializableでなければなりません。`Session.append`がsourceで強制し（non-serializable dataではthrow）、不正なeventがlogに入らず`session.events`はbackendがpersistできる内容と常に一致します。non-serializable dataを運ぶevent typeの追加、core execution nestingの破壊、ownerのdeclared relation違反はon-disk formatのbreaking changeです。

この約束を使うbackendは[persistence.md](persistence.md)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessions--sessionstore"></a>

### `ctx.sessions` — `SessionStore`

In-memory session store (`ctx.sessions`).

Persistence is intentionally not implemented here — persistence plugins subscribe to `session/event` and flush on `session/flush` / dispose.

```ts cordis-catalog
/**
 * Create a session owned by the calling fiber: disposing that fiber stops
 * event notification and removes the session from the store. `options.seed`
 * populates the session with a copy of those events (replay/fork);
 * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
 * and parent lineage, and delegation depth) as the immutable
 * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
 *
 * For an agent whose session must be torn down IN ORDER with its loop (so the
 * loop's final events are published before the store attachment ends), do NOT use this
 * — fold the session lifecycle into the agent's own effect via
 * {@link prepare} + {@link enter} + {@link announce} (see
 * `dsh-agent-loop`'s creation transaction).
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header.
 * @returns the live session, already entered and announced.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path (storage backends key directories off it).
 */
create(id?: SessionId, options?: CreateSessionOptions): Session

/**
 * Build a session WITHOUT entering it into the store — validate the id/cwd and
 * construct the {@link Session} (with its immutable {@link SessionHeader}).
 * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
 * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
 * effect so a fiber unload tears the session + agent down as a single ORDERED
 * chain rather than as racing sibling effects — which would remove the publication hooks
 * before the driver's closing events commit, dropping them.
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header. With
 *   `seedSource: 'persistence'`, metadata and events must be fresh detached
 *   graphs whose ownership transfers to this call: they are validated and
 *   frozen in place through {@link Session.fromRestore}, so the caller must
 *   retain no mutable aliases.
 * @returns the constructed session, NOT yet in the store.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path.
 */
prepare(id?: SessionId, options?: PrepareSessionOptions): Session

/**
 * Enter a {@link prepare}d session into the store: install the module-private
 * append publication hooks and add it to the store. Returns the DETACH
 * disposer (hooks + store removal). Does NOT emit `session/created` —
 * the caller yields this disposer inside its effect and THEN calls
 * {@link announce}, so a throwing `session/created` listener rolls the attach
 * back instead of leaking it.
 *
 * Re-checks the id for a duplicate: `prepare` and `enter` are public
 * cross-package primitives and a caller may interleave arbitrary work (or
 * another create) between them, so a stale prepared session must NOT overwrite
 * a live store entry of the same id — its detach disposer would later delete
 * the REAL session. The {@link create} convenience and the agent factory call
 * the two back-to-back so they never trip this, but the public API cannot
 * assume that.
 *
 * @param session - a {@link prepare}d session not yet in the store.
 * @returns the detach disposer (publication hooks + store removal). When called from
 *   a synchronous `session/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 * @throws if a session with this id is already in the store.
 */
enter(session: Session): () => void

/** Emit `session/created` exactly once for an {@link enter}ed session (with
 * the carrier {@link enter} captured). Separate from {@link enter} so the
 * caller can yield the detach disposer first (rollback safety — see
 * {@link enter}).
 * @param session - the entered session to announce to listeners.
 * @throws if the session is not live or its announcement already began,
 *   including a reentrant call from a creation listener. */
announce(session: Session): void

/**
 * Dispatch the awaited `session/flush` durability checkpoint for `session`,
 * with the carrier captured at {@link enter}. THE flush entry point: the
 * store owns the carrier, so callers (the checkpoint policy's per-request
 * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
 * that flush themselves before reading storage) must come through here
 * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
 * one spelling, and the scoped-dispatch invariant can pin it.
 * @param session - the session whose buffered events must reach durable storage.
 * @returns whether at least one durability listener participated, after every
 *   listener has settled successfully.
 * @throws the first registered listener failure after every listener settles.
 */
async flush(session: Session): Promise<boolean>

/**
 * Look up a live session.
 * @param id - the session id to look up.
 * @returns the session, or undefined when no live session has that id.
 */
get(id: SessionId): Session | undefined

/**
 * All live sessions, in creation order.
 * @returns a fresh array; mutating it does not affect the store.
 */
list(): Session[]

/**
 * Create a live child session from a stable prefix of a live source.
 * `boundary` is an inclusive source event seq; omitted means the source's
 * current last event. The selected slice may end with a between-turn event
 * but must not end inside an open turn.
 *
 * @param source - Live source session object or id.
 * @param boundary - Inclusive source event seq to fork through; omitted means
 *   the source's current last event, and omitted on an empty source forks an
 *   empty child.
 * @param childSessionId - Optional child session id; omitted delegates to
 *   `SessionStore`'s id policy.
 * @returns The created live child session.
 */
fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
```

Types: [CreateSessionOptions](persistence.md) · [PrepareSessionOptions](persistence.md) · [SessionId](core.md)

Source: [`packages/core/session/src/index.ts:792`](../../packages/core/session/src/index.ts)

<a id="session-events"></a>

### `session/*` events

<a id="sessioncreated--emit"></a>

#### `session/created` — emit

Creation announcement during session publication. A synchronous throw vetoes and rolls back with a paired disposal; detach requested during dispatch is deferred. A returned-promise rejection is logged but cannot retroactively veto this synchronous boundary. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only sessions entered through that agent's context.

```ts cordis-catalog
/**
 * Creation announcement during session publication. A synchronous throw vetoes and rolls
 * back with a paired disposal; detach requested during dispatch is deferred.
 * A returned-promise rejection is logged but cannot retroactively veto this
 * synchronous boundary.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only sessions entered through that agent's context.
 * @param session - the session just entered and announced.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/created'(this: Scoped<Session>, session: Session): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:54`](../../packages/core/session/src/index.ts)

<a id="sessiondisposed--emit"></a>

#### `session/disposed` — emit

Emitted once when an announced session leaves the store, including publication rollback, but never for an entry whose creation announcement did not begin. Listener failures are logged and contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.

```ts cordis-catalog
/**
 * Emitted once when an announced session leaves the store, including
 * publication rollback, but never for an entry whose creation announcement
 * did not begin. Listener failures are logged and contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
 * @param session - the session that is no longer live in the store.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/disposed'(this: Scoped<Session>, session: Session): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:64`](../../packages/core/session/src/index.ts)

<a id="sessionevent--emit"></a>

#### `session/event` — emit

Post-commit, fire-and-forget append feed. The listener snapshot resolves before the log push, but callbacks run after it; observer failures are logged and contained without making the committed append fail. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only events from sessions entered through that agent's context.

```ts cordis-catalog
/**
 * Post-commit, fire-and-forget append feed. The listener snapshot resolves
 * before the log push, but callbacks run after it; observer failures are
 * logged and contained without making the committed append fail.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only events from sessions entered through that agent's context.
 * @param session - the session whose log grew.
 * @param event - the appended event, exactly as recorded.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:76`](../../packages/core/session/src/index.ts)

<a id="sessionflush--parallel"></a>

#### `session/flush` — parallel

Awaited parallel durability checkpoint: every listener runs and the caller awaits all of them, with no waterfall veto. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.

```ts cordis-catalog
/**
 * Awaited parallel durability checkpoint: every listener runs and the
 * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
 * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
 * @param session - the session whose buffered events must reach durable storage.
 * @dshScopeScan unsupported
 * @mode parallel
 */
'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
```

Types: [Scoped](scope.md)

Source: [`packages/core/session/src/index.ts:85`](../../packages/core/session/src/index.ts)
<!-- END GENERATED cordis-surface -->
