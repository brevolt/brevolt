import { z } from 'zod';
import { birthdaySchema, contactFieldKindSchema, labelSchema } from './contact.js';

/** Bridge contract (docs/spec.md, "Bridge contract"): shared by the server and the macOS bridge. */

export const operationIdSchema = z.string().regex(/^[\w.:-]{1,128}$/);

const nullableText = z.string().nullable().default(null);

/** A contact as the Contacts app holds it. The server normalizes phones, emails and labels. */
export const bridgeContactSchema = z.strictObject({
  prefix: nullableText,
  givenName: nullableText,
  middleName: nullableText,
  familyNames: nullableText,
  suffix: nullableText,
  nickname: nullableText,
  company: nullableText,
  jobTitle: nullableText,
  birthday: birthdaySchema.nullable().default(null),
  fields: z
    .array(
      z.strictObject({
        kind: contactFieldKindSchema,
        label: labelSchema,
        value: z.string().trim().min(1),
      }),
    )
    .max(200)
    .default([]),
});
export type BridgeContact = z.infer<typeof bridgeContactSchema>;

export const bridgeChangeKindSchema = z.enum(['upsert', 'delete']);

/** `POST /v1/bridge/changes` item: what changed in Contacts. */
export const bridgeIncomingChangeSchema = z
  .strictObject({
    operation_id: operationIdSchema,
    local_id: z.string().min(1).max(256),
    container_id: z.string().min(1).max(256),
    kind: bridgeChangeKindSchema,
    contact: bridgeContactSchema.optional(),
  })
  .refine((c) => c.kind === 'delete' || c.contact !== undefined, {
    message: 'upsert requires contact',
    path: ['contact'],
  });
export type BridgeIncomingChange = z.infer<typeof bridgeIncomingChangeSchema>;

/**
 * `POST /v1/bridge/changes` body. A `snapshot` is a full read after the history token expired
 * (R-BR-5); it is merged exactly like an incremental batch.
 */
export const bridgeChangesRequestSchema = z.strictObject({
  snapshot: z.boolean().optional(),
  changes: z.array(bridgeIncomingChangeSchema).max(500),
});
export type BridgeChangesRequest = z.infer<typeof bridgeChangesRequestSchema>;

export const bridgeChangeOutcomeSchema = z.enum([
  'created',
  'merged',
  'unchanged',
  'conflict',
  'deleted_upstream',
  'ignored',
  'duplicate',
]);
export type BridgeChangeOutcome = z.infer<typeof bridgeChangeOutcomeSchema>;

export const bridgeChangesResponseSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      operation_id: operationIdSchema,
      outcome: bridgeChangeOutcomeSchema,
      contact_id: z.string().nullable(),
    }),
  ),
});
export type BridgeChangesResponse = z.infer<typeof bridgeChangesResponseSchema>;

/** `GET /v1/bridge/pending` item: what the bridge must write to Contacts. */
export const bridgePendingChangeSchema = z.strictObject({
  operation_id: operationIdSchema,
  contact_id: z.string(),
  local_id: z.string().nullable(),
  kind: bridgeChangeKindSchema,
  contact: bridgeContactSchema.optional(),
});
export type BridgePendingChange = z.infer<typeof bridgePendingChangeSchema>;

export const bridgePendingResponseSchema = z.strictObject({
  changes: z.array(bridgePendingChangeSchema),
  /** Pass back as `?cursor=` for the next page; `null` when there is nothing more. */
  next_cursor: z.string().nullable(),
});
export type BridgePendingResponse = z.infer<typeof bridgePendingResponseSchema>;

export const bridgeAckRequestSchema = z.strictObject({
  acks: z
    .array(
      z.strictObject({
        operation_id: operationIdSchema,
        status: z.enum(['ok', 'error']),
        /** Contacts identifier of a contact created by the bridge; required for new contacts. */
        local_id: z.string().min(1).max(256).optional(),
        error: z.string().max(2000).optional(),
      }),
    )
    .max(500),
});
export type BridgeAckRequest = z.infer<typeof bridgeAckRequestSchema>;

export const bridgeAckResponseSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      operation_id: operationIdSchema,
      result: z.enum(['applied', 'error_recorded', 'duplicate', 'unknown', 'rejected']),
    }),
  ),
});
export type BridgeAckResponse = z.infer<typeof bridgeAckResponseSchema>;
