import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@brevolt/dashboard', () => {
  it('smoke: the test pipeline is alive', () => {
    expect(PACKAGE_NAME).toBe('@brevolt/dashboard');
  });
});
