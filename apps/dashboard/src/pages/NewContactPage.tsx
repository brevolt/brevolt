import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ContactForm, emptyDraft } from '../components/ContactForm.js';
import { useNotify } from '../components/Toast.js';
import { api, newOperationId, type Draft } from '../lib/api.js';

export function NewContactPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useNotify();

  const create = useMutation({
    mutationFn: async (draft: Draft) => {
      const operationId = newOperationId();
      const res = await api.create(draft, operationId);
      if (!res.ok) throw new Error('create failed');
      return { contact: res.value, operationId };
    },
    onSuccess: async ({ contact, operationId }) => {
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      await navigate({ to: '/contacts/$id', params: { id: contact.id }, search: (p) => p });
      notify('Contact created.', () => {
        void api.undo(operationId).then(async (r) => {
          notify(r.ok ? 'Creation undone.' : 'Could not undo the creation.');
          if (r.ok) {
            await qc.invalidateQueries({ queryKey: ['contacts'] });
            await navigate({ to: '/contacts', search: (p) => p });
          }
        });
      });
    },
    onError: () => {
      notify('Could not create the contact. Check the values and try again.');
    },
  });

  return (
    <section aria-label="New contact" className="mx-auto max-w-3xl p-4 md:p-6">
      <h2 className="mb-4 text-xl font-semibold">New contact</h2>
      <ContactForm
        initial={emptyDraft()}
        saving={create.isPending}
        submitLabel="Create"
        onSubmit={(d) => {
          create.mutate(d);
        }}
        onCancel={() => {
          void navigate({ to: '/contacts', search: (p) => p });
        }}
      />
    </section>
  );
}
