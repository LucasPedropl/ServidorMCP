'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';
import { getCurrentUserService, getSessionService } from '../services/authService';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // 1. Inicializa o estado com a sessão e usuário atuais do Supabase
    async function initializeAuth() {
      try {
        const currentSession = await getSessionService();
        const currentUser = await getCurrentUserService();
        setSession(currentSession);
        setUser(currentUser);
      } catch (err) {
        console.error('Erro na inicialização da autenticação:', err);
      } finally {
        setIsInitializing(false);
      }
    }

    initializeAuth();

    // 2. Ouve alterações de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setIsInitializing(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextType = {
    user,
    session,
    isAuthenticated: !!user,
    isInitializing,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
