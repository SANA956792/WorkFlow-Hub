import React, { useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Image as ImageIcon,
  LayoutDashboard,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import { CompanySettings, NavSection } from '../types';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  settings: CompanySettings | null;
  onUploadLogo: (file: File) => Promise<void>;
  counts: { employees: number; tasks: number; posters: number; reels: number };
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: '#4776E6' },
  { id: 'employees', label: 'Employees', icon: Users, color: '#4776E6' },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare, color: '#8757D5' },
  { id: 'posters', label: 'Posters', icon: ImageIcon, color: '#E85B9A' },
  { id: 'reels', label: 'Reels', icon: Video, color: '#159D91' },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon, color: '#16A6C1' },
];

export function Sidebar({ activeSection, onSelectSection, settings, onUploadLogo, counts, mobileOpen, onCloseMobile }: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    try { await onUploadLogo(file); } finally { setUploadingLogo(false); }
  };

  const getBadgeCount = (id: NavSection): number | null => {
    if (id === 'employees') return counts.employees;
    if (id === 'tasks') return counts.tasks;
    if (id === 'posters') return counts.posters;
    if (id === 'reels') return counts.reels;
    return null;
  };

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-slate-200/90 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1">
            {settings?.logoUrl ? <img src={settings.logoUrl} alt="Company Logo" referrerPolicy="no-referrer" className="h-full w-full object-contain" /> : <span className="text-sm font-bold text-[#4776E6]">WO</span>}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold tracking-tight text-slate-900">{settings?.companyName || 'WORK ORGANIZER'}</div>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo} className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[#4776E6] hover:underline disabled:opacity-50">
              <Upload className="h-3 w-3" /><span>{uploadingLogo ? 'Uploading...' : 'Change logo'}</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={handleLogoFileChange} />
          </div>
        </div>
        <button type="button" onClick={onCloseMobile} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" /></button>
      </div>
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3.5 py-5" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const badge = getBadgeCount(item.id);
          return <button key={item.id} type="button" onClick={() => { onSelectSection(item.id); onCloseMobile(); }} style={active ? { backgroundColor: item.color } : undefined}
            className={`flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${active ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}>
            <span className="flex items-center gap-3"><Icon className={`h-4.5 w-4.5 shrink-0 ${active ? 'text-white' : 'text-slate-500'}`} /><span>{item.label}</span></span>
            {badge !== null && badge > 0 && <span className={`rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>{badge}</span>}
          </button>;
        })}
      </nav>
    </div>
  );

  return <>
    <aside className="hidden w-64 shrink-0 lg:block">{sidebarContent}</aside>
    {mobileOpen && <div className="fixed inset-0 z-50 flex lg:hidden"><div className="fixed inset-0 bg-slate-900/40" onClick={onCloseMobile} /><aside className="relative z-10 w-68 max-w-[85vw]">{sidebarContent}</aside></div>}
  </>;
}
