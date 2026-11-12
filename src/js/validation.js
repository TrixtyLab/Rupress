import { HttpError } from './http.js';

/**
 * Declarative validation of the request.
 *
 * A route can describe the fields it expects and the framework takes care of
 * rejecting the request when the payload does not match, so the handlers do not
 * have to repeat the same checks.
 *
 * ```js
 * '/posts/:id': {
 *   fields: {                                  // body (POST, PUT, PATCH)
 *     post: { title: { type: 'string', required: true } }
 *   },
 *   query: {                                   // query string (any method)
 *     page: { type: 'integer', required: false, default: 1 }
 *   },
 *   params: {                                  // path parameters (any method)
 *     id: { type: 'integer', required: true }
 *   },
 *   GET: ({ params, query }) => ({ ... }),
 *   POST: async ({ params, body }) => ({ ... })
 * }
 * ```
 *
 * The `fields` schema is nested exactly like the body: the example above expects a
 * payload shaped as `{ post: { title: 'Hello' } }`. A flat payload is described with
 * a flat schema: `{ title: { type: 'string', required: true } }`.
 *
 * The `query` and `params` schemas are always flat, because both sources are flat.
 * Their values arrive as strings and are coerced to the declared type, so the
 * handlers receive typed values.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Options accepted by a field definition.
 */
const FIELD_OPTIONS = new Set([
  'type',
  'format',
  'required',
  'default',
  'message',
  'status',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'enum',
  'minItems',
  'maxItems'
]);

/**
 * Type checkers available for the `type` (or `format`) option.
 */
const TYPE_CHECKS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  email: (value) => typeof value === 'string' && EMAIL_PATTERN.test(value),
  url: (value) => typeof value === 'string' && URL_PATTERN.test(value),
  uuid: (value) => typeof value === 'string' && UUID_PATTERN.test(value),
  date: (value) => typeof value === 'string' && DATE_PATTERN.test(value)
};

/**
 * Default message templates. The `{}` placeholder is replaced by the field path.
 */
const DEFAULT_MESSAGES = {
  required: 'Field {} is required',
  type: 'Field {} must be of type {type}',
  enum: 'Field {} must be one of: {allowed}',
  min: 'Field {} must be greater than or equal to {min}',
  max: 'Field {} must be less than or equal to {max}',
  minLength: 'Field {} must have at least {minLength} characters',
  maxLength: 'Field {} must have at most {maxLength} characters',
  pattern: 'Field {} does not match the expected format',
  minItems: 'Field {} must have at least {minItems} items',
  maxItems: 'Field {} must have at most {maxItems} items'
};

/**
 * Checks whether a value describes a single field instead of a group of fields.
 *
 * Every option of the definition must be a known one, so a group named after an
 * option (`fields.status`, for instance) is not mistaken for a field.
 *
 * @param {unknown} value Candidate definition.
 * @returns {boolean}
 */
export function isFieldDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length === 0) {
    return false;
  }

  return keys.every((key) => FIELD_OPTIONS.has(key));
}

/**
 * Flattens a declarative schema into the list of fields it describes.
 *
 * @param {object} schema Declarative schema.
 * @param {string} [prefix] Path of the parent group.
 * @returns {Array<{ path: string, spec: object }>}
 */
