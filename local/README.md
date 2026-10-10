# local/ — your data, never committed

Everything in this directory except this README is **git-ignored**, so anyone can use the standard and keep
their own sites, findings and notes here without them ever reaching the repository (or a fork, or a PR).
`bin/check-public.mjs` fails CI if a file from here is ever committed.

| File | What it is | Used by |
|---|---|---|
| `sites.json` | Your website fleet: hostnames, host type, expected analytics IDs, private paths that must 404 (`forbid`). Start from [`../fleet/sites.example.json`](../fleet/sites.example.json). | `node site/check-site.mjs --config local/sites.json` · `fleet/report.mjs` · the `sites-weekly` workflow (via the `SITES_JSON` secret) |
| `findings/` | Repo-specific findings — named apps, versions, local files, unfixed weaknesses. | you; `/engineering-standard:intake` and research write app-specific notes here, not into `proposals/` |
| anything else | Your notes, drafts, exports. | — |

**Weekly site check without publishing anything:** the `sites-weekly` workflow reads the fleet from the
repository secret `SITES_JSON` (paste the contents of `local/sites.json`), and runs only in a **private** repo
or fork — on a public repo its issues and logs would publish your sites' weaknesses, so it skips.
Run it locally any time: `node site/check-site.mjs --config local/sites.json`.

**Backups:** because git doesn't keep this directory, back it up yourself (or keep it in a private repo of its
own, e.g. `git init local`).
