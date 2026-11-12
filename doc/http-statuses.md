# HTTP statuses

rupress implements the **five categories** of the HTTP status registry, each one with its base
class, its concrete classes, its static factories and its helper functions.

| Category      | Range   | Base class        | Helpers                                                           |
| ------------- | ------- | ----------------- | ----------------------------------------------------------------- |
| Informational | 100–199 | `HttpInfo`        | `info()`                                                          |
| Successful    | 200–299 | `HttpSuccess`     | `ok()`, `created()`, `accepted()`, `noContent()`, `success()`     |
| Redirection   | 300–399 | `HttpRedirect`    | `redirect()`, `redirect.permanent()`, `redirect.temporary()`      |
| Client errors | 400–499 | `HttpClientError` | `clientError()`, `badRequest()`, `notFound()`, `conflict()`…      |
| Server errors | 500–599 | `HttpServerError` | `serverError()`, `internalServerError()`, `serviceUnavailable()`… |

---

## Informational (100–199)

The `1xx` responses are **interim**: they are written to the socket _before_ the final
response. This is what HTTP/1.1 requires, since a `1xx` can never be the final response.

```js
import { EarlyHints, info, ok } from '@trixtylab/rupress';

'GET /early-hints': () => new EarlyHints({ link: '</app.css>; rel=preload' }).withFinal(ok({ ready: true })),

// Equivalent, with the [interim, final] pair:
'GET /early-hints-2': () => [info(103, { link: '</app.css>' }), ok({ ready: true })],
```

Without `.withFinal()` the final response is an empty `200 OK`.

> **Important:** `fetch` never returns a `1xx` (it treats them as interim responses and waits for
> the final one). To observe them you need the `node:http` client, which emits the `information`
> event:
>
> ```js
> import http from "node:http";
>
> http
>   .get("http://127.0.0.1:3000/early-hints", (res) => {})
>   .on("information", (info) => console.log(info.statusCode)); // 103
> ```

| Code | Name                | Class                |
| ---- | ------------------- | -------------------- |
| 100  | Continue            | `Continue`           |
| 101  | Switching Protocols | `SwitchingProtocols` |
| 102  | Processing          | `Processing`         |
| 103  | Early Hints         | `EarlyHints`         |

---

## Successful (200–299)

```js
import { ok, created, accepted, noContent, success } from '@trixtylab/rupress';

'GET /items': () => ok({ items: [] }),
'POST /items': ({ body }) => created(body, '/items/1'),   // + Location header
'POST /jobs': ({ body }) => accepted({ jobId: 'abc' }),
'DELETE /items/:id': () => noContent(),
'GET /items': () => success(203, { partial: true })      // any 2xx
```

| Code | Name                          | Class                         |
| ---- | ----------------------------- | ----------------------------- |
| 200  | OK                            | `Ok`                          |
| 201  | Created                       | `Created`                     |
| 202  | Accepted                      | `Accepted`                    |
| 203  | Non-Authoritative Information | `NonAuthoritativeInformation` |
| 204  | No Content                    | `NoContent`                   |
| 205  | Reset Content                 | `ResetContent`                |
| 206  | Partial Content               | `PartialContent`              |
| 207  | Multi-Status                  | `MultiStatus`                 |
| 208  | Already Reported              | `AlreadyReported`             |
| 226  | IM Used                       | `IMUsed`                      |

---

## Redirection (300–399)

```js
import { redirect, Found, MovedPermanently } from '@trixtylab/rupress';

'GET /old': () => redirect('/new', 302),
'GET /permanent': () => redirect.permanent('/new'),
'GET /temporary': () => redirect.temporary('/temporary'),
'GET /login': () => Found('/login')
```

| Code | Name               | Class               |
| ---- | ------------------ | ------------------- |
| 300  | Multiple Choices   | `MultipleChoices`   |
| 301  | Moved Permanently  | `MovedPermanently`  |
| 302  | Found              | `Found`             |
| 303  | See Other          | `SeeOther`          |
| 304  | Not Modified       | `NotModified`       |
| 305  | Use Proxy          | `UseProxy`          |
| 307  | Temporary Redirect | `TemporaryRedirect` |
| 308  | Permanent Redirect | `PermanentRedirect` |

`304 Not Modified` does **not** include a `Location` header.

---

## Client errors (400–499)

```js
import { HttpError, BadRequest, notFound } from '@trixtylab/rupress';

'GET /items/:id': ({ params }) => {
  if (!exists(params.id)) {
    throw notFound(`The item ${params.id} does not exist`);
  }
  return read(params.id);
}
```

