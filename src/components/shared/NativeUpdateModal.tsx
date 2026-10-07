"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw, CheckCircle2, AlertCircle, X } from "lucide-react";

interface NativeUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUpdate?: any;
  alreadyDownloaded?: boolean;
}

export default function NativeUpdateModal({ isOpen, onClose, initialUpdate, alreadyDownloaded = false }: NativeUpdateModalProps) {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(alreadyDownloaded);

  const getUpdater = () => {
    return (typeof window !== "undefined" && (window as any).Capacitor?.Plugins?.AppUpdater) || null;
  };

  const handleCheck = async () => {
    const updater = getUpdater();
    if (!updater) {
      setStatusMsg("Running in web browser. Native updater available on Android.");
      return;
    }

    setChecking(true);
    setError(null);
    setStatusMsg(null);
    setUpdateInfo(null);

    try {
      const res = await updater.checkUpdate();
      setUpdateInfo(res);
      if (res.checkFailed) {
        setError(res.message || "GitHub releases are not publicly accessible to this app.");
      } else if (!res.updateAvailable) {
        const installedVersion = res.currentVersion || "v1.0.0";
        const latestRelease = res.tagName || installedVersion;
        setStatusMsg(res.message || `Installed ${installedVersion}. Latest published release: ${latestRelease}.`);
      } else {
        void downloadInBackground(res);
      }
    } catch (e: any) {
      setError(e.message || "Failed to check GitHub releases.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialUpdate) {
        setUpdateInfo(initialUpdate);
        setDownloaded(alreadyDownloaded);
        if (!alreadyDownloaded) void downloadInBackground(initialUpdate);
      } else {
        handleCheck();
      }
    }
  }, [isOpen, initialUpdate]);

  const downloadInBackground = async (info: any) => {
    const updater = getUpdater();
    if (!updater || !info?.apkUrl) return;
    setDownloading(true);
    setError(null);
    let listener: any = null;
    try {
      listener = await updater.addListener("downloadProgress", (data: any) => {
        if (typeof data.percent === "number") setProgress(data.percent);
      });
      await updater.downloadUpdate({ apkUrl: info.apkUrl });
      setDownloaded(true);
      setStatusMsg("Update downloaded. Install when you’re ready.");
    } catch (e: any) {
      setError(e.message || "Update download failed.");
    } finally {
      setDownloading(false);
      if (listener?.remove) listener.remove();
    }
  };

  const handleInstall = async () => {
    const updater = getUpdater();
    if (!updater || !updateInfo?.apkUrl) return;

    try {
      const installPermission = await updater.canRequestPackageInstalls();
      if (!installPermission.canInstall) {
        await updater.openInstallPermissionSettings();
        setStatusMsg("Allow Ratio'd to install apps in Android settings, return here, then tap Install again.");
        return;
      }
    } catch (e: any) {
      setError(e.message || "Could not check Android install permission.");
      return;
    }

    setError(null);
    try {
      await updater.installDownloadedUpdate();
      setStatusMsg("Installer launched. Please confirm the update on your device.");
    } catch (e: any) {
      setError(e.message || "Could not open Android installer.");
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ backgroundColor: "color-mix(in srgb, var(--theme-bg) 72%, transparent)" }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-md bg-theme-card border border-theme-border rounded-[28px] p-6 text-theme-text shadow-2xl relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-lg text-theme-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
            >
              <X size={20} />
            </button>

            <div className="mb-5 pr-8">
              <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-theme-muted">Ratio'd Android</p>
              <h3 className="font-black lowercase tracking-tight text-2xl mt-1">app updates</h3>
              <p className="text-xs text-theme-muted mt-1">Current version {updateInfo?.currentVersion || ""}</p>
            </div>

            {checking && (
              <div className="py-8 flex flex-col items-center justify-center gap-3 text-theme-muted">
                <RefreshCw size={24} className="animate-spin text-theme-highlight" />
                <span className="text-sm">Checking for updates...</span>
              </div>
            )}

            {!checking && updateInfo?.updateAvailable && (
              <div className="space-y-4">
                <div className="p-4 bg-theme-surface border border-theme-border rounded-2xl">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-bold text-theme-highlight uppercase tracking-[0.25em]">New Version</span>
                    <span className="text-xs font-mono bg-theme-card px-2.5 py-1 rounded-full border border-theme-border text-theme-text">
                      {updateInfo.tagName}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm text-theme-text">{updateInfo.releaseName || "Update Available"}</h4>
                  {updateInfo.changelog && (
                    <p className="text-xs text-theme-muted mt-2 line-clamp-4 whitespace-pre-line font-mono bg-theme-bg p-3 rounded-xl">
                      {updateInfo.changelog}
                    </p>
                  )}
                </div>

                {downloading ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-theme-muted">
                      <span>Downloading APK...</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-theme-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-theme-highlight transition-all duration-200 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={downloaded ? handleInstall : () => downloadInBackground(updateInfo)}
                    className="w-full py-3 px-4 bg-theme-highlight hover:opacity-90 active:scale-[0.98] text-theme-text font-bold uppercase tracking-wider text-xs rounded-2xl flex items-center justify-center gap-2 transition-all"
                  >
                    <Download size={16} />
                    {downloaded ? "Install Update" : "Download Update"}
                  </button>
                )}
                {statusMsg && <p className="text-xs text-theme-muted">{statusMsg}</p>}
              </div>
            )}

            {!checking && !updateInfo?.updateAvailable && (
              <div className="py-6 flex flex-col items-center text-center gap-3">
                {error
                  ? <AlertCircle size={30} style={{ color: "var(--theme-secondary)" }} />
                  : <CheckCircle2 size={30} className="text-theme-highlight" />}
                <p className="text-sm text-theme-text">
                  {statusMsg || "You are currently running the latest version."}
                </p>
                <button
                  onClick={handleCheck}
                  className="mt-2 text-xs text-theme-highlight hover:underline flex items-center gap-1.5"
                >
                  <RefreshCw size={12} /> Check again
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-theme-surface border border-theme-secondary rounded-xl flex items-center gap-2 text-xs" style={{ color: "var(--theme-secondary)" }}>
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
