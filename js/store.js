// ============================================================================
// Vitrine — BG Collection & Co
// Lê produtos e configurações do Supabase, gerencia o carrinho (localStorage)
// e finaliza o pedido registrando no banco e abrindo o WhatsApp.
// ============================================================================

(function () {
  'use strict';

  const CATEGORIES = ['Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços', 'Colares', 'Óculos', 'Berloques', 'Anéis'];
  const CART_STORAGE_KEY = 'bg_cart_v1';
  const SESSION_STORAGE_KEY = 'bg_session_id_v1';
  const FAVORITES_STORAGE_KEY = 'bg_favorites_v1';

  const state = {
    settings: null,
    products: [],
    activeCategory: 'Todos',
    cart: loadCart(),
    lightboxProduct: null,
    lightboxIndex: 0,
    pendingBackorderProduct: null,
    appliedCoupon: null,
    favorites: loadFavorites(),
    showFavoritesOnly: false,
    searchTerm: '',
  };

  // -- Helpers --------------------------------------------------------------

  function formatBRL(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('Não foi possível ler o carrinho salvo:', err);
      return [];
    }
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (err) {
      console.error('Não foi possível ler os favoritos salvos:', err);
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
    } catch (err) {
      console.error('Não foi possível salvar os favoritos:', err);
    }
  }

  function toggleFavorite(productId) {
    if (state.favorites.has(productId)) {
      state.favorites.delete(productId);
    } else {
      state.favorites.add(productId);
    }
    saveFavorites();
    renderFavoritesBadge();
    renderProducts();
    renderFeaturedGrid();
  }

  function renderFavoritesBadge() {
    const badge = document.getElementById('favorites-badge');
    const count = state.favorites.size;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
    document.getElementById('favorites-toggle-btn').classList.toggle('active', state.showFavoritesOnly);
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch (err) {
      console.error('Não foi possível salvar o carrinho:', err);
    }
    syncCartSession();
  }

  // -- Métricas: acessos e carrinho não finalizado (anônimo, sem PII) -------

  function getSessionId() {
    let id = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!id) {
      id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(SESSION_STORAGE_KEY, id);
    }
    return id;
  }

  function trackVisit() {
    window.sbClient
      .from('site_visits')
      .insert({ session_id: getSessionId() })
      .then(({ error }) => {
        if (error) console.error('Não foi possível registrar a visita:', error);
      });
  }

  let cartSyncTimer = null;
  function syncCartSession() {
    clearTimeout(cartSyncTimer);
    cartSyncTimer = setTimeout(async () => {
      const sessionId = getSessionId();
      try {
        if (state.cart.length === 0) {
          await window.sbClient.from('cart_sessions').delete().eq('session_id', sessionId);
        } else {
          await window.sbClient.from('cart_sessions').upsert({
            session_id: sessionId,
            items: state.cart,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Não foi possível sincronizar o carrinho:', err);
      }
    }, 1500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // -- Carregamento de dados --------------------------------------------------

  async function loadSettings() {
    try {
      const { data, error } = await window.sbClient
        .from('store_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;
      state.settings = data;
      applySettingsToPage();
      renderHero();
    } catch (err) {
      console.error('Erro ao carregar configurações da loja:', err);
      showToast('Não foi possível carregar as configurações da loja.', 'error');
    }
  }

  function applySettingsToPage() {
    const s = state.settings;
    if (!s) return;

    document.title = s.store_name || 'BG Collection & Co';
    document.getElementById('store-name').textContent = s.store_name || 'BG Collection & Co';
    document.getElementById('footer-text').innerHTML =
      `© <span id="footer-year"></span> ${escapeHtml(s.store_name || 'BG Collection & Co')}. Todos os direitos reservados.`;
    document.getElementById('footer-year').textContent = new Date().getFullYear();

    const instagramLink = document.getElementById('instagram-link');
    if (instagramLink) {
      if (s.instagram_handle) {
        const handle = s.instagram_handle.replace(/^@/, '');
        instagramLink.href = `https://instagram.com/${encodeURIComponent(handle)}`;
      } else {
        instagramLink.style.display = 'none';
      }
    }

    const whatsappLink = document.getElementById('whatsapp-link');
    if (whatsappLink) {
      if (s.whatsapp_number) {
        whatsappLink.href = `https://wa.me/${s.whatsapp_number.replace(/\D/g, '')}`;
      } else {
        whatsappLink.style.display = 'none';
      }
    }
  }

  function renderHero() {
    const wrap = document.getElementById('hero-destaque');
    const photo = state.settings && state.settings.hero_photo_url;

    wrap.innerHTML = photo
      ? `<div class="hero__photo"><img src="${escapeHtml(photo)}" alt="" /></div>`
      : '<div class="hero__photo"><div class="hero__photo-empty">Sem foto ainda</div></div>';
  }

  async function loadProducts() {
    const stateBanner = document.getElementById('products-state');
    const grid = document.getElementById('product-grid');

    try {
      const { data, error } = await window.sbClient
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.products = data || [];
      stateBanner.classList.add('hidden');
      grid.classList.remove('hidden');
      renderStoreNav();
      renderCategoryTabs();
      renderProducts();
      renderFeaturedGrid();
      reconcileCartWithProducts();
    } catch (err) {
      console.error('Erro ao carregar produtos:', err);
      stateBanner.innerHTML = '<p>Não foi possível carregar os produtos agora. Tente recarregar a página.</p>';
      stateBanner.classList.add('error');
    }
  }

  // Remove do carrinho itens de produtos que foram excluídos/desativados, e
  // ajusta a quantidade se o estoque atual for menor do que o que está no
  // carrinho. Roda sempre que a lista de produtos é (re)carregada.
  function reconcileCartWithProducts() {
    const removed = [];
    const adjusted = [];

    state.cart = state.cart.filter((item) => {
      const product = state.products.find((p) => p.id === item.productId);

      if (!product || product.stock_quantity <= 0) {
        removed.push(item.name);
        return false;
      }

      if (item.quantity > product.stock_quantity) {
        item.quantity = product.stock_quantity;
        adjusted.push(item.name);
      }

      return true;
    });

    if (removed.length === 0 && adjusted.length === 0) return;

    saveCart();
    renderCartBadge();

    if (removed.length > 0) {
      showToast(`Removido do carrinho (não está mais disponível): ${removed.join(', ')}.`, 'error');
    }
    if (adjusted.length > 0) {
      showToast(`Quantidade ajustada por causa do estoque: ${adjusted.join(', ')}.`, 'error');
    }
  }

  // -- Categorias e grid --------------------------------------------------

  function categoryPhoto(cat) {
    const product = cat === 'Todos'
      ? state.products.find((p) => (p.photo_urls || []).length)
      : state.products.find((p) => p.category === cat && (p.photo_urls || []).length);
    return product ? product.photo_urls[0] : '';
  }

  function selectCategory(cat) {
    state.activeCategory = cat;
    state.showFavoritesOnly = false;
    renderFavoritesBadge();
    renderCategoryTabs();
    renderStoreNav();
    renderProducts();
    document.getElementById('category-tabs').scrollIntoView({ behavior: 'smooth' });
  }

  function renderCategoryTabs() {
    const nav = document.getElementById('category-tabs');
    const present = CATEGORIES.filter((cat) => state.products.some((p) => p.category === cat));
    const tabs = ['Todos', ...present];

    nav.innerHTML = '';
    tabs.forEach((cat) => {
      const photo = categoryPhoto(cat);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'category-circle' + (!state.showFavoritesOnly && cat === state.activeCategory ? ' active' : '');
      btn.innerHTML = `
        <span class="category-circle__img">${photo ? `<img src="${escapeHtml(photo)}" alt="" />` : '🛍️'}</span>
        <span>${escapeHtml(cat)}</span>
      `;
      btn.addEventListener('click', () => selectCategory(cat));
      nav.appendChild(btn);
    });
  }

  function renderStoreNav() {
    const nav = document.getElementById('store-nav');
    const present = CATEGORIES.filter((cat) => state.products.some((p) => p.category === cat));

    const links = [
      { label: 'Início', action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
      { label: 'Coleção', action: () => selectCategory('Todos') },
      ...present.map((cat) => ({ label: cat, action: () => selectCategory(cat) })),
      { label: 'Contato', action: () => document.querySelector('.store-footer').scrollIntoView({ behavior: 'smooth' }) },
    ];

    nav.innerHTML = '';
    links.forEach((link) => {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = link.label;
      if (!state.showFavoritesOnly && link.label === state.activeCategory) a.classList.add('active');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        link.action();
      });
      nav.appendChild(a);
    });
  }

  function buildProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';

    const outOfStock = product.stock_quantity <= 0;
    const photo = (product.photo_urls && product.photo_urls[0]) || '';
    const isFavorite = state.favorites.has(product.id);

    let badgeHtml = '';
    if (outOfStock) {
      badgeHtml = '<span class="product-card__badge">Esgotado</span>';
    } else if (product.is_featured) {
      badgeHtml = '<span class="product-card__badge badge-featured">Destaque</span>';
    } else if (product.badge === 'new') {
      badgeHtml = '<span class="product-card__badge badge-new">Novo</span>';
    } else if (product.badge === 'sale') {
      badgeHtml = '<span class="product-card__badge badge-sale">Sale</span>';
    }

    card.innerHTML = `
      <div class="product-card__photo-wrap">
        ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : ''}
        ${badgeHtml}
        <button type="button" class="product-card__fav${isFavorite ? ' active' : ''}" aria-label="Favoritar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
        </button>
      </div>
      <div class="product-card__body">
        <div class="product-card__name">${escapeHtml(product.name)}</div>
        <div class="product-card__price">${formatBRL(product.price)}</div>
        <button class="btn btn-sm product-card__add ${outOfStock ? 'btn-outline' : 'btn-primary'}">
          ${outOfStock ? 'Encomendar' : 'Adicionar'}
        </button>
      </div>
    `;

    card.querySelector('.product-card__photo-wrap').addEventListener('click', () => openLightbox(product));

    card.querySelector('.product-card__fav').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(product.id);
    });

    card.querySelector('.product-card__add').addEventListener('click', (e) => {
      e.stopPropagation();
      if (outOfStock) {
        openBackorder(product);
      } else {
        addToCart(product);
      }
    });

    return card;
  }

  function visibleProducts() {
    const term = state.searchTerm.trim().toLowerCase();
    return state.products.filter((p) => {
      if (state.showFavoritesOnly && !state.favorites.has(p.id)) return false;
      if (!state.showFavoritesOnly && state.activeCategory !== 'Todos' && p.category !== state.activeCategory) return false;
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }

  function renderProducts() {
    const grid = document.getElementById('product-grid');
    const list = visibleProducts();

    if (list.length === 0) {
      const msg = state.showFavoritesOnly ? 'Você ainda não favoritou nenhum produto.' : 'Nenhum produto encontrado.';
      grid.innerHTML = `<p class="state-banner">${msg}</p>`;
      return;
    }

    grid.innerHTML = '';
    list.forEach((product) => grid.appendChild(buildProductCard(product)));
  }

  function renderFeaturedGrid() {
    const section = document.getElementById('featured-section');
    const grid = document.getElementById('featured-grid');
    const list = state.products.filter((p) => p.is_featured || p.badge).slice(0, 10);

    if (list.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    grid.innerHTML = '';
    list.forEach((product) => grid.appendChild(buildProductCard(product)));
  }

  // -- Lightbox (galeria de fotos) --------------------------------------------

  function openLightbox(product) {
    state.lightboxProduct = product;
    state.lightboxIndex = 0;
    document.getElementById('lightbox-cat').textContent = product.category;
    document.getElementById('lightbox-name').textContent = product.name;
    document.getElementById('lightbox-price').textContent = formatBRL(product.price);

    const addBtn = document.getElementById('lightbox-addcart');
    const outOfStock = product.stock_quantity <= 0;
    addBtn.disabled = false;
    addBtn.textContent = outOfStock ? 'Encomendar' : 'Adicionar ao carrinho';
    addBtn.onclick = () => {
      if (outOfStock) {
        openBackorder(product);
      } else {
        addToCart(product);
        closeLightbox();
      }
    };

    renderLightbox();
    document.getElementById('lightbox-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    document.getElementById('lightbox-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    state.lightboxProduct = null;
  }

  function openBackorder(product) {
    if (!state.settings || !state.settings.whatsapp_number) {
      showToast('A loja ainda não configurou um número de WhatsApp. Tente novamente mais tarde.', 'error');
      return;
    }

    // Se já tem itens no carrinho, junta o pedido de encomenda no mesmo
    // checkout/mensagem em vez de abrir uma conversa separada no WhatsApp.
    if (state.cart.length > 0) {
      closeLightbox();
      state.pendingBackorderProduct = product;
      openCheckout();
      showToast(`"${product.name}" será incluído junto com o resto do seu pedido.`, 'success');
      return;
    }

    const message = `Olá! O produto "${product.name}" (${formatBRL(product.price)}) está esgotado. Gostaria de encomendar.`;
    const waNumber = state.settings.whatsapp_number.replace(/\D/g, '');
    const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank', 'noopener');
  }

  function renderLightbox() {
    const product = state.lightboxProduct;
    if (!product) return;

    const photos = product.photo_urls && product.photo_urls.length ? product.photo_urls : [];
    const wrap = document.getElementById('lightbox-img-wrap');
    wrap.innerHTML = photos.length
      ? `<img class="lightbox-img" src="${escapeHtml(photos[state.lightboxIndex])}" alt="${escapeHtml(product.name)}" />`
      : '<div class="lightbox-img" style="display:flex;align-items:center;justify-content:center;color:#fff;">Sem foto</div>';

    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    prevBtn.classList.toggle('hidden', state.lightboxIndex === 0 || photos.length <= 1);
    nextBtn.classList.toggle('hidden', state.lightboxIndex >= photos.length - 1 || photos.length <= 1);

    const thumbs = document.getElementById('lightbox-thumbs');
    const dots = document.getElementById('lightbox-dots');
    if (photos.length > 1) {
      thumbs.innerHTML = photos
        .map((src, i) => `<img class="lightbox-thumb${i === state.lightboxIndex ? ' active' : ''}" src="${escapeHtml(src)}" data-index="${i}" />`)
        .join('');
      thumbs.querySelectorAll('.lightbox-thumb').forEach((el) => {
        el.addEventListener('click', () => lightboxGoTo(Number(el.dataset.index)));
      });
      thumbs.style.display = 'flex';

      dots.innerHTML = photos
        .map((_, i) => `<button type="button" class="lightbox-dot${i === state.lightboxIndex ? ' active' : ''}" data-index="${i}" aria-label="Foto ${i + 1}"></button>`)
        .join('');
      dots.querySelectorAll('.lightbox-dot').forEach((el) => {
        el.addEventListener('click', () => lightboxGoTo(Number(el.dataset.index)));
      });
      dots.style.display = 'flex';
    } else {
      thumbs.style.display = 'none';
      dots.style.display = 'none';
    }
  }

  function lightboxNav(delta) {
    const product = state.lightboxProduct;
    if (!product) return;
    const total = (product.photo_urls && product.photo_urls.length) || 1;
    state.lightboxIndex = Math.max(0, Math.min(total - 1, state.lightboxIndex + delta));
    renderLightbox();
  }

  function lightboxGoTo(index) {
    state.lightboxIndex = index;
    renderLightbox();
  }

  // -- Carrinho --------------------------------------------------------------

  function addToCart(product) {
    const existing = state.cart.find((item) => item.productId === product.id);
    const currentQty = existing ? existing.quantity : 0;

    if (currentQty + 1 > product.stock_quantity) {
      showToast('Quantidade máxima em estoque atingida para este produto.', 'error');
      return;
    }

    if (existing) {
      existing.quantity += 1;
    } else {
      state.cart.push({
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        category: product.category,
        photo_url: (product.photo_urls && product.photo_urls[0]) || '',
        stock_quantity: product.stock_quantity,
        quantity: 1,
      });
    }

    saveCart();
    renderCartBadge();
    showToast(`${product.name} adicionado ao carrinho.`, 'success');
  }

  function changeQty(productId, delta) {
    const item = state.cart.find((i) => i.productId === productId);
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      state.cart = state.cart.filter((i) => i.productId !== productId);
    } else if (newQty > item.stock_quantity) {
      showToast('Quantidade máxima em estoque atingida para este produto.', 'error');
      return;
    } else {
      item.quantity = newQty;
    }

    saveCart();
    renderCart();
    renderCartBadge();
  }

  function removeFromCart(productId) {
    state.cart = state.cart.filter((i) => i.productId !== productId);
    saveCart();
    renderCart();
    renderCartBadge();
  }

  function cartSubtotal() {
    return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function cartDiscount() {
    if (!state.appliedCoupon) return 0;
    const subtotal = cartSubtotal();
    const coupon = state.appliedCoupon;
    const raw = coupon.discount_type === 'percent' ? subtotal * (Number(coupon.discount_value) / 100) : Number(coupon.discount_value);
    return Math.min(raw, subtotal);
  }

  function cartTotal() {
    return cartSubtotal() - cartDiscount();
  }

  async function applyCoupon() {
    const input = document.getElementById('coupon-input');
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    try {
      const { data, error } = await window.sbClient
        .from('coupons')
        .select('*')
        .eq('code', code)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;

      if (!data || (data.expires_at && new Date(data.expires_at) < new Date())) {
        showToast('Cupom inválido ou expirado.', 'error');
        return;
      }

      state.appliedCoupon = data;
      input.value = '';
      renderCart();
      showToast(`Cupom ${data.code} aplicado!`, 'success');
    } catch (err) {
      console.error('Erro ao aplicar cupom:', err);
      showToast('Não foi possível aplicar o cupom.', 'error');
    }
  }

  function removeCoupon() {
    state.appliedCoupon = null;
    renderCart();
  }

  function cartCount() {
    return state.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  function renderCartBadge() {
    const badge = document.getElementById('cart-badge');
    const count = cartCount();
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  function renderCart() {
    const itemsWrap = document.getElementById('cart-items');
    const footer = document.getElementById('cart-footer');

    if (state.cart.length === 0) {
      itemsWrap.innerHTML = '<p class="state-banner" id="cart-empty">Seu carrinho está vazio.</p>';
      footer.style.display = 'none';
      return;
    }

    footer.style.display = '';
    itemsWrap.innerHTML = '';

    state.cart.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        ${item.photo_url ? `<img class="cart-item__photo" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name)}" />` : '<div class="cart-item__photo"></div>'}
        <div class="cart-item__info">
          <div class="cart-item__name">${escapeHtml(item.name)}</div>
          <div class="cart-item__price">${formatBRL(item.price * item.quantity)}</div>
          <div class="qty-control">
            <button type="button" data-action="dec" aria-label="Diminuir quantidade">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-action="inc" aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="cart-item__remove">Remover</button>
        </div>
      `;

      row.querySelector('[data-action="dec"]').addEventListener('click', () => changeQty(item.productId, -1));
      row.querySelector('[data-action="inc"]').addEventListener('click', () => changeQty(item.productId, 1));
      row.querySelector('.cart-item__remove').addEventListener('click', () => removeFromCart(item.productId));

      itemsWrap.appendChild(row);
    });

    const subtotalRow = document.getElementById('cart-subtotal-row');
    const appliedInfo = document.getElementById('coupon-applied-info');
    const couponWrap = document.querySelector('.cart-drawer__coupon');

    if (state.appliedCoupon) {
      subtotalRow.style.display = '';
      document.getElementById('cart-subtotal').textContent = formatBRL(cartSubtotal());
      const label = state.appliedCoupon.discount_type === 'percent'
        ? `${state.appliedCoupon.discount_value}% off`
        : `${formatBRL(state.appliedCoupon.discount_value)} off`;
      appliedInfo.innerHTML = `<span>🎟️ ${escapeHtml(state.appliedCoupon.code)} — ${label}</span><button type="button" id="coupon-remove-btn">Remover</button>`;
      appliedInfo.classList.remove('hidden');
      appliedInfo.querySelector('#coupon-remove-btn').addEventListener('click', removeCoupon);
      couponWrap.style.display = 'none';
    } else {
      subtotalRow.style.display = 'none';
      appliedInfo.classList.add('hidden');
      couponWrap.style.display = '';
    }

    document.getElementById('cart-total').textContent = formatBRL(cartTotal());
  }

  function openCart() {
    renderCart();
    document.getElementById('cart-overlay').classList.remove('hidden');
  }

  function closeCart() {
    document.getElementById('cart-overlay').classList.add('hidden');
  }

  // -- Checkout --------------------------------------------------------------

  function openCheckout() {
    if (state.cart.length === 0) {
      showToast('Seu carrinho está vazio.', 'error');
      return;
    }
    closeCart();
    document.getElementById('checkout-modal').classList.remove('hidden');
  }

  function closeCheckout() {
    document.getElementById('checkout-modal').classList.add('hidden');
    state.pendingBackorderProduct = null;
  }

  function buildWhatsappMessage(order, customerName) {
    const lines = [`Olá! Meu nome é ${customerName} e gostaria de confirmar este pedido:`, ''];
    order.items.forEach((item) => {
      lines.push(`• ${item.quantity}x ${item.name} — ${formatBRL(item.price * item.quantity)}`);
    });
    lines.push('', `Subtotal: ${formatBRL(order.subtotal)}`);
    if (order.discount > 0) {
      lines.push(`Desconto (${order.coupon_code}): -${formatBRL(order.discount)}`);
    }
    lines.push(`Total: ${formatBRL(order.total)}`);
    if (order.note) {
      lines.push('', order.note);
    }
    return lines.join('\n');
  }

  async function submitCheckout(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('checkout-submit');
    const name = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('customer-phone').value.trim();

    if (!name || !phone) {
      showToast('Preencha nome e telefone para continuar.', 'error');
      return;
    }

    if (!state.settings || !state.settings.whatsapp_number) {
      showToast('A loja ainda não configurou um número de WhatsApp. Tente novamente mais tarde.', 'error');
      return;
    }

    const backorderProduct = state.pendingBackorderProduct;
    const orderPayload = {
      customer_name: name,
      customer_phone: phone,
      items: state.cart.map((item) => ({
        product_id: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        category: item.category,
      })),
      total: cartTotal(),
      coupon_code: state.appliedCoupon ? state.appliedCoupon.code : null,
      discount: cartDiscount(),
      note: backorderProduct
        ? `Também gostaria de encomendar (esgotado no momento): ${backorderProduct.name} — ${formatBRL(backorderProduct.price)}`
        : null,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const { error } = await window.sbClient.from('orders').insert(orderPayload);
      if (error) throw error;

      const message = buildWhatsappMessage({ ...orderPayload, subtotal: cartSubtotal() }, name);
      const waNumber = state.settings.whatsapp_number.replace(/\D/g, '');
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

      state.cart = [];
      state.pendingBackorderProduct = null;
      state.appliedCoupon = null;
      saveCart();
      renderCartBadge();
      closeCheckout();
      document.getElementById('checkout-form').reset();

      window.open(waUrl, '_blank', 'noopener');
      showToast('Pedido registrado! Continue no WhatsApp para confirmar.', 'success');

      loadProducts();
    } catch (err) {
      console.error('Erro ao registrar pedido:', err);
      showToast('Não foi possível registrar seu pedido. Tente novamente.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar pedido';
    }
  }

  // -- Eventos ----------------------------------------------------------------

  function bindEvents() {
    document.getElementById('cart-toggle-btn').addEventListener('click', openCart);
    document.getElementById('cart-close').addEventListener('click', closeCart);
    document.getElementById('cart-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'cart-overlay') closeCart();
    });

    document.getElementById('checkout-btn').addEventListener('click', openCheckout);
    document.getElementById('checkout-close').addEventListener('click', closeCheckout);
    document.getElementById('checkout-cancel').addEventListener('click', closeCheckout);
    document.getElementById('checkout-form').addEventListener('submit', submitCheckout);

    document.getElementById('coupon-apply-btn').addEventListener('click', applyCoupon);
    document.getElementById('coupon-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCoupon();
      }
    });

    document.getElementById('hero-cta').addEventListener('click', () => {
      document.getElementById('category-tabs').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('hero-cta-new').addEventListener('click', () => selectCategory('Todos'));

    document.getElementById('search-toggle-btn').addEventListener('click', () => {
      const bar = document.getElementById('store-search');
      bar.classList.toggle('hidden');
      if (!bar.classList.contains('hidden')) document.getElementById('store-search-input').focus();
    });
    document.getElementById('store-search-close').addEventListener('click', () => {
      document.getElementById('store-search').classList.add('hidden');
      document.getElementById('store-search-input').value = '';
      state.searchTerm = '';
      renderProducts();
    });
    document.getElementById('store-search-input').addEventListener('input', (e) => {
      state.searchTerm = e.target.value;
      renderProducts();
    });

    document.getElementById('favorites-toggle-btn').addEventListener('click', () => {
      state.showFavoritesOnly = !state.showFavoritesOnly;
      renderFavoritesBadge();
      renderCategoryTabs();
      renderStoreNav();
      renderProducts();
      if (state.showFavoritesOnly) document.getElementById('product-grid').scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'lightbox-overlay') closeLightbox();
    });
    document.getElementById('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
    document.getElementById('lightbox-next').addEventListener('click', () => lightboxNav(1));

    document.addEventListener('keydown', (e) => {
      if (document.getElementById('lightbox-overlay').classList.contains('hidden')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxNav(-1);
      if (e.key === 'ArrowRight') lightboxNav(1);
    });

    let lightboxTouchX = 0;
    const lightboxOverlay = document.getElementById('lightbox-overlay');
    lightboxOverlay.addEventListener('touchstart', (e) => { lightboxTouchX = e.touches[0].clientX; }, { passive: true });
    lightboxOverlay.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - lightboxTouchX;
      if (Math.abs(dx) > 50) lightboxNav(dx < 0 ? 1 : -1);
    });
  }

  // -- Init ---------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderCartBadge();
    renderFavoritesBadge();
    trackVisit();

    const minSplashTime = new Promise((resolve) => setTimeout(resolve, 1100));
    Promise.all([loadSettings(), loadProducts(), minSplashTime]).finally(() => {
      document.getElementById('splash').classList.add('hide');
    });
  });
})();
