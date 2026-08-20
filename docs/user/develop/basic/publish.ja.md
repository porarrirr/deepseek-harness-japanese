# プラグインをパッケージ化してインストールする

[English](publish.md) | [中文](publish.zh.md) | 日本語

これまでのチュートリアルでは`--patch`オーバーレイを通じてローカルプラグインを読み込みました。このチュートリアルでは、インストール可能な**bundle**としてパッケージ化し、`dsh plugin add`で**profile**にインストールして、構成された設定を決めるレイヤーの順序を説明します。`dsh` CLIがインストール済みであることを前提とします。先に[プラグイン設定](./config.md)を完了してください。

代わりに新しいソースチェックアウトを使う場合は、[ソースから実行するセクション](../../../../README.md#run-from-source)を完了し、このチュートリアルの`hello-plugin`ディレクトリをリポジトリのルートに置いたまま、残りの`dsh ...`コマンドをそこから`pnpm dsh ...`として実行します。ビルドとランチャーの動作については[ソース実行](../../../../apps/cli/reference/README.md#source-execution)を参照してください。

## 2つの概念、2つのマニフェスト

インストールは2つの概念で構成されます。どちらも`package.json`で記述しますが、`dsh`キーの下に異なる種類のマニフェストを持ち、異なる問いに答えます。

- **bundle**は設定レイヤーを配布するnpmパッケージです。マニフェストは`dsh.bundle`を宣言し、「このパッケージは何を追加するか」という問いに、プラグイン行を挿入または上書きするパッチファイルで答えます。
- **profile**は1つの実行可能な構成を記述する`$DSH_HOME/profiles/<name>`下のディレクトリです。マニフェストは`dsh.profile`を宣言し、「この設定をどのbundleがどの順序で構成するか」という問いに答えます。

bundleは作成して配布するもので、profileはユーザーが`dsh --profile <name>`で起動するものです。両方を兼ねるものはありません。

### bundleマニフェスト

パッケージディレクトリを作成します。

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

`hello-plugin/package.json`を作成します。

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

プラグインのエントリポイントを含む`hello-plugin/index.js`を作成します。

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

`hello-plugin/cordis.patch.yml`を作成します。このパッチは、これまで作成した`--patch`オーバーレイと同じYAML配列ですが、プラグイン行は相対ソースパスではなくパッケージ名を参照するため、Nodeの解決機能がインストール済みコードを見つけられます。

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

`dsh.bundle`宣言のないパッケージもインストールされますが、通常の依存関係としてだけ扱われます。`dsh plugin`は警告を表示し、レイヤーを有効にしません。プラグインパッケージがインポートするライブラリなど、ユーザーが有効化するプラグインではないものには、このパッケージ形式を使います。

### profileマニフェスト

profileディレクトリには2つのファイルがあります。

- `package.json` — profile外のプラグイン依存関係（pnpmが管理）と、順序付き`bundles`リストを持つ`dsh.profile`マニフェスト
- `cordis.patch.yml` — すべてのbundleレイヤーの後に適用される、ユーザー自身のパッチレイヤー

profileマニフェストを手作業で書くことはありません。`dsh plugin`が作成して維持します。次のセクションで結果を示します。

## profileにインストールする

`dsh plugin --profile <name> <args...>`はprofileディレクトリでpnpmに転送するため、すべてのpnpmサブコマンドが使えます。`hello-plugin`を含むディレクトリから、パッケージのチェックアウトをインストールします。

```sh
dsh plugin --profile demo add ./hello-plugin
```

初回の使用でprofileが初期化され（最初のbundleとして`@deepseek-ai/dsh-base`が入ります）、pnpmがチェックアウトをリンクします。パッケージが`dsh.bundle`を宣言しているため、`dsh`はbundleを`dsh.profile.bundles`に追加します。

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

起動せずにレイヤーを確認してから、起動します。

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin`は依存関係とレイヤーの両方を削除します。

## 読み込み順序

有効な設定は空のルートに対して、次の順序で適用して構成されます。

1. profileの`dsh.profile.bundles`リストに記載された各bundleパッチをリスト順に適用します。最初は`@deepseek-ai/dsh-base`で、その後は追加された順にインストール済みbundleが続きます。
2. profile自身の`cordis.patch.yml`
3. ホームレベルの`$DSH_HOME/cordis.patch.yml`（すべてのprofileで共有するマシンローカルの設定）
4. 各`--patch <path>`オーバーレイをargv順に適用します。

アプリの引数は別のパッチレイヤーではありません。後述する通常のアプリ所有サービスを通じて、surface bundleが引数を解決できます。

後のレイヤーが行ごとに優先され、パッチはキーを深くマージせず、行の`config`値全体を置き換えます。bundle作成者には次の2つの帰結があります。

- パッチは、[ `dsh-web-app` bundle](../../../../packages/bundle/web-app/cordis.patch.yml)が`dsh-base`の行を上書きするのと同じように、`id`で前のレイヤーの行を上書きできます。ただし変更したキーだけでなく、行に必要なすべてのキーを改めて記述する必要があります。
- ユーザーはパッケージに触れず、profileの`cordis.patch.yml`であなたの行を上書きできます。そのため、ユーザーが維持しそうな設定デフォルトを優先し、残りはスキーマに任せてください。

同梱bundleの名前は常にdsh自身のインストールから解決されます。pnpmが管理するのは外部パッケージだけなので、bundleは`@deepseek-ai/dsh-base`が存在し最新であることを前提にできます。

## surface bundleに独自のコマンドラインを与える

実行可能なアプリを定義するbundleは、通常のプロバイダープラグインをマウントします。

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

このプラグインは`inject = ['cmdlineArgs']`をエクスポートし、独自のcommanderプログラムで[`@deepseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md)の`parseCmdline`を呼び出し、プログラムのアクションからアプリ所有サービスを提供します。ランチャーはランチャーフラグの後にある同じ不変引数をすべてのプラグインへ渡すため、アプリ固有のフラグにランチャーの変更は不要で、複数のプラグインがスナップショットを解析できます。Loader行にランチャーマーカーや特別な種類は必要ありません。

