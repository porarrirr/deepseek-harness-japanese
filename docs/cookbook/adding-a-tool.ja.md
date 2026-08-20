# ツール作成リファレンス

[English](adding-a-tool.md) | [中文](adding-a-tool.zh.md) | 日本語

モデル向けツールが満たすべき約束のリファレンスです。最初のツールを順番に作る場合は[ツールを作る](../user/develop/basic/tool.md)に従ってください。`packages/shell/tool-bash`は本番品質の3パッケージ構成の例です。

## 最小形

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema: { path: string; limit?: number }
      // exec carries immutable identity + token; signal is the operational field
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

登録はエフェクトベースです。プラグインfiberをdisposeするとツール登録が解除されます。スキーマは自動的にシステムプロンプトの組み立てへ流れます。

## execute()の約束

- **Argsは検証済みです。**`defineTool`は`execute`の前に、モデルが生成した`arguments`を統合された`ParameterSchemaSpec`に対して検証します（型、必須キー、リテラル制約、exact-one union、入れ子の値。[runtime arg validation](../../.agents/notes/implemented/architecture/2026-06-11-runtime-arg-validation.md)）。そのため`execute`内のargsは`InferArgs`に一致します。明示的なオブジェクトノードは`additionalProperties: true | false`を宣言し、暗黙のパラメータールートは開いたままです。それでも、空でない文字列、正の数、フィールド間の規則など、DSLで表現できない制約は手動で確認します。直接登録したRaw JSON-Schemaツールは入力検証を自ら所有します。
- **登録は読み取り専用定義を借用します。**型付きの同一プロセス内の提供はシリアライズ境界ではありません。登録後にスキーマを変更したりコールバックを置き換えたりしないでください。`schemas()`は明示的なモデル向け投影だけを具体化します。ツールをホットスワップするには、所有するエフェクトをdisposeして置換版を登録します。コールバックのクロージャ内の可変状態は通常のプラグイン状態のままです。
- **実行の識別情報は保護されます。**レジストリは1回の再帰処理で`arguments`を分離された情報を失わないJSONとして具体化し、ポリシー開始前に値をfreezeし、不透明な`exec.token`を割り当てます。`callId`、`name`、`arguments`、`agent`、`token`、呼び出し側が所有する必須の`signal`、任意の外側トランスポートの`parent`トークンはディスパッチ中不変です。`parent`は識別情報だけで、外側の実行中処理を公開しません。`args`は読み取り専用入力として扱います。可変ビューを受け取るのはaroundディスパッチラッパーだけで、期限を設定するため必須の`exec.signal`を置き換えて戻せますが、削除はできません。
- **正規のJSON値を1つ宣言して返します。**`output.schema`は`ValueSchemaSpec`を使い、オブジェクト、配列、スカラー、nullのいずれもルートにできます。`execute`は推論された値だけを返し、レジストリが情報を失わないJSONとしてスナップショットし、検証してfreezeし、`output.render(args, value)`へ渡します。本体からコンテンツブロックを返したり、呼び出し側にIDやフィールドを文章から解析させたりしないでください。
- **無効な値を投げる、または返すと`isError`になります。**レジストリはthrowを捕捉し、オブザーバーの実行前にスキーマ、renderer、メタデータprojector、情報を失わないJSONの失敗を封じ込めます。インフラストラクチャの失敗はthrowします。Native rendererがゼロ以外のプロセス終了など理想的でない状態を説明する場合でも、成功したドメイン結果は正規値で表現します。
- **`exec.signal`に従います。**発火したら実行中の処理をキャンセルします。
- **`presentationMeta`で永続カードデータを投影します（任意）。**`output.presentationMeta(args, value)`は同じ正規値からリプレイ可能なJSONを導出します。コアはそれを`tool/result`に保存して`presentResult`へ渡すため、`write`／`edit`で適用したhunkなど結果時点の事実が必要なカードも、正規値を保存せずにリプレイできます。カードを持たない入れ子のCodeディスパッチではprojectorを省略します。
- **非同期通知には`exec.agent`を使います。**`agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })`は、次のモデルリクエストが見る永続コンテキストを追加します。これはwake-upではなく、アイドルのagentはアイドルのままです。dispose済みagentに備えて（try/catchで）保護します。

