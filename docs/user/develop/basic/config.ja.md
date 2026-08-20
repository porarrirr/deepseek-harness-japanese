# プラグイン設定

[English](config.md) | [中文](config.zh.md) | 日本語

`cordis.yml`から提供される設定を受け付けます。

## Config型を定義する

`Config`型と、同名のSchemasteryスキーマをエクスポートします。デフォルト値はスキーマのフィールドに直接設定します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)  // User value or schema default.
}
```

`scratch-plugin/cordis.yml`のinsertしたlocal plugin rowにconfigを追加します。

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

プラグインの読み込み時、Cordisはエクスポートされたスキーマで設定を検証し、デフォルト値を補います。`Config`として通常のオブジェクトをエクスポートしないでください。Cordisが必要とするStandard Schemaインターフェースを実装していないためです。

## スキーマ検証

Schemasteryを使って、より厳密な検証を表現します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'validated-plugin'

export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export function apply(ctx: Context, config: Config) {
  // config is validated and type-safe.
}
```

スキーマはプラグインの読み込み中に実行されます。無効な設定では、対処方法が分かるエラーとともに読み込みが失敗します。

## 設計原則

### 調整可能な値をハードコードしない

Harnessでは、**2つのデプロイメントが異なる値にしたい可能性があるものは、すべて設定フィールドにする**必要があります。

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

コードを編集せずに`cordis.yml`で値を変更できるかどうかが判断基準です。

### 無効な設定では明確に失敗させる

自己完結した制約はスキーマで表現し、無効な設定がプラグインの読み込み時に失敗するようにします。サービスや登録済みリソースへの参照には依存性注入が必要です。その約束については[サービスチュートリアル](../framework/service.md)で説明します。

## HMRと連携する

設定を編集するとプラグインがホット置換されます。フレームワークは古いインスタンスをアンロードし、新しいインスタンスを読み込みます。登録はエフェクトであり自身をクリーンアップするため、置換後に古いインスタンスの登録が残ることはありません。

## 次のステップ

- [プラグインをパッケージ化してインストールする](./publish.md) — インストール可能なパッケージとしてプラグインを配布する
- [プラグインとライフサイクル](../framework/) — プラグインの全ライフサイクルを理解する
- [サービスと依存関係](../framework/service.md) — 他のプラグインにサービスを提供する
