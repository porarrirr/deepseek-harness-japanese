# LLM Streaming

[English](llm-streaming.md) | [中文](llm-streaming.zh.md) | 日本語

[`packages/llm`](../../packages/llm/README.md)のconversationとstreaming typeです。すべてのrequestとdurable historyが共有する`Message`／`ContentBlock` variant、fully assembled model request、raw `StreamChunk` protocol、すべてのadapterが実装するadapter contract、shared assemblerを扱います。[core packages](core.md)はturnごとにこれらのvalueを保持してlogします。このページは型を宣言します。

Source: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

<a id="content-blocks-and-messages"></a>

## Content blockとmessage

conversationは`Message`の集合です。messageはtypedな**content block**のarrayで、block unionは`ContentBlockMap`から導出されます。

Source: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

```ts type-equiv
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
```

block interface（全fieldはsourceにあります）は、`TextBlock`（`text`）、`ReasoningBlock`（visible textとは別のthinking）、`ImageBlock`（durableな[image attachment](attachment.md)）、`ToolCallBlock`（`id: CallId`、`name`、raw-JSON `arguments`）、`ToolResultBlock`（`toolCallId`、nested `content: ContentBlock[]`、`isError?`）です。`ContentBlock = ContentBlockMap[ContentBlockType]`です。新しいmodalityをmerge-extensible mapに追加できるのは、adapter、UI、compaction、durable replay pathが対応するときだけです。

Source: [`packages/llm/llm/src/message.ts`](../../packages/llm/llm/src/message.ts)

`Message`はidentifiedでimmutableなrole／source／content valueです。modelが生成したassistant messageは生成したproviderとmodelを示し、sourceにoptional adapter-private replay dataを持ちます。

```ts type-equiv
/** Provider/model identity and adapter-private replay data for an assistant message. */
interface AssistantProvenance {
  /** Provider route that produced the message. */
  provider: string
  /** Provider model id that produced the message. */
  model: string
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  replayState?: unknown
}
```

```ts type-equiv
/** One immutable message representation shared by delivery, durable history, and model requests. */
interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: MessageId
  /** Provider-neutral conversation role. */
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-facing blocks. */
  readonly content: ContentBlock[]
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource
}
```

messageのsource自体がmerge-extensible sum typeです。

```ts type-equiv
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  model: ModelMessageSource
  tool: ToolMessageSource
}
```

producer identityとpresentation formは独立しています。`kind`は*誰が生成したか*を示し、optionalな`form`は*どの種類の情報か*を示します。どのように表示するかはconsumerが決めます。複数producerが1つのformを共有でき、1つのproducerがsession中に複数formをemitすることもできます。valueはsemanticで1つずつ増え、absentまたはunrecognized valueはdocumented defaultを使いopaque contentとして表示します。

```ts type-equiv
/**
 * The kind of information in producer-supplied context, declared by the
 * producer beside its provenance.
 *
 * `MessageSource.kind` answers *who produced this*; `form` answers *what kind
 * of thing it is*, and the two axes are deliberately independent — several
 * producers share one form, and one producer may emit more than one form over
 * a session.
 *
 * The vocabulary is SEMANTIC, never visual: a value states that the content is
 * a file's instructions or a catalog of available items, and a consumer decides
 * what that looks like. Colors, icons, ordering, and collapse defaults are the
 * consumer's business and must not enter this union. It grows one value at a
 * time as producers gain the structured fields their form needs; an absent or
 * unknown value is the documented default, presented as opaque content.
 */
type ContextForm =
  /** Instructions read out of workspace files the model is expected to follow. */
  | 'instructions'
  /** A catalog of items available in this session, republished as it changes. */
  | 'catalog'
  /** Current state, where a later snapshot from the same producer supersedes an earlier one. */
  | 'snapshot'
  /** A one-off account of something that just happened; it supersedes nothing. */
  | 'notice'
  /** A message another agent addressed to this one. */
  | 'relay'
  /** Material lifted out of another session's log, possibly reduced on the way in. */
  | 'recall'
```

```ts type-equiv
/** One named contribution to a `snapshot`-form context, in assembly order. */
interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  readonly name: string
  /** That contribution's model-facing text, exactly as assembled. */
  readonly text: string
}
```

