# Bash Executor

[English](shell.md) | [中文](shell.zh.md) | 日本語

bash execution seamはService Definition（[dsh-shell](../../packages/shell/shell)、`ctx.shell`）、Service Provider（[dsh-bash-local](../../packages/shell/bash-local)と[dsh-bash-sandbox](../../packages/shell/bash-sandbox)）、Consumer（[dsh-tool-bash](../../packages/shell/tool-bash)、`bash` schema）に分かれます。generic background-job id、ownership、controlは[jobs.md](jobs.md)にあり、このseamはtask-free process handleを返します。raw process-group mechanicsは[subprocess seam](subprocess.md)の背後にあります。

Source: [`packages/shell/shell/src/types.ts`](../../packages/shell/shell/src/types.ts)

## Managed shell environment namespace

`DSH_*` variableはHarness-owned child-process factです。model-facing bash toolは`ctx.shellEnv`から収集し、`ShellExecRequest.dshEnv`で渡します。subprocess serviceはcurrent snapshotをmergeする前にinheritした`DSH_*` nameを削除します。`DshEnvironmentKey`／`DshEnvironment` vocabularyは[subprocess seam](subprocess.md)が所有し、`dsh-shell`がre-exportします。

## Request vs. spec: the `resolve()` split

このseamは**model／plugin-facing request**（optionalな`workdir`／`timeoutMs`／`stdoutMaxBytes`。configまたはrequest policyで補完）と、executorが実行する**fully-resolved spec**（これらのfieldがrequired）を分離します。tool layerはその間で`ctx.shell.resolve(request)`を呼びます（repoの「package boundaryではimplicitよりexplicit」rule）。`ShellExecSpec`がresolved valueを保持します。

```ts type-equiv
/**
 * A caller's execution REQUEST: `workdir` and `timeoutMs` are optional and
 * filled by {@link ShellExecutor.resolve} from the implementation's config.
 * This is the model-/plugin-facing shape; pass it to `resolve()` to obtain a
 * fully-resolved {@link ShellExecSpec}.
 */
interface ShellExecRequest {
  command: string
  /** Working directory override (default: implementation-configured). */
  workdir?: string | undefined
  /** Timeout override in milliseconds (implementations cap it). */
  timeoutMs?: number | undefined
  /**
   * Foreground stdout capture budget in bytes. Absent uses the executor's
   * default output cap. Trusted in-process consumers use this when they must
   * parse complete stdout up to their own bounded limit; the model-facing bash
   * tool does not expose it as a parameter.
   */
  stdoutMaxBytes?: number | undefined
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /**
   * Bytes to write to the command's stdin, then close it. Absent leaves stdin
   * closed/empty (the default for model-driven tool calls). Set by in-process
   * plugins (e.g. the hooks bridges, which write a hook command's JSON payload
   * to its stdin); the model-facing bash tool does not expose it as a parameter
   * (a model that needs stdin uses shell syntax like a heredoc or a pipe).
   */
  stdin?: string | undefined
  /**
   * Ordinary environment entries for the command, merged after the credential
   * scrub. Managed facts belong in {@link dshEnv}, which merges after this
   * map, so an entry here can never displace one. Set by in-process plugins
   * (the hooks bridges set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, …); the
   * model-facing bash tool does not expose it as a parameter.
   */
  env?: Record<string, string> | undefined
  /**
   * Harness-owned `DSH_*` variables for this execution (typed to managed
   * keys). Executors discard ambient `DSH_*` entries before merging this
   * snapshot last, so an unavailable current fact cannot inherit a stale
   * value from the harness process and a caller {@link env} entry cannot
   * displace a managed one.
   */
  dshEnv?: DshEnvironment | undefined
  /** Fully resolved per-call sandbox policy; sandboxing executors default it. */
  sandboxPolicy?: SandboxExecutionPolicy | undefined
}
```

```ts type-equiv
/**
 * A resolved execution spec. {@link ShellExecutor.resolve} fills and caps the
 * required fields; {@link ShellExecutor.start} ignores `timeoutMs` because
 * background processes have no executor timeout.
 */
interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  /**
   * Resolved foreground stdout capture budget in bytes. `run()` uses it for
   * stdout; background jobs and stderr keep the executor's own output cap.
   */
  stdoutMaxBytes: number
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /** Bytes to write to stdin before closing it; absent means no stdin. */
  stdin?: string | undefined
  /**
   * Ordinary environment entries carried through from
   * {@link ShellExecRequest.env}; {@link dshEnv} still merges after them.
   * OPTIONAL on the spec for the same reason as `stdin`: absent means no
   * ordinary extra environment.
   */
  env?: Record<string, string> | undefined
  /** Managed `DSH_*` snapshot (typed to managed keys); merges after {@link env}. */
  dshEnv?: DshEnvironment | undefined
  /** Resolved sandbox policy; ignored by executors that do not confine. */
  sandboxPolicy: SandboxExecutionPolicy | undefined
}
```

