# Cookbook：拡張プラグインの形式

[English](extension-cookbook.md) | [中文](extension-cookbook.zh.md) | 日本語

Harnessを拡張するためのパターンリファレンスです。スニペットではインポートとヘルパー実装を省略しており、そのままコピーして完成するものではありません。具体的な作成手順は、[パッケージのチェックリスト](adding-a-package.md)、[最初のツールのチュートリアル](../user/develop/basic/tool.md)、[ツールリファレンス](adding-a-tool.md)、[LLMアダプターガイド](adding-an-llm-adapter.md)を参照してください。システムと拡張点のマップは[アーキテクチャ](../architecture.md)が管理します。

## ツールプラグイン

ツールは`ctx.tools`に登録します。型付きの`execute`引数、結果の構築、`run_in_background`パターンを含む注釈付き`defineTool`の例は[adding-a-tool.md](adding-a-tool.md)にあります。このガイドがツール定義の正です。Raw JSON-Schemaの`ToolDefinition`も`ctx.tools.register()`で直接受け付けます（MCP由来のツールはこの方法で登録されます）。`defineTool`はファーストパーティツール向けの型付きヘルパーです。

## フックプラグイン（permission-gateの例）

このpermission gateはフックプラグインの一例です。`tools/pre-execute`ゲートから型付きの判断を返し、呼び出しを許可または拒否します。サンドボックス、権限、plan-modeプラグインもこの拡張点を使えます。フックプラグインは他の拡張点もインターセプトでき、本質的にpermission gateとは限りません。「native hook」はインターセプト点に置く通常のCordisプラグインで、外部プロトコルは必要ありません。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

このwaterfallは順序を変更できるポリシーレイヤーです。不変条件に単調な最終拒否が必要なら`ctx.tools.guard()`、実際のディスパッチのライフタイムをラップする必要があるなら`tools/execute`（タイムアウト／リトライ／メトリクス。置換できるのは`exec.signal`だけ）、明示的な結果変換には`tools/post-execute`、不変な最終結果を封じ込めて観測するには`tools/result`を使います。選択規則は[ツール作成ガイド](adding-a-tool.md#execution-policy-and-observation)にあります。

## UIプラグイン

UIプラグインは`session/event`フィード（`assistant/chunk`としてのassistantトークンストリーム、turn／step境界、ツール活動）からレンダリングし、`agent.followup()`／`agent.steer()`で入力を戻します。組み込みWeb Clientに業務行を追加するブラウザープラグインは、代わりに`ConversationNodeDefinition`とキー付きChat rendererを登録します。[Conversation Nodeガイド](adding-a-conversation-node.md)に従ってください。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

declare function render(text: string): void
declare function onUserInput(handler: (text: string) => void): void

export const name = 'my-ui'
export const inject = ['agents']

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      render(event.data.chunk.text)
    }
  })
  onUserInput(text => ctx.agents.get(SessionId('client-session'))?.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })))
}
```

## 外部プロトコルドライバー

*protocol driver*はwire peerを`ctx.agents`に適応させ、UIまたは自動化クライアントに提供できます。stdioドライバーはstdoutを所有し、ファクトリーを通じてagentを作成または再開し、プロトコルリクエストを`followup()`または`cancel()`に対応付けます。低レベルのプロンプトリクエストは永続的なenqueue receiptを返しますが、`MessageId`と`turn/end`を対応付けて結果を取得することはありません。agent全体の状態は別途公開します。自動化メソッドはreceiptから次のidleまで待って、明示的に所有する区間を要約できます。一方UIは通常、終端のないイベントストリームを監視し続けます。`AgentHandle.dispose()`でagentを解体し、disposeが完全停止に到達するようにします。

[`packages/acp/acp`](../../packages/acp/acp)は自動化専用の実例です。Agent Client Protocol JSON-RPC stdioで新しいテキストセッションを公開し、確定したassistantテキストを発行し、所有するagent向けにワンショットのマシン権限回答者を登録します。正確なメソッド、イベント順、ライフサイクルの約束は[README](../../packages/acp/acp/README.md)で定義します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-protocol-bridge'
export const inject = ['agents', 'sessions', 'sessionPersistence']

export function apply(ctx: Context) {
  // Stream every logged assistant text/reasoning delta out to the client.
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        // sendToClient({ kind: 'message_chunk', text: chunk.text })
      }
    }
  })
  // Inbound "prompt": create/resume an agent, feed it, and return its enqueue receipt.
  // Whole-agent status is a separate notification; no turn end belongs to this prompt.
  // Teardown reaches quiescence via AgentHandle.dispose() (stop + await exit).
}
```

## 実行可能な配線

実行可能なleafは`examples/*/cordis.yml`からプラグインツリーを読み込みます。ルートの`demo:*`スクリプトと各leafディレクトリが正の一覧です。製品の`dsh`ランチャーはWebとワンショットheadless実行を所有し、ACP leafは[`@deepseek-ai/dsh-acp-demo`](../../packages/examples/acp-demo)、JSON-RPC leafは[`@deepseek-ai/dsh-sdk-jsonrpc-demo`](../../packages/examples/jsonrpc-demo)を使います。headlessスナップショットleafは[`@deepseek-ai/dsh-agent-spine-demo`](../../packages/examples/agent-spine-demo)とJSONL永続化を明示的にマウントし、公開アプリパッケージではなく例が所有するテストfixtureで駆動します。

## 機能 → 仕組みのマップ

すべての製品機能は、文書化された拡張点のリスナーに対応付けられます。これはmicrokernelという主張を検証可能にしたものです（[microkernel Agent Note](../../.agents/notes/implemented/architecture/2026-06-11-microkernel-event-taxonomy.md)）。どの行もループを変更しません。

