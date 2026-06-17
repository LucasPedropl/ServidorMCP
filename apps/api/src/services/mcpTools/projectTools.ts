import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { ServerRecord } from '../../repositories/mcpRepository.js';

/**
 * Sanitiza o nome da categoria para evitar Path Traversal e caracteres invalidos.
 */
function sanitizeCategoryName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}

/**
 * Localiza a pasta .project-rules/ na raiz do workspace ou a cria.
 */
function getRulesDirPath(startDir: string): string {
  let currentDir = path.resolve(startDir);
  let repoRoot: string | null = null;

  while (true) {
    const rulesPath = path.join(currentDir, '.project-rules');
    if (fs.existsSync(rulesPath) && fs.statSync(rulesPath).isDirectory()) {
      return rulesPath;
    }

    // Identifica se e a raiz do repositorio pelo arquivo .git ou package.json do monorepo
    if (fs.existsSync(path.join(currentDir, '.git')) || fs.existsSync(path.join(currentDir, 'package.json'))) {
      repoRoot = currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Chegou na raiz do disco
    }
    currentDir = parentDir;
  }

  // Se nao achou .project-rules mas achou a raiz do repo, cria la
  if (repoRoot) {
    const rulesPath = path.join(repoRoot, '.project-rules');
    if (!fs.existsSync(rulesPath)) {
      try {
        fs.mkdirSync(rulesPath, { recursive: true });
        console.error(`[ProjectTools] Criado diretorio .project-rules na raiz: ${rulesPath}`);
      } catch (err: any) {
        console.error(`[ProjectTools] Erro ao criar diretorio .project-rules:`, err.message);
      }
    }
    return rulesPath;
  }

  // Fallback: cria no diretorio inicial
  const fallbackRulesPath = path.join(startDir, '.project-rules');
  if (!fs.existsSync(fallbackRulesPath)) {
    try {
      fs.mkdirSync(fallbackRulesPath, { recursive: true });
    } catch (e) {
      // Ignora erro de permissao no fallback
    }
  }
  return fallbackRulesPath;
}

/**
 * Migra o arquivo project_rules.md legado na raiz do repositorio para .project-rules/geral.md se existir.
 */
function migrateLegacyRules(rulesDirPath: string) {
  const repoRoot = path.dirname(rulesDirPath);
  const legacyFile = path.join(repoRoot, 'project_rules.md');
  const targetFile = path.join(rulesDirPath, 'geral.md');

  if (fs.existsSync(legacyFile) && !fs.existsSync(targetFile)) {
    try {
      const content = fs.readFileSync(legacyFile, 'utf8');
      fs.writeFileSync(targetFile, content, 'utf8');
      console.error(`[ProjectTools] Migrado project_rules.md para .project-rules/geral.md com sucesso.`);
    } catch (err: any) {
      console.error(`[ProjectTools] Falha ao migrar arquivo legado project_rules.md:`, err.message);
    }
  }
}

