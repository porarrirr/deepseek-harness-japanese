# ユーザー承認

[English](approval.md) | [中文](approval.zh.md) | 日本語

[dsh-user-approval](../../packages/interaction/user-approval)のuser-approval seamは、特定のactionを続行してよいかという1つの質問に答えます。共有request／outcome語彙、`ctx.approval` dispatch service、`approval/request` answerer waterfall、log-onlyのaudit pair、セッションごとの`ask`／`never` policyを所有します。UI channelはhuman answererを提供でき、[ACP automation bridge](../../packages/acp/acp)は自身のagent向けにone-shot machine decisionを提供します。[dsh-tools](../../packages/core/tools)や[dsh-tool-bash](../../packages/shell/tool-bash)などのcallerはclosed outcomeを使い、`allowed-once`以外ではfail closedします。

Source: [`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 識別情報とoutcome

各requestは新しい`ApprovalRequestId`を受け取ります。brandは`approval/asked`と`approval/decided`のaudit eventを対応付けますが、approval idをtool-call idやagent／session idと交換可能にはしません。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome`はclosedでfail-closedです。`allowed-once`は質問されたactionだけを許可し、callerは`rejected`、`cancelled`、`unavailable`を拒否します。answererがない、ownerでない、throwする、または規約に従わない場合はgateを開かず`unavailable`になります。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## Sessionごとのpolicy

`ApprovalPolicy`はinteractive answererの実行前に何が起きるかを決めます。`ask`はcomposeされたanswerer chainに委譲し、answererがない場合のdefaultは`unavailable`です。`never`はanswererをdispatchせず決定的に`rejected`を返します。effective valueはsession logの最後の`approval/policy` eventで、なければservice configにfallbackします。`setApprovalPolicy(session, policy)`が唯一のwrite pathなので、replayでoverrideを再構築できます。

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
type ApprovalPolicy = 'ask' | 'never'
```

どちらのpolicyも完全な現在の意味をcache-safe runtime-context snapshotに提供します。source付き`user/message`が永続的なmodel-visible inputです。approval stateを変更すると、request headerのsystem promptを書き換えず、保持されたhistoryの後ろに新しい完全snapshotをappendします。

## Approval request

`ApprovalRequest`は質問をrouteしてauditできる程度にagentとtool actionを識別します。tool argumentは意図的に省略します。answererは`callId`を通じてpromptをすでにstreamされたtool callに添付し、ずれる可能性のある2つ目のcopyをrenderしません。

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

## Dispatchとaudit

`ctx.approval.request(req)`は、request元のsessionがopen turn内にあることを要求します。`approval/asked`をappendし、1つのoutcomeを取得し、対応する`approval/decided`をappendして、そのoutcomeでresolveします。`never` policyはwaterfall dispatch前にservice内部で強制されるため、後から`prepend`で登録されたanswererも迂回できません。answererはrequestを所有する場合にoutcomeを返し、それ以外は`next()`で委譲します。最初のanswerが単一のdecision slotを占有します。

audit eventはlog-onlyでmodel transcriptには入りません。model-visible behaviorはcallerのderived tool resultと現在のruntime-context snapshotです。serviceのdisposeは自身のcontext contributionを削除し、answerer listenerはそれぞれowner pluginのeffectに独立して束縛されます。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the request, agent, session, and live signal directly.
 * The request requires an open turn because the audit pair must be enclosed
 * by the durable log's commit/replay boundary; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/interaction/user-approval/src/index.ts:192`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim the request or call `next()`; failure yields the fail-closed default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()`; failure yields the fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

Types: [Scoped](scope.md)

Source: [`packages/interaction/user-approval/src/index.ts:30`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
