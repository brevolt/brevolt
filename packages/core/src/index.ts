export const PACKAGE_NAME = '@brevolt/core';
// Domain types are inferred from the Zod schemas in @brevolt/contracts (single source of truth).
export type {
  Contact,
  ContactField,
  ContactFieldKind,
  ContactSnapshot,
  ContactTag,
  CustomField,
  ExternalLink,
  ExternalSystem,
  SyncBase,
  Tag,
  UuidV7,
} from '@brevolt/contracts';
export * from './normalize/index.js';
export * from './merge/index.js';
