# Regras de Deploy e Publicação em Produção

## ⚠️ REGRA CRÍTICA: DEPLOY NO GITHUB PAGES

O site em produção deste projeto (**crm-grupo-qu4tro.iconiko.com.br**) é publicado via **GitHub Pages** a partir da branch **`gh-pages`** (e NÃO da `main`).

### 1. Sincronização Obrigatória das Duas Branches
Sempre que fizer alterações que devam ir para o ar / produção, você **DEVE OBRIGATORIAMENTE** fazer o push para **AMBAS** as branches:
```bash
git push origin main
git push origin main:gh-pages
```
- Apenas enviar para `main` **NÃO** atualiza o site no ar.
- O ambiente `github-pages` tem regras de proteção configuradas no GitHub que só autorizam deploy a partir da branch `gh-pages`.

### 2. Verificação Obrigatória Pós-Deploy
Após fazer o `push`, **NUNCA** declare que está online sem antes verificar:
1. Consultar a API do GitHub Actions ou executar um script de verificação para checar se o workflow `pages build and deployment` completou com `status: completed` e `conclusion: success`.
2. Fazer requisição para `https://crm-grupo-qu4tro.iconiko.com.br/` checando se o conteúdo novo já consta no HTML retornado.

### 3. Orientação ao Usuário sobre Cache
O GitHub Pages utiliza cache intermediário com cabeçalho `Cache-Control: max-age=600` (até 10 minutos) e o navegador armazena a versão anterior em cache local.
Sempre instrua o usuário a usar **`Ctrl + F5`** (ou `Cmd + Shift + R`) para forçar o recarregamento limpo.
