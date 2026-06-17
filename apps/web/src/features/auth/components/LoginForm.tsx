'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, LoginInput } from '../schemas/authSchema';
import { useAuth } from '../hooks/useAuth';
import { Loader2, Mail, Lock } from 'lucide-react';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { login, isLoading } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginInput) => {
    const user = await login(data);
    if (user) {
      onSuccess();
    }
  };

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-xl transition-all animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2 mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Acesse sua conta
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Entre com seu e-mail e senha para gerenciar seus servidores MCP.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            E-mail
          </label>
          <div className="relative flex items-center">
            <Mail className="absolute left-3.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              id="email"
              type="email"
              placeholder="seu-email@dominio.com"
              disabled={isLoading}
              className={`w-full pl-10 pr-4 py-2.5 rounded-xl border bg-zinc-50 dark:bg-zinc-900/50 text-sm outline-none transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-zinc-900 dark:text-white ${
                errors.email
                  ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                  : 'border-zinc-200 dark:border-zinc-800 focus:border-zinc-900 dark:focus:border-white focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white'
              }`}
              {...register('email')}
            />
          </div>
          {errors.email && (
            <span className="text-xs text-red-500 font-medium animate-in fade-in duration-200">
              {errors.email.message}
            </span>
          )}
        </div>

        {/* Senha */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Senha
            </label>
          </div>
          <div className="relative flex items-center">
            <Lock className="absolute left-3.5 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              disabled={isLoading}
              className={`w-full pl-10 pr-4 py-2.5 rounded-xl border bg-zinc-50 dark:bg-zinc-900/50 text-sm outline-none transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-zinc-900 dark:text-white ${
                errors.password
                  ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                  : 'border-zinc-200 dark:border-zinc-800 focus:border-zinc-900 dark:focus:border-white focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white'
              }`}
              {...register('password')}
            />
          </div>
          {errors.password && (
            <span className="text-xs text-red-500 font-medium animate-in fade-in duration-200">
              {errors.password.message}
            </span>
          )}
        </div>

        {/* Botão Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black font-semibold text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] transition-all shadow-md disabled:opacity-50 disabled:pointer-events-none"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Entrando...
            </>
          ) : (
            'Entrar'
          )}
        </button>
      </form>

      <div className="mt-6 pt-4 border-t border-zinc-150 dark:border-zinc-800/80 text-center">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Não tem uma conta?{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="font-semibold text-zinc-800 dark:text-zinc-200 hover:underline hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Cadastre-se gratuitamente
          </button>
        </p>
      </div>
    </div>
  );
}
