# DeepSeek Harnessのアーキテクチャ

[English](architecture.md) | [中文](architecture.zh.md) | 日本語

`packages/`以下を変更する前に読んでください。Cordisを知っていることを前提とします。知らない場合は[Cordis入門](cordis-primer.md)または[チュートリアル](cordis-tutorial/index.md)から始めてください。

agentを使ってコードベースを調査し、アーキテクチャを理解することを推奨します。

## Cordis

[Cordis](cordis-primer.md)はdshの下層にあるフレームワークです。プラグインが共有コンテキストにサービス、型付きイベント、可逆なエフェクトを追加します。モデルアダプター、ツールレジストリ、セッションログ、agent loop自体を含む製品のすべての部分がプラグインであり、設定から交換できます。

パッチを当てる特権的なコアはありません。他のプラグインと並べてプラグインをマウントすることでdshを拡張し、登録は所属するプラグインのアンロード時に巻き戻るエフェクトです。

## profileとbundle

実行中の`dsh`は、順序付けられたレイヤーから起動時に構成されるプラグインツリーです。

**profile**はHarnessホームに保存される名前付きの構成です。積み重ねるbundle、インストールする外部プラグイン、ユーザー自身の`cordis.patch.yml`を保持します。`web`と`headless`はテンプレートとして提供されます。

**bundle**はCordis設定行と、それらがマウントするコードの配布形式です。bundleが挿入するものは上位レイヤーから引き続きパッチできます。

それぞれは自身の`package.json`の`dsh`フィールドで宣言します。`dsh.profile`はprofileのbundleを列挙し、`dsh.bundle`はbundleのパッチファイルを指します。

[`dsh-base`](../packages/bundle/base/README.md)はすべてのprofileの最初のレイヤーで、モデルアダプター、ツール、永続化、サンドボックスと承認ポリシー、設定、認証情報、テレメトリを含みます。[`dsh-web-app`](../packages/bundle/web-app/README.md)はブラウザーアプリケーションを追加し、[`dsh-headless`](../packages/bundle/headless/README.md)はサーバーなしのワンショットランナーを追加します。

レイヤーは空のエントリリストに対して、次の順序で適用されます。profileに記載された順の各bundle、profileの`cordis.patch.yml`、ホームレベルのパッチ、最後に各`--patch`オーバーレイです。パッチはidで行を指定して設定全体を置き換えるか、新しい行を挿入します。

マシンが実際に起動するツリーを見るには、次を実行します。

```sh
dsh --profile web --dump-config
```

表示されたどの行も、自分のパッチで置き換えられます。

