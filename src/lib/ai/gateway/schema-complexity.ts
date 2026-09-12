/**
 * Structural inspector for Anthropic-bound JSON Schemas.
 *
 * Anthropic's structured-output dialect caps schema complexity independently
 * of any single unsupported keyword:
 *   - at most 16 "union-typed" parameters: a schema node whose `type` is an
 *     array with more than one member (e.g. ["string","null"]), or that uses
 *     `anyOf` in place of a `type` array to express the same thing.
 *   - at most 24 optional parameters: an object property that is declared in
 *     `properties` but absent from that same object's `required` array.
 *
 * This module walks an arbitrary JSON Schema object (through `properties`,
 * `items`, `anyOf`, `allOf`, `oneOf`) and reports every occurrence with a
 * path, so a regression test can name the exact offending field instead of
 * only a count.
 */

export interface SchemaComplexityFinding {
  path: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walkSchema(node: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void): void {
  if (!isPlainObject(node)) return;
  visit(node, path);

  if (isPlainObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      walkSchema(child, `${path}.properties.${key}`, visit);
    }
  }
  if (Array.isArray(node.items)) {
    node.items.forEach((child, i) => walkSchema(child, `${path}.items[${i}]`, visit));
  } else if (node.items !== undefined) {
    walkSchema(node.items, `${path}.items`, visit);
  }
  for (const combinator of ['anyOf', 'allOf', 'oneOf'] as const) {
    const branches = node[combinator];
    if (Array.isArray(branches)) {
      branches.forEach((child, i) => walkSchema(child, `${path}.${combinator}[${i}]`, visit));
    }
  }
}

/** Every schema node whose `type` is a multi-member array, or an `anyOf` standing in for one. */
export function findSchemaUnions(schema: unknown, rootPath = '$'): SchemaComplexityFinding[] {
  const found: SchemaComplexityFinding[] = [];
  walkSchema(schema, rootPath, (node, path) => {
    if (Array.isArray(node.type) && node.type.length > 1) {
      found.push({ path: `${path}.type` });
    } else if (node.type === undefined && Array.isArray(node.anyOf) && node.anyOf.length > 1) {
      found.push({ path: `${path}.anyOf` });
    }
  });
  return found;
}

export function countSchemaUnions(schema: unknown): number {
  return findSchemaUnions(schema).length;
}

/** Every object property declared in `properties` but missing from its own object's `required` array. */
export function findOptionalParameters(schema: unknown, rootPath = '$'): SchemaComplexityFinding[] {
  const found: SchemaComplexityFinding[] = [];
  walkSchema(schema, rootPath, (node, path) => {
    if (node.type !== 'object' || !isPlainObject(node.properties)) return;
    const required = new Set(Array.isArray(node.required) ? (node.required as unknown[]) : []);
    for (const key of Object.keys(node.properties)) {
      if (!required.has(key)) found.push({ path: `${path}.properties.${key}` });
    }
  });
  return found;
}

export function countOptionalParameters(schema: unknown): number {
  return findOptionalParameters(schema).length;
}

export const ANTHROPIC_STRUCTURED_OUTPUT_LIMITS = {
  maxUnionTypedParameters: 16,
  maxOptionalParameters: 24,
} as const;

/**
 * Every object-typed schema node, by path.
 *
 * Anthropic also enforces an INTERNAL limit on compiled-grammar size, separate
 * from the union/optional caps above: a schema can pass both explicit limits and
 * still be rejected with "The compiled grammar is too large". Counting distinct
 * object schemas is the regression metric for that — an 18-times-repeated
 * evidence object compiles to a far larger grammar than one generic item schema
 * reused inside an array.
 */
export function findObjectSchemas(schema: unknown, rootPath = '$'): SchemaComplexityFinding[] {
  const found: SchemaComplexityFinding[] = [];
  walkSchema(schema, rootPath, (node, path) => {
    if (node.type === 'object') found.push({ path });
  });
  return found;
}

export function countObjectSchemas(schema: unknown): number {
  return findObjectSchemas(schema).length;
}

/** Deepest chain of nested object schemas (root object = 1). Shallow schemas compile smaller. */
export function maxObjectNestingDepth(schema: unknown): number {
  let max = 0;
  walkSchema(schema, '$', (node, path) => {
    if (node.type !== 'object') return;
    const depth = (path.match(/\.properties\./g) ?? []).length + 1;
    if (depth > max) max = depth;
  });
  return max;
}

/** Serialized byte length of the schema as it would travel to the provider. */
export function schemaByteLength(schema: unknown): number {
  return Buffer.byteLength(JSON.stringify(schema), 'utf8');
}
