# Updating MakiSend

Your instance runs from **your own copy** of this repository: the one the *Deploy to Cloudflare* button created in your GitHub account, or a fork you made by hand. Updating means bringing an official release into that copy. Cloudflare Workers Builds then rebuilds the Worker, applies the database migrations (`scripts/workers-builds-deploy.sh`) and deploys.

## How you learn about a release

- Every release is a GitHub release on [`lixalistudio-oss/makisend`](https://github.com/lixalistudio-oss/makisend/releases), tagged `vX.Y.Z`. To be notified on GitHub as well: **Watch → Custom → Releases** on that repository.
- The dashboard checks once a day (and when you open it, if the last check is older than a day) and shows a banner: *MakiSend X.Y.Z is available*. **Settings → MakiSend version** shows the installed and latest versions, and **Check now** checks again (at most once every five minutes).
- The check calls `GET https://api.github.com/repos/lixalistudio-oss/makisend/releases/latest`, unauthenticated, from your Worker. Nothing about your instance is sent. Set `UPDATE_CHECK=off` on the Worker to never contact GitHub.

| Worker variable | Effect |
|---|---|
| `UPDATE_CHECK` | `off` turns the check off. Anything else, or unset: on |
| `MAKISEND_REPOSITORY` | Your copy, as `owner/name`. The banner's **Update** button then opens its *Sync with upstream* workflow. The Deploy button pre-fills the official repository, which counts as unset (the banner links to the release and this guide) |
| `UPDATE_SOURCE_REPOSITORY` | Read releases from another repository (`owner/name`), e.g. your company's fork. Default: `lixalistudio-oss/makisend` |

## Update in one click: the *Sync with upstream* workflow

`.github/workflows/sync-upstream.yml` ships in every copy.

1. In your repository, open **Actions → Sync with upstream → Run workflow** (or the dashboard's **Update** button, once `MAKISEND_REPOSITORY` is set).
2. Leave *version* empty for the latest release, or enter a tag such as `v0.2.0`.
3. The workflow merges the release into your default branch and pushes. Cloudflare Workers Builds picks the push up, rebuilds, migrates and deploys. Reload the dashboard once the build is green.

What it takes care of:

- **Your `wrangler.jsonc` is kept.** Cloudflare wrote your database id and resource names into it. When the release changed `wrangler.jsonc` (a new binding, a new cron), the run summary shows the diff to copy into yours, and the run raises a warning.
- **Copies without shared history** (the button may create the copy as a fresh repository) are merged with `--allow-unrelated-histories`; on conflict, the release's version of the file wins (`-X theirs`). Files you changed yourself may be overwritten: keep custom code out of the MakiSend files, or merge by hand.
- **Workflow files.** The default `GITHUB_TOKEN` cannot push a change to `.github/workflows/*`. When a release changes one, the push is refused and the summary says so: create a fine-grained token on your repository with *Contents* and *Workflows* set to read and write, save it as the repository secret `SYNC_TOKEN`, and run the workflow again.

## Update by hand

```bash
git remote add upstream https://github.com/lixalistudio-oss/makisend.git
git fetch upstream --tags
cp wrangler.jsonc /tmp/wrangler.jsonc          # your database id lives here
git merge v0.2.0                               # add --allow-unrelated-histories the first time if needed
cp /tmp/wrangler.jsonc wrangler.jsonc          # then copy in any new binding from the release
git push
```

The push triggers Workers Builds as above.

## Rolling back

Workers keep previous deployments: **Workers & Pages → your Worker → Deployments → Rollback**. A rollback does not undo database migrations; MakiSend migrations only add tables and columns, so an older build keeps working on a newer schema.

## Cutting a release (maintainers)

1. Bump `version` in the root `package.json` **and** `APP_VERSION` in `backend/src/core/version.ts` (a test fails when they differ).
2. Merge to `main`. `.github/workflows/release.yml` creates the tag `vX.Y.Z` and the GitHub release with generated notes. A version with a suffix (`0.3.0-rc.1`) is published as a prerelease, which instances are never told about.
