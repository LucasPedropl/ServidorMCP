import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { startMcpEngine, createMcpServerInstance, runTestCaseEngine, executeServerTeardown } from './services/mcpEngineService.js';
import fs from 'fs';
import { supabaseAdmin } from './config/supabase.js';

/**
 * Valida se o token JWT fornecido pertence ao usuário proprietário do servidor MCP.
 */
async function validateServerAccess(serverId: string, token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      console.error(`[Security Alert] Falha ao decodificar token JWT: ${error?.message}`);
      return false;
    }
    
    const { data, error: dbError } = await supabaseAdmin
      .from('mcp_servers')
      .select('user_id')
      .eq('id', serverId)
      .single();
      
    if (dbError || !data) {
      console.error(`[Security Alert] Servidor MCP ${serverId} nao encontrado.`);
      return false;
    }
    
    return data.user_id === user.id;
  } catch (err: any) {
    console.error(`[Security Alert] Erro na validacao de acesso ao servidor:`, err.message);
    return false;
  }
}

// Mapa para manter os transportes SSE ativos por ID de sessão
const activeTransports: Record<string, SSEServerTransport> = {};

// Bins de webhook para testes assíncronos (ID -> array de payloads recebidos)
export const webhookBins = new Map<string, any[]>();

async function startSseServer() {
  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(cors());
  app.use(express.json());

  // Rota SSE para estabelecer o canal de comunicação do MCP
  app.get('/mcp/:serverId', async (req, res) => {
    const { serverId } = req.params;
    const token = req.query.token as string;
    
    console.error(`[MCP SSE] Recebida conexao GET para o servidor: ${serverId}`);

    // Validação de segurança obrigatória via token JWT
    const hasAccess = await validateServerAccess(serverId, token);
    if (!hasAccess) {
      console.error(`[Security Violation] Acesso negado para o servidor ${serverId}. Token ausente ou invalido.`);
      res.status(403).json({ error: 'Acesso Proibido. Token JWT ausente ou invalido para este servidor.' });
      return;
    }

    try {
      // Cria a instância do servidor MCP dinamicamente para o ID solicitado
      const { mcpServer, serverRecord } = await createMcpServerInstance(serverId);
      
      const serverName = serverRecord?.name || 'Welcome Server';
      console.error(`[MCP SSE] Conectando cliente ao servidor: "${serverName}" (${serverId || 'Welcome'})`);

      // Configura o transporte SSE apontando para a rota de recebimento de mensagens
      const transport = new SSEServerTransport(`/mcp/${serverId}/message`, res);
      const sessionId = transport.sessionId;
      (transport as any).lastActiveAt = Date.now();
      activeTransports[sessionId] = transport;

      transport.onclose = () => {
        console.error(`[MCP SSE] Conexão encerrada para a sessão: ${sessionId}`);
        delete activeTransports[sessionId];
        executeServerTeardown(serverId).catch(err => {
          console.error(`[MCP SSE Teardown Erro]:`, err);
        });
      };

      res.on('close', () => {
        console.error(`[MCP SSE] Conexão física fechada pelo cliente (Sessão: ${sessionId})`);
        if (activeTransports[sessionId]) {
          delete activeTransports[sessionId];
          executeServerTeardown(serverId).catch(err => {
            console.error(`[MCP SSE Teardown Erro]:`, err);
          });
        }
      });

      await mcpServer.connect(transport);
      console.error(`[MCP SSE] Canal SSE estabelecido com sucesso! SessionID: ${sessionId}`);
    } catch (err: any) {
      console.error('[MCP SSE Erro]: Falha ao estabelecer conexão SSE:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Falha ao estabelecer conexão SSE', details: err.message });
      }
    }
  });

  // Rota HTTP POST para receber comandos/mensagens do cliente de IA
  app.post('/mcp/:serverId/message', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      res.status(400).send('Session ID ausente na requisição.');
      return;
    }

    const transport = activeTransports[sessionId];
    if (!transport) {
      res.status(404).send('Sessão MCP não encontrada ou já expirada.');
      return;
    }

    (transport as any).lastActiveAt = Date.now();

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error(`[MCP SSE Erro] Falha ao processar mensagem na sessão ${sessionId}:`, err);
      if (!res.headersSent) {
        res.status(500).send('Erro interno ao processar mensagem.');
      }
    }
  });

  // Limpeza periódica de conexões SSE fantasma/inativas (Watchdog)
  setInterval(() => {
    const now = Date.now();
    const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
    for (const [sessionId, transport] of Object.entries(activeTransports)) {
      const lastActive = (transport as any).lastActiveAt || 0;
      if (now - lastActive > TIMEOUT_MS) {
        console.error(`[MCP SSE Watchdog] Limpando sessão fantasma inativa: ${sessionId}`);
        try {
          transport.close();
        } catch (e) {
          // Ignora erro ao fechar
        }
        delete activeTransports[sessionId];
      }
    }
  }, 5 * 60 * 1000); // Executa a cada 5 minutos

  // Webhook Receiver - POST para receber payloads do webhook
  app.post('/api/v1/webhook-bin/:binId', (req, res) => {
    const { binId } = req.params;
    console.error(`[Webhook Bin] Recebido POST no bin: ${binId}`);
    
    if (!webhookBins.has(binId)) {
      webhookBins.set(binId, []);
    }
    
    const payloads = webhookBins.get(binId)!;
    payloads.push({
      timestamp: new Date().toISOString(),
      headers: req.headers,
      body: req.body,
      query: req.query
    });
    
    res.status(200).json({ success: true, message: 'Webhook recebido com sucesso.' });
  });

  // Webhook Bin Auditor - GET para consultar os payloads recebidos
  app.get('/api/v1/webhook-bin/:binId', (req, res) => {
    const { binId } = req.params;
    const payloads = webhookBins.get(binId) || [];
    res.status(200).json({ success: true, binId, count: payloads.length, webhooks: payloads });
  });

  // Rota para rodar caso de teste de forma assíncrona (evita timeout de 10s da Vercel)
  app.post('/api/v1/run-test-case', (req, res) => {
    const { serverId, testCaseId, variablesOverride, testRunId } = req.body;

    if (!serverId || !testCaseId || !testRunId) {
      res.status(400).json({ error: 'Parâmetros serverId, testCaseId e testRunId são obrigatórios.' });
      return;
    }

    console.error(`[Express API] Iniciando rodada de teste em background para TestCase: ${testCaseId} (Run: ${testRunId})`);

    // Retorna status 202 imediatamente
    res.status(202).json({ success: true, message: 'Execução de teste iniciada em background.' });

    // Dispara execução real
    runTestCaseEngine(serverId, testCaseId, variablesOverride, testRunId).catch((err) => {
      console.error(`[Express API background run ERRO]: Falha ao executar caso de teste ${testCaseId}:`, err);
    });
  });

  app.listen(PORT, () => {
    console.error(`[MCP Server] Servidor Gateway SSE escutando na porta ${PORT}`);
    console.error(`[MCP Server] Endpoints disponíveis:`);
    console.error(`  - GET  http://localhost:${PORT}/mcp/:serverId       (Canal SSE)`);
    console.error(`  - POST http://localhost:${PORT}/mcp/:serverId/message (Envio de mensagens)`);
    console.error(`  - POST http://localhost:${PORT}/api/v1/run-test-case  (Executar Caso de Teste em Background)`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  // Escreve log de depuração
  fs.writeFileSync('C:/Users/Pedro/Downloads/ServidorMCP/apps/api/mcp_debug.log', JSON.stringify({
    timestamp: new Date().toISOString(),
    argv: process.argv,
    env: {
      TARGET_SERVER_ID: process.env.TARGET_SERVER_ID,
      RELOAD_TIMESTAMP: process.env.RELOAD_TIMESTAMP
    }
  }, null, 2));

  let serverId: string | undefined = undefined;

  // Busca argumento --serverId <uuid>
  const idIndex = args.indexOf('--serverId');
  if (idIndex !== -1 && args[idIndex + 1]) {
    serverId = args[idIndex + 1];
  }

  // Fallback para variável de ambiente TARGET_SERVER_ID
  if (!serverId) {
    serverId = process.env.TARGET_SERVER_ID;
  }

  const isSseMode = args.includes('--sse') || args.includes('--gateway');

  // Se não estiver explicitamente no modo SSE, a definição do serverId é obrigatória
  if (!isSseMode && !serverId) {
    console.error('========================================================================');
    console.error('ERRO DE INICIALIZAÇÃO:');
    console.error('O identificador do servidor (--serverId <UUID> ou TARGET_SERVER_ID)');
    console.error('é OBRIGATÓRIO para execução no modo Stdio.');
    console.error('========================================================================');
    process.exit(1);
  }

  if (isSseMode) {
    // Modo SSE Express Gateway (para conexões remotas via URL e Deploy)
    await startSseServer();
  } else {
    // Modo Stdio tradicional (usado por integradores locais como Claude Desktop/Gemini/etc.)
    await startMcpEngine(serverId!);
  }
}

main().catch((err) => {
  console.error('[MCP Fatal Boot Error]:', err);
  process.exit(1);
});
