import { CheckCircle2, Download, FileText, Printer, X } from 'lucide-react';
import React from 'react';
import { Invoice } from '../../types/billing';
import { Button, Modal } from '../common/UI';

interface InvoiceReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  orgName?: string;
}

export const InvoiceReceiptModal: React.FC<InvoiceReceiptModalProps> = ({
  isOpen,
  onClose,
  invoice,
  orgName = 'SkyOps Workspace'
}) => {
  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    // Generate text/plain or formatted receipt download
    const receiptContent = `=====================================================
SKYOPS PLATFORM - TAX INVOICE & PAYMENT RECEIPT
=====================================================
Invoice Number: ${invoice.id}
Date of Issue:  ${new Date(invoice.issuedAt).toUTCString()}
Status:         ${invoice.status}
Customer:       ${orgName}
Organization ID:${invoice.organizationId}
Subscription:   ${invoice.subscriptionId}

-----------------------------------------------------
LINE ITEMS:
1. ${invoice.description}
   Amount: INR ₹${invoice.amount.toLocaleString('en-IN')}
   Tax:    GST (Inclusive)
-----------------------------------------------------
TOTAL PAID:     INR ₹${invoice.amount.toLocaleString('en-IN')}
Payment Status: SUCCESS (Settled)
Date Paid:      ${invoice.paidAt ? new Date(invoice.paidAt).toUTCString() : 'N/A'}
Provider Ref:   ${invoice.providerInvoiceId || 'N/A'}

=====================================================
SkyOps Enterprise Autonomous Systems Private Limited
Bengaluru, Karnataka, India
support@skyops.io
=====================================================`;

    const blob = new Blob([receiptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyops_invoice_${invoice.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Tax Invoice: ${invoice.id}`}
      maxWidth="max-w-xl"
    >
      <div className="space-y-6 font-mono text-xs">
        {/* Invoice Header */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
            <div>
              <div className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sky-400" /> SkyOps Cloud Platform
              </div>
              <div className="text-[11px] text-zinc-400">Tax Invoice & Payment Receipt</div>
            </div>
            <div className="text-right">
              <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {invoice.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-[11px] text-zinc-400">
            <div>
              <span className="text-zinc-500 block">Billed To:</span>
              <strong className="text-zinc-200 block text-xs">{orgName}</strong>
              <span>Org ID: {invoice.organizationId.substring(0, 12)}...</span>
            </div>
            <div className="text-right">
              <span className="text-zinc-500 block">Invoice Date:</span>
              <strong className="text-zinc-200 block">
                {new Date(invoice.issuedAt).toLocaleDateString()}
              </strong>
              <span>Ref: {invoice.providerInvoiceId || invoice.id.substring(0, 14)}</span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border-t border-zinc-900 pt-3 space-y-2">
            <div className="flex items-center justify-between font-bold text-zinc-300 border-b border-zinc-900 pb-1.5 text-[11px]">
              <span>Description</span>
              <span>Amount (INR)</span>
            </div>
            <div className="flex items-start justify-between text-zinc-200 py-1">
              <div>
                <div>{invoice.description}</div>
                <div className="text-[10px] text-zinc-500">Plan Tier: {invoice.planId || 'Standard'}</div>
              </div>
              <div className="font-bold">₹{invoice.amount.toLocaleString('en-IN')}</div>
            </div>
            <div className="flex items-center justify-between text-zinc-400 text-[11px] pt-2 border-t border-zinc-900">
              <span>GST (18% Inclusive)</span>
              <span>Included</span>
            </div>
            <div className="flex items-center justify-between text-zinc-100 font-bold text-sm pt-2 border-t border-zinc-900">
              <span>Total Paid</span>
              <span className="text-emerald-400">₹{invoice.amount.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="outline" size="sm" onClick={handleDownload} icon={<Download className="w-3.5 h-3.5" />}>
            Download Receipt (.txt)
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint} icon={<Printer className="w-3.5 h-3.5" />}>
              Print
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
