import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import {
  arrayBufferEqualsUint8,
  getReadyPushRegistration,
  isIOSDevice,
  isPushSupported,
  isStandalonePWA,
  pushService,
  urlBase64ToUint8Array,
} from '../services/pushService';

interface PushNotificationButtonProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function PushNotificationButton({ onNotify }: PushNotificationButtonProps) {
  const [supported] = useState<boolean>(() => isPushSupported());
  const [configured, setConfigured] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [statusReady, setStatusReady] = useState<boolean>(false);

  const syncExistingSubscription = useCallback(async (signal?: AbortSignal) => {
    try {
      const status = await pushService.getStatus(signal);
      if (signal?.aborted) return;
      setConfigured(status.configured);
      setPublicKey(status.publicKey);
      setStatusReady(true);

      if (!isPushSupported()) return;
      setPermission(Notification.permission);

      const registration = await getReadyPushRegistration();
      if (signal?.aborted) return;

      let existing = await registration.pushManager.getSubscription();
      if (!existing) {
        setSubscribed(false);
        return;
      }

      if (Notification.permission !== 'granted') {
        await existing.unsubscribe().catch(() => {});
        setSubscribed(false);
        return;
      }

      if (status.configured && status.publicKey) {
        const expectedKey = urlBase64ToUint8Array(status.publicKey);
        const currentKey = existing.options?.applicationServerKey;
        if (currentKey && !arrayBufferEqualsUint8(currentKey, expectedKey)) {
          await pushService.unsubscribe(existing.endpoint).catch(() => {});
          await existing.unsubscribe().catch(() => {});
          existing = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKey,
          });
        }
        await pushService.subscribe(existing);
        if (!signal?.aborted) {
          setSubscribed(true);
        }
      } else {
        setSubscribed(false);
      }
    } catch {
      if (!signal?.aborted) {
        setStatusReady(true);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    syncExistingSubscription(controller.signal);
    return () => controller.abort();
  }, [syncExistingSubscription]);

  const handleToggle = async () => {
    if (busy) return;

    if (!supported) {
      if (isIOSDevice() && !isStandalonePWA()) {
        onNotify(
          'error',
          'On iPhone, tap Share → Add to Home Screen first, then open the installed app to enable notifications.'
        );
      } else {
        onNotify('error', 'Push notifications are not supported in this browser.');
      }
      return;
    }

    if (permission === 'denied') {
      onNotify(
        'error',
        'Notifications are blocked. Allow notifications for this site in your browser settings.'
      );
      return;
    }

    setBusy(true);
    try {
      let activeKey = publicKey;
      let activeConfigured = configured;
      if (!statusReady || !activeKey) {
        const status = await pushService.getStatus();
        activeConfigured = status.configured;
        activeKey = status.publicKey;
        setConfigured(status.configured);
        setPublicKey(status.publicKey);
        setStatusReady(true);
      }

      if (!activeConfigured || !activeKey) {
        onNotify('error', 'Push notifications are not configured on the server.');
        return;
      }

      const registration = await getReadyPushRegistration();
      const existing = await registration.pushManager.getSubscription();

      if (subscribed && existing) {
        await pushService.unsubscribe(existing.endpoint).catch(() => {});
        await existing.unsubscribe();
        setSubscribed(false);
        onNotify('success', 'Push notifications turned off for this device.');
        return;
      }

      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission === 'denied') {
        setSubscribed(false);
        onNotify(
          'error',
          'Notifications were blocked. Enable permission in browser settings to receive task alerts.'
        );
        return;
      }

      if (nextPermission !== 'granted') {
        return;
      }

      const expectedKey = urlBase64ToUint8Array(activeKey);
      let subscription = existing;

      if (subscription) {
        const currentKey = subscription.options?.applicationServerKey;
        if (currentKey && !arrayBufferEqualsUint8(currentKey, expectedKey)) {
          await pushService.unsubscribe(subscription.endpoint).catch(() => {});
          await subscription.unsubscribe().catch(() => {});
          subscription = null;
        }
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey,
        });
      }

      await pushService.subscribe(subscription);
      setSubscribed(true);
      onNotify('success', 'Push notifications enabled for task alerts.');
    } catch (err: any) {
      onNotify(
        'error',
        err?.message || 'Unable to update push notification subscription.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (statusReady && !configured && supported && permission !== 'denied') {
    return null;
  }

  const isDenied = supported && permission === 'denied';

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={busy}
      title={
        isDenied
          ? 'Notifications blocked in browser settings'
          : subscribed
          ? 'Push notifications active (click to disable)'
          : 'Enable push notifications'
      }
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 ${
        subscribed
          ? 'border-[#20A779]/30 bg-[#20A779]/10 text-[#20A779] hover:bg-[#20A779]/15'
          : isDenied
          ? 'border-rose-200 bg-rose-50 text-[#E85D65] hover:bg-rose-100/70'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {isDenied ? (
        <BellOff className="h-3.5 w-3.5" />
      ) : subscribed ? (
        <BellRing className="h-3.5 w-3.5" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      <span>
        {busy
          ? 'Updating...'
          : isDenied
          ? 'Alerts Blocked'
          : subscribed
          ? 'Alerts On'
          : 'Enable Alerts'}
      </span>
    </button>
  );
}
