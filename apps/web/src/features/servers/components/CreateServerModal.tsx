'use client';

import React, { useState } from 'react';
import { X, Database, Globe, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type ServerType = 'rest' | 'supabase' | null;

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitRest: (url: string) => Promise<void>;
  onSubmitSupabase: (data: { name: string; supabase_url: string; anon_key: string; service_role_key: string }) => Promise<void>;
  isLoading: boolean;
}

export function CreateServerModal({ isOpen, onClose, onSubmitRest, onSubmitSupabase, isLoading }: CreateServerModalProps) {
  const [selectedType, setSelectedType] = useState<ServerType>(null);

  // Estado do formulário REST
  const [swaggerUrl, setSwaggerUrl] = useState('');

  // Estado do formulário Supabase
  const [sbName, setSbName] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbAnonKey, setSbAnonKey] = useState('');
  const [sbServiceKey, setSbServiceKey] = useState('');
  const [showAnonKey, setShowAnonKey] = useState(false);
  const [showServiceKey, setShowServiceKey] = useState(false);

  const handleClose = () => {
    setSelectedType(null);
    setSwaggerUrl('');
    setSbName('');
    setSbUrl('');
    setSbAnonKey('');
    setSbServiceKey('');
    setShowAnonKey(false);
    setShowServiceKey(false);
    onClose();
  };

  const handleBack = () => {
    setSelectedType(null);
  };

  const handleSubmitRest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!swaggerUrl) return;
    await onSubmitRest(swaggerUrl);
    handleClose();
  };

  const handleSubmitSupabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sbName || !sbUrl || !sbAnonKey || !sbServiceKey) return;
    await onSubmitSupabase({
      name: sbName,
      supabase_url: sbUrl,
      anon_key: sbAnonKey,
      service_role_key: sbServiceKey,
    });
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#0a0a0a] border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 transition-colors max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-200 dark:border-zinc-800/80 transition-colors">
          <div className="flex items-center gap-2">
            {selectedType && (
              <button
                onClick={handleBack}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors mr-1"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight transition-colors">
                {!selectedType && 'Adicionar Novo Servidor MCP'}
                {selectedType === 'rest' && 'Conectar API REST / OpenAPI'}
                {selectedType === 'supabase' && 'Conectar Projeto Supabase'}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 transition-colors">
                {!selectedType && 'Escolha o tipo de servidor que deseja cadastrar.'}
                {selectedType === 'rest' && 'Cole a URL do seu arquivo Swagger/OpenAPI (JSON).'}
                {selectedType === 'supabase' && 'Insira as credenciais do seu projeto Supabase.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Seleção de Tipo */}
        {!selectedType && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <button
              onClick={() => setSelectedType('rest')}
              className="group relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 hover:border-zinc-500 dark:hover:border-zinc-500 bg-zinc-50 dark:bg-zinc-950/40 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 transition-all duration-200 cursor-pointer"
            >
              <div className="p-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black shadow-sm transition-colors group-hover:scale-110 duration-200">
                <Globe className="w-7 h-7" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-zinc-900 dark:text-white text-sm transition-colors">
                  REST / OpenAPI
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 transition-colors">
                  Swagger, OpenAPI 3.x, JSON
                </p>
              </div>
            </button>

            <button
              onClick={() => setSelectedType('supabase')}
              className="group relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-zinc-50 dark:bg-zinc-950/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all duration-200 cursor-pointer"
            >
              <div className="p-3 rounded-xl bg-emerald-600 text-white shadow-sm transition-colors group-hover:scale-110 duration-200">
                <Database className="w-7 h-7" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-zinc-900 dark:text-white text-sm transition-colors">
                  Supabase
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 transition-colors">
                  PostgREST, Auth JWT, RLS
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Formulário REST / OpenAPI */}
        {selectedType === 'rest' && (
          <form onSubmit={handleSubmitRest} className="space-y-4 py-2 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 transition-colors">
                URL do Swagger / OpenAPI (JSON)
              </label>
              <Input
                value={swaggerUrl}
                onChange={(e) => setSwaggerUrl(e.target.value)}
                placeholder="https://exemplo.com/swagger.json"
                disabled={isLoading}
                icon={<Globe className="w-4 h-4" />}
              />
            </div>
            <Button type="submit" variant="primary" size="md" isLoading={isLoading} className="w-full">
              {isLoading ? 'Analisando...' : 'Iniciar Análise do Swagger'}
            </Button>
          </form>
        )}

        {/* Formulário Supabase */}
        {selectedType === 'supabase' && (
          <form onSubmit={handleSubmitSupabase} className="space-y-4 py-2 animate-in fade-in slide-in-from-right-4 duration-300">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 transition-colors">
                Nome do Servidor
              </label>
              <Input
                value={sbName}
                onChange={(e) => setSbName(e.target.value)}
                placeholder="Ex: Obra-Log Produção"
                disabled={isLoading}
                icon={<Database className="w-4 h-4" />}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 transition-colors">
                URL do Projeto Supabase
              </label>
              <Input
                value={sbUrl}
                onChange={(e) => setSbUrl(e.target.value)}
                placeholder="https://xxxxxxxxxxx.supabase.co"
                disabled={isLoading}
                icon={<Globe className="w-4 h-4" />}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 transition-colors">
                Anon Key (Chave Pública)
              </label>
              <div className="relative">
                <Input
                  type={showAnonKey ? 'text' : 'password'}
                  value={sbAnonKey}
                  onChange={(e) => setSbAnonKey(e.target.value)}
                  placeholder="sb_publishable_..."
                  disabled={isLoading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowAnonKey(!showAnonKey)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                >
                  {showAnonKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 transition-colors">
                Service Role Key (Chave Secreta)
              </label>
              <div className="relative">
                <Input
                  type={showServiceKey ? 'text' : 'password'}
                  value={sbServiceKey}
                  onChange={(e) => setSbServiceKey(e.target.value)}
                  placeholder="sb_secret_..."
                  disabled={isLoading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowServiceKey(!showServiceKey)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                >
                  {showServiceKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-1.5 pl-1">
                ⚠ Usada apenas no servidor para sincronizar o esquema. Nunca exposta no navegador.
              </p>
            </div>

            <Button type="submit" variant="primary" size="md" isLoading={isLoading} className="w-full">
              {isLoading ? 'Criando servidor...' : 'Criar Servidor Supabase'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
