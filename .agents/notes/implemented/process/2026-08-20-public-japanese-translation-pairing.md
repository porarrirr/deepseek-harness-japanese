# Agent Note: Public documentation uses derived trilingual pairing

Status: implemented

English | [中文](2026-08-20-public-japanese-translation-pairing.zh.md)

## Problem

The repository has a broad bilingual documentation corpus, while the documentation website publishes a smaller set of pages that also requires Japanese. A corpus-wide Japanese requirement creates translation work for private contributor and package documents, but a hand-written public rollout list can drift from `website/docs.ts`.

## Decision

The pairing gate derives its public source set from the `source` values in `website/docs.ts` `docsPages`, normalizes locale suffixes to one unsuffixed English anchor, and deduplicates the site locale entries.

Public sources use `foo.md`, `foo.zh.md`, `foo.ja.md`, and `foo.i18n.yaml`. Their sidecars contain exactly the three owner-blob hashes. Every other in-scope source keeps the bilingual `foo.md`, `foo.zh.md`, and `foo.i18n.yaml` record with exactly two hashes.

`.ja.md` is a translated side rather than a source candidate. Pair-path normalization accepts all four public artifacts and resolves each to `foo.md`. Public source, Chinese, and Japanese switcher lines have explicit canonical forms; generated English sources retain their switcher exemption.

Generated-region checks, merge composition, conflict resolution, and Markdown fence derivative checks use the same public language set. A public generated page receives the generated region on its Japanese side when that side exists; the pairing gate remains responsible for reporting a missing side.

The [bilingual pairing note](2026-07-02-bilingual-docs-and-pairing-gate.md) remains the authority for equal language authority, blob recovery, structural signatures, and the bilingual default; this note owns the public language-set split.

## Alternatives considered

- **Require Japanese for every in-scope document.** Rejected: non-public package, contributor, and process documents retain a two-language maintenance contract, and the public requirement has a narrower audience.

- **Maintain a hand-written public rollout list.** Rejected: a list can diverge from the publication manifest, while `docsPages` already identifies every page that the site projects.

- **Create a separate Japanese directory or website locale manifest.** Rejected: locale directories would split repository-relative links and duplicate publication ownership; the existing sibling-file convention keeps source links and pairing records local.

## Consequences

Adding or removing a page in `docsPages` changes the language set enforced for its source without a second rollout edit. Public sidecars and merge records have one additional owner hash, while non-public records remain unchanged.

The repository can report missing Japanese pages before their translations land, and a public page cannot be confirmed with a two-hash record. Generated English output remains byte-authoritative, so generated pages still exempt only the English switcher line.
