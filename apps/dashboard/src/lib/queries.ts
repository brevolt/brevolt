import { queryOptions } from '@tanstack/react-query';
import { api, type Contact, type HistoryEntry } from './api.js';
import { PAGE_SIZE } from './window.js';

export interface ContactPage {
  contacts: Contact[];
  total: number;
}

export const contactPageQuery = (q: string, page: number) =>
  queryOptions({
    queryKey: ['contacts', 'list', q, page] as const,
    queryFn: async ({ signal }): Promise<ContactPage> => {
      const res = await api.list(q, page * PAGE_SIZE, PAGE_SIZE, signal);
      if (!res) throw new Error('list failed');
      return res;
    },
  });

export const contactQuery = (id: string) =>
  queryOptions({
    queryKey: ['contacts', 'detail', id] as const,
    queryFn: async (): Promise<Contact | null> => {
      const res = await api.get(id);
      if (res.ok) return res.value;
      if (res.status === 404) return null;
      throw new Error('contact failed');
    },
  });

export const historyQuery = (id: string) =>
  queryOptions({
    queryKey: ['contacts', 'history', id] as const,
    queryFn: async (): Promise<HistoryEntry[]> => {
      const res = await api.history(id);
      return res.ok ? res.value.history : [];
    },
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: ['settings'] as const,
    queryFn: async () => {
      const res = await api.settings();
      if (!res.ok) throw new Error('settings failed');
      return res.value;
    },
  });

export const syncQuery = () =>
  queryOptions({
    queryKey: ['sync'] as const,
    queryFn: async () => {
      const res = await api.syncState();
      if (!res.ok) throw new Error('sync failed');
      return res.value;
    },
  });
