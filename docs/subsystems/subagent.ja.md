# Subagent

[English](subagent.md) | [中文](subagent.zh.md) | 日本語

subagent seamはagentがchild agentへworkをdelegateできるようにします。[bash](shell.md)と同様に**1つの任意capability**でagent loopの一部ではないため、typeは[core.md](core.md)ではなくここにあります。他のcapability seamと異なり、1つのcontextに**複数のprovider implementationが共存**し、name（`ctx.subagents`）で登録されます。bashがexecutorを1つだけ許可するのとは異なります。registryはsingle-serviceのbash executorではなく[LLM adapter registry](llm-streaming.md)に従います。

Service Definitionは[dsh-subagent](../../packages/subagent/subagent)（`ctx.subagents`と以下の語彙）です。Service Providerは兄弟package（`dsh-subagent-spawn-in-process`、`-fork`、`-acp`、`-codex`、`-claude-code`、`-dsh-sdk`）で、model向けConsumerは[dsh-tool-subagent](../../packages/subagent/tool-subagent)（providerごとのdelegation）、[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)（任意のglobal `send_message`、`interrupt_agent`、`list_agents` control）、[dsh-tool-subagent-report](../../packages/subagent/tool-subagent-report)（任意のchild-scoped `report` return channel）です。同じ`ctx.subagents` serviceは内部activation managerを通じたcontinuable child orchestrationと、session storeおよび任意のsession persistenceから直接読み取るchild／descendant discoveryを所有します。製品providerの理由は[Codex and Claude Code Agent Note](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md)、共通seamの理由は[subagent Agent Note](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)、[continuable subagents Agent Note](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)、[report-tool Agent Note](../../.agents/notes/implemented/feature/2026-07-30-continuable-subagent-report-tool.md)、[durable catalog Agent Note](../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)、[merged-service Agent Note](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)にあります。

Sources: [`packages/subagent/subagent/src/types.ts`](../../packages/subagent/subagent/src/types.ts), [`packages/subagent/subagent/src/index.ts`](../../packages/subagent/subagent/src/index.ts), and [`packages/subagent/subagent/src/continuation.ts`](../../packages/subagent/subagent/src/continuation.ts)

## 2種類のcapabilityと2つの検出方法

