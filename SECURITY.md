# Reporting something

Report privately through
[GitHub's advisory form](https://github.com/productdevbook/nabiz/security/advisories/new)
rather than in an issue. If that form is closed, open an issue saying only
that you have something to report, and it will be opened.

What is worth reporting, in the order it matters here:

- **A monitor named on a page that should not name it.** A row with
  `grouped = 1` is a customer's site, and the page publishes neither the
  name nor how many there are. Any path that leaks either — the page, the
  API, the feed, the badge, an error — is the most serious thing this
  project has.
- **A way past `ADMIN_TOKEN`.** It is the only thing between the internet
  and writing notices on a page people trust.
- **A way to read or write the database** that is not one of the documented
  endpoints, including through the container or the manifests.
- Anything that stops the page answering — it is a status page, and being
  down is the one thing it cannot be.

## Versions

The latest release, and only that. There are no maintenance branches; a
fix ships as a new release and a new image tag.

## What is not a finding here

- The `x-status` header, the JSON, the feed and the badge are public on
  purpose. So is every monitor that is not grouped.
- The token throttle counts ten attempts a minute per address and forgets
  addresses when it reaches its ceiling. It is a brake, not a lock; the
  lock is a token nobody can guess.
- A self-hosted deployment that publishes its port beside a proxy while
  setting `TRUST_PROXY` is a misconfiguration the documentation warns
  about — but tell us if the warning is wrong or hard to find.
