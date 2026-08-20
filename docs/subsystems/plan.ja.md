# Plan Mode

[English](plan.md) | [中文](plan.zh.md) | 日本語

[dsh-plan-mode](../../packages/plan/plan-mode)（`ctx.planMode`、`PlanModeController`）が所有する、agentごとに記録される協調状態です。activeの間はdeployment所有のguidance sectionが各model requestに含まれます。Plan modeは**soft guidance**です。[Sandbox mode](sandbox.md)と[approval policy](approval.md)は独立して制限を強制し、どちらもplan stateを読み書きしないため、deploymentは別々に設定します。パッケージは任意で、agent loopは依存しません。`plan:policy` prompt sectionを提供し、`exit_plan_mode` toolと`/plan` commandを登録します。理由は[design note](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)、model experienceと制限の詳細は[package README](../../packages/plan/plan-mode/README.md)が管理します。

Source: [`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## 記録状態と復旧

`plan/mode`（`{ active: boolean }`）はlog-onlyで全値置換する[session event](session.md)です。永続化・replay可能ですがmodel transcriptには入りません。`foldPlanMode(events, end?)`はprefixの最後に記録された値を返し、なければ`false`を返します。現在有効な状態は常にsession logのpure foldであるため、resume、fork、compactionはlive mirrorなしで復元でき、UIは`session/event`を通じてcommit済みの切り替えを観測します。完全なevent宣言は[persistence log event catalog](../persistence-catalog.md)にあります。

## 保留中の選択とpre-step append

すべてのsession eventがturnに囲まれるため、user selectionは、次に受理されたin-turn pre-stepがrequest derivation前にappendするまでpendingのままです。選択が行われるturnは問いません。選択はcontinuationを強制しないため、turn最後の受理済みpre-step後に行われたものは後続turnでappendされます。`set(agent, active)`はpending selectionを記録します（targetがloggedまたはすでにpendingのstateと等しい場合はno-op）。`get(agent)`は`{ active: boolean; pending?: boolean }`を返し、現在のstep assemblyに使うlogged stateとappend待ちのselected stateを含みます。

agentがrunning中にappendできる唯一の箇所は、prependされた`agent/pre-step` listenerです。turn 1 step 1やrequest-recovery retryを含むすべての提案request stepを監視し、先にdownstream listenerを呼び出し、stepが受理された後だけappendします。prompt admissionはturn前に行われ、`plan/mode`をappendできません。そのためpromptで行われた選択は、そのturnの最初の受理済みin-turn pre-stepがappendします。append failureはturnをblockせず、selectionは後続の受理済みin-turn pre-stepまでpendingのままです。appendされたuser selectionはplugin-sourcedな`user/message` noticeも1つ記録しますが、最後に記録されたrequest headerが別のstateを示す場合だけです。これによりmodelにはcontextが変わった時だけ正確に伝わり、重複しません。turn最後の受理済みpre-step後に行われた選択はprocess-localのままで、次の受理済みin-turn pre-step前にprocessが終了すると失われます（[README limitation](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)）。

## 設定

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

`section`の欠落、空、文字列以外、および未知のkeyは無視せずplugin load時に失敗します。plan modeがactiveの間、正確な`section` textがorder 50の`plan:policy` [system-prompt section](system-prompt.md)としてrenderされます。inactive plan modeはtextを提供しません。

## exit toolと`/plan` command

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode)はplan modeがinactiveでも登録されたままです。そのためplan modeの開始・終了で変わるのはprompt sectionだけで、request tool catalogは変わりません。plan mode外での実行は失敗します。plan mode中は`#` headingで始まる完全なmarkdown planを要求し、[user-questions seam](user-questions.md)を通じてreviewに提示します。Approvalが`{ approved: true }`を返すと、silent（non-narrated）pending exitを記録し、次の受理済みin-turn pre-stepでappendします。そのため現在のassistant tool batchの残りではplan guidanceがactiveのままで、tool result自身が遷移を報告します。planning継続はuser feedbackを持つfailed callであり、modelはplanを修正して再提示します。interaction channelがない場合やreview中にserviceがreloadされた場合も、plan modeを黙って終了せずcallを失敗させます。

[`ctx.commands`](commands.md)がcomposeされると、pluginは`/plan [off|message]`を登録します。裸の`/plan`はplan modeを選択し、それ以外の空でないmessageはplan modeを選択してから`agent.steer()`でtextを送ります。textはplan guidanceの下で次のstepの通常のlogged user messageになります。引数が正確に`off`の場合はinactiveを選択し、appendされてrequestから見える前のpending entryもcancelします。

## Service

`ctx.planMode`はlogged plan stateを所有し、step startでselected stateを適用してnarrateします。また`plan:policy` section、`/plan` command、安定したexit toolを所有します。`get`／`set` signatureは生成された[service catalog](#ctxplanmode--planmodecontroller)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanmode--planmodecontroller"></a>

### `ctx.planMode` — `PlanModeController`

`ctx.planMode`: owns logged plan state, applies and narrates selected state at step start, the `plan:policy` section, the `/plan` command, and the stable exit tool. UIs observe committed flips through `session/event`; there is no live mirror.

```ts cordis-catalog
/**
 * Read the logged plan state and any selected state awaiting the next
 * accepted in-turn pre-step.
 *
 * @param agent The agent to read.
 * @returns Current logged state plus a pending selection, when present.
 */
get(agent: Agent): { active: boolean; pending?: boolean }

/**
 * Select whether plan mode should be active. Between turns the method
 * appends the change immediately because no in-turn pre-step will run until
 * another prompt starts a turn. The open-turn fold is the idle signal:
 * agent status stays `running` through post-turn checkpointing, when no
 * further in-turn pre-step runs. During an open turn the selection remains
 * pending until the next accepted in-turn pre-step. Repeated selection of
 * the current or already-pending state is a no-op.
 *
 * @param agent The agent to switch.
 * @param active Whether plan mode should be active.
 * @returns what happened: `committed` (logged now), `queued` (awaiting the
 * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
 * was cleared; the logged state already matches), or `noop` (already in that
 * state).
 */
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

Types: [Agent](core.md)

Source: [`packages/plan/plan-mode/src/index.ts:188`](../../packages/plan/plan-mode/src/index.ts)
<!-- END GENERATED cordis-surface -->