```ts type-equiv
/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
type ContextFormed =
  | { readonly form?: never }
  | { readonly form: 'instructions' }
  | { readonly form: 'catalog' }
  | {
    readonly form: 'snapshot'
    /** The named contributions this snapshot assembled, in order. */
    readonly sections: readonly ContextSnapshotSection[]
  }
  | {
    readonly form: 'notice'
    /** One-line account of what happened, shown without expanding the row. */
    readonly summary: string
  }
  | { readonly form: 'relay' }
  | { readonly form: 'recall' }
```

<a id="streamchunk--the-raw-protocol"></a>

## `StreamChunk` — raw protocol

streaming responseは複数のtyped block（text、reasoning、複数tool call）をinterleaveします。`index`は各deltaをblockに結び付け、`block-end`はfully assembled `ContentBlock`を運ぶため、consumerがdeltaを自分で再assembleする必要はありません。**closed** discriminated unionなので、`type`の`switch`は`assertNever`で終わります。variantを追加すると、処理が必要なすべてのconsumerでcompileが壊れます。

```ts type-equiv
/**
 * Adapter-private lossless-JSON state for replaying a successful response,
 * carried by a terminal `finish` chunk and stored on the assembled assistant
 * message's model source. Both halves stay opaque to the harness; only the
 * split is shared vocabulary, so assembly can keep stored metadata aligned
 * with stored content without reading either half.
 */
interface ReplayEnvelope {
  /** Response-level adapter-private metadata (ids, native stop reason). */
  response: unknown
  /**
   * Per-block adapter-private metadata, one entry per emitted block in
   * first-seen stream order. When assembly drops a block it drops the entry at
   * the same position; entries whose length does not match the emitted block
   * count discard the whole envelope. An adapter whose metadata is independent
   * of block structure omits this field and the envelope passes through
   * assembly unchanged.
   */
  blocks?: readonly unknown[]
}
```

```ts type-equiv
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | {
    type: 'finish'
    reason: FinishReason
    /** Replay metadata for a successful response; see {@link ReplayEnvelope}. */
    replayState?: ReplayEnvelope
  }
```

## `LlmFailure`

throwされたfailureもin-bandのfinal-adapter failureも、1つのserializable provider-neutral payloadにnormalizeします。`providerRetryAfterMs`はproviderが要求したvalidated positive delayで、retry decisionではありません。`ProviderRequestId`はdiagnostics用のopaque branded stringです。

```ts type-equiv
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  readonly code: string
  /** HTTP status returned by the provider, when available. */
  readonly status?: number
  /** Provider-requested delay in milliseconds, when valid and available. */
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: ProviderRequestId
}
```

## Adapter contract

すべてのadapterは次をMUST守り、すべてのconsumerが依存できます。

