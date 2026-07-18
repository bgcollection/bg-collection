// ============================================================================
// Vitrine — BG Collection & Co
// Lê produtos e configurações do Supabase, gerencia o carrinho (localStorage)
// e finaliza o pedido registrando no banco e abrindo o WhatsApp.
// ============================================================================

(function () {
  'use strict';

  const CATEGORIES = ['Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços'];
  const CART_STORAGE_KEY = 'bg_cart_v1';

  const state = {
    settings: null,
    products: [],
    activeCategory: 'Todos',
    cart: loadCart(),
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

  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch (err) {
      console.error('Não foi possível salvar o carrinho:', err);
    }
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
    if (s.instagram_handle) {
      const handle = s.instagram_handle.replace(/^@/, '');
      instagramLink.href = `https://instagram.com/${encodeURIComponent(handle)}`;
    } else {
      instagramLink.style.display = 'none';
    }

    const heroSection = document.getElementById('hero-section');
    const heroImage = document.getElementById('hero-image');
    if (s.featured_photo_url) {
      heroImage.src = s.featured_photo_url;
      heroSection.style.display = '';
    }
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
      renderCategoryTabs();
      renderProducts();
    } catch (err) {
      console.error('Erro ao carregar produtos:', err);
      stateBanner.innerHTML = '<p>Não foi possível carregar os produtos agora. Tente recarregar a página.</p>';
      stateBanner.classList.add('error');
    }
  }

  // -- Categorias e grid --------------------------------------------------

  function renderCategoryTabs() {
    const nav = document.getElementById('category-tabs');
    const present = CATEGORIES.filter((cat) => state.products.some((p) => p.category === cat));
    const tabs = ['Todos', ...present];

    nav.innerHTML = '';
    tabs.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = 'category-tab' + (cat === state.activeCategory ? ' active' : '');
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        state.activeCategory = cat;
        renderCategoryTabs();
        renderProducts();
      });
      nav.appendChild(btn);
    });
  }

  function renderProducts() {
    const grid = document.getElementById('product-grid');
    const list = state.products.filter(
      (p) => state.activeCategory === 'Todos' || p.category === state.activeCategory
    );

    if (list.length === 0) {
      grid.innerHTML = '<p class="state-banner">Nenhum produto encontrado nesta categoria.</p>';
      return;
    }

    grid.innerHTML = '';
    list.forEach((product) => {
      const card = document.createElement('div');
      card.className = 'product-card';

      const outOfStock = product.stock_quantity <= 0;
      const photo = product.photo_url || '';

      card.innerHTML = `
        <div class="product-card__photo-wrap">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : ''}
          ${outOfStock ? '<span class="product-card__badge">Esgotado</span>' : ''}
        </div>
        <div class="product-card__body">
          <div class="product-card__name">${escapeHtml(product.name)}</div>
          <div class="product-card__price">${formatBRL(product.price)}</div>
          <button class="btn btn-primary btn-sm product-card__add" ${outOfStock ? 'disabled' : ''}>
            ${outOfStock ? 'Esgotado' : 'Adicionar'}
          </button>
        </div>
      `;

      if (!outOfStock) {
        card.querySelector('.product-card__add').addEventListener('click', () => addToCart(product));
      }

      grid.appendChild(card);
    });
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
        photo_url: product.photo_url,
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

  function cartTotal() {
    return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
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
    const emptyMsg = document.getElementById('cart-empty');

    if (state.cart.length === 0) {
      itemsWrap.innerHTML = '';
      itemsWrap.appendChild(emptyMsg);
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
  }

  function buildWhatsappMessage(order, customerName) {
    const lines = [`Olá! Meu nome é ${customerName} e gostaria de confirmar este pedido:`, ''];
    order.items.forEach((item) => {
      lines.push(`• ${item.quantity}x ${item.name} — ${formatBRL(item.price * item.quantity)}`);
    });
    lines.push('', `Total: ${formatBRL(order.total)}`);
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
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const { error } = await window.sbClient.from('orders').insert(orderPayload);
      if (error) throw error;

      const message = buildWhatsappMessage(orderPayload, name);
      const waNumber = state.settings.whatsapp_number.replace(/\D/g, '');
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

      state.cart = [];
      saveCart();
      renderCartBadge();
      closeCheckout();
      document.getElementById('checkout-form').reset();

      window.open(waUrl, '_blank', 'noopener');
      showToast('Pedido registrado! Continue no WhatsApp para confirmar.', 'success');
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
    document.getElementById('cart-fab').addEventListener('click', openCart);
    document.getElementById('cart-close').addEventListener('click', closeCart);
    document.getElementById('cart-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'cart-overlay') closeCart();
    });

    document.getElementById('checkout-btn').addEventListener('click', openCheckout);
    document.getElementById('checkout-close').addEventListener('click', closeCheckout);
    document.getElementById('checkout-cancel').addEventListener('click', closeCheckout);
    document.getElementById('checkout-form').addEventListener('submit', submitCheckout);
  }

  // -- Init ---------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderCartBadge();
    loadSettings();
    loadProducts();
  });
})();
