# Compaction

[English](compaction.md) | [中文](compaction.zh.md) | 日本語

compaction seamはbashと同様に分割された[capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)です。Service Definition（[dsh-compaction](../../packages/compaction/compaction)、`ctx.compaction`）、Service Provider（[dsh-compaction-basic](../../packages/compaction/compaction-basic)などのbackend）、human Consumer（[dsh-command-compact](../../packages/compaction/command-compact)）で構成されます。Compactionは**1つの任意capability**でagent-loop spineの一部ではないため、語彙は[core.md](core.md)ではなくここにあります。tokenizerまたはtemplateベースのbackendは同じinterfaceを実装する兄弟packageです。bashと異なり、interfaceは`dsh-session`と`dsh-llm`に必ず依存します。verbはagent所有の`Session`に対して動作し、永続summary eventは`ContentBlock`語彙を使います（[compaction capability-seam Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)を参照）。

Source: [`packages/compaction/compaction/src/types.ts`](../../packages/compaction/compaction/src/types.ts)

## `compaction/*` session event

Compactionはdeclaration mergingによって[`SessionEventMap`](session.md)を3つのevent typeで拡張します。3つとも**log-only**で、lock、summary、selected range、shadowed event seq、token count、model callを記録しますが、surfaceには加わりません。`SurfaceEventType`は意図的に拡張しません（modelに届くのはmessage-producing eventだけ）。そのためsummary自体は`surfaceOp: { op: 'replace', start, end }`を持つ別の`user/message`に乗ります。これはsummary compactionが行う唯一のsurface mutationです。`user/message`を再利用する理由は[Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)が管理します。

| Event | Payload | 役割 |
|---|---|---|
| `compaction/start` | `{ turn }` | acquires the log-recorded lock; a number identifies the open automatic turn, while `null` identifies a standalone manual attempt |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | the safe summary projection, optional complete provider output and usage, an `llmStreamCall: true` marker when producing the result consumed exactly one call through this context's `ctx.llm.stream()` (which requires complete `rawOutput`), the shadowed surface-boundary pair (`start`/`end` seqs — a position span, not a numeric interval), the shadowed seqs in surface order, the estimated token count, and the summarize call's envelope (`provider`, `model`, plus its generation cap when one applied) — logged so the one-shot request is reconstructable from log + code (the reconstructability Agent Note); unmarked `rawOutput` does not identify the call path |
| `compaction/end` | `{ turn, error? }` | releases the lock with the same numeric-or-null owner (`error` records an unsuccessful attempt) |

lockはoperation**全体**を囲みます。まず`compaction/start`をappendし、summarization、`compaction/summary` record、`user/message` replacementをすべてlandさせ、その後にだけ`compaction/end`をappendします。最後にlockを解放するため、途中のcrashは、compaction完了を偽って示す`compaction/end`ではなく、検出可能なorphaned lock（対応する`compaction/end`のない`compaction/start`）になります。

markerはlockの時点であり、排他的なcontainerではありません。summarizationがpending中、standalone manual startとendの間に無関係なidle injectionが現れることがあります。manual pathはselected positional spanだけを再検証するため、injected contextはreplacement checkpoint後も残ります。liveなunmatched startはすべてのentry pointをblockし、新しい`session/end-seed`より前のunmatched startは以前のlifecycleの古い証拠としてignoreします。

