'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { usePathname } from 'next/navigation';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const pathname = usePathname();

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  // Se for a tela de login, renderiza apenas o conteúdo em tela cheia
  if (pathname === '/login') {
    return <div className="h-screen w-full">{children}</div>;
  }

  return (
    <div className="flex h-screen w-full bg-zinc-100 dark:bg-[#000000] overflow-hidden text-zinc-900 dark:text-white transition-colors">
      <Sidebar isOpen={isSidebarOpen} />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Topbar onToggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />
        <main className="flex-1 overflow-y-auto bg-zinc-100 dark:bg-[#0a0a0a] transition-colors p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
