import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Edit3,
  ExternalLink,
  Eye,
  Film,
  Hash,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { Employee, ReelRecord, ReelStatus } from '../types';
import { ReelInput, reelService } from '../services/reelService';
import { uploadFileToStorage } from '../services/storageService';
import { ThreeDotMenu } from '../components/ThreeDotMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageLoadError } from '../components/PageLoadError';
import { formatDisplayDate, formatTime12h } from '../utils/dates';
import { getStatusBadgeStyle } from '../utils/colors';
import { safeExternalUrl } from '../utils/urls';

const REEL_TABS: (ReelStatus | 'All')[] = [
  'All',
  'Pending',
  'Editing',
  'Under Review',
  'Revision Required',
  'Approved',
  'Scheduled',
  'Published',
];

const PLATFORMS = [
  'Instagram Reels',
  'YouTube Shorts',
  'TikTok',
  'Facebook Reels',
  'LinkedIn Video',
  'Other',
];

const TAB_COLORS: Record<string, string> = {
  All: '#159D91',
  Pending: '#F29A38',
  Editing: '#16A6C1',
  'Under Review': '#8757D5',
  'Revision Required': '#E85D65',
  Approved: '#20A779',
  Scheduled: '#4776E6',
  Published: '#159D91',
};

interface ReelsPageProps {
  reels: ReelRecord[];
  employees: Employee[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  initialStatusFilter?: ReelStatus | 'All';
  initialSelectedReelId?: string | null;
  onClearInitialSelection?: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function ReelsPage({
  reels,
  employees,
  loading,
  loaded,
  error,
  onRetry,
  initialStatusFilter,
  initialSelectedReelId,
  onClearInitialSelection,
  onRefresh,
  onNotify,
}: ReelsPageProps) {
  const [activeTab, setActiveTab] = useState<ReelStatus | 'All'>(
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
  const [editingReel, setEditingReel] = useState<ReelRecord | null>(null);
  const [reelCode, setReelCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [referenceVideoFileId, setReferenceVideoFileId] = useState<string | null>(
    null
  );
  const [referenceVideoPreviewUrl, setReferenceVideoPreviewUrl] = useState<
    string | null
  >(null);
  const [referenceVideoLink, setReferenceVideoLink] = useState('');
  const [finalVideoFileId, setFinalVideoFileId] = useState<string | null>(null);
  const [finalVideoPreviewUrl, setFinalVideoPreviewUrl] = useState<
    string | null
  >(null);
  const [assignedEditorId, setAssignedEditorId] = useState('');
  const [assignedCreatorId, setAssignedCreatorId] = useState('');
  const [platform, setPlatform] = useState('Instagram Reels');
  const [editingDeadline, setEditingDeadline] = useState('');
  const [publishingDate, setPublishingDate] = useState('');
  const [publishingTime, setPublishingTime] = useState('');
  const [script, setScript] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [referenceLinksText, setReferenceLinksText] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<ReelStatus>('Pending');

  const [refUploadProgress, setRefUploadProgress] = useState<number | null>(null);
  const [finalUploadProgress, setFinalUploadProgress] = useState<number | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const refVideoInputRef = useRef<HTMLInputElement>(null);
  const finalVideoInputRef = useRef<HTMLInputElement>(null);

  // Detail Modal
  const [detailReel, setDetailReel] = useState<ReelRecord | null>(null);

  // Quick Status Modal
  const [statusModalReel, setStatusModalReel] = useState<ReelRecord | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // Delete Modal
  const [deleteTarget, setDeleteTarget] = useState<ReelRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (initialSelectedReelId) {
      const found = reels.find((r) => r.id === initialSelectedReelId);
      if (found) setDetailReel(found);
      onClearInitialSelection?.();
    }
  }, [initialSelectedReelId, reels]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: reels.length };
    for (const tab of REEL_TABS) {
      if (tab !== 'All') {
        counts[tab] = reels.filter((r) => r.status === tab).length;
      }
    }
    return counts;
  }, [reels]);

