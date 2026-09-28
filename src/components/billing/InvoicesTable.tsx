import React from 'react';
import { FileText, Download, CheckCircle2, Clock, AlertCircle, ExternalLink } from 'lucide-react';
import { Invoice } from '../../types/index';
import { Button } from '../common/UI';

interface InvoicesTableProps {
  invoices: Invoice[];
  loading?: boolean;
}

export const InvoicesTable: React.FC<InvoicesTableProps> = ({ invoices, loading = false }) => {
  if (loading) {
    return (
      <div className="p-8 text-center text-zinc-500 font-mono text-xs">
        Loading invoice transaction history...
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="p-8 text-center rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
        <FileText className="w-8 h-8 text-zinc-600 mx-auto" />
        <div className="text-sm font-semibold text-zinc-300">No Invoices Issued Yet</div>
        <div className="text-xs text-zinc-500 max-w-sm mx-auto">
          Invoices and tax receipts are automatically generated whenever a paid subscription is activated or renewed.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950">
      <table className="w-full text-left font-mono text-xs">
        <thead className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-400">
          <tr>
            <th className="py-3 px-4">Invoice ID</th>
            <th className="py-3 px-4">Billing Date</th>
            <th className="py-3 px-4">Description</th>
            <th className="py-3 px-4">Duration</th>
            <th className="py-3 px-4">Amount</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4 text-right">Receipt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
          {invoices.map((inv) => (
            <tr key={inv.id} className="hover:bg-zinc-900/30 transition-colors">
              <td className="py-3 px-4 font-bold text-sky-400">
                #{inv.id.substring(0, 12)}
              </td>
              <td className="py-3 px-4 text-zinc-400">
                {new Date(inv.issuedAt).toLocaleDateString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </td>
              <td className="py-3 px-4 font-sans font-medium text-zinc-200">
                {inv.description}
              </td>
              <td className="py-3 px-4">
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
                  {inv.billingInterval}
                </span>
              </td>
              <td className="py-3 px-4 font-bold text-zinc-100">
                ₹{inv.amount.toLocaleString('en-IN')}
              </td>
              <td className="py-3 px-4">
                {inv.status === 'PAID' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-400 text-[10px] font-bold">
                    <CheckCircle2 className="w-3 h-3" /> PAID
                  </span>
                ) : inv.status === 'OPEN' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-800 text-amber-400 text-[10px] font-bold">
                    <Clock className="w-3 h-3" /> PENDING
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-bold">
                    {inv.status}
                  </span>
                )}
              </td>
              <td className="py-3 px-4 text-right">
                <a
                  href={`/api/v1/billing/invoices/${inv.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-sky-400 hover:text-sky-300 text-[11px] transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>Invoice</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