`system-prompt/assemble`は専門的な協調型の全体組み立て変換です。返された組み立て結果が正なので、リスナー作成者は有効なCode Modeとstructured-outputプロトコルの貢献を保持する責任を持ちます。表示、検索、実行の間で整合させる必要があるツールフィルタリングには`ctx.tools.restrict()`を優先します。

| 製品機能 | プラグインの仕組み |
|---|---|
| フックシステム（ユーザー＋プロジェクトレベル） | `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/post-execute`、`agent/turn-stopping`のリスナー。waterfallは型付き判断を返し、`agent/turn-stopping`は別のstepをsteerできる。`dsh-hooks-claude-code`／`dsh-hooks-codex`ブリッジがフック設定ファイルをこれらの拡張点へ対応付ける |
| `/goal` | `ctx.goals`が永続状態を所有し、`dsh-goal-round-driver`が公開`Agent`を通じて同一セッションのroundをスケジュールし、別のコマンド／ツールプロデューサーが人間／モデルの制御を公開する |
| `/loop` | `turn/end`セッションイベントで次の反復に`followup()`する、または強制継続する |
| 動的ワークフロー | `ctx.workflowEngine`＋worker-thread engine＋`workflow`ツール。スコープ付きプロンプト／ツール登録、単調なツールガード、最終`tools/result`コミット（外側の`run_code`を含む）、structured-output実行の単調な`concludeTurn()`マーカーで、構造化された同一プロセス内の子が出力を強制する |
| キュー済み＋steeringメッセージ | コアの`Agent.followup()`／`Agent.steer()` |
| コンテキスト圧縮（自動＋手動） | `ctx.compaction` seam＋`dsh-compaction-basic`。自動負荷はserialの`agent/pre-step`で実行し、正規オーバーフロー復旧は`agent/request-error`で実行し、手動呼び出し側は同じcompactサービスを使う（[compaction Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)） |
| システムプロンプトの設定可能性 | 順序とスコープローカルシャドーイングを持つ`ctx.systemPrompt.section()` |
| AGENTS.md（ルート） | ファイルを読むセクションプロバイダー |
| AGENTS.md（サブディレクトリ、接触時）＋ファイル変更通知 | watcher／ツール結果リスナーからの`agent.inject()` |
| 組み込みツール | `ctx.tools.register()`。スキーマは自動的に組み立てへ流れる。`dsh-tool-*`ファミリー（bash、fs、web、subagent、todo）が提供済みの例 |
| ToolSearch／段階的開示 | 表示セットの変化に応じてスコープ付き`ctx.tools.restrict()`登録を置き換え、レジストリが表示、検索、実行の整合性を保つ |
| ツールの期限／リトライ／メトリクス | `tools/execute`でコアディスパッチをラップする。ラッパーは`exec.signal`を置き換え、委譲し、同じ字句ライフタイムで正規化済み結果を調べられる |
| 最終ツール結果のメトリクス／監査／取得 | `tools/result`で不変な正の結果を観測する。プラグインが結果を変換またはコンテキストを追加する必要がある場合だけ`tools/post-execute`を使う |
| 単調な終端turnポリシー | 成功した終端ツールから`ToolExecution.concludeTurn()`を呼ぶ。同じ応答内の後続ツール呼び出しは引き続きガード可能で、ループはstep後に停止する |
| サブプロセスサンドボックス（landlock／sandbox-exec） | `dsh-bash-sandbox`を通じて`ctx.sandbox`バックエンドを使い、能力レベルの拒否には`tools/pre-execute`を使う |
| 権限システム／AskUserQuestion | `tools/pre-execute`から`ask`を返し、`ctx.approval`で回答する。通常のユーザー質問には別のモデル向けaskツールを登録する |
| Plan mode | [`@deepseek-ai/dsh-plan-mode`](../../packages/plan/plan-mode/README.md)。ログに記録する`plan/mode`状態、`plan:policy`案内セクション、`/plan [message]`エントリ、`/plan off`の直接終了、ユーザーが確認する`exit_plan_mode`終了。強制は独立したサンドボックス／承認軸に残る |
| Sub-agent委任 | `ctx.subagents`プロバイダーレジストリ（`dsh-subagent-spawn-in-process`／`-fork`／`-acp`／`-codex`／`-claude-code`／`-dsh-sdk`）＋設定済みプロバイダーをモデルに公開する`dsh-tool-subagent` |
| MCP | サーバーごとに1つのプラグイン。ツールを検出して`ctx.tools.register()`する |
| Skills | セクション＋ツール登録。呼び出し時に`inject()`でskillコンテンツを追加する |
| Memory | セクションプロバイダー＋ツール |
| スケジュールタスク（cron） | プラグインがモデル向けスケジューリングツールを登録する。タイマー発火時、アイドルなら`followup(…, {source: {kind: 'cron', …}})`、ビジーなら`inject()`通知を行う |
| UI（GUI、CLIはJSONLを出力） | `session/event`（assistantチャンク、境界、ツール活動）を待ち受け、入力を`followup()`へ渡す |
| Web Client Chat業務ノード | `ConversationNodeDefinition`と`conversation.chat.node`のキー付きrendererを登録する |
| SessionTelemetryBackend／リプレイ可能なtrace | `session/event` → JSONL。リプレイは`sessions.create(id, { seed })` |
| モデルアダプター | `registerAdapter`による`LlmAdapter`サブクラス（`dsh-llm-deepseek`、`dsh-llm-pi-ai`） |
| プラグインのホットリロード | すべての登録が`ctx.effect`なので、vendor管理のHMRがそのまま動作する |
