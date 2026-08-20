# Web UIを使う

[English](index.md) | [中文](index.zh.md) | 日本語

Web UIは[ルートREADME](../../../README.md#run)から起動します。コマンドがURLを表示します。このガイドはサーバーの起動後から始まります。`dsh`プロセスは起動元のディレクトリを既定のファイルシステムの場所として使いますが、新しいWeb UIではワークスペースを追加するまで選択されていません。

## モデルを設定する

**Settings → Models**を開き、[DeepSeek APIキー](https://platform.deepseek.com/)を入力して保存します。サーバーを再起動しなくても、モデルのルートをすぐに使えるようになります。

[モデル設定ガイド](./providers.md)では、その他のプロバイダーとカスタムOpenAI互換エンドポイントを説明しています。

## ワークスペースを選ぶ

**Choose workspace**をクリックし、`dsh`を起動したプロジェクトディレクトリを追加して選択します。ワークスペースを選択するまで、セッションコンポーザーは使用できません。

## タスクを実行する

セッションを開始して、次の内容を送信します。

> Summarize this repository and identify its main packages.

agentはワークスペースのファイルを読み書きし、コマンドを実行し、作業を委任し、計画を管理できます。Web UIは、現在の権限ポリシーで承認が必要な操作の前に確認します。

## 次に進む

- [モデルを設定する](./providers.md)
- [Python SDKを使う](./python-sdk.md)
- [その他のCLIモードを使う](../../../apps/cli/README.md)
- [プラグインを開発する](../develop/basic/)
