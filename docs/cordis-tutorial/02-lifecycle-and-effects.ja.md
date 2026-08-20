# 2. ライフサイクルとエフェクト

[English](02-lifecycle-and-effects.md) | [中文](02-lifecycle-and-effects.zh.md) | 日本語

Cordisプラグインは、設定の編集、ホットリロード、明示的な解放、必須サービスの喪失によってアンロードされます。Cordis APIを通じて行った登録はエフェクトであり、所有するプラグインのアンロード時に取り消されます。これらのAPIの外で管理するリソースは`ctx.effect()`でラップする必要があります。

## エフェクト

Cordisが管理していないリソース（タイマー、接続、ウォッチャーなど）は`ctx.effect()`でラップし、disposerを返します。

`tmp/cordis-tutorial`に`lifecycle.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lifecycle-demo'

function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}

export function apply(ctx: Context) {
  // Mount a child plugin and keep its fiber to dispose it later.
  const fiber = ctx.plugin(heartbeat)
  // The demo timer is itself an effect: if THIS plugin is unloaded first,
  // the pending callback is cancelled instead of firing on a dead app.
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

`cordis.yml`からこのファイルを指すようにします。

```yaml
- name: './lifecycle.ts'
```

実行（`node --import tsx ../../vendor/cordis/bin.js`）すると、次の出力になります。

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

注目すべき点は3つあります。

- `ctx.plugin(heartbeat)`は**コードから**関数をプラグインとしてマウントします。YAML loaderが各設定エントリに対して行う操作と同じです。関数プラグインに`apply`メソッドは必要ありません。Cordisが関数を直接呼び出し、名前は診断にだけ使います。`apply`メソッドが必要なのはオブジェクト形式`ctx.plugin({ apply(ctx) { /* ... */ } })`だけです。呼び出しは、読み込まれた1つのプラグインインスタンスを扱うランタイムハンドルである**fiber**を返します。
- エフェクト本体は読み込み中に実行され、返したdisposerはアンロード中に実行されます。プラグインのライフサイクルに属するリソースのdisposerを自分で呼ぶことはありません。
- `fiber.dispose()`は、非同期disposerを含むプラグインのすべてのクリーンアップが完了した後に解決し、マウントした子プラグインも再帰的にアンロードします。

## fiber状態機械

読み込まれた各プラグインインスタンスは、次の状態を遷移するfiberを所有します。

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- **PENDING** — 宣言済みだが、必須サービス（第3章）がまだ利用できない。
- **LOADING / ACTIVE** — `apply`を実行中／完了した。
- **FAILED** — `apply`または設定検証が例外を投げた。
- **UNLOADING / DISPOSED** — disposerを実行中／すべての解体が完了した。

「なぜプラグインが何も表示しないのか」という問いの通常の答えとして、[第6章](06-composition-and-hmr.md)でもPENDINGが登場します。

## すでにエフェクトであるもの

組み込みの登録APIはすでにエフェクトなので、自分で`ctx.effect()`を書くことはほとんどありません。

- `ctx.on(event, listener)` — アンロード時にリスナーが削除される（[第4章](04-events.md)）。
- `ctx.plugin(child)` — 親とともに子がdisposeされる。
- サービス登録はエフェクトです。`ctx.tools.register(...)`などHarnessのレジストリも、返したdisposerを呼び出し元プラグインに接続するため、自動的に巻き戻されます（[第7章](07-into-the-harness.md)）。

Cordisが管理しないリソースは`ctx.effect()`の中で取得し、解放するdisposerを返します。Cordisはホットリロードを含むアンロード時にその解放処理を呼び出します。

順序について1つ注意があります。disposerは登録と逆の順序で開始されますが、複数の**async** disposerは並行して実行されます。解体手順を順番に実行する必要がある場合は、1つのdisposerにまとめて、その中でawaitしてください。

次は[サービス](03-services.md)です。プラグインが能力を共有する方法を扱います。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
