# ユーザーインタラクション

[English](user-questions.md) | [中文](user-questions.zh.md) | 日本語

[dsh-user-questions](../../packages/interaction/user-questions)のuser-questions seamです。agentが続行する前に人間の回答を必要とする場合、toolやpermission pluginが使うprovider-neutralな語彙です。UI surfaceはactiveな`UserQuestionProvider`を提供し、host runtimeは接続されたclientへrequestをrelayします。

Source: [`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## 質問の選択肢

`AskUserQuestionOption`は選択可能なchoiceを1つ含みます。`label`はユーザー向けのoption textであり、model向けのselected valueでもあります。`description`は任意のUI help textです。

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## 表示意図

`AskUserQuestionIntent`は既知の判断種別を任意で宣言します。`kind`でtag付けされるためintentを追加できます。tagを認識しないUIはgeneric option listを描画します。intentは表示だけを変更します。intentを尊重するUIも、generic UIが送るのと同じoption labelで回答するため、呼び出し側が読むanswer fieldは同じです。`approve`はoption順に依存せず肯定optionを指定します。`ask()`は型で表現できない2つの条件、質問自身のoptionを1つも指定しない`approve`と、`detail`のない質問上のintentを拒否します。

```ts type-equiv
/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}
```

## 質問項目

`AskUserQuestionItem`はrequest内の1つの質問です。呼び出し側が安定した`id`を指定し、回答時にecho backされるため、batchされた質問もrouting可能です。任意の`detail`は補足textを運び、providerは質問とともに描画しますが、選択可能なoption labelには含めません。

```ts type-equiv
/** One question in a user-questions request. */
interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}
```

## Ask request

`AskUserQuestionRequest`はパッケージ間で使うrequestです。`questions`はarrayなので、UIは関連するpromptを1つのflowで提示しつつ回答ごとの安定したidを保持できます。`agent`がある場合は正確なlive callerです。interaction seamはlive registryがそのinstanceをruntime rootと識別する間だけ受け入れます。

```ts type-equiv
/** Request for a human answer. */
interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}
```

## 回答

providerはquestion idごとにanswer itemを1つ返します。`selected`は選択されたoption labelを含み、`custom`はユーザーが入力した自由形式の「Other」回答を運びます。single-select questionでは`custom`がselected choiceを上書きし、`selected`は空です。multi-select questionでは`custom`が`selected`のlabelを補足できます。UIは`selected`が空で`custom`がないitemを使い、他の質問が完了したbatch内でskipされた質問を保持することもできます。

```ts type-equiv
/** Answer to one question. */
interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}
```

```ts type-equiv
/** The human's answer. */
interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
```

## Provider

1つのcontextでactiveにできるproviderは1つだけです。provider登録はeffectに束縛されるため、HMRまたはdisposeでactive UIが削除されます。

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## エラー

`UserQuestionError`は`HarnessError`をextendsするため、`ctx.tools.execute()`は`EMPTY_QUESTIONS`、`NO_PROVIDER`、`ASK_ABORTED`、UI側cancelなど、model向けtool failureの`{ name, code }`を保持します。

```ts type-equiv
/** Stable error taxonomy for user-questions failures. */
class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxuserquestions--userquestionservice"></a>

### `ctx.userQuestions` — `UserQuestionService`

`ctx.userQuestions`: one active UI provider plus an `ask()` API.

```ts cordis-catalog
/**
 * Register the UI provider. Only one provider may be active in a context.
 *
 * @param provider UI-side implementation that collects answers.
 * @returns Disposer that unregisters this provider.
 */
registerProvider(provider: UserQuestionProvider): () => void

/**
 * Ask the active UI provider and wait for the user's answer.
 *
 * When a caller supplies an agent, human interaction is valid only for the
 * exact live runtime root. Runtime ownership, not durable session lineage,
 * decides this boundary: an owned child has no human answerer and would
 * block forever, while a lineage-bearing session resumed as a new runtime
 * root may ask normally.
 *
 * @param request Questions, owner agent, and abort signal.
 * @returns The answer chosen or typed by the human.
 * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
 *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
 *   when that live agent is owned by another agent.
 */
async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

Source: [`packages/interaction/user-questions/src/index.ts:51`](../../packages/interaction/user-questions/src/index.ts)
<!-- END GENERATED cordis-surface -->
