---
type: fixed
---

## Inspection reports show their photos

The PDF of an inspection report now shows the photos taken during the inspection, and your logo, whatever format they were saved in. Before, photos taken in the dashboard and logos saved as WebP were left out of the report. This also applies to the reports of inspections already saved: each report is built when it is opened, so it shows their photos too. A photo that can no longer be read keeps its place in the report, marked "Photo unavailable", so the report never hides that it existed. The rental contract's PDF shows a WebP logo too.

On a self-hosted install that serves its files itself (`S3_PUBLIC_URL=/files`), saving an inspection with photos and changing your profile photo no longer fail.

The reservation's history names the inspection steps (started, completed, damage found, signed) instead of showing their technical names.
