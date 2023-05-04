import { createPipr } from '../src';

describe('createPipr', () => {
  it('create pipr', () => {
    const pipr = createPipr({ apiKey: 'a' });
    expect(typeof pipr.input).toBe('function');
    expect(typeof pipr.prepare).toBe('function');
    expect(typeof pipr.prompt).toBe('function');
  });
});
