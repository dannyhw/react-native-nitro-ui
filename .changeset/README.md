# Changesets

One entry per user-visible change, added with `bun run changeset` (or
`bunx changeset`) and committed with the pull request. `patch` for a fix,
`minor` for a new capability, `major` for a breaking change. A change that
should not release anything (docs, tooling, tests) gets an empty entry:
`bun run changeset add --empty`.

Entries are written into `CHANGELOG.md` by `@changesets/changelog-git`, so each
one starts with the short sha of the commit that carried it. GitHub autolinks
that sha in a release body; in a rendered `CHANGELOG.md` it stays plain text.

Merging pull requests into `main` opens or updates the "Version Packages" pull
request, and merging _that_ makes `Release` stage the new version on npm, where
a person approves it before it goes live. See "Releasing" in `CONTRIBUTING.md`.