その引数で設定される行はプロバイダーのサービスを注入し、自身の`!!js`オプションから値を読み取ります。横にあるデプロイメント値がフォールバックになります。

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

`--help`ではプロバイダーがサービスを公開しないため、それらの行は有効になりません。Loaderは構成を一度マウントし、各行の通常の注入を待ってから、その行の注入済みコンテキストに対して`!!js`設定を評価します。

## GitHubからのインストール：ビルドスクリプトの注意点

レジストリへの公開は必須ではありません。ユーザーはgitホストから直接インストールできます。

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

ただしgitインストールで取得されるのは**ソースであり、ビルド済みの成果物ではありません**。`build`スクリプトは実行されないため、TypeScriptパッケージは`lib/`出力なしで取得され、読み込みに失敗します。作成者側とユーザー側で、次の2つを行う必要があります。

- **作成者**は`prepare`スクリプトを同梱します。pnpmはgitインストール後に実行し、ソースから公開用エントリポイントを自己完結してビルドします。兄弟monorepoのチェックアウトなど、開発時だけ使える環境を前提にしてはいけません。[turtle-ui](https://github.com/deepseek-harness/turtle-ui)が実例です。`prepare`は専用のtsdown設定を実行し、プロジェクト参照や型チェックなしで`src/`をトランスパイルします。
- **ユーザー**はビルドをallowlistに追加します。pnpm ≥10は明示的に許可するまでgit依存関係の`prepare`スクリプトを実行しないため、最初の`add`は失敗します。`dsh`が修正方法を示すので、pnpmが表示した正確なパッケージキーをprofileの`pnpm-workspace.yaml`にコピーします。

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

その後、`add`を再実行します。

この許可は、agentが実行するサンドボックスの外で、インストール時にパッケージのコードをマシン上で実行するための**権限**です。ソースを信頼できるパッケージだけを許可し、後のpushで実行内容が予告なく変わらないよう、コミット（`github:you/hello-plugin#<sha>`）を固定してください。

ユーザーに許可を求めたくない場合は、ビルド済みの成果物を配布します。次のどちらの形式でもビルド許可は必要ありません。

- **npmに公開**する場合は、`pnpm publish`時に`lib/`をビルドします。`dsh plugin add your-package`でビルド済みコードがインストールされます。
- **tarballを配布**する場合は、`pnpm pack`で作成します。ユーザーは`dsh plugin add ./hello-plugin-0.1.0.tgz`を実行します。

## 次のステップ

- [プラグインとライフサイクル](../framework/) — プラグインの全ライフサイクル
- [CLI動作リファレンス](../../../../apps/cli/reference/README.md) — 正確なレイヤーの優先順位、フラグ、profileの仕組み