## 長時間実行する処理

`run_in_background`をプロデューサー設定で制御し、`ctx.jobs.start({ kind, label, owner: exec.agent, run })`を通じて登録します。レジストリはプロデューサー本体の前に事前キャンセル済みの呼び出しを拒否します。ランタイムは`run()`が処理を開始する前に所有権とタスクコントローラーの可用性を検証し、ID、セッションフェンス、汎用制御ツール、通知、所有者のクリーンアップを提供します。成功したバックグラウンド分岐は`{ kind: 'background', jobId }`のような型付き正規ハンドルを返します。Native rendererは`started background job bash-1`のような人間向け文章を保持できますが、Code ModeはIDを復元するためにその文章を解析してはいけません。

プロデューサーは同期的な`cancel`、リソース解放後にsettleするrejectしない`done`、任意で出力を消費する`readOutput`（出力上限の整形付き）を提供します。事前キャンセル済みの呼び出しは失敗です。成功出力スキーマを満たすIDを持つタスクが存在しないためです。`ctx.jobs.start()`がIDを公開した後は、`exec.signal`ではなくタスク所有のキャンセルシグナルを使います。後からの外側呼び出しのキャンセルは呼び出しの待機を止めますが、公開済みの処理はkillしません。そのライフタイムを所有するのは`job_kill`、所有者のdispose、サービスの解体です。フォアグラウンド処理は`exec.signal`に結び付きます。ストリームプロデューサーについては[background job runtime Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)と`dsh-tool-bash`を参照してください。

## 実行ポリシーと観測

