import { z } from 'zod';
import { birthdaySchema, contactFieldKindSchema } from '@brevolt/contracts';
import type { ContactView } from '../contacts/service.js';

const ts = z.iso.datetime({ offset: true });

export const exportContactSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  prefix: z.string().nullable(),
  givenName: z.string().nullable(),
  middleName: z.string().nullable(),
  familyNames: z.string().nullable(),
  suffix: z.string().nullable(),
  nickname: z.string().nullable(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  birthday: birthdaySchema.nullable(),
  noteMd: z.string(),
  createdAt: ts,
  updatedAt: ts,
  fields: z.array(
    z.strictObject({
      kind: contactFieldKindSchema,
      label: z.string(),
      value: z.string(),
      normalized: z.string(),
    }),
  ),
  tags: z.array(z.string()),
  custom: z.record(z.string(), z.string()),
});

/** Schema of `GET /v1/export?format=json`. */
export const exportSchema = z.strictObject({
  format: z.literal('brevolt-export'),
  schemaVersion: z.literal(1),
  exportedAt: ts,
  contacts: z.array(exportContactSchema),
});
export type HubExport = z.infer<typeof exportSchema>;

export function buildExport(contacts: ContactView[], now: Date): HubExport {
  return {
    format: 'brevolt-export',
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    // Deleted contacts are never exported; picking the schema's keys also drops `deletedAt`.
    contacts: contacts.map((c) => {
      const picked = Object.fromEntries(
        Object.keys(exportContactSchema.shape).map((k) => [k, c[k as keyof ContactView]]),
      );
      return exportContactSchema.parse({
        ...picked,
        fields: c.fields.map(({ kind, label, value, normalized }) => ({
          kind,
          label,
          value,
          normalized,
        })),
      });
    }),
  };
}
