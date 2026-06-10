import type { AnyType } from 'trellis/schema';
import { z } from 'zod';

/** Semantic field signals used by collection-view eligibility (ontology gate). */
export type FieldSignal = 'select' | 'date' | 'number' | 'file' | 'url' | 'lane';

const TEMPORAL_KEYS = new Set(['start', 'end', 'date', 'due', 'dueAt', 'scheduledAt']);
const LANE_KEYS = new Set(['laneId', 'lane', 'swimlane']);

function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
		return unwrapZod(schema._def.innerType as z.ZodTypeAny);
	}
	if (schema instanceof z.ZodDefault) {
		return unwrapZod(schema._def.innerType as z.ZodTypeAny);
	}
	return schema;
}

function isTemporalKey(key: string): boolean {
	return TEMPORAL_KEYS.has(key) || key.endsWith('At') || key.endsWith('Date');
}

function isLaneKey(key: string): boolean {
	return LANE_KEYS.has(key);
}

/** Infer ontology signals from a `defineType` Zod shape. */
export function inferFieldSignals(type: AnyType): Set<FieldSignal> {
	const signals = new Set<FieldSignal>();
	const shape = type.zod.shape;

	for (const [key, fieldSchema] of Object.entries(shape)) {
		const inner = unwrapZod(fieldSchema as z.ZodTypeAny);

		if (inner instanceof z.ZodEnum) {
			signals.add('select');
		}

		if (inner instanceof z.ZodDate) {
			signals.add('date');
		} else if (inner instanceof z.ZodString && isTemporalKey(key)) {
			signals.add('date');
		}

		if (inner instanceof z.ZodNumber) {
			signals.add('number');
		}

		if (isLaneKey(key)) {
			signals.add('lane');
		}
	}

	return signals;
}
