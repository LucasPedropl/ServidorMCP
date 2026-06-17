import { supabase } from '@/lib/supabase';
import { LoginInput, RegisterInput } from '../schemas/authSchema';
import { User, Session } from '@supabase/supabase-js';

/**
 * Realiza o login do usuário com e-mail e senha.
 */
export async function signInWithEmailService(input: LoginInput): Promise<{ user: User | null; session: Session | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    throw new Error(error.message || 'Falha ao realizar login.');
  }

  return {
    user: data.user,
    session: data.session,
  };
}

/**
 * Cadastra um novo usuário com e-mail e senha.
 */
export async function signUpWithEmailService(input: Omit<RegisterInput, 'confirmPassword'>): Promise<{ user: User | null; session: Session | null }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
  });

  if (error) {
    throw new Error(error.message || 'Falha ao cadastrar usuário.');
  }

  return {
    user: data.user,
    session: data.session,
  };
}

/**
 * Realiza o logout do usuário.
 */
export async function signOutService(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message || 'Falha ao deslogar usuário.');
  }
}

/**
 * Obtém o usuário atualmente logado.
 */
export async function getCurrentUserService(): Promise<User | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return user;
}

/**
 * Obtém a sessão ativa atual.
 */
export async function getSessionService(): Promise<Session | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    return null;
  }
  return session;
}
