# 3. サービス

[English](03-services.md) | [中文](03-services.zh.md) | 日本語

**サービス**は、あるプラグインが提供し、他のプラグインが`ctx`を通じて利用する名前付きの能力です。harnessでは、`ctx.tools`、`ctx.llm`、`ctx.agents`がサービスです。利用側はプロバイダーをインポートせず、`'tools'`のように能力名を指定するため、利用側を変更せず設定からプロバイダーを選べます。

## サービスを提供する

`tmp/cordis-tutorial`に`greeter.ts`を作成します。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(who: string) {
    return `Hello, ${who}!`
  }
}

export const name = 'greeter'

export function apply(ctx: Context) {
  ctx.plugin(GreeterService)
}
```

2つの要素が連携します。

- **ランタイム**：`super(ctx, 'greeter')`はインスタンスを`greeter`という名前で登録します。以後、どのプラグインからも`ctx.greeter`としてアクセスできます。登録はエフェクトなので、プロバイダーをアンロードするとサービスが削除されます。
- **コンパイル時**：`declare module '@deepseek-ai/cordis'`ブロックはTypeScriptの宣言マージです。`Context`インターフェースに`greeter`を追加するため、どこでも`ctx.greeter`の型チェックが行われます。コードは生成されません。これがなくてもサービスは実行時に動作しますが、利用側は型安全性を失います。

`Service`サブクラス自体がプラグイン（第1章のクラス形式）なので、`ctx.plugin(GreeterService)`で他のプラグインと同じようにマウントできます。

## `inject`でサービスを利用する

`consumer.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject`には、このプラグインが必要とするサービスを列挙します。Cordisは列挙されたサービスがすべて存在するまでプラグインをPENDINGに保持するため、`apply`の中では`ctx.greeter`が必ず準備済みです。`cordis.yml`の読み込み順は関係ありません。プラグインの開始時期を決めるのはファイル順ではなく依存関係です。

構成して実行します。

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

`cordis.yml`の2行を入れ替えて再実行しても、同じ出力になります。`./greeter.ts`を完全に削除してみると、利用側はPENDINGのまま何も表示しません。クラッシュも途中までの実行もありません。PENDINGのfiberはNodeのイベントループを維持しないため、他に実行中のものがない構成は何も表示せず終了コード0で終了します。その状態の診断方法は[第6章](06-composition-and-hmr.md)で説明します。

## 読み込み後も依存関係が追跡される

`inject`は起動時に1回だけ行うチェックではありません。アプリの実行中に必須サービスが消えると（プロバイダーがアンロードまたはホット置換されるなど）、依存するすべてのプラグインもアンロードされ、サービスが戻ると再び読み込まれます。エフェクト（[第2章](02-lifecycle-and-effects.md)）と組み合わせることで、実行中の利用側が利用できないサービスへの参照を保持することを防ぎます。依存関係が消えると、利用側自身の登録も巻き戻されます。

設定でサービスを交換できるのもこのためです。`dsh-bash-local`エントリをアンロードし、別の`shell`プロバイダーをマウントすると、`'shell'`を注入するすべてのプラグインが新しい実装に対して正常に再起動します。

## 任意の依存関係

`inject`は必須要件のためのものです。なくてもプラグインが動作できる能力では、`inject`を省略して利用箇所で確認します。

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## 命名

サービス名はアプリケーションごとの1つのフラットな名前空間に置かれます。独自サービスには、明確な接頭辞または名前空間を付けてください（harnessは`tools`や`llm`のような単純な名前を予約します）。harnessが登録するすべての名前は、[サブシステムページ](../subsystems/core.md)の生成された`cordis-surface`領域に一覧されています。

次は[イベント](04-events.md)です。共有サービスなしの通信を扱います。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
