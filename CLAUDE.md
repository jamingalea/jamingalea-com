# CLAUDE.md

## Branches and deploys

- `staging` deploys to https://jamingalea-com.vercel.app, a private staging site behind the Vercel login (Vercel Authentication, "all except custom domains").
- `main` is the live site at https://www.jamingalea.com (jamingalea.com redirects there).

Rules:

- Commit and push changes to `staging` first, so they can be checked on the staging site.
- Only merge `staging` into `main` once the owner has approved the changes on staging.
- Never push to `main` directly.

The CMS at /admin publishes content edits straight to `main` itself (through the GitHub API). That is the owner's own publishing, separate from code changes, and is not affected by these rules. Because of it, `main` can get ahead of `staging`: before starting new work, merge `main` into `staging` so the staging site shows the latest content and the later merge back is clean.
