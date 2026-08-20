# プラグインとライフサイクル

[English](index.md) | [中文](index.zh.md) | 日本語

このページでは、Cordisのプラグインモデルとライフサイクルの状態機械を説明します。

## Fiber状態機械

読み込まれた各プラグインは、次の状態を持つ**Fiber**スコープを所有します。

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| 状態 | 意味 |
|------|------|
| PENDING | 宣言済みだが、必要な依存関係が準備できていない |
| LOADING | 依存関係が準備でき、`apply`を実行中 |
| ACTIVE | プラグインが実行中 |
| FAILED | `apply`がエラーを投げた |
| UNLOADING | プラグインをアンロードし、リソースを解放中 |
| DISPOSED | プラグインのアンロードが完了した |

## 依存関係による読み込み

`inject`を持つプラグインは、必要なサービスがすべて揃うまで読み込みを待ちます。

```ts ignore-check
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // ctx.tools and ctx.llm are ready here.
}
```

必要なサービスが、例えばプロバイダーの置換中に消えると、プラグインは自動的にアンロードされ（ACTIVE → DISPOSED）、サービスが戻ると再び読み込まれます。

## 自動クリーンアップ

`ctx`を通じて行った登録は、プラグインのアンロード時にすべて取り消されます。

```ts ignore-check
export function apply(ctx: Context) {
  // Event listener: removed automatically on unload.
  ctx.on('some-event', handler)

  // Custom resource: the returned disposer runs on unload.
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

フレームワークは次の操作を追跡して解放します。
- `ctx.on(event, handler)` — イベントリスナー
- `ctx.tools.register(tool)` — ツール登録
- `ctx.llm.registerAdapter(names, adapter)` — LLMアダプター登録
- `ctx.effect(() => cleanup)` — カスタムリソース

アンロード時、disposerの呼び出しは登録と逆の順序で始まりますが、複数の非同期disposerは並行して実行され、完了順序は保証されません。順序に依存するクリーンアップは、1つの`ctx.effect()`から返すdisposerにまとめ、その中で各ステップを順番にawaitしてください。

## 入れ子のコンテキスト

`ctx.plugin()`は、親コンテキストを継承しながら独立したライフサイクルを持つ子Fiberを作成します。

```ts ignore-check
export function apply(ctx: Context) {
  // Register a child plugin.
  ctx.plugin(childPlugin)

  // The child has its own Fiber and unloads with its parent.
}
```

## disposeの意味

プラグインインスタンスを早期に停止するには、次のようにします。

```ts
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)

// Dispose it manually later.
await fiber.dispose()
```

`dispose`は次を保証します。
1. プラグインが所有するすべての登録が削除される。
2. 子プラグインが再帰的にアンロードされる。
3. 返されたPromiseは、すべての非同期クリーンアップが完了した後に解決する。

## ホット置換（HMR）

`cordis.yml`から`@deepseek-ai/cordis-plugin-hmr`を読み込んでいると、プラグインのソースファイルを編集したときに次が行われます。

1. 古いプラグインをアンロードし、登録をクリーンアップする。
2. 新しいコードを読み込む。
3. 新しい`apply`を実行する。

プラグインの登録は自身をクリーンアップするため、ホット置換後に古いインスタンスの登録が残ることはありません。

## ライフサイクルの例

```ts ignore-check
export function apply(ctx: Context) {
  console.log('plugin loading')

  ctx.effect(() => {
    console.log('effect registered')
    return () => console.log('effect cleaned up')
  })
}
```

読み込み時の表示：
```
plugin loading
effect registered
```

アンロード時の表示：
```
effect cleaned up
```

## 次のステップ

- [サービスと依存関係](./service.md) — 他のプラグインに能力を公開する
- [イベントシステム](./events.md) — プラグイン間で通信する
- [Cordisチュートリアル](../../../cordis-tutorial/index.md) — Cordisランタイム上で同じライフサイクル、サービス、イベントを段階的に構築する
