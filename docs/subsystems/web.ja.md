# Webアクセス

[English](web.md) | [中文](web.zh.md) | 日本語

web access seamは[capability seam](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)で、1つの`ctx.web` service上の**2つのoperation**（searchとfetch）にまたがり、パッケージ間で分割されています。Service Definition（[dsh-web](../../packages/web/web)、`ctx.web`とprovider registry）、Service Provider（[dsh-web-search-exa](../../packages/web/web-search-exa)、[dsh-web-search-perplexity](../../packages/web/web-search-perplexity)、[dsh-web-search-deepseek](../../packages/web/web-search-deepseek)、[dsh-web-fetch-http](../../packages/web/web-fetch-http)）、Consumer（[dsh-tool-web](../../packages/web/tool-web)、`web_search`／`web_fetch` tool schema）です。Webは**1つの任意capability**でagent-loop spineの一部ではないため、語彙は[core.md](core.md)ではなくここにあります。search providerを差し替えてもmodelのquery要求方法は変わらず、fetch providerを差し替えてもmodelのURL要求方法は変わりません。

Source: [`packages/web/web/src/types.ts`](../../packages/web/web/src/types.ts)

## なぜ1つのcapabilityに2つのoperationがあるか

searchとfetchはrequest schemaもbusiness logicも共有しませんが、意図的に1つの`ctx.web` middle layerにまとめています。provider selection policyのowner、abort／error vocabulary、製品向けの「このharnessがどのようにwebへ到達するか」という設定APIを共有するためです。コストはservice上に`searchX`／`fetchX`の並行したmethod pairが生じることですが、これは意図した並列性であり、抽出漏れではありません。providerはtoolではなく**capability**（`WebSearchProvider`または`WebFetchProvider`）を登録し、model向けname、schema、prompt guidance、presentationは単一の`dsh-tool-web` consumerにあります。

## Search requestとresult

各seam requestは`query`を正確に1つ持ちます。`dsh-tool-web` consumerは必須の`queries` arrayを受け取り、別々のseam requestにfan outします。1 itemのarrayは1回のsearchを行います。`maxResults`はconsumerが所有する上限（`dsh-tool-web`の`searchMaxResults` config、default `8`）で、seamを通して渡され、戻り時に強制されます。providerが多く返した場合、seamは`sources[]`をtruncateして`truncated`を設定します。

```ts type-equiv
/**
 * What one search-capable backend is asked to search. Each request carries one
 * query; a consumer may issue several requests. `maxResults` is a
 * `dsh-tool-web`-layer bound passed through unchanged and enforced on the way
 * back by the seam (see {@link WebSearchResult}).
 */
interface WebSearchRequest {
  readonly query: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `dsh-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  readonly maxResults?: number
}
```

```ts type-equiv
/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa and DeepSeek return none; Perplexity returns a
 * generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  readonly truncated: boolean
}
```

```ts type-equiv
/**
 * One citeable source. A source always has a URL; `title`, `snippet`, and
 * `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `dsh-tool-web` renders `title ?? hostname(url)` for display.
 */
interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}
```

## Fetch requestとresult

```ts type-equiv
/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
interface WebFetchRequest {
  readonly url: string
}
```

HTTP statusは取得したresource stateの一部であり、自動的にfailureではありません。`404`／`500`のnetwork fetchが成功すれば、status codeと範囲を限定したdecoded bodyを持つ`WebFetchResult`を返します。`url`は許可されたredirect後のfinal URLです。`WebError`はresourceを安全に取得または表現できないfailureに限定されます。

```ts type-equiv
/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}
```

```ts type-equiv
/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `dsh-web`: the provider decodes the kind and `dsh-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }
```

## Provider availability

providerの`available(): boolean`は安価なLOCAL check（credentialの存在、解析可能なconfig）であり、**network callをしてはなりません**。これはexecution-time selectionへのinputであってhealth systemではありません。`search()`／`fetch()`が読み取って利用可能なproviderを選び、selection failureはcallerがroutingするstructured `WebError`として表面化します。`WebError`は分岐に使えるdetail（missing idまたはambiguous candidate set）をcodeとmessageに持ちます。