- **`usage`は`finish`の前、`finish`の後は何も出さない。** providerのend-of-stream markerまで両方を遅延し、末尾のusage-only chunkが順序を壊さないようにします。
- **Tool-call `arguments`はend-to-endでraw JSON stringのまま。** 部分fragmentは`argumentsDelta`でstreamし、parsed objectを返すproviderは`block-end`で再stringifyします。
- **許可されるerror pathは2つ、型は1つの`LlmFailure`。** `stream()`からTHROWする（transport／protocol error）か、`finish {kind:'error'|'aborted', failure}`でstreamを終了できます（stream途中にthrowできないadapterのprovider in-band error）。`LlmError.failure`は同じ`LlmFailure`を運びます。callがadapterを選択した後、streamは正確なthrow済み`Error` objectを保持し、immutableな事実とserving registrationのimmutable retry policyをcallに関連付けます。agent loopはfailed stepをcloseし、error、facts、immutableなprior-retried facts、serving policy、turn signalを`agent/request-error`へ渡します。handling listenerはawaitしたrepair後に`{ kind: 'retry' }`を返し、recoveryがなければstructured failureがturn errorになります。そのattemptの通常assistant messageやtool side effectはcommitしません。
- **1回のadapter callは1回のprovider attempt。** adapterはlibrary retryをdisableします。agent-level recoveryは別のdurable numbered turnを開始し、直接`ctx.llm.stream()`を呼ぶcallerはsingle-attemptのままです。
- **provider stallはtransportでbounded。** 両方のremote adapterはpositive finiteな`streamIdleTimeoutMs`を公開し、defaultは5分です。watchdogはiterator `next()`がoutstandingの間だけarmし、request全体で1つのstable signalを使い、自身のexpiryを`TIMEOUT`へmapします。callerの先行abortは`ABORTED`のままです。
- **context overflowにはcanonical codeが1つ。** 両DeepSeek adapterは`isContextWindowExceededError()`で明示されたprovider detailを分類し、throwされたHTTP `LlmError`でもin-band finish errorでも`CONTEXT_WINDOW_EXCEEDED`を表面化します。consumerはprovider textではなくcodeでrouteします。
- **empty completionはretryable errorで、silent successではない。** 両adapterはcontent blockを持たないterminal `stop` finishをcanonical `EMPTY_RESPONSE` code付きの`finish {kind:'error'}`へmapし、`dsh-llm-retry`はdefaultでretryします。[empty model responses are retryable](../../.agents/notes/implemented/bug-fix/2026-07-24-empty-model-response-is-retryable.md)を参照してください。
- **すべてのprovider HTTP requestにapp-attribution headerを付ける。** adapterは`attributionHeaders()`（以下）を送ります。これは`User-Agent` baselineであり、wire-level testで検証します。
- **Replay stateはadapterが所有し、分割方式を共有する。** 成功した`finish`は`ReplayEnvelope`を持つことがあります。opaqueなresponse-level metadataと、emitされたblock sequenceに沿うoptionalなper-block entryです。assemblyがblockをdropすると同じpositionのentryもdropするため、stored metadataは常にstored contentを表します。loopはpruned envelopeをassembled assistant messageとともに保存します。後続requestではhistorical providerとtarget providerが現在同じadapter instanceに登録されている場合だけ、`LlmRuntime`がstateを渡します。adapterがstateをvalidateしcross-model／cross-provider conversionを所有します。他adapterにはprivate stateなしでprovider-neutral contentとprovider／model fieldを渡します。durable contentがauthoritativeなので、reading adapterがstored stateを使えない場合はrequestをfailさせず、そのmessageをdiagnostic付きprovider-neutral conversionへdegradeします。

## `ResolvedRetryPolicy`

retry configurationはroute registration前にimmutable discriminated unionへresolveされます。normal modeは`mode: 'normal'`、finiteな`maxRetries`、`retryableCodes`、requiredな`initialDelayMs`、`maxDelayMs`、`jitterRatio`を持ち、always modeは`mode: 'always'`と同じrequired backoff fieldを持ちますがfinite maximumはありません。provider policyを省略するとnormal defaultの5 retryを使います。layered settingはalways modeに切り替えた後もnormal-onlyの`maxRetries`や`retryableCodes`を保持できますが、resolverはinactive fieldを無視してpure always policyをcaptureします。`LlmRuntime.providerRetryPolicy(provider)`は登録値を返し、`llmRetryPolicyOf(stream)`はcallがadapterを選択した後にserving registrationからcaptureした値を返します。そのため後続のroute disposeやreplaceによってin-flight failureのrecovery policyが変わることはありません。optional input fieldは[generated config catalog](../config-catalog.md)にあります。

## `AppIdentity` — app attribution

すべてのadapterがproviderへ送るstatic public application identityです（[`packages/llm/llm/src/attribution.ts`](../../packages/llm/llm/src/attribution.ts)）。`attributionHeaders(identity?)`がmapするのはstandard `User-Agent` headerだけです。このcontractはOpenRouter-specific app attribution headerを意図的にサポートしません。default `APP_IDENTITY`はpackage manifestからversionを取得します。各fieldはpublic product factで、secret、path、session id、per-user identifierはなく、per-requestの値がfieldに影響することもありません。理由は[Mandatory `User-Agent` attribution](../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)にあります。

```ts type-equiv
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}
```

## `TokenUsage`

callごとのtoken accountingです。countは**disjoint**です。`inputTokens`はuncached inputだけで、cached inputは別に報告し、billed inputは3つの合計です。providerがcache hitを1つのprompt total（DeepSeekの`prompt_tokens`）にfoldするadapterは、そこからcache分を差し引きます。`reasoningTokens`は存在する場合も`outputTokens`に含まれるinformational detailで、totalに再加算してはいけません。

