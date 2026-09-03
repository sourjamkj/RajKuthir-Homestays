import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { adminFetch } from '@/lib/admin-api';
import {
  BOOKINGS_KEY,
  EXPENSES_KEY,
  SUMMARY_KEY,
  SOURCE_LABELS,
  formatRupees,
} from '@/lib/ledger-api';

/**
 * Bulk import of past and offline bookings.
 *
 * The file is turned into raw cell arrays here and validated on the server, so
 * what you see in the preview is exactly what the server decided — not a
 * second, more optimistic opinion from the browser. Nothing is written until
 * "Import" is pressed.
 */

type ParsedRow = {
  rowNumber: number;
  nights: number;
  errors: string[];
  booking: {
    source: keyof typeof SOURCE_LABELS;
    status: string;
    checkIn: string;
    checkOut: string;
    guestName: string | null;
    guests: number | null;
    grossPaise: number | null;
  } | null;
};

type Preview = {
  rows: ParsedRow[];
  unknownColumns: string[];
  validCount: number;
  errorCount: number;
  committed: boolean;
  created?: number;
};

const TEMPLATE_HEADERS = [
  'Check In',
  'Check Out',
  'Guest Name',
  'Phone',
  'Pax',
  'Amount',
  'Commission',
  'Received',
  'Channel',
  'Status',
  'Remarks',
];

const TEMPLATE_EXAMPLE = [
  '02/10/2026',
  '04/10/2026',
  'Ananya Das',
  '9876543210',
  '3',
  '6380',
  '0',
  '6380',
  'Offline',
  'Confirmed',
  'Paid in cash on arrival',
];

/** Splits one CSV line, honouring quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * CSV only, parsed natively. A spreadsheet parser would be a sizeable
 * dependency for something Excel already does with File → Save As → CSV,
 * so the file is read as text and split here.
 */
async function fileToRows(file: File): Promise<unknown[][]> {
  const text = await file.text();

  return text
    .replace(/^\uFEFF/, '') // Excel writes a BOM that would corrupt the first header
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(splitCsvLine);
}

export function BookingImport() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState<string | null>(null);

  const preview = useMutation({
    mutationFn: (payload: { rows: unknown[][]; commit: boolean }) =>
      adminFetch<Preview>('/api/bookings/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      if (result.committed) {
        queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
        queryClient.invalidateQueries({ queryKey: EXPENSES_KEY });
        queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      }
    },
  });

  const choose = async (file: File | undefined) => {
    if (!file) return;

    setReadError(null);
    preview.reset();
    setFileName(file.name);

    try {
      const parsed = await fileToRows(file);

      if (parsed.length === 0) {
        setReadError('That file appears to be empty.');
        setRows(null);
        return;
      }

      setRows(parsed);
      preview.mutate({ rows: parsed, commit: false });
    } catch {
      setReadError(
        'Could not read that file. In Excel use File → Save As → CSV, then upload the .csv.',
      );
      setRows(null);
    }
  };

  const downloadTemplate = () => {
    const csv = [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]
      .map((line) => line.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'raj-kuthir-bookings-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const result = preview.data;
  const errorMessage =
    preview.error instanceof Error ? preview.error.message : null;

  const reset = () => {
    setRows(null);
    setFileName('');
    setReadError(null);
    preview.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-primary">
            <FileSpreadsheet size={15} /> Import from a spreadsheet
          </p>
          <p className="mt-2 max-w-[540px] text-sm leading-6 text-muted-foreground">
            For onboarding past and offline bookings in bulk. In Excel or
            Google Sheets use File → Save As → CSV, then upload it here.
            You'll see exactly what will be created before anything is saved.
          </p>
        </div>

        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-[.08em] text-primary transition-colors hover:border-primary"
          data-testid="button-download-template"
        >
          <Download size={13} /> Template
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => choose(event.target.files?.[0])}
          className="hidden"
          data-testid="input-import-file"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5"
          data-testid="button-choose-file"
        >
          <Upload size={14} /> Choose file
        </button>

        {fileName && (
          <span className="text-xs text-muted-foreground">
            {fileName}
            <button
              type="button"
              onClick={reset}
              className="ml-3 underline underline-offset-2 hover:text-primary"
            >
              clear
            </button>
          </span>
        )}

        {preview.isPending && (
          <Loader2 size={15} className="animate-spin text-primary" />
        )}
      </div>

      {readError && (
        <p className="mt-4 text-sm text-[#A65E45]" role="alert">
          {readError}
        </p>
      )}

      {errorMessage && (
        <p className="mt-4 text-sm text-[#A65E45]" role="alert">
          {errorMessage}
        </p>
      )}

      {result?.committed && (
        <div className="mt-5 rounded-xl border border-[#7A8065]/40 bg-[#7A8065]/10 p-4">
          <p className="text-sm font-semibold text-[#4b5340]">
            Imported {result.created}{' '}
            {result.created === 1 ? 'booking' : 'bookings'}.
          </p>
          {result.errorCount > 0 && (
            <p className="mt-1 text-xs text-[#4b5340]/80">
              {result.errorCount} row{result.errorCount === 1 ? '' : 's'} were
              skipped — fix them in the sheet and import again.
            </p>
          )}
        </div>
      )}

      {result && !result.committed && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-background p-4">
            <p className="text-sm text-foreground">
              <strong className="text-primary">{result.validCount}</strong> ready
              to import
              {result.errorCount > 0 && (
                <>
                  {' · '}
                  <strong className="text-[#A65E45]">
                    {result.errorCount}
                  </strong>{' '}
                  with problems
                </>
              )}
            </p>

            <button
              type="button"
              onClick={() =>
                rows && preview.mutate({ rows, commit: true })
              }
              disabled={result.validCount === 0 || preview.isPending}
              className="ml-auto flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="button-commit-import"
            >
              Import {result.validCount}{' '}
              {result.validCount === 1 ? 'booking' : 'bookings'}
            </button>
          </div>

          {result.unknownColumns.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <CircleAlert size={13} className="mt-0.5 shrink-0" />
              Columns ignored because they weren't recognised:{' '}
              {result.unknownColumns.join(', ')}
            </p>
          )}

          <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-bold">Row</th>
                  <th className="px-4 py-2.5 font-bold">Dates</th>
                  <th className="px-4 py-2.5 font-bold">Guest</th>
                  <th className="px-4 py-2.5 font-bold">Channel</th>
                  <th className="px-4 py-2.5 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={`border-b border-border last:border-0 ${
                      row.booking ? '' : 'bg-[#A65E45]/5'
                    }`}
                    data-testid={`import-row-${row.rowNumber}`}
                  >
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {row.rowNumber}
                    </td>

                    {row.booking ? (
                      <>
                        <td className="px-4 py-2.5 text-foreground">
                          {row.booking.checkIn} → {row.booking.checkOut}
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {row.nights}n
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {row.booking.guestName ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {SOURCE_LABELS[row.booking.source]}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.booking.grossPaise === null
                            ? '—'
                            : formatRupees(row.booking.grossPaise)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="px-4 py-2.5 text-[#A65E45]">
                        {row.errors.join('; ')}
                      </td>
                    )}
                  </tr>
                ))}

                {result.rows
                  .filter((row) => row.booking && row.errors.length > 0)
                  .map((row) => (
                    <tr key={`warn-${row.rowNumber}`} className="bg-[#d8a24a]/5">
                      <td className="px-4 py-2 text-xs text-[#8a6320]">
                        {row.rowNumber}
                      </td>
                      <td colSpan={4} className="px-4 py-2 text-xs text-[#8a6320]">
                        {row.errors.join('; ')}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