  const filteredReels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reels.filter((r) => {
      if (activeTab !== 'All' && r.status !== activeTab) return false;
      if (platformFilter !== 'All' && r.platform !== platformFilter) return false;
      if (
        employeeFilter !== 'All' &&
        r.assignedEditorId !== employeeFilter &&
        r.assignedCreatorId !== employeeFilter
      ) {
        return false;
      }
      if (
        dateFilter &&
        r.publishingDate !== dateFilter &&
        r.editingDeadline !== dateFilter
      ) {
        return false;
      }
      if (q) {
        const people = `${r.assignedEditor?.fullName || ''} ${
          r.assignedCreator?.fullName || ''
        }`;
        const hay = `${r.reelCode} ${r.title} ${r.campaignName} ${r.platform} ${people}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reels, activeTab, platformFilter, employeeFilter, dateFilter, search]);

  const openCreateModal = () => {
    setEditingReel(null);
    setReelCode('');
    setTitle('');
    setDescription('');
    setCampaignName('');
    setReferenceVideoFileId(null);
    setReferenceVideoPreviewUrl(null);
    setReferenceVideoLink('');
    setFinalVideoFileId(null);
    setFinalVideoPreviewUrl(null);
    setAssignedEditorId('');
    setAssignedCreatorId('');
    setPlatform('Instagram Reels');
    setEditingDeadline('');
    setPublishingDate('');
    setPublishingTime('');
    setScript('');
    setCaption('');
    setHashtags('');
    setReferenceLinksText('');
    setNotes('');
    setStatus('Pending');
    setRefUploadProgress(null);
    setFinalUploadProgress(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (r: ReelRecord) => {
    setEditingReel(r);
    setReelCode(r.reelCode);
    setTitle(r.title);
    setDescription(r.description);
    setCampaignName(r.campaignName);
    setReferenceVideoFileId(r.referenceVideoFileId);
    setReferenceVideoPreviewUrl(r.referenceVideoUrl);
    setReferenceVideoLink(r.referenceVideoLink);
    setFinalVideoFileId(r.finalVideoFileId);
    setFinalVideoPreviewUrl(r.finalVideoUrl);
    setAssignedEditorId(r.assignedEditorId || '');
    setAssignedCreatorId(r.assignedCreatorId || '');
    setPlatform(r.platform);
    setEditingDeadline(r.editingDeadline || '');
    setPublishingDate(r.publishingDate || '');
    setPublishingTime(r.publishingTime || '');
    setScript(r.script);
    setCaption(r.caption);
    setHashtags(r.hashtags);
    setReferenceLinksText(r.referenceLinks.join('\n'));
    setNotes(r.notes);
    setStatus(r.status);
    setRefUploadProgress(null);
    setFinalUploadProgress(null);
    setFormError(null);
    setFormOpen(true);
  };

  const handleVideoUpload = async (
    kind: 'reference' | 'final',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      setFormError('Video exceeds maximum allowed size of 50 MB.');
      return;
    }

    const setProgress =
      kind === 'reference' ? setRefUploadProgress : setFinalUploadProgress;
    setProgress(0);
    setFormError(null);

    try {
      const uploaded = await uploadFileToStorage('reel-videos', file, (pct) =>
        setProgress(pct)
      );
      if (kind === 'reference') {
        setReferenceVideoFileId(uploaded.fileId);
        setReferenceVideoPreviewUrl(uploaded.url);
      } else {
        setFinalVideoFileId(uploaded.fileId);
        setFinalVideoPreviewUrl(uploaded.url);
      }
    } catch (err: any) {
      setFormError(err.message || `Failed to upload ${kind} video.`);
    } finally {
      setProgress(null);
    }
  };

  const handleSaveReel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || refUploadProgress !== null || finalUploadProgress !== null) {
      return;
    }
    if (!title.trim()) {
      setFormError('Reel title is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const referenceLinks = referenceLinksText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: ReelInput = {
        reelCode: reelCode.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
        campaignName: campaignName.trim(),
        referenceVideoFileId,
        referenceVideoLink: referenceVideoLink.trim(),
        finalVideoFileId,
        assignedEditorId: assignedEditorId || null,
        assignedCreatorId: assignedCreatorId || null,
        platform,
        editingDeadline: editingDeadline || null,
        publishingDate: publishingDate || null,
        publishingTime: publishingTime || null,
        script: script.trim(),
        caption: caption.trim(),
        hashtags: hashtags.trim(),
        referenceLinks,
        notes: notes.trim(),
        status,
      };

      if (editingReel) {
        const updated = await reelService.update(editingReel.id, payload);
        if (detailReel?.id === editingReel.id) setDetailReel(updated);
        onNotify('success', `Updated reel "${title.trim()}"`);
      } else {
        await reelService.create(payload);
        onNotify('success', `Created reel "${title.trim()}"`);
      }

      setFormOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save reel.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    r: ReelRecord,
    nextStatus: ReelStatus
  ) => {
    if (statusUpdating) return;
    setStatusUpdating(true);
    try {
      const updated = await reelService.update(r.id, { status: nextStatus });
      if (detailReel?.id === r.id) setDetailReel(updated);
      setStatusModalReel(null);
      onNotify('success', `Reel status updated to ${nextStatus}`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update reel status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await reelService.remove(deleteTarget.id);
      if (detailReel?.id === deleteTarget.id) setDetailReel(null);
      onNotify('success', `Deleted reel "${deleteTarget.title}"`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to delete reel.');
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
            Reels
          </h1>
          <p className="text-sm text-slate-500">
            Video editing pipelines, scripts, video previews, and publishing schedules
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#159D91] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Add Reel</span>
        </button>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {REEL_TABS.map((tab) => {
          const active = activeTab === tab;
          const activeBg = TAB_COLORS[tab] || '#159D91';
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
            placeholder="Search reels or campaigns..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-10 text-sm focus:border-[#159D91] focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#159D91] focus:outline-none"
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
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#159D91] focus:outline-none"
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
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#159D91] focus:outline-none"
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

      {error && loaded && reels.length > 0 && (
        <PageLoadError
          title="Could not refresh reels"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="banner"
        />
      )}

      {/* Reels Grid */}
      {loading && !loaded && !error && reels.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-200" />
          ))}
        </div>
      ) : error && reels.length === 0 ? (
        <PageLoadError
          title="Unable to load reels"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="card"
        />
      ) : loaded && filteredReels.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#159D91]/10 text-[#159D91]">
            <Film className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-900">
            {reels.length === 0 ? 'No reels yet' : 'No matching reels'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {reels.length === 0
              ? 'Create a reel, upload reference/final videos, and schedule publishing.'
              : 'Adjust your status tab or search filters.'}
          </p>
          {reels.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 rounded-xl bg-[#159D91] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Create First Reel
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredReels.map((r) => {
            const statusStyle = getStatusBadgeStyle(r.status);
            const previewSrc = r.finalVideoUrl || r.referenceVideoUrl;
            return (
              <div
                key={r.id}
                onClick={() => setDetailReel(r)}
                className="flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs transition-shadow hover:shadow-md"
              >
                {/* Video Preview */}
                <div
                  className="relative aspect-video w-full overflow-hidden bg-slate-900"
                  onClick={(e) => {
                    if (previewSrc) e.stopPropagation();
                  }}
                >
                  {previewSrc ? (
                    <video
                      src={previewSrc}
                      controls
                      preload="metadata"
                      className="h-full w-full object-contain bg-black"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-teal-900 via-slate-900 to-cyan-950 text-white/75">
                      <Video className="h-8 w-8 text-[#159D91]" />
                      <span className="text-xs font-medium">
                        {r.referenceVideoLink
                          ? 'Reference link attached'
                          : 'No video uploaded yet'}
                      </span>
                    </div>
                  )}
                  <span
                    style={{
                      backgroundColor: statusStyle.bg,
                      color: statusStyle.text,
                      borderColor: statusStyle.border,
                    }}
                    className="pointer-events-none absolute top-3 left-3 rounded-lg border px-2.5 py-1 text-xs font-bold shadow-xs"
                  >
                    {r.status}
                  </span>
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-400">
                          {r.reelCode}
                        </span>
                        <span>·</span>
                        <span className="font-semibold text-[#159D91]">
                          {r.platform}
                        </span>
                      </div>
                      <h3 className="mt-1 truncate text-base font-bold text-slate-900">
                        {r.title}
                      </h3>
                      {r.campaignName && (
                        <p className="truncate text-xs text-slate-500">
                          Campaign: {r.campaignName}
                        </p>
                      )}
                    </div>

                    <ThreeDotMenu
                      actions={[
                        {
                          label: 'View Reel',
                          icon: <Eye className="h-4 w-4" />,
                          onClick: () => setDetailReel(r),
                        },
                        {
                          label: 'Edit Reel',
                          icon: <Edit3 className="h-4 w-4" />,
                          onClick: () => openEditModal(r),
                        },
                        {
                          label: 'Change Status',
                          icon: <RefreshCw className="h-4 w-4" />,
                          onClick: () => setStatusModalReel(r),
                        },
                        {
                          label: 'Delete Reel',
                          icon: <Trash2 className="h-4 w-4" />,
                          danger: true,
                          onClick: () => setDeleteTarget(r),
                        },
                      ]}
                    />
                  </div>

                  <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Editor:</span>
                      <span className="truncate font-semibold text-slate-800">
                        {r.assignedEditor?.fullName || 'Unassigned'}
                      </span>
                    </div>
                    {r.editingDeadline && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Edit Due:</span>
                        <span className="tabular-nums font-medium">
                          {formatDisplayDate(r.editingDeadline)}
                        </span>
                      </div>
                    )}
                    {r.publishingDate && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Publish:</span>
                        <span className="tabular-nums font-semibold text-[#159D91]">
                          {formatDisplayDate(r.publishingDate)}
                          {r.publishingTime
                            ? ` · ${formatTime12h(r.publishingTime)}`
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
                {editingReel ? 'Edit Reel' : 'Add New Reel'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReel} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[#E85D65]">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Reel Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Behind the Scenes Studio Tour"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Reel ID
                  </label>
                  <input
                    type="text"
                    value={reelCode}
                    onChange={(e) => setReelCode(e.target.value)}
                    placeholder="Auto if blank"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    placeholder="e.g. Product Launch"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    onChange={(e) => setStatus(e.target.value as ReelStatus)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  >
                    {REEL_TABS.filter((t) => t !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Video Uploads */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
                  <div className="text-xs font-bold text-slate-700">
                    Reference Video (Upload or Link)
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => refVideoInputRef.current?.click()}
                      disabled={refUploadProgress !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>
                        {refUploadProgress !== null
                          ? `Uploading ${refUploadProgress}%`
                          : referenceVideoPreviewUrl
                          ? 'Replace Ref Video'
                          : 'Upload Ref Video'}
                      </span>
                    </button>
                    <input
                      ref={refVideoInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg"
                      className="hidden"
                      onChange={(e) => handleVideoUpload('reference', e)}
                    />
                  </div>
                  {refUploadProgress !== null && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        style={{ width: `${refUploadProgress}%` }}
                        className="h-full bg-[#F29A38] transition-all"
                      />
                    </div>
                  )}
                  {referenceVideoPreviewUrl && (
                    <video
                      src={referenceVideoPreviewUrl}
                      controls
                      className="mt-2 h-28 w-full rounded-lg bg-black object-contain"
                    />
                  )}
                  <input
                    type="url"
                    value={referenceVideoLink}
                    onChange={(e) => setReferenceVideoLink(e.target.value)}
                    placeholder="Or paste reference video URL..."
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#159D91] focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
                  <div className="text-xs font-bold text-slate-700">
                    Final Edited Video (Max 50 MB)
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => finalVideoInputRef.current?.click()}
                      disabled={finalUploadProgress !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#159D91] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>
                        {finalUploadProgress !== null
                          ? `Uploading ${finalUploadProgress}%`
                          : finalVideoPreviewUrl
                          ? 'Replace Final Video'
                          : 'Upload Final Video'}
                      </span>
                    </button>
                    <input
                      ref={finalVideoInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg"
                      className="hidden"
                      onChange={(e) => handleVideoUpload('final', e)}
                    />
                  </div>
                  {finalUploadProgress !== null && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        style={{ width: `${finalUploadProgress}%` }}
                        className="h-full bg-[#159D91] transition-all"
                      />
                    </div>
                  )}
                  {finalVideoPreviewUrl && (
                    <video
                      src={finalVideoPreviewUrl}
                      controls
                      className="mt-2 h-28 w-full rounded-lg bg-black object-contain"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Assigned Video Editor
                  </label>
                  <select
                    value={assignedEditorId}
                    onChange={(e) => setAssignedEditorId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    Assigned Content Creator
                  </label>
                  <select
                    value={assignedCreatorId}
                    onChange={(e) => setAssignedCreatorId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  >
                    <option value="">Unassigned</option>
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
                    Editing Deadline
                  </label>
                  <input
                    type="date"
                    value={editingDeadline}
                    onChange={(e) => setEditingDeadline(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Concept and editing notes..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Script
                  </label>
                  <textarea
                    rows={2}
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="Hook, dialogue, voiceover..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Caption
                  </label>
                  <textarea
                    rows={2}
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Reel caption..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Hashtags
                  </label>
                  <textarea
                    rows={2}
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#reels #behindthescenes"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                    placeholder="Audio track, transitions, notes..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#159D91] focus:outline-none"
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
                  disabled={
                    saving ||
                    refUploadProgress !== null ||
                    finalUploadProgress !== null
                  }
                  className="rounded-xl bg-[#159D91] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving
                    ? 'Saving...'
                    : editingReel
                    ? 'Save Changes'
                    : 'Create Reel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reel Detail Modal */}
      {detailReel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="font-mono text-xs font-semibold text-slate-400">
                  {detailReel.reelCode} · {detailReel.platform}
                </span>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {detailReel.title}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = detailReel;
                    setDetailReel(null);
                    openEditModal(target);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailReel(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 text-xs font-bold text-slate-500">
                    Final Video
                  </div>
                  {detailReel.finalVideoUrl ? (
                    <video
                      src={detailReel.finalVideoUrl}
                      controls
                      className="w-full rounded-xl bg-black"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-400">
                      No final video uploaded yet
                    </div>
                  )}
                </div>

                {(detailReel.referenceVideoUrl ||
                  detailReel.referenceVideoLink) && (
                  <div>
                    <div className="mb-1.5 text-xs font-bold text-slate-500">
                      Reference Video
                    </div>
                    {detailReel.referenceVideoUrl && (
                      <video
                        src={detailReel.referenceVideoUrl}
                        controls
                        className="w-full rounded-xl bg-black"
                      />
                    )}
                    {detailReel.referenceVideoLink &&
                      (() => {
                        const safeHref = safeExternalUrl(
                          detailReel.referenceVideoLink
                        );
                        return safeHref ? (
                          <a
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#159D91] hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>Open reference video link</span>
                          </a>
                        ) : (
                          <span className="mt-2 block text-xs text-slate-500">
                            {detailReel.referenceVideoLink}
                          </span>
                        );
                      })()}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Status</span>
                  <select
                    value={detailReel.status}
                    disabled={statusUpdating}
                    onChange={(e) =>
                      handleQuickStatusChange(
                        detailReel,
                        e.target.value as ReelStatus
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                  >
                    {REEL_TABS.filter((t) => t !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 rounded-xl bg-slate-50 p-3.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Video Editor:</span>
                    <span className="font-semibold text-slate-900">
                      {detailReel.assignedEditor?.fullName || 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Content Creator:</span>
                    <span className="font-semibold text-slate-900">
                      {detailReel.assignedCreator?.fullName || 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Editing Deadline:</span>
                    <span className="tabular-nums font-semibold text-slate-900">
                      {formatDisplayDate(detailReel.editingDeadline)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Publishing Schedule:</span>
                    <span className="tabular-nums font-semibold text-[#159D91]">
                      {detailReel.publishingDate
                        ? `${formatDisplayDate(detailReel.publishingDate)}${
                            detailReel.publishingTime
                              ? ` at ${formatTime12h(detailReel.publishingTime)}`
                              : ''
                          }`
                        : 'Not scheduled'}
                    </span>
                  </div>
                </div>

                {detailReel.script && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">Script</div>
                    <p className="mt-1 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
                      {detailReel.script}
                    </p>
                  </div>
                )}

                {detailReel.caption && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">Caption</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                      {detailReel.caption}
                    </p>
                  </div>
                )}

                {detailReel.hashtags && (
                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                      <Hash className="h-3.5 w-3.5" />
                      <span>Hashtags</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-[#159D91]">
                      {detailReel.hashtags}
                    </p>
                  </div>
                )}

                {detailReel.notes && (
                  <div>
                    <div className="text-xs font-bold text-slate-500">Notes</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                      {detailReel.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Status Modal */}
      {statusModalReel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Change Reel Status
              </h3>
              <button
                type="button"
                onClick={() => setStatusModalReel(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {statusModalReel.title}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {REEL_TABS.filter((t) => t !== 'All').map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={statusUpdating}
                  onClick={() =>
                    handleQuickStatusChange(statusModalReel, st as ReelStatus)
                  }
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                    statusModalReel.status === st
                      ? 'border-[#159D91] bg-[#159D91]/10 text-[#159D91]'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{st}</span>
                  {statusModalReel.status === st && (
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
        message="This will permanently delete this reel and any uploaded video files."
        confirmLabel="Delete Reel"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