`stdin`と`env`はtrusted in-process plugin inputであり、`dsh-tool-bash`は公開しません。local executorはexplicitなcaller-supplied envをmergeする前にambient credentialをscrubします。[bash-stdin-env Agent Note](../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)を参照してください。

`stdoutMaxBytes`もtrusted-plugin-onlyです。foreground consumerはstderr、background job、model-facing bash toolの通常のoutput capを変更せず、bounded parser budgetまでのcomplete stdoutを要求できます。

## Foreground run：`ShellRunResult`

1回のcompleted（またはkilled）foreground runのoutcomeです。orthogonalなoutcomeは**独立して**報告されます。signalをtrapしたprocessはtimeoutしながらexit 0にもなり得ます。そのため`timedOut`、`aborted`、`signal`、`exitCode`はそれぞれ独立したfieldであり、callerはcut-short runをclean successとして扱いません。

```ts type-equiv
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
  /**
   * True when the executor's own timeout was the FIRST cause to cut the command
   * short. Mutually exclusive with {@link aborted}: one fused deadline drives
   * both the timeout and the caller's cancellation, so a timeout and an abort
   * racing before process close report the single first-abort cause, not both
   * (see the [timeout-library Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
   */
  timedOut: boolean
  /**
   * True when the caller's `AbortSignal` was the FIRST cause to kill the command
   * (and it was not the executor's own timeout). Mutually exclusive with
   * {@link timedOut} — see there for the first-cause classification.
   */
  aborted: boolean
  /** The effective timeout applied to this run (after defaulting/capping). */
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  /** Sandbox execution facts, absent for an unsandboxed executor. */
  sandbox?: ShellSandboxInfo
}
```

各streamは`CollectedOutput`です。possibly truncatedなtextとrecovery infoを持ち、truncated時の`text`は**tail**で、complete streamはprivate fileへspillします。fieldは[subprocess seam](subprocess.md)が所有し、`dsh-shell`がre-exportします。

## File sandbox：`ShellSandboxInfo`

Sandboxを利用するexecutorは、設定したmode fallbackを`ShellExecutor.sandboxMode`で公開します。tool layerは[`@deepseek-ai/dsh-sandbox-policy`](../../packages/sandbox/sandbox-policy/README.md)に、calling sessionごとのdurable `sandbox/mode` overrideとimmutable cwdを`ShellExecRequest.sandboxPolicy`へresolveさせます。user-approvedなstrictly wider callはmodeだけをreplaceします。mode／root／enforcement vocabularyは[`@deepseek-ai/dsh-sandbox` seam](sandbox.md)が所有し、modeはfile effectだけを制御します。

sandboxed runはmode、conservative denial classification、enforcement completenessを報告します。`runnerFailed`はcommand実行前のsandbox runner failureを示します。foreground executionは`SANDBOX_UNAVAILABLE`をthrowし、settled background processはfacts channelだけを持ちます。

```ts type-equiv
/**
 * Sandbox facts for one run, present iff a sandboxing executor handled it.
 * Facts are reported independently of process exit status so callers can
 * distinguish command failures from policy denials and runner failures.
 */
interface ShellSandboxInfo {
  /** The mode the command actually ran under. */
  mode: SandboxMode
  /** Whether the sandbox denied a file operation. */
  denied: boolean
  /** How completely the selected runner enforced the requested mode. */
  enforcement?: SandboxEnforcement
  /** Whether the sandbox runner failed before the command could run. */
  runnerFailed?: boolean
}
```

confined modeに利用可能なbackendがない場合、`ctx.sandbox` providerは[sandbox seam](sandbox.md)が所有する`SANDBOX_UNAVAILABLE` error codeをthrowし、executorがpropagateします。selected runnerがprofileを拒否した場合も同じfail-closed foreground errorになります。settled background jobは`runnerFailed`を記録します。modelはresult内のdenial／runner factを受け取り、denial markerがmodeを示す場合だけeffective modeを知り、`sandbox_permissions`と`justification`によるone-shot strictly wider retryを要求できます。実行前に`ctx.approval`がそのexact callをgrantしなければなりません。policyとswitchingの完全な設計は[sandbox Agent Note](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)にあります。

## Background process：`ShellProcess`

`start()`はidやownerを持たないhandleを返します。`dsh-tool-bash`はこれを`ctx.jobs.start()` hookへadaptし、generic runtimeがjob identityとlifecycleを所有します。`done`はprocess close時にresolveし、rejectしません。settlement後もreadは有効で、`done`のresolve前にsandbox factがstampされます。

```ts type-equiv
/**
 * A background process handle returned by {@link ShellExecutor.start}. It is the
 * only access path; buffered output remains readable after exit. Composition
 * teardown (the subprocess service's disposal) kills running processes and
 * awaits {@link done}; an executor-only reload leaves them running.
 */
interface ShellProcess {
  /** Process lifecycle state (settled exactly once). */
  status: ShellProcessStatus
  /** Exit code once finished (null = killed by signal / still running). */
  exitCode: number | null
  /** Terminating signal name, when signal-killed. */
  signal: NodeJS.Signals | null
  /** Resolves when the underlying process closes (never rejects — a spawn failure settles as `killed` with the error on stderr). */
  readonly done: Promise<void>
  /** Sandbox facts, stamped once a confined process settles. */
  sandbox?: ShellSandboxInfo
  /**
   * Read output produced since the previous read (consuming — consecutive
   * reads never re-deliver). Reads that lost data flag `lossy` and point at
   * full-stream spill files when available.
   */
  readOutput(): ShellProcessRead
  /**
   * Kill the process group. Returns false when it had already finished
   * (no-op); idempotent.
   */
  kill(): boolean
}
```