| Code | Name                            | Class                         |
| ---- | ------------------------------- | ----------------------------- |
| 400  | Bad Request                     | `BadRequest`                  |
| 401  | Unauthorized                    | `Unauthorized`                |
| 402  | Payment Required                | `PaymentRequired`             |
| 403  | Forbidden                       | `Forbidden`                   |
| 404  | Not Found                       | `NotFound`                    |
| 405  | Method Not Allowed              | `MethodNotAllowed`            |
| 406  | Not Acceptable                  | `NotAcceptable`               |
| 407  | Proxy Authentication Required   | `ProxyAuthenticationRequired` |
| 408  | Request Timeout                 | `RequestTimeout`              |
| 409  | Conflict                        | `Conflict`                    |
| 410  | Gone                            | `Gone`                        |
| 411  | Length Required                 | `LengthRequired`              |
| 412  | Precondition Failed             | `PreconditionFailed`          |
| 413  | Payload Too Large               | `PayloadTooLarge`             |
| 414  | URI Too Long                    | `UriTooLong`                  |
| 415  | Unsupported Media Type          | `UnsupportedMediaType`        |
| 416  | Range Not Satisfiable           | `RangeNotSatisfiable`         |
| 417  | Expectation Failed              | `ExpectationFailed`           |
| 418  | I'm a Teapot                    | `Teapot`                      |
| 421  | Misdirected Request             | `MisdirectedRequest`          |
| 422  | Unprocessable Content           | `UnprocessableContent`        |
| 423  | Locked                          | `Locked`                      |
| 424  | Failed Dependency               | `FailedDependency`            |
| 425  | Too Early                       | `TooEarly`                    |
| 426  | Upgrade Required                | `UpgradeRequired`             |
| 428  | Precondition Required           | `PreconditionRequired`        |
| 429  | Too Many Requests               | `TooManyRequests`             |
| 431  | Request Header Fields Too Large | `RequestHeaderFieldsTooLarge` |
| 451  | Unavailable For Legal Reasons   | `UnavailableForLegalReasons`  |

---

## Server errors (500–599)

```js
import { HttpError, ServiceUnavailable, serverError } from '@trixtylab/rupress';

'GET /reports': () => {
  if (!database.ready()) {
    throw ServiceUnavailable('The database is not ready');
  }
  return buildReport();
}
```

| Code | Name                            | Class                           |
| ---- | ------------------------------- | ------------------------------- |
| 500  | Internal Server Error           | `InternalServerError`           |
| 501  | Not Implemented                 | `NotImplemented`                |
| 502  | Bad Gateway                     | `BadGateway`                    |
| 503  | Service Unavailable             | `ServiceUnavailable`            |
| 504  | Gateway Timeout                 | `GatewayTimeout`                |
| 505  | HTTP Version Not Supported      | `HttpVersionNotSupported`       |
| 506  | Variant Also Negotiates         | `VariantAlsoNegotiates`         |
| 507  | Insufficient Storage            | `InsufficientStorage`           |
| 508  | Loop Detected                   | `LoopDetected`                  |
| 510  | Not Extended                    | `NotExtended`                   |
| 511  | Network Authentication Required | `NetworkAuthenticationRequired` |

---

## The error envelope

Every error (thrown by the application or generated by the engine) shares the same structure:

```json
{
  "error": "Not Found",
  "status": 404,
  "message": "The item 42 does not exist",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/items/42",
  "details": { "id": "42" }
}
```

| Field       | Description                              |
| ----------- | ---------------------------------------- |
| `error`     | The title of the status (`'Not Found'`). |
| `status`    | The numeric code.                        |
| `message`   | The message of the error.                |
| `timestamp` | The ISO-8601 date of the response.       |
| `path`      | The path of the request.                 |
| `details`   | Optional: the extra data of the error.   |

The `405` answer includes the `Allow` header with the methods that would work, as the RFC
requires:

```
HTTP/1.1 405 Method Not Allowed
Allow: DELETE, GET, POST
```

---

## Static factories

Every concrete class can be built in three equivalent ways:

```js
import { HttpError, NotFound } from "@trixtylab/rupress";

HttpError.NotFound("not found"); // static factory
new HttpError.NotFound("not found"); // factory used as a constructor
new NotFound("not found"); // the class
```

The factories accept `(message, details, headers)`.

---

## Querying the registry

```js
import {
  HTTP_STATUS_CODES,
  HttpStatus,
  statusCategory,
  statusText,
} from "@trixtylab/rupress";

HTTP_STATUS_CODES[418];
// { name: 'Teapot', title: "I'm a Teapot", message: 'The server refuses to brew coffee...' }

HttpStatus.EARLY_HINTS; // 103
HttpStatus.UNPROCESSABLE_CONTENT; // 422

statusCategory(103); // 'informational'
statusCategory(404); // 'client-error'

statusText(418); // "I'm a Teapot"
```

`HTTP_STATUS_CODES` holds the **62 codes** of the standard registry.

---

## Error logging

The failures are reported through `stderr` so they are not lost:

```
[server] Unhandled error while serving /boom: Cannot read properties of undefined (reading "id")
TypeError: Cannot read properties of undefined (reading "id")
    at GET /boom (file:///app/routes.js:5:11)
[server] 500 Internal Server Error while serving /orders: Database connection pool exhausted
```

- The **unexpected** errors (an unhandled exception) are reported with their full stack trace.
- The **5xx** errors are reported with their message.
- The **4xx** errors are not reported: they are expected answers for the client.

---

## Customising the response

A handler can return an object with `status`, `body`, `headers`, `binary` or `interim`:

```js
'GET /download': () => ({
  status: 206,
  headers: { 'content-type': 'application/pdf' },
  body: pdfBuffer
});
```

> An object only defines the response when **all** its keys are response keys and the `status`
> is numeric. A data object such as `{ status: 'online' }` is serialized as the JSON body.
