# Spill Storage

[English](spill.md) | [中文](spill.zh.md) | 日本語

spill storage seamはtoolのoversized textをpersistし、model-facing locatorとretrieval guidanceを返す[capability seam](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)です。package間でService Definition（[dsh-spill](../../packages/spill/spill)、`ctx.spillStore`）、Service Provider（[dsh-spill-local](../../packages/spill/spill-local)、host filesystem上のprivate session-scoped file）、Consumer（[dsh-spill-policy](../../packages/spill/spill-policy)、`tools/post-execute` policy）に分かれます。Spillは**1つのoptional capability**でありagent-loop spineの一部ではないため、vocabularyは[core.md](core.md)ではなくここに置きます。preview mechanicsは[dsh-output-retention](../../packages/util/output-retention)にあり、このseamはpolicyから渡されたfinal textだけをsaveします。

Source: [`packages/spill/spill/src/types.ts`](../../packages/spill/spill/src/types.ts)

## The save request

`saveText`は唯一のservice operationです。`content`をverbatimでpersistし、opaque locator、backend-supplied retrieval hint、exact byte countを返します。requestはsave-time storage namespace（`owner`）、それを生成したtoolとcall（`source`。namingとinspection用でaccess controlには使わない）、backendがnaming hintとして使える`suggestedName`（pathではない）を持ちます。

```ts type-equiv
/** One request to persist text to a spill artifact. */
interface SaveTextSpill {
  owner: SpillOwner
  source: SpillSource
  /**
   * A caller-suggested base name (e.g. `web_fetch.txt`). The backend sanitizes
   * it to a single safe path segment before use — it is a hint, never a path.
   */
  suggestedName: string
  /** The full text to persist (UTF-8). */
  content: string
}
```

```ts type-equiv
/**
 * Save-time storage namespace for a spilled artifact. The session id lets a
 * backend group storage under the producing session, but the returned
 * {@link SpillLocator} is the model-facing handle. Forked sessions inherit
 * locators already present in the seeded log; those artifacts are not copied or
 * re-owned, and spills produced after the fork use the child session id.
 */
interface SpillOwner {
  sessionId: SessionId
}
```

`SpillOwner.sessionId`はsave-time storage namespaceです。forked sessionはseeded logからexisting spill locatorをinheritします。artifactはcopyもre-ownもされず、fork後に生成したspillはchild session idを使います。retention-period cleanupは他のold session artifactとともにold locatorをexpireさせることがありますが、spill seamはper-session cleanup policyを定義しません。

```ts type-equiv
/**
 * Tool and call that produced one spilled artifact — recorded by the backend for a readable
 * filename and inspection. Not interpreted for access control; purely
 * descriptive.
 */
interface SpillSource {
  /** The tool whose result was spilled (e.g. `web_fetch`). */
  toolName: string
  /** The model-issued call id the result belongs to. */
  callId: CallId
  /** A short human label for the artifact (e.g. `result`). */
  label: string
}
```

## The result

```ts type-equiv
/** A saved spill artifact: its locator, byte length, and backend-specific retrieval guidance. */
interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

`SpillLocator`はbackendが返す[branded](core.md#branded-ids) model-facing handleです。local backendはfilesystem pathとしてrenderし、remoteまたはdatabase backendはURI、key、command tokenとしてrenderできます。consumerはopaqueとして扱い、常に`read`が正しいretrieval mechanismだと仮定せず`retrievalHint`とともにrenderします。

```ts type-equiv
/**
 * Opaque model-facing handle for one spilled artifact. A local backend may use a
 * filesystem path; a remote or database backend may use a URI or key. Consumers
 * render it with {@link SpillRef.retrievalHint}, but do not parse it.
 */
type SpillLocator = Branded<'SpillLocator'>
```

## The service

`SpillStore`（`ctx.spillStore`、[`packages/spill/spill/src/index.ts`](../../packages/spill/spill/src/index.ts)で定義）は1 methodのabstract serviceです。`saveText(input) → Promise<SpillRef>`を持ちます。FULL `content`をpersistし、real storage failure（permission、ENOSPC、backend unavailable）ではREJECTします。seamが所有するのはstorageだけで、retention policy、tool-result replacement、retrieval／search APIは持ちません。

local backend（[dsh-spill-local](../../packages/spill/spill-local)）は`<root>/session-<hash>/<random>-<safeName>`へwriteします。設定済みまたはlazy-created private（0700）root、`sha256(sessionId)` session subdir、exclusive owner-only（`open(path, 'wx', 0o600)`）writeを使うため、仕掛けられたsymlinkでredirectできません。`locator`はlocal pathで、`retrievalHint`はmodelにそのpathを`read`または`grep`するよう伝えます。policy consumer（[dsh-spill-policy](../../packages/spill/spill-policy)）は`maxInlineBytes`を超えるplain-text final resultをretention libraryのhead／tail previewとspill referenceにbest-effortでreplaceします。save failure時はsuccessful callを`isError`にせず、original inline resultを保持します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspillstore--spillstore-abstract-seam"></a>

### `ctx.spillStore` — `SpillStore` (abstract seam)

Abstract spill storage service. Subclass, implement saveText, and load the subclass as a plugin — it registers as `ctx.spillStore` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- saveText persists the FULL `content` verbatim and returns an opaque locator, exact byte length, and model-facing retrieval guidance.
- Storage is scoped by the request's SaveTextSpill.owner session; the backend chooses a private (not world-readable) location and a collision-free name derived from — never equal to — the caller's `suggestedName`.
- `saveText` REJECTS on a real storage failure (permissions, ENOSPC, backend unavailable); the caller decides how to degrade (the spill policy treats a rejection as best-effort and keeps the inline result).

```ts cordis-catalog
/**
 * Persist `input.content` to a session-scoped spill artifact.
 * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
 * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
 */
abstract saveText(input: SaveTextSpill): Promise<SpillRef>
```

Source: [`packages/spill/spill/src/index.ts:45`](../../packages/spill/spill/src/index.ts)
<!-- END GENERATED cordis-surface -->
