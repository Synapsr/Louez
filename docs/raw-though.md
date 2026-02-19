this file is my raw though about how to improve agent to work on our code base.

this codebase was vicecoded fully by claude, while it work, there were lot of bad practices and way to more code for small usage. lot of deduplication, unshared logique and components. the goal of this documents is to improve this by settings our convention and expectations.

first, we work on a monorepo, we have apps and packages, in apps we have our next js application, with i18n etc...
the routing is pretty good this we don't need to change.
altough the server logique was bad, it used rest endpoint of next, or its not type, and as we work with agent we needs to have as much type as we could thats why we should use "orpc" as a api packages, the only reason to use api route, is for non json answers e.g. webhooks etc...

next thing i have in mind validation, each place where there are input we should most often validate them with "zod", all those validation are in a shared packages so we can reuse them. this package should handle i18n Errors.

next is about async logique. by default we should use tanstack query and wrap all async query and mutation. so we can have the advantage of tanstack query.

about forms, i already set my preference in the FORM_HANDLING.md file, but to resume we use tanstack form with their form composition api.

for the ui we have our ui package using coss.ui base on shadcn and base ui.

for i18n for every changement made all messages files should be updated. and we should have one useTranslation per file, so we can be flexible when we need to change messages.
