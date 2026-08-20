# Session Persistence

[English](persistence.md) | [中文](persistence.zh.md) | 日本語

event logの**durability seam**です。[session.md](session.md)はsource of truthであるappend-only `SessionEvent` logを保持するin-memory `Session`を説明します。このページではlogをdurableにする方法、つまりabstract `SessionPersistence` service、そのbackend、flush checkpoint、crash recovery、logとともに扱うmetadata headerを説明します。logが運ぶevent vocabularyは生成された[persistence log event catalog](../persistence-catalog.md)にmemberごとに列挙しています。

このseamは[capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)です。1つのabstract service（[dsh-session-persistence](../../packages/session/session-persistence)、`ctx.sessionPersistence`）が、既存の`SessionEvent`に対するlocate／create／append、再利用可能なSession preparation、logical load／inspect、physical suffix read、軽量なlist／snapshot observationを定義します。**parallelに永続化するevent typeはありません**。同じ約束を実装する3つの交換可能なproviderがあります。[session-persistence Agent Note](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)を参照してください。

## Flush checkpoint

`session/event`は*synchronous* notificationです。persistence pluginはproducerをblockせず、eventをsessionごとのcontrollerへcopyします。最初のpending eventが固定batch windowを開始し、後続eventはdeadlineをresetせず参加します。期限になると1つのdurable batchを開始し、そのwrite中にadmitされたeventは自分のdeadlineを持つfollow-up batchを形成します。`session/flush`はwaitをcancelしてquiescenceまでdrainするため、loopは次の通常turnをclaimする前のordering／error-observation checkpointとして利用できます。background writeがrejectされるとeventを保持してautomatic retryをpauseします。新しいeventは新しいwindowを開始し、explicit flushは直ちにretryして、失敗を`agent/error`とlogger経由で報告します。closeしたturnを越えてsession eventにはしません。disposeも同じfinal drainを行います。設定したmaximumが制限するのは意図したbatch waitだけで、event-loop schedulingやbackend durability latencyではありません（[decision](../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)）。

## Crash recoveryは中断したturnを保持する

