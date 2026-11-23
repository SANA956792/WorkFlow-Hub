import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { publicRequest, UNAUTHORIZED_EVENT } from '../services/apiClient';

interface SessionResponse {
  authenticated: boolean;
  needsSetup?: boolean;
  label?: string;
  expiresAt?: string;
}

interface AuthContextValue {
  authenticated: boolean;
  needsSetup: boolean;
  loading: boolean;
  authError: string | null;
  sessionLabel: string | null;
  loginWithCode: (accessCode: string) => Promise<void>;
  setupAccessCode: (accessCode: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    try {
      const data = await publicRequest<SessionResponse>('/api/auth/session');
      setAuthenticated(Boolean(data.authenticated));
      setNeedsSetup(Boolean(data.needsSetup));
      setSessionLabel(data.label || (data.authenticated ? 'Company Workspace' : null));
    } catch {
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthenticated(false);
      setSessionLabel(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const loginWithCode = async (accessCode: string) => {
    setAuthError(null);
    try {
      const data = await publicRequest<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ accessCode }),
      });
      setAuthenticated(Boolean(data.authenticated));
      setNeedsSetup(false);
      setSessionLabel(data.label || 'Company Workspace');
    } catch (error: any) {
      const msg = error?.message || 'Invalid Company Access Code.';
      setAuthError(msg);
      throw error;
    }
  };

  const setupAccessCode = async (accessCode: string) => {
    setAuthError(null);
    try {
      const data = await publicRequest<SessionResponse>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ accessCode }),
      });
      setAuthenticated(Boolean(data.authenticated));
      setNeedsSetup(false);
      setSessionLabel(data.label || 'Company Workspace');
    } catch (error: any) {
      const msg = error?.message || 'Unable to save Company Access Code.';
      setAuthError(msg);
      throw error;
    }
  };

  const signOut = async () => {
    setAuthError(null);
    try {
      await publicRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session state even if server call fails
    } finally {
      setAuthenticated(false);
      setSessionLabel(null);
    }
  };

  const clearAuthError = () => setAuthError(null);

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        needsSetup,
        loading,
        authError,
        sessionLabel,
        loginWithCode,
        setupAccessCode,
        signOut,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