selectionはregistration、config、HMRの順序に依存しません。capabilityには明示的なprovider id（configの`searchProvider`／`fetchProvider`、または同じfieldに入る対応env var）があるか、利用可能なproviderがちょうど1つ登録されている場合にauto-selectします。設定idなしで複数のusable providerがある場合はfirst-winsではなく`WEB_PROVIDER_AMBIGUOUS`です。

## Error

`WebError`は`HarnessError`をextendsし（[core.md](core.md)のerror taxonomy）、`code: string`を持ちます。`LlmError`や`SubagentError`と同じくopenでclosed unionではありません。providerは`dsh-web`を編集せず独自codeを発生でき、consumerは未知のcodeを許容しなければなりません。codeはownerごとに分かれます。seam-neutral codeは共有`WebRuntime`の約束が発生させます。`WEB_PROVIDER_UNAVAILABLE`、`WEB_PROVIDER_CONFIGURED_MISSING`、`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`、`WEB_PROVIDER_AMBIGUOUS`、`WEB_DUPLICATE_PROVIDER`（registration-time programming errorで、`LlmRuntime`の`DUPLICATE_ADAPTER`に相当）、`WEB_ABORTED`、`WEB_PROVIDER_ERROR`（DNS、connection refused、TLSなどnetwork／transport failureを含むprovider failureのcatch-all）です。fetch transport codeは`dsh-web-fetch-http`実装が所有し、別のfetch backendは発生させる必要がありません。`WEB_INVALID_URL`、`WEB_BLOCKED_URL`、`WEB_REDIRECT_BLOCKED`、`WEB_FETCH_TOO_LARGE`、`WEB_FETCH_TIMEOUT`、`WEB_UNSUPPORTED_CONTENT_TYPE`です。

## Service

`WebRuntime`はsearchとfetch providerを登録し、重複idを`WEB_DUPLICATE_PROVIDER`で拒否し、execution timeにstructured selection error付きでproviderを解決します。local fetch backendはHTTP(S)だけを受け入れ、credentialを拒否し、redirect、byte、character、timeに上限を設け、同一originのredirect hopごとに再検証してbodyをdecodeします。presentationはtoolが所有します。local backendはprivate network targetをblockしないため、機密internal targetに到達できる環境では`web_fetch`を有効にしないでください。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxweb--webruntime"></a>

### `ctx.web` — `WebRuntime`

The web access service. Registered as `ctx.web` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
 * if its id is already registered for search. Returns a disposer; disposed
 * with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerSearchProvider(provider: WebSearchProvider): () => void

/**
 * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
 * if its id is already registered for fetch. Returns a disposer; disposed
 * with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerFetchProvider(provider: WebFetchProvider): () => void

/**
 * Run one search through the selected provider. Resolves the provider at call
 * time with the selection rules above; throws {@link WebError} when the
 * capability cannot run. The seam enforces `request.maxResults` on the result:
 * if the provider over-returns, `sources[]` is truncated and `truncated` set.
 * @param request - the query and optional result limit.
 * @param signal - optional cancellation signal forwarded to the provider.
 * @returns the provider's results, capped to `request.maxResults`.
 */
async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>

/**
 * Retrieve one URL through the selected provider. Resolves the provider at
 * call time with the selection rules above; throws {@link WebError} when the
 * capability cannot run. A non-2xx response is a result, not a throw.
 * @param request - the URL plus retrieval options.
 * @param signal - optional cancellation signal forwarded to the provider.
 * @returns the retrieval outcome; non-2xx responses resolve descriptively.
 */
async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
```

Source: [`packages/web/web/src/index.ts:74`](../../packages/web/web/src/index.ts)
<!-- END GENERATED cordis-surface -->
