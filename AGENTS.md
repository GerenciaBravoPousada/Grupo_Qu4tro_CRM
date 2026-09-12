# Regras de Desenvolvimento e Operação do Grupo Qu4tro CRM

## 🚀 Publicação e Deploy Online (GitHub Pages)

- **Domínio de produção:** `https://crm-grupo-qu4tro.iconiko.com.br/`
- **Branch oficial de Deploy do GitHub Pages:** `gh-pages` (NÃO apenas `main`).
- **Comando obrigatório para colocar alterações online:**
  ```bash
  git push origin main
  git push origin main:gh-pages
  ```
- **Regra:** O GitHub Pages possui proteção configurada para publicar estritamente a partir da branch `gh-pages`. Qualquer deploy que seja enviado apenas para a `main` **não entrará no ar**.
- **Validação:** Sempre verificar se o workflow `pages build and deployment` no GitHub Actions finalizou com sucesso e validar o retorno HTTP do domínio antes de afirmar que as alterações estão no ar.
- **Cache:** Lembrar o usuário de usar `Ctrl + F5` para ignorar o cache de 10 minutos (`max-age=600`) do GitHub Pages / Cloudflare.
