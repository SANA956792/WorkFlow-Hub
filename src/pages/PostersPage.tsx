import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  Hash,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Employee, PosterRecord, PosterStatus } from '../types';
import { PosterInput, posterService } from '../services/posterService';
import { uploadFileToStorage } from '../services/storageService';
import { ThreeDotMenu } from '../components/ThreeDotMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatDisplayDate, formatTime12h } from '../utils/dates';
import { getStatusBadgeStyle } from '../utils/colors';
import { safeExternalUrl } from '../utils/urls';

const POSTER_TABS: (PosterStatus | 'All')[] = [
  'All',
  'Pending',
  'Designing',
  'Under Review',
  'Revision Required',
  'Approved',
  'Scheduled',
  'Published',
];

const PLATFORMS = [
  'Instagram',
  'Facebook',
  'LinkedIn',
  'X (Twitter)',
  'YouTube Community',
  'Pinterest',
  'WhatsApp',
  'Other',
];

const TAB_COLORS: Record<string, string> = {
  All: '#E85B9A',
  Pending: '#F29A38',
  Designing: '#16A6C1',
  'Under Review': '#8757D5',
  'Revision Required': '#E85D65',
  Approved: '#20A779',
  Scheduled: '#4776E6',
  Published: '#159D91',
};

interface PostersPageProps {
  posters: PosterRecord[];
  employees: Employee[];
  loading: boolean;
  initialStatusFilter?: PosterStatus | 'All';
  initialSelectedPosterId?: string | null;
  onClearInitialSelection?: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function PostersPage({
  posters,
  employees,
  loading,
  initialStatusFilter,
  initialSelectedPosterId,
  onClearInitialSelection,
  onRefresh,
  onNotify,
}: PostersPageProps) {
  const [activeTab, setActiveTab] = useState<PosterStatus | 'All'>(
    initialStatusFilter || 'All'
  );
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');

  useEffect(() => {
    if (initialStatusFilter) setActiveTab(initialStatusFilter);
  }, [initialStatusFilter]);

  // Form Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingPoster, setEditingPoster] = useState<PosterRecord | null>(null);
  const [posterCode, setPosterCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [imageFileId, setImageFileId] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [assignedDesignerId, setAssignedDesignerId] = useState('');
  const [assignedWriterId, setAssignedWriterId] = useState('');
  const [platform, setPlatform] = useState('Instagram');
  const [designDeadline, setDesignDeadline] = useState('');
  const [publishingDate, setPublishingDate] = useState('');
  const [publishingTime, setPublishingTime] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [referenceLinksText, setReferenceLinksText] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<PosterStatus>('Pending');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail Modal
  const [detailPoster, setDetailPoster] = useState<PosterRecord | null>(null);

  // Quick Status Modal
  const [statusModalPoster, setStatusModalPoster] = useState<PosterRecord | null>(
    null
  );
  const [statusUpdating, setStatusUpdating] = useState(false);

  // Delete Modal
  const [deleteTarget, setDeleteTarget] = useState<PosterRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (initialSelectedPosterId) {
      const found = posters.find((p) => p.id === initialSelectedPosterId);
      if (found) setDetailPoster(found);
      onClearInitialSelection?.();
    }
  }, [initialSelectedPosterId, posters]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: posters.length };
    for (const tab of POSTER_TABS) {
      if (tab !== 'All') {
        counts[tab] = posters.filter((p) => p.status === tab).length;
      }
    }
    return counts;
  }, [posters]);

  const filteredPosters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posters.filter((p) => {
      if (activeTab !== 'All' && p.status !== activeTab) return false;
      if (platformFilter !== 'All' && p.platform !== platformFilter) return false;
      if (
        employeeFilter !== 'All' &&
        p.assignedDesignerId !== employeeFilter &&
        p.assignedWriterId !== employeeFilter
      ) {
        return false;
      }
      if (
        dateFilter &&
        p.publishingDate !== dateFilter &&
        p.designDeadline !== dateFilter
      ) {
        return false;
      }
      if (q) {
        const people = `${p.assignedDesigner?.fullName || ''} ${
          p.assignedWriter?.fullName || ''
        }`;
        const hay = `${p.posterCode} ${p.title} ${p.campaignName} ${p.platform} ${people}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [posters, activeTab, platformFilter, employeeFilter, dateFilter, search]);

  const openCreateModal = () => {
    setEditingPoster(null);
    setPosterCode('');
    setTitle('');
    setDescription('');
    setCampaignName('');
    setImageFileId(null);
    setImagePreviewUrl(null);
    setAssignedDesignerId('');
    setAssignedWriterId('');
    setPlatform('Instagram');
    setDesignDeadline('');
    setPublishingDate('');
    setPublishingTime('');
    setCaption('');
    setHashtags('');
    setReferenceLinksText('');
    setNotes('');
    setStatus('Pending');
    setUploadProgress(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (p: PosterRecord) => {
    setEditingPoster(p);
    setPosterCode(p.posterCode);
    setTitle(p.title);
    setDescription(p.description);
    setCampaignName(p.campaignName);
    setImageFileId(p.imageFileId);
    setImagePreviewUrl(p.imageUrl);
    setAssignedDesignerId(p.assignedDesignerId || '');
    setAssignedWriterId(p.assignedWriterId || '');
    setPlatform(p.platform);
    setDesignDeadline(p.designDeadline || '');
    setPublishingDate(p.publishingDate || '');
    setPublishingTime(p.publishingTime || '');
    setCaption(p.caption);
    setHashtags(p.hashtags);
    setReferenceLinksText(p.referenceLinks.join('\n'));
    setNotes(p.notes);
    setStatus(p.status);
    setUploadProgress(null);
    setFormError(null);
    setFormOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadProgress(0);
    setFormError(null);
    try {
      const uploaded = await uploadFileToStorage('poster-images', file, (pct) =>
        setUploadProgress(pct)
      );
      setImageFileId(uploaded.fileId);
      setImagePreviewUrl(uploaded.url);
    } catch (err: any) {
      setFormError(err.message || 'Failed to upload poster image.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSavePoster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploadProgress !== null) return;
    if (!title.trim()) {
      setFormError('Poster title is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const referenceLinks = referenceLinksText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: PosterInput = {
        posterCode: posterCode.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
        campaignName: campaignName.trim(),
        imageFileId,
        assignedDesignerId: assignedDesignerId || null,
        assignedWriterId: assignedWriterId || null,
        platform,
        designDeadline: designDeadline || null,
        publishingDate: publishingDate || null,
        publishingTime: publishingTime || null,
        caption: caption.trim(),
        hashtags: hashtags.trim(),
        referenceLinks,
        notes: notes.trim(),
        status,
      };

      if (editingPoster) {
        const updated = await posterService.update(editingPoster.id, payload);
        if (detailPoster?.id === editingPoster.id) setDetailPoster(updated);
        onNotify('success', `Updated poster "${title.trim()}"`);
      } else {
        await posterService.create(payload);
        onNotify('success', `Created poster "${title.trim()}"`);
      }

      setFormOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save poster.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    p: PosterRecord,
    nextStatus: PosterStatus
  ) => {
    if (statusUpdating) return;
    setStatusUpdating(true);
    try {
      const updated = await posterService.update(p.id, { status: nextStatus });
      if (detailPoster?.id === p.id) setDetailPoster(updated);
      setStatusModalPoster(null);
      onNotify('success', `Poster status updated to ${nextStatus}`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update poster status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await posterService.remove(deleteTarget.id);
      if (detailPoster?.id === deleteTarget.id) setDetailPoster(null);
      onNotify('success', `Deleted poster "${deleteTarget.title}"`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to delete poster.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Posters
          </h1>
          <p className="text-sm text-slate-500">
            Design tracking, artwork previews, captions, and publishing schedules
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#E85B9A] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Add Poster</span>
        </button>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {POSTER_TABS.map((tab) => {
          const active = activeTab === tab;
          const activeBg = TAB_COLORS[tab] || '#E85B9A';
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={active ? { backgroundColor: activeBg } : undefined}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{tab}</span>
              <span
                className={`tabular-nums rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {tabCounts[tab] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posters or campaigns..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-10 text-sm focus:border-[#E85B9A] focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#E85B9A] focus:outline-none"
        >
          <option value="All">All Employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </select>

        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#E85B9A] focus:outline-none"
        >
          <option value="All">All Platforms</option>
          {PLATFORMS.map((pl) => (
            <option key={pl} value={pl}>
              {pl}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#E85B9A] focus:outline-none"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Poster Cards Grid */}
      {loading && posters.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-200" />
          ))}
        </div>
      ) : filteredPosters.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E85B9A]/10 text-[#E85B9A]">
            <ImageIcon className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-900">
            {posters.length === 0 ? 'No posters yet' : 'No matching posters'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {posters.length === 0
              ? 'Upload poster artwork, assign designers, and schedule publishing times.'
              : 'Try adjusting your status tab or filters.'}
          </p>
          {posters.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 rounded-xl bg-[#E85B9A] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Create First Poster
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPosters.map((p) => {
            const statusStyle = getStatusBadgeStyle(p.status);
            return (
              <div
                key={p.id}
                onClick={() => setDetailPoster(p)}
                className="flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs transition-shadow hover:shadow-md"
              >
                {/* Image Preview */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 text-slate-400">
                      <ImageIcon className="h-8 w-8 text-[#E85B9A]/60" />
                      <span className="text-xs font-medium text-slate-500">
                        No artwork uploaded yet
                      </span>
                    </div>
                  )}
                  <span
                    style={{
                      backgroundColor: statusStyle.bg,
                      color: statusStyle.text,
                      borderColor: statusStyle.border,
                    }}
                    className="absolute top-3 left-3 rounded-lg border px-2.5 py-1 text-xs font-bold shadow-xs"
                  >
                    {p.status}
                  </span>
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-400">
                          {p.posterCode}
                        </span>
                        <span>·</span>
                        <span className="font-semibold text-[#8757D5]">
                          {p.platform}
                        </span>
                      </div>
                      <h3 className="mt-1 truncate text-base font-bold text-slate-900">
                        {p.title}
                      </h3>
                      {p.campaignName && (
                        <p className="truncate text-xs text-slate-500">
                          Campaign: {p.campaignName}
                        </p>
                      )}
                    </div>

                    <ThreeDotMenu
                      actions={[
                        {
                          label: 'View Poster',
                          icon: <Eye className="h-4 w-4" />,
                          onClick: () => setDetailPoster(p),
                        },
                        {
                          label: 'Edit Poster',
                          icon: <Edit3 className="h-4 w-4" />,
                          onClick: () => openEditModal(p),
                        },
                        {
                          label: 'Change Status',
                          icon: <RefreshCw className="h-4 w-4" />,
                          onClick: () => setStatusModalPoster(p),
                        },
                        {
                          label: 'Delete Poster',
                          icon: <Trash2 className="h-4 w-4" />,
                          danger: true,
                          onClick: () => setDeleteTarget(p),
                        },
                      ]}
                    />
                  </div>

                  <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Designer:</span>
                      <span className="truncate font-semibold text-slate-800">
                        {p.assignedDesigner?.fullName || 'Unassigned'}
                      </span>
                    </div>
                    {p.designDeadline && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Design Due:</span>
                        <span className="tabular-nums font-medium">
                          {formatDisplayDate(p.designDeadline)}
                        </span>
                      </div>
                    )}
                    {p.publishingDate && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Publish:</span>
                        <span className="tabular-nums font-semibold text-[#8757D5]">
                          {formatDisplayDate(p.publishingDate)}
                          {p.publishingTime
                            ? ` · ${formatTime12h(p.publishingTime)}`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                {editingPoster ? 'Edit Poster' : 'Add New Poster'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSavePoster} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[#E85D65]">
                  {formError}
                </div>
              )}

              {/* Image Upload & Preview */}
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {imagePreviewUrl ? (
                      <img
                        src={imagePreviewUrl}
                        alt="Poster preview"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-7 w-7 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadProgress !== null}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#E85B9A] px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>
                        {uploadProgress !== null
                          ? `Uploading (${uploadProgress}%)`
                          : imagePreviewUrl
                          ? 'Replace Poster Image'
                          : 'Upload Poster Image'}
                      </span>
                    </button>
                    <p className="mt-1.5 text-xs text-slate-500">
                      Stored permanently in database storage (PNG, JPG, WEBP up to 10 MB)
                    </p>
                    {uploadProgress !== null && (
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          style={{ width: `${uploadProgress}%` }}
                          className="h-full bg-[#E85B9A] transition-all"
                        />
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Poster Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Summer Launch Carousel"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Poster ID
                  </label>
                  <input
                    type="text"
                    value={posterCode}
                    onChange={(e) => setPosterCode(e.target.value)}
                    placeholder="Auto if blank"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Campaign Name
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. Festive Sale"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  >
                    {PLATFORMS.map((pl) => (
                      <option key={pl} value={pl}>
                        {pl}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PosterStatus)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  >
                    {POSTER_TABS.filter((t) => t !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Assigned Designer
                  </label>
                  <select
                    value={assignedDesignerId}
                    onChange={(e) => setAssignedDesignerId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.designation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Assigned Content Writer (Optional)
                  </label>
                  <select
                    value={assignedWriterId}
                    onChange={(e) => setAssignedWriterId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  >
                    <option value="">None</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.designation})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Design Deadline
                  </label>
                  <input
                    type="date"
                    value={designDeadline}
                    onChange={(e) => setDesignDeadline(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Publishing Date
                  </label>
                  <input
                    type="date"
                    value={publishingDate}
                    onChange={(e) => setPublishingDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Publishing Time
                  </label>
                  <input
                    type="time"
                    value={publishingTime}
                    onChange={(e) => setPublishingTime(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Visual direction, copy brief, dimensions..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Caption
                  </label>
                  <textarea
                    rows={3}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Social media caption..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Hashtags
                  </label>
                  <textarea
                    rows={3}
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#brand #launch #design"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Reference Links (one per line)
                  </label>
                  <textarea
                    rows={2}
                    value={referenceLinksText}
                    onChange={(e) => setReferenceLinksText(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Notes
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Review or publishing notes..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#E85B9A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadProgress !== null}
                  className="rounded-xl bg-[#E85B9A] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving
                    ? 'Saving...'
                    : editingPoster
                    ? 'Save Changes'
                    : 'Create Poster'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Poster Detail Modal */}
      {detailPoster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="font-mono text-xs font-semibold text-slate-400">
                  {detailPoster.posterCode} · {detailPoster.platform}
                </span>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {detailPoster.title}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = detailPoster;
                    setDetailPoster(null);
                    openEditModal(target);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailPoster(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {detailPoster.imageUrl ? (
                  <img
                    src={detailPoster.imageUrl}
                    alt={detailPoster.title}
                    referrerPolicy="no-referrer"
                    className="h-auto max-h-[420px] w-full object-contain"
                  />
                ) : (
                  <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
                    <ImageIcon className="h-10 w-10" />
                    <span className="text-xs">No poster image uploaded</span>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Status</span>
                  <select
                    value={detailPoster.status}
                    disabled={statusUpdating}
                    onChange={(e) =>
                      handleQuickStatusChange(
                        detailPoster,
                        e.target.value as PosterStatus
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                  >
                    {POSTER_TABS.filter((t) => t !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                {detailPoster.campaignName && (
                  <div className="text-sm">
                    <span className="font-semibold text-slate-500">Campaign: </span>
                    <span className="font-bold text-slate-900">
                      {detailPoster.campaignName}
                    </span>
                  </div>
                )}

                <div className="space-y-2 rounded-xl bg-slate-50 p-3.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Designer:</span>
                    <span className="font-semibold text-slate-900">
                      {detailPoster.assignedDesigner?.fullName || 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Content Writer:</span>
                    <span className="font-semibold text-slate-900">
                      {detailPoster.assignedWriter?.fullName || 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Design Deadline:</span>
                    <span className="tabular-nums font-semibold text-slate-900">
                      {formatDisplayDate(detailPoster.designDeadline)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Publishing Schedule:</span>
                    <span className="tabular-nums font-semibold text-[#8757D5]">
                      {detailPoster.publishingDate
                        ? `${formatDisplayDate(detailPoster.publishingDate)}${
                            detailPoster.publishingTime
                              ? ` at ${formatTime12h(detailPoster.publishingTime)}`
                              : ''
                          }`
                        : 'Not scheduled'}
                    </span>
                  </div>
                </div>

                {detailPoster.description && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">
                      Description
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                      {detailPoster.description}
                    </p>
                  </div>
                )}

                {detailPoster.caption && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">Caption</div>
                    <p className="mt-1 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                      {detailPoster.caption}
                    </p>
                  </div>
                )}

                {detailPoster.hashtags && (
                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                      <Hash className="h-3.5 w-3.5" />
                      <span>Hashtags</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-[#4776E6]">
                      {detailPoster.hashtags}
                    </p>
                  </div>
                )}

                {detailPoster.notes && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">Notes</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                      {detailPoster.notes}
                    </p>
                  </div>
                )}

                {detailPoster.referenceLinks.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">
                      Reference Links
                    </div>
                    <div className="mt-1 space-y-1">
                      {detailPoster.referenceLinks.map((lnk, i) => {
                        const safeHref = safeExternalUrl(lnk);
                        return safeHref ? (
                          <a
                            key={i}
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#4776E6] hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>{lnk}</span>
                          </a>
                        ) : (
                          <span key={i} className="block text-xs text-slate-500">
                            {lnk}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Status Modal */}
      {statusModalPoster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Change Poster Status
              </h3>
              <button
                type="button"
                onClick={() => setStatusModalPoster(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {statusModalPoster.title}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {POSTER_TABS.filter((t) => t !== 'All').map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={statusUpdating}
                  onClick={() =>
                    handleQuickStatusChange(statusModalPoster, st as PosterStatus)
                  }
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                    statusModalPoster.status === st
                      ? 'border-[#E85B9A] bg-[#E85B9A]/10 text-[#E85B9A]'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{st}</span>
                  {statusModalPoster.status === st && (
                    <span className="text-xs font-bold">Current</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        message="This will permanently delete the poster record and its uploaded artwork."
        confirmLabel="Delete Poster"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
