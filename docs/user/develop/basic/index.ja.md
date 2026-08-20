# 最初のプラグイン

[English](index.md) | [中文](index.zh.md) | 日本語

このチュートリアルでは最小限のHarnessプラグインを作成し、Web UIに読み込みます。[ソースから実行する手順](../../../../README.md#run-from-source)を完了したリポジトリのチェックアウトから始めてください。

## ローカルプロジェクトを作成する

リポジトリのルートから、チュートリアル用の一時プロジェクトを作成します。

```sh
mkdir -p scratch-plugin/src
```

## プラグインとは何か

Harnessでは、プラグインは`apply`関数をエクスポートするTypeScriptモジュールです。フレームワークはプラグインの読み込み時に`apply`を呼び出し、プラグインが能力を登録するための`ctx`コンテキストオブジェクトを渡します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

これで設定は完了です。

## プラグインファイルを作成する

`scratch-plugin/src/my-plugin.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  // Required dependencies are ready before apply runs.
  console.log('[hello-plugin] plugin loaded!')
}
```

## cordis.ymlに登録する

リポジトリのルートで`pwd`を実行し、ローカルプラグインを挿入するWebオーバーレイとして`scratch-plugin/cordis.yml`を作成します。下記の`/absolute/path/to/deepseek-harness`を表示されたパスに置き換えてください。

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

プラグインのパスは絶対パスでなければなりません。パッチファイルは設定を追加しますが、loaderがモジュールパスを解決するプロファイルディレクトリは変更しません。

そのオーバーレイを使ってWeb UIを起動します。

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080`を開きます。起動中にターミナルへ`[hello-plugin] plugin loaded!`と表示されます。

## 自動クリーンアップ

`ctx`を通じて登録したもの（イベントリスナー、ツール、タイマーなど）は、プラグインのアンロード時にクリーンアップされます。`removeListener`や`clearInterval`を手動で呼ぶ必要はありません。

ネットワーク接続など明示的なクリーンアップが必要なリソースには、`ctx.effect()`でdisposerを提供します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    // The returned function runs when the plugin unloads.
    return () => clearInterval(timer)
  })
}
```

## 依存関係を宣言する

プラグインが`tools`や`llm`など別のサービスを利用する場合は、`inject`に宣言します。

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
  ctx.tools.register(/* ... */)
}
```

フレームワークは必要なサービスがすべて揃うまでプラグインを読み込みません。

## 3つのプラグイン形式

関数モジュールのほかに、プラグインはオブジェクト形式またはクラス形式を使えます。

### オブジェクト形式

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### クラス形式

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
    // Perform synchronous initialization in the constructor.
  }
}
```

ほとんどの場合は関数形式で十分です。プラグインが他のプラグインにサービスを提供する場合はクラス形式を使います。[サービスと依存関係](../framework/service.md)を参照してください。

## 次のステップ

- [ツールを作る](./tool.md) — ツール定義DSLを学ぶ
- [プラグイン設定](./config.md) — ユーザー設定を受け付ける
- [Cordisチュートリアル](../../../cordis-tutorial/index.md) — APIキーなしで一時ディレクトリから構築する、基盤のプラグインフレームワーク
