import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ThreeDotMenuProps {
  actions: MenuAction[];
  ariaLabel?: string;
}

export function ThreeDotMenu({
  actions,
  ariaLabel = 'Open actions menu',
}: ThreeDotMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4776E6]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-48 origin-top-right rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg"
        >
          {actions.map((action, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium transition-colors ${
                action.danger
                  ? 'text-[#E85D65] hover:bg-rose-50'
                  : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
              }`}
            >
              {action.icon && <span className="shrink-0">{action.icon}</span>}
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
