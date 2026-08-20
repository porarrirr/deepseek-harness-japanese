# Workflow

[English](workflow.md) | [中文](workflow.zh.md) | 日本語

workflow seamはagentがmodel作成のorchestration SCRIPTを実行し、subagentを開始できるようにします。[subagent](subagent.md)と同様に**1つの任意capability**でagent loopの一部ではないため、型とoperationは[core.md](core.md)ではなくここにあります。bashと同様に、1つのcontextにつきONE engine implementationが`ctx.workflowEngine`を提供します。named-provider registryはなく、2つ目のengineは横に並んで実行されず、plugin configを通じて1つ目を置き換えます。

Service Definitionは[dsh-workflow](../../packages/workflow/workflow)（`ctx.workflowEngine`と以下の語彙）です。Service Providerは[dsh-workflow-worker-thread](../../packages/workflow/workflow-worker-thread)（`node:worker_threads` engineで、runごとにworkerを1つ、内部にscriptのvm context）であり、model向けConsumerは[dsh-tool-workflow](../../packages/workflow/tool-workflow)です。提案と理由は[dynamic-workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)にあります。

Sources: browser-safe vocabulary in [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts), Host request and live-run handles in [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts).

## Start request

runを開始するときにcallerが要求する内容です。通常のworkflow toolはmodelの`{ script, meta, args }` callとcalling agentから構築します。specialized consumerはrun向けにengine-wideな`subagentProvider`を1つ選び、`maxTotalAgents`を下げることもできますが、scriptはどちらのpolicyも観測・置換できません。`meta`と`args`はplain JSON DATAです（engineが`meta`をschemaに対して検証し、何も実行する前に明確に拒否します。取得のためにscript textを評価することはありません）。`parent`はREQUIREDです。scriptが開始するすべてのchildがこれに帰属し、cwd、lineage、depthは[subagent seam](subagent.md)を通ります。

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## Workflowの識別情報：`WorkflowMeta`

start requestがdataとして運ぶidentity blockです（toolの`meta` parameter。field vocabularyはClaude Code dynamic-workflows meta blockと一致します）。`phases`はprogress vocabularyだけです。`phase()` callはobserver向けにtitleを対応付けますが、execution structureを意味しません。

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## Terminal result：`WorkflowResult`

`WorkflowRun.result`が解決する1つのrunのoutcomeです。`value`はscriptのmaterialized return value（plain host-realm JSON dataで、scriptが何も返さなければ`null`）で、`completed`の場合だけ意味を持ちます。`stopReason`はCLOSED union（engine所有でconsumerは網羅できます）で、`completed` | `cancelled` | `error`です。`completed`以外のreasonはfailureを`error`に持ち、consumerはpartial outputを成功として報告せず`isError` tool resultに対応付けます。

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## Live run：`WorkflowRun`

script実行中にconsumerが保持するhandleです。consumerは`result`をawaitし、実行中に`cancel`でき、すべてのpathでMUST `dispose`します。`result`はrejectしません。script failureは`stopReason: 'error'`でresolveします。runがcancelされると、script自身がsettleしなくてもengineのbounded grace内にSETTLEします（engineが`cancelled`でforce-settleし、worker-thread engineはscriptのworkerをterminateします）。そのため`result`をawaitするconsumerがcancel後に詰まることはありません。`dispose()`はcancel＋bounded settle＋child quiescenceであり、stuck scriptでhangしません。

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
```

## Failure discipline：`WorkflowError.fatal`

script内でのhook misuse（不正なargument、未知またはdeferredな`agent()` option、[structured-output subset](../../packages/core/tools/README.md)外のschema、上限超過、seam start failure、cancel）は`fatal: true`の`WorkflowError`をthrowします。`parallel()`／`pipeline()` combinatorはfatal errorをitemから`null`に変換せずRE-THROWします。typoのあるoptionはscriptを明確に終了させる必要があり、通常のchild failureに見えるものへ溶かしてはいけません。itemごとの`null`はchild-run failure（`completed`以外のstop reason）とstage内の通常のscript errorに予約されています。

## Event

`workflow/*` event（`workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`、`workflow/end`。[events catalog](#cordis-surface)を参照）は**observe-only** emitで、DATA SNAPSHOTを運びます。各payloadは`WorkflowRunInfo`（id＋meta）から始まり、live `WorkflowRun`は持ちません。そのためsubscriberは`cancel`／`dispose`を取得できません。`workflow/end`は意図的にresult valueを省略します（outcomeを観測するlistenerにcallerのresultのmutable aliasを渡してはいけません）。各emitはlistenerごとに封じ込められ、throwするsubscriberはlogされるだけで伝播せず、後から登録されたlistenerをstarveさせません。各listenerはpayloadの独自cloneを受け取るため、変更してもengineや他listenerを壊しません。この封じ込めは`subagent/start`／`subagent/end`と同じです。

## 永続Chat record

top-levelの`dsh-tool-workflow` consumerはexecution ownershipを変えず、display factをcalling parent Sessionにprojectionします。runが受理された後に`tool-workflow/run-start`を書き、`runId + seq`でmember startとendを対応付け、resultが判明しdisposeがquiescenceに到達した後だけ`tool-workflow/run-end`を書きます。nested transport callはrecordを書きません。最初のappend failureはそのrunの後続writeを無効にするため、logは空か合法的なcontinuous prefixのままで、tool resultは変わりません。

`dsh-tool-workflow/invariant`はlive commit前とSession load時に同じprotocolを検証します。runごとにstartが1つ、member sequenceは正で一意、member endが対応し、open memberのあるrun endがなく、run end後にupdateがないことを確認します。member endの欠落やlog tailでのrun endはcorruptionではなく、正当なinterruption evidenceです。

`dsh-client-ui-workflow-run`は4つのeventをConversation Node engineでfoldし、元のworkflow tool nodeの後に、run-start sequenceをanchorとする1つの`workflow-run` Chat nodeを作ります。phase groupは実際のmember startだけから作り、phase省略と`''`の違いを含めて正確な文字列を保持します。Closed Locationsはterminal factの欠落をinterrupted presentationに変換します。disclosure、status、same-parent local navigationの動作は[UI package README](../../packages/client/ui-workflow-run/README.md)が管理します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, cancellation and disposal are bounded, and disposal waits for child cleanup within that bound. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts:157`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path (a worker killed past its grace) the end is engine-synthesized with outcome `'cancelled'`.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path (a worker killed past its grace) the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:79`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:68`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:89`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted a narration line (a `log(message)` call).

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/index.ts:58`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/index.ts:51`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts:43`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
