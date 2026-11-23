export const PALETTE = {
  blue: '#4776E6',
  purple: '#8757D5',
  pink: '#E85B9A',
  green: '#20A779',
  orange: '#F29A38',
  red: '#E85D65',
  cyan: '#16A6C1',
  teal: '#159D91',
  background: '#F5F7FB',
};

const AVATAR_COLORS = [
  '#4776E6',
  '#8757D5',
  '#E85B9A',
  '#20A779',
  '#F29A38',
  '#16A6C1',
  '#159D91',
  '#E85D65',
];

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getStatusBadgeStyle(status: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'Pending':
      return { bg: '#FFF4E5', text: '#B45309', border: '#FCD34D' };
    case 'In Progress':
    case 'Designing':
    case 'Editing':
      return { bg: '#E6F7FA', text: '#0E7490', border: '#A5F3FC' };
    case 'Under Review':
      return { bg: '#F3EEFF', text: '#6D28D9', border: '#DDD6FE' };
    case 'Revision Required':
      return { bg: '#FEECEF', text: '#BE123C', border: '#FECDD3' };
    case 'Approved':
      return { bg: '#E8F7F2', text: '#047857', border: '#A7F3D0' };
    case 'Scheduled':
      return { bg: '#EEF2FF', text: '#3730A3', border: '#C7D2FE' };
    case 'Completed':
    case 'Published':
      return { bg: '#E6F6F0', text: '#065F46', border: '#A7F3D0' };
    case 'Cancelled':
      return { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
    default:
      return { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' };
  }
}

export function getPriorityBadgeStyle(priority: string): {
  bg: string;
  text: string;
} {
  switch (priority) {
    case 'Urgent':
      return { bg: '#E85D65', text: '#FFFFFF' };
    case 'High':
      return { bg: '#F29A38', text: '#FFFFFF' };
    case 'Medium':
      return { bg: '#4776E6', text: '#FFFFFF' };
    case 'Low':
    default:
      return { bg: '#16A6C1', text: '#FFFFFF' };
  }
}

export function getCalendarEventColor(eventType: string): string {
  switch (eventType) {
    case 'task_deadline':
      return '#4776E6'; // Blue
    case 'poster_design_deadline':
      return '#E85B9A'; // Pink
    case 'poster_publishing':
      return '#8757D5'; // Purple
    case 'reel_editing_deadline':
      return '#F29A38'; // Orange
    case 'reel_publishing':
      return '#159D91'; // Teal
    default:
      return '#4776E6';
  }
}
