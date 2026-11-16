import type { Server } from "node:http";
export const TEST_TOKEN: string;
export const SYNTHETIC_PATCH: Record<string, unknown>;
export function createTestServer(): Server;
export function listen(server: Server, port?: number, host?: string): Promise<number>;