構成の仕組みは[app-boot](../packages/boot/app-boot/README.md#profiles)に、設定フィールドは生成された[設定カタログ](config-catalog.md)にあります。

## コアパッケージ

Cordisツリーに追加する主なコアパッケージを示します。

| パッケージ | 所有するもの | `ctx`キー |
|---|---|---|
| [`core/session`](subsystems/session.md) | 追記専用の`SessionEvent`ログとメモリ内ストア | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | プロンプトセクションとツールスキーマの組み立て | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | スコープ付きツールレジストリと保護された実行パイプライン | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | `Agent`インターフェース、実行中レジストリ、`agent/*`イベント | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | そのインターフェースを実装するデフォルトドライバー | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | agentごとのスコープ付き登録プリミティブ | ライブラリ、キーなし |
| [`llm/llm`](subsystems/llm-streaming.md) | メッセージとストリームの語彙、およびアダプターseam | `ctx.llm` |

## イベント

イベントは拡張点であり、適切なドメインを選ぶことが多くの変更で最初の判断になります。

- **セッションイベント**はログに追記され、`session/event`でブロードキャストされる永続的な事実です。再読み込み後も残す必要がある事実にはこれを使います。
- **Agentイベント**（`agent/*`）は実行中の`Agent`を運びます。inbox、step、status、request、validation、continuationなどです。進行中の処理を監視またはインターセプトするにはこれを使います。
- **能力イベント**はループをインポートせずに、seam（`fs/*`、`tools/*`、`telemetry/*`）へポリシーとアダプターを接続します。

各イベントのプロデューサーとコンシューマーは[イベントマップ](event-producer-consumer.md)に一覧されています。

## Turnの流れ

**step**は1つのモデルリクエストと、それが呼び出すツールです。**turn**は0個以上のstepで構成され、最初の入力を取得する前に開始し、未処理のものがなくなると終了します。

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`は永続的なセッションイベントです。残りは3つのドメインにまたがる実行時の拡張点です。`agent/pre-step`、`agent/request`、`llm/stream`、3つの`tools/*`イベントはwaterfallであり、リスナーは委譲のために`next()`を呼び出す必要があります。`agent/turn-stopping`はserialで、`next()`を持ちません。

入力は1つのinboxを通じてドライバーに届きます。すぐにドライバーを起こすメッセージもあれば、注入されたコンテキストが別のメッセージで起こされるまでinboxで待つこともあります。

`agent/pre-step`はモデルに見せる内容を決めます。リスナーは取得したメッセージを書き換えるか、完全に拒否できます。最初の取得が拒否または空であっても、stepを消費しなかった永続的なturnは終了するため、ログには試行が記録されます。各stepはプラグインが登録したプロンプトセクションとツールスキーマを読み取ります。

詳細は、[シーケンス図](agent-lifecycle.md)、[ツールパイプライン](tool-execution-pipeline.md)、[キャンセルとエラー復旧](subsystems/core.md#the-agent-handle)を参照してください。

## セッションログ

セッションログはモデルが見るコンテキストのソースです。`deriveMessages()`はそこからモデル履歴を投影し、生の`assistant/chunk`イベントがリプレイとUIの忠実性を保ちます。fork、resume、transcript、テレメトリ、永続化はすべてこのストリームから派生します。

**モデルに見えるものはログに記録する。**モデルリクエストに到達するものは、すべてログから再構成できなければならず、ランタイム不変条件がこれを検証します。そのため、新しいモデル向け入力には新しいセッションイベントが必要です。`SessionEventMap`を拡張し、ログからレンダリングします。

## 能力seam

**seam**は交換可能な能力で、3つの役割を持ちます。インターフェースを宣言する**Service Definition**、それを実装する**Service Provider**、それを利用する**Consumer**（通常はモデル向けツール）です。1つのパッケージが役割を兼ねても構いませんが、1つの役割だけではseamではありません。能力を追加するとは、3つすべてを設計することです（[能力グラフ](capability-seams.md)）。

seamがあるため、1つのプロバイダーを交換すると製品全体が変わります。ファイルシステムとサブプロセスのプロバイダーは1つの実行世界を共有するため、リモートサンドボックスを指すようにすると、プロバイダーの分岐なしにBash、PTY、LSPも移動します。[Subagentプロバイダー](subsystems/subagent.md)も、1つのインターフェースの背後で、新しい子agentから別製品への委任turnまで同様に幅広く変えられます。

[Experimental Agent Teams](subsystems/agent-team.md)は`ctx.agentTeams`上の非公開オプトイン調整seamで、継続可能なsubagentの上に永続的な名簿、タスクボード、メールボックスを重ねます。

## 新しい動作を追加する場所

新しい動作は、文書化された拡張点に接続します。ループ自体を変更する場合は、このマップも更新します。

| 目的 | 仕組み |
|---|---|
| モデルプロバイダーを追加する | `ctx.llm`にアダプターを登録する |
| モデル向け能力を追加する | `ctx.tools`に登録し、スキーマをプロンプト組み立てに加える |
| 1つのセッションに異なる能力セットを与える | agent presetを構成し、そのサービス行に`isolate` realmを指定する |
| シェル実行を追加する | `ctx.shell`バックエンドを登録し、ローカル版は`ctx.subprocess`を通じてspawnする |
| 永続的なターミナル実行を追加する | `ctx.terminals`バックエンドと`dsh-tool-terminal`を登録する |
| 人間向けコマンドを追加する | `ctx.commands`に登録し、モデルturnなしでディスパッチする |
| バックグラウンド処理を追加する | `ctx.jobs`に登録し、`job_*`ツールで収集または停止する |
| ファイルシステムアクセスまたはポリシーを追加する | `ctx.fs`プロバイダーを登録するか、`fs/*`イベントを待ち受ける |
| 生成したプロセスを隔離する | `ctx.sandbox`バックエンドを使い、利用側がspawn前にargvをラップする |
| リクエスト、ツール、turnをインターセプトする | その`agent/*`または`tools/*`イベントを使い、`agent/turn-stopping`でturnを停止する |
| モデル向けコンテキストを追加する | `agent.inject()`を呼び、次に受け入れるリクエストへ追加する |
| UIまたはエディター統合を追加する | `ctx.agents`を駆動し、`session/event`からレンダリングする |
| Web Client Chatノードを追加する | `ConversationNodeDefinition`とキー付きrendererを登録する |
| 永続的なセッション状態を追加する | `SessionEventMap`を拡張し、ログからレンダリングとリプレイを行う |
| セッションタイトルを生成する | 唯一の`ctx.sessionTitle`プロバイダーを登録する |
| 同一セッションの目的を管理する | `ctx.goals`を使い、`agent/*`を通じて継続する |
| 実行中のセッションをforkする | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 1つのagentに登録をスコープする | そのagentの`agent.ctx`を使う |

[拡張Cookbook](cookbook/extension-cookbook.md)は機能を能力に対応付け、[パッケージ](cookbook/adding-a-package.md)、[ツール](cookbook/adding-a-tool.md)、[LLMアダプター](cookbook/adding-an-llm-adapter.md)、[Chatノード](cookbook/adding-a-conversation-node.md)、[設定カード](cookbook/adding-a-settings-card.md)の手順ガイドを索引化しています。
