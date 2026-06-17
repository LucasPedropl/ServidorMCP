'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/features/auth/components/AuthContext';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { Cpu } from 'lucide-react';

export default function LoginPage() {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const { isAuthenticated, isInitializing } = useAuthContext();
  const router = useRouter();

  // Redireciona para o painel se já estiver logado
  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, isInitializing, router]);

  const handleAuthSuccess = () => {
    router.push('/');
  };

  if (isInitializing) {
    return null; // A tela de ProtectedRoute ou carregamento já cuida disso no layout principal
  }

  if (isAuthenticated) {
    return null; // Evita flash visual antes do redirecionamento
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-zinc-950 text-white relative overflow-hidden">
      {/* Background gradients decorativos premium */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-zinc-800/20 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-zinc-800/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col items-center gap-6 w-full px-4 animate-in fade-in duration-700">
        {/* Logo / Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-white text-black shadow-lg">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider uppercase text-white">
              MCP Gateway
            </h1>
            <p className="text-xs text-zinc-500 font-medium">
              Model Context Protocol Workspace
            </p>
          </div>
        </div>

        {/* Formulários */}
        {isLoginMode ? (
          <LoginForm
            onSuccess={handleAuthSuccess}
            onSwitchToRegister={() => setIsLoginMode(false)}
          />
        ) : (
          <RegisterForm
            onSuccess={handleAuthSuccess}
            onSwitchToLogin={() => setIsLoginMode(true)}
          />
        )}
      </div>
    </div>
  );
}
