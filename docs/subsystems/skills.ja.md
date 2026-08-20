# Skills

[English](skills.md) | [中文](skills.zh.md) | 日本語

[skill capability family](../../packages/skill)には、Service Definition（[dsh-skill](../../packages/skill/skill)、`ctx.skills`）、local Service Provider（[dsh-skill-filesystem](../../packages/skill/skill-filesystem)）、任意のpackaged badge provider（[dsh-skill-badge](../../packages/skill/skill-badge)）、Consumer（[dsh-tool-skill](../../packages/skill/tool-skill)）が含まれます。registryはhost layerとscopeごとのlayerをまたいでprovider catalogをmergeし、providerはlocalまたはpackaged skillを提供します。Consumerはinitial／replacement catalogとmodel向け`skill` toolを所有します。skillは任意のinstructionでありsession eventではないため、語彙は[core.md](core.md)ではなくここにあります。

Source: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts), [`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts), [`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts), and [`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts).

## Provider registry

`ctx.skills`はlocal、embedded、remoteなどのproviderを組み合わせます。registrationは同期的で、remote initializationとdiscoveryはawaitする`list()`に属します。provider object、option、candidateはreadonlyで借用し、semantic fieldは検証します。

registryは[tools registry](tools.md)が[dsh-scope](../../packages/core/scope)上に確立したhost＋per-scope layer構造です。registrationはcalling contextのscopeのlayerに入るため、host rowとrepository pluginはglobal layerに入り、agent presetのstanding compositionがmountしたpluginはそのpresetのlayerに入ります。provider nameはprocess全体ではなくlayerごとに一意です。readはglobal layerとviewing scopeのchainをmergeします。duplicate skill nameはnearest layerのentryが無条件で優先し、以下のrank orderは同一layer内のduplicateだけを決めます。discovery cacheは解決済みscope chainをkeyにするため、scopeのre-parent（blank-session recompose）はregistry mutationなしに次のreadへ反映されます。

1つのlayer内では、duplicate nameをrank、provider order、local orderの順で解決し、summaryはname順にsortします。拒否された`list()`はlogに記録してincomplete observationから除外し、明示的なincomplete observationは利用可能なcandidateを提供しますが結果をcache可能にはしません。malformed candidateは即座に失敗します。各provider factoryはregistration-scoped controlを受け取ります。その`invalidate()`は正確なregistrationがactiveの間だけcompleted catalogをclearし、signalはregistration failureまたはdisposeでabortします。in-flight discovery中にprovider generationが変わると1回retryし、2回目の変更では最新candidateをincompleteかつuncachedで返します。providerとruntimeのmutationはunfiltered `skills/change` invalidation eventを発行します。diffは持たないため、consumerは自身のlookup optionで`snapshot()`を再取得します。

`SkillProvider.list()`が返すarrayはcomplete-discovery shorthandです。`SkillProviderObservation`によりproviderは直接load可能なcandidateを公開しつつ、そのobservationが権威的でないことを報告できます。

```ts type-equiv
/** Provider candidates plus whether the current discovery is authoritative. */
interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}
```

```ts type-equiv
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

```ts type-equiv
/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}
```

## Local discovery priority

提供されるlocal providerはrootをrank順にscanします。

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` when configured |

project rootは`.git`を含む最近傍ancestorで、なければcurrent cwdを使います。`ctx.fs`が利用可能な場合、git-root walkはfilesystem serviceを通じて`.git`をprobeするため、remoteまたはsandbox workspaceがhost filesystem boundaryへfallbackしません。user DSH rootでは`.system` childをskipします。local providerはbuilt-in system skillを合成せず、deploymentがconfigured bundled rootまたは専用providerを通じてpackaged skillを提供します。

`dsh-skill-badge`は`BUNDLED_SKILL_RANK`で不変の`bundled` candidateを1つ登録し、packaged asset directoryを`resourceBase`で公開します。提供されるCLIではpluginがdisabledと宣言されるため、composition rowを有効化することは明示的なopt-inです。

Chokidarは既存rootを監視し、bundle／flat-entryの直接の追加・削除とskill entryの直接変更を検出します。rootがない場合は最近傍の既存ancestorから、欠落しているpath segmentを1つずつたどり、Chokidarがattachできるまで追跡します。bundle配下のresource fileはcatalog changeではありません。model向け`write`と`edit`のobservationは、targetがcatalog relevantな場合にproviderを同期的にinvalidateします。一方、host watcherはIDE、Git、shell、external processによるmutationを監視します。watcher failureが起きてもread可能なcandidateをdirect loadから隠さず、current observationをincompleteにします。project-scoped watcherは設定済みのbounded LRUを使います。

## Skillの識別情報

skill nameはkebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）です。local providerはdirectory bundle（`<name>/SKILL.md`）とflat Markdown file（`<name>.md`）を受け入れます。nested recursive `**/SKILL.md` discoveryはサポートしません。

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## Summary、candidate、完全なdefinition

`SkillSummary`はregistryのinvocation-neutral summaryです。consumerがrenderするentryとfieldを選び、model session catalogはmodel-invocableな`name`と`description`だけを使います。bodyやabsolute file pathは使いません。`SkillInvocationPolicy`は独立した2つのinvocation controlをpositive booleanに正規化し、すべての解決済みsummary、candidate、definitionがこれを持ちます。任意のfrontmatterをdomain modelへ変換することはありません。

```ts type-equiv
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

