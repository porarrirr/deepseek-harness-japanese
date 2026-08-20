# Core

[English](core.md) | [中文](core.zh.md) | 日本語

**core**サブシステムは[`packages/core`](../../packages/core/README.md)です。すべてのcompositionが起動するパッケージ群、すなわちイベントソース型session log、system-prompt assembly、tool registry、agent type、これらを駆動する具体的なloopを含みます。このページでは`agent`／`agent-loop`の組が宣言する内容（agentの作成と所有、`Agent` handleの配送・キャンセル・インターセプトの約束）と、すべてのサブシステムが従う2つの型パターンを説明します。グループ固有のページとフォルダー内の他のページは[subsystems README](README.md)に掲載されています。

## Spine：パッケージごと

1つのturnは、1つのloopで6つのパッケージを通過します。[`agent-loop`](../../packages/core/agent-loop)のdriverがキュー済みpromptをclaimし、[session log](session.md)（`ctx.sessions`）でturnを開始し、[system-prompt](system-prompt.md)（`ctx.systemPrompt`）を通じてrequest prefixを組み立て、logからhistoryを導出します。続いて[LLM seam](llm-streaming.md)を通じてmodel responseをstreamし、[tool registry](tools.md)（`ctx.tools`）を通じてtool callをdispatchし、次のstepが導出する前にmodelから見える事実をすべてlogへappendします。loopが扱う会話語彙（`Message`、`ContentBlock`、`StreamChunk`、model request）は[`packages/llm`](../../packages/llm/README.md)が宣言し、[llm-streaming.md](llm-streaming.md)に記載しています。

| パッケージ | 所有するもの | ページ |
|---|---|---|
| `session/` | append-onlyの`SessionEvent` logとin-memory store（single source of truth、`ctx.sessions`） | [session.md](session.md) |
| `system-prompt/` | prompt sectionとtool schemaのassembly（`ctx.systemPrompt`） | [system-prompt.md](system-prompt.md) |
| `tools/` | スコープ付きtool registryと保護された実行pipeline（`ctx.tools`） | [tools.md](tools.md) |
| `agent/` | `Agent` interface、live registry、initiator scope、`agent/*` event vocabulary（`ctx.agents`） | このページ |
| `agent-loop/` | 公開`Agent`の約束を実装する具体的なdriver（`ctx.agentLoop`） | このページ |
| `scope/` | registryとloopがagentごとのスコープを構築する基礎となるスコープ付き登録primitive | [scope.md](scope.md) |

`scope/`は唯一のnon-service packageです。依存関係のないlibrary（`createScope`／`scopeOf`／`scopeTarget`）で、module graph上では`session/`と`system-prompt/`より下に置かれ、これらが循環なしに利用できます。`agent-loop`は公開`Agent`の約束を実装する唯一の具体的な実装であり、harnessのdefault product loopであるためここにあります。各driverを`ctx.agents.withInitiator()`内で実行します。extension pluginはinitiating Agentが必要な場合も含めて`agent`に依存し、`agent-loop`には直接依存しません。そのためloopを差し替えられます。このspineを実行可能なagentに接続するdefault compositionは[`examples/agent-spine-demo`](../../packages/examples/agent-spine-demo/README.md)です。

## 作成と所有

consumerは`ctx.agents`を通じてagentを作成します。`create()`は呼び出し側が指定した1つの`SessionId`の下で新しいsessionとagentを作り、`resume()`は先に永続sessionを読み込みます。またはloopのconfig entryを通じて宣言的に作成します。プログラムによる作成はownerのhandleを返します。