providerはone-shot runが存在する前にserviceが検査するstatic descriptorで**start-time** featureを広告します。providerにないfeatureを要求するrequestは、受理後に無視せず明確に拒否します（`SubagentError('UNSUPPORTED_CAPABILITY')`）。これらのflagが記述するのはproviderがchildをcomposeするone-shot [`start()`](#the-provider-contract-subagentprovider) pathだけです。**Continuable** childはcontinuation manager自身がcomposeするため、capabilityは任意methodの存在で判定し、検出にはTS narrowingを使います。[`SubagentProvider.prepareContinuable`](#the-provider-contract-subagentprovider)です。

```ts type-equiv
/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

## One-shot start request

tool layerはmodel inputと自身のconfigからこのrequestを構築し、serviceは`start`前にnamed providerに対して検証します。必須の`parent`がsession cwd、lineage、delegation depthを提供します。任意のoutput schema、depth、tool filter、personaには対応するcapability flagが必要です。unsupported schemaはstart時に失敗し、in-process backendはfilterとpersonaをchild creationにscopeし、forced capture toolを使ってサポート対象のobject-rooted schemaを実装します。

```ts type-equiv
/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}
```

`signal`はreadiness前後で共通する唯一のcancel channelです。persona、live global-tool filter、absolute-depth、visibility-not-authorityの理由は[subagent composition-controls Agent Note](../../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)が管理します。

caller向けrequestはcatalog format detailやcontinuation stateを持ちません。`SubagentRuntime.start()`はcapability check後に分離されたone-shot descriptorを解決し、このprovider向けrequestをselected transportへ渡します。continuable childが`SubagentProvider.start()`へ到達することはありません。

```ts type-equiv
/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}
```

## Continuable childとActivation

**continuable background subagent**は、最大1つのprocess-local **Activation**を持つ永続child Sessionです。Activationは再構築されたchild Agentがresidentである期間です。Activationはrequest、result、cancel、Taskではありません。多くのFIFO turnを実行でき、作成したdescendantがrunning中はresidentであり続けます。activation admission、direct-parent authorization、live ownership graph、cold resume、child-first disposalはcontinuation managerが所有し、すべてのturn orderとexecutionはAgent loopが所有します。continuable pathがTaskや中間result付きwrapperを作ることはありません。

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

`SubagentRuntime.startContinuable()`はstable child idをreserveし、versioned `subagent/descriptor` payloadをsnapshotし、named providerに分離された`ContinuableCreateSpec`を要求し、private activation-owner scopeを通じてchild Agentを作成し、continuable-parent ownershipを確立してinitial promptをsubmitします。inbox acceptanceがmessage idを返した時点で`{ childId, messageId }`をresolveします。turn startやmessageがSession logに入るのは待ちません。受理前のfailureはidを1つも返さずrejectし、作成済みhandleをdisposeしてActivationとparent ownershipをrollbackします。

`SubagentRuntime.followup()`が唯一のcontinuation-message operationで、routingはActivationのresidencyだけに依存します。

| Activation state | `followup` |
|---|---|
| `running` | enqueue in the same Activation |
| `waiting` | wake the same Activation |
| no Activation | cold-resume a new Activation |

`running`はAgentにactive admission／turn、またはwake対象のinbox workがあることを意味します。`waiting`はquiescentだが、dispose未完了のchild Activationを少なくとも1つ所有していることを意味します。`settled`は所有するchildがすべてdispose済みのquiescent状態で、その時点でmanagerは[`AgentHandle`](core.md#creation-and-ownership)をdisposeしActivationを削除します。managerは2つ目のexecution state machineを維持せず、Agentのquiescenceとowned-child setからこれらのinternal conditionを導出します。

Agent inboxが唯一のqueueです。各continuation messageは1つの`Agent.followup()` FIFO turnになり、受理されたmessageのobservable orderは1つで、follow-upが進行中のturnをredirectすることはありません。成功したdeliveryはaccepted `MessageId`を返します。既存の`agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded` eventがmessage lifecycle observationであり、continuation layerはsubagent固有のdelivery routeを定義しません。

follow-up authorityは正確なlive Agent tool contextから得ます。authenticated Agentは`SessionHeader.parentSession`に記録された永続childのdirect parentでなければなりません。`MessageSource`と`senderSessionId`はadmitted messageの提供者を記録しますがauthorityは与えません。任意のmodel向けtoolは`CoordinatorMessageSource`を使います。

両operationでcaller signalが所有するのはinbox acceptanceまでのlookup、materialization、admissionだけです。その後はmanagerがActivationを独立して所有します。後続のcaller cancelはaccepted turnをcancelせずchildもdisposeせず、seamはsteering operationを公開しません。

`SubagentRuntime.interrupt(targetSessionId, authority)`が唯一の公開stopです。同期的にauthorizeし、live targetへ`Agent.cancel(cause, { keepInbox: true })`を発行し、quiescenceをawaitせずreturnします。Activation、未claimのpending inbox work、公開済みdescendantには触れません。interrupted turnにすでにclaimされたworkはrequeueしません。interrupted driverがidleになると、waking sendがparked FIFO queueを再開します。targetが存在しない（unknown、one-shot、settled済み）場合とmanager-less compositionはaccepted no-opです。live targetではparent addressの不一致またはlive ancestry外のcallerは`UNAUTHORIZED`でrejectし、stale ancestor objectとself-targetするancestor requestはtarget lookup前にrejectします。

```ts type-equiv
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent }
```

各Activationは`AgentHandle`と`ownedChildren: Set<SessionId>`を所有します。1つのSessionには最大1つのlive Activationしかないため、child Session idだけで別のruntime-incarnation referenceなしにlive childを識別できます。childの開始またはparent由来workのsubmitでは、childがrunする前にcontinuation管理下のparent setへchildを登録し、setが空でない間はparentをsettleできません。top-levelまたは他のnon-continuation AgentにはActivationがなく、waiting graphの外に留まります。childのreleaseは、child Agentがquiescentになり、そのchildの全childがdisposeされ、best-effort final session flushがsettleし、childの`AgentHandle`のdisposeが完了した後にだけ行われます。

final settlementは`ctx.sessions.flush(session)`をawaitしますが、任意のlistenerはpersistence backendがstateを保存したことを証明できないためparticipation booleanを無視します。rejectはActivationをfailさせずlogに記録し、managerはhandleをdisposeしてownershipを解放します。その後のresumeで永続child stateが欠落またはstaleになる可能性があります。manager unloadはadmissionをcloseしてlive forestをすべてdisposeするinternal manager-wide drainを実行します。`drainContinuableDescendants(parents)`は正確なlive host-owned Agentの下だけでadmissionをcloseし、continuable descendantをdisposeしますが、無関係なforestはliveのままです。どちらもscope内ですでにadmitされたmaterializationをawaitし、cancelをtop-downに伝播し、handleをchild-firstで解放し、個々のfailureがあっても選択されたbranchをすべてawaitします。永続child Sessionはprocess-local teardown後も存続します。

```ts type-equiv
/** Attribution for a model coordinator's follow-up to one of its children. */
interface CoordinatorMessageSource {
  readonly kind: 'coordinator'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the agent whose tool call produced the follow-up. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for following up with one continuable child. */
interface SubagentFollowupOptions {
  /** Durable attribution retained on the delivered message; it grants no authority. */
  readonly source: MessageSource
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Identities returned once a continuable child accepted its initial prompt. */
interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

任意のcontinuable-child setup contributionは、base child composition後、Activationの公開前にscope-local capabilityをinstallできます。registryは順序付きでtransactionalです。setupのfailureまたはrevokeは未公開Activationをrollbackし、child-scope disposeはすべてのinstallationを解放し、新しいregistrationは次のActivationに影響し、registration removalはresident installationをすべて直ちにrevokeします。

`SubagentRuntime.reportFrom()`は2つ目のqueueやresult-bearing child wrapperを追加せずにこのextension pointを使います。exactなlive child Agentがcallをauthorizeするため、callerはrecipientをnameで指定できません。managerはchildのdurable `parentSession`から唯一のrecipientを導出し、そのparent Agentがliveであることを要求し、選択されたcontentを1つの`subagent-report` user messageとして組み立て、messageのstable `MessageId`を返します。quiet deliveryは`Agent.inject()`を使いparentをwakeしません。next-step deliveryは`Agent.steer()`を使い、idle parentをwakeするかrunning parentの最寄りのstep boundaryに参加させます。どちらのmodeもchildのturnをconcludeせず、final answerが暗黙にreportすることもありません。

```ts type-equiv
/** Durable attribution for a continuable child's explicit parent report. */
interface SubagentReportMessageSource {
  readonly kind: 'subagent-report'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the reporting child. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Deployment scheduling policy for accepted child reports. */
type SubagentReportDelivery = 'quiet' | 'next-step'
```

reportはchild自身の選択なので、managerは自身のaccountを別に保持します。resident Activationがsettleすると、そのepochがどう終わったかとfinal assistant contentを記したnoticeをchildの永続direct parentへ1つdeliveryします。callerがidを受け取ったすべてのchildに対してdeliveryはunconditionalで、parentをsettledと判定可能にするownership releaseより前に行います。resident parentにはreportと同じwaking-admission accountingを通じて届きます。parent自身のlineageがteardown中ならwakeなしで受け取ります。quiescent Agentをwakeするとworkをqueueするのではなくturnを開始するためです。provenanceは独立したkindであり、transcriptがruntime accountをchildが書いたものとして表示することはありません。

```ts type-equiv
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for one continuable child's report to its direct parent. */
interface SubagentReportOptions {
  /** Already-resolved parent scheduling policy. */
  readonly delivery: SubagentReportDelivery
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}
```

providerが参加するのはinitial creation specの準備だけで、`spawn`と`fork`の違いもそこにあります。返すspecは分離されたprovider固有のcreation input（現在は任意のparent-history seed）だけを持ち、Agent、`AgentHandle`、prompt delivery、result、dispose、resume operationは持ちません。cold resumeはproviderを通じてdispatchしません。managerがgeneric descriptorをfoldし、同じactivation-owner scopeを通じて`ctx.agents.resume()`を呼び、waiting turnをsubmitします。

```ts type-equiv
/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}
```

descriptor（[descriptor.ts](../../packages/subagent/subagent/src/descriptor.ts)の`SubagentDescriptorData`）は、session-backed subagentごとのmode-discriminated durable identityです。両modeがprovider nameを持ちます。`one-shot` descriptorはcaller所有のdisplay `label`を任意で持ち、`continuable` descriptorはdelegation `description`を永続creation labelとして必須にし、cold resume用に解決済みchild `agentOptions.provider`／`model`と任意の`persona`／`toolFilter`をsnapshotします。merge-extensibleな`AgentOptions` objectをsnapshotしないため、無関係なextension valueがcontinuationを壊すことはなく、後続のcomposition inputは意図的なversion changeになります。`subagentDepth`（cold resumeはpersisted headerの`delegationDepth`をmonotone floorとして信頼します）と`outputSchema`（runまたはActivationのresult約束であり、durable identityではありません）は省略します。

local one-shot providerはchildの最初のrequest前、initial turn内にdescriptorをappendします。continuation managerはproviderが提供するlineageの後、initial promptのadmit前にdescriptorをappendします。`header.seedLength`はfork-lineage boundaryのままです。resume-time descriptor authorityはchild自身のsuffixを読み、list-serving identity projectionは`subagent/descriptor`をlast-winsでfoldするため、child自身のdescriptorがfork-seeded ancestorのdescriptorを上書きします。このeventはlog-onlyで、`surfaceOp`を持たずmodel historyには入らず、append-only logによりcompaction後も保持されます。malformedなcurrent-version descriptorはcorruptで、unsupported versionはこのruntimeでは分類できません。

## 永続列挙：`listChildren()`、`listDescendants()`、そのentry

`SubagentRuntime.listChildren(parentSessionId)`は、`ctx.sessions.list()`とoptionalな`ctx.sessionPersistence.list()`をlive優先でmergeした結果から、parentのdirect session-backed subagentを列挙します。query serviceは使わず、Agentをloadまたはresumeしません。candidateはdurable headerに`origin: 'subagent'`を持つdirect childです。このmarkerはenumerationと粗いgeneric-route denialを分類しますが、valid descriptor、resumability、authorizationを確立するものではありません。identityはprojection foldが、resumeはActivation contractが所有します。各rowの`mode`／`label`はregistered `subagent` projection unitのvalueで、3段階のladderから取得します。live childにはregistryのwatermark cache（log readなし）、cold childにはoptional projection checkpoint cache（`cachedSnapshot`。own-suffix seq gateを通過するidentityは、own descriptorがappend後immutableなのでfinal）、それ以外にはregistryを通してfoldする1回の`persistence.inspect()`（bounded concurrency、listingごとに再計算）を使います。cacheがない、`null` sentinelを返す、keyがない、seq gateに失敗する、faultする場合は、authoritative refoldへ静かにfallbackします。foldはfailure channelを持たない`subagent/descriptor` last-winsです。child自身のdescriptorがfork-seeded ancestorのdescriptorをoverrideし、malformedまたはunknown-version payloadはserializableな`null` sentinelへfoldされ、valueなしとして扱われます。結果は`createdAt`-then-id orderの`SubagentListEntry[]`です。提供されたidentityは`mode: 'one-shot' | 'continuable'`と`activity: 'running' | 'inactive'`を持つ`child` entryになり、continuable entryは常に`label`を持ちます。one-shot entryの`label`はstart callerがpresentation metadataを渡した場合だけ持ちます。foldがidentityを提供しなかったsettled candidateは`corrupt` diagnosticになります（missing、malformed、unknown-version descriptorは意図的に区別しません。`unsupported`はtypeに残りますが生成されません）。identityのないrunning candidateは省略され、cold inspection failureは次のlistingでretryする`unavailable` diagnosticを1つ生成するため、壊れたsiblingが正常なchildを隠しません。`hasChildren`は同じmerged materialから読み取ったdurable subagent originを持つdirect descendantを示します。activity snapshotが示すのはlogical recordが`ctx.sessions`でliveかどうかだけで、outcomeやresumabilityではありません。persistenceがない場合、enumerationはerrorではなくlive-onlyです。その場合cold childもresumeできません。`ctx.sessionProjections` registryがないと`SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`、session storeがないと`SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`のcodeを持つ`SubagentError`を`listChildren()`がthrowします。どちらもread前に検査するため、childが0件のdeploymentでもdeterministicに失敗します。list toolはplugin load時に`ctx.subagents`と`ctx.agents`を要求します。UIなどのservice consumerは両modeを表示してunlabeled one-shot fallbackを選べます。一方、model-facing `list_agents` adapter（[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)の別load可能な`/list-agents` plugin）はcontinuable entryだけを残し、live Agent registryを通じて`running`／`idle`／`ready`へstatusをrefineします。`ready`はterminalではなくresume可能なstorage-only childを示します。listingはcontinuation managerのActivation map、Agent registry、provider availabilityを参照しません。`send_message`がdelivery-timeのauthoritative operationのままであり、listingされたrunning continuable childでもownership conflictとしてdeliveryをrejectすることがあります。read pathのrationaleは[list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)にあります。

`SubagentRuntime.listDescendants(rootSessionId)`は、同じlive優先のcorpusとprojection-backed interpretationをrootの完全なdescendant treeへstable pre-orderで適用します。ordinary sessionとone-shot childはtraversal nodeのままなので、その下のcontinuable descendantも検出されます。rowを生成するのは`origin: 'subagent'` candidateだけです。返す各childまたはdiagnosticには列挙したdurable header由来のpositionを加え、cold inspectionではidentityを提供する前にそのcomplete lifecycleを再検証します。

```ts type-equiv
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}
```


## Terminal result：`SubagentResult`

`SubagentRun.result`が解決するone-shot runのoutcomeです。`structured`は要求した`outputSchema`を正常に満たした場合だけ存在します。schemaを要求しても存在は保証されず、childが失敗したかvalid captureなしに終了した場合、providerは`stopReason: 'error'`を返すことがあります。providerはnon-`completed` resultにsafeでnon-assistantな`diagnostic`を付与できます。consumerに`output`と別に提示する前に、providerはtool input、file content、environment value、credential、raw protocol payloadを除去し、完全なvalueを4096 UTF-8 byteに制限します。non-`completed`の`stopReason`は`output`がpartialかもしれないことを示し、consumerはpartial outputを成功として報告せず`isError` tool resultへ対応付けます。

```ts type-equiv
/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /**
   * Provider-authored, non-assistant failure detail for a non-`completed`
   * result. Providers keep this text free of tool inputs, file contents,
   * environment values, credentials, and raw protocol payloads, and limit it
   * to 4096 UTF-8 bytes. Consumers present it separately from {@link output}.
   */
  readonly diagnostic?: string
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}
```

`SubagentStopReason`は[merge-extensible derived union](core.md#the-map--derived-union-pattern)です。backendはvariantを追加できるため、consumerは既知のcaseに分岐し、unknown terminal reasonをfailureとして扱います。

```ts type-equiv
/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}
```

## One-shot run：`SubagentRun`

`SubagentRun`は公開済みone-shot child向けのconsumer所有handleです。1つのresultを持つdispose可能なforeground delegationであり、永続child handleではありません。公開後のprompt submission、turn work、infrastructure faultは`result`に属します。consumerはresultをawaitし、quiescenceに到達するため常にrunをdisposeします。child failureはnon-completed stop reasonでresolveし、表現できないinfrastructure faultだけがrejectします。runにはsteeringもresumeもありません。continuable conversationにはrun自体がなく、continuation managerが`AgentHandle`を直接保持し、child自身のinboxで各turnを順序付けるためです。

```ts type-equiv
/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}
```

A local one-shot runは`start()`がfulfillする前に通常のchild agent／sessionをMUST公開し、そのchild session idを`SubagentRun.id`として返し、正確なchildを`localAgent`として公開し、childの`parentSession` headerに`request.parent.session.id`を記録し、最初のrequest前にchildのinitial turn内で解決済みdescriptorをappendしなければなりません。runtime ownershipはchildをparent、provider、root scopeの下に置けます。remote providerは代わりにparent-scoped lifecycle idと`localAgent: undefined`を返し、local child Sessionがないためdurable enumerationには現れません。

<a id="the-provider-contract-subagentprovider"></a>
## Providerの約束：`SubagentProvider`

各providerはnamed child-agent transportで、複数providerが共存できます。serviceは`start()`前に要求されたstart-time capabilityを検証し、`prepareContinuable`のないproviderでのcontinuable startを拒否します。`inheritsParentContext`が記述するのはconversation seedingだけです（`fork`: true、`spawn`と`acp`: false）。consumerはinherited tool、service、authorityを示唆せず正確なmodel向け文言を生成できます。

```ts type-equiv
/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
```

providerの`start()`は公開済みrunでfulfillします。serviceは一意の`runId`をmintし、providerの正確な`localAgent`から`local`をsnapshotし、resultをobserveし、`subagent/start`をemitして同じrunを返します。`start()`のrejectは未公開resourceのcleanupを意味しlifecycle pairをemitしません。公開後のresult rejectはemit済みpairをcloseします。各continuable Activationはresidency epochごとに同じobserve-only pairをemitするため、cold resumeは固有の`runId`を持つ新しいepochになります。対応する`subagent/end`は同じ識別情報とfinal outputまたはinfrastructure failureを持ちます。両eventはobserve-onlyでlistener exceptionを封じ込めます。`provider` fieldはrunまたはActivation epochを開始したproviderを示し、edge emit時にproviderが登録されたままだと主張しません。

## In-process backend：depthとseed

spawnとfork backendは`parent.ctx`を通じて通常のone-shot agentを作成し、cancelをcore creationへ渡し、`AgentHandle`でdisposeします。continuable childはcontinuation managerが独自のactivation-owner scopeで作成します。provider removalは新しいstartをblockしますが、accepted runをrevokeしません。各childはparent registrationを継承せず新しいflat scopeを取得します。depthとfork seedingは既存のagent／session語彙を再利用します。

- **Delegation depth**は永続`SessionHeader.delegationDepth`とmerge-extensibleなruntime field `AgentOptions.subagentDepth`です。欠落はtop-level depth zeroを意味し、存在する値の大きい方が権威です。両fieldはseamが所有し、loopは設定も読み取りもしません。そのためin-process childはparent depth＋1を永続化し、cold resumeで下げることはできず、各startはsafe-integer domain外または定義されたabsolute `request.maxDepth` capを超えるderived depthを拒否します。
- **Fork seeding**は[`CreateAgentOptions.seed`](core.md#creation-and-ownership)を使います（`AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })`を通す`SessionEvent[]` prefixで、`ctx.agents.resume()`が使うprimitiveと同じです）。fork backendはparent logの*balanced completed-turn prefix*（最後の`turn/end`までを含むparent event）を渡します。そのためseedはcontiguous-from-0で、[invariants](../../packages/runtime-diagnostics/invariants) replayが受け入れます（in-flightでunbalancedなturnは除外）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsubagents--subagentruntime"></a>

### `ctx.subagents` — `SubagentRuntime`

Named provider registry with one-shot runs, durable discovery, and continuable-child operations.

```ts cordis-catalog
/**
 * Establish one durable continuable child and deliver its initial prompt.
 * Resolves when the child's inbox accepts that prompt, without waiting for the
 * turn to start or for the message to reach the Session log; any earlier
 * failure rejects with no ids and rolls back the child entirely.
 * @param spec - provider, delegation request, and caller cancellation.
 * @returns the durable child id and the accepted prompt's message id.
 * @throws when continuation services are unavailable or materialization fails.
 */
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>

/**
 * Deliver one later message to a continuable child as its next FIFO turn. A
 * resident child's Agent inbox accepts it directly (waking a `waiting`
 * Activation), while an absent one is cold-resumed from its persisted
 * Session. The Agent inbox is the only queue, so every accepted message has
 * one observable order.
 * @param parent - the exact live direct parent authorizing this delivery.
 * @param childId - durable child session id.
 * @param content - user-role content to deliver.
 * @param options - the message source fields and caller cancellation, which stops the
 *   operation only before inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when continuation services are unavailable, parent authority is
 *   rejected, or the message was not admitted.
 */
async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>

/**
 * Interrupt one live continuable child's current turn under a human parent
 * address or an exact live ancestor Agent. Fire-and-return: the cancel
 * signal is issued before this returns, but the target may keep running
 * until it observes the signal. Unclaimed pending inbox work, the Activation,
 * and published descendants are preserved; claimed work is not requeued.
 * Once the interrupted driver is idle, a waking send resumes the parked FIFO
 * queue. An absent target — including a one-shot or unknown id —
 * is an accepted no-op, as is a manager-less composition, which cannot own a
 * live Activation.
 * @param targetSessionId - the durable child session id to interrupt.
 * @param authority - the human parent address or exact live ancestor Agent.
 * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
 *   live target.
 */
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void

/**
 * Deliver selected content from one live continuable child to its durable
 * direct parent. The child is the authority credential; callers cannot name a
 * recipient. Reporting does not conclude the child's turn or Activation.
 * @param child - exact live reporting child.
 * @param content - selected model-facing content.
 * @param options - parent scheduling and pre-acceptance cancellation.
 * @returns the stable identity of the parent-accepted message.
 * @throws when continuation services are unavailable, sender authorization
 *   fails, or the direct parent is not live.
 */
async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>

/**
 * Compose one deployment capability into every continuable child's
 * unpublished creation context on fresh creation and cold resume. Grants wait
 * for the next Activation; removing the contribution revokes every resident
 * installation immediately.
 * @param contribution - synchronous child-scope installer.
 * @returns the exact Cordis effect disposer.
 */
registerContinuableSetup(contribution: ContinuableSetupContribution): () => void

/**
 * Close continuable admission below exact live parent Agents, stop only their
 * visible descendant Activations synchronously, then await admitted scoped
 * materializations and release those forests child-first. The scoped cutoff
 * lasts until each exact parent leaves the registry; unrelated parent trees
 * remain live.
 * @param parents - exact host-owned parent Agents entering teardown.
 * @returns once every retained descendant Activation released its `AgentHandle`.
 * @throws an aggregate error after all branches settle when any failed.
 */
async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>

/**
 * Release selected resident continuable direct children of one exact live
 * parent. Other children of the same parent remain admitted and resident.
 * Absent targets and a manager-less composition are accepted no-ops.
 * @param parent - exact live direct parent authorizing the selected release.
 * @param childIds - durable direct-child ids to release when resident.
 * @returns once every selected Activation released its `AgentHandle`.
 * @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
 *   different parent or the supplied parent identity is stale.
 */
async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void>

/**
 * Enumerate the parent's direct session-backed subagents without loading or
 * resuming an Agent and without any query service: the listing merges the live
 * session store with optional session persistence (live-preferred) and
 * serves each child's durable mode/label from the registered `subagent`
 * projection unit down a three-rung ladder — the registry's watermark
 * snapshot for a live child; for a cold one, a durable projection-cache
 * row when the optional cache serves an own-suffix identity (its `seq`
 * gate proves the value postdates the fork seed, where a child's own
 * descriptor is immutable once appended), else one persistence inspection
 * folded through the registry. The
 * projection fold is the single classification authority; per-child
 * diagnostics relay a fold that served no identity or a failed inspection,
 * never a list-time descriptor parse. Absent persistence, enumeration is
 * live-only (a cold child cannot be resumed then either, so its absence is
 * capability absence, not an error). This service consults no Agent
 * registrations, Activations, or providers.
 *
 * Every persistence read receives `signal`, and the listing rechecks
 * cancellation around each of those awaits. Read rejections that settle
 * after an abort become a stable `SubagentError` with code `CANCELLED`.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

/**
 * Enumerate the root's complete session-backed subagent tree in stable
 * pre-order from one live-preferred corpus, without loading or resuming an
 * Agent. Ordinary sessions and one-shot children remain traversal nodes so
 * continuable descendants below them are discovered; each returned entry
 * adds its durable `parentId` and root-relative `depth`. Identity resolution,
 * diagnostics, optional persistence, and cancellation follow the same
 * projection-backed contract as {@link listChildren}.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-candidate diagnostics with tree position, in
 *   stable pre-order.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>

/**
 * Register a provider under its name. Registration is effect-scoped and HMR
 * safe; removing a provider blocks new starts but does not revoke runs that
 * were already returned to their holders.
 * @param provider - the trusted provider implementation.
 * @returns the exact Cordis effect disposer.
 */
registerProvider(provider: SubagentProvider): () => void

/**
 * Look up a provider by name.
 * @param name - the provider name.
 * @returns the provider, or undefined when absent.
 */
getProvider(name: string): SubagentProvider | undefined

/**
 * List registered provider names in insertion order.
 * @returns the registered names.
 */
list(): string[]

/**
 * Establish a published child on the named provider. Capability and semantic
 * checks run before delegation. Provider ownership lasts until its promise
 * fulfills; a rejection therefore has no run for the caller to dispose and
 * emits no run lifecycle events. Post-publication turn and infrastructure
 * failures settle through the returned run.
 * @param name - the provider to use.
 * @param request - child label, prompt, parent, signal, and optional capabilities.
 * @returns the published holder-owned run.
 */
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

Types: [Agent](core.md) · [ContentBlock](llm-streaming.md) · [MessageId](llm-streaming.md) · [SessionId](core.md)

Source: [`packages/subagent/subagent/src/index.ts:171`](../../packages/subagent/subagent/src/index.ts)

<a id="subagent-events"></a>

### `subagent/*` events

<a id="subagentend--emit"></a>

#### `subagent/end` — emit

A published child settled. Scope-filtered dispatch uses the same delegating parent carrier as `subagent/start`, so the lifecycle pair reaches the same scoped audience.

```ts cordis-catalog
/**
 * A published child settled. Scope-filtered dispatch uses the same delegating
 * parent carrier as `subagent/start`, so the lifecycle pair reaches the
 * same scoped audience.
 * @param info - the run identity and terminal outcome.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:166`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-added--emit"></a>

#### `subagent/provider-added` — emit

A provider became resolvable in the registry.

```ts cordis-catalog
/**
 * A provider became resolvable in the registry.
 * @param provider - the registered provider.
 * @mode emit
 */
'subagent/provider-added'(provider: SubagentProvider): void
```

Source: [`packages/subagent/subagent/src/index.ts:140`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-removed--emit"></a>

#### `subagent/provider-removed` — emit

A provider left the registry. Accepted runs remain holder-owned.

```ts cordis-catalog
/**
 * A provider left the registry. Accepted runs remain holder-owned.
 * @param name - the provider name that no longer resolves.
 * @mode emit
 */
'subagent/provider-removed'(name: string): void
```

Source: [`packages/subagent/subagent/src/index.ts:146`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentstart--emit"></a>

#### `subagent/start` — emit

A provider established a published child. For in-process providers, `ctx.agents.get(info.id)` resolves during this notification. Scope-filtered dispatch keys the carrier by the delegating parent, so a parent-scoped listener observes only its own delegations. Paired with `subagent/end`.

```ts cordis-catalog
/**
 * A provider established a published child. For in-process providers,
 * `ctx.agents.get(info.id)` resolves during this notification.
 * Scope-filtered dispatch keys the carrier by the delegating parent, so a
 * parent-scoped listener observes only its own delegations. Paired with
 * `subagent/end`.
 * @param info - the provider and published child identity.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
```

Types: [Scoped](scope.md)

Source: [`packages/subagent/subagent/src/index.ts:157`](../../packages/subagent/subagent/src/index.ts)
<!-- END GENERATED cordis-surface -->
