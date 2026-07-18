# BG Collection & Co

Loja online de bolsas e acessórios, com painel administrativo. HTML/CSS/JS puro (sem framework, sem build step), usando [Supabase](https://supabase.com) como backend (banco de dados, autenticação e armazenamento de fotos).

## Estrutura

```
index.html            → vitrine pública da loja
admin.html             → painel administrativo (login necessário)
css/styles.css          → estilos compartilhados (tema "rose gold")
js/store.js               → lógica da vitrine
js/admin.js                 → lógica do painel admin
js/supabase-client.js         → chaves e client do Supabase
supabase/schema.sql            → script de configuração do banco
```

## 1. Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor** e rode o conteúdo de `supabase/schema.sql`. Isso cria as tabelas (`products`, `orders`, `store_settings`), o bucket de fotos (`product-photos`) e as regras de segurança (RLS).
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. Abra `js/supabase-client.js` e substitua:
   ```js
   const SUPABASE_URL = 'SUA_SUPABASE_URL_AQUI';
   const SUPABASE_ANON_KEY = 'SUA_SUPABASE_ANON_KEY_AQUI';
   ```
   A anon key é segura para deixar pública/no GitHub — a segurança real vem das políticas de RLS já criadas pelo schema.
5. Crie o usuário administrativo em **Authentication → Users → Add user** (e-mail + senha). Não existe autocadastro pelo painel — o acesso é só para quem você criar manualmente aqui.

## 2. Rodar localmente

Qualquer servidor estático funciona, por exemplo:

```bash
npx serve .
```

Depois abra `http://localhost:3000` (vitrine) e `http://localhost:3000/admin.html` (painel).

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba este projeto.
2. Em **Settings → Pages**, selecione o branch principal (`main`) e a pasta raiz (`/`).
3. O site ficará disponível em `https://<seu-usuario>.github.io/<nome-do-repo>/`.

Como não há build step, o GitHub Pages serve os arquivos diretamente — não é necessário nenhum passo extra de compilação.

## Categorias suportadas

Bolsas, Pulseiras, Relógios, Brincos, Cintos, Lenços.

## Segurança (RLS)

- Qualquer visitante pode **ler** produtos e configurações da loja, e **criar** pedidos.
- Apenas usuários autenticados (login no painel) podem criar/editar/excluir produtos, editar configurações e ler a lista de pedidos.
