# 6. 構成とHMR

[English](06-composition-and-hmr.md) | [中文](06-composition-and-hmr.zh.md) | 日本語

ここまでに構築したすべての能力はプラグインであり、`cordis.yml`がアプリケーションのプラグインツリーを選択します。この章では構成を変更し、プラグインをホットリロードし、読み込まれないプラグインを診断します。

## エントリは名前だけではない

設定エントリは`name`と`config`以外のメタデータも受け付けます。

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

`id`はエントリに安定した識別情報を与えるため、loaderは既存エントリの編集と削除後の追加を区別できます。`disabled: true`はエントリを削除せずにプラグインをアンマウントします。元に戻すと、プラグイン（およびそのサービスを待つすべてのPENDING）が再び読み込まれます。

グループは1単位として読み込みとアンロードを行うエントリのサブリストを入れ子にし、`isolate`はグループにサービス名の独自インスタンスを与えます。そのため、2つのグループが互いに影響せず、異なる設定の`shell`プロバイダーをそれぞれ参照できます。詳細は[Cordis入門](../cordis-primer.md)と[サービス分離の例](../user/develop/framework/service.md#service-isolation)で説明します。

## ホットモジュール置換

アンロードでエフェクトが解放され（[第2章](02-lifecycle-and-effects.md)）、読み込みが依存関係に従うため（[第3章](03-services.md)）、HMRは実行中のプラグインをアンロードして再読み込みすることで置換できます。`@deepseek-ai/cordis-plugin-hmr`プラグインがファイルを監視し、保存時にこれを行います。

`tmp/cordis-tutorial`で`cordis.yml`を作成します。

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
- id: hello
  name: './hello.ts'
```

2つの補助プラグインがリストに加わりました。HMRはCordis loggerサービスを通じてログを出すため、コンソールエクスポーターがないとメッセージは見えません。また、デバウンスのために`timer`サービスを`inject`します。`@deepseek-ai/cordis-plugin-timer`がないと、何も表示せず永遠にPENDINGのままです。次のセクションでは、この無言の状態を扱います。

HMRはLoaderのネイティブヘルパーを通じてNodeのloader内部を読み取ります。tsxの下でCordisを実行します。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

次に`hello.ts`を編集してログメッセージを変更し、保存します。

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

古いインスタンスがアンロードされ（すべてのエフェクトが巻き戻され）、新しいコードが読み込まれ、`apply`が再実行されました。Ctrl-Cでプロセスを停止します。`cordis.yml`自体の編集も反映されます。loaderは`id`でエントリを比較し、変更されたものだけをマウント、アンマウント、再設定します。上記のエントリに明示的な`id`があるのはこのためです。`id`のないエントリには読み込みごとに生成IDが割り当てられるため、設定ファイルを編集すると、自身の行が変わっていなくても削除後の追加として扱われ、再マウントされます。

## 読み込まれないプラグインを診断する

依存関係による読み込みには裏側があります。`inject`で誰も提供しないサービスを指定したプラグインは、何も表示せず永遠に待機します。エラーではありません。プロバイダーが後でマウントされる可能性があるため、PENDINGは正当な状態です。

状態は直接確認できます。すべてのコンテキストはプラグインレジストリを列挙できます。`diagnose.ts`を作成します。

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

満たせない依存関係を持つプラグイン`needs-timer.ts`も作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  console.log('needs-timer loaded')
}
```

```yaml
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

実行します（通常の`node --import tsx ../../vendor/cordis/bin.js`で、Ctrl-Cで停止します）。

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']`にはプロバイダーがありません。リストに`- name: '@deepseek-ai/cordis-plugin-timer'`を追加するとプラグインが読み込まれます。プラグインが何もせず何も報告しない場合は、fiberの状態を調べてください。PENDINGで絞り込まずに列挙すると、プラグインが設定ファイル自体をマウントするため、loader自身のプラグイン（Loader、Include）もACTIVEのfiberとして表示されます。

次は[Harnessの内部へ](07-into-the-harness.md)です。実際のharnessサービスに対して同じパターンを試します。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
