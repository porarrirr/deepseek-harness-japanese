# Cordisチュートリアル

[English](index.md) | [中文](index.zh.md) | 日本語

CordisはDeepSeek Harnessの下層にあるプラグインフレームワークです。ツール、LLMアダプター、ファイルアクセス、agent loop自体など、すべての能力を共有コンテキストにマウントされたプラグインとして扱う小さなランタイムです。このチュートリアルではCordisを実際に学びます。各章でリポジトリ内の一時ディレクトリに実行可能な例を構築し、最後に実際のharnessサービスへ接続したプラグインを完成させます。

対象読者はagent開発者です。TypeScriptの深い経験は必要ありません。下記の[TypeScriptに関する注意](#typescript-notes)で不慣れな構文を説明し、各章で正確なコマンドと期待される出力を示します。

手順ではなく要点をまとめた概念リファレンスが必要なら、[Cordis入門](../cordis-primer.md)を読んでください。完全なAPIリファレンスは、[サブシステムページ](../subsystems/core.md)と[Cordis Core API](../cordis-api/context.md)ページにある生成済みの`cordis-surface`領域にあります。

Harness自体のプラグイン（下記のランチャーではなく`cordis.yml`から読み込まれ、Web UIから操作するもの）を書く場合は、[最初のHarnessプラグイン](../user/develop/basic/index.md)から始めてください。

## セットアップ

依存関係をインストールしたこのリポジトリのクローンが必要です。前提条件は[開発ガイド](../development.md#setup-tutorial)に記載されています。このチュートリアルにAPIキーは必要なく、すべての例をキーなしで実行できます。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

各章で使う一時ディレクトリを作成します。`tmp/`はgitignore対象なので、そこに書いたものがバージョン管理に影響することはありません。

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

各章でこのディレクトリから同じコマンドを実行します。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

この1ファイルのランチャー（[vendor/cordis/bin.js](../../vendor/cordis/bin.js)を参照）はルート`Context`を作成し、Loaderプラグインをマウントして、現在のディレクトリから`./cordis.yml`を読み込むよう指示します。どのプラグインが存在し、どう設定されるかは、これから作成するそのYAMLファイルから決まります。`--import tsx`フラグにより、Nodeはビルド手順なしで設定が指すTypeScriptファイルを実行できます。

## 章

1. [最初のプラグイン](01-first-plugin.md) — プラグインは関数であり、loaderがマウントする。
2. [ライフサイクルとエフェクト](02-lifecycle-and-effects.md) — Cordisが管理する登録は、所属プラグインのアンロード時に取り消される。
3. [サービス](03-services.md) — `ctx`に能力を公開し、`inject`で依存する。
4. [イベント](04-events.md) — 型付きイベント、ブロードキャストディスパッチ、waterfallの短絡。
5. [設定](05-config.md) — `cordis.yml`から検証済み設定を受け取り、不正な入力では明確に失敗する。
6. [構成とHMR](06-composition-and-hmr.md) — 設定ファイルをプラグインツリーとして扱い、ホットリロードし、読み込まれないプラグインを診断する。
7. [Harnessの内部へ](07-into-the-harness.md) — 実際のharnessサービスに対してモデルから呼び出せるツールを登録する。

<a id="typescript-notes"></a>

## TypeScriptに関する注意

例では、通常の現代的なJavaScript以外に、次の3つのTypeScript機能を使います。

- **型注釈**は実行時の動作を変えずに値を記述します。`ctx: Context`は`ctx`がCordisのコンテキストAPIを持つことを示し、`who: string`はテキストを受け付け、`string[]`は文字列の配列を意味します。
- **`import type { Context } from '@deepseek-ai/cordis'`**は型情報だけをインポートします。実行時には消えるため、注釈のためだけに`Context`が必要なプラグインファイルは実行時依存関係を追加しません。
- **宣言マージ**（`declare module '@deepseek-ai/cordis' { ... }`）は、Cordisがすでに宣言しているインターフェースにエントリを追加します。例えば、新しい`ctx.greeter`プロパティやイベント名の型です。実行時の配線は生成されず、サービスの提供やイベントの発行はプラグインが別途行います。第3章でパターン全体を示します。

第5章では、設定オブジェクトのフィールドを記述する`interface`と、スキーマがどのオブジェクトフィールドを検証するかを示す`Schema<Config>`のようなジェネリック型も使います。示した宣言をそのままコピーできます。それぞれが何を接続するかは周囲の説明で分かります。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
