# 1. 最初のプラグイン

[English](01-first-plugin.md) | [中文](01-first-plugin.zh.md) | 日本語

ここで使うloader設定では、Cordisプラグインモジュールが名前付きで`apply`関数をエクスポートします。Cordisが読み込むと、プラグインが提供するすべてを登録するための`ctx`オブジェクトである**コンテキスト**を引数に`apply`を呼び出します。

## プラグインを書く

`tmp/cordis-tutorial`ディレクトリ（[セットアップ](index.md#setup)を参照）に`hello.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

`name`エクスポートは任意の表示メタデータで、診断時にプラグインへラベルを付けます。

## アプリを構成する

このチュートリアルのランチャーは設定からアプリケーションを組み立てます。`cordis.yml`を作成します。

```yaml
- name: './hello.ts'
```

ファイルはプラグインエントリのリストです。`name`は相対パスまたはnpmパッケージ名であるモジュール指定子で、loaderはすべてのエントリをマウントします。エントリは並行して開始されるため、リストの位置はどのプラグインが先に読み込まれるかを保証しません。順序はファイル内の位置ではなく、サービス依存関係（`inject`、[第3章](03-services.md)）から決まります。

## 実行する

```sh
node --import tsx ../../vendor/cordis/bin.js
```

期待される出力：

```
hello from my first plugin
```

実行中のものがなくなると、プロセスは自動的に終了します。起きたことは次のとおりです。

1. ランチャーがルート`Context`を作成し、**Loader**プラグインをマウントした。
2. Loaderが`cordis.yml`を読み、`./hello.ts`を解決して子プラグインとしてマウントした。
3. Cordisがあなたの`apply(ctx)`を呼び出した。

ファイルにフレームワークのブートストラップコードはありません。プラグインは提供するものを記述し、`cordis.yml`がアプリケーションを構成します。例えば[`dsh` base](../../packages/bundle/base/cordis.patch.yml)は、デプロイメントオーバーレイがパッチする、より大きなプラグイン構成です。

## その他2つのプラグイン形式

関数が最も一般的な形式ですが、Cordisは3つの形式を受け付けます。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

サービスを公開する必要が生じるまでは関数形式を使います。クラス形式を使うべき場合は[第3章](03-services.md)で説明します。

## 壊してみる

`apply`が例外を投げるようにします。

```ts ignore-check
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

もう一度実行すると、そのエラーでプロセスが終了します。読み込みに失敗したプラグインは、スキップされたエントリではなく明確な失敗になります。

早めに知っておくべき注意点が1つあります。モジュールを**解決**できない設定エントリ（パスやパッケージ名のタイプミス）は、プロセスをクラッシュさせずCordisのloggerサービスを通じて報告されますが、起動時にはコンソールエクスポーターが監視を始める前にその報告が失われることがあります。追加したばかりのエントリが何もしないように見える場合は、まず綴りを確認してください。

次は[ライフサイクルとエフェクト](02-lifecycle-and-effects.md)です。プラグインがアンロードされると何が起きるかを扱います。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
