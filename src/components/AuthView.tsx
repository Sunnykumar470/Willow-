import React, { useEffect, useState } from 'react';
import {
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  Moon,
  ShieldCheck,
  Sun,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiRequest, setSessionToken, uploadFile } from '../lib/api.ts';
import type { OwnAccount } from '../types.ts';

export const PRESET_AVATARS = [
  {
    label: 'Botanical',
    url: '/src/assets/images/avatar_preset_botanical_1795381202891.jpg',
  },
  {
    label: 'Geometric',
    url: '/src/assets/images/avatar_preset_geometric_1795381202904.jpg',
  },
  {
    label: 'Minimal',
    url: '/src/assets/images/avatar_preset_minimal_1795381202910.jpg',
  },
];

interface AuthViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAuthenticated: (user: OwnAccount, sessionToken?: string) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ theme, onToggleTheme, onAuthenticated }) => {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('Hey there! I am using Willow.');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(PRESET_AVATARS[0].url);

  const [availability, setAvailability] = useState<{
    checking: boolean;
    available?: boolean;
    valid?: boolean;
    reason?: string;
    normalized?: string;
  }>({ checking: false });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPreview, setCustomPreview] = useState<string | null>(null);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);

  useEffect(() => {
    if (mode !== 'register') return;
    const raw = username.trim().replace(/^@+/, '');
    if (!raw) {
      setAvailability({ checking: false });
      return;
    }

    let cancelled = false;
    setAvailability({ checking: true });
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{
          available: boolean;
          valid: boolean;
          normalized: string;
          reason: string;
        }>(`/auth/check-username?username=${encodeURIComponent(raw)}`);
        if (!cancelled) {
          setAvailability({
            checking: false,
            available: res.available,
            valid: res.valid,
            normalized: res.normalized,
            reason: res.reason,
          });
        }
      } catch {
        if (!cancelled) setAvailability({ checking: false });
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, mode]);

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingAvatarFile(file);
    const objectUrl = URL.createObjectURL(file);
    setCustomPreview(objectUrl);
    setAvatarUrl(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'register') {
        if (!availability.valid || !availability.available) {
          throw new Error(availability.reason || 'Please choose an available username.');
        }

        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        const regRes = await apiRequest<{ user: OwnAccount; sessionToken?: string }>(
          '/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              username,
              password,
              displayName: displayName.trim() || username.trim().replace(/^@+/, ''),
              bio,
              avatarUrl: pendingAvatarFile ? null : avatarUrl,
            }),
          }
        );

        if (regRes.sessionToken) {
          setSessionToken(regRes.sessionToken);
        }

        let finalUser = regRes.user;
        if (pendingAvatarFile) {
          try {
            const upData = await uploadFile(pendingAvatarFile);
            const profRes = await apiRequest<{ user: OwnAccount }>('/profile', {
              method: 'PATCH',
              body: JSON.stringify({ avatarUrl: upData.url }),
            });
            finalUser = profRes.user;
          } catch {
            // Proceed with account even if avatar upload fails
          }
        }

        onAuthenticated(finalUser, regRes.sessionToken);
      } else {
        if (!password) {
          throw new Error('Please enter your password.');
        }
        const res = await apiRequest<{ user: OwnAccount; sessionToken?: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        if (res.sessionToken) {
          setSessionToken(res.sessionToken);
        }
        onAuthenticated(res.user, res.sessionToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] dark:bg-[#0B141A] flex flex-col">
      {/* Accent Header Band */}
      <div className="bg-[#00A884] dark:bg-[#111B21] border-b border-transparent dark:border-[#222E35] px-6 py-4 flex items-center justify-between">
        <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-white">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">Willow</span>
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Split Container */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-5xl w-full bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left Intro Column */}
          <div className="lg:col-span-5 bg-[#F7F8FA] dark:bg-[#111B21] p-8 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#E9EDEF] dark:border-[#222E35]">
            <div className="space-y-4">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#111B21] dark:text-[#E9EDEF] leading-tight text-balance">
                Private messaging built around your username
              </h1>
              <p className="text-sm text-[#54656F] dark:text-[#8696A0] leading-relaxed">
                Connect instantly with friends and groups using only a unique username and password—no phone number or email required.
              </p>
              <ul className="space-y-2.5 pt-2 text-sm text-[#111B21] dark:text-[#E9EDEF]">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#00A884] shrink-0" />
                  <span>Unique @username identity and discovery</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#00A884] shrink-0" />
                  <span>Real-time chat, voice notes, media & groups</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#00A884] shrink-0" />
                  <span>24-hour status updates with privacy controls</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 rounded-xl overflow-hidden border border-[#E9EDEF] dark:border-[#2A3942] bg-white dark:bg-[#202C33]">
              <img
                src="/src/assets/images/welcome_hero_card_1795381202408.jpg"
                alt="Willow messaging preview"
                referrerPolicy="no-referrer"
                className="w-full h-44 object-cover"
              />
            </div>
          </div>

          {/* Right Form Column */}
          <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center">
            <div className="flex items-center gap-1 p-1 bg-[#F0F2F5] dark:bg-[#111B21] rounded-xl mb-6 max-w-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                Sign In
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-1.5">
                  Username
                </label>
                <div className="relative flex items-center">
                  <AtSign className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. alex_morgan"
                    autoComplete="username"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-transparent focus:border-[#00A884] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                  />
                </div>
                {mode === 'register' && username.trim() && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {availability.checking ? (
                      <span className="text-[#54656F] dark:text-[#8696A0]">Checking availability...</span>
                    ) : availability.available ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#00A884]" />
                        <span className="text-[#00A884] font-medium">
                          @{availability.normalized} is available
                        </span>
                      </>
                    ) : availability.reason ? (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-red-500" />
                        <span className="text-red-500">{availability.reason}</span>
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-1.5">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={mode === 'register' ? 6 : 1}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter your password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-transparent focus:border-[#00A884] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 p-1 text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21] dark:hover:text-[#E9EDEF]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {mode === 'login' && (
                  <p className="mt-1.5 text-xs text-[#54656F] dark:text-[#8696A0] flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                    <span>Sign in to any account using its @username and password.</span>
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-1.5">
                      Confirm Password
                    </label>
                    <div className="relative flex items-center">
                      <Lock className="w-4 h-4 text-[#54656F] dark:text-[#8696A0] absolute left-3 pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        maxLength={128}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-transparent focus:border-[#00A884] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                      />
                    </div>
                    {confirmPassword && password !== confirmPassword && (
                      <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-1.5">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="How contacts see your name"
                      maxLength={60}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-transparent focus:border-[#00A884] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-1.5">
                      About / Bio
                    </label>
                    <input
                      type="text"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Available on Willow"
                      maxLength={200}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-transparent focus:border-[#00A884] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#54656F] dark:placeholder-[#8696A0] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] mb-2">
                      Profile Picture
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      {PRESET_AVATARS.map((preset) => {
                        const selected = !customPreview && avatarUrl === preset.url;
                        return (
                          <button
                            key={preset.url}
                            type="button"
                            onClick={() => {
                              setCustomPreview(null);
                              setPendingAvatarFile(null);
                              setAvatarUrl(preset.url);
                            }}
                            className={`relative rounded-full p-0.5 transition-transform ${
                              selected ? 'ring-2 ring-[#00A884] scale-105' : 'opacity-80 hover:opacity-100'
                            }`}
                            title={preset.label}
                          >
                            <img
                              src={preset.url}
                              alt={preset.label}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          </button>
                        );
                      })}
                      {customPreview && (
                        <div className="relative rounded-full p-0.5 ring-2 ring-[#00A884]">
                          <img
                            src={customPreview}
                            alt="Uploaded preview"
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        </div>
                      )}
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#2A3942] transition-colors">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Photo</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={handleAvatarFile}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  !username.trim() ||
                  !password ||
                  (mode === 'register' && (!availability.available || password.length < 6 || password !== confirmPassword))
                }
                className="w-full py-3 px-4 rounded-xl bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                {submitting
                  ? mode === 'register'
                    ? 'Creating Account...'
                    : 'Signing In...'
                  : mode === 'register'
                    ? 'Create Account'
                    : 'Sign In to Willow'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
