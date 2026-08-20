# Web ClientのConversation Nodeを追加する

[English](adding-a-conversation-node.md) | [中文](adding-a-conversation-node.zh.md) | 日本語

このチュートリアルでは、Web Client Chatビューに業務側が所有する行を1つ追加します。完成したプラグインは、永続的なSessionイベントファミリーを1つのContextに対応付け、業務Stateを段階的に構築し、型付きStepデータを公開し、Sessionウィンドウや他のレンダリング済みノードを走査せずにキー付きChat Nodeをレンダリングします。Hostがすでにイベントを記録し、クライアントプラグインがWeb bundleに構成されていることを前提とします。外部Host側UIやTrajectoryなど追加の表示対象はこのチュートリアルの範囲外です。

理由と完全なエンジンモデルは[Conversation Node assembly decision](../../.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md)が管理します。このガイドでは実装手順を扱います。

## 1. リプレイ可能なイベントファミリーを設計する

Definitionを書く前に、安定した業務IDを1つ選びます。同じNodeに貢献するすべてのイベントは、そのIDを持つか、自身のペイロードから独立して導出しなければなりません。クライアントは更新を「最後に未完了だった」Contextに割り当ててはいけません。

レビュージョブなら、イベントの約束は次のようになります。

| イベント | 役割 | 必須の永続的事実 |
|---|---|---|
| `review/start` | unique start | `reviewId`, Turn/Step coordinates, title |
| `review/progress` | update | the same `reviewId`, coordinates, replayable progress |
| `review/end` | update | the same `reviewId`, coordinates, final summary |

プロセス境界をまたいで、プロデューサーが所有するブランド付きID型を使います。`SessionEventMap`のマージとペイロード型をプロデューサーの型専用エクスポートに置き、クライアントパッケージから副作用のためにそのエクスポートをインポートします。各`(kind, id)`にはstartイベントを最大1つだけ置けます。単一イベントの業務では、`event.seq`などイベントの安定した識別情報をDefinitionローカルのIDに使えます。

差分イベントもサポートされます。プロデューサーが安価に出力できる場合は、値全体のチェックポイントを優先します。startが読み込み済みウィンドウの外側にある場合にも役立つためです。各deltaは安定IDを持ち、ログ`seq`の昇順でリプレイしたとき決定的なStateを生成しなければならず、実行中だけのメモリに依存してはいけません。現在の履歴ウィンドウに更新だけが含まれる場合、assemblerはpending Contextを保持し、古いページがstartを提供するまでStateを構築しません。startの読み込み前に製品がレンダリングする必要がある場合、terminalまたはcheckpointイベントが、Definitionが結果を直接構築できるだけの値全体のフォールバックStateを持つ必要があります。無関係なイベントを走査して復元してはいけません。

## 2. Definitionと型付きChatペイロードを実装する

例では関係全体が見えるよう、プロデューサーの宣言とクライアントの貢献を1つのブロックにまとめています。パッケージファミリーでは、ブランド付きIDと`SessionEventMap`宣言をイベントプロデューサーと同じ場所に置き、Definition、Chatデータのマージ、rendererをクライアントプラグインに置きます。

