# Bilingual documentation and public Japanese pages

English | [中文](README.zh.md)

This repo's documentation is read by people and agents both inside and outside the company, so every document in scope is maintained in English and Simplified Chinese, while pages published by the documentation site also carry Japanese. This page defines the pairing contract, checks, scope, and exclusions; [translation-rules.md](translation-rules.md) defines how to translate; [terminology.md](terminology.md) is the terminology source of truth. Routine agent work follows the lightweight path in [docs/AGENTS.md](../AGENTS.md); the extended [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow is available only through explicit user invocation.

## The pairing contract

- **All required languages carry equal authority.** A document may be authored and reviewed in either required language first — a Chinese-first Agent Note is as legitimate as an English-first one — and each counterpart is translated from it. No required file outranks another; what binds them is that they must say the same thing.
- **A non-public pair is three sibling files.** The English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`, all in the same directory. Public pages use the four-file form defined below by adding `foo.ja.md`. No locale directories, no separate translation repo, no interleaved bilingual files. Pairs merge whole: a PR never lands one required language without the others and the record.
- **The consistency record.** `foo.i18n.yaml` holds the full git blob hash of every required owner file as of the last time the language set was confirmed to say the same thing:

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  Blob hashes, not commit hashes, so the record is computable for files edited in the same PR (`git hash-object foo.md`) and consistency is a pure content comparison. `--write` stores those snapshots in the local Git object database before recording them, including uncommitted working-tree contents, and pins every distinct stored blob under a content-addressed `refs/dsh/translation-pairing/snapshots/` ref so garbage collection cannot invalidate a recorded recovery pointer. The recorded hashes therefore recover the exact last-confirmed text of either side, so an out-of-sync pair is updated by patching the counterpart minimally against the edited side's diff — never by re-translating whole files. Routine work makes that patch directly; when the user explicitly invokes the extended workflow, `pnpm run gen-translation-brief <pair>` can instead assemble the update at the narrowest safely aligned granularity and `--apply` can splice a code-fence-only change after structural validation ([briefed-updates Agent Note](../../.agents/notes/implemented/process/2026-07-26-briefed-minimal-translation-updates.md)). After bringing the pair back in line, `pnpm run verify-translation-pairing --write <pair>` re-records both hashes; that yaml diff is the reviewable act of confirming consistency, which is why `--write` requires naming the pairs you confirmed (`--write --all` is the explicit corpus-wide form).

  When two branches contain valid confirmations of the same pair, the installed `dsh-translation-pairing` Git merge driver composes a new record only if Git's default text merge succeeds for every recorded owner-blob triplet and the merged language set retains its required switchers and structural signature. Each translated file must retain links to the other required languages; an authored English source must carry its switcher, while a listed generated English source is exempt. Any structure the driver cannot verify remains an ordinary conflict; `pnpm run resolve-translation-pairing-conflicts` applies the same fail-closed operation to a merge that has already stopped, stages every safe pairing record, and exits unsuccessfully when other pairing conflicts remain. The [automatic pairing merges Agent Note](../../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) owns the mechanism and alternatives.
- **Language switcher.** The required line depends on the language set: non-public pairs use the bilingual lines, while public pages use the three exact lines documented below. A listed generated English source omits its English-side line so it remains byte-identical to generator output. A README published outside GitHub, such as PyPI project metadata, may use the canonical `https://github.com/deepseek-ai/deepseek-harness/blob/master/<repository-path>` URL to the same counterpart so the switcher still resolves there.
- **Structure mirrors the counterpart.** Heading depths and order, list kinds, ordered-list starts, list item counts, table row and column counts, link targets, and verbatim code blocks match one to one across the pair — see [translation-rules.md](translation-rules.md) for the full preservation rules. Existing Markdown gates apply to `.zh.md` files unchanged (`verify-md-wrap`, `verify-md-links`).

## Public Japanese pages

`website/docs.ts` exports `docsPages`, the publication manifest. The pairing gate normalizes every page source in that manifest to one unsuffixed `foo.md` anchor and derives the public set from those anchors; it does not read a hand-written rollout list.

A public pair has four sibling files: `foo.md`, `foo.zh.md`, `foo.ja.md`, and `foo.i18n.yaml`. Its consistency record has exactly three owner-blob hashes. A source outside the derived public set retains the bilingual three-file pair and exactly two hashes; the repository does not require a Japanese corpus outside the published pages.

`.ja.md` is always a translated side. Discovery excludes it from English-source candidates, and any CLI path naming `foo.md`, `foo.zh.md`, `foo.ja.md`, or `foo.i18n.yaml` resolves to the same `foo.md` anchor.

Public authored pages use these exact switcher lines:

```text
English | [中文](foo.zh.md) | [日本語](foo.ja.md)
[English](foo.md) | 中文 | [日本語](foo.ja.md)
[English](foo.md) | [中文](foo.zh.md) | 日本語
```

The first line belongs to English, the second to Chinese, and the third to Japanese. Generated English sources retain the existing exemption from the English-side switcher so their generated bytes remain authoritative; their Chinese and Japanese sides still carry the links back to all other languages.

## The gate: verify-translation-pairing

