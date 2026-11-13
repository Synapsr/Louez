---
type: improved
---

## The API refuses a request that does not say what it means

The REST API now answers an error instead of guessing in three cases. A request body sent in another format than JSON is refused with `415`. An operation that takes no body, such as duplicating a product, refuses one. And when the address names one record while the body names another, the request is refused with `400` and the code `PATH_PARAMETER_CONFLICT`; repeating the same id in both is still fine. A request built as the API reference documents it is not affected.
