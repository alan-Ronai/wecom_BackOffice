import { z, type ZodTypeAny } from 'zod';

interface FieldInfo {
  type: string;
  optional: boolean;
  secret: boolean;
  values?: string[];
  description?: string;
  default?: unknown;
}

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

const kindOf = (s: ZodTypeAny): string => {
  const name = (s._def as { typeName?: string }).typeName ?? '';
  return name.replace(/^Zod/, '').toLowerCase();
};

/**
 * A form-shaped description of a connector's config, without pulling in a JSON-Schema
 * generator: the connector-new page needs field names, whether each is required, the
 * allowed values of an enum and — crucially — which fields are secrets, so the form can
 * render them as password inputs and never echo a stored value back.
 */
export function describeConfigSchema(schema: ZodTypeAny): Record<string, unknown> {
  const { inner } = unwrap(schema);
  if (!(inner instanceof z.ZodObject)) return { type: 'unknown' };
  const shape = inner.shape as Record<string, ZodTypeAny>;
  const fields: Record<string, FieldInfo> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const { inner: field, optional, def } = unwrap(raw);
    const info: FieldInfo = { type: kindOf(field), optional, secret: SECRET_KEYS.test(key) };
    if (field instanceof z.ZodEnum) info.values = field.options as string[];
    if (field instanceof z.ZodArray) info.type = 'array';
    if (raw.description) info.description = raw.description;
    // A default is safe to show; a secret's is not (it would be a shipped credential).
    if (def !== undefined && !info.secret) info.default = def;
    fields[key] = info;
    if (!optional) required.push(key);
  }
  return { type: 'object', fields, required };
}
