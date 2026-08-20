# Python SDKを始める

[English](python-sdk.md) | [中文](python-sdk.zh.md) | 日本語

このチュートリアルはWeb UIに代わるプログラムからの利用方法です。公開済みのPython SDKをインストールし、リポジトリに含まれるagent構成を実行して、同じAPIを自分のプログラムから呼び出す方法を示します。

## 前提条件

- Python 3.10 or newer
- Git
- Linux x64, Linux arm64, or macOS 14 or newer on arm64
- DeepSeek互換のAPIエンドポイントと認証情報
- agentが変更できる隔離されたワークスペース

## SDKをインストールする

実行可能な例を取得するためにリポジトリをクローンし、仮想環境を作成して、同じバージョンのランタイムが同梱されたSDKをインストールします。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

インストールしたランタイムにシステムのNode.jsは必要ありません。ソースからランタイムやwheelをビルドするリポジトリのコントリビューターは、[Pythonコントリビューター向けワークフロー](../../../python/development.md)を使ってください。

## リポジトリ内の例を実行する

認証情報を環境変数に設定します。デフォルトのDeepSeekエンドポイントではなくOpenAI互換プロキシがモデルを提供する場合は、`DEEPSEEK_BASE_URL`も設定します。

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

隔離されたワークスペースとセッションディレクトリに対して1つのタスクを実行します。

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

スクリプトは最終的なassistantの応答を表示します。セッションディレクトリには、組み立てられたモデルリクエストとツール呼び出しを含むJSONLログが保存されます。

## 自分のプログラムでSDKを使う

リポジトリ内の例は、次のSDK呼び出しを薄くラップしたものです。

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness`は同梱ランタイムを遅延起動し、コンテキストマネージャーが終了するまで再利用します。同じharnessとセッションIDを再利用すると、作業ディレクトリ、エクスポート済み変数、シェル関数を含む、セッションが所有するBashプロセスが保持されます。独立したタスクには新しいセッションIDを使い、同じ永続的な会話を続ける場合だけIDを再利用してください。

## 例の構成を理解する

| プロパティ | 値 |
|---|---|
| システムプロンプト | `DSH_SYSTEM_PROMPT`。未設定時は`You are a helpful software engineer assistant.` |
| `minimal.py`のモデル | `--model`、次に`DSH_MODEL`、最後に`deepseek-v4-flash` |
| モデル向けツール | 永続的な`bash`と`str_replace_editor`のみ |
| Bashタイムアウト | 300秒 |
| エディター出力上限 | 16,000文字 |
| コンテキスト圧縮 | 無効 |
| ファイルシステム | 裸のローカルバックエンド。絶対パスのエディター操作で、ランタイムプロセスから見える任意のパスを指定可能 |
| セッション永続化 | `DSH_SESSION_ROOT`下の非圧縮JSONL |

この構成には、harnessの識別情報、ワークスペースのプロンプト本文、skill、ワンショットBash、タスクツール、圧縮、その他すべてのモデル向けプラグインは含まれません。サンドボックスポリシーの情報はシステムプロンプトに追加せず、ランタイムのユーザーコンテキストとしてログに記録されます。

## ワークスペースとセッションIDを選ぶ

`cwd`はagentが利用できるワークスペースを選び、`session_root`はセッションログと状態を保存します。独立したタスクには新しいセッションIDを使い、同じ会話と永続的なシェル状態を次の呼び出しでも使う場合だけIDを再利用してください。

この構成は`danger-full-access`を使います。Bashとエディターがランタイムプロセスに許可された任意のパスを変更できるため、使い捨てのチェックアウトまたはコンテナ内だけで実行してください。永続的なPTYバックエンドにはPOSIX端末基盤が必要なため、この構成はWindowsのagentをサポートしません。

正確な構成は[`jsonrpc-agent`の例のリファレンス](../../../examples/jsonrpc-agent/README.md)が管理しています。[Python SDKリファレンス](../../../python/sdk/README.md)ではライフサイクル、結果、通知、ランタイム選択、設定を扱い、[Cordis入門](../../cordis-primer.md)では構成の構文を扱います。
