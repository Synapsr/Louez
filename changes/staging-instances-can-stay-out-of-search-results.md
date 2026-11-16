---
type: added
---

## A staging instance can stay out of search results

Self-hosting: set `LOUEZ_SEARCH_INDEXING=off` on a staging or test instance to keep it out of search engines. Every page then answers `noindex, nofollow`, in its robots meta tag and in an `X-Robots-Tag` header, robots.txt disallows the whole site and names no sitemap, and the sitemap is empty. Without the variable, or with `LOUEZ_SEARCH_INDEXING=on`, nothing changes and your stores stay indexable. It is read when the server runs, so the prebuilt image needs no rebuild. Never set it on an instance that serves real stores.
