import React, { FormEvent, useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { CompanySettings } from '../types';
import { settingsService } from '../services/settingsService';
import { apiRequest } from '../services/apiClient';

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState<CompanySettings | null>(null);

  useEffect(() => {
    let active = true;
    void settingsService.getSettings().then((value) => { if (active) setSettings(value); }).catch(() => undefined);
    void apiRequest<unknown>('/api/access', { method: 'POST' })
      .then(() => { if (active) setStatus('unlocked'); })
      .catch(() => { if (active) setStatus('locked'); });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiRequest<unknown>('/api/access', {
        method: 'POST',
        headers: { 'X-Company-Access-Code': code },
      });
      setCode('');
      setStatus('unlocked');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to verify the access code.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'unlocked') return <>{children}</>;
  if (status === 'checking') return <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB] text-sm font-semibold text-slate-600">Loading WORK ORGANIZER...</div>;

  return <main className="flex min-h-screen items-center justify-center bg-[#F5F7FB] p-4">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
          <img src={settings?.logoUrl || '/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg'} alt="Company Logo" className="h-full w-full object-contain" />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">{settings?.companyName || 'WORK ORGANIZER'}</h1>
        <p className="mt-2 text-sm text-slate-500">Enter your company access code to open the workspace.</p>
      </div>
      <label htmlFor="company-access-code" className="mt-6 block text-sm font-semibold text-slate-700">Company access code</label>
      <input id="company-access-code" type="password" autoComplete="current-password" required value={code} onChange={(event) => setCode(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#4776E6] focus:ring-2 focus:ring-blue-100" />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={submitting || !code} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#4776E6] px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
        <LockKeyhole className="h-4 w-4" />{submitting ? 'Verifying...' : 'Open workspace'}
      </button>
    </form>
  </main>;
}
