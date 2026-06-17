# Relatório de Sincronização - PagWebV1
**Data:** 20 de maio de 2026

## Resumo das Alterações
- **Total de Endpoints no Swagger:** 74
- **Endpoints Adicionados:** 1
- **Endpoints Modificados:** 73
- **Endpoints Removidos:** 0

---

## 🆕 Endpoints Adicionados
- `[GET] /api/v1/Empresa` (get_api_v1_Empresa)

---

## 🛠️ Endpoints Modificados
Abaixo estão os principais endpoints que sofreram ajustes em seus contratos de parâmetros e payloads:

### Assinaturas
- `[POST] /api/v1/Assinatura`
- `[GET] /api/v1/Assinatura/empresa`
- `[PATCH] /api/v1/Assinatura/{id}`
- `[DELETE] /api/v1/Assinatura/assinatura/{id}`

### Cartões
- `[GET] /api/Cartao/meus-cartoes`
- `[POST] /api/Cartao/cadastrar`
- `[PATCH] /api/Cartao/editar/{id}`
- `[DELETE] /api/Cartao/remover/{id}`
- `[POST] /api/Cartao/resetar-padrao/{idUser}`

### Empresa e Endereços
- `[POST] /api/v1/Empresa`
- `[PATCH] /api/v1/Empresa/{id}`
- `[DELETE] /api/v1/Empresa/{id}`
- `[POST] /api/v1/Endereco/usuario`
- `[POST] /api/v1/Endereco/empresa`
- `[PATCH] /api/v1/Endereco/{id}`

### Mensalidades e Pagamentos
- `[GET] /api/v1/Mensalidade/empresa`
- `[GET] /api/v1/Mensalidade/cliente`
- `[DELETE] /api/v1/Mensalidade/{id}/cancelar`
- `[POST] /api/v1/Pagamento/confirmar`
- `[DELETE] /api/v1/Pagamento/Cancelar`
- `[POST] /api/v1/Pagamento/{idPagamento}/confirmar-repasse`
- `[GET] /api/v1/Pagamento/pendentes-repasse`
- `[GET] /api/v1/Pagamento/Busca`

### Planos
- `[POST] /api/v1/Plano`
- `[GET] /api/v1/Plano/empresa`
- `[GET] /api/v1/Plano/{idPlano}`
- `[DELETE] /api/v1/Plano/{id}`
- `[PATCH] /api/v1/Plano/{id}`
- `[GET] /api/v1/Plano/empresa/{idEmpresa}`

### Usuários e Autenticação
- `[POST] /api/v1/User/register`
- `[POST] /api/v1/User/activate`
- `[POST] /api/v1/User/login-cliente`
- `[DELETE] /api/v1/User/{id}`
- `[PATCH] /api/v1/User/{id}`
- `[GET] /api/v1/User/minha-conta`
- `[GET] /api/v1/User/minhas-conexoes`
- `[GET] /api/v1/User/minhas-assinaturas`
- `[PATCH] /api/v1/User/minha-conexao/{idEmpresa}`
- `[PATCH] /api/v1/User/minha-assinatura/{idAssinatura}/{status}`
- `[POST] /api/v1/User/conectar-empresa/{idEmpresa}`
- `[POST] /api/v1/User/assinar-plano/{idPlano}`
- `[POST] /api/v1/User/login-admin`
- `[POST] /api/v1/User/conecta-admin/{id}`
- `[POST] /api/v1/User/admin/conecta-cliente`
- `[DELETE] /api/v1/User/admin/desconecta-cliente/{idUser}`
- `[PATCH] /api/v1/User/minha-conexao/desconectar/{idEmpresa}`
- `[GET] /api/v1/User/admin/clientes`
- `[GET] /api/v1/User/minha-empresa`

### WhatsApp e Notificações
- `[GET] /api/v1/WhatsApps/verificar`
- `[GET] /api/v1/WhatsApps/criar`
- `[DELETE] /api/v1/WhatsApps/desconectar`
- `[GET] /api/v1/WhatsApps/qrcode`
- `[POST] /api/v1/WhatsApps/EnviarMsg`
- `[GET] /api/v1/Notificacao/pegar`
- `[DELETE] /api/v1/Notificacao/limpar-todas`

### Ferramentas de Desenvolvimento (Dev/Reset)
- `[GET] /api/zTemporario/dev/lista-usuarios`
- `[GET] /api/zTemporario/dev/lista-empresas`
- `[GET] /api/zTemporario/dev/lista-assinatura`
- `[GET] /api/zTemporario/dev/lista-pagamentos`
- `[DELETE] /api/zTemporario/dev/danger-reset-database`

---
*Nota: A maioria das modificações refere-se a atualizações na estrutura de mapeamento de parâmetros no servidor MCP para alinhar com o Swagger 2.0.*
