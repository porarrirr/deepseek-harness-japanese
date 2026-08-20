# イベントシステム

[English](events.md) | [中文](events.zh.md) | 日本語

イベントはCordisプラグイン間の中核的な通信機構です。Harnessでは、疎結合の拡張点にイベントを幅広く使います。

## 基本的な使い方

### イベントを待ち受ける

```ts ignore-check
ctx.on('event-name', (payload) => {
  // Handle the event.
})
```

### イベントを発行する

```ts ignore-check
ctx.emit('event-name', payload)
```

## イベントモード

Cordisは、異なる対話の約束に対応する複数のイベントモードを提供します。

### emit — ブロードキャスト

すべてのリスナーが同期的に実行され、戻り値は無視されます。

```ts ignore-check
// Emit
ctx.emit('my-plugin/ready', { id: 'worker-1' })

// Listen
ctx.on('my-plugin/ready', ({ id }) => {
  console.log(`${id} is ready`)
})
```

### bail — 短絡

リスナーは順番に実行され、`null`、`false`、`undefined`以外の最初の結果が最終結果になります。

```ts ignore-check
// Dispatch
const result = ctx.bail('some-check', input)

// Listen: a returned value stops later listeners.
ctx.on('some-check', (input) => {
  if (shouldBlock(input)) return 'blocked'
  // Return null, false, or undefined to continue to the next listener.
})
```

### serial — 順序付き実行

リスナーは登録順に実行され、非同期の結果はawaitされます。`null`、`false`、`undefined`以外の最初の結果で後続の実行が停止します。

```ts ignore-check
await ctx.serial('setup-phase', context)
```

### waterfall — パイプライン

各リスナーは下流の結果をラップして処理チェーンを形成できます。リスナーは**下流へ委譲するために`next()`を呼び出さなければなりません**。呼び出さない場合、パイプラインは短絡します。

```ts ignore-check
// Dispatch
const output = await ctx.waterfall('my-plugin/transform', input, async () => input)

// Listen: next() is mandatory.
ctx.on('my-plugin/transform', async (_input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

::: warning
waterfallリスナーは**`next()`を呼び出さなければなりません**。呼び出さないと設計どおりパイプラインが短絡し、インターセプトやゲートウェイの動作が可能になります。
:::

## 型付きイベント

Harnessは、型安全なイベントのためにTypeScriptの宣言マージを使います。

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}

// ctx.on('my-plugin/ready', ...) and ctx.emit('my-plugin/ready', ...)
// are now inferred correctly.
```

## Cordisイベントとセッションレコード

HarnessのCordisイベントは`namespace/action`形式の名前を使います。`agent/step`、`agent/request`、`agent/request-error`、`tools/result`、`session/event`などがあります。[サブシステムページ](../../../subsystems/core.md)の生成された`cordis-surface`領域には、完全なシグネチャとモードが記録されています。

`turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*`は永続的なセッションイベント型であり、同名のCordisイベントではありません。これらを観測するには`session/event`を待ち受け、`event.type`を調べます。

## イベントリスナーはエフェクトである

`ctx.on()`で登録したリスナーは、所属するプラグインのアンロード時に自動的に削除されます。

```ts ignore-check
export function apply(ctx: Context) {
  // This listener is removed when the plugin disposes.
  ctx.on('tools/result', handler)
}
```

## 例：ログプラグイン

このプラグインはツール呼び出しと結果をログに記録します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    console.log(`[tool] ${exec.name}(${JSON.stringify(exec.arguments)})`)
    const text = result.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    console.log(`[tool result] ${text.slice(0, 100)}`)
  })
}
```

## 次のステップ

- [Capabilityのレイヤー化](../practice/) — 能力インターフェースにおけるイベントを理解する
- [LLMアダプター](../practice/llm-adapter.md) — 完全なLLMバックエンドを実装する