`readOutput()`はincremental deltaとspill recovery factを返します。

```ts type-equiv
/** One incremental {@link ShellProcess.readOutput} read. */
interface ShellProcessRead {
  /** Output produced since the previous read (stderr in a marked section). */
  delta: string
  /** True when truncation dropped unread bytes the delta cannot include. */
  lossy: boolean
  /** Full stdout spill file, when stdout truncation occurred and a safe path is available. */
  stdoutSpillPath?: string
  /** Full stderr spill file, when stderr truncation occurred and a safe path is available. */
  stderrSpillPath?: string
}
```

## Service

`ShellExecutor`は`resolve`、foreground `run`、background-process `start`、`sandboxMode` capability factを所有します。`dsh-bash-local`はcommand defaulting、timeout／abort classification、terminal environment、background read mergeを所有します。process group、bounded collector、spill file、credential scrubbing、disposal quiescenceは[subprocess service](subprocess.md)の責務です。`dsh-tool-bash`はmodel-facing renderingを所有し、background handleを[generic job runtime](jobs.md)へadaptします。`dsh-shell`はshell tool共有のexit-status contractを所有します。exportされた`parseExitStatus`／`ParsedExitStatus`は、`dsh-tool-bash`の`renderResult`と`dsh-tool-pwsh`の`renderPwshResult`が付ける`[exit code: N]`／`[killed by signal: X]` markerを逆変換し、両toolの`presentResult`はそれを使ってrendered textをterminal cardのoutput bodyとexit-status pillに分割します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxshell--shellexecutor-abstract-seam"></a>

### `ctx.shell` — `ShellExecutor` (abstract seam)

Abstract bash execution service. Subclass, implement the abstract methods, and load the subclass as a plugin — it registers as `ctx.shell` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- run rejects only for infrastructure failures. Nonzero exits, timeout kills, and abort kills resolve with a ShellRunResult.
- start returns immediately; no timeout applies to background processes. `done` settles at process close and never rejects; spawn failures settle as `killed` with the error on stderr.
- ShellProcess.readOutput is incremental: consecutive reads never repeat output. Lossy reads report truncation and available spill files.
- A still-running background process is stopped and awaited when its owning composition tears down. With the subprocess seam that boundary is `ctx.subprocess` disposal, so a background process survives an executor-only reload.

```ts cordis-catalog
/**
 * Apply implementation-owned defaults and caps to a request before execution.
 * @param request - the caller's request; omitted fields get this
 *   implementation's defaults, capped fields are clamped.
 * @returns the fully-specified spec to hand to {@link run}/{@link start}.
 */
abstract resolve(request: ShellExecRequest): ShellExecSpec

/**
 * Run a command in the foreground; resolves when it finishes.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; nonzero exits, timeout kills, and abort kills
 *   resolve with a descriptive result rather than reject.
 */
abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

/**
 * Start a background process and return its handle immediately.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the live process handle (reads, kill, quiescence promise).
 */
abstract start(spec: ShellExecSpec): ShellProcess
```

Source: [`packages/shell/shell/src/index.ts:65`](../../packages/shell/shell/src/index.ts)

<a id="ctxshellenv--shellenvregistry"></a>

### `ctx.shellEnv` — `ShellEnvRegistry`

Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables. The namespace is rebuilt for every model shell call: ambient `DSH_*` values are discarded by the executor, then the registry's current snapshot is injected. Built-in shell facts remain owned by the registry itself while plugins can register additional, enumerable facts with effect-scoped disposal.

```ts cordis-catalog
/**
 * Register one environment contributor. Names and keys are unique; built-in
 * keys are reserved. Registration is disposed with the calling plugin fiber.
 * @param contributor - declared key ownership and per-execution resolver.
 * @returns the disposer that unregisters the contribution.
 */
register(contributor: BashEnvContributor): () => void

/**
 * Build the trusted `DSH_*` snapshot for one shell tool execution.
 * @param execution - the current tool execution.
 * @returns an immutable environment overlay containing built-ins and current contributions.
 */
collect(execution: ToolExecution): DshEnvironment

/**
 * Enumerate plugin-contributed variables without executing their resolvers.
 * @returns declarations sorted by environment variable name.
 */
list(): BashEnvVariableInfo[]
```

Types: [DshEnvironment](subprocess.md) · [ToolExecution](tools.md)

Source: [`packages/shell/shell-env/src/index.ts:89`](../../packages/shell/shell-env/src/index.ts)
<!-- END GENERATED cordis-surface -->
