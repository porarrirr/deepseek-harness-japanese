# LLMアダプター

[English](llm-adapter.md) | [中文](llm-adapter.zh.md) | 日本語

このガイドでは、新しいLLMプロバイダーをHarnessに接続します。

## 概要

LLMアダプターは`LlmAdapter`を拡張して`stream()`を実装し、Harnessのプロバイダー非依存リクエストをプロバイダーAPI呼び出しに変換し、レスポンスをHarnessのチャンクへ戻します。

## 最小実装

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages to the provider format.
    // 2. Call the streaming API.
    // 3. Convert the response into StreamChunk values.
  }
}

export interface Config {
  apiKey: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new MyAdapter(config.apiKey)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

## StreamChunkプロトコル

`stream()`はこのプロトコルに従ってチャンクを生成します。

```ts
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function* exampleChunks(): AsyncIterable<StreamChunk> {
  // 1. Start each content block with block-start.
  yield { type: 'block-start', index: 0, blockType: 'text' }

  // 2. Stream text through text-delta.
  yield { type: 'text-delta', index: 0, text: 'Hello' }
  yield { type: 'text-delta', index: 0, text: ' world' }

  // 3. End each content block with block-end and the complete block.
  yield {
    type: 'block-end',
    index: 0,
    block: { type: 'text', text: 'Hello world' },
  }

  // 4. Tool-call block.
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield {
    type: 'tool-call-delta',
    index: 1,
    id: CallId('call-123'),
    name: 'bash',
    argumentsDelta: '{"command":"ls"}',
  }
  yield {
    type: 'block-end',
    index: 1,
    block: {
      type: 'tool-call',
      id: CallId('call-123'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
  }

  // 5. Token usage.
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }

  // 6. Finish reason.
  yield { type: 'finish', reason: { kind: 'stop' } }
  // Alternatively, { kind: 'tool-calls' } requests tool execution.
}
```

### 主なルール

- すべての`block-start`には対応する`block-end`があります。
- `index`は0から増加し、コンテンツブロックの順序を識別します。
- `tool-call-delta`は`argumentsDelta`に生のJSONテキストを含み、1つのチャンクでまとめて送ることも複数のチャンクに分けることもできます。
- `finish`が最後のチャンクです。
- `finish`の前に`usage`を発行します。

## GenerateOptions

`stream()`はエクスポートされた`GenerateOptions`型を受け取ります。モデル、アダプター所有のreasoning-effort ID、会話履歴、システムプロンプト、ツールスキーマ、生成パラメーター、停止シーケンス、abortシグナルを含むため、`@deepseek-ai/dsh-llm`がエクスポートするTypeScript型を正とします。サポートするフィールドをプロバイダーAPIに対応付けます。プロバイダーがフィールドを処理できない場合は、黙って破棄せず、安定したコードを持つ`LlmError`を投げます。

`resolveModel(provider, model, signal?)`をオーバーライドし、1回の検索で正確なプロバイダー／モデル識別情報と、任意の`context`および`reasoning`メタデータを返します。reasoningメタデータには順序付きの不透明なIDと表示名、任意の設定済みデフォルトが含まれます。これらの値をコアのenumに昇格させず、上流の能力APIが`off`を返す場合も含めて、アダプターが正とする選択可能なリストを保持します。非同期検索では任意のシグナルに従い、キャンセルとdisposeが完全停止に到達できるようにします。サービスは集約結果を検証し、`stream()`の前にサポートされない明示的なeffortを拒否します。`reasoning`を省略すると、そのモデルには選択可能なreasoning-effort能力がありません。

## アダプターを登録する

```ts ignore-check
ctx.llm.registerAdapter(['my-provider'], adapter)
```

第1引数にはアダプターが処理するプロバイダールートを列挙します。`GenerateOptions.provider`が登録済みアダプターを選択し、`GenerateOptions.model`はライフサイクル登録なしでアダプター所有のモデルIDを渡します。セレクターにモデル候補を通知できるアダプターでは`listModels()`をオーバーライドします。

## cordis.ymlから使う

```yaml
- id: my-llm
  name: './src/my-llm-adapter.ts'
  config:
    apiKey: !!js process.env.MY_API_KEY
    providers:
      - my-provider

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: my-provider
        model: my-model-v1
```

## 実装例

リポジトリには完全な実装があります。

- `packages/llm/llm-deepseek/` — OpenAI互換形式を使うDeepSeek APIアダプター
- `packages/llm/llm-pi-ai/` — 異なるAPI形式を使うPi AIアダプター

同じharnessの約束を異なるプロバイダーSDK上で実装した2つのアダプターを比較してください。

## エラー処理

アダプターはトランスポートとプロトコルの失敗を、安定したコードを持つ`LlmError`値として投げます。agent loopは診断とポリシーのためにエラーとコードを保持し、通常の`Error`を自動変換しません。すべてのプロバイダーHTTPリクエストは`attributionHeaders()`もマージし、`options.signal`を転送する必要があります。

```ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw new LlmError(`Provider API error: ${response.status}`, 'PROVIDER_HTTP_ERROR')
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```
