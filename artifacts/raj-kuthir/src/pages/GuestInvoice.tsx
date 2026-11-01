import { useEffect, useState } from 'react';
import { DownloadIcon, SpinnerIcon } from '@/components/icons';

/**
 * A guest's invoice, opened from the private link the owner sends on
 * WhatsApp. The token is in the URL fragment — never sent to a server log —
 * and is exchanged for the PDF over POST.
 */
export default function GuestInvoice() {
  const [state, setState] = useState<{ url: string; name: string } | { error: string } | null>(null);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, '');
    if (!token) {
      setState({ error: 'This invoice link is incomplete. Please ask us for a new one.' });
      return;
    }
    void (async () => {
      try {
        const response = await fetch('/api/invoice/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setState({ error: body.error ?? 'This invoice link is not valid. Please ask us for a new one.' });
          return;
        }
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'Invoice.pdf';
        setState({ url: URL.createObjectURL(await response.blob()), name });
      } catch {
        setState({ error: 'Could not load the invoice. Please check your connection and try again.' });
      }
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[860px] flex-col gap-5 bg-background px-4 py-8 text-foreground">
      <header>
        <p className="text-[13px] font-medium text-accent">Raj Kuthir Homestays – Sobuj Potro</p>
        <h1 className="mt-1 font-journal text-3xl text-primary">Your invoice</h1>
      </header>
      {state === null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><SpinnerIcon className="animate-spin" /> Loading…</p>
      )}
      {state && 'error' in state && <p className="text-sm text-terracotta" role="alert">{state.error}</p>}
      {state && 'url' in state && (
        <>
          <a
            href={state.url}
            download={state.name}
            className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <DownloadIcon /> Download invoice
          </a>
          <object data={state.url} type="application/pdf" className="h-[75vh] w-full rounded-xl border border-border" aria-label="Invoice">
            <p className="text-sm text-muted-foreground">Your browser cannot show the PDF here. Use Download invoice above.</p>
          </object>
        </>
      )}
    </main>
  );
}