```ts type-equiv
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

## `BlockAssembler`

`BlockAssembler`（[`packages/llm/llm/src/assembler.ts`](../../packages/llm/llm/src/assembler.ts)）は、`StreamChunk` streamを`ContentBlock`、usage、finish reason、replay stateへfoldする唯一のshared implementationです。loopはraw chunkをlogしながら同じchunkをassemblerへ渡し、生成したproviderとmodel付きでassembled assistant contentを保存します。foldを再実装せずassembled resultが必要なconsumerはこれを使います。

1つのkeep／drop decisionがcontentとmetadataをまとめて扱います。`max-tokens` finishではtruncated callを安全にexecuteできないためすべてのtool callをdropし、同じdecisionでdropしたpositionのreplay envelope per-block entryもpruneします。そのためassemblyが何をremoveしても`blocks()`と`replayState`が食い違いません。

```ts public-api
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends,
 * or `interruptedBlocks()` when cancellation cut the stream short.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
declare class BlockAssembler {
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void;
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[];
  /**
   * Assemble the prefix an interrupted stream can safely finalize: closed and
   * open text/reasoning blocks with non-whitespace content, in stream order.
   * Tool calls are omitted because interruption precedes dispatch; retaining
   * one would require a fabricated result. Open unknown blocks are also omitted.
   * @returns the kept blocks; empty when nothing streamed before the interruption.
   */
  interruptedBlocks(): ContentBlock[];
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined;
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish(): FinishReason;
  /**
   * Replay metadata from the terminal finish chunk, if any, with per-block
   * entries pruned in step with {@link blocks}. Undefined when the envelope's
   * entries do not align with the emitted blocks.
   */
  get replayState(): ReplayEnvelope | undefined;
  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message;
}
```

<a id="the-model-request-and-result"></a>

## Model request

1つのmodel callはfully assembled `GenerateOptions`です。adapterはraw [`StreamChunk`](#streamchunk--the-raw-protocol) streamで応答し、consumerは[`BlockAssembler`](#blockassembler)でassembleします。

Source: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

providerとmodelのdiscoveryには小さなprovider-neutral descriptorを使います。model catalogはadvisoryで、routingは引き続きregistered providerをkeyにし、adapterはunlisted model idを受け付けることがあります。

adapterのregistrationはhandleを返します。disposerと、route setがuser-configurableなpluginに必要なatomic route replacementです。

```ts type-equiv
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}
```

```ts type-equiv
/** Display metadata for one registered provider route. */
interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  name: string
}
```

adapter pluginは`registerConfigurableProviders()`を通じて*実行可能な*routeも宣言し、各routeのuser-settings sectionに対応付けます。そのためconfiguration surfaceはrouteがregistrationされる前からdormant providerを提供できます。

```ts type-equiv
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean
}
```

```ts type-equiv
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
  /** Optional user-facing distinction from otherwise similar models. */
  description?: string
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  inputModalities?: readonly ModelModality[]
}
```

correctness-sensitive metadataはadvisory catalogとは別にresolveされ、exact routeをserveするadapterが所有します。context capacity、adapter call default、reasoning choiceは1つのexact-model resultを共有し、consumerがauthoritative model resolutionを繰り返さないようにします。

```ts type-equiv
/** Provider-owned context capacity for one exact provider/model route. */
interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
}
```

reasoning effortもexact-route capabilityです。coreはidentifierをbrandしますがvalueを列挙せず、各adapterがordered set、display name、optional deployment defaultを所有します。

```ts type-equiv
/** Adapter-owned identifier for one model's selectable reasoning effort. */
type ReasoningEffortId = Branded<'ReasoningEffortId'>
```

```ts type-equiv
/** Display metadata for one adapter-owned reasoning effort. */
interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  id: ReasoningEffortId
  /** Human-readable effort name for selectors and diagnostics. */
  name: string
  /** Optional user-facing distinction from otherwise similar efforts. */
  description?: string
}
```

```ts type-equiv
/** Selectable reasoning efforts for one exact provider/model route. */
interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  efforts: readonly LlmReasoningEffortInfo[]
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  defaultEffort?: ReasoningEffortId
}
```

```ts type-equiv
/** Exact-route model metadata resolved by its owning adapter. */
interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  defaultMaxTokens?: number
  /** Adapter-owned selectable reasoning levels when exposed. */
  reasoning?: LlmModelReasoningInfo
}
```

```ts type-equiv
/** A single model request, fully assembled. */
interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  model: string
  /** Adapter-owned reasoning effort selected for this exact model. */
  reasoningEffort?: ReasoningEffortId
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  messages: Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  stop?: string[]
  signal?: AbortSignal
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  sessionId?: Branded<'SessionId'>
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  purpose?: 'compaction' | 'session-title'
}
```

model responseが停止した理由はmerge-extensible reasonです。terminal provider failureはstreaming contractの[`LlmFailure`](#llmfailure)を運びます。

```ts type-equiv
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}
```

`FinishReason = FinishReasonMap[keyof FinishReasonMap]`です。`TokenUsage`（disjointなcache fieldを持つcallごとのaccounting）の詳細は[以下](#tokenusage)にあります。

`GenerateOptions.tools`は`ToolSchema`を運びます。modelへ送るtoolのJSON-schema descriptionです。loopがstepごとにassembleするrequestの一部なので、dsh-toolsではなくdsh-llmで宣言します。

```ts type-equiv
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}
```

model向けの`ToolSchema`がwire typeで、これを生成するregistered `ToolDefinition`（schema＋`execute`）は[tools.md](tools.md)にあります。

surfaceがまだdraft中のproviderにはrouteもcatalogもないため、interrogationを別に記述します。requestはuserがedit中のdraftを運び、replyはsurfaceが採用できるcandidateであり、serveしなければならないcatalogではありません。

```ts type-equiv
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  signal?: AbortSignal
}
```

```ts type-equiv
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
```

### Request envelope：`LlmCallConfig`とlogged header

loopは各requestをlogged stateからbuildします。`EpochHeader`はcall configを記録し、adapter defaultが提供したfieldをmarkし、rendered promptとauthoritativeに返されたtool order（`toolOrder`で設定、unsetならlexicographic）を完全な`request/header` snapshotで記録します。derived historyと合わせて、requestはsession logからreconstructできます。[session.md](session.md#the-request-header-event-requestheader)と[reconstructability Agent Note](../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)を参照してください。

`agent/request`はfrozen call-config seedを受け取り、provider、model、reasoning effort、samplingを切り替えるreplacementを返せます。waterfall前にloopはadapter defaultとしてmarkされたvalueをremoveし、exact-model preparationがselected routeのcurrent valueをmaterializeできるようにします。unmarked explicit settingはproposalに残ります。waterfall後、preparationはunsupported explicit effort idをclampせずrejectし、effective configとadapter defaultが提供したfieldをturn signal下にlogします。prepared callはdispatch中も1つのadapter registrationを保持します。`llm/stream`に到達するrequestはdeep-freezeされるためmutationはthrowし、process-local loop identityを持つのでobserverは別にlogされたfrozen auxiliary callとconversation requestを混同しません。

wire上ではloop-built requestが`system` slot（rendered prompt assembly）を読み、その後にderived historyを続けます。logged request snapshotはturnのfirst stepでは最新の`user/message`で終わり、later stepではprevious stepのtool resultで終わります。dev invariantはすべてのloop-built requestに対してこの式を正確に再計算します。

FIXME(call-config-shape)：cache用途で本当にepoch-levelである残りのfieldを再検討する（`model`とmodel-owned reasoning effortは明示的で、sampling scalarは慎重を期してここに置いている）。

```ts type-equiv
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}
```

```ts type-equiv
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}
```

## Serviceとprovider contract

`LlmAdapter`がprovider contractです。subclassして`stream()`を実装し、`ctx.llm.registerAdapter(providers, adapter)`で1つのadapter instanceをregisterします。`GenerateOptions.provider`がregistered adapterを選択し、`GenerateOptions.model`はadapterへ渡すだけでlifecycle start時のregisterは必須ではありません。duplicate provider routeはatomicに失敗します。optionalな`providerRetryPolicy()`はnormal default付きでrouteごとにcaptureし、`providerInfo()`とasync `listModels()`はdetached selector metadataを`LlmRuntime.listProviders()`／`listModels()`へ提供します。catalogはrequest whitelistではなくadvisoryです。adapterがauthoritativeで、unlisted model idを受け付けることがあります。asyncな`resolveModel()` queryはexact model identity、optional correctness-sensitive context capacity、adapter-configured `defaultMaxTokens`、ordered model-owned reasoning id、optional deployment defaultを返します。absent fieldはmetadata unavailableまたはprovider-owned behaviorを示し、catalog membershipがinvalidという意味ではありません。resolverはoptional cancellationを受け、abort後すぐsettleしなければなりません。`LlmRuntime.resolveModelInfo()`はaggregateをvalidateしてdetachします。final adapter boundaryの`resolveCallConfig()`は`maxTokens` absent時だけoutput defaultをmaterializeし、reasoningをvalidate／materializeするため、direct callはどちらのconfigured behaviorもbypassできません。direct dispatchはresolutionをawaitする前に1つのregistrationをcaptureします。agent loopは代わりに`prepareCall()`を使い、model resolution、durable header log、dispatch全体で同じregistrationを保持し、exact lookupのdetached context metadataを保持してadapter defaultのfieldを報告します。adapter lookupは`llm/stream` waterfallのterminal continuationで行われるため、listenerはlookup前にcallをshort-circuitしたりmutable one-shot requestをrouteしたりできます。AgentLoopはouter waterfallがstream handleを返した時点でrequest attemptをobserveしますが、この限定されたboundaryはlazy terminal adapterがconstructされたことやprovider I/Oを開始したことを証明しません。`block-start`／`block-end`の`index` correlationとassemblerにより、adapterが必要なのはwell-formed chunkのemitだけで、block reassemblyは各adapterの責務ではありません。[architecture.md](../architecture.md#turn-flow)に1つのturn内で`ctx.llm.stream()`と`llm/stream` waterfallが置かれる場所を示します。

```ts type-equiv
/** One model call whose config and adapter registration were resolved together. */
interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  readonly config: LlmCallConfig
  /** Immutable retry policy captured with the adapter registration. */
  readonly retryPolicy: ResolvedRetryPolicy
  /** Detached context metadata resolved with the registration-bound call. */
  readonly context?: LlmModelContext
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  readonly adapterDefaults: LlmCallConfigAdapterDefaults
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

