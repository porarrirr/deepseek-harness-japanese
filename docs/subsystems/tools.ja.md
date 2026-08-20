# Tools

[English](tools.md) | [中文](tools.zh.md) | 日本語

[dsh-tools](../../packages/core/tools)のtool pipelineです。[core.md](core.md)はcore packageが共有するpipeline-authoring typeとして`ToolDefinition`を導入し、model向けの[`ToolSchema`](llm-streaming.md#the-model-request-and-result) wire typeはmodel requestとともに宣言します。このページでは`ToolDefinition`の全field、それを構築するtyped schema DSL、guard付きexecution type、UI presentation typeを説明します。

Source: [`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts) · [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts) · [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)

## `ToolDefinition` — registered tool

model向けfieldである`ToolSchema`に、mandatory canonical output declaration、`execute` function、host-only scheduler metadata、optional final-content callback、optional UI presenterを加えたものです。registryがこれらを保持し、loopがcallをdispatchします。registryの`schemas()`はexplicit allowlistでmodel向け`ToolSchema[]`を構築します。`output`／`execute`／`finalizeContent`／`timeoutMs`／`isConcurrencySafe`／`presentCall`／`presentResult`はmodel requestへ漏れてはいけません。

```ts type-equiv
/** Tool-owned canonical output contract used after the body returns a JSON value. */
interface ToolOutputDefinition {
  /** Raw supported JSON Schema enforced against every successful canonical value. */
  readonly schema: JsonSchemaNode
  /** Pure projection from validated arguments and value to Native/model content. */
  render(args: unknown, value: JsonValue): ContentBlock[]
  /** Pure replayable presentation projection, computed only for top-level calls. */
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

```ts type-equiv
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /**
   * Run one accepted call and return only its canonical lossless-JSON value.
   * Async work must observe or forward `exec.signal` and settle only after its
   * owned work reaches quiescence. The registry preserves caller cancellation
   * through around-dispatch signal replacement and does not abandon this
   * promise, but it cannot hard-kill same-process code.
   * @param args - losslessly snapshotted, frozen model arguments.
   * @param exec - execution identity, cancellation signal, and context deferral.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /**
   * Synchronous last-mile transform for model-facing content. The registry
   * snapshots this callback when execution starts and invokes it exactly once
   * for every normalized outcome, including pipeline failures that bypass
   * `tools/post-execute`, immediately before lossless materialization.
   * Returning `undefined` preserves the content; every other result field
   * remains registry-owned. The callback must be total and must not throw.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  /**
   * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
   * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
   * is NEVER sent to the model — `schemas()` whitelists only name/description/
   * parameters. Declaring it asserts this tool forwards `exec.signal` to a
   * cooperative implementation that can reach quiescence when the signal aborts.
   */
  timeoutMs?: number
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; omission, exceptions, non-`true` returns, and invalid
   * `defineTool` arguments are exclusive. This metadata is never model-visible.
   *
   * Opted-in executions must not mutate parent-owned state. Shared state must
   * tolerate concurrent dispatch; recorder races are permitted only when they
   * commute or fail closed. See the
   * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
   * for the full contract.
   * @param args - parsed arguments; `defineTool` validates before calling.
   * @returns Whether this call may join a parallel group.
   */
  isConcurrencySafe?(args: unknown): boolean
  /**
   * Optional: how to present the PENDING state of one call in a UI, derived from
   * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
   * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
   * or `undefined` (or omit the method) to fall back to a generic presentation
   * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
   * call it during live streaming AND a session-log replay, so it must depend
   * only on `args`.
   */
  presentCall?(args: unknown): ToolCallView | undefined
  /**
   * Optional: how to present the COMPLETED state, given the same `args` and the
   * durable result projection (`content`, failure state, and optional `meta`). Returns a
   * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
   * pending title and render the raw result content. Pure and side-effect-free
   * for the same replay reason.
   */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

`execute`は`args: unknown`を受け取ります。raw `ToolDefinition`が自身のinputをvalidateします。first-party toolはこれを手書きせず`defineTool`を使い、argumentをvalidateしてnarrowし、`output.schema`からbody returnを推論し、2つのoutput projectorをtypeします。`finalizeContent`がtyped argumentではなくimmutable executionを受け取るのは、invalid-inputとouter pipeline failureも到達するためです。`isError`、canonical value、structured error identity、deferred context、presentation metadataを保持しながらtool-owned content boundを強制できます。

## Unified JSON-value schema DSL

plugin authorはtyped parameterとtyped output valueに1つのvocabularyを使います。`ValueSchemaSpec`は`string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、author-only `json`、exact-one `oneOf`をサポートします。scalarの`enum`と`const` valueはnode typeと一致しなければなりません。explicit object nodeは常に`additionalProperties: true | false`を宣言します。parameter definitionはimplicit open object property mapのままで、required propertyごとに`required: true`を付けます。

Source: [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts)

```ts type-equiv
/** One author-facing schema for any lossless JSON value root. */
type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec
```

```ts type-equiv
/** One implicit parameter-root property, optionally required. */
type ParameterPropertySpec = ValueSchemaSpec & { required?: true }
```

```ts type-equiv
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}
```

`{ type: 'json' }`は`JsonValue`を推論し、annotation-onlyのunconstrained raw schemaへcompileします。output rootはobject、array、scalar、nullのいずれでも構いません。`InferValue<S>`は16 container levelまでliteral constraintとobject opennessを尊重し、それ以降はTypeScriptのtype-instantiation stackを使い切らず`JsonValue`へfallbackします。`InferArgs<P>`はpropertyごとのrequirednessをrequired／optionalなstring keyへ変換します。

```ts type-equiv
/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
type InferValue<S> = InferValueAt<S, []>
```

```ts type-equiv
/** Infer the TypeScript argument object for an implicit parameter schema. */
type InferArgs<S> = InferProperties<S, []>
```

`defineTool({ name, description, parameters, output, execute, … })`はparameter inferenceを`parameterSchemaSpecToJsonSchema()`と`validateArgs()`に結び付け、`execute`／`render`／`presentationMeta`を`InferValue<OutputSchema>`に結び付けます。schema recordはown enumerable string keyだけを持ち、schema arrayはdense intrinsic arrayなので、inference、compile、validationが同じdeclarationを観測します。inferenceは16 container levelまでexactで、その後`JsonValue`へwidenします。runtime validationはcomplete schemaをwalkし続けます。`valueSchemaSpecToJsonSchema()`は同じenforced raw subsetでoutput declarationをcompileします。parameter mismatchは`ToolArgsError`（`INVALID_ARGS`）をthrowし、invalid bodyまたはpost-policy valueは`ToolOutputError`（`INVALID_TOOL_OUTPUT`）をthrowします。どちらも通常のtool-error pathを使います。raw JSON Schemaはdefaultでopenのままで、unsupported keywordはenforcementなしで受け入れずrejectします。

registrationはtrusted same-process contractです。registryはtyped definitionをreadonly inputとしてborrowし、`output`を要求し、raw schemaをvalidateし、positive finiteな`timeoutMs`などのsemantic requirementを検査します。`schemas()`はrequest build時にmodel向けprojectionを構築するため、executionとpresentationは1つのresolved definitionを共有し、callbackをwireへ漏らしません。

## `ToolRestriction` — scopeがinheritするtoolのlive filter

`ToolRestriction`はscopeがinheritするtoolに適用します。deployment-global layerとchain上のすべてのancestor scopeです。registryはreadonly nameをprivate setへcompileし、複数restrictionをintersectionしてからscope自身のregistrationをoverlayします。own registrationは除外されないためdelegated childは自身が回答するtoolを保持できます。deny-only filterは後から現れるunlisted inherited toolを許可し、allow-listはそれらを除外します。

```ts type-equiv
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved Code Mode transport.
 */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

## Execution：extensible waterfallとmonotonic policy

`ctx.tools.execute()`はrequired readonly `signal`を持つcaller-owned `ToolExecutionInput`を受け取り、parsed JSON argumentを1回だけpipeline-owned `ToolExecution`へmaterializeします。そして`tools/pre-execute`（reorder可能なallow／deny／ask waterfall）→ registered monotonic guard → `tools/execute`（around-dispatch wrapper）→ `tools/post-execute`（resultのinspect／replace）→ optional definition-owned `finalizeContent` → `tools/result`（immutable authoritative outcome）の順でcallを実行します。required signalをreplaceできるのは`tools/execute` viewだけです。outcomeは`ToolExecutionResult`です。

```ts type-equiv
/** Opaque call identity that permits correlation without exposing mutable execution state. */
type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }
```

```ts type-equiv
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
interface ToolExecutionInput {
  readonly callId: CallId
  /**
   * Root model-requested call owning this execution tree. Callers omit it for
   * a root execution; nested dispatchers propagate the enclosing value.
   */
  readonly rootCallId?: CallId
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
  readonly arguments: unknown
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  /**
   * Opaque token of the enclosing transport execution, when one exists. Code
   * Mode sets this on SDK sub-dispatches so commit-style observers can wait for
   * the outer `run_code` outcome without receiving its live mutable execution.
   * The token also marks the call as a transport sub-dispatch rather than a
   * model-direct call: under `mode: 'code'`, only calls WITH a parent may
   * execute a native tool name — a model-direct call (no parent) is denied as
   * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
   */
  readonly parent?: ToolExecutionToken
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}
```

tool bodyはruntime extensionを受け取ります。`deferContext()`はexecution自身のresultにcontextを付加します。これはcomposite-tool nested-dispatch channelであり、plugin-sourced instructionをmintするleaf toolも利用できます。まだopenなouter callの内部にinjectはしません。

```ts type-equiv
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
interface ToolRunContext extends ToolExecution {
  /**
   * Defer one context — typically a nested-dispatch context ferried by a
   * composite tool, or a fresh plugin-sourced instruction — until this tool's
   * final result reaches the agent loop. Contexts retain their individual
   * source and metadata and are emitted in call order.
   */
  deferContext(context: UserMessage): void
  /**
   * Mark a successful final result as terminal for the current agent turn.
   * The marker rides this execution's own result (`concludesTurn` exists only
   * on {@link ToolExecutionSuccess}); a composite that dispatches nested
   * calls forwards it from the nested result, exactly like
   * `additionalContexts`, so only an authoritative nested success can
   * conclude the enclosing run.
   */
  concludeTurn(): void
}
```

agent loopはpending callごとのexecution modeをregistryに問い合わせ、exclusive barrierとrolling-pool parallel runを形成します。

```ts type-equiv
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

Code Mode bridgeはsettleした各sub-dispatchを`tools/code-dispatch-log` waterfallにも公開します。waterfallはdurable eventに保存するcontentのcopyを変更できますが、programのvalueとmodel-visible resultは変更しません。

```ts type-equiv
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/code-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/code-dispatch` event's copy changes.
 */
interface CodeDispatchLog {
  /** The outer `run_code` execution. */
  readonly exec: ToolExecution
  /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
  readonly agent?: Agent
  /** Deterministic sub-call id (`<parent>:code:<n>`). */
  readonly subCallId: CallId
  /** The dispatched sub-tool name. */
  readonly name: string
  /** Whether the sub-call settled as an error. */
  readonly isError: boolean
  /** The sub-call's complete model-facing content (the settle event's default payload). */
  readonly content: ContentBlock[]
}
```

```ts type-equiv
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
interface ToolExecution extends ToolExecutionInput {
  /** Root model-requested call, resolved for every root and nested execution. */
  readonly rootCallId: CallId
  /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
  readonly token: ToolExecutionToken
}
```

```ts type-equiv
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
  /** Cancellation signal visible to the next wrapper or tool body. */
  signal: AbortSignal
}
```

`ToolExecutionToken`はidentity comparisonだけに使うopaque runtime `Symbol`です。policy前に`execute()`がargumentをmaterializeしてfreezeし、non-JSON inputをrejectしてtokenを割り当てます。identity field、required caller signal、optional parent tokenはreadonlyのままです。`ToolDispatchExecution` wrapperはsignalをreplaceできますがremoveはできません。registryはbody呼び出し前にcaller signalを再融合します。final observerはfrozen execution identityを受け取ります。

`ToolGuard`はscope-awareなfinal pre-dispatch policyです。return typeにallow resultを意図的に持たせません。`undefined`はwaterfall decisionを保持し、returnされたreasonはpermissionを減らすだけなので、後続listenerが取り消せません。

```ts type-equiv
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

```ts type-equiv
/** Canonical failure detail; internal routing information remains optional. */
interface ToolFailure {
  /** Human-readable failure message without the Native `Error: ` envelope. */
  message: string
  /** Internal error class/code used by policy and durable diagnostics. */
  info?: ToolErrorInfo
}
```

```ts type-equiv
/** Successful canonical tool execution, including its Native/model projection. */
interface ToolExecutionSuccess {
  readonly isError: false
  /** Execution-local canonical value; deliberately omitted from durable events. */
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  /** The agent loop stops after committing this successful result batch. */
  readonly concludesTurn?: true
}
```

```ts type-equiv
/** Failed canonical tool execution; failures never carry a successful value. */
interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  readonly concludesTurn?: never
}
```

```ts type-equiv
/** The discriminated, execution-local outcome of one tool call. */
type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure
```

resultはoutcomeだけを運びます。call identityはすべてのhookとdurable `tool/call`／`tool/result` session eventに伴うimmutable `ToolExecution`上に残るため、wrapperは食い違う2つ目のidentityを作れません。canonical `value`はexecution-localです。loopがpersistするのは`content`、`error`、`meta`だけで、`tool/code-dispatch`はsub-callのrendered `content`と`isError`をverbatimで保存します。replayはpresentationを再現しますが、canonical intermediate valueは再構築できません。

success時、registryはbody valueをsnapshotしてvalidateし、freezeしてpure rendererとoptional top-level-call metadata projectorを呼びます。`tools/result`直前にdurable presentation fieldを別にmaterializeします。invalid value、renderer／projector failure、non-JSON presentationはJSON-safeな`isError`になります。そのためfinal live observerはexact execution-local valueと、後続のdurable appendに安全なfieldを同時に見ます。

final contentの前にregistryがcandidate resultをmaterializeします。content、structured error、additional context、presentation metadataのfailureはJSON-safeな`isError` resultになり、`finalizeContent`にも到達します。registryはcallbackを正確に1回呼び、その後`tools/result`直前にaccepted resultをmaterializeしてfreezeします。observed live outcomeは後続のdurable `tool/result` appendに安全です。

各interception waterfallはtyped **Decision**を返します（`agent/*` waterfallと共有するidiom）。`tools/pre-execute` listenerは`(exec, next)`を受け`PreToolDecision`を返し、`tools/execute` wrapperは`ToolExecutionResult`を返し、`tools/post-execute` listenerは`(exec, result, next)`を受け`PostToolDecision`を返します。

```ts type-equiv
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

```ts type-equiv
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts?: UserMessage[] }
  | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts?: UserMessage[] }
  | { kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[] }
