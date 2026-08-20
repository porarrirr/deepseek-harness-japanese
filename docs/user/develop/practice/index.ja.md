# 3つの役割による能力設計

[English](index.md) | [中文](index.zh.md) | 日本語

このページは2部構成です。前半では3つの役割による能力パターンを概説し、後半の高度なチュートリアルでは1つの能力を構築します。先に[基本的なプラグインの手順](../basic/)と[サービスチュートリアル](../framework/service.md)を完了してください。

## 概念リファレンス

Bash実行のように、能力に交換可能なプロバイダーが必要なほど汎用的な場合、Harnessは3つの役割、**Service Definition**、**Service Provider**、**Consumer**に分けます。役割を独立して発展または交換する必要がある場合は別パッケージにし、それ以外では1つのパッケージが複数の役割を所有しても構いません。完全な能力がそのseamです。個々の役割はseamではありません。

## Bashの例

Bash実行能力は次で構成されます。

- **Service Definition**（`dsh-shell`） — CordisサービスとBashのリクエスト／結果型を定義する
- **Service Provider**（`dsh-bash-local`） — ローカルマシンでコマンドを実行する
- **Consumer**（`dsh-tool-bash`） — 能力をモデルから呼び出せるツールとして公開する

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## 分割の利点

### プロバイダーを交換する

1つのService Definitionに複数のプロバイダーを用意し、`cordis.yml`で選択できます。

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

プロバイダーを変更しても、Service Definitionとツールは変わりません。

### 独立して発展させる

- Service Definitionは呼び出し側がその約束に依存した後は、ほとんど変更しません。
- Service Providerは性能とセキュリティを独立して改善できます。
- Consumerは能力をモデルにどう提示するかを変更できます。

### 依存関係を分離する

- Service ProviderはService Definitionに依存します。
- ConsumerはService Definitionに依存します。
- Service ProviderとConsumerは**互いに依存しません**。

[能力seamリファレンス](../../../capability-seams.md)に、現在組み込まれているファミリーとパッケージへのリンクがあります。

## チュートリアル：3つの役割による能力を開発する

### 手順1：Service Definitionを書く

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### 手順2：Service Providerを書く

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### 手順3：Consumerを書く

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### cordis.ymlで組み合わせる

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## 設計上の要点

- **先回りして分割しない** — 役割を独立して発展させる必要がある場合だけ別パッケージを使う。単純なツールプラグインには不要です。
- **Service DefinitionがRequest/Result型を所有する** — Service ProviderとConsumerはService Definitionパッケージだけに依存します。
- **明示的 > 暗黙的** — `run()`の中に`?? default`式を隠さず、明示的な`resolve(request): Spec`手順でデフォルトを解決します。

## 次のステップ

- [LLMアダプター](./llm-adapter.md) — LLMプロバイダーを実装する