これらのvariantは`declare module '@deepseek-ai/dsh-session/types'` block内でmergeされます。そのため他のsubsystem pageのtop-level typeとは異なり、差分検査対象の` ```ts type-equiv ` blockとして貼り付けていません（`verify-type-equiv` extractorはnameによるtop-level declarationだけに一致します）。前述のpayload tableがcatalog entryであり、authoritative fieldはsource linkを参照してください。

## `CompactionResult`

成功したcompactionがcallerに返すものです。bookkeeping eventのseq、safe summary projection、shadowed rangeとseq、estimated token countを含みます。

```ts type-equiv
/** Result of a successful compaction operation. */
interface CompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  compactionId: CompactionId
  /** Human command that initiated this compaction, when it was manual. */
  sourceCommandId?: CommandId
  /** The seq of the appended `compaction/start` event. */
  startSeq: number
  /** The seq of the appended `compaction/summary` event. */
  summarySeq: number
  /** The seq of the appended `compaction/end` event. */
  endSeq: number
  /** The summary content blocks produced by the backend. */
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: number; end: number }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: number[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
```

## Service

automatic callerはpolicyが実行される理由を示し、実装はconfirmed overflowを通常のpressureより積極的に扱うことがあります。

```ts type-equiv
/** Why automatic policy is asking a backend to consider compaction. */
type CompactionTrigger = 'pressure' | 'context-overflow'
```

`CompactionEngine`はautomatic `pressure`または`context-overflow` policy向けに`compactIfNeeded(agent, trigger, signal)`、pressure未満でもidle sessionを有用に縮小する`compactNow(agent, signal)`、明示的なinclusive surface range向けに`compactRegion(...)`を公開します。`compactNow()`はturn間のagent maintenanceとして実行され、有用なrangeがない場合はwriteせず`null`を返します。summarization前にstandalone `turn: null` bracketを記録し、後続queued promptが新しいsurfaceから導出される前にclosed attemptをflushします。すべてのbackendは`compactCheckpointSource(compactionId, sourceCommandId?)`でreplacement `user/message` sourceを作成します。clientとwire consumerはcordis-freeな`@deepseek-ai/dsh-compaction/checkpoint` subpathからconstructor、`CompactionCheckpointSource`、`isCompactCheckpointSource()`をimportし、package rootはhost consumer向けにre-exportします。required transaction identityはreplacement checkpointをcorrelateし、predicateはbackendに依存せず認識できるようにします。実装は指定されたsignalをsummarizationへforwardしなければなりません。seamはpricing APIを所有しません。singletonの[`ctx.tokenMeter`](token-meter.md)がestimationとreplayを直接所有し、`dsh-compaction-basic`がretention、event sequencing、routeされたsummarization call、configを所有します。

manualで想定されるfailureは`ManualCompactionErrorCode`を使います。

```ts type-equiv
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy'
  | 'cancelled'
  | 'changed'
  | 'summary'
  | 'commit'
  | 'persistence'
```

`changed`と`summary`はconversation surfaceを変更しませんが、failed attemptをlogでcloseして永続化します。`commit`はpartial mutationの後に続くことがあり、`persistence`はin-memory bracketはcloseしたもののflushが失敗したことを示します。cancelは別扱いで、必要なcleanup後に正確なabort reasonをthrowします。

pressure compactionはrequest derivation前のserial `agent/pre-step`で実行されます。pressureまたはcanonical overflowが条件を満たすと、compaction-basicはrange selection前に任意の[`ctx.toolResultPruner`](../../packages/compaction/compaction-tool-result-pruner/README.md)を呼び、`ctx.tokenMeter`で再計測し、summaryなしでsurfaceを進めることもできます。failed-request recoveryはfailed stepのclose後に`agent/request-error`を通じて実行され、pruning後にsummary workがthrowしても、surface replacement generationが進んだ場合だけretry actionを返します。cancelが常に優先されます。region boundaryはtool-call／result pairingを保持しますがturn全体は保持しないため、oversized turnの早くcloseしたstepをcompactできます。threshold、retained-tail policy、overflow cap、failure handlingは`dsh-compaction-basic`が所有します。

Service Definitionは、seqの前後でtool-call／result pairingを検査する`toolPairingBalancedBefore(session, seq)`と`toolPairingBalancedAfter(session, seq)`をexportします。どちらもcurrent surface membershipを検証し、missing seqとorphan resultを拒否します。cache動作は[package contract](../../packages/compaction/compaction/README.md#tool-pairing-boundaries)が定義します。

## Tool-result pruning outcome

任意のtool-result pruning serviceは、各永続content replacementとUnicode code pointの総削減量を報告します。公開result typeは[`compaction-tool-result-pruner/src/types.ts`](../../packages/compaction/compaction-tool-result-pruner/src/types.ts)にあります。

```ts type-equiv
/** Cited source event and size accounting for one landed surface replacement. */
interface PrunedEntry {
  /** Full-fidelity tool-result event shadowed by the replacement. */
  readonly originalSeq: number
  /** Newly appended pruned tool-result event. */
  readonly replacementSeq: number
  /** Tool call shared by the original and replacement. */
  readonly callId: CallId
  /** Original text size in Unicode code points. */
  readonly charsBefore: number
  /** Replacement text size in Unicode code points. */
  readonly charsAfter: number
}
```

```ts type-equiv
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  /** Replacements in the snapshotted surface order. */
  readonly pruned: readonly PrunedEntry[]
  /** Total Unicode code points removed across replacements. */
  readonly charsRemoved: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcompaction--compactionengine-abstract-seam"></a>

### `ctx.compaction` — `CompactionEngine` (abstract seam)

Abstract compaction service. Implementations own trigger policy, retention, and summarization, and may consume a separate measurement service. A successful run replaces the selected surface span with one summary node and prevents concurrent compaction of the same session. The replacement user message uses compactCheckpointSource with the transaction identity so consumers recognize and correlate it independently of the backend. Load one implementation per context as `ctx.compaction`.

```ts cordis-catalog
/**
 * Consider automatic compaction for one explicit trigger. Pressure policy
 * uses the latest durable routed request, while context-overflow policy may
 * force a useful balanced reduction even below the normal threshold. Return
 * `null` when no safe range can be compacted. A single oversized retained
 * unit or request envelope cannot be repaired through surface compaction.
 *
 * @param agent - agent context owning the session surface and routing options.
 * @param trigger - normal pressure or provider-confirmed context overflow.
 * @param signal - cancellation signal; model-backed implementations must forward it.
 * @returns the compaction result, or `null` if no compaction was needed.
 */
abstract compactIfNeeded( agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal, ): Promise<CompactionResult | null>

/**
 * Explicitly compact useful history even below automatic pressure thresholds.
 * Implementations synchronously start an idle task before any asynchronous
 * work, select a useful range without writing on a no-op, then
 * append a standalone `compaction/start` before summarization. That durable
 * marker is the compaction lock until one `compaction/end` attempt. Later waking
 * prompts remain accepted in FIFO order and start only after the optional
 * durability checkpoint and idle-task settlement. Context injected while the
 * summary runs may sit between the marker pair; only the selected span must
 * remain stable.
 *
 * @param agent - idle agent whose durable history should be compacted.
 * @param signal - cancellation scoped to this compaction request.
 * @param sourceCommandId - initiating command identity for a manual compaction.
 * @returns the compaction result, or `null` when no safe useful range exists.
 * @throws {@link ManualCompactionError} for expected busy, agent-cancellation,
 * changed-span, summarization/shrink, commit-stage, or persistence failures;
 * an aborted request preserves its exact abort reason. Failed attempts remain
 * visible in the log.
 */
abstract compactNow( agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId, ): Promise<CompactionResult | null>

/**
 * Forcibly compact a range of surface nodes into a single summary node.
 * `start` and `end` name an inclusive span by surface position, not numeric seq
 * order; replacements can make visible seqs non-monotonic. Both edges must be
 * balanced so assistant tool calls remain paired with their results. A model-
 * backed implementation forwards cancellation and rejects active, missing,
 * reversed, or unbalanced ranges. The target session is `agent.session`.
 * Its replacement user message must use {@link compactCheckpointSource} with
 * the transaction's `CompactionId`.
 * Use {@link toolPairingBalancedBefore} and {@link toolPairingBalancedAfter}
 * for the edge checks.
 *
 * @param start - first surface seq, inclusive.
 * @param end - last surface seq, inclusive.
 * @param agent - context whose session is mutated and whose routing options guide summarization.
 * @param signal - optional cancellation; model-backed implementations must forward it.
 * @throws when compaction is active or the range is missing, reversed, or unbalanced.
 * @returns the appended event seqs, summary, replaced range, and token accounting.
 */
abstract compactRegion( start: number, end: number, agent: CompactionAgentContext, signal?: AbortSignal, ): Promise<CompactionResult>
```

Types: [CommandId](commands.md)

Source: [`packages/compaction/compaction/src/index.ts:96`](../../packages/compaction/compaction/src/index.ts)

<a id="ctxtoolresultpruner--toolresultpruner"></a>

### `ctx.toolResultPruner` — `ToolResultPruner`

Deterministic head/middle/tail pruning for current tool-result surface nodes.

```ts cordis-catalog
/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 * @param blocks - tool-result content to measure.
 * @returns total Unicode code points across text blocks.
 */
measureContent(blocks: readonly ContentBlock[]): number

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
 * boundary cannot split a surrogate pair. Grapheme clusters may still split.
 * @param blocks - original tool-result content.
 * @returns pruned content, or `null` when the text is within budget.
 */
pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null

/**
 * Prune every over-budget tool result from one stable current-surface snapshot.
 * Each replacement preserves the complete event data except for `content`,
 * cites the shadowed node so replay can recover the replacement input, and is
 * immediately preceded by a `compaction/prune` shadow-price event pricing the
 * shadowed node through the injected token meter, so pure consumers can
 * subtract it without per-node state.
 * @param session - session whose current surface is rewritten.
 * @returns landed replacements and aggregate Unicode-code-point savings.
 * @throws when the session rejects a replacement; replacements committed
 * earlier in the pass remain durable.
 */
pruneSession(session: Session): PruneResult
```

Types: [ContentBlock](llm-streaming.md) · [Session](session.md)

Source: [`packages/compaction/compaction-tool-result-pruner/src/index.ts:44`](../../packages/compaction/compaction-tool-result-pruner/src/index.ts)
<!-- END GENERATED cordis-surface -->