デプロイメントポリシーをツールに組み込まないことを優先します。拡張可能なallow／deny／askポリシーには`tools/pre-execute`（[permission-gateの例](extension-cookbook.md#a-hook-plugin-permission-gate-example)）、後続リスナーが取り消せない最終的な単調denyには`ctx.tools.guard()`、期限・リトライ・メトリクス収集でディスパッチをラップするには`tools/execute`、表示コンテンツや返却値の置換、結果のブロック、モデル向けコンテキストの追加には`tools/post-execute`、不変な正規化済み結果の観測には`tools/result`を使います。コンテンツを置換してもプログラムから`value`へアクセスできます。機密性ポリシーでは値をブロックまたは置換します。サンドボックス実装をツールのexecutor実装内で実行することもできます。各拡張点の入力、順序、戻り値、失敗動作は[`dsh-tools` README](../../packages/core/tools/README.md#extension-points)で定義されています。

## Code Modeからツールをそのまま使える

[Code Mode](../../packages/core/tools/README.md)では、表示される登録済みツールが追加統合なしで`await tools.<name>(args)`として利用できます。生成された`ToolArgsMap`と`ToolOutputMap`は同じスキーマから正確な引数型と正規戻り値型を導出し、呼び出しは通常の実行パイプラインに再入します。成功した呼び出しは、レンダリング済みNativeコンテンツではなく、ポリシー後の最終的な正規JSON値に解決されます。失敗した呼び出しは実際の`ToolCallError`でrejectされます。プログラムが調べられるのは`name`、`toolName`、人間向けの`message`だけで、内部エラーコードや失敗unionは調べられません。

`output.schema`を有用なプログラムAPIとして設計します。ハンドルとフィールドを直接返し、正直な値であればスカラー／配列／nullをルートに許可し、人間向けの説明は`output.render`に置きます。中間値は実行ローカルで、永続化もプロンプトによる切り詰めもされず、バイト上限もありません。そのため、プロデューサーの正確な取得上限とプロセスメモリは引き続き重要です。設定可能な出力上限とモデル向けspillパイプラインを通過するのは外側の`run_code`のログ／結果だけです。

## UIでツールをレンダリングする方法

ツールの`output.render`はモデル向けコンテンツを返します。**UIカード**は別の関心事で、純粋な表示投影と任意の`presentCall`／`presentResult`メソッドで宣言します。正規値と一緒にこれらを設計してください。UI表示のないツールは汎用カード（タイトル＝ツール名、入力＝生のargs）にフォールバックします。

両方のメソッドは**`card`タグ付きのレンダリング意図**を返します。ツールの動作に合うカード種別を選びます。

- `presentCall(args)` → `ToolCallView`（PENDINGカード）：
  - `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` — デフォルト。アイコンには`kind`（`read`／`search`／…）を設定し、ツールが触れるファイルには`locations: [{ path, line? }]`を設定して、対応するエディターが追跡またはジャンプできるようにします。
  - `{ card: 'terminal', title, description?, cwd? }` — 呼び出し自体がシェルコマンドの場合。`title`はコマンドで、`description`はターミナルカードの上に表示されます（tool-bash）。
  - `{ card: 'diff', title, diffs, locations? }` — 呼び出しがファイルを作成または変更する場合。`diffs: [{ path, oldText, newText }]`（新規ファイルでは`oldText: null`）がインラインdiffカードとして表示されます（tool-fsの`write`／`edit`）。
- `presentResult(args, { content, isError, meta? })`は完了カードを返します。
  - `generic`は任意のタイトルとコンテンツを提供します。
  - `terminal`は生の出力と任意の終了メタデータを提供します。各UIは対応するビューまたはフォールバックビューをレンダリングします。
  - `diff`は適用済みhunkを提供します。多くの場合`output.presentationMeta`から導出し、保存済みの`result.meta`に持たせてリプレイで再現します。変更ツールは完了ビューがPENDINGカードを置き換えるため、diff結果を保持します。
  - `search`は保存済み`result.meta`から再構成した検出結果を提供します。ファイルごとにグループ化した一致（`shape: 'matches'`、grep）またはフラットなパスリスト（`shape: 'paths'`、glob）に加え、`truncated`／`total`を持つため、UIが上限付き結果を完全なものとして表示することはありません。ビューには結果テキストを含めません（searchカードのないUIは生の結果コンテンツにフォールバックします）。`search`のcallビューはありません。検出呼び出しのPENDING状態は汎用カードのままです。一致は`execute`後にだけ存在するためです（tool-fs-searchの`grep`／`glob`）。
  - `web`は完了したWeb取得を提供し、`kind: 'search' | 'fetch'`（構造化された検索ソースまたはfetchの要約）で区別し、`result.meta`から導出します。本文のコピーは持たないため、`web`能力のないUIは生の結果コンテンツにフォールバックします（tool-webの`web_search`／`web_fetch`）。

厳守するルール：

- **純粋性。**これらは実行中のストリーミングとセッションログのREPLAYの両方で実行されるため、`args`（＋結果）だけからなる純粋関数でなければなりません。I/O、セッション状態の読み取り、時計／乱数は不可です。diffはargsから導出します（呼び出し時のpresenterには以前のファイル内容がないため、`write`は`oldText: null`を使います）。セッションコンテキストを提供するのはツールではなくUIアダプターです。`presentCall`内でファイルの古い内容や作業ディレクトリが必要になったら停止してください。それはpresenterではなく、永続的な結果メタデータまたはアダプターに属します。
- **UI専用の整形をモデル結果に入れない。**フェンス付きの` ```console `ブロック、diff、相対化したパスは、UIのためだけに正規値やNativeコンテンツへ入れるものではありません。モデル向け文章は`output.render`が所有し、リプレイ可能なUI状態は`presentationMeta`とカードpresenterが所有します。`terminal`結果ビューは生の出力を持ち、アダプターがフォールバックの枠付けを追加します。
- **`defineTool`は表示経路をソフト検証する。**壊れた引数や古いログ引数では、ラッパーはthrowせず`undefined`（汎用フォールバック）を返します。表示がリプレイをクラッシュさせてはいけません。

中立的な語彙は`dsh-tools`にあり、ツールがUI型やトランスポート型をインポートすることはありません。Host／Clientランタイムが各`card`を自身のビューに対応付けます。設計と理由は[render-intent-union Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)にあり、`dsh-tool-fs`（generic／diff）と`dsh-tool-bash`（terminal）が実装例です。

## 検証

[リポジトリのテストポリシー](../testing.md)と所有パッケージのテスト文書に従います。公開するモデルまたはUIに見える変更には、そこで指定された組み立て済みのカバレッジが必要です。
