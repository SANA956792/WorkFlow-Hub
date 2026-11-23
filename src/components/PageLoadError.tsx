import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface PageLoadErrorProps {
  title: string;
  message: string;
  retrying?: boolean;
  onRetry: () => void;
  variant?: 'card' | 'banner';
}

export function PageLoadError({
  title,
  message,
  retrying = false,
  onRetry,
  variant = 'card',
}: PageLoadErrorProps) {
  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm"
      >
        <div className="flex items-center gap-2.5 text-slate-800">
          <AlertCircle className="h-4.5 w-4.5 shrink-0 text-[#E85D65]" />
          <div>
            <span className="font-semibold text-slate-900">{title}: </span>
            <span className="text-slate-700">{message}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4776E6] px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          <span>{retrying ? 'Retrying...' : 'Retry'}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-xs"
    >
      <AlertCircle className="mx-auto h-10 w-10 text-[#E85D65]" />
      <h3 className="mt-3 text-base font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#4776E6] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
        <span>{retrying ? 'Retrying...' : 'Retry'}</span>
      </button>
    </div>
  );
}