```ts type-equiv
/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
interface SkillSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}
```

`ctx.skills.list()`は4つのpolicy combinationをすべて保持します。`isModelInvocable(skill)`と`isUserInvocable(skill)`は対応する必須fieldを読みます。model-only skillは`{ modelInvocable: true, userInvocable: false }`、user-only skillは`{ modelInvocable: false, userInvocable: true }`を設定し、両方を`false`にするとtrustedな`ctx.skills.get()` callerだけが利用できます。local providerは正確なkebab-case frontmatter key `disable-model-invocation`と`user-invocable`を読み、未指定は`true`にdefaultし、解析したすべてのskillをこのnormalized policyへprojectionします。

`SkillCatalogSnapshot`はauthoritative absence、transient provider failure、discovery中に変化し続けたcatalogを区別します。`skills`はそのobservationで収集したsorted invocation-neutral summaryを含み、`complete`がtrueになるのは、すべてのregistered providerがconcurrent catalog revisionなしに完了した場合だけです。incomplete snapshotはcacheしないため、各consumerはlast-good filtered catalogを保持してretryできます。

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate`はproviderからregistryへ渡すrecordです。`locator`はopaqueなprovider stateで、registryは保存してwinning providerの`get()`へ返すだけです。

```ts type-equiv
/** Provider catalog entry used by the registry to merge and later load skills. */
interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Absolute file path when the provider has one. */
  readonly path?: string
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`SkillDefinition`は`ctx.skills.get()`が返し、`skill` toolが使うcomplete parsed resultです。`resourceBase`はlocal、URL、provider-managed skillについてrelative-resource guidanceをどうrenderするかをtoolに伝えます。

```ts type-equiv
/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }
```

```ts type-equiv
/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Absolute file path when the skill came from disk. */
  readonly path?: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

runtime skill inputはinvocation controlとprovider labelを省略できます。registryは両方のdefaultを1回resolveし、providerと同じcomplete definitionとfirst-wins collection orderを使います。返されたdisposerはcontributionを削除し、discovery cacheをinvalidateします。

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## Lookupと設定

skill lookupはproviderがworkspace-local skillを公開できるためcwd-sensitiveで、任意signalはcaller向けprovider workをcancelします。registry readは`SkillViewOptions`を通じてviewing scopeも受け取ります。consumerはcalling agent（自身のscope key）を渡し、registryはlayer selectionに`scope`を使い、providerは同じborrowed option objectから`SkillLookupOptions`の約束だけを読みます。cache hitを含めcatalog selectionの前後でcancelを検査し、discoveryとfull-definition loadingの両方をraceします。git rootが見つからない場合、local providerは渡されたcwd自体をproject rootとして扱います。

full definitionはregistryでcacheしません。各`get()`は選択されたcandidateとともにwinning providerを呼ぶため、local providerは現在のbodyを再読します。definitionのnameがcandidateと一致しなくなった場合は拒否し、正確なproviderをinvalidateしてrediscoveryします。

```ts type-equiv
/** Caller context used for cwd-sensitive and abortable provider work. */
interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}
```

```ts type-equiv
/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

registryが所有するのはdiscovery cacheの上限だけです。local providerはfilesystem root（`dshHome`、`agentsHome`、`customSkillDirs`、任意の`bundledSkillDir`／`DSH_BUNDLED_SKILL_DIR`）とwatcherの有効化、polling、stability、symlink、project capacity controlを所有します。consumerはcatalog descriptionの上限を所有します。正確なdefaultとvalidationは生成された[config catalog](../config-catalog.md)にあります。

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## Session catalogとtoolの約束

