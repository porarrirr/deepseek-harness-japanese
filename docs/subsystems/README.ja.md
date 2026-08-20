# サブシステム

[English](README.md) | [中文](README.zh.md) | 日本語

DeepSeek Harnessの各サブシステムにつき1ページを用意します。サブシステムの概要、扱うデータ構造、`ctx`サービスまたはイベントスコープが支える場合はサービスとイベントのリファレンスを載せた生成**Cordis API**セクションを記載します。このフォルダーは、サブシステムをまたぐ*動作*（サービスマップ、session／turn／stepのライフサイクル、イベント分類）を説明する[architecture.md](../architecture.md)を補完します。各ページは1つのサブシステムの語彙と配線のリファレンスです。

| ページ | 所有するもの |
|---|---|
| [core.md](core.md) | `packages/core`によるagent loopの制御：パッケージごとのループ説明、agentの作成と所有（`AgentHandle`）、`Agent`ハンドルの配送／キャンセル／インターセプトの約束、リポジトリ全体の型パターン（`…Map → derived-union`、branded id） |
| [llm-streaming.md](llm-streaming.md) | `packages/llm`の会話型：`Message`／`ContentBlock`、組み立てられたモデルリクエスト、`StreamChunk`ワイヤープロトコルとアダプターの約束、`BlockAssembler`、`LlmAdapter`プロバイダーの約束 |
| [token-meter.md](token-meter.md) | 消費済みログのリビジョンを伴う、不変スカラーおよび位置付きリプレイ計測 |
| [scope.md](scope.md) | スコープ付き登録の識別情報、ディスパッチキャリア、所有される`Scope`コンテキスト |
| [typert.md](typert.md) | リモート呼び出し記述子、lookup／Context宣言、Typertレジストリ、Host Gateway／Client APIの境界 |
| [goal.md](goal.md) | 永続化されたgoalの識別情報、ライフサイクルスナップショット、アクティベーション、変更レコード、ラウンドへの帰属 |
| [schedule.md](schedule.md) | セッションローカルなリマインダーレコード、永続的な遷移、アクティブビュー、通常会話への配信 |
| [commands.md](commands.md) | 人間コマンドのレジストリサービス：定義、アダプター検出、直接呼び出し、結果、解析ビュー |
| [session.md](session.md) | `SessionEventMap`の全variantカタログ、`TurnTrigger`／`TurnEndReason`、`deriveMessages()`、実行エンクロージャー、スタンドアロンイベント |
| [persistence.md](persistence.md) | 永続化のcapability seam：`SessionPersistence`、JSONL＋SQLiteバックエンド、`session/flush`、クラッシュリカバリー、`SessionHeader` |
| [settings.md](settings.md) | ユーザー設定のcapability seam：`SettingsNamespace`登録、レイヤー化された解決（defaults → composition `base` → user document）、owner scope、ホットコミット |
| [credentials.md](credentials.md) | credentialのcapability seam：設定内の`CredentialRef`参照（値ではない）、操作ごとの解決、UIで安全な`CredentialInfo`、プロバイダーのソースレイヤー |
| [session-query.md](session-query.md) | 論理レコード、範囲を限定した正確なイベント読み取り、関係トレース、意味フィルター／ドキュメント、全文検索結果ページ |
| [feedback.md](feedback.md) | ライフサイクルに束縛されたメッセージごとのフィードバックレコード、楽観的バージョン、サイドカー永続化、Host Remoteの約束 |
| [session-title.md](session-title.md) | 永続的なタイトルスナップショット、引用元メッセージのseq、非同期プロバイダーの約束 |
| [session-reference.md](session-reference.md) | 構造化されたセッション間参照：`SessionReferenceInput`／`Candidate`、準備済みメッセージコンテキスト、安定したエラー分類 |
| [system-prompt.md](system-prompt.md) | アセンブリごとのコンテキスト、ツールプロバイダーの結果、プロンプトセクション、協調的なアセンブリ |
| [tools.md](tools.md) | `ToolDefinition`の全フィールド、スキーマDSL、`ToolExecution`／`ToolResult`、ツール表示UI型、保護された実行パイプライン |
| [user-questions.md](user-questions.md) | UI接続された人間の質問／回答capability seam：`AskUserQuestionRequest`、回答／オプションの語彙、プロバイダーAPI、エラー分類 |
| [approval.md](approval.md) | 一回限りのユーザー承認capability seam：`ApprovalRequest`、`ApprovalOutcome`、セッションごとのポリシー、監査イベント、回答者の約束 |
| [attachment.md](attachment.md) | 永続的な画像の識別情報とメタデータ、検証入力、検証済み読み取り、`AttachmentStore`のcapability seam |
| [shell.md](shell.md) | bash実行器のcapability seam：`ShellExecRequest`／`Spec`、`ShellRunResult`、バックグラウンドの`ShellProcess`ハンドル |
| [subprocess.md](subprocess.md) | subprocessのcapability seam：完全明示的な`SubprocessSpawnSpec`、オフセットベースの出力リーダー、未分類の`SubprocessOutcome`、管理対象`DSH_*`環境の語彙 |
| [terminal.md](terminal.md) | 永続的なterminal id、バックエンド／セッションの約束、送信可能状態、範囲を限定した読み取り、ownerから見えるスナップショット |
| [sandbox.md](sandbox.md) | セッションごとのポリシー解決とプロセス隔離のcapability seam：ファイル効果モード、実行／プロバイダーポリシー、`ConfinedArgv`、強制適用、fail-closedエラー |
| [code-runtime.md](code-runtime.md) | コード実行のcapability seam：`CodeRunRequest`／`Result`、バインディング名前空間、キャプチャされたログ、`CodeRunFailure`分類 |
| [extensions.md](extensions.md) | バージョン管理された動的Cordis PluginとPackage、Host／Clientアクティベーション、承認、ランタイム検査、ライフサイクルの解体 |
| [filesystem.md](filesystem.md) | filesystemのcapability seam：`FsTarget`、読み取り／書き込み／編集結果、観測されたファイル状態、`FsErrorCode` |
| [lsp.md](lsp.md) | LSPナビゲーションのcapability seam：`LspQueryRequest`／`Result`、`LspProvider`／`Service`、4つの操作、`LspError` |
| [skills.md](skills.md) | skillサービス：検出優先度、`SkillSummary`／`SkillDefinition`、セッションプレフィックスカタログ、モデル向け`skill`読み込み |
| [compaction.md](compaction.md) | compactionのcapability seam：`compaction/*`セッションイベント、`CompactionResult`、`CompactionEngine`インターフェース |
| [subagent.md](subagent.md) | subagentのcapability seam：名前付きプロバイダーレジストリ、`SubagentStartRequest`／`Result`／`Run`、開始時とランタイムのcapability分割 |
| [agent-team.md](agent-team.md) | Agent Teams：暗黙のLead識別情報、名前付きで継続可能なteammate、永続的なpeer mailbox、共有タスクDAG |
| [web.md](web.md) | webアクセスのcapability seam：`WebSearchRequest`／`Result`、`WebFetchRequest`／`Result`、`WebFetchBody`、プロバイダーの可用性、`WebError` |
| [spill.md](spill.md) | spillストレージのcapability seam：`SaveTextSpill`、`SpillOwner`／`SpillSource`、`SpillRef`、brandedな`SpillLocator` |
| [workflow.md](workflow.md) | workflowのcapability seam：`WorkflowStartRequest`、`WorkflowMeta`、`WorkflowRun`／`Result`、`workflow/*`イベントpayload、`WorkflowError`の致命性 |
| [jobs.md](jobs.md) | バックグラウンドジョブランタイム：brandedな`JobId`、producerの約束、consumerビュー、`ctx.jobs`サービスの動作 |
| [permission-presets.md](permission-presets.md) | permission-presetレイヤー：`PresetSpec`／`PresetOption`、派生した`custom`状態、ログ専用の`permission/preset`イベント |
| [plan.md](plan.md) | plan mode：ログ専用の`plan/mode`状態、保留中の選択のflush、`PlanModeConfig`、`exit_plan_mode`レビューの流れ |
| [invariants.md](invariants.md) | ランタイム不変条件レジストリ：選択用`Config`、`InvariantInstaller`／`InvariantFailure`、空companionの約束 |
| [web-server.md](web-server.md) | HTTPキャリア：`WebRouteKind`／`WebRoute`、マッチ順序、claim可能なフォールバック枠、index tap |
| [storage.md](storage.md) | storageサブシステム：バックエンドの約束（`StorageBackend`）、`StorageForms`、`DomainSpec`／`Domain`、`domain/changed` |
| [workspace.md](workspace.md) | workspaceレジストリ：`Workspace`／`WorkspaceId`、登録と解決、セッション`cwd`の関係 |
| [client-modules.md](client-modules.md) | webプラグインテーブル：`dsh.client`宣言、`WebBootGraph`ワイヤー構成、bundle route、index tap |
| [session-projection.md](session-projection.md) | projectionのcapability seam：`SessionProjectionMap`、純粋な`ProjectionDefinition`単位、`ProjectionSnapshot`の一貫したカット、変更フィード |
| [session-telemetry.md](session-telemetry.md) | 外向きセッション報告capability seam：`SessionTelemetryRecord`／`SessionTelemetrySeverity`、`SessionTelemetrySink`の約束、`session-telemetry/record` redact waterfall |

> これらのページの型宣言とJSDocはソースと同等であり、`pnpm run verify-type-equiv`によって差分が検査されます（[development.md](../development.md#documenting-types-verbatim-ts-type-equiv)を参照）。通常のブロックは完全な宣言を保持し、`public-api`ブロックは本体を除いた公開クラス宣言を保持します。Cordisサービスとイベントには、各ページの生成**Cordis API**セクションを使用します。
