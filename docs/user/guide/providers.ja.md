# モデルを設定する

[English](providers.md) | [中文](providers.zh.md) | 日本語

このガイドでは、[ルートREADME](../../../README.md#run)からWeb UIを起動していることを前提にします。モデルの変更はサーバーを再起動しなくても次のリクエストから反映されます。

## DeepSeekを設定する

**Settings → Models**を開きます。DeepSeekカードにはAPIキー欄が1つあります。キーを入力して保存します。

![Modelsページ：DeepSeekカードと、その下にあるAdd providerおよびAdd a custom provider](providers-models-page.png)

キーは書き込み専用です。保存後にページが受け取るのは秘匿化された記述子であり、秘密値そのものではありません。キーは`$DSH_HOME/.credentials.yaml`に保存され、設定には認証情報への参照だけが残ります。

## カタログプロバイダーを追加する

**Add provider**を選び、AnthropicやOpenAIなどのプロバイダーを選択し、APIキーを入力して保存します。インストール済みのカタログがエンドポイント、プロトコル、モデル一覧を提供します。

ネイティブ認証を使うプロバイダーには、それぞれの認証情報が必要です。Bedrock、Vertex、Azure、CodexはそれぞれAWS認証情報とリージョン、ADCプロジェクト、`api-version`、OAuthを使うため、APIキー欄だけを入力しても設定されません。

## カスタムプロバイダーを追加する

社内ゲートウェイ、セルフホストサーバー、またはインストール済みカタログにないプロバイダーには、**Add a custom provider**を選びます。小文字のProvider ID、ベースURL、APIプロトコル、認証情報、そして少なくとも1つのモデルを指定します。

![カスタムプロバイダーのフォーム：Provider ID、表示名、ベースURL、APIプロトコル、APIキー](providers-custom-form.png)

Provider IDは、リクエスト、保存済みセッション、モデルのデフォルト、認証情報への参照が使用するため変更できません。プロバイダー名を変更するには、新しいプロバイダーを追加して古いものを削除します。表示名、ベースURL、プロトコル、認証情報、モデルは引き続き編集できます。

**Model catalog**で**Fetch available models**を選ぶと、フォームに現在表示されているベースURLと認証情報を使って問い合わせます。候補を選ぶと下書きが更新されますが、保存するまでプロバイダーは保存されません。カタログプロバイダーはネットワーク要求を行わず、インストール済みカタログを使います。

### 画像入力

手入力したモデルは、別途指定するまでテキスト専用として扱われます。エンドポイントが受け付けるモダリティを問い合わせる手段がないためです。そのようなモデルへの画像添付は、送信前にモデル名を示して拒否されます。

したがって、カスタムプロバイダーのビジョンモデルには1行の追加が必要です。フォームにはその欄がないため、`$DSH_HOME/settings.yaml`のモデルに`input`を追加します。

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input`は`text`と`image`を受け付け、そのモデルだけに適用されるため、1つのルートで両方の種類を提供できます。省略するか、同じ意味になる空のリストを書くと、インストール済みカタログがそのモデルについて記録している値を維持し、カタログに記述のないモデルではルートの`defaultInput`にフォールバックします。

手入力したすべてのモデルが画像を受け付ける場合は、それぞれに設定せず、ルートにフォールバックを一度だけ設定します。

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput`は上書きではなくフォールバックで、デフォルトは`[text]`です。カタログプロバイダーでは、カタログに記述のないモデルにだけ適用されるため、画像を受け付けるカタログモデルから画像を削除することはありません。対象モデル自身の`input`で範囲を狭めます。カタログプロバイダーには記述する`models`リストがないため、モデルIDをキーにして`modelOverrides`の下に書きます。

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

モデル自身のリストを除き、すべてのリストには少なくとも1つのモダリティを指定する必要があります。モデル自身のリストでは、空のリストは省略と同じ意味です。未知のモダリティは、どこに書いても拒否されます。

どちらのフィールドもエンドポイントを検査するのではなく、エンドポイントについての宣言を行います。モデルが画像対応を宣言していても、エンドポイントが実際には対応していないことはここでは検出されず、プロバイダーがリクエストを拒否します。

### リクエストの互換性

ゲートウェイは、到達可能なアドレスで有効なキーを保持していても、すべてのリクエストを拒否することがあります。pi-aiはエンドポイントのURLからリクエストの形式（システムプロンプトをどのロールが担うか、どのフィールドが出力上限を指定するか、thinking levelをどう渡すか）を決めます。認識できないアドレスはOpenAI自身として扱われます。多くのOpenAI互換ゲートウェイは、OpenAIが受け付けるものの少なくとも1つを拒否します。

主な原因は2つです。推論を宣言するモデルではシステムプロンプトが`role: "developer"`として送られますが、多くのゲートウェイはこれを即座に拒否します。また出力上限は`max_completion_tokens`として送られるため、`max_tokens`しか知らないサーバーは拒否します。フォームにはどちらの欄もないため、`$DSH_HOME/settings.yaml`のルートで修正します。

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

ルートの`compat`はそのモデル群のデフォルトで、モデル自身の設定がフィールドごとに優先されます。そのため、ルートを再記述せずに1つのモデルだけ修正できます。

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

どちらにも設定しない値は、そのモデルについてインストール済みカタログの値を維持し、カタログに記述がないものはpi-aiの検出に委ねられます。指定するすべてのスイッチには値を与えてください。空のキー（`supportsDeveloperRole:`）は無視されず拒否されます。空値ではカタログの知識を消すだけで、代わりの内容を指定できないためです。どのプロトコルも受け付けない名前も拒否され、利用可能な名前がメッセージに列挙されます。

各スイッチは、それを宣言するプロトコルに属します。そのため、ある`api`で有効なスイッチが別の`api`では拒否されることがあります。メッセージには、そのプロトコルが提供する内容が示されます。上記の`input`と同様に、スイッチはエンドポイントを検査するのではなく宣言を行います。ゲートウェイが実際には必要としない設定をすると、別のリクエストが送られるだけです。

すべてのスイッチ、受け付ける値、対応するプロトコルは、[生成された`dsh-llm-pi-ai`設定リファレンス](../../config-catalog.md#deepseek-aidsh-llm-pi-ai)の`PiAiCompatProfile`に一覧されています。これはソースから生成されるため、アダプターが受け付ける内容から遅れることはありません。

## モデルを選択する

設定済みのプロバイダーはモデルピッカーに表示されます。モデルを選択すると、新しいセッションのデフォルトにもなります。すでにリクエストを送信したセッションは、自身のログに記録されたモデルを保持します。

保存済みのデフォルトが削除済みのプロバイダーを指定している場合、コンポーザーに**Select model**が表示され、別のモデルを選択するまで入力できません。

## トラブルシューティング

- **`MISSING_CREDENTIAL`** — Modelsページでプロバイダーキーを保存するか、参照されている環境変数を指定します。
- **`UNKNOWN_MODEL`** — 設定済みのモデルを選ぶか、不足しているモデルをカスタムプロバイダーに追加します。
- **利用可能なモデルの取得が401を返す** — キーを確認します。モデル検出はOpenAI互換の`GET /models`エンドポイントを呼び出します。提供していないエンドポイントではモデルを手入力します。
- **キーとURLが正しいのにゲートウェイがすべてのリクエストを拒否する** — リクエスト形式がOpenAIと異なります。まずルートに`compat.supportsDeveloperRole: false`と`compat.maxTokensField: max_tokens`を設定します。
- **推論モデルだけ失敗する** — pi-aiはシステムプロンプトを`developer`ロールで送信しますが、ゲートウェイが拒否しています。`compat.supportsDeveloperRole: false`を設定します。
- **compatスイッチが値なしとして拒否される** — コロンの後に何もないキーです。値を指定するか、キーを削除してインストール済みカタログの値を維持します。
- **画像が送信前に拒否される** — モデルが画像モダリティを宣言していません。カスタムプロバイダーのモデルに`input: [text, image]`を指定します。DeepSeek独自のchat-completionsルートはテキスト専用で、別の設定にはできません。
- **画像を含むリクエストをプロバイダーが拒否する** — モデルが、エンドポイントが実際には提供していない画像対応を宣言しています。画像を付与したリスト（モデルの`input`またはルートの`defaultInput`）から`image`を削除して新しいセッションを開始します。添付画像はセッションログに残るため、セッションがそこから進むまで同じリクエストが繰り返されます。

## 高度な設定

生成された[プラグイン設定カタログ](../../config-catalog.md)には、すべてのプラグインでサポートされるフィールドとデフォルトが一覧されています。このページが設定するプロバイダーのセクションは[`dsh-llm-pi-ai`](../../config-catalog.md#deepseek-aidsh-llm-pi-ai)です。[`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md)と[`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md)のリファレンスでは、`settings.yaml`の直接設定、カタログ解決、推論制御、認証情報、アダプターエラーを扱います。
