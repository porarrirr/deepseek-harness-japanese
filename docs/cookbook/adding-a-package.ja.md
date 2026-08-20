# Cookbook：ワークスペースパッケージを追加する

[English](adding-a-package.md) | [中文](adding-a-package.zh.md) | 日本語

新しい`@deepseek-ai/dsh-<name>`パッケージを追加するためのファイル単位のチェックリストです。このチェックリストはbashとアダプターのパッケージをテンプレートとして検証されます。テンプレートとずれた場合は、ここを修正してください。

## 1. パッケージを作成する

```
packages/<group>/<pkg>/
  package.json     # copy from packages/core/tools, adjust name/description/deps
  tsconfig.json    # extends ../../../tsconfig.base.json, rootDir src,
                   # outDir lib/types, references: ../../../vendor/cosmokit,
                   # ../../../vendor/cordis (+ ../../../vendor/schemastery if
                   # you use Config, + ../../<group>/<dep> for each dsh dep)
  src/index.ts     # service default export or plugin (name/inject/apply/Config)
  README.md        # service API, events, extension points, design notes,
                   # + gated Model Experience context blocks or short form
                   # + the gated "Known Limitations and Deferred Work" section
                   # (or a whitelist entry in scripts/verify-package-readme-limitations.ts)
```

パッケージの役割に合う既存グループ（`core`、`llm`、`bash`、`compact`、`subagent`、`todo`、`session-persistence`、`ui`、`util`、`support`）を選びます。新しいグループも作れますが、純粋なコンテナであり、`package.json`やソースファイルを置かず、パッケージはその直下1階層に置きます。

package.jsonの不変条件（`pnpm run constraints`／`scripts/check-workspace-constraints.ts`が検証）は次のとおりです。`private: true`、ルート`package.json`と一致する`version`、`type: module`、`main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."].types: "./lib/types/index.d.ts"`、`exports["."].default: "./lib/index.js"`、`peerDependencies`と`devDependencies`の両方に同じ範囲の`@deepseek-ai/cordis`を置きます。すべてのdsh対等依存関係を`devDependencies`にも複製します。`@deepseek-ai/schemastery`は`dependencies`に置きます（ランタイムバリデーターであり、agent-loopと同じです）。`files`リストには`lib/index.js`、`lib/invariant.js`、`lib/types/**/*.d.ts`、ゲートが認識するパッケージ固有のランタイム成果物だけを含めます。ランタイムエクスポートが出力ツリーを指すパッケージには`lib/types/**/*.js`も含めます。`src`、宣言マップ、JSマップ、古いルート宣言ファイルは公開しません。パッケージの`bin`を持つCLIアプリパッケージでは、`files`の`lib/index.js`直後に`lib/bin.js`を含めます。

パッケージ内の相対インポートは、ソースで明示的な`.ts`指定子を使います（例：`export * from './types.ts'`）。コンパイラーは出力JSでは`.js`に書き換え、宣言には明示的な`.ts`指定子を残します。標準のNodeNext／Node16 TypeScript利用者は、それを兄弟の`.d.ts`ファイルへ解決します。

## 2. ルート設定に登録する

