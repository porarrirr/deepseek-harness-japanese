# Cookbook：設定カードを追加する

[English](adding-a-settings-card.md) | [中文](adding-a-settings-card.zh.md) | 日本語

プラグインが自身の設定をWeb設定ページに追加する方法です。この手順ではリポジトリ内の変更は必要ありません。Hostは登録されたすべての設定名前空間を提供し、**Plugins**セクションは編集する名前空間をキーとしてカードを扱うため、両方の側を登録したプラグインは自動的に対応付けられます。

2つの側は1つのパッケージに置きます。Host側は`src/`の下、ブラウザー側は`src/client/`の下に置き、`./client`としてエクスポートし、`dsh.client`で宣言します。[`packages/client/ui-theme`](../../packages/client/ui-theme)がそのパッケージ構成の実例で、このセクションが提供するカードは[`packages/client/ui-settings-plugins`](../../packages/client/ui-settings-plugins)にあります。

## 1. 名前空間を登録する（Host側）

名前空間が結合キーなので、1度決めて両方の側で同じ綴りを使います。すでに`cordis.yml`エントリを持つ利用側は`installSettingsSection`を通じて登録します。これによりエントリがユーザードキュメントの下にレイヤー化され、設定プロバイダーがマウントされていない場合も動作します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

declare function assertReachable(endpoint: string | undefined): void
declare function rebuildFromSettings(config: Config): void

export const MY_PLUGIN_NS = settingsNamespace('my-plugin')

export interface Config {
  endpoint?: string
  retries?: number
}

export const Config: z<Config> = z.object({
  endpoint: z.string(),
  retries: z.number().step(1).min(0).default(3),
})

export function apply(ctx: Context, config: Config) {
  let source = () => config
  installSettingsSection(ctx, MY_PLUGIN_NS, Config, config, {
    // Constraints the schema cannot express refuse the write, not the next use.
    validate: value => void assertReachable(value.endpoint),
    setSource: (current) => { source = current },
    onChange: () => { rebuildFromSettings(source()) },
  })
}
```

フィールドに`role('secret')`を指定すると、値がすべてのレスポンスから除外されます。カードはそのフィールドを`update`／`mutate`ペイロードに書き込むか、代わりに`credentials`ドメインを通じて認証情報参照を扱います。`applies: 'restart'`は、所有者が変更を次回起動時にだけ適用することを設定画面へ伝えます。

## 2. カードを登録する（ブラウザー側）

カードは自身の名前空間で`settings.plugin.item`に登録し、その中のすべて（外枠、コントロール、文言）を所有します。`ctx.settingsScope`を通じて読み書きし、読み取ったリビジョンで各書き込みを保護します。

```ts ignore-check
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the keyed slot's declaration. Cross-plugin collaboration goes
// through cordis services; a value import fails the client bundle-purity gate.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const card = new MyPluginCardController(ctx.settingsScope.bind({ namespace: 'my-plugin' }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'my-plugin',
    locale: 'settings.myPlugin',
    inject: () => card.inject(),
  }, MyPluginCard),
  )
}
```

スコープのスナップショットにはフォームに必要なものが含まれます。解決済みの`value`、構成の`base`、生の`user`レイヤーです。フィールドが上書き済みと判断するのは値ではなくキーの**存在**です。`scope.set(field, value)`は1つのフィールドを保存し、`scope.unset(field)`は構成レイヤーの値に戻します。

## 3. タブでの表示

**Plugin configuration**タブはHostが提供する名前空間を読み取り、名前空間ごとに1つのslotキーをディスパッチします。Hostがキーを提供するとカードがレンダリングされ、提供しないとスキップされます。そのためHost側を構成していないデプロイメントではカードの痕跡がありません。提供された名前空間をカードが要求しなければ何もレンダリングされません。これにより、他のページが所有する名前空間（`ui-theme`、`permission`、`llm-*`）がこのタブに表示されません。

カードはslotに登録された順に表示され、キー付きエントリ自身は`order`を宣言しません。

## パッケージ化

ブラウザー側は[client module system](../../packages/client/modules)がページに提供します。これは有効なLoaderエントリから`dsh.client`を宣言するパッケージを探し、それぞれのビルド済み`./client`エクスポートを提供します。そのため`cordis.yml`でプラグインをマウントするとすぐにページに表示され、Webアプリケーションの再ビルドは不要です。

```jsonc
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

bundleはloaderのlazy-CJSファクトリー成果物でなければなりません。このリポジトリでは、`tsdown.config.ts`が共有プリセットに3行を加えます。

```ts ignore-check
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'])
```

そのプリセットは現在公開されていないため、このリポジトリ外のパッケージは同じ出力形式を自分で再現する必要があります。bundle-purityゲートはプラグイン間の値インポートも拒否するため、カードはこのセクションのカード外枠やstaged-formモデルをインポートできません。自身でレンダリングし、stagingとリビジョン保護も自身で所有します。両方の制限は[このセクションの既知の制限](../../packages/client/ui-settings-plugins/README.md#known-limitations-and-deferred-work)に記録されています。
