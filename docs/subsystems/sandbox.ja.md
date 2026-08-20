# プロセスSandbox

[English](sandbox.md) | [中文](sandbox.zh.md) | 日本語

[dsh-sandbox](../../packages/sandbox/sandbox)のprocess-sandbox seamは、consumerをplatform runnerに結合せず、same-world subprocess argvをfile-effect policyでwrapします。[dsh-sandbox-local](../../packages/sandbox/sandbox-local)はLinux bwrap／Landlock、macOS Seatbelt、Windows ACL restricted-token backendを提供し、[dsh-bash-sandbox](../../packages/shell/bash-sandbox)と[dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox)が利用します。container、microVM、remote executionはcapability seam全体の兄弟実装であり、`ctx.sandbox`のproviderではありません。

Source: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## Modeと強制

`SandboxMode`はfilesystem effectだけを管理します。`read-only`はbackendにwriteの拒否を求めます。POSIX runnerはshellが必要とする`/dev/null` sinkを追加で許可し、Windows ACL runnerは明示的なwritable rootを許可せず、ambient ACL gapによるpartial enforcementを報告します。`workspace-write`はworkspace rootとbackendが保証するtemp areaへのwriteを許可し、`danger-full-access`はconfinementを迂回します。networkとprocess visibilityはこの語彙の範囲外です。

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

最初の2つのmodeだけをproviderに渡せます。`danger-full-access` consumerは元のargvをspawnし、`ctx.sandbox`を呼びません。

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

enforcementは報告される事実です。`full`はbackendがmodeで約束されたすべてのfile effectを管理することを意味します。`partial`はactive backendまたは古いkernel ABIが一部だけを管理することを意味し、絶対的な約束を必要とするconsumerは拒否するか、その違いを表示しなければなりません。古いLandlock ABIとWindows ACL runnerのEveryone／hard-link boundaryが現在のpartial caseです。

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect; callers requiring
 * an absolute boundary must not treat it as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## Callごとのpolicy

完全なexecution policyはcapability callごとに解決して運びます。`danger-full-access`も含むため、consumerはconfinementを迂回するか判断する前にpolicyを1回解決できます。通常のtool callはcalling sessionの不変cwdから`workspaceRoot`を導出し、deployment configはagentless時のfallbackです。rootはlexical normalization前にfilesystem semanticsで正規化されるため、`symlink/..`を含むcwdはspawnされたprocessが実際に実行されるdirectoryを指します。

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()`はactive sessionと、approved retryの場合は明示的なmodeを受け取ります。優先順位とroot fallbackはserviceが所有するため、bashとfsが繰り返し実装する必要はありません。

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

confinementされたexecutionだけが`ctx.sandbox`に到達し、provider policyは同じrootを保持したままmodeを狭めます。これにより、同じproviderに対してconcurrent session、consumer、one-shotの権限昇格retryが異なるboundaryを要求できます。provider stateを変更する必要はありません。

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

## Wrapped argvと分類dialect

`RunnerFailureRule`は、runnerがcommand実行前に失敗したことを示す証拠を組み合わせます。consumerはnonzero exit、任意のallowed-exit-code gate、残ったstderr line内のcase-insensitive fatal signatureを要求します。case-insensitiveな完全一致のinformational exclusionを先に除外するため、無害なrunner noticeだけでfailureとは判定できません。一致したlineはerror detailとして利用でき、分類がstderrを書き換えることはありません。

```ts type-equiv
/**
 * Evidence that identifies a sandbox runner failing before it executes the
 * wrapped command. A consumer first applies {@link allowedExitCodes} when
 * present, removes {@link informationalLines} by case-insensitive exact line
 * equality, then matches {@link fatalSignatures} case-insensitively within
 * each remaining stderr line. Exit status alone never proves runner failure.
 */
interface RunnerFailureRule {
  /** Nonzero process exit codes on which this rule may match; omitted permits any nonzero exit. */
  allowedExitCodes?: readonly number[]
  /** Non-empty substrings identifying a fatal runner diagnostic on one stderr line. */
  fatalSignatures: readonly string[]
  /** Benign stderr lines excluded by exact full-line equality before fatal matching. */
  informationalLines?: readonly string[]
}
```

consumerがspawnするのが`ConfinedArgv`です。置換argvに加えて、backendのenforcement factと、直交する2つのstderr classifierを運びます。`denialSignatures`はsandboxが正しく動作しているときにconfinementされたcommandがblockされたことを示します。`runnerFailureRules`はsandbox runnerがcommand実行前に拒否または失敗したことを示します。consumerはこれを先に検査し、通常のtask failureではなくsandbox infrastructure failureとして表示します。

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  /** How completely the selected backend enforces the policy's file effects. */
  enforcement: SandboxEnforcement
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces.
   */
  denialSignatures: readonly string[]
  /**
   * Structured runner-failure evidence rules. Consumers require a matching
   * fatal stderr line (after informational exclusions) and any rule-specific
   * exit-code gate before checking denial signatures: runner failure means the
   * command never ran, while denial means confinement worked and blocked it.
   */
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

operator設定を所有し、runner dialectをこれらのruleに対応付けるのは[local provider](../../packages/sandbox/sandbox-local/README.md)です。spawnとresult attributionは[sandboxed bash consumer](../../packages/shell/bash-sandbox/README.md)が所有します。

## Providerとfail-closed error

`ctx.sandbox.confine(argv, policy)`は`ConfinedArgv`を返します。利用可能なbackendがない場合はcode `SANDBOX_UNAVAILABLE`の`SandboxUnavailableError`をthrowします。consumerはreturned argvのspawn中または観測中のfailureも分類できます。そのattributionはconsumerの約束に属します。confined policyでconfinementなしに黙ってpassthroughすることは決して許されません。

provider selection、probe、cache、backend固有のenforcement reportは[local provider](../../packages/sandbox/sandbox-local/README.md)に属します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider` (abstract seam)

Abstract process-sandbox service. confine must return enforcing argv or fail closed at wrap or runner-execution time; silent unconfined passthrough is forbidden. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

Source: [`packages/sandbox/sandbox/src/index.ts:158`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment default mode, fallback workspace root, and current request-time policy section. Tool layers call resolve for each execution so a session's mode log and immutable cwd travel together to every enforcing capability.

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

Types: [Session](session.md)

Source: [`packages/sandbox/sandbox-policy/src/index.ts:91`](../../packages/sandbox/sandbox-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
