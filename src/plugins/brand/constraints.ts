/**
 * Constraint Application — Narrows shadcn component Zod enums based on brand tokens.
 *
 * The core transformation: shadcn's Button accepts z.enum(["primary","secondary","danger"])
 * → a brand-constrained catalog narrows it to z.enum(["primary","danger"]) based on
 * which token roles exist in the graph.
 *
 * @module trellis/plugins/brand
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constraint Map — which component props are constrained by which token types
// ---------------------------------------------------------------------------

/**
 * Maps component name → { propName: tokenType }.
 * Only components/props listed here are narrowed; everything else passes through.
 */
export const CONSTRAINT_MAP: Record<string, Record<string, string>> = {
  // Color-constrained
  Button: { variant: 'color' },
  Badge: { variant: 'color' },
  Alert: { type: 'color' },
  Toggle: { variant: 'color' },

  // Typography-constrained
  Text: { variant: 'typography' },

  // Spacing-constrained
  Stack: { gap: 'spacing' },
  Grid: { gap: 'spacing' },
  Card: { maxWidth: 'spacing' },
  Avatar: { size: 'spacing' },
  Spinner: { size: 'spacing' },
};

// ---------------------------------------------------------------------------
// Role Aliases — maps token roles to shadcn enum values
// ---------------------------------------------------------------------------

/**
 * When token role names don't match shadcn enum values 1:1, this map provides
 * the translation. A role of "destructive" maps to both "destructive" and "danger"
 * (whichever the shadcn component actually uses).
 */
export const ROLE_ALIASES: Record<string, string[]> = {
  primary: ['primary', 'default'],
  secondary: ['secondary'],
  destructive: ['destructive', 'danger'],
  accent: ['outline'],
  muted: ['muted', 'ghost'],
  info: ['info'],
  success: ['success'],
  warning: ['warning'],
  error: ['error', 'destructive'],
  // Typography roles
  body: ['body'],
  caption: ['caption'],
  code: ['code'],
  lead: ['lead'],
  // Spacing roles
  none: ['none'],
  sm: ['sm'],
  md: ['md'],
  lg: ['lg'],
  xl: ['xl'],
};

// ---------------------------------------------------------------------------
// Enum extraction from Zod schemas
// ---------------------------------------------------------------------------

/**
 * Extract enum values from a Zod schema. Handles:
 * - z.enum([...])
 * - z.enum([...]).nullable()
 * - z.enum([...]).optional()
 * - z.enum([...]).nullable().optional()
 *
 * Returns null if the schema is not an enum type.
 */
export function extractEnumValues(schema: z.ZodType): string[] | null {
  let current: z.ZodType = schema;

  // Unwrap nullable/optional wrappers
  while (current instanceof z.ZodNullable || current instanceof z.ZodOptional) {
    current = (current as any)._def.innerType;
  }

  // Check for ZodEnum
  if (current instanceof z.ZodEnum) {
    return (current as any)._def.values as string[];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core constraint function
// ---------------------------------------------------------------------------

/**
 * Narrow an enum to only values that match available token roles.
 *
 * @param originalEnum - The full set of enum values from the shadcn component
 * @param availableRoles - Token roles present in the brand guide
 * @returns Narrowed enum values. Falls back to first original value if nothing matches.
 */
export function constrainEnum(originalEnum: string[], availableRoles: string[]): string[] {
  const allowed = new Set<string>();

  for (const role of availableRoles) {
    const aliases = ROLE_ALIASES[role] ?? [role];
    for (const alias of aliases) {
      if (originalEnum.includes(alias)) {
        allowed.add(alias);
      }
    }
  }

  // Always keep at least one value — fall back to first original if nothing matches
  return allowed.size > 0 ? [...allowed] : [originalEnum[0]];
}

// ---------------------------------------------------------------------------
// Apply constraints to a component definition
// ---------------------------------------------------------------------------

/**
 * Given a component definition and the available tokens grouped by type,
 * return a new definition with narrowed Zod enum props.
 *
 * If the component has no constraints in CONSTRAINT_MAP, returns the original.
 */
export function constrainComponentDef(
  componentName: string,
  def: { props: z.ZodType; [key: string]: unknown },
  tokensByType: Record<string, Array<{ role: string }>>,
): { props: z.ZodType; [key: string]: unknown } {
  const constraints = CONSTRAINT_MAP[componentName];
  if (!constraints) return def;

  // Only ZodObject props can be narrowed
  if (!(def.props instanceof z.ZodObject)) return def;

  const shape = { ...(def.props as z.ZodObject<any>).shape };
  let modified = false;

  for (const [propName, tokenType] of Object.entries(constraints)) {
    const tokens = tokensByType[tokenType];
    if (!tokens || tokens.length === 0) continue;

    const original = shape[propName];
    if (!original) continue;

    const originalValues = extractEnumValues(original);
    if (!originalValues) continue;

    const roles = tokens.map((t) => t.role);
    const narrowed = constrainEnum(originalValues, roles);

    // Only rebuild if actually narrower
    if (narrowed.length < originalValues.length) {
      shape[propName] = z.enum(narrowed as [string, ...string[]]).nullable();
      modified = true;
    }
  }

  if (!modified) return def;

  return {
    ...def,
    props: z.object(shape),
  };
}
