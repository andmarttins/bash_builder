import { describe, expect, it } from 'vitest';
import { calculateHhtRates } from './operations.service.js';

describe('calculateHhtRates', () => {
  it('calculates normalized safety rates without rounding drift', () => {
    expect(calculateHhtRates({ hhtWorked: 200_000, lostDays: 3, lti: 2 })).toEqual({ trifr: 10, ltifr: 10, ltisr: 15 });
  });

  it('does not produce Infinity or NaN when a period has no worked hours', () => {
    expect(calculateHhtRates({ hhtWorked: 0, lostDays: 3, lti: 2 })).toEqual({ trifr: 0, ltifr: 0, ltisr: 0 });
  });
});
