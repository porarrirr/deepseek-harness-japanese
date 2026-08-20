# 5. 設定

[English](05-config.md) | [中文](05-config.zh.md) | 日本語

各`cordis.yml`エントリは`config`ブロックを持てます。プラグインは、`apply`の実行前にそれを検証するスキーマを宣言します。不正な設定は正確なエラーとともに読み込みに失敗し、設定が不完全なままプラグインが開始することはありません。

## 設定可能なプラグイン

`tmp/cordis-tutorial`に`config-demo.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'config-demo'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

エクスポートされた`Config`は、同じ名前を持つTypeScriptインターフェースと実行時スキーマの両方です。利用側は型を、Cordisはバリデーターを取得します。このリポジトリではスキーマに[Schemastery](https://github.com/shigma/schemastery)を使います。Cordis自体は任意の[Standard Schema](https://standardschema.dev/)バリデーターを受け付けるため、`Config`として通常のオブジェクトをエクスポートしても動作しません。

設定します。

```yaml
- name: './config-demo.ts'
  config:
    targets: ['alpha', 'beta']
```

実行します。

```
Hello, alpha!
Hello, beta!
```

`greeting`を省略したため、スキーマのデフォルト値が補いました。`apply`は常に完全に検証済みの設定を受け取ります。

## 明確に失敗させる

次に、無効な値を渡します。

```yaml
- name: './config-demo.ts'
  config:
    targets: 'not-an-array'
```

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

プラグインのfiberはFAILEDになり、このチュートリアルのランチャーはエラーを表示してステータス1で終了します。プラグインは、スキーマ上は有効でも利用できないリソースやプロバイダーを指定する設定を、参照を解決できる時点で拒否する必要もあります。

## 計算される設定値

このリポジトリで使うloaderは、読み込み時に計算する必要がある設定値のために`!!js`タグをサポートします。

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js`は`config`の中と、エントリの`disabled`フィールドでのみ動作します。`disabled: !!js ...`はマウント判断のたびにloaderコンテキストに対して評価されるため（このリポジトリの拡張）、行はプラットフォームや環境に応じて自身を制御できます。その他のメタデータ（`name`、`id`、`inject`など）は静的なままで、式は通常のtruthyデータとして扱われます。[loaderの設定](../cordis-primer.md#loader-configuration)を参照してください。

次は[構成とHMR](06-composition-and-hmr.md)です。`cordis.yml`をアプリケーションとして扱います。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
