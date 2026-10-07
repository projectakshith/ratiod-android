"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw, CheckCircle2, AlertCircle, X, Sparkles } from "lucide-react";

interface NativeUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NativeUpdateModal({ isOpen, onClose }: NativeUpdateModalProps) {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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

    try {
      const res = await updater.checkUpdate();
      setUpdateInfo(res);
      if (!res.updateAvailable) {
        setStatusMsg(res.message || `You're on the latest version (${res.currentVersion || "v1.0.0"}).`);
      }
    } catch (e: any) {
      setError(e.message || "Failed to check GitHub releases.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleCheck();
    }
  }, [isOpen]);

  const handleDownloadAndInstall = async () => {
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

    setDownloading(true);
    setProgress(0);
    setError(null);

    // Listen for download progress events
    let listener: any = null;
    try {
      listener = await updater.addListener("downloadProgress", (data: any) => {
        if (typeof data.percent === "number") {
          setProgress(data.percent);
        }
      });

      await updater.downloadAndInstall({ apkUrl: updateInfo.apkUrl });
      setStatusMsg("Installer launched. Please confirm the update on your device.");
    } catch (e: any) {
      setError(e.message || "Download failed. Please check your network.");
    } finally {
      setDownloading(false);
      if (listener && typeof listener.remove === "function") {
        listener.remove();
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-md bg-[#0f172a] border border-slate-800 rounded-2xl p-6 text-slate-100 shadow-2xl relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Sparkles size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-lg">App Updates</h3>
                <p className="text-xs text-slate-400">Direct GitHub Releases channel</p>
              </div>
            </div>

            {checking && (
              <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-400">
                <RefreshCw size={24} className="animate-spin text-blue-400" />
                <span className="text-sm">Checking for updates...</span>
              </div>
            )}

            {!checking && updateInfo?.updateAvailable && (
              <div className="space-y-4">
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">New Version</span>
                    <span className="text-xs font-mono bg-blue-500/20 px-2 py-0.5 rounded text-blue-300">
                      {updateInfo.tagName}
                    </span>
                  </div>
                  <h4 className="font-medium text-sm text-slate-200">{updateInfo.releaseName || "Update Available"}</h4>
                  {updateInfo.changelog && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-4 whitespace-pre-line font-mono bg-slate-950/50 p-2 rounded">
                      {updateInfo.changelog}
                    </p>
                  )}
                </div>

                {downloading ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Downloading APK...</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-200 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleDownloadAndInstall}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/25"
                  >
                    <Download size={16} />
                    Download &amp; Install Update
                  </button>
                )}
                {statusMsg && <p className="text-xs text-slate-400">{statusMsg}</p>}
              </div>
            )}

            {!checking && !updateInfo?.updateAvailable && (
              <div className="py-6 flex flex-col items-center text-center gap-3">
                <CheckCircle2 size={32} className="text-emerald-400" />
                <p className="text-sm text-slate-300">
                  {statusMsg || "You are currently running the latest version."}
                </p>
                <button
                  onClick={handleCheck}
                  className="mt-2 text-xs text-blue-400 hover:underline flex items-center gap-1.5"
                >
                  <RefreshCw size={12} /> Check again
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-xs text-rose-300">
                <AlertCircle size={16} className="shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