Source: [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions`は共有識別情報と、fresh agentを公開前に必要とするすべてを持ちます。session metadata（`meta`、検証済み`cwd`、fork lineage、seed boundary、origin classification、delegation depth）、fork用の任意の`seed` replay prefix、agentごとの`AgentOptions`、作成時だけのcancel `signal`、`setup`です。`ResumeAgentOptions`は永続識別情報に対応する型で、`resumeSessionId`、`agentOptions`、`signal`、`setup`を持ちます。`setup` callback（`AgentSetup`）は2つのidがまだ公開されていない間にagentのscoped worldをcomposeします。`agentCtx`を通じて登録されたものは`agent/created`と最初のprompt assemblyより前に存在します。さらに公開直前に呼び出す同期commitを返せます。setupのreject、commitのthrow、ownerのdisposeは、どちらのidも公開せずtransactionをrollbackします。

`AgentFactory`はregistryの背後にある作成interfaceです。loopは`ctx.agents.setFactory()`でfactoryを登録するため、consumerは具体的なloop packageに依存せず`ctx.agents`を使えます。正確な`create`／`resume` signatureとrollbackの約束は、以下の[generated section](#ctxagents--agentregistry)にあります。

## Agent handle

`Agent`はすべてのplugin（UI、hook、orchestrator）が利用するsurfaceです。`ctx.agents.get(id)`が返し、[initiator scope](#initiating-agent)が運びます。具体的な実装はdsh-agent-loopのpackage-internalで、loop外は依存しません。統合された`send` methodはtargetとwakeup routingを直接公開し、`followup`、`steer`、`inject`は固定presetのaliasです。

Source: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle. */
interface Agent {
  /** The single identity shared with {@link session}. */
  readonly id: SessionId
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

`running`はdriver全体のdrain intervalを示し、連続するqueued turnにまたがることがあります。turnがまだopenであることは示しません。disposeはagentをregistryから削除して`agent/disposed`を発行しますが、terminal status valueではありません。`followup()`はhandleを返しません。その`MessageId`が識別するのは永続inboxへの挿入、claim、discardの事実であり、後続assistant outputやturnの終了ではありません。`whenIdle()`はagent全体を監視するため、呼び出し側がその区間を明示的に所有する場合に限り、receiptからidleまでの区間をrunと呼べます（[decision](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
```

dispatchでは`agent/request`後に`provider`と`model`が必要です。`maxTokens`が指定される場合は正のsafe integerでなければならず、すべてのconversation-model requestに上限を設定します。省略するとexact-model adapter defaultがrequest headerの前に具体化され、そうでなければproviderの動作は変わりません。agent-scopedな`deployment:persona` prompt sectionはglobal default personaをshadowできます。

inboxは配送の語彙です。agentが永続projectionとして所有する、順序付きのpending-message listが2つあります。

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

すべてのpending occurrenceは`UserMessage`であり、`MessageId`が唯一の識別情報です。`Inbox.append`、`prepend`、`replace`、`remove`、`clear`、`splice`、`claim`は正規化された永続`agent/inbox/spliced`変更を記録し、重複pending idを拒否します。`replace(messageId, newMessage)`と`remove(messageId)`は2つのlistをまたいでpending messageを探します。replacementは識別情報を変更でき、古いmessageをdiscardedとして発行した後、新しいmessageをinsertedとして発行します。通常のremoveと`clear()`はcancelです。`claim(target)`は、提案されたstep batch（すべての`next-step` inputと、turn boundaryでは1つの`next-turn` message）を、discarded notificationなしの純粋な削除spliceで取り除きます。loopはmessageごとのclaimed notificationを別に発行します。UI projectionなどのqueue全体consumerは永続spliceから`nextTurn`と`nextStep`を再構築し、1つのmessageを追跡するconsumerは正確な`agent/inbox/inserted`、`claimed`、`discarded` notificationを使います。

キャンセル：

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

causeはTypeScriptが強制する同一プロセス入力です。active cancellation holderはそれをruntime-onlyの`AbortSignal.reason`にコピーしますが、signalが協調するlistenerに分類権限を与えることはありません。永続`turn/end`は粗い`{ kind: 'aborted' }` outcomeを保持します。誰がcancelを要求したかを記録するにはterminal resultを過積載せず、別の永続eventが必要です。

`agent/*`のライフサイクル、checkpoint、waterfallの約束は[event taxonomy](../architecture.md#events)が管理します。turnとstepの境界はagent emitではなく永続session eventです。

## Initiating Agent

`ctx.agents`が運ぶプロセスローカルinitiatorは、別のframeやコピーされた識別情報ではなく、前述の正確な`Agent`です。ambientな存在はliveである証拠でも認可でもありません。ライフタイムとscope ruleは[initiator-scope decision](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)が定義します。

## インターセプト判断

pre-stepの判断は、永続user-role inputと同じ識別済み`UserMessage` typeを使います。入力されたbatchが権威であり、各messageの`id`と`source`を保持します。hook bridgeはnativeの判断fieldをこのtyped resultに対応付けます。

Source: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step`は、排他的にclaimしたbatch（`messages`）、提案されたstepの座標（`turn`、`step`）、現在のturnのcancel `signal`を持つ1つのpayloadを受け取ります。初回提案はstep前のopen turn内で実行され、tool continuationはstep間に空のclaimed batchを送ることがあります。

`PreStepDecision`を返します。Rejectではstepを開始しません。Enterは`step/start`後にappendする完全なmessage batchを提供します。最終判断で省略されたclaimed messageは削除されたままで、claim後にinsertされたinputはpendingのままです。

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

`agent/request-error`は失敗したmodel stepがcloseした後、そのturnがcloseする前に実行されます。listenerは失敗したturnのsignalがliveな間に永続stateを修復するか、policy workを待てます。処理を所有するlistenerは`next()`を呼ばずに`{ kind: 'retry' }`を返し、defaultの`undefined`はfailureをterminalのままにします。

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step`はrequest derivation前にある唯一のserial listener chainです。`agent/turn-stopping`はturnにtoolまたはsteering continuationがない場合、最後のsteering drainの前に実行されます。

`agent/session-start`は`SessionStartSource`を持ちます（session lifecycleが開始した理由。bridgeはこれをSessionStart matcherのkeyにします）。

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## Session

`Session`はtyped `SessionEvent`の**append-only log**であり、single source of truthです。LLM message historyは別に保存せず、logから`deriveMessages()`で*導出*します。各entryはmonotonicな`seq`、`time`、`type`で判別される`data` payloadを持ちます。surface variantは、引用した過去eventを`sourceEventSeqs`に列挙し、`surfaceOp`を持つこともあります。

`SessionEvent` envelopeの正確なconditional field、12個のevent variant（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`steering/message`、`todo/write`、`request/header`）、`deriveMessages()`のprojection rule、`TurnTrigger`／`TurnEndReason`の理由、execution enclosureとstandalone eventの規則は**[session.md](session.md)**にあります。logを永続化する方法（`SessionPersistence` interface、JSONL／SQLite backend、`session/flush` checkpoint、crash recovery、`SessionHeader`）は**[persistence.md](persistence.md)**にあります。

## `ToolDefinition`

coreにあるpipeline authoring typeは1つです。登録されたtoolが*何であるか*を表し、model向け`ToolSchema`、`execute` function、任意のfinal-contentおよびUI callbackを持ちます。tool authorが手作業で構築することはほとんどありません（`defineTool` DSLがtyped argument付きで構築します）が、registryが保持しloopがdispatchする約束です。

全field、`defineTool`／`ValueSchemaSpec`／`ParameterSchemaSpec` typed schema DSL、`ToolExecution`／`ToolExecutionResult` waterfall type、tool presentation UI typeは**[tools.md](tools.md)**にあります。

## リポジトリ全体の型パターン

すべてのサブシステムで繰り返し現れる2つのパターンを、ここで一度だけ説明します。

<a id="the-map--derived-union-pattern"></a>

### `…Map → derived-union`パターン

このharnessのほぼすべての拡張可能なsum typeは、1つのパターンに従います。discriminant tag（`…Map`）をkeyにしたinterfaceから、`keyof`でunionを導出します。pluginは**declaration merging**でvariantを追加し、owner packageを編集しません。

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

6つのcanonical mapがこのパターンを使い、plugin authorはこれらを拡張します。

| Map | パッケージ | 導出する型 | カタログ |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.md#the-model-request-and-result) |
| `TurnTriggerMap` | dsh-session | `TurnTrigger` | [session.md](session.md) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.md) |

consumerが最も頻繁に`switch`する大きなdiscriminated unionは、**`StreamChunk`**（streaming protocol）と**`SessionEvent`**（log entry）です。リポジトリの規約に従い、`if`を連ねずtagで`switch`してください。各armがnarrowされ、tagのタイプミスはcompile errorになります。

### Branded ID

パッケージ間で渡すIDは**branded**です。構造上はstringですが、型レベルでは交換できません（`CallId`が必要な場所に`SessionId`は渡せません）。構築は型ごとのfactoryを通り、比較、logging、JSONでは通常のstringとして動作します。

`Branded<B>` primitiveは型専用の独立したパッケージ[dsh-brand](../../packages/util/brand)にあります（runtime codeなし、harness packageへの依存なし）。そのため、どのパッケージも関係のないcapability packageに依存せず、自身が所有するidをbrandできます。

Source: [`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

2つのcore IDは`CallId`（tool callとそのresultを対応付ける。dsh-llm）と`SessionId`（live agentとdurable sessionが共有するidentity。dsh-session）です。capability packageも自身のidをbrandします。例えば[jobs.md](jobs.md)の`JobId`です。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Owns the default model selection independently of any Host or transport. The composition entry remains usable without a settings provider; when one is mounted, its user layer is read live.

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a settings
 * provider keeps its composition entry.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional settings write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

Source: [`packages/core/agent-default-model/src/index.ts:64`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

Concrete agent factory and driver service.

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

Types: [SessionHeader](persistence.md)

Source: [`packages/core/agent-loop/src/index.ts:296`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresets"></a>

### `ctx.agentPresets` — `AgentPresets`

Registry over the deployment's agent presets.

Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every call so a preset authored while the process runs is visible immediately, and a preset deleted underneath a picker disappears from the next read.

```ts cordis-catalog
/**
 * Every preset the configured roots currently supply.
 * @returns the presets, first-root-wins per id.
 */
async list(): Promise<AgentPreset[]>

/**
 * Resolve one preset by id.
 *
 * A broken preset resolves — deleting one, reading one, and reporting one
 * all need the row — and the mounting paths refuse it AFTER resolution
 * through {@link resolveMountable}.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the resolved preset.
 * @throws when no configured root supplies that id.
 */
async resolve(id?: string): Promise<AgentPreset>

/**
 * Compose one agent from a preset: ensure the preset's standing mount, then
 * parent the agent's scope key to it so the mount's registrations and
 * listeners cover this agent.
 *
 * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
 * the agent creation back, so a broken preset never yields a half-composed
 * session.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the preset that was composed, for the caller to record.
 * @throws when the preset is unknown or its composition is unusable.
 */
async mount(agentCtx: Context, id?: string): Promise<AgentPreset>

/**
 * Join one agent to the SAME standing composition another already runs on.
 *
 * This is how a child agent inherits its parent's capabilities. It is a bind,
 * not a mount: the parent's generation is already composed, so the child gets
 * that exact instance — the same plugin objects, the same tool registrations,
 * the same prompt sections. Re-resolving the parent's preset by id instead
 * would re-read the roster, and a composition file edited since the parent
 * started would hand the child a DIFFERENT generation than the one its
 * parent's history was produced under (and a preset deleted since would fail
 * the child outright while its parent keeps running).
 *
 * Synchronous, and with no composition failure mode of its own — it reads no
 * roster, mounts nothing, and touches no file — which is what lets a child
 * creation window use it: the two in-process subagent drivers compose their
 * children inside a synchronous `setup`. It still rejects a caller error, as
 * the `@throws` below record.
 *
 * A parent that joined no preset — a rosterless deployment — yields no join
 * and no error: there, the model-facing rows sit in the host composition and
 * the child already sees them through the global layer.
 * @param agentCtx - the joining agent's scope context.
 * @param parentCtx - the scope context of the agent whose composition to join.
 * @returns the preset id joined, or undefined when the parent joined none.
 * @throws when `agentCtx` carries no scope, or has already joined a preset.
 */
composeFrom(agentCtx: Context, parentCtx: Context): string | undefined

/**
 * The preset one live agent runs on.
 *
 * Read from the live scope chain rather than from the session, so it answers
 * for an agent whose session has not recorded a preset yet — a child agent
 * whose durable header is being built from its parent's composition.
 * @param agentCtx - the agent's scope context.
 * @returns the preset id, or undefined when the agent joined none.
 */
composedPreset(agentCtx: Context): string | undefined

/**
 * Read one preset's composition text.
 * @param id - the preset id.
 * @returns the composition exactly as stored.
 * @throws when no configured root supplies that id.
 */
async read(id: string): Promise<string>

/**
 * Create a locally authored preset by copying an existing one whole.
 *
 * Copy is the only authoring write. Composition text never crosses this
 * seam: the source is named by id and its directory is copied as it stands,
 * so the copy is exactly as loadable as its source and authoring grants no
 * capability the roster did not already carry. The copy is NOT mounted to
 * validate — a source that mounts today yields a copy that mounts today.
 * @param from - the preset the copy starts from; shipped presets are the
 * primary source, so any trust is accepted.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; absent falls back to the id.
 * @throws when the source is unknown, the id is unusable or already taken,
 * or the deployment configures no writable root.
 */
async copy(from: string, id: string, name?: string): Promise<void>

/**
 * Delete a locally authored preset.
 * @param id - the preset id.
 * @throws when the preset is unknown or ships with the deployment.
 */
async remove(id: string): Promise<void>

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes services behind `isolate` realms, which are invisible
 * outside the group that declares them — including to the host. This is how a
 * caller holding the agent reads one anyway: a request that is ABOUT a
 * session but arrives from outside it, which is every browser RPC.
 *
 * Read addressing only. A host row that `inject`s a service cannot use this,
 * because injection resolves before any session exists and has no agent to
 * key by; such a service belongs on the host plane instead.
 * @param agent - the agent whose composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/**
 * Re-link one agent to a different preset's standing composition.
 *
 * Only valid while the agent has produced nothing: swapping tools mid
 * conversation would leave logged tool calls the new composition cannot
 * make. The CALLER owns that check — this method does not read session
 * history.
 *
 * The swap is a parent re-link, not an unmount: standing mounts are shared
 * and permanent, so the old composition stays for its other agents and the
 * new one is ensured BEFORE the link moves. An unknown or unusable preset
 * therefore throws with the agent exactly as it was — there is no torn-down
 * state to restore. The re-link runs through the binding this roster kept
 * from the agent's mount — dsh-scope's only re-link authority. An agent
 * that never composed one has nothing to re-link: the switch is then the
 * agent's first bind, exactly a mount.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset to compose the agent from instead.
 * @returns the preset now installed.
 * @throws when the preset is unknown or its composition is unusable.
 */
async recompose(agentCtx: Context, id: string): Promise<AgentPreset>

/**
 * The standing scope key of one preset, for a host reader with no agent.
 *
 * A cold transcript read resolves tool presenters against the composition
 * the session recorded, and the standing mount makes that possible without
 * resuming anything: ensuring the mount composes plugins but starts no
 * agent, no session, and no turn.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the standing scope key readers pass as a registry view scope.
 * @throws when the preset is unknown or its composition is unusable.
 */
async standingKeyFor(id?: string): Promise<ScopeKey>
```

Types: [ScopeKey](scope.md)

Source: [`packages/preset/agent-presets/src/index.ts:82`](../../packages/preset/agent-presets/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory.

Initiator methods provide same-process causal attribution only. Ambient presence is neither liveness proof nor authorization; subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries. Returned Promise boundaries drain during teardown, except a nested lineage that starts an owning-fiber unload is excluded from its own drain.

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while `agentCtx.agent` identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, configuration, and optional setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent. Throws if an agent with the same id is already
 * registered. Emits `agent/created` on registration and `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). Returns the disposer.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): () => void

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - live agent whose scoped context created this agent, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   synchronous `agent/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
announce(agent: Agent): void

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

Source: [`packages/core/agent/src/index.ts:256`](../../packages/core/agent/src/index.ts)

<a id="agent-events"></a>

### `agent/*` events

<a id="agentcreated--emit"></a>

#### `agent/created` — emit

A fully configured agent and live session were published. Setup is composition-only; `agent/session-start` is the first startup-driving extension point. Synchronous listener failure vetoes publication, while returned-promise rejection is reported. Detach requested during dispatch waits until every creation listener has observed the stable entry.

```ts cordis-catalog
/**
 * A fully configured agent and live session were published. Setup is
 * composition-only; `agent/session-start` is the first startup-driving extension point.
 * Synchronous listener failure vetoes publication, while returned-promise
 * rejection is reported. Detach requested during dispatch waits until every
 * creation listener has observed the stable entry.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:159`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — emit

An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment. Custom registry users own their driver-ordering contract.

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:168`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — emit

A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record.

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:290`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — emit

One message left the inbox inside its open turn. If the proposed step is rejected, the claimed message ends here: it is neither discarded nor re-emitted as a user/message, and the turn closes without a step.

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:197`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — emit

One message was discarded from the live inbox.

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:205`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — emit

One message entered the live inbox.

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:186`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — waterfall

Reject a proposed step or replace the messages that enter it. Calling `next()` preserves the current messages.

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts:231`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — waterfall

Replace the frozen call configuration. `await next()` yields the config the machine would use (agent options on the first request, the logged header afterwards); return a replacement to switch. Model-visible content must use logged channels; this waterfall cannot mutate messages.

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. Model-visible
 * content must use logged channels; this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

Types: [LlmCallConfig](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:244`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — waterfall

Handle one failed model-request attempt before the loop retries or closes its step. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery, or calls `next()` to delegate. The default `undefined` leaves the failure terminal.

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

Types: [LlmFailure](llm-streaming.md) · [ResolvedRetryPolicy](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:260`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentsession-start--emit"></a>

#### `agent/session-start` — emit

The session lifecycle began, once before the first turn. Use `agent.inject()` to seed model-facing context. This is a notification, not a veto; disposal requested by a lifecycle owner is rechecked before the driver starts.

```ts cordis-catalog
/**
 * The session lifecycle began, once before the first turn. Use
 * `agent.inject()` to seed model-facing context. This is a notification, not
 * a veto; disposal requested by a lifecycle owner is rechecked before the
 * driver starts.
 * @param payload.agent - the agent whose session lifecycle began.
 * @param payload.source - why the session started (fresh startup, resume, …).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:217`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — emit

Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously after reserving cancellation; `idle` means no driver remains scheduled or active.

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:178`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — serial

The turn is about to close: the model owes no response (no live tool calls, no fresh steering). Awaited before the boundary commits — a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. Data decides, so listener order cannot change the outcome. The inverse control (stop a tool loop early) is data too: a tool result carrying `concludesTurn` ends the turn at its step. The conclusion never short-circuits already-submitted next-step work: same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts:278`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` events

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — emit

A declarative agent entry failed before it could publish a live agent. Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever. Normal factory teardown suppresses failures from the cancelled startup attempt.

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

Source: [`packages/core/agent-loop/src/index.ts:183`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` events

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — emit

One session committed a different agent preset to its durable log. Consumers invalidate only state derived from that session's composition.

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

Source: [`packages/preset/agent-presets/src/types.ts:13`](../../packages/preset/agent-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
