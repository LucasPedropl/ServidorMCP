'use client';

import { useState, useCallback } from 'react';
import { signInWithEmailService, signUpWithEmailService, signOutService } from '../services/authService';
import { LoginInput, RegisterInput } from '../schemas/authSchema';
import { User } from '@supabase/supabase-js';
import { useToast } from '@/components/ui/Toast';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const login = useCallback(async (input: LoginInput): Promise<User | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const { user } = await signInWithEmailService(input);
      addToast('Login realizado com sucesso!', 'success');
      return user;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Falha ao autenticar';
      setError(errMsg);
      addToast(errMsg, 'error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const register = useCallback(async (input: Omit<RegisterInput, 'confirmPassword'>): Promise<User | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const { user } = await signUpWithEmailService(input);
      addToast('Cadastro realizado com sucesso! Verifique seu e-mail.', 'success');
      return user;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Falha ao cadastrar';
      setError(errMsg);
      addToast(errMsg, 'error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const logout = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await signOutService();
      addToast('Sessão encerrada com sucesso.', 'success');
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Falha ao deslogar';
      setError(errMsg);
      addToast(errMsg, 'error');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  return {
    login,
    register,
    logout,
    isLoading,
    error,
  };
}
