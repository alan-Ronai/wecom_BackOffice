import { z, type ZodTypeAny } from 'zod';
import type { ConnectorConfigSchema, ConnectorConfigProperty } from '@wecom/shared';

const SECRET_KEYS = /password|secret|token|key/i;

/** Peels `.optional()`, `.default()`, `.refine()` and friends off to reach the real type. */
function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; def?: unknown } {
  let s = schema;
  let optional = false;
  let def: unknown;
  for (let i = 0; i < 10; i++) {
    const d = s._def as {
      typeName?: string;
      innerType?: ZodTypeAny;
      schema?: ZodTypeAny;
      defaultValue?: () => unknown;
    };
    if (d.typeName === 'ZodOptional' || d.typeName === 'ZodNullable') {
      optional = true;
      s = d.innerType!;
    } else if (d.typeName === 'ZodDefault') {
      optional = true;
      def = d.defaultValue?.();
      s = d.innerType!;
    } else if (d.typeName === 'ZodEffects') {
      s = d.schema!;
    } else break;
  }
  return { inner: s, optional, def };
}

interface StringCheck {
  kind: string;
  value?: number;
}

const checksOf = (s: ZodTypeAny): StringCheck[] =>
  ((s._def as { checks?: StringCheck[] }).checks ?? []) as StringCheck[];

/** The JSON-Schema `type` for a zod leaf. Anything not otherwise known is an object. */
function jsonType(s: ZodTypeAny): ConnectorConfigProperty['type'] {
  if (s instanceof z.ZodString || s instanceof z.ZodEnum) return 'string';
  if (s instanceof z.ZodNumber) return checksOf(s).some((c) => c.kind === 'int') ? 'integer' : 'number';
  if (s instanceof z.ZodBoolean) return 'boolean';
  if (s instanceof z.ZodArray) return 'array';
  return 'object';
}

/**
 * A field's human text, taken from zod's `.describe()` under one documented convention: the
 * string is up to three newline-separated parts — **title**, **description**, **example**.
 *
 * Zod v3 carries exactly one free-text slot per schema and the wizard needs a label (Hebrew, and
 * the field name is not one), an optional hint under the input and an optional placeholder.
 * Splitting one string is what keeps the labels beside the validation they belong to, in the
 * connector's own config module, rather than in a table the frontend would have to be told about.
 */
function textOf(raw: string | undefined, key: string) {
  const [title, description, example] = (raw ?? '').split('\n').map((s) => s.trim());
  return {
    title: title || key,
    ...(description ? { description } : {}),
    ...(example ? { examples: [example] } : {}),
  };
}

/**
 * A connector's config as JSON Schema, which is what `GET /connectors/types` publishes and what
 * the connector wizard builds its form from.
 *
 * This used to emit a bespoke `{type, fields, required}` while the wizard read JSON Schema's
 * `properties` — so the settings step rendered nothing but the connector's name and every create
 * was a 400 (walkthrough W-1). The two sides now meet at `ConnectorConfigSchemaSchema` in
 * `@wecom/shared`, which is strict, so a drift is a failing response validation rather than an
 * empty form.
 *
 * Only what the wizard can honestly render is emitted: the constraints it re-applies
 * (`minLength`, `minItems`, `format: 'uri'`), which values an enum allows, which fields are
 * secrets — `writeOnly`, so a stored value is never expected back — and the schema defaults, so
 * the settings step opens filled in. A secret's default is deliberately dropped: it would be a
 * shipped credential.
 */
export function describeConfigSchema(schema: ZodTypeAny): ConnectorConfigSchema {
  const { inner } = unwrap(schema);
  const out: ConnectorConfigSchema = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  };
  if (!(inner instanceof z.ZodObject)) return out;
  for (const [key, raw] of Object.entries(inner.shape as Record<string, ZodTypeAny>)) {
    const { inner: field, optional, def } = unwrap(raw);
    const secret = SECRET_KEYS.test(key);
    const prop: ConnectorConfigProperty = {
      type: jsonType(field),
      ...textOf(raw.description, key),
    };
    if (secret) {
      prop.writeOnly = true;
      prop.format = 'password';
    }
    if (field instanceof z.ZodString) {
      const checks = checksOf(field);
      const min = checks.find((c) => c.kind === 'min')?.value;
      if (typeof min === 'number') prop.minLength = min;
      // A secret is a password input; saying it is also a url would fight over the same slot.
      if (!secret && checks.some((c) => c.kind === 'url')) prop.format = 'uri';
    }
    if (field instanceof z.ZodEnum) prop.enum = field.options as string[];
    if (field instanceof z.ZodArray) {
      const element = unwrap((field._def as { type: ZodTypeAny }).type).inner;
      prop.items = { type: jsonType(element) };
      const min = (field._def as { minLength?: { value: number } | null }).minLength;
      if (min) prop.minItems = min.value;
    }
    // A record is a free-keyed map (`categoryMap`): the wizard edits it as `key = value` rows.
    // An object with a fixed shape carries no `additionalProperties` and is edited as JSON —
    // guessing controls for a nested shape would render a form the server then rejects.
    if (field instanceof z.ZodRecord)
      prop.additionalProperties = { type: jsonType(unwrap(field._def.valueType as ZodTypeAny).inner) };
    if (def !== undefined && !secret) prop.default = def;
    out.properties[key] = prop;
    if (!optional) out.required.push(key);
  }
  return out;
}
