# GRUPO QU4TRO — GESTÃO DE CLIENTES
## Manual do Proprietário e Instruções de Uso

Bem-vindo ao novo sistema **GRUPO QU4TRO — Gestão de Clientes**.

Este projeto foi construído do zero, sendo **100% independente e isolado** do Bravo Analytics (novo repositório, novo banco de dados, nova infraestrutura e deploy exclusivo).

---

### 🏪 Estabelecimentos Integrados
O sistema foi desenhado nativamente com a identidade e regras operacionais dos três restaurantes do Grupo Qu4tro:
1. **Leña Casa Italiana**
2. **Iconiko Cozinha Japonesa**
3. **Bravo Café**

---

### 👥 Modelo de Dados: Base de Clientes (Grupo)
Conforme definido, a base de clientes é **Unificada a nível de Grupo**:
- O cliente possui **um único cadastro central** no Grupo Qu4tro (identificado pelo número de telefone / WhatsApp).
- O sistema registra o histórico individual de passagens, frequência e preferências por casa:
  - Total de visitas ao **Leña**
  - Total de visitas ao **Iconiko**
  - Total de visitas ao **Bravo Café**
  - Primeira casa onde o cliente foi acolhido
  - Origem da captação (Instagram, Indicação, Google, QR Code da mesa)
  - Segmento automático: *VIP Ativo*, *Recorrente*, *Novo*, *Em Risco* e *Cross-selling* (ex: cliente que frequenta o Leña, mas ainda não conhece o Iconiko).

---

## 🚀 1. Como Usar o Sistema Agora (No Seu Computador)
Você não precisa de nenhum programa especial instalado para começar a testar:
1. Abra a pasta `GRUPO QU4TRO_Gestão de Clientes` no seu computador.
2. Dê **dois cliques no arquivo `index.html`**.
3. O sistema abrirá imediatamente no seu navegador de internet (Chrome, Edge ou Safari), pronto para uso:
   - **Visão Geral:** Métricas consolidadas e gráficos por casa.
   - **Clientes:** Busca instantânea por nome ou telefone, perfil 360° com histórico completo.
   - **Check-in da Recepção:** Entrada rápida de clientes na porta com seleção da casa e identificação automática de quem já é cliente.
   - **Reservas:** Gestão de reservas com status (Pendente, Confirmada, Convertida em check-in).
   - **QR Codes:** Links e QR Codes gerados para os totens/mesas de cada restaurante para autocadastro pelo cliente.
   - **Segmentos & Inteligência:** Clientes em risco para campanhas de retorno e público VIP.

---

## ☁️ 2. Passos para Colocar o Sistema Online na Internet

Quando desejar colocar o sistema no ar para as equipes usarem em celulares, tablets ou computadores em cada restaurante, siga os 3 passos simples abaixo:

### Passo 1: Criar o Novo Repositório no GitHub
1. Acesse o seu [GitHub](https://github.com/) (na nova conta ou organização exclusiva do Grupo Qu4tro).
2. Clique em **"New Repository"** (Novo Repositório).
3. Dê o nome de: `grupo-qu4tro-gestao-clientes`.
4. Deixe como **Privado** e clique em **Create repository**.
5. Faça o upload dos arquivos desta pasta:
   - `index.html`
   - `vercel.json`
   - `supabase_schema.sql`
   - `.env.example`
   - `MANUAL_DO_PROJETO.md`

### Passo 2: Criar o Banco de Dados no Supabase
1. Acesse [supabase.com](https://supabase.com/) e crie um **novo projeto** chamado `grupo-qu4tro-gestao`.
2. No menu lateral esquerdo, clique no ícone **SQL Editor**.
3. Clique em **New query**.
4. Abra o arquivo `supabase_schema.sql` deste projeto, copie todo o conteúdo e cole no editor do Supabase.
5. Clique no botão verde **Run** (Executar).
   - *Pronto! Suas tabelas de estabelecimentos, clientes, visitas, reservas e regras de segurança estarão criadas e ativas.*

### Passo 3: Publicar na Vercel (Deploy)
1. Acesse [vercel.com](https://vercel.com/) (com a nova conta da organização).
2. Clique em **"Add New..."** ➔ **Project**.
3. Selecione o repositório `grupo-qu4tro-gestao-clientes` do GitHub.
4. Clique em **Deploy**.
5. Em menos de 1 minuto, seu sistema estará no ar em um link seguro com cadeado SSL (HTTPS), como:
   `https://grupo-qu4tro-gestao-clientes.vercel.app` (ou o domínio próprio que desejar configurar).

---

## 🔒 Segurança e Isolamento
- Nenhum dado, credencial ou configuração do Bravo Analytics foi misturado a este projeto.
- O sistema possui identificadores e chaves próprias de armazenamento (`qu4tro_reception_house`, `grupo_qu4tro_clientes.csv`, etc.).
- Caso tenha qualquer dúvida ou precise de novos ajustes, estamos à disposição!

---

## 🏆 Marco do Projeto: Versão 1.0.0 — 100% Funcional
- **Status:** Homologado e 100% funcional em produção (`crm-grupo-qu4tro.iconiko.com.br`).
- **Data do marco:** 11/09/2026.
- **Destaques:**
  - **Identidade visual por empresa:** Logos oficiais de cada restaurante (Iconiko Cozinha Japonesa, Bravo Café, Leña Casa Italiana, Café da Bravo Pousada e Grupo Qu4tro) vinculadas nativamente.
  - **Sincronização global do Seletor de Empresa:** A seleção da empresa no topo atualiza em tempo real a logo, o banner de contexto e todos os módulos (Visão Geral/Dashboard com KPIs e gráficos, Clientes, Check-in presencial com estatísticas de hoje, Reservas, Configurações, Fila de Espera, Mapa de Mesas, Segmentos e Inteligência).
  - **Controle de acesso por perfil:** Master, Gerente e Atendimento com permissões e navegações segmentadas.