```ts ignore-check
import { createElement } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ClientContext, ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ReviewId = Branded<'ReviewId'>

interface ReviewStartData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly title: string
}

interface ReviewProgressData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly completed: number
}

interface ReviewEndData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly summary: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one durable review job.
     * @mode emit
     * @param data - stable identity, location, and initial display state.
     */
    'review/start': ReviewStartData
    /**
     * Records replayable progress for one review job.
     * @mode emit
     * @param data - stable identity, location, and latest progress.
     */
    'review/progress': ReviewProgressData
    /**
     * Closes one review job with its final summary.
     * @mode emit
     * @param data - stable identity, location, and final display state.
     */
    'review/end': ReviewEndData
  }
}

interface ReviewChatData {
  readonly title: string
  readonly completed: number
  readonly status: 'running' | 'completed'
  readonly summary?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'review-job': ReviewChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'review-job': ReviewChatData
  }
}

interface ReviewState extends ReviewChatData {
  readonly turn: number
  readonly step: number
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewData(state: ReviewState): ReviewChatData {
  return {
    title: state.title,
    completed: state.completed,
    status: state.status,
    ...state.summary === undefined ? {} : { summary: state.summary },
  }
}

const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'review/start') throw new Error('review-job requires review/start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      title: match.event.data.title,
      completed: 0,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed', summary: match.event.data.summary }
    }
    return context.state
  },
  publication: match => match.event.type === 'review/progress'
    ? 'animation-frame'
    : 'immediate',
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'review-job',
      value: viewData(context.state),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'review-job',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}

function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ?? `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'review-job',
  }, ReviewNodeView))
}
```

`match(event)`はfoldではなく識別情報の抽出器です。現在のイベントだけを受け取り、DefinitionローカルのIDとライフサイクルの役割を返します。matchの後、assemblerは`(kind, id)`でContextを特定し、`start`を1回呼ぶか、現在のStateで`update`を呼びます。両方の関数はエンジンが採用するStateを返します。新しい不変値を返すのが望ましいですが、同じオブジェクトを変更して返す関数も同じ採用セマンティクスになります。

`buildLocationData(context, scope)`は、Definitionが所有するデータをエンジン所有のTurnまたはStepへ任意で公開します。宣言マージを使って各キーに正確な値型を与えます。同じLocationにある別のNodeは、`useTurnData(key)`のような制約付きslotフックを通じて値を利用できます。Sessionを受け取ったり、`snapshot.chat.nodes`を走査したりする必要はありません。

`target`と`buildViewNode(context)`は1つの対象所有のレンダリング貢献を宣言し、必ず一緒に指定します。`context.key`をReact側の識別情報として保持し、永続的な順序の証拠から`anchorSeq`を選び、rendererがそのまま使えるデータだけを返します。対象Nodeを公開した後は同じキーを返し続けます。表示フローから一時的に外す場合は、`null`で取り消すのではなく`visibility: 'hidden'`を使います。

## 3. 開始時だけ以前の業務Contextを照会する

一部のDefinitionは、別の業務種別について直前のStateを必要とします。`start`は`ConversationContextReader`を受け取るため、Contextの集合を受け取ったりイベントを走査したりせず、そこで`reader.previous<State>(kind)`を呼びます。readerは現在のstart`seq`より前で、最も近い開始済みContextを読み取り専用データとして返します。

assemblerはその依存関係を記録します。後から古いprependがより近い先行Contextを提供したり、以前は不明だったウィンドウの隙間を埋めたり、先行Stateを改訂したりすると、依存するContextを`start`から再実行し、`seq`の昇順で更新をリプレイします。照会されるDefinitionは有用なStateを書く責任を持ちます。readerは業務固有の照会メソッドを公開せず、別のContextを変更する権限も与えません。

## 4. 3つの取り込み経路を理解する

履歴は末尾から1ページずつ後方へ要求できますが、受け入れた各ページはStateをリプレイする前に`seq`昇順へ正規化されます。

| 経路 | エンジンの処理 | Definitionから見える動作 |
|---|---|---|
| 開くとき、再同期、隙間の修復で置換 | 読み込み済みウィンドウを再構築し、Definitionごとに各イベントを1回matchしてから、開始済みの各Contextをリプレイする | `start`の後、`seq`昇順で更新が続く。更新だけのpending ContextはStateなしで残る |
| 古いページを1つprepend | 新しい古いイベントだけをmatchし、`(kind, id)`でContextにマージし、既存のキー付きノードを保持し、影響を受けたContextと依存関係だけをリプレイする | 新しく見つかったstartが収集済み更新を有効にする。Locationまたは先行Contextが変わるとContextを再実行することがある |
| 実行中イベントを1つappend | 各Definitionの`match`を1回呼び、キーでmatchしたContextを検索し、そのContextだけを更新する | start後の一致イベントに対して`update`を1回行い、要求された公開を1回行う。既存Contextの走査はない |

登録済みDefinitionが`D`個ある場合、1つの入力イベントは現在イベントへのmatchを`D`回行い、match後は一定時間でContextキーを検索します。Definitionのコードはこの性質を保たなければなりません。通常のappend経路でイベントウィンドウ全体、すべてのContext、`context.matches`、レンダリング済みNodeの集合を走査しないでください。蓄積した事実にはState、同じTurn／Step間の共有にはLocationデータ、インデックス化された先行依存には`reader.previous()`を使います。

`publication`は変更されたStateを具体化する時期を制御します。構造または終端の変更には`immediate`、高頻度で表示する差分には`animation-frame`、Stateの変更が後続の公開にだけ入力される場合は`none`を使います。エンジンはすべての更新をログ順に適用し、cadenceはビュー公開をまとめるだけです。

## 5. リプレイ、ページング、レンダリングを検証する

次の結果を確認する、対象を絞ったテストを追加します。

1. 完全なウィンドウをreplaceに渡すと、期待する最終State、Locationデータ、Nodeペイロード、`anchorSeq`が生成される。
2. 更新だけの末尾はpendingのままで、唯一のstartをprependすると完全なreplaceと同じ結果になる。
3. 初期履歴に実行中appendを続けた結果が、結合したウィンドウをリプレイした結果と同じになる。
4. 古いページをprependすると、データが変わっていない既存のキー付きNode値を置き換えずに古い行が追加される。
5. 表示される差分を繰り返しても`context.key`が保持され、要求時にはアニメーションフレームごとに最大1回公開される。
6. キー付きrendererは`node.data`と制約付きLocationフックだけを使い、Sessionイベントウィンドウ、Context、Chat Nodeを走査しない。

ストリーミングと割り込みには[`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts)、先行Contextの照会には[`inbox.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/inbox.ts)と[`message.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/message.ts)、独自Nodeを作らずにTurnデータを公開するDefinitionには[`packages/client/ui-deliverables`](../../packages/client/ui-deliverables)を使います。
