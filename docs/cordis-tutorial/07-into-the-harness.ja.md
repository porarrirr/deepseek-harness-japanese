# 7. Harnessの内部へ

[English](07-into-the-harness.md) | [中文](07-into-the-harness.zh.md) | 日本語

この章では、harnessの`tools`サービスにモデルから呼び出せるツールを登録し、harnessのツールパイプラインで実行して、結果イベントを観測します。キーなしで動作し、モデルは呼び出しません。

## ツールプラグイン

`tmp/cordis-tutorial`に`greet-tool.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet the named person.',
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))

  // Drive one call through the real execution pipeline, standing in for
  // the model. CallId brands the correlation id a provider would issue.
  void (async () => {
    const result = await ctx.tools.execute({
      callId: CallId('demo-1'),
      name: 'greet',
      arguments: { name: 'Cordis' },
      signal: new AbortController().signal,
    })
    console.log('tool replied:', JSON.stringify(result.content))
  })()
}
```

ここで使うパターンはすべて前の章から来ています。`inject: ['tools']`（[第3章](03-services.md)）はツールレジストリが存在するまでプラグインを保持します。`ctx.tools.register(...)`は登録のdisposerをプラグインに接続するため（[第2章](02-lifecycle-and-effects.md)）、アンロード時にツール登録が解除されます。`defineTool`は`parameters`仕様をモデルに表示するJSON Schemaへ変換し、`args`の型を推論し、`execute`の実行前にモデルが指定した引数を検証します。ツールは`output.schema`で宣言された正規値を返し、`output.render`がNativeおよび永続的な結果コンテンツを別途生成します。

## オブザーバープラグイン

`tool-logger.ts`を作成します。これはharnessの`tools/result`イベントを通じてアプリ内のすべてのツール呼び出しを監視する別のプラグインです。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    const text = result.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    console.log(`[tool-logger] ${exec.name} -> ${text}`)
  })
}
```

`import type {} from '@deepseek-ai/dsh-tools'`の行はパッケージの宣言マージを取り込み、`'tools/result'`とそのペイロードに型を付けます。第4章の`stats.ts`インポートと同じ方法を、パッケージ規模で行っています。

## 構成して実行する

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: './tool-logger.ts'
- name: './greet-tool.ts'
```

`@deepseek-ai/dsh-tools`はツールがシステムプロンプトにスキーマを追加するため`systemPrompt`サービスを注入します。そのため構成にはプロバイダーも記載します。プロバイダーがないと、[第6章](06-composition-and-hmr.md)で説明したようにtoolsプラグインはPENDINGのままです。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

```
[tool-logger] greet -> Hello, Cordis!
tool replied: [{"type":"text","text":"Hello, Cordis!"}]
```

ロガーが先に実行されました。`tools/result`は結果の具体化の一部として発行され、`execute`のPromiseが呼び出し元に解決される前に発行されます。2つのプラグインは互いの存在を知りません。レジストリサービスとイベントが両者を接続します。

## ここから完全なagentへ

実際のagentは、この構成にさらにLLMアダプター、agent loop、永続化、エントリポイントなどのプラグインを加えたものです。[examples/headless-agent/cordis.yml](../../examples/headless-agent/cordis.yml)と比較してください。今ならその中のすべてのエントリを読めます。そのファイルのコピーに`greet-tool.ts`を追加してみてください。

次に進む先：

- [ツールを作る](../user/develop/basic/tool.md) — 表示方法やより豊富なスキーマを含む、`defineTool`の詳しい使い方
- [3層の能力設計](../user/develop/practice/index.md) — harnessが交換可能な能力を構成する方法
- [サブシステムページ](../subsystems/core.md)の生成された`cordis-surface`領域 — 注入および待ち受けできるすべてのものを、それぞれの所有ページで確認できる
- [アーキテクチャ](../architecture.md) — これらのプラグインが属するシステムの構成図

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
