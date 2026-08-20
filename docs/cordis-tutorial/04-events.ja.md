# 4. イベント

[English](04-events.md) | [中文](04-events.zh.md) | 日本語

サービスは直接呼び出しを支えますが、**イベント**を使うと、どのプラグインが待ち受けているかを知らずにプラグインが何かを通知できます。harnessでは、ツール結果、モデルリクエスト、承認判断などのやり取りにイベントを使います。

## 宣言、発行、待ち受け

`tmp/cordis-tutorial`に`stats.ts`を作成します。これは数を数え、変更のたびに通知するサービスです。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stats: StatsService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

export class StatsService extends Service {
  private counts = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  bump(name: string) {
    const next = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, next)
    this.ctx.emit('stats/report', name, next)
  }
}

export const name = 'stats'

export function apply(ctx: Context) {
  ctx.plugin(StatsService)
}
```

`interface Events`のマージは、第3章の`interface Context`マージに対応するイベントシステム側の仕組みです。イベント名とリスナーのシグネチャを宣言するため、`ctx.emit`と`ctx.on`が完全に型付けされます。`namespace/action`の命名規則により、フラットなイベント名前空間を読みやすく保てます。

`reporter.ts`を作成します。

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'
import type {} from './stats.ts'

export const name = 'reporter'
export const inject = ['stats']

export function apply(ctx: Context) {
  ctx.on('stats/report', (name, count) => {
    console.log(`[stats] ${name} -> ${count}`)
  })
  ctx.stats.bump('tool_call')
  ctx.stats.bump('tool_call')
  ctx.stats.bump('prompt')
}
```

`import type {} from './stats.ts'`の行は実行時には何もインポートしません。TypeScriptに宣言マージを認識させるために存在します。構成して実行します。

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

`ctx.on()`はエフェクトなので、プラグインとともにリスナーが消えます。`removeListener`を手動で管理する必要はありません。

## ディスパッチモード

`emit`は5つあるディスパッチモードの1つです。イベントがどのモードを使うかはその約束の一部であり、リスナーが値を返せるか、並行実行されるか、互いを短絡できるかを決めます。

| モード | 呼び出し | セマンティクス |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同期ブロードキャスト。返されたPromiseと値はawaitも収集もされない。 |
| parallel | `await ctx.parallel(name, ...args)` | すべてのリスナーが並行実行され、まとめてawaitされる。 |
| serial | `await ctx.serial(name, ...args)` | リスナーが順序どおりに実行されてawaitされる。最初の`null`／`false`／`undefined`以外の戻り値が優先され、残りを停止する。 |
| bail | `ctx.bail(name, ...args)` | serialの同期版。 |
| waterfall | `ctx.waterfall(name, ...args, next)` | aroundミドルウェア。以下を参照。 |

harnessのすべてのイベントは、所有する[サブシステムページ](../subsystems/core.md)の生成リファレンスにモードを記載しています。

## Waterfall：変換または短絡

Waterfallはインターセプトを実現するモードです。各リスナーは引数と`next()`継続を受け取り、`next()`の戻り値を変換するか、`next()`を呼ばずに戻ってチェーンの残りを短絡できます。Cordisのドキュメントではこれをvetoと呼びます。`waterfall-demo.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // Listener 1: wrap the downstream result.
  ctx.on('demo/transform', async (input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // Listener 2: short-circuit when it owns the decision.
  ctx.on('demo/transform', async (input, next) => {
    if (input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
```

`cordis.yml`がこのファイルだけを指すようにして実行します。

```
HELLO
** BLOCKED **
```

2行目を追ってみましょう。リスナー1が先に実行されて`next()`を呼び、リスナー2を呼び出します。リスナー2は`blocked`を見て`next()`を呼ばずに戻るため、最も内側のデフォルト（`ctx.waterfall`に渡した関数）は実行されません。リスナー1は戻る途中で置換メッセージを大文字にします。

ここから導かれる規律は次のとおりです。**監視または注釈だけを行うwaterfallリスナーは`next()`を呼び出さなければなりません**。呼び出さずに戻ることは意図的な短絡です。ログリスナーで`next()`を忘れると、下流の全員に対するデフォルト動作を黙って飲み込みます。これはこのリポジトリの常設ルールです（[waterfallのセマンティクス](../cordis-primer.md#cordis-waterfall-semantics)）。

harnessは、協調するプラグインがラップまたは回答できる判断にwaterfallを使います。[`agent/request`](../subsystems/core.md#agentrequest--waterfall)ではプラグインがモデル呼び出しの設定を置き換えられ、[`approval/request`](../subsystems/approval.md#approvalrequest--waterfall)ではポリシーがユーザーの代わりに回答できます。

次は[設定](05-config.md)です。`cordis.yml`からプラグインオプションを指定します。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