| ファイル | 変更 |
|---|---|
| `tsconfig.base.json` | 既存グループなら編集不要。新しいグループでは`@deepseek-ai/dsh-*`ワイルドカードに`./packages/<group>/*/src`候補を追加する |
| `tsconfig.host.json`（Hostパッケージ）または`tsconfig.client.json`（Clientパッケージ） | `references`に`{ "path": "./packages/<group>/<pkg>" }`を追加する。通常のパッケージは必ず1つのaggregateだけに属し、両方には属さない。`api/remotes`はHostが生成した約定を後のフェーズでClientが消費するためリポジトリ固有の分割を使うが、新しいパッケージでそれをコピーしない（[レイアウト](../development.md#typescript-project-layout)） |
| `knip.json` | リポジトリの検出でまだカバーされないエントリポイントをパッケージが持つ場合だけ |

`packages/client/*`パッケージは`tsconfig.base.json`ではなく`tsconfig.base.client.json`も拡張します。クライアントプラグインパッケージはpackage.jsonで`dsh.client`を宣言し、`./client`をエクスポートし、共有tsdownプリセット（`packages/client/tsdown.client.ts`）を呼び出します。クライアント側の約束は[packages/client/AGENTS.md](../../packages/client/AGENTS.md)を参照してください。

globまたはパッケージマニフェストの検出で自動的に対象となるため、編集不要なものは次のとおりです。ルート`package.json`のworkspaces、`scripts/publint-all.ts`、`tsdown.config.ts`、`.oxlintrc.json`、`scripts/check-workspace-constraints.ts`。

## 3. パッケージ構成を決める

交換可能な能力では、Service Definition／Service Provider／Consumerの役割が独立して発展する場合にパッケージを分けます（docs/architecture.mdの「Capability seams」を参照。shellの3パッケージがテンプレートです）。単一目的のプラグインは1つのパッケージに留めます。

### 存在する役割に名前を付ける

現在の安定した責務に名前を付けます。最初の実装、将来の拡張可能性、Cordisの基底クラスにちなんだ名前は付けません。インターフェースパッケージは能力を名付けます。実装パッケージは、それを区別する機構、プロトコル、環境、ベンダーを加えます。同じホストでの実行が約束の一部である場合だけ`local`を使います。

1つのengine、runtime、policy、controller、resolver、store、または現在の設定には単数形の`ctx`キーを使います。レジストリや複数の名前付きメンバーを所有するサービスには複数形のキーを使います。クラスの役割とキーの数は一致させます。互換性のないHostとClientの宣言で、1つのCordis`Context`キーを再利用しないでください。ランタイムコンテキストが分かれていても、TypeScriptの宣言マージは両方の面を認識します。自然な複数形が別の面ですでに使われている場合は、役割の接尾辞を追加します。

| 用語 | 使う場合 | 使わない場合 |
|---|---|---|
| `Controller` | コマンドまたはユーザーの意図を受け取り、既存のドメインや表示状態を1つ変更する。 | 任意の処理を実行する、プロバイダー群を所有する、表示用に値を変換するだけの場合。 |
| `Store` | 1つのデータセットを所有し、そのデータのCRUD、スナップショット、購読操作を主に提供する。 | 状態機械を検証する、権限を調停する、処理をディスパッチする、プロバイダーの優先順位を所有する場合。mapであるだけではstoreにはならない。 |
| `Directory` | 検出や選択のためにエントリとメタデータを公開する。 | 生産側が任意の実装を登録する、または呼び出し側がそこを通じて処理を実行する場合。 |
| `Presenter` | ドメイン値やツール引数をレンダリング意図へ純粋に変換する。 | I/O、購読、状態変更、ライフサイクル所有を行う場合。 |
| `Registry` | 検索、重複または優先順位の規則、ライフタイム、解放を含む、名前付き登録の動的集合を所有する。 | 主な約束がディスパッチ、実行、キャンセル、ポリシー、オーケストレーションの場合。 |
| `Runtime` | 実行中の処理を行い、呼び出しをまたぐディスパッチ、キャンセル、プロバイダー調整、操作ライフサイクルを所有する。 | レコードを保存するだけ、カタログを返す、1つの値を解決する、設定を保持するだけの場合。 |
| `Resolver` | その答えのライフサイクルを所有せず、与えられた入力から1つの答えを計算または特定する。 | 可変コレクションや長時間実行を所有する場合。 |
| `Binder` | 宣言されたインターフェースを呼び出し側のコンテキストまたはライフサイクルに接続し、接続済みの値を返す。 | 値をコレクションとして所有する、ドメイン状態を制御する、データを変換するだけの場合。 |
| `Engine` | ドメインアルゴリズムまたは状態を持つ実行モデルを実装する。 | プロバイダーを選択するだけ、プロトコル境界をまたいで転送するだけの場合。 |
| `Policy` | 何を許可、選択、制限、観測するかを決める。 | 判断が許可した機構自体を実行する場合。 |
| `Executor` | 1つの能力で、明示的なリクエストまたは解決済み仕様を1つ実行する。 | 広範なアプリケーションライフサイクルやプロバイダーカタログを所有する場合。 |
| `Gateway` | プロセス、ネットワーク、RPC、APIの境界を適応させる。 | 同一プロセスのサービスを登録するだけ、またはメタデータを保存するだけの場合。 |
| `Provider` | 能力定義の実装を1つ提供する。複数あり得る場合は機構またはベンダーの修飾語を加える。 | 能力定義、プロバイダーレジストリ、利用側ランタイムそのものである場合。 |
| `Backend` | 定義済みインターフェースの背後で交換可能な低レベルの永続化、転送、実行を実装する。 | ユーザー向けサービス、または返されたライブリソース参照である場合。 |
| `Handle` | 1つのライブリソースを参照し、そのリソースを制御または観測する。 | リソースプール全体を作成し管理する場合。 |
| `Config` | 解決済み設定値1つ、または厳密に範囲を限定したレコード1つと、その更新の約束を所有する。 | 一般的なコレクションを保存する、処理を実行する、無関係な設定を公開する場合。 |
| `Service` | 上記のより具体的な役割では正確に表せない、まとまりのあるドメインサービスを所有する。 | クラスがCordisの`Service`を拡張するという理由だけでその名前を使う場合。 |

`SDK`は、サポートされるPythonおよびTypeScript SDKが使うJSON-RPCクライアント／サーバープロトコルにだけ使います。DeepSeek Harness自体はagent harnessであり、SDKプロジェクトではありません。製品名は正規表記の`Typert`を使い、`TypeRT`や`typeRT`は使いません。

## 4. パッケージREADMEを書く

パッケージ固有のサービスAPI、設定、イベント、拡張点、設計メモを先に置きます。制限事項セクションには、このパッケージが所有する永続的な利用側の不足と、分かりにくいメンテナー制約を記録します。通常のクリーンアップはソースのTODOまたはAgent Noteに残します。間接的なModel Experienceの文では、このパッケージの貢献を表示する利用側を示せますが、その実装を再記述しません。パッケージREADMEの末尾には次の標準の並びを置きます。

````markdown
## Model Experience

### Request context and condition

#### What the model sees

The exact data-dependent fields, an anchored generated-catalog link, or an introduction to the verbatim literal below.

##### Verbatim text for this field, when needed

```markdown
Stable system-prompt prose of any length, or another long non-generated literal, copied exactly from source.
```

#### Token effect

Fixed, conditional, retained, replaced, capped, or zero-direct token effect.

#### KV Cache effect

Append-only, prefix-stable, replacing, or independent behavior, including the exact conditions that may invalidate reuse.

## Known Limitations and Deferred Work

- **Consumer-visible gap** — exact missing operation or case, its consequence, and any maintainer constraint.
````

Model Experienceは実装から記述します。直接、条件付き、上限付き、ライフタイム、補助のモデルコンテキスト項目ごとにH3を1つ使い、上記の順序付きH4フィールド3つと、その下の本文段落を置きます。パッケージが所有する安定したテキストを引用します。システムプロンプトの文章は、それを導入するフィールド（通常は`What the model sees`）の下に、タイトル付きH5と`markdown`フェンスで置きます。その他の短いリテラルは名前付きプレースホルダーとともにインラインにし、長いリテラルは同じ入れ子形式にします。データ依存またはプロバイダー所有のテキストだけを要約します。ツールスキーマ項目は、生成された[ツールカタログ](../tool-catalog.md)のアンカー付きセクションにリンクし、そこにない差分だけを記述します。スコープによって一方だけを隠せる場合は、プロンプトとスキーマの項目を分けます。`KV Cache effect`では、追記のみの増加、安定した繰り返しプレフィックス、以前のリクエストトークンの置換、独立したモデルリクエストを区別し、再利用を無効化し得るパッケージ所有の変更を示します。「無効化しない」とは、パッケージがすでに再利用可能なプレフィックスを保持することを意味します。プロバイダーのキャッシュ可用性と削除はパッケージの約束の外側です。完全性と所有関係は[prose standard](../../.agents/skills/dsh-prose-standard/SKILL.md)に従い、検証器が必要なセクション構造を強制します。

コンテキスト効果がないパッケージ、または利用側所有の経路が1つだけのパッケージは、[`SENTENCE_MODEL_EXPERIENCE`](../../scripts/verify-package-readme-model-experience.ts)にある監査済みの`None, as `または`Indirectly, through `文を使い、その後に`KV Cache effect` H4と空でない段落を1つ置きます。モデル非依存の汎用パッケージは、代わりに`NO_MODEL_EXPERIENCE_SECTION`へ参加できます。どちらの場合も、別パッケージの処理を説明する内容に広げないでください。制限事項の[allowlist](../../scripts/verify-package-readme-limitations.ts)は独立しています。[Model Experience Agent Note](../../.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md)に理由を記録します。

## 5. 検証する

```sh
pnpm install        # registers the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

新しいパッケージに必要な動作別チェックとカバレッジについては、[リポジトリのテストポリシー](../testing.md)に従います。
