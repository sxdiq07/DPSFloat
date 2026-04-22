"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { updateFirmLetterhead } from "../_actions/firm";

type Props = {
  firmName: string;
  frn: string | null;
  partnerName: string | null;
  partnerMno: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  canManage: boolean;
};

export function FirmLetterhead({
  firmName,
  frn,
  partnerName,
  partnerMno,
  bankName,
  bankAccountName,
  bankAccountNumber,
  bankIfsc,
  upiId,
  canManage,
}: Props) {
  const [frnValue, setFrn] = useState(frn ?? "");
  const [partnerValue, setPartner] = useState(partnerName ?? "");
  const [mnoValue, setMno] = useState(partnerMno ?? "");
  const [bankNameV, setBankName] = useState(bankName ?? "");
  const [bankAccName, setBankAccName] = useState(bankAccountName ?? "");
  const [bankAccNo, setBankAccNo] = useState(bankAccountNumber ?? "");
  const [ifsc, setIfsc] = useState(bankIfsc ?? "");
  const [upi, setUpi] = useState(upiId ?? "");
  const [pending, startPending] = useTransition();

  const dirty =
    frnValue !== (frn ?? "") ||
    partnerValue !== (partnerName ?? "") ||
    mnoValue !== (partnerMno ?? "") ||
    bankNameV !== (bankName ?? "") ||
    bankAccName !== (bankAccountName ?? "") ||
    bankAccNo !== (bankAccountNumber ?? "") ||
    ifsc !== (bankIfsc ?? "") ||
    upi !== (upiId ?? "");

  const onSave = () => {
    startPending(async () => {
      const r = await updateFirmLetterhead({
        frn: frnValue,
        partnerName: partnerValue,
        partnerMno: mnoValue,
        bankName: bankNameV,
        bankAccountName: bankAccName,
        bankAccountNumber: bankAccNo,
        bankIfsc: ifsc,
        upiId: upi,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Letterhead updated.");
    });
  };

  return (
    <section className="card-apple p-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">
            Ledger-statement letterhead
          </h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Shown on the signatory block of every ledger-statement PDF
            attached to reminder emails.
          </p>
        </div>
        {!canManage && (
          <span className="pill" style={{ background: "rgba(255,159,10,0.14)", color: "#9c5700" }}>
            partners only
          </span>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field
          label="Firm name"
          value={firmName}
          readOnly
          help="Change the firm record in Prisma to rename. Not editable here."
        />
        <Field
          label="FRN (Firm Registration Number)"
          value={frnValue}
          onChange={setFrn}
          placeholder="e.g. 001234N"
          disabled={!canManage}
          help="ICAI firm registration. Appears under firm name on the PDF."
        />
        <Field
          label="Signing partner name"
          value={partnerValue}
          onChange={setPartner}
          placeholder="e.g. CA Ramesh Sharma"
          disabled={!canManage}
          help="Signs the ledger statements."
        />
        <Field
          label="Partner M.No. (ICAI membership)"
          value={mnoValue}
          onChange={setMno}
          placeholder="e.g. 123456"
          disabled={!canManage}
          help="Membership number shown under the partner name."
        />
      </div>

      <div className="mt-8 border-t border-subtle pt-6">
        <h3 className="text-[14px] font-semibold text-ink">Bank + UPI (for "Pay us" block)</h3>
        <p className="mt-1 text-[12.5px] text-ink-3">
          Shown inside every reminder email and ledger PDF so debtors can
          pay inline. UPI id generates a scan-to-pay QR automatically.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field
            label="Bank name"
            value={bankNameV}
            onChange={setBankName}
            placeholder="e.g. HDFC Bank"
            disabled={!canManage}
          />
          <Field
            label="Account name (beneficiary)"
            value={bankAccName}
            onChange={setBankAccName}
            placeholder="e.g. DPS & Co"
            disabled={!canManage}
          />
          <Field
            label="Account number"
            value={bankAccNo}
            onChange={setBankAccNo}
            placeholder="e.g. 5021 2345 6789"
            disabled={!canManage}
          />
          <Field
            label="IFSC"
            value={ifsc}
            onChange={setIfsc}
            placeholder="e.g. HDFC0001234"
            disabled={!canManage}
          />
          <Field
            label="UPI id (VPA)"
            value={upi}
            onChange={setUpi}
            placeholder="e.g. dpsandco@hdfcbank"
            disabled={!canManage}
            help="Drives the scan-to-pay QR on every reminder + PDF."
          />
        </div>
      </div>

      {canManage && (
        <div className="mt-6 flex items-center justify-end gap-3">
          {dirty && (
            <span className="text-[12px] text-ink-3">Unsaved changes</span>
          )}
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={onSave}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[13px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {pending ? "Saving..." : "Save letterhead"}
          </button>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  disabled,
  placeholder,
  help,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  help?: string;
}) {
  return (
    <div>
      <label className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
      </label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1.5 block w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-[14px] text-ink placeholder:text-ink-3 focus:border-[var(--color-border-hair)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 read-only:opacity-70"
      />
      {help && <p className="mt-1.5 text-[11.5px] text-ink-3">{help}</p>}
    </div>
  );
}