`dsh-tool-skill`は、空でないcomplete viewを観測したlive sessionの最初の`agent/pre-step`で、initial durable user-role `<system-reminder>`をinjectします。catalogに含まれるのはsort済みskill `name`とnormalized・XML-escaped `description`だけで、body、path、source、provider、routing hintは省略します。discoveryはstepのabort signalを`SkillLookupOptions`経由でforwardします。`catalogDescriptionMaxLength`はdescription上限のconsumer configで、defaultは`500`、integer minimumは`3`です。

後続の各model stepの前に、consumerはexact tool visibilityを適用し、complete snapshotの`<available_skills>` tag間にある正確なrender済みentryをdigestします。比較baselineは、pluginがsourceとなる最新のrecognizable visible catalog message内の同じentryから導出します。digestが変わると`agent.inject()`を通じて永続的な全置換をappendし、skillをすべて削除すると明示的な空置換をappendします。incomplete snapshotはlast-good model viewを保持します。compactionですべての過去catalog messageが隠れた場合、次のcomplete snapshotがcurrent catalogを再確立します。過去catalogがない空viewは何も発行しません。これらcatalog messageはsession historyでありWorld Stateではありません。

model向け`skill({ name })` toolはkebab-case nameを検証し、invocation-neutral catalogからsummaryを探します。`isModelInvocable`がaccessを許可しない限りload前に拒否し、許可時はcalling agentのcwdに対するcomplete definitionを再読し、contentを返す前にpolicyを再検査します。解決できないskillはunknownまたは利用不可として報告し、`<skill_content name="...">`、`<skill_resources>`、`<skill_instructions>`を含むtool resultを返します。`resourceBase`は明示的に参照されたscript、reference、assetだけを必要に応じて解決し、load resultでskill directoryを列挙することはありません。そのためbodyだけの編集は後続tool callを変えますが、catalog messageを生成したり過去tool resultを書き換えたりしません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxskills--skillregistry"></a>

### `ctx.skills` — `SkillRegistry`

Layered registry of skill providers, the host+per-scope shape the tools registry established. A registration files into the layer of its calling context's scope (scopeOf): host rows and repository plugins land in the global layer, while a plugin mounted by an agent preset's standing composition lands in that preset's layer. A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer. It exposes sorted invocation-neutral summaries and loads full skill bodies on demand.

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply, into the calling context's layer: a scoped context (an agent
 * preset's standing mount) registers for that scope alone, an unscoped
 * context registers globally. Duplicate names within one layer and reserved
 * names throw; remote initialization belongs in `list()`. Fiber disposal
 * unregisters the provider and invalidates catalog caches.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider;
 *   composite effects may yield it directly to preserve teardown ordering.
 */
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void

/**
 * Register a borrowed readonly runtime skill into the calling context's
 * layer. Project entries outrank runtime entries, which outrank user
 * entries, within one layer. Same-name runtime entries in one layer are
 * first-wins; a duplicate logs a warning and receives a no-op disposer so
 * it cannot remove the winner.
 * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
 * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
 */
register(skill: SkillRegistration): () => void

/**
 * List invocation-neutral skill summaries for a workspace. Consumers apply
 * model or user invocation policy at their operational boundary. Lookup
 * options and provider candidates are readonly same-process values borrowed
 * throughout discovery.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns all sorted winning summaries.
 */
async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>

/**
 * Observe the current invocation-neutral catalog and whether discovery completed within a stable revision.
 * Incomplete observations are never cached, allowing consumers to retain last-good state and
 * retry on their next request boundary.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns sorted summaries plus discovery-completeness state.
 */
async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>

/**
 * Load and validate the winning candidate, passing its opaque discovery locator back to the
 * provider. Cancellation is rechecked after selection, including cache hits, and raced against
 * loading so an uncooperative provider cannot hang the caller.
 * @param name - kebab-case skill name.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
 * @returns the full skill, including body content, or `undefined`.
 */
async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

Source: [`packages/skill/skill/src/index.ts:357`](../../packages/skill/skill/src/index.ts)

<a id="skills-events"></a>

### `skills/*` events

<a id="skillschange--emit"></a>

#### `skills/change` — emit

A skill provider, runtime contribution, or provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers refetch the catalog for their own lookup options. Listener failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * A skill provider, runtime contribution, or provider-backed catalog may
 * have changed. This is an unfiltered invalidation notification; consumers
 * refetch the catalog for their own lookup options. Listener failures are
 * contained and cannot veto the registry mutation.
 * @mode emit
 */
'skills/change'(): void
```

Source: [`packages/skill/skill/src/index.ts:297`](../../packages/skill/skill/src/index.ts)
<!-- END GENERATED cordis-surface -->
