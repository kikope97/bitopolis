import { describe, expect, it } from 'vitest';
import { dbToGain } from '../src/audio.ts';

describe('volumen en decibelios', () => {
  it('0 dB es ganancia 1, −6 dB ≈ la mitad, −20 dB = 0,1 y −40 dB es silencio', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 5);
    expect(dbToGain(-40)).toBe(0);
  });
});
