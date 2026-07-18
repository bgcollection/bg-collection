// ============================================================================
// Painel administrativo — BG Collection & Co
// Login (Supabase Auth), CRUD de produtos com upload/compressão de foto,
// configurações da loja e dashboard com Chart.js.
// ============================================================================

(function () {
  'use strict';

  const CATEGORIES = ['Bolsas', 'Pulseiras', 'Relógios', 'Brincos', 'Cintos', 'Lenços'];
  const PHOTO_MAX_DIMENSION = 1000;
  const PHOTO_QUALITY = 0.8;

  const state = {
    products: [],
    orders: [],
    settings: null,
    editingProductId: null,
    selectedProductPhotoFile: null,
    selectedSettingsPhotoFile: null,
    deleteTargetId: null,
    chartInstance: null,
  };

  // -- Helpers ------------------------------------------------------------

  function formatBRL(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function setButtonLoading(btn, loadingText) {
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.disabled = true;
    btn.textContent = loadingText;
  }

  function resetButtonLoading(btn) {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }

  // -- Compressão e upload de imagem -----------------------------------------

  function compressImage(file, maxDimension, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round(height * (maxDimension / width));
              width = maxDimension;
            } else {
              width = Math.round(width * (maxDimension / height));
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao comprimir imagem.'))),
            'image/jpeg',
            quality
          );
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto(blob, prefix) {
    const fileName = `${prefix}-${Date.now()}.jpg`;
    const { error } = await window.sbClient.storage
      .from('product-photos')
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;

    const { data } = window.sbClient.storage.from('product-photos').getPublicUrl(fileName);
    return data.publicUrl;
  }

  // -- Autenticação ------------------------------------------------------

  async function initAuth() {
    try {
      const { data, error } = await window.sbClient.auth.getSession();
      if (error) throw error;
      updateAuthUi(!!data.session);

      window.sbClient.auth.onAuthStateChange((_event, session) => {
        updateAuthUi(!!session);
      });
    } catch (err) {
      console.error('Erro ao verificar sessão:', err);
      showToast('Não foi possível conectar ao Supabase. Verifique js/supabase-client.js.', 'error');
    }
  }

  function updateAuthUi(isLoggedIn) {
    document.getElementById('login-screen').classList.toggle('hidden', isLoggedIn);
    document.getElementById('admin-shell').classList.toggle('hidden', !isLoggedIn);
    if (isLoggedIn) {
      switchView('dashboard');
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = document.getElementById('login-submit');

    setButtonLoading(submitBtn, 'Entrando...');
    try {
      const { error } = await window.sbClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      console.error('Erro ao entrar:', err);
      showToast('E-mail ou senha inválidos.', 'error');
    } finally {
      resetButtonLoading(submitBtn);
    }
  }

  async function handleLogout() {
    try {
      const { error } = await window.sbClient.auth.signOut();
      if (error) throw error;
    } catch (err) {
      console.error('Erro ao sair:', err);
      showToast('Não foi possível sair. Tente novamente.', 'error');
    }
  }

  // -- Navegação entre views -----------------------------------------------

  function switchView(viewName) {
    document.querySelectorAll('.admin-view').forEach((el) => el.classList.add('hidden'));
    document.getElementById(`view-${viewName}`).classList.remove('hidden');

    document.querySelectorAll('.admin-nav__link[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'dashboard') loadDashboard();
    else if (viewName === 'products') loadProductsAdmin();
    else if (viewName === 'orders') loadOrders();
    else if (viewName === 'settings') loadSettingsAdmin();
  }

  // -- Produtos -------------------------------------------------------------

  async function fetchProducts() {
    const { data, error } = await window.sbClient
      .from('products')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function loadProductsAdmin() {
    const stateBanner = document.getElementById('products-admin-state');
    const tableWrap = document.getElementById('products-table-wrap');

    stateBanner.classList.remove('hidden', 'error');
    stateBanner.innerHTML = '<div class="spinner"></div><p>Carregando produtos...</p>';
    tableWrap.classList.add('hidden');

    try {
      state.products = await fetchProducts();
      renderProductsTable();
      stateBanner.classList.add('hidden');
      tableWrap.classList.remove('hidden');
    } catch (err) {
      console.error('Erro ao carregar produtos:', err);
      stateBanner.innerHTML = '<p>Não foi possível carregar os produtos.</p>';
      stateBanner.classList.add('error');
    }
  }

  function renderProductsTable() {
    const body = document.getElementById('products-table-body');

    if (state.products.length === 0) {
      body.innerHTML = '<tr><td colspan="6">Nenhum produto cadastrado ainda.</td></tr>';
      return;
    }

    body.innerHTML = '';
    state.products.forEach((product) => {
      const tr = document.createElement('tr');
      const lowStock = product.stock_quantity <= product.low_stock_threshold;
      tr.innerHTML = `
        <td>${product.photo_url ? `<img class="table-thumb" src="${escapeHtml(product.photo_url)}" alt="" />` : '<div class="table-thumb"></div>'}</td>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${formatBRL(product.price)}</td>
        <td><span class="pill ${lowStock ? 'pill-danger' : ''}">${product.stock_quantity}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn-outline btn-sm" data-action="edit">Editar</button>
            <button class="btn btn-danger btn-sm" data-action="delete">Excluir</button>
          </div>
        </td>
      `;
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => openProductModal(product));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => openConfirmDelete(product.id, product.name));
      body.appendChild(tr);
    });
  }

  function openProductModal(product) {
    state.editingProductId = product ? product.id : null;
    state.selectedProductPhotoFile = null;

    document.getElementById('product-modal-title').textContent = product ? 'Editar produto' : 'Novo produto';
    document.getElementById('product-id').value = product ? product.id : '';
    document.getElementById('product-name').value = product ? product.name : '';
    document.getElementById('product-category').value = product ? product.category : CATEGORIES[0];
    document.getElementById('product-stock').value = product ? product.stock_quantity : 0;
    document.getElementById('product-price').value = product ? product.price : '';
    document.getElementById('product-cost').value = product ? product.cost_price : '';
    document.getElementById('product-low-stock').value = product ? product.low_stock_threshold : 3;
    document.getElementById('product-description').value = product ? (product.description || '') : '';

    const preview = document.getElementById('product-photo-preview');
    preview.src = product && product.photo_url ? product.photo_url : '';
    document.getElementById('product-photo-input').value = '';

    document.getElementById('product-modal').classList.remove('hidden');
  }

  function closeProductModal() {
    document.getElementById('product-modal').classList.add('hidden');
  }

  async function handleProductPhotoChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    state.selectedProductPhotoFile = file;
    document.getElementById('product-photo-preview').src = URL.createObjectURL(file);
  }

  async function handleProductSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('product-submit');

    const payload = {
      name: document.getElementById('product-name').value.trim(),
      category: document.getElementById('product-category').value,
      stock_quantity: Number(document.getElementById('product-stock').value),
      price: Number(document.getElementById('product-price').value),
      cost_price: Number(document.getElementById('product-cost').value),
      low_stock_threshold: Number(document.getElementById('product-low-stock').value),
      description: document.getElementById('product-description').value.trim(),
    };

    if (!payload.name) {
      showToast('Informe o nome do produto.', 'error');
      return;
    }

    setButtonLoading(submitBtn, 'Salvando...');

    try {
      if (state.selectedProductPhotoFile) {
        const blob = await compressImage(state.selectedProductPhotoFile, PHOTO_MAX_DIMENSION, PHOTO_QUALITY);
        payload.photo_url = await uploadPhoto(blob, 'product');
      }

      if (state.editingProductId) {
        const { error } = await window.sbClient.from('products').update(payload).eq('id', state.editingProductId);
        if (error) throw error;
        showToast('Produto atualizado com sucesso.', 'success');
      } else {
        const { error } = await window.sbClient.from('products').insert(payload);
        if (error) throw error;
        showToast('Produto criado com sucesso.', 'success');
      }

      closeProductModal();
      await loadProductsAdmin();
    } catch (err) {
      console.error('Erro ao salvar produto:', err);
      showToast('Não foi possível salvar o produto. Tente novamente.', 'error');
    } finally {
      resetButtonLoading(submitBtn);
    }
  }

  function openConfirmDelete(productId, productName) {
    state.deleteTargetId = productId;
    document.getElementById('confirm-modal-text').textContent =
      `Tem certeza que deseja excluir "${productName}"? Essa ação não pode ser desfeita.`;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  function closeConfirmDelete() {
    state.deleteTargetId = null;
    document.getElementById('confirm-modal').classList.add('hidden');
  }

  async function handleConfirmDelete() {
    if (!state.deleteTargetId) return;
    const btn = document.getElementById('confirm-accept');
    setButtonLoading(btn, 'Excluindo...');

    try {
      const { error } = await window.sbClient.from('products').delete().eq('id', state.deleteTargetId);
      if (error) throw error;
      showToast('Produto excluído.', 'success');
      closeConfirmDelete();
      await loadProductsAdmin();
    } catch (err) {
      console.error('Erro ao excluir produto:', err);
      showToast('Não foi possível excluir o produto.', 'error');
    } finally {
      resetButtonLoading(btn);
    }
  }

  // -- Pedidos --------------------------------------------------------------

  async function fetchOrders() {
    const { data, error } = await window.sbClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadOrders() {
    const stateBanner = document.getElementById('orders-state');
    const tableWrap = document.getElementById('orders-table-wrap');

    stateBanner.classList.remove('hidden', 'error');
    stateBanner.innerHTML = '<div class="spinner"></div><p>Carregando pedidos...</p>';
    tableWrap.classList.add('hidden');

    try {
      state.orders = await fetchOrders();
      renderOrdersTable();
      stateBanner.classList.add('hidden');
      tableWrap.classList.remove('hidden');
    } catch (err) {
      console.error('Erro ao carregar pedidos:', err);
      stateBanner.innerHTML = '<p>Não foi possível carregar os pedidos.</p>';
      stateBanner.classList.add('error');
    }
  }

  function renderOrdersTable() {
    const body = document.getElementById('orders-table-body');

    if (state.orders.length === 0) {
      body.innerHTML = '<tr><td colspan="5">Nenhum pedido registrado ainda.</td></tr>';
      return;
    }

    body.innerHTML = '';
    state.orders.forEach((order) => {
      const itemsSummary = (order.items || [])
        .map((item) => `${item.quantity}x ${item.name}`)
        .join(', ');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(order.created_at)}</td>
        <td>${escapeHtml(order.customer_name || '—')}</td>
        <td>${escapeHtml(order.customer_phone || '—')}</td>
        <td>${escapeHtml(itemsSummary)}</td>
        <td>${formatBRL(order.total)}</td>
      `;
      body.appendChild(tr);
    });
  }

  // -- Configurações ----------------------------------------------------

  async function loadSettingsAdmin() {
    try {
      const { data, error } = await window.sbClient.from('store_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      state.settings = data;

      document.getElementById('settings-store-name').value = data.store_name || '';
      document.getElementById('settings-whatsapp').value = data.whatsapp_number || '';
      document.getElementById('settings-instagram').value = data.instagram_handle || '';
      document.getElementById('settings-photo-preview').src = data.featured_photo_url || '';
    } catch (err) {
      console.error('Erro ao carregar configurações:', err);
      showToast('Não foi possível carregar as configurações da loja.', 'error');
    }
  }

  function handleSettingsPhotoChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    state.selectedSettingsPhotoFile = file;
    document.getElementById('settings-photo-preview').src = URL.createObjectURL(file);
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('settings-submit');

    const payload = {
      store_name: document.getElementById('settings-store-name').value.trim(),
      whatsapp_number: document.getElementById('settings-whatsapp').value.trim(),
      instagram_handle: document.getElementById('settings-instagram').value.trim().replace(/^@/, ''),
    };

    setButtonLoading(submitBtn, 'Salvando...');

    try {
      if (state.selectedSettingsPhotoFile) {
        const blob = await compressImage(state.selectedSettingsPhotoFile, PHOTO_MAX_DIMENSION, PHOTO_QUALITY);
        payload.featured_photo_url = await uploadPhoto(blob, 'featured');
      }

      const { error } = await window.sbClient.from('store_settings').update(payload).eq('id', 1);
      if (error) throw error;

      state.selectedSettingsPhotoFile = null;
      showToast('Configurações salvas com sucesso.', 'success');
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
      showToast('Não foi possível salvar as configurações.', 'error');
    } finally {
      resetButtonLoading(submitBtn);
    }
  }

  // -- Dashboard --------------------------------------------------------

  function lastNMonths(n) {
    const months = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      });
    }
    return months;
  }

  function computeDashboardData(products, orders) {
    const invested = products.reduce((sum, p) => sum + Number(p.cost_price) * p.stock_quantity, 0);
    const potentialValue = products.reduce((sum, p) => sum + Number(p.price) * p.stock_quantity, 0);
    const potentialProfit = potentialValue - invested;
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total), 0);
    const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;

    const productTally = new Map();
    const categoryTally = new Map();

    orders.forEach((order) => {
      (order.items || []).forEach((item) => {
        productTally.set(item.name, (productTally.get(item.name) || 0) + item.quantity);

        if (!categoryTally.has(item.category)) categoryTally.set(item.category, new Map());
        const catMap = categoryTally.get(item.category);
        catMap.set(item.name, (catMap.get(item.name) || 0) + item.quantity);
      });
    });

    const topProducts = [...productTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const topByCategory = [...categoryTally.entries()]
      .map(([category, nameMap]) => {
        const [name, qty] = [...nameMap.entries()].sort((a, b) => b[1] - a[1])[0];
        return { category, name, qty };
      })
      .sort((a, b) => a.category.localeCompare(b.category, 'pt-BR'));

    const monthlyMap = new Map();
    orders.forEach((order) => {
      const d = new Date(order.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + Number(order.total));
    });

    const months = lastNMonths(6);
    const monthlyRevenue = months.map((m) => monthlyMap.get(m.key) || 0);

    const lowStock = products.filter((p) => p.stock_quantity <= p.low_stock_threshold);

    return { invested, potentialValue, potentialProfit, totalOrders, avgTicket, topProducts, topByCategory, months, monthlyRevenue, lowStock };
  }

  async function loadDashboard() {
    try {
      const [products, orders] = await Promise.all([fetchProducts(), fetchOrders()]);
      state.products = products;
      state.orders = orders;
      renderDashboard(computeDashboardData(products, orders));
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
      showToast('Não foi possível carregar os dados do dashboard.', 'error');
    }
  }

  function renderDashboard(data) {
    const statGrid = document.getElementById('stat-grid');
    statGrid.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__label">Investido em estoque</div>
        <div class="stat-card__value">${formatBRL(data.invested)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Valor potencial</div>
        <div class="stat-card__value">${formatBRL(data.potentialValue)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Lucro potencial</div>
        <div class="stat-card__value positive">${formatBRL(data.potentialProfit)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Total de pedidos</div>
        <div class="stat-card__value">${data.totalOrders}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Ticket médio</div>
        <div class="stat-card__value">${formatBRL(data.avgTicket)}</div>
      </div>
    `;

    const lowStockAlert = document.getElementById('low-stock-alert');
    const lowStockList = document.getElementById('low-stock-list');
    if (data.lowStock.length > 0) {
      lowStockAlert.classList.remove('hidden');
      lowStockList.innerHTML = data.lowStock
        .map((p) => `<li>${escapeHtml(p.name)} <span class="qty">${p.stock_quantity} un.</span></li>`)
        .join('');
    } else {
      lowStockAlert.classList.add('hidden');
    }

    const topProductsList = document.getElementById('top-products-list');
    topProductsList.innerHTML = data.topProducts.length
      ? data.topProducts.map(([name, qty]) => `<li>${escapeHtml(name)} <span class="qty">${qty} vendidos</span></li>`).join('')
      : '<li>Ainda não há pedidos suficientes.</li>';

    const topByCategoryList = document.getElementById('top-by-category-list');
    topByCategoryList.innerHTML = data.topByCategory.length
      ? data.topByCategory
          .map((entry) => `<li>${escapeHtml(entry.category)}: ${escapeHtml(entry.name)} <span class="qty">${entry.qty} vendidos</span></li>`)
          .join('')
      : '<li>Ainda não há pedidos suficientes.</li>';

    renderMonthlyChart(data.months, data.monthlyRevenue);
  }

  function renderMonthlyChart(months, revenue) {
    const canvas = document.getElementById('monthly-chart');
    if (state.chartInstance) {
      state.chartInstance.destroy();
    }

    state.chartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map((m) => m.label),
        datasets: [
          {
            label: 'Faturamento',
            data: revenue,
            backgroundColor: '#b76e79',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatBRL(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (value) => formatBRL(value) },
          },
        },
      },
    });
  }

  // -- Eventos ----------------------------------------------------------

  function bindEvents() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.querySelectorAll('.admin-nav__link[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('new-product-btn').addEventListener('click', () => openProductModal(null));
    document.getElementById('product-modal-close').addEventListener('click', closeProductModal);
    document.getElementById('product-modal-cancel').addEventListener('click', closeProductModal);
    document.getElementById('product-form').addEventListener('submit', handleProductSubmit);
    document.getElementById('product-photo-input').addEventListener('change', handleProductPhotoChange);

    document.getElementById('confirm-modal-close').addEventListener('click', closeConfirmDelete);
    document.getElementById('confirm-cancel').addEventListener('click', closeConfirmDelete);
    document.getElementById('confirm-accept').addEventListener('click', handleConfirmDelete);

    document.getElementById('settings-form').addEventListener('submit', handleSettingsSubmit);
    document.getElementById('settings-photo-input').addEventListener('change', handleSettingsPhotoChange);
  }

  // -- Init -------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initAuth();
  });
})();
