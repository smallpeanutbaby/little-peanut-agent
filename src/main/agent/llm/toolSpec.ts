/**
 * Convert a zod schema to a JSON Schema acceptable to every provider we
 * speak to. We avoid pulling `zod-to-json-schema` (no SCM-trusted
 * release on npm at this layer) and instead implement the small subset
 * we actually need:
 *
 *   - ZodObject (with optional / nullable / defaults)
 *   - ZodString (with enum / min / max / regex / description)
 *   - ZodNumber / ZodInt / ZodBoolean
 *   - ZodArray (single item type)
 *   - ZodEnum / ZodLiteral
 *   - ZodUnion (best-effort `anyOf`)
 *   - ZodOptional / ZodNullable / ZodDefault
 *   - ZodRecord (only when value type is primitive)
 *
 * This is enough for every tool input we ship. If a tool needs a more
 * exotic schema, it can override `inputSchema` directly with a hand-
 * written JSON Schema (the Tool interface accepts either).
 */

import { z } from "zod";

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  examples?: unknown[];
}

/** Convert a zod schema to JSON Schema. Unknown nodes degrade to
 *  `{ type: "object" }` rather than throwing — better to ship a slightly
 *  loose schema than crash the runtime. */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  // Unwrap common wrappers first.
  const def = (schema as { _def?: { typeName?: string; description?: string } })._def;
  if (!def) return { type: "object" };

  const baseDescription = def.description ?? undefined;
  const t = def.typeName;

  if (t === "ZodObject") {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = convert(child);
      if (!isOptional(child)) required.push(key);
    }
    const out: JsonSchema = {
      type: "object",
      properties,
      additionalProperties: false
    };
    if (required.length > 0) out.required = required;
    if (baseDescription) out.description = baseDescription;
    return out;
  }
  if (t === "ZodString") {
    const out: JsonSchema = { type: "string" };
    if (baseDescription) out.description = baseDescription;
    const checks = (def as unknown as { checks?: Array<Record<string, unknown>> }).checks ?? [];
    for (const c of checks) {
      if (c.kind === "min" && typeof c.value === "number") out.minLength = c.value;
      else if (c.kind === "max" && typeof c.value === "number") out.maxLength = c.value;
      else if (c.kind === "regex" && c.regex instanceof RegExp) out.pattern = (c.regex as RegExp).source;
      else if (c.kind === "email") out.format = "email";
      else if (c.kind === "url") out.format = "uri";
    }
    return out;
  }
  if (t === "ZodNumber") {
    const out: JsonSchema = { type: "number" };
    if (baseDescription) out.description = baseDescription;
    const checks = (def as unknown as { checks?: Array<Record<string, unknown>> }).checks ?? [];
    for (const c of checks) {
      if (c.kind === "min" && typeof c.value === "number") out.minimum = c.value;
      else if (c.kind === "max" && typeof c.value === "number") out.maximum = c.value;
      else if (c.kind === "int") out.type = "integer";
    }
    return out;
  }
  if (t === "ZodBoolean") {
    const out: JsonSchema = { type: "boolean" };
    if (baseDescription) out.description = baseDescription;
    return out;
  }
  if (t === "ZodArray") {
    const inner = (schema as unknown as { element: z.ZodTypeAny }).element;
    const out: JsonSchema = { type: "array", items: convert(inner) };
    if (baseDescription) out.description = baseDescription;
    return out;
  }
  if (t === "ZodEnum") {
    const values = (def as unknown as { values: string[] }).values;
    const out: JsonSchema = { type: "string", enum: values };
    if (baseDescription) out.description = baseDescription;
    return out;
  }
  if (t === "ZodLiteral") {
    const value = (def as unknown as { value: unknown }).value;
    return { enum: [value], description: baseDescription };
  }
  if (t === "ZodUnion") {
    const options = (def as unknown as { options: z.ZodTypeAny[] }).options;
    return {
      anyOf: options.map(convert),
      description: baseDescription
    };
  }
  if (t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable") {
    const inner = (def as unknown as { innerType: z.ZodTypeAny }).innerType;
    const child = convert(inner);
    if (t === "ZodDefault") {
      const defaultValue = (def as unknown as { defaultValue: () => unknown }).defaultValue();
      child.default = defaultValue;
    }
    if (baseDescription && !child.description) child.description = baseDescription;
    return child;
  }
  if (t === "ZodRecord") {
    const value = (def as unknown as { valueType: z.ZodTypeAny }).valueType;
    return {
      type: "object",
      additionalProperties: convert(value),
      description: baseDescription
    };
  }
  if (t === "ZodAny" || t === "ZodUnknown") {
    return baseDescription ? { description: baseDescription } : {};
  }

  return { type: "object", description: baseDescription };
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = (schema as { _def?: { typeName?: string } })._def;
  const t = def?.typeName;
  return t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable";
}
