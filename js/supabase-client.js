// ============================================================================
// Configuração da conexão com o Supabase.
//
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os valores do seu projeto
// (Supabase Studio → Project Settings → API).
//
// A "anon key" é segura para deixar pública neste arquivo (e no GitHub): ela
// só permite o que as políticas de Row Level Security (RLS) definidas em
// supabase/schema.sql autorizam. A segurança real dos dados vem do RLS, não
// do sigilo desta chave.
// ============================================================================

const SUPABASE_URL = 'https://wnwoehbkjncyapprxyqt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wixF3Q0rbpYxGrJpOfXPqg_hUOcuQxZ';

if (typeof window.supabase === 'undefined') {
  throw new Error(
    'Biblioteca @supabase/supabase-js não carregada. Verifique se o <script> do CDN está antes de supabase-client.js.'
  );
}

// Client único, compartilhado entre a vitrine (store.js) e o painel (admin.js).
window.sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
