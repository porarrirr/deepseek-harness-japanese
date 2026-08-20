# Cookbook：LLMアダプターを追加する

[English](adding-an-llm-adapter.md) | [中文](adding-an-llm-adapter.zh.md) | 日本語

新しいモデルプロバイダーを接続する方法です。実装例は`packages/llm/llm-deepseek`（直接HTTP、`eventsource-parser`でフレーム化したSSE）と`packages/llm/llm-pi-ai`（LLMライブラリをラップ）です。まず`packages/llm/llm/src/types.ts`の`StreamChunk`ドキュメントを読んでください。両方のアダプターが検証したプロトコル規約を記録しています。

## 形

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

登録はエフェクトベース（HMR対応）です。プロバイダールートごとにアダプターは1つで、重複はthrowされ、複数ルートの登録は全体が成功するか失敗します。`options.provider`がアダプターを選択し、`options.model`がプロバイダーのモデルIDなので、動的カタログアダプターはライフサイクルの再設定なしで新しいモデルを提供できます。秘密情報はCordisの方式で扱います。envフォールバック付きのschemastery Configを、`!!js process.env.MY_KEY`を通じてcordis.ymlから渡します。場当たり的なキーをコードで読み取らないでください。

## プロトコル上の義務（2つの実装が検証した約束）

- `finish`の前に`usage`を発行し、`finish`の後は何も発行しません。堅牢な方法は、プロバイダーのストリーム終了マーカーまでfinish／usageをバッファーし、その後flushすることです（末尾にusageだけのチャンクを送るプロバイダーにも対応します）。
- ツール呼び出しの`arguments`は最初から最後までRAW JSON文字列です。断片は`argumentsDelta`としてストリームします。プロバイダーが解析済みオブジェクトを返す場合は、`block-end`で再び文字列化します。
- blockの`index`はストリームで最初に見た順に割り当て、同じblockのすべてのdeltaで同じindexを再利用します。
- エラーには許可された経路が2つだけあります。`stream()`からTHROWする（トランスポートとプロトコルの失敗。安定したコードを持つ`LlmError`を使う）か、`finish {kind: 'error' | 'aborted'}`でストリームを終了する（プロバイダー内の失敗）かです。利用側は両方を処理します。失敗の種類ごとに選び、文書化してください。
- `options.signal`に従います（fetchまたはSDKへ渡します）。
- プロバイダーが処理できない`GenerateOptions`フィールド（停止シーケンスのないプロバイダーでの`stop`リストなど）は、黙って破棄せず`LlmError(..., 'UNSUPPORTED')`をthrowします。
- プロバイダーが後続呼び出しにレスポンスID、署名、その他のネイティブメタデータを要求する場合は、最小限の情報を失わないJSON投影を`finish.replayState`として発行します。履歴の再構築時に検証します。`LlmRuntime`は、履歴のプロバイダールートと対象プロバイダールートが現在まったく同じアダプターインスタンスに所有されている場合だけ渡します。同じモデル、別モデル、別プロバイダーの復元が合法かどうかはアダプターが決めます。状態がない場合に、プロバイダー／モデル名だけからネイティブリプレイを推測してはいけません。

プロバイダー固有のthinking-mode切り替えはアダプターのConfigに残します。正確なモデルメタデータには、プロバイダー非依存の1つの能力seamを使います。プロバイダー／モデル識別情報と任意の`context`／`reasoning`フィールドを持つ`resolveModel()`を実装し、存在する場合だけ設定済みの`defaultEffort`を宣言し、resolverの任意の`AbortSignal`に従います。reasoning effortは順序付きの不透明なIDで、アダプターがプロバイダーのリクエストへ対応付けます。最終的なwire表記を公開したり、サポートされない値を丸めたりせず、サポートされる場合はアダプター定義の`off`を含め、アダプターが正とする選択可能なリストを保持します。IDはwire表現と同じである必要はありません。

## 実装構造

wire型、リクエストのシリアライズ、トランスポート解析、チャンク変換、アダプタークラスを別々の責務として保ちます。[`llm-deepseek`](../../packages/llm/llm-deepseek/README.md)が構成例です。

## 検証

アダプターのカバレッジ、実プロバイダーのチェック、公開エントリの要件を定める[リポジトリのテストポリシー](../testing.md)に従います。
