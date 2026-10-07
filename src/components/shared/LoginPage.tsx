"use client";
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, AlertCircle, Eye, EyeOff, RefreshCw } from "lucide-react";
import { EncryptionUtils } from "@/utils/shared/Encryption";
import { useApp } from "@/context/AppContext";
import { fetchWithLoadBalancer } from "@/utils/backendProxy";
import { useRouter } from "next/navigation";
import LoadingPage from "./LoadingPage";

interface LoginPageProps {
  onLogin: (data: any) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const { performLogin, performPortalLogin } = useApp();
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<"academia" | "portal">("academia");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingCaptcha, setLoadingCaptcha] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [captchaInput, setCaptchaInput] = useState<string>("");
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [cdigest, setCdigest] = useState<string | null>(null);
  const [captchaFields, setCaptchaFields] = useState<any>({});
  const [domainFieldName, setDomainFieldName] = useState<string>("dtoken_x");
  const [captchaFieldName, setCaptchaFieldName] = useState<string>("cptoken_x");
  const [randomDelimiter, setRandomDelimiter] = useState<string>("0000");

  const [isExiting, setIsExiting] = useState(false);
  const showCaptchaChallenge = Boolean(
    captchaImage && (loginMode !== "portal" || ocrStatus !== "available" || captchaInput.trim()),
  );

  const formatUsername = (val: string) => {
    const cleanVal = val.trim();
    return cleanVal.includes("@") ? cleanVal : `${cleanVal}@srmist.edu.in`;
  };

  const fetchPortalCaptcha = async () => {
    setLoadingCaptcha(true);
    setError("");
    try {
      const res = await fetchWithLoadBalancer("/portal/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setCaptchaImage(data.captcha_image || data.image);
        setCdigest(data.session || data.cdigest);
        setOcrStatus(data.ocrStatus || null);
        setCaptchaInput("");
        if (data.loginFormFields) setCaptchaFields(data.loginFormFields);
        if (data.domainFieldName) setDomainFieldName(data.domainFieldName);
        if (data.captchaFieldName) setCaptchaFieldName(data.captchaFieldName);
        if (data.randomDelimiter) setRandomDelimiter(data.randomDelimiter);
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.detail || "Could not fetch security check");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to reach Student Portal");
    } finally {
      setLoadingCaptcha(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    if (loginMode === "portal" && !captchaInput.trim() && ocrStatus !== "available") {
      setError("Please enter the security check characters.");
      return;
    }

    setError("");
    const fullUsername = loginMode === "academia" ? formatUsername(username) : username.trim();

    try {
      EncryptionUtils.cleanOldKeys();
      const savedCookies = loginMode === "academia"
        ? await EncryptionUtils.loadDecrypted("academia_cookies")
        : await EncryptionUtils.loadDecrypted("portal_cookies");

      const creds = {
        username: fullUsername,
        password: password,
        cookies: savedCookies,
        captcha: captchaInput.trim() || undefined,
        cdigest: cdigest || undefined,
        loginFormFields: captchaFields,
        domainFieldName: domainFieldName,
        captchaFieldName: captchaFieldName,
        randomDelimiter: randomDelimiter,
      };

      const loginFn = loginMode === "portal" ? performPortalLogin : performLogin;

      setLoading(true);
      try {
        const data = await loginFn(creds);
        onLogin(data);
      } catch (err: any) {
        const isCaptchaError = err?.type === "CAPTCHA_REQUIRED" || err?.type === "WRONG_CAPTCHA" || !!err?.image || !!err?.captcha_image;
        if (isCaptchaError) {
          setCaptchaImage(err.image || err.captcha_image);
          setCdigest(err.cdigest || err.session);
          if (err.ocrStatus) setOcrStatus(err.ocrStatus);
          else if (err.type === "WRONG_CAPTCHA") setOcrStatus("uncertain");
          if (err.loginFormFields) setCaptchaFields(err.loginFormFields);
          if (err.domainFieldName) setDomainFieldName(err.domainFieldName);
          if (err.captchaFieldName) setCaptchaFieldName(err.captchaFieldName);
          if (err.randomDelimiter) setRandomDelimiter(err.randomDelimiter);
          setError(err.message || "Invalid security check. Please enter the new one.");
          setCaptchaInput("");
        } else {
          if (loginMode !== "portal") {
            setCaptchaImage(null);
            setCdigest(null);
          }
          const msg = typeof err === "string" ? err : err?.message || err?.detail || "Authentication failed.";
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    } catch (err: any) {
      const isCaptchaError = err?.type === "CAPTCHA_REQUIRED" || err?.type === "WRONG_CAPTCHA" || !!err?.image || !!err?.captcha_image;
      if (isCaptchaError) {
        setCaptchaImage(err.image || err.captcha_image);
        setCdigest(err.cdigest || err.session);
        if (err.ocrStatus) setOcrStatus(err.ocrStatus);
        else if (err.type === "WRONG_CAPTCHA") setOcrStatus("uncertain");
        if (err.loginFormFields) setCaptchaFields(err.loginFormFields);
        if (err.domainFieldName) setDomainFieldName(err.domainFieldName);
        if (err.captchaFieldName) setCaptchaFieldName(err.captchaFieldName);
        if (err.randomDelimiter) setRandomDelimiter(err.randomDelimiter);
        setError(err.message || "Please enter the security check.");
        setCaptchaInput("");
      } else {
        if (loginMode !== "portal") {
          setCaptchaImage(null);
          setCdigest(null);
        }
        const msg = typeof err === "string" ? err : err?.message || err?.detail || "Authentication failed.";
        setError(msg);
      }
      setLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    },
    exit: {
      x: "-100%",
      opacity: 0,
      transition: {
        duration: 0.3,
        ease: [0.22, 1, 0.36, 1] as any
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.8,
        ease: [0.22, 1, 0.36, 1] as any
      }
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.3 }
    }
  };

  return (
    <>
      <AnimatePresence>
        {loading && <LoadingPage />}
      </AnimatePresence>

      <motion.div
        initial="hidden"
        animate={isExiting ? "exit" : "visible"}
        exit="exit"
        variants={containerVariants}
        className="h-screen w-full flex flex-col justify-between md:justify-center p-8 md:p-24 md:gap-12 relative bg-[#0c30ff] overflow-hidden"
      >
        <motion.header variants={itemVariants} className="relative z-10">
          <h1
            className="text-4xl md:text-5xl lowercase leading-none tracking-tighter"
            style={{ fontFamily: "Urbanosta", color: "#ceff1c" }}
          >
            ratio'd
          </h1>
        </motion.header>

        <motion.main variants={itemVariants} className="relative z-10 w-full max-w-xl mt-auto md:mt-0 pb-6 md:pb-0">
          <form onSubmit={handleSubmit} className="flex flex-col gap-8 md:gap-12">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setLoginMode("academia");
                  setError("");
                  setCaptchaImage(null);
                  setOcrStatus(null);
                  setCdigest(null);
                  setCaptchaInput("");
                }}
                className={`text-[11px] font-mono uppercase tracking-[0.25em] transition-all pb-1 ${
                  loginMode === "academia"
                    ? "text-[#ceff1c] border-b-[1.5px] border-[#ceff1c]"
                    : "text-white/40 hover:text-white/80"
                }`}
              >
                academia
              </button>
              <span className="text-white/20 text-xs font-mono select-none">/</span>
              <button
                type="button"
                onClick={() => {
                  setLoginMode("portal");
                  setError("");
                  setCaptchaInput("");
                  setCaptchaImage(null);
                  setCdigest(null);
                  setOcrStatus(null);
                  fetchPortalCaptcha();
                }}
                className={`text-[11px] font-mono uppercase tracking-[0.25em] transition-all pb-1 ${
                  loginMode === "portal"
                    ? "text-[#ceff1c] border-b-[1.5px] border-[#ceff1c]"
                    : "text-white/40 hover:text-white/80"
                }`}
              >
                student portal
              </button>
            </div>

            <div className="group relative">
              <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/60">
                {loginMode === "portal" ? "NetID / Reg No" : "NetID"}
              </label>
              <div className="relative flex items-center border-b-[1.5px] border-white focus-within:border-[#ceff1c] transition-colors">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="login-input w-full bg-transparent py-3 text-3xl md:text-4xl text-white outline-none placeholder:text-white/10"
                  placeholder="ab1234"
                  style={{ fontFamily: "Aonic", color: 'white' }}
                />
                {loginMode === "academia" && !username.includes("@") && (
                  <span
                    className="text-xl md:text-3xl text-white/30 lowercase pointer-events-none pr-2 select-none whitespace-nowrap"
                    style={{ fontFamily: "Aonic" }}
                  >
                    @srmist.edu.in
                  </span>
                )}
              </div>
            </div>

            <div className="group relative">
              <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/60">
                Password
              </label>
              <div className="relative flex items-center border-b-[1.5px] border-white focus-within:border-[#ceff1c] transition-colors">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input w-full bg-transparent py-3 text-3xl md:text-4xl text-white outline-none placeholder:text-white/10"
                  placeholder="••••••••"
                  style={{ fontFamily: "Aonic", color: 'white' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-white/40 hover:text-[#ceff1c] pr-2"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showCaptchaChallenge && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group relative"
                >
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/60 block">
                      {ocrStatus === "available" ? "Security Check · OCR will try first" : "Security Check · optional"}
                    </label>
                    <button
                      type="button"
                      onClick={() => fetchPortalCaptcha()}
                      disabled={loadingCaptcha}
                      className="text-white/40 hover:text-[#ceff1c] text-[10px] font-mono flex items-center gap-1 uppercase tracking-wider"
                    >
                      <RefreshCw size={12} className={loadingCaptcha ? "animate-spin" : ""} />
                      <span>reload</span>
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                    <div className="relative flex-1 flex items-center border-b-[1.5px] border-white focus-within:border-[#ceff1c] transition-colors">
                      <input
                        type="text"
                        value={captchaInput}
                        onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                        className="login-input w-full bg-transparent py-2 text-2xl md:text-3xl text-white outline-none placeholder:text-white/10"
                        placeholder="type only if OCR does not work"
                        style={{ fontFamily: "Aonic", color: 'white' }}
                        autoCapitalize="characters"
                      />
                    </div>
                    <div className="bg-white rounded p-1 h-[48px] flex-shrink-0 flex items-center justify-center overflow-hidden">
                      <img src={captchaImage || ""} alt="CAPTCHA" className="h-full object-contain mix-blend-multiply" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative w-full mt-3 md:mt-6">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-4 text-red-300 font-mono text-xs uppercase flex items-start gap-2 bg-red-950/50 border border-red-500/40 rounded-xl p-3"
                  >
                    <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-400" />
                    <span className="leading-snug break-words">{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-between border-t border-white pt-4 group disabled:opacity-30"
              >
              <span
                className="text-3xl md:text-3xl lowercase text-white group-hover:text-[#ceff1c]"
                style={{ fontFamily: "aonic" }}
              >
                {loading ? "WAIT_" : "signin"}
              </span>
              {loading ? (
                <Loader2 className="animate-spin text-white" size={30} />
              ) : (
                <ArrowRight
                  size={36}
                  className="text-white group-hover:text-[#ceff1c] group-hover:translate-x-4 transition-all"
                />
              )}
            </button>

          </div>
        </form>
        </motion.main>
      </motion.div>
    </>
  );
};

export default LoginPage;