export function collectFields(schema, prefix = '') {
  const fields = [];

  if (!schema || typeof schema !== 'object') {
    return fields;
  }

  for (const [name, spec] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${name}` : name;

    if (isFieldDescriptor(spec)) {
      fields.push({ path, spec });
      continue;
    }

    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      fields.push(...collectFields(spec, path));
      continue;
    }

    throw new TypeError(
      `Invalid definition for the field "${path}": expected an object with the field options.`
    );
  }

  return fields;
}

/**
 * Reads a dotted path from an object.
 */
function readPath(source, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }
    return acc[key];
  }, source);
}

/**
 * Writes a dotted path into an object, creating the intermediate groups.
 */
function writePath(target, path, value) {
  const keys = path.split('.');
  let current = target;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Replaces the placeholders of a message template.
 *
 * `{}` is replaced by the field path and `{name}` by any of the extra values.
 */
function formatMessage(template, values) {
  return String(template)
    .replace(/\{\}/g, values.field ?? '')
    .replace(/\{(\w+)\}/g, (_, key) => (values[key] !== undefined ? String(values[key]) : ''));
}

/**
 * Describes the type of a value for the error details.
 */
function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Builds the validation error of a field.
 *
 * The status code is delegated internally: every field can decide which 4xx or 5xx
 * answers with, defaulting to `422 Unprocessable Content`. Errors thrown by the
 * application are never replaced by these ones.
 */
function validationError(spec, reason, values, details, defaultStatus) {
  const template = spec.message || DEFAULT_MESSAGES[reason] || 'Field {} is invalid';
  const status = Number.isInteger(spec.status) ? spec.status : (defaultStatus ?? 422);

  return new HttpError(
    status,
    formatMessage(template, { field: values.field, ...values }),
    { field: values.field, reason, ...details }
  );
}

/**
 * Checks that a value satisfies the constraints of its field definition.
 */
function checkConstraints(spec, value, fieldPath, defaultStatus) {
  if (typeof value === 'number') {
    if (spec.min !== undefined && value < spec.min) {
      throw validationError(spec, 'min', { field: fieldPath, min: spec.min }, { expected: spec.min, received: value }, defaultStatus);
    }
    if (spec.max !== undefined && value > spec.max) {
      throw validationError(spec, 'max', { field: fieldPath, max: spec.max }, { expected: spec.max, received: value }, defaultStatus);
    }
  }

  if (typeof value === 'string') {
    if (spec.minLength !== undefined && value.length < spec.minLength) {
      throw validationError(
        spec,
        'minLength',
        { field: fieldPath, minLength: spec.minLength },
        { expected: spec.minLength, received: value.length },
        defaultStatus
      );
    }
    if (spec.maxLength !== undefined && value.length > spec.maxLength) {
      throw validationError(
        spec,
        'maxLength',
        { field: fieldPath, maxLength: spec.maxLength },
        { expected: spec.maxLength, received: value.length },
        defaultStatus
      );
    }
    if (spec.pattern !== undefined) {
      const pattern = new RegExp(spec.pattern);
      if (!pattern.test(value)) {
        throw validationError(spec, 'pattern', { field: fieldPath }, { expected: spec.pattern }, defaultStatus);
      }
    }
  }

  if (Array.isArray(value)) {
    if (spec.minItems !== undefined && value.length < spec.minItems) {
      throw validationError(
        spec,
        'minItems',
        { field: fieldPath, minItems: spec.minItems },
        { expected: spec.minItems, received: value.length },
        defaultStatus
      );
    }
    if (spec.maxItems !== undefined && value.length > spec.maxItems) {
      throw validationError(
        spec,
        'maxItems',
        { field: fieldPath, maxItems: spec.maxItems },
        { expected: spec.maxItems, received: value.length },
        defaultStatus
      );
    }
  }
}

/**
 * Converts the string values of the query and the path parameters into the declared
 * type, so the handlers receive typed values.
 *
 * @param {unknown} value Raw value.
 * @param {string|undefined} type Declared type.
 * @returns {unknown} The coerced value.
 */
function coerce(value, type) {
  if (typeof value !== 'string' || !type) {
    return value;
  }

  if (type === 'number' || type === 'integer') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }

  if (type === 'array') {
    return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
  }

  return value;
}

/**
 * Reads the value of a field from the selected source.
 *
 * The body is a nested object, so the dotted path is resolved. The query and the
 * path parameters are flat, therefore the whole path is used as the key.
 */
function readValue(source, path, flat) {
  if (flat) {
    return source[path];
  }
  return readPath(source, path);
}

/**
 * Writes the value of a field back into the selected source.
 */
function writeValue(target, path, value, flat) {
  if (!target || typeof target !== 'object') {
    return;
  }

  if (flat) {
    target[path] = value;
    return;
  }

  writePath(target, path, value);
}

/**
 * Validates a source against its declarative schema.
 *
 * @param {object} schema Declarative schema.
 * @param {object} source Values of the source (body, query or params).
 * @param {boolean} flat Whether the source is flat (query and params).
 * @param {number} [defaultStatus] Status used by the generated errors.
 */
function validateSource(schema, source, flat, defaultStatus) {
  const fields = collectFields(schema);

  if (fields.length === 0) {
    return;
  }

  const isPlainSource = source !== null && typeof source === 'object' && !Array.isArray(source);
  const target = isPlainSource ? source : {};

  for (const { path, spec } of fields) {
    const type = spec.type || spec.format;
    let value = readValue(target, path, flat);

    // The presence is checked before the conversion: an empty value is missing,
    // it must not be turned into a zero by the coercion.
    const missing = value === undefined || value === null || value === '';

    if (missing) {
      if (spec.default !== undefined) {
        if (isPlainSource) {
          writeValue(target, path, spec.default, flat);
        }
        value = spec.default;
      } else if (spec.required) {
        throw validationError(spec, 'required', { field: path }, {}, defaultStatus);
      } else {
        continue;
      }
    } else {
      value = coerce(value, type);
    }

    if (type) {
      const check = TYPE_CHECKS[type];

      if (!check) {
        throw new TypeError(
          `Unknown type "${type}" for the field "${path}". Available types: ${Object.keys(TYPE_CHECKS).join(', ')}.`
        );
      }

      if (!check(value)) {
        throw validationError(spec, 'type', { field: path, type }, {
          expected: type,
          received: describeType(value)
        }, defaultStatus);
      }
    }

    if (spec.enum !== undefined) {
      if (!Array.isArray(spec.enum)) {
        throw new TypeError(`The "enum" option of the field "${path}" must be an array.`);
      }
      if (!spec.enum.includes(value)) {
        throw validationError(spec, 'enum', { field: path, allowed: spec.enum.join(', ') }, {
          expected: spec.enum,
          received: value
        }, defaultStatus);
      }
    }

    checkConstraints(spec, value, path, defaultStatus);

    // The coerced value is stored back so the handler receives typed values.
    if (isPlainSource && value !== readValue(target, path, flat)) {
      writeValue(target, path, value, flat);
    }
  }
}

/**
 * Validates a payload against a declarative schema.
 *
 * @param {object} schema Declarative schema of the route.
 * @param {unknown} body Parsed request body.
 * @param {object} [options] Validation options (`status` sets the default status).
 * @returns {unknown} The body, with the default values applied.
 * @throws {HttpError} When the payload does not match the schema.
 */
export function validateBody(schema, body, options = {}) {
  const defaultStatus = Number.isInteger(options.status) ? options.status : 422;

  validateSource(schema, body, false, defaultStatus);

  return body;
}

/**
 * Validates a request against the declarative schemas of a route.
 *
 * The `fields` schema is validated against the body, the `query` schema against the
 * query string and the `params` schema against the path parameters.
 *
 * @param {object} schemas Schemas of the route (`fields`, `query` and `params`).
 * @param {object} sources Values of the request (`body`, `query` and `params`).
 * @param {object} [options] Validation options (`status` sets the default status).
 * @throws {HttpError} When the request does not match the schemas.
 */
export function validateRequest(schemas, sources, options = {}) {
  const defaultStatus = Number.isInteger(options.status) ? options.status : 422;

  if (!schemas) {
    return;
  }

  validateSource(schemas.fields, sources.body, false, defaultStatus);
  validateSource(schemas.query, sources.query, true, defaultStatus);
  validateSource(schemas.params, sources.params, true, defaultStatus);
}
