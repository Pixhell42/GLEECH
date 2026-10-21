import type { ParameterDefinition } from '@gleech/project-model';

/** Compact value text for timeline headers, matching the inspector's units. */
export function formatParameterValue(
  definition: ParameterDefinition,
  value: number | string,
): string {
  if (definition.kind === 'choice')
    return definition.options.find((option) => option.value === value)?.label ?? String(value);
  if (definition.kind !== 'number') return String(value).toUpperCase();
  const number = Number(value);
  switch (definition.unit) {
    case 'percent':
      return `${Math.round(number * 100)}%`;
    case 'bits':
      return `${number} ${number === 1 ? 'bit' : 'bits'}`;
    case 'count':
      return String(number);
    case 'multiplier':
      return `${number.toFixed(2)}×`;
    case 'degrees':
      return `${Number(number.toFixed(1))}°`;
    case 'cycles':
      return `${Number(number.toFixed(2))}`;
    case 'coordinate':
      return number.toFixed(3);
    default:
      return `${number.toFixed(1)}%`;
  }
}

/** 0–1 position of a value within its control range. */
export function normalizedValue(definition: ParameterDefinition, value: number | string): number {
  if (definition.kind === 'number')
    return definition.max === definition.min
      ? 0
      : (Number(value) - definition.min) / (definition.max - definition.min);
  if (definition.kind === 'choice') {
    const index = definition.options.findIndex((option) => option.value === value);
    return definition.options.length > 1 ? Math.max(0, index) / (definition.options.length - 1) : 0;
  }
  return 0.5;
}
