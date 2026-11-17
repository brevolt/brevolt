import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { contactSchema } from '@brevolt/contracts';
import type { Contact } from '../src/index.js';

describe('core types come from contracts', () => {
  it('Contact is the Zod-inferred type', () => {
    expectTypeOf<Contact>().toEqualTypeOf<z.infer<typeof contactSchema>>();
  });
});
