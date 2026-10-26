# Changesets

One entry per user-visible change, added with `bun run changeset` (or
`bunx changeset`) and committed with the pull request. `patch` for a fix,
`minor` for a new capability, `major` for a breaking change. A change that
should not release anything (docs, tooling, tests) gets an empty entry:
`bun run changeset add --empty`.

Entries are written into `CHANGELOG.md` by `@changesets/changelog-git`, so each
one links the commit that carried it.

Merging pull requests into `main` opens or updates the "Version Packages" pull
request, and merging _that_ publishes. See "Releasing" in `CONTRIBUTING.md`.
