# サービスと依存関係

[English](service.md) | [中文](service.zh.md) | 日本語

サービスは、あるプラグインが他のプラグインに公開する能力です。`inject`でプラグインが必要とするサービスを宣言します。

## サービスとは何か

Harnessでは、`tools`、`llm`、`agents`がサービスです。それぞれは`ctx`にマウントされた名前付きの能力です。

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

どのプラグインも他のプラグインが利用するサービスを提供できます。

## サービスを利用する

既存のサービスを使うには`inject`を宣言します。

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

`apply`の実行時には、`inject`で宣言したすべてのサービスが準備済みです。サービスが準備できていなければ、プラグインは実行せずに待機します。

## サービスを提供する

### Serviceを拡張する

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

このプラグインを読み込むと、利用側はサービスに`ctx.metrics`としてアクセスできます。

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### 型を宣言する

TypeScriptの宣言マージを使って`ctx.metrics`に型を付けます。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## 依存関係の動作

### 必須依存関係と任意依存関係

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### サービスが消えたとき

アプリケーションの実行中に、例えばプロバイダーのアンロードによって必須サービスが消えると、次のようになります。

1. 依存するプラグインが自動的にdisposeされる。
2. サービスが戻ると再び読み込まれる。

これにより、プラグインが存在しないサービスを呼び出すことを防ぎます。

## サービスの分離

`cordis.yml`ではサービスを分離できるため、別々のプラグイングループが同じサービスの別インスタンスを参照できます。

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a`と`plugin-b`はそれぞれ自分のグループのBashインスタンスを参照し、グループ間の影響はありません。

## 組み込みHarnessサービス

リポジトリはサービス名、公開メソッド、ソースの場所を各サービスの[サブシステムページ](../../../subsystems/core.md)に生成します。プラグイン開発時は生成された領域とサービスのTypeScriptインターフェースを使い、2つ目の静的リストを管理しないでください。

## 次のステップ

- [イベントシステム](./events.md) — 強い結合なしにプラグイン間で通信する
- [Capabilityのレイヤー化](../practice/) — サービスを能力のインターフェースとして使う