```

defaultには`next()`を呼び、short-circuitにはdecisionを返します。pre-policyはdenyまたはaskができ、`allowed-once`だけが続行します。non-grant、approval channel／serviceの欠落、agentなしrequestはdenialになります。guardはfinal denialを追加できます。history、audit、UI、executionが一致しなければならないため、argumentはrewriteできません。

post-policyはcontentまたはvalueのどちらか一方だけをreplaceできます。content replacementはcanonical valueと既存metadataを保持し、value replacementは再validateしてcontent／metadataを再computeします。blockはvalueをremoveし、corrective feedbackを含む`isError`になります。content replacementはpresentation policyでありconfidentiality policyではありません。programmatic valueを隠す必要があるlistenerはblockまたはreplaceします。`tools/result`はnormalize後のfrozen executionとresultを受け、observerはtransformできずfailureはcontainされます。unknown toolとthrowするtoolはどちらもstructured errorになります（`ToolNotFoundError`は`UNKNOWN_TOOL`にmap）。そのためcallはturnを終了せず失敗します。

## Enforced raw JSON Schema subset

subagent、workflow、MCP、dynamic registrationのraw schemaはauthor DSLのwire-level counterpartを使います。`assertSupportedJsonSchema()`は任意のJSON rootを受け付け、`validateJsonSchemaValue()`が強制し、`JsonSchemaError`がunsupportedまたはmalformed schema pathをすべて報告します。empty annotation-only nodeはunconstrained lossless JSONを意味します。`oneOf`には少なくとも2つのbranchが必要で、valueは正確に1つに一致しなければなりません。object rootが必要なconsumerは`assertObjectJsonSchema()`を呼び`ObjectJsonSchema`を持ちます。これによりshared vocabularyを制限せず、subagent／workflowのcaller-defined structured outputをobject-rootedにできます。

```ts type-equiv
/** Scalar JSON values supported by `enum` and `const`. */
type JsonSchemaScalar = string | number | boolean | null
```

```ts type-equiv
/** Single-type keywords accepted by the enforced subset. */
type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
```

```ts type-equiv
/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: JsonValue
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: JsonValue
}
```

```ts type-equiv
/** A consumer-constrained object-rooted schema. */
type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }
```

## Tool-presentation UI vocabulary

toolがUI（editorのtool-call card、CLI log line）にcallをどう表示したいかを示すprovider-neutral vocabularyです。toolがclient protocolに依存せず自身を説明できます。`presentCall`／`presentResult`は**`card`-tagged render intent**を返し、UI bridgeはdiscriminated unionをswitchします。

- `ToolCallView`（pending）：`{ card: 'generic', title, kind?, rawInput?, content?, locations? }`（default card。`locations`はcallがread／modifyするfileの`{ path, line? }[]`で、editor follow-along用）、`{ card: 'terminal', title, description?, cwd? }`（shell command → terminal card）、または`{ card: 'diff', title, diffs, locations? }`（file create／modify → inline diff card。`diffs`は`{ path, oldText, newText }[]`で、新規fileの`oldText`はnull）。
- `ToolResultView`（completed）：`{ card: 'generic', title?, content? }`、`{ card: 'terminal', title?, output?, exitCode?, signal? }`（captured run output＋exit。対応UIはexit-status pillを表示し、別UIはfenced ` ```console ` fallbackを導出できます）、`{ card: 'diff', title?, diffs }`（completed file mutation →表示するchange。通常はbefore／after contentからcontext lineを計算した適用済みhunk、before-imageがない場合はwhole-file diff）、`{ card: 'search', shape, title?, truncated, total, … }`（completed discovery search → `shape: 'matches'`（grep）のgrouped-by-file match、または`shape: 'paths'`（glob）のflat path list。`truncated`／`total`はinline resultがcapされたか示し、UIがpartial resultをcompleteと表示しないようにします。viewはresult textを持たず、search cardのないUIはraw result contentへfallbackします）、`{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`（completed file read → line-numberedでoptional syntax-highlightされたcode view。`offset`はwindowが要求した1-based first lineで、`lines`が空でも保持します。`lang`はextension由来のlanguage hint、`content`はenvelopeを除いたtextでread非対応UIのfallbackです）、または`{ card: 'web', kind: 'search' | 'fetch', title?, … }`（completed web retrieval。`kind: 'search'`はstructured `sources`／`answer?`／`truncated`を、`kind: 'fetch'`は`url`／`statusCode`／`truncated`を運びます。`web` capabilityのないUIはraw result contentへfallbackし、bodyはviewに重複させません）。completed viewはpending viewをreplaceするため、mutation toolはcall-time snippetと重複していてもdiff resultを返します。searchとweb retrievalにはcall-timeの`card` analogueがなく、structured resultは`execute`後だけ存在するためpending stateはgeneric cardのままです。