`pnpm run verify-translation-pairing` (part of `doc-sync`, which contributors run locally for documentation changes and CI runs exhaustively) enforces the contract mechanically:

1. Every document in scope has the complete language set for its publication status. README discovery is case-insensitive on the basename, so `missions/readme.md` is in scope alongside the other documentation roots.
2. Every pair artifact that exists at all is complete and consistent: public pairs have four files and three current owner-blob hashes, non-public pairs have three files and two hashes, editing any owner without re-confirming the pair goes red, every required language-switcher line is present, and the structural signatures match in order — heading depths, verbatim code blocks (info string and content), table row and column counts, list kinds, ordered-list starts, item counts, and every link target apart from the switcher.
3. Files listed as `excluded` have no translated side or `.i18n.yaml` at all. Frozen Agent Notes under `.agents/notes/archived/` are outside this evolving gate; their dedicated verifier requires and seals the complete existing triplet instead.

Source-oriented code gates consume an exact `.zh.md` or `.ja.md` fence sequence as a derivative of its unsuffixed sibling instead of compiling or manifesting the same code twice. The sequence must match in length, order, fence kind, and byte-exact body; otherwise both copies remain independently checked and the pairing gate reports the structural mismatch.

`pnpm run verify-translation-pairing --list` prints the current pairing state of every document in scope — missing, out-of-sync, or ok. It never fails; `missing` and `out-of-sync` rows identify violations that the normal check rejects.

`pnpm run verify-translation-pairing <pair...>` checks just the named pairs — any required file of a pair (or its bare stem) names it — so an update loop verifies its own pair in seconds instead of re-scanning the corpus. The no-argument corpus-wide form is what `doc-sync` and CI run; a scoped green never substitutes for it at PR level.

The practical rule this gate creates: **when a PR edits any owner file of a paired document, the same PR updates every other required language directly in one terminology-guided pass and re-records the pair with `--write <pair>`**, exactly like the repo's existing doc-sync rule for code and READMEs. A PR that leaves a pair out of sync goes red in CI.

The gate's limit, stated plainly: **a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound.** It checks hashes and Markdown structure; it cannot judge whether the two sides actually say the same thing, or whether the wording is accurate, well-termed, and natural — that is the reviewer's half of the contract, per [translation-rules.md](translation-rules.md). A re-recorded pair with a sloppy counterpart passes the gate; it must not pass review.

## Scope and exclusions

**Scope**: the root CONTRIBUTING and BRAND_GUIDELINES documents, every non-vendor README, and every active document under `.agents/notes/**`, `docs/**`, and `python/**`. The public language set is derived only from `website/docs.ts` `docsPages`; all other scope files use the bilingual language set. README matching is case-insensitive on the basename and covers future directories without another manifest edit. Dependency and ignored build-output trees and the frozen `.agents/notes/archived/` tree are discovery exclusions, not evolving translation source.

Generated English references and graphs participate in pairing when their reviewed Chinese and Japanese counterparts are available. Their generators remain the English source of truth, and freshness and pairing gates enforce their respective invariants independently; regeneration that changes English leaves the pair out of sync until the translated counterparts are updated and re-recorded. Generated English sources omit the language switcher that ordinary authored sources carry, because adding it would make the generator stale; their Chinese and Japanese counterparts still link back to every other language. A translated generated page may rewrite only self-referential generation and maintenance statements that would otherwise be false for the reviewed translation; all technical content remains subject to the ordinary faithfulness rules.

**Excluded** (never paired, and the gate rejects a `.zh.md`, `.ja.md`, or `.i18n.yaml` for them):

- `docs/AGENTS.md`, `.agents/notes/**/AGENTS.md`, and their `CLAUDE.md` instruction symlinks — agent instructions, maintained in English only like the root `AGENTS.md`.
- `docs/i18n/terminology.md` and [style-samples.md](style-samples.md) — shared reference files maintained outside the sibling-pair format.
- [translation-prompt.md](translation-prompt.md) — the automated pipeline's prompt template; its body is machine-consumed verbatim, so a paired translation would change pipeline behavior.
- `.agents/notes/archived/` — frozen historical triplets. [`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) validates their completeness and content seals; translation maintenance must never rewrite them.

**Universal requirement**: every current or future document in scope must merge with the language set determined by its path in `website/docs.ts` `docsPages`: public pages are complete trilingual pairs, and all other documents are complete bilingual pairs. [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) contains only explicit exclusions; there is no per-file rollout list, date cutoff, or README-specific policy class.

## Division of labor

Routine counterparts are updated directly by the working agent in one shot and one pass after it loads [terminology.md](terminology.md); it does not invoke a translation skill, generate a briefing, run a separate translation-review pass, or delegate to a subagent. The extended [dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow retains those heavier mechanisms for explicit user invocation. The gate checks pair completeness, recorded hashes, required language switchers (with the documented generated-source exception), and its documented structural signature. Review still owns translation quality, terminology, and structural requirements that the signature does not encode. The prompt contract is executable: [scripts/translation-prompt.ts](../../scripts/translation-prompt.ts) renders the committed template (terminology injected; the template carries its own calibrated rules) into either direction and parses the three-section response, while `verify-translation-prompt` exercises both render directions and the checked-in example in `doc-sync`.