```ts public-api
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
declare abstract class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>;
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
```

`ContentBlockType`（`index`でcorrelateするblockが運ぶkey set）は上記の[`ContentBlockMap`](#content-blocks-and-messages)から導出されます。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxllm--llmruntime"></a>

### `ctx.llm` — `LlmRuntime`

The abstract `llm` service: an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall.

```ts cordis-catalog
/**
 * Register an adapter for the given provider routes. Throws `LlmError` with code
 * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
 * Disposed with the fiber.
 * @param providers - every provider route this adapter should serve.
 * @param adapter - the adapter that streams calls for those providers.
 * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
 */
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle

/**
 * Describe provider routes with a registered adapter.
 * @returns detached provider metadata in registration order.
 */
listProviders(): LlmProviderInfo[]

/**
 * Declare provider routes an adapter plugin can activate through
 * configuration. Registration is all-or-nothing: an empty list, invalid
 * entry, or a provider already declared by any registration throws
 * `LlmError` without registering the rest. Disposed with the fiber.
 * @param entries - every configurable provider this plugin owns.
 * @returns a handle that withdraws all of them, and can atomically replace them.
 */
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle

/**
 * List every declared configurable provider, registered or dormant.
 * @returns detached directory entries in declaration order.
 */
listConfigurableProviders(): LlmConfigurableProvider[]

/**
 * Offer to interrogate provider endpoints on behalf of the settings
 * namespace this plugin owns. The namespace is the key because that is what
 * a configuration surface already holds from the configurable-provider
 * directory, and because a provider being *added* has no route to name yet.
 * Disposed with the fiber.
 * @param settingsNs - the namespace whose profiles this discovery serves.
 * @param discover - interrogates one endpoint; must honor `request.signal`.
 * @returns the disposer that withdraws the offer.
 */
registerModelDiscovery( settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>, ): () => void

/**
 * Interrogate one provider endpoint for the models it advertises. The
 * request describes a draft, not a stored route, so nothing here reads or
 * writes settings or credentials — the caller owns both, and the reply is
 * candidate metadata a surface may offer for adoption.
 * @param settingsNs - namespace whose registered discovery serves this draft.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @returns the advertised models, deduplicated in endpoint order.
 */
async discoverModels( settingsNs: string, request: LlmModelDiscoveryRequest, ): Promise<LlmDiscoveredModel[]>

/**
 * Resolve the retry policy captured when one provider route was registered.
 * @param provider - registered provider route to inspect.
 * @returns the provider-owned policy, with normal defaults already resolved.
 */
providerRetryPolicy(provider: string): ResolvedRetryPolicy

/**
 * Discover models advertised by one registered provider. Catalog membership
 * is advisory and never changes routing or request validation.
 * @param provider - registered provider route to inspect.
 * @returns detached model metadata in adapter-preferred order.
 */
async listModels(provider: string): Promise<LlmModelInfo[]>

/**
 * Resolve and validate all metadata from the adapter that owns one exact
 * route. The result is detached from adapter-owned objects; catalog
 * membership remains advisory and does not control request routing.
 * @param provider - registered provider route to inspect.
 * @param model - exact model id passed to the adapter.
 * @param signal - optional cancellation for adapter-owned asynchronous lookup.
 * @returns exact model identity plus available context and reasoning metadata.
 */
async resolveModelInfo( provider: string, model: string, signal?: AbortSignal, ): Promise<LlmResolvedModelInfo>

/**
 * Validate a conversation call config against its exact model capability and
 * materialize adapter-configured defaults. Unsupported explicit efforts
 * reject before provider I/O; no clamping or aliasing is performed. This
 * standalone query does not bind a later dispatch; use {@link prepareCall}
 * when logging and streaming must share one adapter registration.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a detached config only when a default must be materialized.
 */
async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>

/**
 * Resolve one call under its current adapter registration. The returned
 * one-shot handle keeps that registration across header logging and dispatch,
 * so HMR cannot combine one adapter's capability result with another adapter.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a prepared config and its registration-bound stream entry point.
 */
async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>

/**
 * Stream one model call as raw chunks (token-level deltas). Replay state is
 * retained only when the same adapter instance owns its historical provider
 * and the target provider. Final adapter selection remains fixed through
 * asynchronous exact-model resolution and dispatch. Adapter selection,
 * dispatch, and iteration failures become terminal `error` or `aborted`
 * finish chunks; middleware, nested-call, cleanup, and consumer failures
 * remain thrown.
 * @param options - the full request; `options.provider` selects the adapter.
 * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
 */
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

Source: [`packages/llm/llm/src/index.ts:284`](../../packages/llm/llm/src/index.ts)

<a id="llm-events"></a>

### `llm/*` events

<a id="llmadapters-updated--emit"></a>

#### `llm/adapters-updated` — emit

The provider topology changed: an adapter registered or unregistered routes, or the configurable-provider directory gained or lost entries. This payload-free registry notification fires at each commit point (including registration disposal); consumers re-read `listProviders()`, `listModels()`, or `listConfigurableProviders()` for the new state. Observer failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * The provider topology changed: an adapter registered or unregistered
 * routes, or the configurable-provider directory gained or lost entries.
 * This payload-free registry notification fires at each commit point
 * (including registration disposal); consumers re-read `listProviders()`,
 * `listModels()`, or `listConfigurableProviders()` for the new state.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'llm/adapters-updated'(): void
```

Source: [`packages/llm/llm/src/types.ts:23`](../../packages/llm/llm/src/types.ts)

<a id="llmstream--waterfall"></a>

#### `llm/stream` — waterfall

Waterfall around every streaming model call (retry, replay, routing). Bound to the LlmRuntime; call `next()` to reach the resolved adapter's stream, or yield your own chunks to short-circuit.

```ts cordis-catalog
/**
 * Waterfall around every streaming model call (retry, replay, routing).
 * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
 * adapter's stream, or yield your own chunks to short-circuit.
 * @param options - the full request. A LOOP-built request carries the
 *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
 *   (mutation throws): its content is a pure function of the session log (the
 *   reconstructability Agent Note), so listeners read it, never rewrite it.
 *   Hand-built calls do not carry that marker; their messages already obey
 *   the immutable creation contract.
 * @mode waterfall
 */
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

Source: [`packages/llm/llm/src/index.ts:64`](../../packages/llm/llm/src/index.ts)
<!-- END GENERATED cordis-surface -->