logをreloadしたbackendが、`turn/end`のないopenな`turn/start`を見つけることがあります。**truncateはしません**。long-horizon taskでは1つのturnが非常に大きくなり（多数のstepや大量のtool output）、eventはcrash前にdurable append済みだからです。代わりにsynthetic `turn/end { reason: { kind: 'interrupted' } }`でorphaned turnをcloseし、前後のstandalone eventを変更せず中断されたexecutionをbalancedにします。`interrupted`はloopがemitしない唯一の`TurnEndReason`です（[session.md](session.md#why-a-turn-ended-turnendreasonmap)）。

repairはcold sessionにだけ適用します。live idの場合、`SessionPersistence.load(id)`はauthoritative in-memory snapshotがdurableになるまで待ち、balancedになった場合だけ返します。openなlive turnはsynthetic interruption boundaryを受け取らずrejectします。HMRはactive turnをcloseせずlive prefixをadoptします。

`SessionPersistence.inspect(id)`はpublishやrecovery writeをせずimmutable logical Sessionを構築します。cold inspectionはmemory上でinterrupted turnをbalanceし、torn physical tailは変更しません。すでにliveなSessionのinspectionはcurrent immutable snapshotを借りるため、open turnを含むことがあります。coordinator-backed implementationはexactなcold unpublished Sessionをbounded LRUに保持するため、繰り返すhistory readと後続の`prepare(id)`がread、decompression、validation、freeze、Session constructionを共有します。`prepare(id)`はSessionをreserveし、pending repairをcommitしてdisposable publication handleを返します。`load(id)`は同じ仕組みでpublicationなしにrepairをcommitします。このlifecycleは[Session preparation decision](../../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)が所有します。

## `SessionLocation` — sessionごとのoptional artifact target

`SessionPersistence.locate(meta)`はread、create、flushをせずbackend-owned independent artifactを同期resolveします。JSONLはproject／session directory内のabsolute transcript pathを返し、SQLiteはsessionが1つのdatabaseを共有するため`undefined`を返します。返されたpathはまだ存在しないfileやcurrent unflushed turnを含まないfileを指すことがあるため、location hintであってauthorizationやfreshness guaranteeではありません。

```ts type-equiv
/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}
```

<a id="sessionheader--metadata-beside-the-log"></a>

## `SessionHeader` — logに付随するmetadata

sessionごとのmetadataはevent logとは**別に**扱います。format version、cwd、lineage、seed boundaryはstorage concernでconversation eventではないため、`SessionEventMap`の外に置き、`deriveMessages()`にも届きません。headerは`session.header`を通じて`Session`に付加されます。

Source: [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

```ts type-equiv
/**
 * Immutable validated storage metadata, kept outside the conversation event log.
 */
interface SessionHeader {
  /**
   * On-disk format version, stamped from {@link SESSION_FORMAT_VERSION} when the
   * session is created. A persistence backend rejects any other version on load
   * (no migration — see the constant).
   */
  readonly version: number
  /** The session's id (mirrors the {@link Session}'s id). */
  readonly id: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** Absolute working directory the session was created in (if any). */
  readonly cwd?: string
  /** The session this one was forked from (seed lineage), if any. */
  readonly parentSession?: SessionId
  /**
   * How many leading events were inherited through a seed. Persisting this
   * boundary lets resume and replay distinguish parent history from child work.
   */
  readonly seedLength?: number
  /**
   * Coarse product classification for a session created as a subagent child.
   * This is presentation metadata, not proof that the child is continuable.
   */
  readonly origin?: 'subagent'
  /**
   * Delegation depth: absent (zero) for a top-level session, parent depth + 1
   * for a subagent child. Persisted so a recursion budget survives restart and
   * resume — a runtime-only depth would reset a resumed child to top-level.
   */
  readonly delegationDepth?: number
  /**
   * Id of the agent preset this session's agent was composed from, when the
   * deployment composes per session. Durable because the preset decides the
   * session's tools and prompt: a resume that restored a different composition
   * would replay history the model can no longer act on.
   */
  readonly agentPreset?: string
}
```

## Format refusal — buildが忠実に読めないlog

backendが忠実に解釈できないlogは`SessionFormatUnsupportedError`で拒否します。何かが壊れている場合の`SessionPersistenceCorruptionError`とは異なります。`SESSION_FORMAT_VERSION`より新しいheader `version`は方向を示します（「newer harnessで書かれたため、開くにはharnessをupgradeする」）。1つ古いversionは、このbuildにupgrade pathがないことを示します。legacy shapeをnormalizeした後、このbuildのgenerated vocabulary（`gen-persistence-catalog`が出力する`KNOWN_SESSION_EVENT_TYPES`）にないevent typeも、event envelopeが`ignorable: true`を持たない限り同様にrejectします。認識できないrequired eventを黙ってskipすると、残りのlogの読み方が変わる可能性があるためです。backendがsessionごとにartifactを持つ場合、messageにraw log pathを付加して拒否されたtextへ到達できるようにします。JSONL backendは、現在のheader shapeをvalidateしたりevent rowをdecodeしたりする前にraw header lineからforeign versionを拒否します。構造の異なるfuture formatでもupgrade方向を報告し、「corrupt」とは報告しません。SQLiteはまず自身の`SCHEMA_VERSION` pragmaでfile全体の構造をgateします。[session-log-version-mechanism note](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)に設計理由とdeferred upgrader chainがあります。

## `CreateSessionOptions` — seedingとmetadata

storeを通じた`Session`作成には`seed`（initial replayまたはfork history）と`meta`（storeが`SessionHeader`へfoldするstorage-level field）が必要です。storeは`version`／`id`を埋め、`createdAt`をdefaultします。callerはvalidated absolute `cwd`、`parentSession` lineage、`seedLength` seed boundary、optional coarse `origin`、`delegationDepth`、agentをcomposeした`agentPreset`、既存の`createdAt`を指定できます。`origin: 'subagent'`によりproduct navigationは重複するchild rowを隠せますが、descriptorがvalidであることやchildがresumeできることは証明しません。

```ts type-equiv
/**
 * Options for creating a {@link Session} via the store. `seed` replays/forks
 * an existing event log; `meta` carries the caller-supplied storage fields the
 * store folds into a {@link SessionHeader}.
 */
interface CreateSessionOptions {
  /** Initial replay or fork history supplied at construction. */
  readonly seed?: readonly SessionEvent[]
  /**
   * Storage metadata read once before publication. `seedLength` is explicit
   * because a resumed seed contains the full stored log, not only its inherited prefix.
   */
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly createdAt?: number
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
}
```

したがってreplay／forkは`ctx.sessions.create(id, { seed: seedEvents })`です。*persisted* sessionをlive agentへresumeするには`ctx.agents.resume({ resumeSessionId })`を使います。

## `SessionRawArtifact` — 保存artifactのverbatim text

1つのsessionについてbackend自身が持つartifact textです。物理encodingからdecodeされた、durably writeした内容とbyte-identicalなtextです。`readRaw`はparsed eventからreconstructせず返すため、backend-specific serialization（chunk packing、key order、line break）が保持されます。consumerは最初に`supportsRawArtifacts`を検査します。`false`はbackendがこのcapabilityを提供しないこと（例：SQLite）、`readRaw(...) === undefined`は対応backendにそのsessionのmaterialized artifactがないことを示します。

```ts type-equiv
/** A backend's own raw artifact text for one session, verbatim. */
interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  readonly content: string
}
```

## Preparationとrestoration ownership

`SessionStore.prepare()`は通常のcreation option、または`RestoredSessionOptions`を通じてtransferされたfresh persistence graphを受け付けます。restoration branchはtransferされたheaderとeventをその場でvalidateしてfreezeするため、callerはmutable aliasを保持してはいけません。`SessionPreparation`はpublicationまたはrollbackまでexact unpublished Sessionを所有します。disposeは同期的でidempotentです。persistence inspectionが公開するのは、同じprepared Sessionから借りたimmutable logical viewである`SessionInspection`だけです。

```ts type-equiv
/**
 * Fresh storage values transferred to {@link SessionStore.prepare} without a
 * second serialization copy. Callers retain no mutable aliases.
 */
interface RestoredSessionOptions {
  /** Fresh detached storage events to validate and freeze in place. */
  readonly seed: SessionEvent[]
  /** Fresh detached storage metadata to validate and freeze in place. */
  readonly meta: SessionHeader
  /** Select the persistence ownership-transfer path. */
  readonly seedSource: 'persistence'
}
```

```ts type-equiv
/** Inputs accepted while constructing an unpublished Session. */
type PrepareSessionOptions =
  | (CreateSessionOptions & { readonly seedSource?: undefined })
  | RestoredSessionOptions
```

```ts type-equiv
/** Options for a preparation whose provider retains unpublished state. */
interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  readonly release?: () => void
}
```

```ts public-api
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
declare class SessionPreparation implements Disposable {
  /** The exact Session to use for setup and publication. */
  readonly session: Session;
  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
  /** Release provider state once when this preparation leaves its caller. */
  [Symbol.dispose](): void;
}
```

```ts type-equiv
/** Immutable logical session prepared from persistence or a live owner. */
interface SessionInspection {
  /** Validated immutable session metadata. */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  readonly events: readonly SessionEvent[]
}
```

## Lightweight source revision

derived stateのconsumerはfull event logをloadする前に、安価なopaque revisionを比較します。persistence backendがその表現を所有し、appendまたはmutating load repairとtransactionalに変更します。callerはequality比較だけを行います。

```ts type-equiv
/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>
```

```ts type-equiv
/** Lightweight immutable source identity returned without loading a full log. */
interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  revision: SessionPersistenceRevision
}
```

## Backend

すべて同じabstract `SessionPersistence`（`SessionEvent`に対するlocate／create／append／prepare／load／inspect／readFrom／list／listSnapshotsと、observation methodのoptional cancellation）を実装し、共有の`runPersistenceContract` suiteに合格します。

- **[dsh-session-persistence-jsonl](../../packages/session/session-persistence-jsonl)** — sessionごとのappend-only logical JSONL log。defaultではchecksummed concatenated Zstandard frameとして保存し、configでraw lineにもできます。crash-safe atomic write、interrupted-turn recovery、read／replay pathを持ちます。
- **[dsh-session-persistence-sqlite](../../packages/session/session-persistence-sqlite)** — opt-inの`node:sqlite` backend。schema 17を使い、同じblockのdelta runをbounded physical `text-chunks`、`reasoning-chunks`、`tool-call-chunks` rowに保存します。返す前にcomplete logical event streamをreconstructし、新しくdurableになったbatchだけをpackし、古いschemaはmigrationせずrejectします。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionpersistence--sessionpersistence-abstract-seam"></a>

### `ctx.sessionPersistence` — `SessionPersistence` (abstract seam)

Durable append-only session storage. Implementations preserve contiguous, losslessly JSON-serializable events; append resolves only after durability, and load balances a complete interrupted tail without rewriting committed events.

```ts cordis-catalog
/**
 * Resolve this backend's independent local artifact for a session without
 * reading, creating, flushing, or otherwise materializing it. Backends such
 * as SQLite that do not own one artifact per session return `undefined`.
 * @param meta - the immutable session header whose artifact is requested.
 * @returns the backend-specific absolute location, when one exists.
 */
abstract locate(meta: SessionHeader): SessionLocation | undefined

/**
 * Read a session's backend-owned artifact text verbatim — the exact durable
 * bytes the backend wrote (decoded from its physical encoding, e.g. a
 * decompressed JSONL). The returned `content` is the raw text, not a
 * reconstruction from parsed events, so it preserves backend-specific
 * serialization (chunk packing, key order, line breaks). Callers first test
 * {@link supportsRawArtifacts}; `undefined` then means only that the requested
 * session has no materialized artifact.
 * @param _id - the persisted session to read (unused by the default: no
 * per-session artifact).
 * @param signal - optional cancellation for backend read work.
 * @returns the raw artifact plus its parsed header, or `undefined` when the
 * session is absent.
 * @throws when this backend does not expose per-session raw artifacts.
 */
readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>

/**
 * Register a new session's metadata. A backend MAY defer the physical write
 * until the first {@link append} (lazy materialization), in which case a
 * created-but-never-appended session is absent from {@link list}
 * — abandoned sessions leave nothing behind.
 * @param meta - the immutable header (id, version, cwd, lineage) to record.
 */
abstract create(meta: SessionHeader): Promise<void>

/**
 * Durably persist a batch of events. Honors the append-only and contiguous-
 * seq contracts: the first event's `seq` MUST equal the stored next-seq
 * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
 * serializable `event.data` with an error naming the offending event type.
 * @param id - the session the batch belongs to.
 * @param events - the contiguous batch to persist, in seq order.
 */
abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

/**
 * Prepare the exact unpublished Session used by resume. Implementations may
 * reuse object graphs retained by an earlier {@link inspect} after confirming
 * their durable revision is still current; disposal releases an unpublished
 * reservation. Revision retries require the durable log to remain unchanged
 * for one read/check round trip; continuous external writers may delay completion.
 * @param id - persisted session to prepare.
 * @param signal - optional cancellation for preparation work.
 * @returns one owned unpublished Session preparation.
 */
async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>

/**
 * Load an immutable balanced logical view and commit any required cold
 * recovery. A complete interrupted final turn is preserved and durably
 * closed with missing tool errors plus any open step and turn boundaries;
 * only a torn final record is discarded. Unknown versions and corruption in
 * the committed prefix reject. Implementations MUST NOT crash-repair an
 * identity still bound to a live Session: a balanced live log may return as a
 * durable snapshot, while an open live turn rejects. Returned values may be
 * shared with immutable live or prepared state and must not be mutated.
 * Revision-based implementations may wait for one stable read/check round trip.
 * @param id - the persisted session to reload.
 * @returns the header and a log ending on a balanced `turn/end`.
 */
abstract load(id: SessionId): Promise<SessionInspection>

/**
 * Inspect an immutable logical session without committing recovery or
 * publishing it. A cold complete interrupted turn receives synthetic closers
 * in memory and a torn physical tail remains untouched. An already-live
 * Session instead yields its current immutable snapshot, which may contain an
 * open turn and its `session/end-seed` boundary. Coordinator-backed
 * implementations retain the exact cold unpublished Session for bounded
 * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
 * already committing or reserved for resume remains exclusive, and inspection
 * may borrow its immutable view. Callers borrow only the immutable header and
 * log. Continuous external writers may delay revision convergence.
 * @param id - the persisted session to inspect.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the validated header and current logical event log.
 */
abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

/**
 * Read the stored events from `fromSeq` onward — the read-from-seq
 * primitive for read models that resume from a watermark (e.g. a persisted
 * projection cache folding only the tail past its checkpoint). Unlike
 * {@link inspect}, it is a detached physical suffix read: no preparation
 * cache, torn-tail truncation, synthetic closers, or coordinator-state
 * publication. Only events from the valid contiguous stored prefix are
 * returned, so a torn fragment never reaches the caller. `fromSeq` at or
 * beyond the stored prefix returns an empty event list (never an error).
 * Backends whose medium can seek by seq
 * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
 * still parse the whole artifact and skip forward — the primitive bounds
 * what is RETURNED and refolded, not every backend's physical read.
 * @param id - the persisted session to read.
 * @param fromSeq - first event seq to include; a non-negative safe integer.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the header and the stored events with `seq >= fromSeq`.
 */
abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>

/**
 * Lightweight listing from metadata, without a full-log parse.
 * @param signal - optional cancellation for backend listing work.
 * @returns one header per materialized session.
 */
abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * List materialized sessions with cheap per-log change tokens.
 *
 * Repeated observations of an unchanged log return the same revision. A
 * successful mutating {@link load} repair changes the next listed revision.
 * Revisions also distinguish independently backed stores so backend-local
 * counters cannot compare equal across different persistence sources.
 * @param signal - optional cancellation for backend snapshot-listing work.
 * @returns one header and opaque revision per materialized session without loading full logs.
 */
abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

Types: [SessionEvent](session.md) · [SessionId](core.md)

Source: [`packages/session/session-persistence/src/index.ts:84`](../../packages/session/session-persistence/src/index.ts)
<!-- END GENERATED cordis-surface -->