export function registerProjectTools(mcp: McpServer, serverRecord: ServerRecord) {
  
  // 1. Listar Categorias de Regras
  mcp.tool(
    'listar_regras_projeto',
    'Lista todas as categorias de regras, diretrizes e instrucoes cadastradas no projeto.',
    {
      caminhoWorkspace: z.string().optional().describe('Caminho absoluto opcional para o workspace do projeto.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "listar_regras_projeto"`);
      try {
        const startDir = args.caminhoWorkspace || process.cwd();
        const rulesDir = getRulesDirPath(startDir);
        migrateLegacyRules(rulesDir);

        if (!fs.existsSync(rulesDir)) {
          return {
            content: [{ type: 'text', text: 'Nenhum diretorio de regras encontrado ou criado no local especificado.' }]
          };
        }

        const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
        if (files.length === 0) {
          return {
            content: [{ type: 'text', text: 'Nenhuma regra ou categoria cadastrada ainda na pasta .project-rules/.' }]
          };
        }

        const listagem = files.map(f => {
          const name = path.basename(f, '.md');
          const stats = fs.statSync(path.join(rulesDir, f));
          return `- **${name}** (${stats.size} bytes, atualizado em ${stats.mtime.toLocaleDateString()})`;
        }).join('\n');

        return {
          content: [{
            type: 'text',
            text: `### Categorias de Regras Encontradas (.project-rules/):\n\n${listagem}\n\nUse "obter_regras_projeto" informando o nome da categoria para carregar as regras especificas.`
          }]
        };
      } catch (err: any) {
        console.error(`[ProjectTools] Erro ao listar regras:`, err);
        return {
          content: [{ type: 'text', text: `Erro ao listar regras: ${err.message}` }]
        };
      }
    }
  );

  // 2. Obter Regras do Projeto (Filtradas ou Geral)
  mcp.tool(
    'obter_regras_projeto',
    'Le o conteudo das diretrizes do projeto. Pode retornar tudo ou filtrar por uma categoria especifica (ex: frontend, backend).',
    {
      categoria: z.string().optional().describe('Nome da categoria especifica a ser lida (ex: frontend, backend). Se omitido, le todas as categorias cadastradas.'),
      caminhoWorkspace: z.string().optional().describe('Caminho absoluto opcional para o workspace do projeto.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "obter_regras_projeto" com args:`, JSON.stringify(args));
      try {
        const startDir = args.caminhoWorkspace || process.cwd();
        const rulesDir = getRulesDirPath(startDir);
        migrateLegacyRules(rulesDir);

        if (!fs.existsSync(rulesDir)) {
          return {
            content: [{ type: 'text', text: 'Diretorio de regras nao configurado e nao foi possivel cria-lo.' }]
          };
        }

        // Se uma categoria especifica foi solicitada
        if (args.categoria) {
          const cleanName = sanitizeCategoryName(args.categoria);
          const filePath = path.join(rulesDir, `${cleanName}.md`);
          
          if (!fs.existsSync(filePath)) {
            // Tenta fallback para o banco Supabase se for a categoria geral e nao existir no disco
            if (cleanName === 'geral' || cleanName === 'rules' || cleanName === 'project') {
              const dbPrompt = (serverRecord as any).project_prompt;
              if (dbPrompt && typeof dbPrompt === 'string' && dbPrompt.trim() !== '') {
                return {
                  content: [{
                    type: 'text',
                    text: `### Diretrizes do Projeto (Carregadas do Banco de Dados)\n\n${dbPrompt}`
                  }]
                };
              }
            }
            
            return {
              content: [{ type: 'text', text: `A categoria "${args.categoria}" nao foi encontrada localmente em .project-rules/. Use "listar_regras_projeto" para ver as disponiveis.` }]
            };
          }

          const content = fs.readFileSync(filePath, 'utf8');
          return {
            content: [{
              type: 'text',
              text: `### Regras do Projeto: Categoria [${cleanName}]\n\n${content}`
            }]
          };
        }

        // Se nenhuma categoria foi especificada, le todos os arquivos markdown da pasta e concatena
        const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
        if (files.length === 0) {
          // Tenta ler o prompt do banco como fallback geral
          const dbPrompt = (serverRecord as any).project_prompt;
          if (dbPrompt && typeof dbPrompt === 'string' && dbPrompt.trim() !== '') {
            return {
              content: [{
                type: 'text',
                text: `### Diretrizes do Projeto (Carregadas do Banco de Dados - Sem regras locais cadastradas)\n\n${dbPrompt}`
              }]
            };
          }

          return {
            content: [{ type: 'text', text: 'Nenhuma regra configurada localmente ou no banco de dados. Use a ferramenta "salvar_regra_projeto" para adicionar a primeira.' }]
          };
        }

        let fullContent = '';
        for (const file of files) {
          const catName = path.basename(file, '.md');
          const filePath = path.join(rulesDir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          fullContent += `## Categoria: ${catName}\n\n${content}\n\n---\n\n`;
        }

        return {
          content: [{
            type: 'text',
            text: `# Diretrizes Globais do Projeto (Carregadas de .project-rules/)\n\n${fullContent}`
          }]
        };
      } catch (err: any) {
        console.error(`[ProjectTools] Erro ao obter regras do projeto:`, err);
        return {
          content: [{ type: 'text', text: `Erro ao obter regras do projeto: ${err.message}` }]
        };
      }
    }
  );

  // 3. Salvar/Atualizar Regra do Projeto
  mcp.tool(
    'salvar_regra_projeto',
    'Cria ou atualiza as diretrizes de uma categoria especifica do projeto (ex: frontend, backend, clean_code). Use esta ferramenta para registrar aprendizados e novos padroes de arquitetura decididos ao longo do desenvolvimento.',
    {
      categoria: z.string().describe('Nome da categoria/regras a ser salva (ex: frontend, backend, clean_code).'),
      conteudo: z.string().describe('Conteudo completo das regras ou anotacoes de aprendizado em formato Markdown.'),
      caminhoWorkspace: z.string().optional().describe('Caminho absoluto opcional para o workspace do projeto.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "salvar_regra_projeto" para a categoria "${args.categoria}"`);
      try {
        const startDir = args.caminhoWorkspace || process.cwd();
        const rulesDir = getRulesDirPath(startDir);

        if (!fs.existsSync(rulesDir)) {
          fs.mkdirSync(rulesDir, { recursive: true });
        }

        const cleanName = sanitizeCategoryName(args.categoria);
        if (!cleanName) {
          throw new Error('Nome de categoria invalido. Deve conter apenas letras, numeros, hifens ou sublinhados.');
        }

        const filePath = path.join(rulesDir, `${cleanName}.md`);
        fs.writeFileSync(filePath, args.conteudo, 'utf8');

        console.error(`[ProjectTools] Regra [${cleanName}] salva com sucesso em: ${filePath}`);
        return {
          content: [{
            type: 'text',
            text: `Sucesso: Diretrizes da categoria "${cleanName}" salvas com sucesso localmente em ".project-rules/${cleanName}.md".`
          }]
        };
      } catch (err: any) {
        console.error(`[ProjectTools] Erro ao salvar regra do projeto:`, err);
        return {
          content: [{ type: 'text', text: `Erro ao salvar regra: ${err.message}` }]
        };
      }
    }
  );

  // 4. Deletar Regra do Projeto
  mcp.tool(
    'deletar_regra_projeto',
    'Exclui permanentemente as regras de uma categoria especifica do projeto.',
    {
      categoria: z.string().describe('Nome da categoria a ser excluida.'),
      caminhoWorkspace: z.string().optional().describe('Caminho absoluto opcional para o workspace do projeto.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "deletar_regra_projeto" para a categoria "${args.categoria}"`);
      try {
        const startDir = args.caminhoWorkspace || process.cwd();
        const rulesDir = getRulesDirPath(startDir);
        const cleanName = sanitizeCategoryName(args.categoria);
        const filePath = path.join(rulesDir, `${cleanName}.md`);

        if (!fs.existsSync(filePath)) {
          return {
            content: [{ type: 'text', text: `A categoria "${args.categoria}" nao existe ou ja foi removida.` }]
          };
        }

        fs.unlinkSync(filePath);
        console.error(`[ProjectTools] Regra [${cleanName}] excluida do disco: ${filePath}`);
        return {
          content: [{
            type: 'text',
            text: `Sucesso: Categoria de regras "${cleanName}" foi removida com sucesso de ".project-rules/".`
          }]
        };
      } catch (err: any) {
        console.error(`[ProjectTools] Erro ao deletar regra do projeto:`, err);
        return {
          content: [{ type: 'text', text: `Erro ao deletar regra: ${err.message}` }]
        };
      }
    }
  );
}
