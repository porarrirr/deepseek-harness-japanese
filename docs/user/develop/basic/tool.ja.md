# ツールを作る

[English](tool.md) | [中文](tool.zh.md) | 日本語

このチュートリアルではWeb UIに`greet`ツールを追加します。先に[最初のプラグイン](./)を完了し、その`scratch-plugin`ディレクトリを残しておいてください。

## ツールプラグインを作成する

`scratch-plugin/src/my-plugin.ts`を次の内容で置き換えます。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject`によってCordisはツールレジストリを待機します。`defineTool`は`parameters`から`args`を推論して検証します。`execute`は`output.schema`で宣言された正規値を返し、`output.render`はその値をモデル向けコンテンツに変換します。

## ツールを実行して呼び出す

開発用コマンドが実行されていなければ再起動します。

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080`を開き、`Use the greet tool to greet Ada.`と依頼します。モデルは`greet`を呼び出し、ツール結果として`Hello, Ada!`を受け取ります。

## 次のステップ

- [プラグイン設定](./config.md) — 挨拶を設定可能にする
- [ツール作成リファレンス](../../../cookbook/adding-a-tool.md) — ネストしたスキーマ、正規値、バックグラウンド処理、ポリシーフック、Code Mode、UIカードを調べる
- [Capabilityのレイヤー化](../practice/) — 交換可能な能力をService Definition、Service Provider、Consumerのパッケージに分割する
