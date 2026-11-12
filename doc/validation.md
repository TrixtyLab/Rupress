# Declarative validation

A route can **describe** what it expects and the server rejects the request when it does not
match the contract. The handler does not have to repeat the same checks on every request.

---

## The three sources

| Key      | Source                   | When it is validated              |
| -------- | ------------------------ | --------------------------------- |
| `fields` | The request **body**     | Only on `POST`, `PUT` and `PATCH` |
| `query`  | The **query string**     | On every method                   |
| `params` | The **route parameters** | On every method                   |

```js
await serve(3000, {
  "/posts/:id": {
    // body (POST, PUT, PATCH)
    fields: {
      post: {
        title: { type: "string", required: true },
        views: { type: "integer", required: false, default: 0 },
      },
    },

    // query string (every method)
    query: {
      page: { type: "integer", required: false, default: 1 },
      sort: {
        type: "string",
        enum: ["asc", "desc"],
        required: false,
        default: "asc",
      },
    },

    // route parameters (every method)
    params: {
      id: { type: "integer", required: true },
    },

    GET: ({ params, query }) => ({ postId: params.id, page: query.page }),
    POST: ({ params, body }) => ({
      saved: true,
      postId: params.id,
      content: body,
    }),
  },
});
```

- The `fields` schema nests **exactly like the body**: the example expects
  `{ post: { title: 'Hello' } }`. For a flat body describe a flat schema
  (`{ title: { type: 'string', required: true } }`).
- The `query` and `params` schemas are **flat**, because both sources are flat.

---

## Full example

```js
'POST /posts/:id': {
  fields: {
    post: {
      title: { type: 'string', required: true },
      body:  { type: 'string', required: true, minLength: 10 },
      tags:  { type: 'array', required: false, default: [] },
      author: { type: 'string', required: true, enum: ['alice', 'bob'] }
    }
  },
  POST: ({ params, body }) => ({ saved: true, postId: params.id, content: body })
}
```

```bash
curl -X POST http://127.0.0.1:3000/posts/1 -H 'content-type: application/json' -d '{"post":{}}'
```

```json
{
  "error": "Unprocessable Content",
  "status": 422,
  "message": "Field post.title is required",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/posts/1",
  "details": { "field": "post.title", "reason": "required" }
}
```

---

## The errors generated internally

When a field does not match, the server builds the error internally with the same JSON envelope
the rest of the errors use. The default status is `422 Unprocessable Content`, but **every field
can delegate the one it needs** (4xx or 5xx):

```js
fields: {
  token:  { type: 'string', required: true, status: 401 },  // -> 401 Unauthorized
  code:   { type: 'string', required: true, status: 400 },  // -> 400 Bad Request
  amount: { type: 'number', required: true, status: 500 }   // -> 500 Internal Server Error
}
```

The **custom errors thrown by the application are never replaced**: if the handler throws
`HttpError.Conflict(...)`, that error is the one that is answered.

The default status of a route can be set with `validation`:

```js
'/posts/:id': {
  fields: { title: { type: 'string', required: true } },
  validation: { status: 400 },
  POST: ({ body }) => body
}
```

---

## The options of a field

| Option                    | Type      | Description                                                                                  |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `type` / `format`         | `string`  | `string`, `number`, `integer`, `boolean`, `array`, `object`, `email`, `url`, `uuid`, `date`. |
| `required`                | `boolean` | When `true`, the field is mandatory (`undefined`, `null` and `''` count as missing).         |
| `default`                 | `any`     | Value applied when the field does not arrive.                                                |
| `status`                  | `number`  | The HTTP status of the generated error (defaults to `422`).                                  |
| `message`                 | `string`  | Message template; `{}` is replaced by the path of the field.                                 |
| `min` / `max`             | `number`  | Numeric range.                                                                               |
| `minLength` / `maxLength` | `number`  | Length of the strings.                                                                       |
| `pattern`                 | `string`  | Regular expression the string must match.                                                    |
| `enum`                    | `array`   | List of allowed values.                                                                      |
| `minItems` / `maxItems`   | `number`  | Number of elements of an array.                                                              |

### Types

| Type      | Accepts                                               |
| --------- | ----------------------------------------------------- |
| `string`  | Any string.                                           |
| `number`  | A finite number.                                      |
| `integer` | An integer.                                           |
| `boolean` | `true` or `false`.                                    |
| `array`   | An array.                                             |
| `object`  | An object (not an array).                             |
| `email`   | A string with an email format.                        |
| `url`     | A string with the `http` or `https` scheme.           |
| `uuid`    | A UUID in the standard format.                        |
| `date`    | An ISO date (`2026-01-01` or `2026-01-01T10:00:00Z`). |

---

## Type conversion

The values of the query string and of the route parameters arrive as **strings**. When a type is
declared, the value is converted and the handler receives it already typed:

```js
'/items/:id': {
  query: { page: { type: 'integer', default: 1 } },
  GET: ({ params, query }) => {
    query.page;   // 3 (a number), not '3'
    params.id;    // 42 (a number), not '42'
  }
}
```

If the conversion is not possible (for example `?page=abc` with `type: 'integer'`), the
validation fails with a `422`.

The arrays of the query string are split by commas: `?tags=a,b,c` → `['a', 'b', 'c']`.

---

## Custom messages

The `message` is a template. The `{}` marker is replaced by the path of the field and `{type}`,
`{min}`, `{max}`… by the values of the validation:

```js
fields: {
  title: {
    type: 'string',
    required: true,
    message: 'The field {} is mandatory'
  }
}
```

```
The field post.title is mandatory
```

---

## Imperative API and single line routes

```js
app.post('/users', ({ body }) => body, {
  fields: { email: { type: 'email', required: true } }
});

'POST /users': {
  fields: { email: { type: 'email', required: true } },
  handler: ({ body }) => body
};
```

---

## Validating from code

The helpers are also available directly:

```js
import {
  validateBody,
  validateRequest,
  collectFields,
} from "@trixtylab/rupress";

validateBody({ title: { type: "string", required: true } }, { title: "Hello" });

validateRequest(
  { fields: schema, query: querySchema },
  { body, query, params },
);
```