`ToolCallKind`（`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`）はgeneric cardのiconを選びます。`FileLocation`（`{ path, line? }`）、`FileDiff`（`{ path, oldText, newText }`）、`ReadFileLine`（`{ number, text }`、read windowの1-based numbered line 1行）がshared file-card vocabularyです。設計は[render-intent-union Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)に固定し、host／client runtimeはこのneutral vocabularyを自身のviewへprojectします。

presentation fieldの完全な説明は[`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)にあります。`bash` schemaとexecutorは[shell.md](shell.md)、generic background controlは[jobs.md](jobs.md)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtools--toolruntime"></a>

### `ctx.tools` — `ToolRuntime`

Tool registry and execution pipeline. Scoped registrations shadow globals; one visibility resolver feeds presentation, lookup, and dispatch.

```ts cordis-catalog
/**
 * Present the calling scope's tools in `mode` instead of the deployment
 * default. Nearest scope on the chain wins, so a preset's standing
 * declaration covers every agent joined under it.
 *
 * Scoped only, and one declaration per scope: this is how an agent preset
 * composes Code Mode agents beside native ones in the same process, and a
 * process-global override would be the `mode` config field instead.
 * @param mode - the presentation the covered agents' models see.
 * @returns the exact disposer that restores the deployment default.
 */
presentAs(mode: ToolPresentationMode): () => void

/**
 * Register globally or in the calling agent scope. Scoped tools shadow
 * globals; duplicates within one layer and the reserved `run_code` name fail.
 * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition): () => void

/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/**
 * Register a monotonic guard after the extensible `tools/pre-execute`
 * waterfall. A plain-context guard applies globally; one registered through
 * `agent.ctx` applies only to that agent. Any matching guard may deny by
 * returning a reason, while no guard can force-allow a call another guard
 * denied. The exact effect disposer is returned for ordered ownership and
 * HMR cleanup.
 * @param guard - synchronous check; a returned string denies the execution.
 * @returns the exact disposer that unregisters the guard.
 */
guard(guard: ToolGuard): () => void

/**
 * Look up a tool as one scope sees it (scoped
 * shadows global; a restricted-away global reads as absent). Presenters pass
 * the calling agent so the rendered card matches the definition that
 * actually executed.
 * @param name - the tool name as registered.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns the definition the scope resolves, or undefined when none is visible.
 */
get(name: string, scope?: ScopeKey): ToolDefinition | undefined

/**
 * Project visible definitions onto the allowlisted model-facing schema fields,
 * excluding execution and presentation callbacks.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns one deep-cloned schema per visible tool.
 */
schemas(scope?: ScopeKey): ToolSchema[]

/**
 * Classify a pending call through the caller's visible tool definition. Only
 * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
 * throwing classifiers are exclusive.
 * @param exec - call name, parsed arguments, and optional agent scope.
 * @returns the fail-closed scheduling mode.
 */
executionMode(exec: ToolExecutionInput): ToolExecutionMode

/**
 * Execute through pre-policy, guards, around-dispatch, post-policy,
 * definition-owned content finalization, and final notification. Tool and
 * listener failures resolve as materialized error results; an invisible tool
 * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
 * snapshot final observers receive. Cancellation
 * arriving after entry and before final result materialization skips a
 * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
 * successful started outcome with `ABORTED`; already-started work is still
 * drained and may retain a tool-owned structured error.
 * @param exec - the typed same-process call input. The registry assigns its
 *   correlation token before policy begins.
 * @returns the materialized final result.
 */
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
```

Types: [ScopeKey](scope.md)

Source: [`packages/core/tools/src/index.ts:787`](../../packages/core/tools/src/index.ts)

<a id="tools-events"></a>

### `tools/*` events

<a id="toolschange--emit"></a>

#### `tools/change` — emit

A tool was registered or unregistered, or a scoped restriction changed (the available tool set changed — possibly for one scope only). An UNFILTERED registry-subject notification, deliberately not scope-filtered dispatch: a global change concerns every agent's next assembly, so a scoped listener subscribing here sees every change, not just its own scope's.

```ts cordis-catalog
/**
 * A tool was registered or unregistered, or a scoped restriction changed
 * (the available tool set changed — possibly for one scope only). An
 * UNFILTERED registry-subject notification, deliberately not scope-filtered
 * dispatch: a global change concerns every agent's next assembly, so a
 * scoped listener subscribing here sees every change, not just its own
 * scope's.
 * @mode emit
 */
'tools/change'(): void
```

Source: [`packages/core/tools/src/index.ts:207`](../../packages/core/tools/src/index.ts)

<a id="toolscode-dispatch-log--waterfall"></a>

#### `tools/code-dispatch-log` — waterfall

Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome before the bridge appends its `tool/code-dispatch` event. `next()` keeps the content unchanged; a listener may return replacement blocks (e.g. the spill policy's preview + locator for an oversized text result). Only the logged copy is affected — the program already received the complete value, and the model sees neither. A throwing listener is contained: the bridge falls back to logging the original settled content. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.

```ts cordis-catalog
/**
 * Allow a listener to replace content in the DURABLE LOG COPY of one
 * `run_code` sub-dispatch outcome before the bridge appends its
 * `tool/code-dispatch` event. `next()` keeps the
 * content unchanged; a listener may return replacement blocks (e.g. the
 * spill policy's preview + locator for an oversized text result). Only the
 * logged copy is affected — the program already received the complete
 * value, and the model sees neither. A throwing listener is contained:
 * the bridge falls back to logging the original settled content.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
 * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
 * @mode waterfall
 */
'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

Types: [ContentBlock](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:189`](../../packages/core/tools/src/index.ts)

<a id="toolsexecute--waterfall"></a>

#### `tools/execute` — waterfall

Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns a normalized result; wrappers may change only `exec.signal`, while call identity remains immutable. The registry re-fuses the original caller signal before the body, so replacement cannot detach caller cancellation; wrappers must still restore their signal and reach quiescence. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
 * a normalized result; wrappers may change only `exec.signal`, while call
 * identity remains immutable. The registry re-fuses the original caller
 * signal before the body, so replacement cannot detach caller cancellation;
 * wrappers must still restore their signal and reach quiescence.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
 * @mode waterfall
 */
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:163`](../../packages/core/tools/src/index.ts)

<a id="toolspost-execute--waterfall"></a>

#### `tools/post-execute` — waterfall

Accept, replace, enrich, or block a normalized dispatch result. `next()` accepts it unchanged; thrown tools still reach this waterfall as errors. Async listeners must observe `exec.signal`; after they settle, caller cancellation replaces only a successful accepted outcome with the code selected by whether the tool body was invoked. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Accept, replace, enrich, or block a normalized dispatch result. `next()`
 * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
 * listeners must observe `exec.signal`; after they settle, caller
 * cancellation replaces only a successful accepted outcome with the code
 * selected by whether the tool body was invoked.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the call that just ran (name, parsed arguments, caller agent).
 * @param result - the dispatch outcome a listener may accept, replace, or block.
 * @mode waterfall
 */
'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:175`](../../packages/core/tools/src/index.ts)

<a id="toolspre-execute--waterfall"></a>

#### `tools/pre-execute` — waterfall

Allow, deny, or ask before dispatch. `next()` delegates to allow; missing approval support turns `ask` into denial. Async gates must observe `exec.signal`; the registry rechecks cancellation after they settle but never abandons their promise. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
 * approval support turns `ask` into denial. Async gates must observe
 * `exec.signal`; the registry rechecks cancellation after they settle but
 * never abandons their promise.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the pending call (name, parsed arguments, caller agent).
 * @mode waterfall
 */
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:152`](../../packages/core/tools/src/index.ts)

<a id="toolsresult--emit"></a>

#### `tools/result` — emit

Observe the frozen, lossless-JSON final outcome. Listener failures are contained. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.

```ts cordis-catalog
/**
 * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
 * @param exec - the execution object that traversed the pipeline.
 * @param result - a deep-frozen snapshot of the final returned result.
 * @mode emit
 */
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/index.ts:197`](../../packages/core/tools/src/index.ts)
<!-- END GENERATED cordis-surface -->
