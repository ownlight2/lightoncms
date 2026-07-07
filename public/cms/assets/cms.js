(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const csrf = $('meta[name="csrf-token"]')?.content || '';
  const staticLogin = window.LUXE_CMS_STATIC_LOGIN === true;
  let adminToken = ''; // In-memory only. CMS sessions are stored by the backend in an HttpOnly cookie.
  let state = { settings: {}, categories: [], products: [], blogs: [], inquiries: [], orders: [], analytics: { events: [] }, analytics_summary: {} };
  let activeTab = 'dashboard';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const id = (prefix) => `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16).slice(-4)}`;
  const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `item-${Date.now().toString(36)}`;
  const defaultColors = {
    ink: '#171515',
    muted: '#6f6a63',
    paper: '#fffaf4',
    soft: '#f5ece1',
    line: '#eadfd1',
    gold: '#b98b47',
    gold_dark: '#8f672e',
    header_background: '#fffaf4',
    footer_background: '#141414',
    whatsapp: '#25d366'
  };
  const moneyDisplay = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value || 0) || 0);

  function ensureDesignDefaults() {
    state.settings = state.settings || {};
    state.settings.fonts = state.settings.fonts || {};
    state.settings.colors = state.settings.colors || {};
    Object.entries(defaultColors).forEach(([key, value]) => {
      if (!state.settings.colors[key]) state.settings.colors[key] = value;
    });
  }

  function endpointUrl(endpoint) {
    const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
    if (window.LUXE_CMS_API_BASE) return `${String(window.LUXE_CMS_API_BASE).replace(/\/+$/, '')}/${cleanEndpoint}`;
    const url = new URL('api.php', window.location.href);
    url.searchParams.set('endpoint', cleanEndpoint);
    return url.toString();
  }

  async function api(endpoint, options = {}) {
    const opts = { ...options };
    opts.headers = opts.headers || {};
    opts.credentials = opts.credentials || 'same-origin';
    if (!(opts.body instanceof FormData)) opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    if (staticLogin && adminToken) opts.headers.Authorization = `Bearer ${adminToken}`;
    const res = await fetch(endpointUrl(endpoint), opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.message || `Request failed: ${res.status}`);
    return json;
  }

  function notice(message, error = false) {
    const box = $('#notice');
    if (!box) return;
    box.hidden = false;
    box.textContent = message;
    box.classList.toggle('error', !!error);
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { box.hidden = true; }, 5200);
  }

  function getPath(path) {
    return String(path).split('.').reduce((obj, key) => obj ? obj[key] : undefined, state);
  }

  function setPath(path, value) {
    const parts = String(path).split('.');
    let obj = state;
    parts.slice(0, -1).forEach(key => {
      if (obj[key] === undefined) obj[key] = /^\d+$/.test(key) ? [] : {};
      obj = obj[key];
    });
    obj[parts[parts.length - 1]] = value;
  }

  function input(label, path, opts = {}) {
    const type = opts.type || 'text';
    const cls = opts.full ? 'field full' : 'field';
    const value = getPath(path) ?? '';
    const attrs = [
      opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : '',
      opts.min !== undefined ? `min="${esc(opts.min)}"` : '',
      opts.max !== undefined ? `max="${esc(opts.max)}"` : ''
    ].filter(Boolean).join(' ');
    if (opts.kind === 'textarea') {
      return `<label class="${cls}">${esc(label)}<textarea data-path="${esc(path)}" ${attrs}>${esc(value)}</textarea></label>`;
    }
    if (opts.kind === 'select') {
      return `<label class="${cls}">${esc(label)}<select data-path="${esc(path)}">${opts.options.map(o => `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    }
    return `<label class="${cls}">${esc(label)}<input type="${esc(type)}" data-path="${esc(path)}" value="${esc(value)}" ${attrs}></label>`;
  }

  function checkbox(label, path) {
    return `<label class="check"><input type="checkbox" data-path="${esc(path)}" ${getPath(path) ? 'checked' : ''}> ${esc(label)}</label>`;
  }

  function productTitleFromSlug(slug, fallback = '') {
    const clean = slugify(slug || fallback || '');
    const product = (state.products || []).find(item => slugify(item.slug || item.title || item.id) === clean || String(item.id || '') === String(slug || ''));
    return product?.title || fallback || clean || 'Unknown product';
  }

  function mapToTopRows(map, limit = 8) {
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  function localAnalyticsSummary() {
    const inquiryMap = {};
    (state.inquiries || []).forEach((inq) => {
      const slug = slugify(inq.product_slug || inq.product_title || 'general-inquiry');
      const title = productTitleFromSlug(slug, inq.product_title || 'General inquiry');
      if (!inquiryMap[slug]) inquiryMap[slug] = { slug, title, count: 0 };
      inquiryMap[slug].count += 1;
    });

    const soldMap = {};
    let totalQuantitySold = 0;
    (state.orders || []).forEach((order) => {
      (order.items || []).forEach((item) => {
        const slug = slugify(item.product_slug || item.product_title || 'unknown-product');
        const title = productTitleFromSlug(slug, item.product_title || 'Unknown product');
        const qty = Math.max(1, Number(item.quantity || 1) || 1);
        if (!soldMap[slug]) soldMap[slug] = { slug, title, count: 0 };
        soldMap[slug].count += qty;
        totalQuantitySold += qty;
      });
    });

    const events = (state.analytics && Array.isArray(state.analytics.events)) ? state.analytics.events : [];
    const counts = { product_view: 0, inquiry_click: 0, whatsapp_click: 0, inquiry_open: 0, inquiry_submit: 0, add_to_cart: 0, order_submit: 0 };
    const viewMap = {};
    const clickMap = {};
    events.forEach((event) => {
      const type = event.event_type || event.type || '';
      if (counts[type] !== undefined) counts[type] += 1;
      const slug = slugify(event.product_slug || event.product_title || 'unknown-product');
      const title = productTitleFromSlug(slug, event.product_title || 'Unknown product');
      if (type === 'product_view') {
        if (!viewMap[slug]) viewMap[slug] = { slug, title, count: 0 };
        viewMap[slug].count += 1;
      }
      if (type === 'inquiry_click' || type === 'whatsapp_click' || type === 'inquiry_open' || type === 'inquiry_submit') {
        if (!clickMap[slug]) clickMap[slug] = { slug, title, count: 0 };
        clickMap[slug].count += 1;
      }
    });

    return {
      counts,
      top_inquiries: mapToTopRows(inquiryMap),
      top_views: mapToTopRows(viewMap),
      top_clicks: mapToTopRows(clickMap),
      top_sold: mapToTopRows(soldMap),
      total_orders: (state.orders || []).length,
      total_quantity_sold: totalQuantitySold
    };
  }

  function trackerListHtml(rows, emptyMessage) {
    if (!rows || !rows.length) return `<div class="empty">${esc(emptyMessage)}</div>`;
    return rows.map((row) => `<div class="tracker-row"><div><strong>${esc(row.title || row.slug || 'Product')}</strong><span>${esc(row.slug || '')}</span></div><div class="tracker-count">${esc(row.count || 0)}</div></div>`).join('');
  }

  function imagePreview(value) {
    return value ? `<div class="image-preview"><img src="${esc(value)}" onerror="this.parentElement.classList.add('broken')" alt=""><span>Preview</span></div>` : `<div class="image-preview empty-preview"><span>No image selected</span></div>`;
  }

  function imageTools(path, label = 'Image URL') {
    const value = getPath(path) || '';
    return `<div class="field full image-field"><label>${esc(label)}</label>${imagePreview(value)}<div class="image-tools"><input type="text" data-path="${esc(path)}" value="${esc(value)}" placeholder="Upload high-quality image or paste image URL"><label class="upload-mini">Upload<input type="file" data-upload-path="${esc(path)}" accept="image/*,.svg,.avif,.webp,.bmp,.gif"></label><button type="button" class="ghost small" data-delete-upload="${esc(path)}">Delete file</button><button type="button" class="ghost small" data-clear-path="${esc(path)}">Clear</button></div>${value ? `<p><a class="preview-link" href="${esc(value)}" target="_blank" rel="noopener">Open full image</a></p>` : ''}</div>`;
  }

  function render() {
    renderDashboard();
    renderSettings();
    renderCategories();
    renderProducts();
    renderOrders();
    renderBlogs();
    renderInquiries();
    renderImages();
  }

  function renderDashboard() {
    $('#statCategories').textContent = state.categories.length;
    $('#statProducts').textContent = state.products.length;
    $('#statBlogs').textContent = state.blogs.length;
    $('#statInquiries').textContent = state.inquiries.length;
    const ordersStat = $('#statOrders');
    if (ordersStat) ordersStat.textContent = (state.orders || []).length;
    const hidden = [...state.categories, ...state.products, ...state.blogs].filter(item => item.hidden).length;
    $('#statHidden').textContent = hidden;
    const summary = (state.analytics_summary && state.analytics_summary.counts) ? state.analytics_summary : localAnalyticsSummary();
    const counts = summary.counts || {};
    const totalClicks = Number(counts.inquiry_click || 0) + Number(counts.whatsapp_click || 0) + Number(counts.inquiry_open || 0) + Number(counts.inquiry_submit || 0);
    const viewsEl = $('#statProductViews');
    const clicksEl = $('#statInquiryClicks');
    const soldQtyEl = $('#statSoldQty');
    if (viewsEl) viewsEl.textContent = counts.product_view || 0;
    if (clicksEl) clicksEl.textContent = totalClicks;
    if (soldQtyEl) soldQtyEl.textContent = summary.total_quantity_sold || 0;
    const inquiriesEl = $('#topInquiryProducts');
    const visitorsEl = $('#topVisitorProducts');
    const clicksListEl = $('#topClickProducts');
    const soldListEl = $('#topSoldProducts');
    if (inquiriesEl) inquiriesEl.innerHTML = trackerListHtml(summary.top_inquiries || [], 'No product inquiries yet.');
    if (visitorsEl) visitorsEl.innerHTML = trackerListHtml(summary.top_views || [], 'No product views tracked yet.');
    if (clicksListEl) clicksListEl.innerHTML = trackerListHtml(summary.top_clicks || [], 'No inquiry or WhatsApp clicks tracked yet.');
    if (soldListEl) soldListEl.innerHTML = trackerListHtml(summary.top_sold || [], 'No cart purchases yet.');
  }

  function renderSettings() {
    ensureDesignDefaults();
    $('#settingsForm').innerHTML = [
      input('Site / brand name', 'settings.site_name'),
      input('WhatsApp number', 'settings.whatsapp_number', { placeholder: '9779868800001' }),
      input('Instagram URL', 'settings.instagram_url', { placeholder: 'https://www.instagram.com/your-page' }),
      input('Top bar text', 'settings.topbar_text', { full: true }),
      input('Default WhatsApp message', 'settings.default_message', { full: true, kind: 'textarea' }),
      input('Homepage hero title', 'settings.hero_title'),
      input('Homepage hero text', 'settings.hero_text', { kind: 'textarea' }),
      imageTools('settings.hero_image', 'Homepage hero image'),
      input('Contact page heading', 'settings.contact_heading'),
      input('Contact page text', 'settings.contact_text', { kind: 'textarea' }),
      input('Body font family', 'settings.fonts.body', { placeholder: 'Poppins, Arial, sans-serif' }),
      input('Heading font family', 'settings.fonts.heading', { placeholder: 'Playfair Display, Georgia, serif' }),
      input('Navigation font family', 'settings.fonts.nav'),
      input('Button font family', 'settings.fonts.button'),
      input('Body font size', 'settings.fonts.body_size', { placeholder: '16px' }),
      input('Heading weight', 'settings.fonts.heading_weight', { placeholder: '700' }),
      input('Main text colour', 'settings.colors.ink', { type: 'color' }),
      input('Muted text colour', 'settings.colors.muted', { type: 'color' }),
      input('Page background colour', 'settings.colors.paper', { type: 'color' }),
      input('Soft section colour', 'settings.colors.soft', { type: 'color' }),
      input('Border line colour', 'settings.colors.line', { type: 'color' }),
      input('Gold / accent colour', 'settings.colors.gold', { type: 'color' }),
      input('Dark gold colour', 'settings.colors.gold_dark', { type: 'color' }),
      input('Header background colour', 'settings.colors.header_background', { type: 'color' }),
      input('Footer background colour', 'settings.colors.footer_background', { type: 'color' }),
      input('WhatsApp button colour', 'settings.colors.whatsapp', { type: 'color' })
    ].join('');
  }

  function renderCategories() {
    const list = $('#categoryList');
    if (!state.categories.length) {
      list.innerHTML = '<div class="empty">No categories yet. Click Add Category.</div>';
      return;
    }
    list.innerHTML = state.categories.map((cat, i) => `
      <article class="item-card">
        <div class="item-head">
          <div class="item-title">${cat.image ? `<img class="thumb" src="${esc(cat.image)}" onerror="this.style.visibility='hidden'" alt="">` : '<div class="thumb no-thumb">No image</div>'}<div><h3>${esc(cat.name || 'Category')}</h3><span class="status-dot ${cat.hidden ? 'hidden' : ''}">${cat.hidden ? 'Hidden from website' : 'Visible on website'}</span></div></div>
          <div class="actions"><button class="ghost small" data-move="categories.${i}.-1">Up</button><button class="ghost small" data-move="categories.${i}.1">Down</button><button class="danger small" data-remove="categories.${i}">Delete</button></div>
        </div>
        <div class="row three">
          ${input('Category name', `categories.${i}.name`)}
          ${input('Slug', `categories.${i}.slug`)}
          ${input('Sort order', `categories.${i}.sort_order`, { type: 'number' })}
        </div>
        <div class="row three">
          ${input('Category discount label', `categories.${i}.discount_label`, { placeholder: 'Festive offer, Sale, etc.' })}
          ${input('Category discount %', `categories.${i}.discount_percent`, { type: 'number', min: 0, max: 100 })}
          ${input('Category offer note', `categories.${i}.offer_text`, { placeholder: 'Optional offer text shown on category page' })}
        </div>
        ${input('Description', `categories.${i}.description`, { kind: 'textarea', full: true })}
        ${imageTools(`categories.${i}.image`, 'Category image')}
        <div class="checks">${checkbox('Hide this category from website', `categories.${i}.hidden`)}</div>
      </article>
    `).join('');
  }

  function productCategoriesHtml(productIndex) {
    const selected = new Set(state.products[productIndex].category_slugs || []);
    return `<div class="field full"><label>Categories</label><div class="select-grid">${state.categories.map(cat => `<label><input type="checkbox" data-product-category="${productIndex}" value="${esc(cat.slug)}" ${selected.has(cat.slug) ? 'checked' : ''}> ${esc(cat.name)}</label>`).join('') || '<span class="muted">Create categories first.</span>'}</div></div>`;
  }

  function productMediaLinksHtml(productIndex) {
    const product = state.products[productIndex] || {};
    const links = Array.isArray(product.media_links) ? product.media_links : [];
    const rows = links.length ? links.map((link, linkIndex) => `
      <div class="media-link-row">
        ${input('Button label', `products.${productIndex}.media_links.${linkIndex}.label`, { placeholder: 'Instagram video, TikTok, Location' })}
        ${input('URL', `products.${productIndex}.media_links.${linkIndex}.url`, { placeholder: 'https://www.instagram.com/reel/... or https://www.tiktok.com/...' })}
        ${checkbox('Hide link', `products.${productIndex}.media_links.${linkIndex}.hidden`)}
        <button type="button" class="danger small" data-remove-media-link="${productIndex}.${linkIndex}">Remove</button>
      </div>`).join('') : '<div class="empty">No video/social/location links added for this product.</div>';
    return `<div class="field full"><label>Video, social media, location, or other links shown under product photos</label><div class="media-link-list">${rows}</div><div class="upload-box"><button type="button" class="ghost small" data-add-media-link="${productIndex}">Add URL link</button></div><p class="muted">Add Instagram Reels, TikTok videos, YouTube videos, Google Maps/place links, Facebook links, or any other URL. Hidden links stay saved in CMS but do not show on the website.</p></div>`;
  }

  function productVariants(product) {
    product.variants = Array.isArray(product.variants) ? product.variants : [];
    return product.variants;
  }

  function productStockQty(product) {
    const variants = productVariants(product);
    if (variants.length) return variants.reduce((sum, v) => sum + (Math.max(0, Number(v.stock_qty || 0) || 0)), 0);
    return Math.max(0, Number(product.stock_qty || 0) || 0);
  }

  function productSoldQty(product) {
    const variants = productVariants(product);
    if (variants.length) return variants.reduce((sum, v) => sum + (Math.max(0, Number(v.sold_qty || 0) || 0)), 0);
    return Math.max(0, Number(product.sold_qty || 0) || 0);
  }

  function variantInventoryHtml(productIndex) {
    const product = state.products[productIndex] || {};
    const variants = productVariants(product);
    const rows = variants.length ? variants.map((variant, variantIndex) => `
      <div class="variant-row">
        ${input('Size', `products.${productIndex}.variants.${variantIndex}.size`, { placeholder: 'S, M, L, XL' })}
        ${input('Colour', `products.${productIndex}.variants.${variantIndex}.color`, { placeholder: 'Black, Red, Gold' })}
        ${input('Stock qty', `products.${productIndex}.variants.${variantIndex}.stock_qty`, { type: 'number', min: 0 })}
        ${input('Sold qty', `products.${productIndex}.variants.${variantIndex}.sold_qty`, { type: 'number', min: 0 })}
        <button type="button" class="danger small" data-remove-variant="${productIndex}.${variantIndex}">Remove</button>
      </div>`).join('') : '<div class="empty">No size/colour quantity rows yet. Add rows manually or generate from the size and colour options above.</div>';
    return `<div class="field full variant-field"><label>Quantity by size and colour</label><div class="variant-summary">Total stock: <strong>${esc(productStockQty(product))}</strong> · Total sold: <strong>${esc(productSoldQty(product))}</strong></div><div class="variant-list">${rows}</div><div class="upload-box"><button type="button" class="ghost small" data-add-variant="${productIndex}">Add size/colour quantity row</button><button type="button" class="ghost small" data-generate-variants="${productIndex}">Generate rows from sizes and colours</button></div><p class="muted">Use this when stock or sold quantity differs by size and colour. Website purchases with matching size/colour automatically increase the matching Sold qty row.</p></div>`;
  }

  function generateVariantsForProduct(productIndex) {
    const product = state.products[productIndex];
    if (!product) return;
    product.variants = Array.isArray(product.variants) ? product.variants : [];
    const sizes = (Array.isArray(product.sizes) && product.sizes.length) ? product.sizes : [''];
    const colors = (Array.isArray(product.colors) && product.colors.length) ? product.colors.map(c => c.name || c).filter(Boolean) : [''];
    const existing = new Map(product.variants.map((variant) => `${String(variant.size || '').trim().toLowerCase()}||${String(variant.color || '').trim().toLowerCase()}`));
    sizes.forEach((size) => {
      colors.forEach((color) => {
        const key = `${String(size || '').trim().toLowerCase()}||${String(color || '').trim().toLowerCase()}`;
        if (!existing.has(key)) product.variants.push({ id: id('var'), size: String(size || '').trim(), color: String(color || '').trim(), stock_qty: 0, sold_qty: 0 });
      });
    });
  }

  function renderProducts() {
    const list = $('#productList');
    if (!state.products.length) {
      list.innerHTML = '<div class="empty">No products yet. Click Add Product.</div>';
      return;
    }
    list.innerHTML = state.products.map((p, i) => {
      const sizes = (p.sizes || []).join(', ');
      const colors = (p.colors || []).map(c => `${c.name || ''}:${c.hex || '#dddddd'}`).join('; ');
      return `
      <article class="item-card">
        <div class="item-head">
          <div class="item-title">${p.image ? `<img class="thumb" src="${esc(p.image)}" onerror="this.style.visibility='hidden'" alt="">` : '<div class="thumb no-thumb">No image</div>'}<div><h3>${esc(p.title || 'Product')}</h3><span class="status-dot ${p.hidden ? 'hidden' : ''}">${p.hidden ? 'Hidden from website' : 'Visible on website'}</span> <span class="muted">Stock: ${esc(productStockQty(p))} · Sold: ${esc(productSoldQty(p))}</span></div></div>
          <div class="actions"><button class="ghost small" data-move="products.${i}.-1">Up</button><button class="ghost small" data-move="products.${i}.1">Down</button><button class="danger small" data-remove="products.${i}">Delete</button></div>
        </div>
        <div class="row four">
          ${input('Product name', `products.${i}.title`)}
          ${input('Slug', `products.${i}.slug`)}
          ${input('SKU', `products.${i}.sku`)}
          ${input('Sort order', `products.${i}.sort_order`, { type: 'number' })}
        </div>
        <div class="row four">
          ${input('Price', `products.${i}.price`)}
          ${input('Compare price / MRP', `products.${i}.compare_price`)}
          ${input('Discount label', `products.${i}.discount_label`, { placeholder: 'Dashain offer, Sale, etc.' })}
          ${input('Discount %', `products.${i}.discount_percent`, { type: 'number', min: 0, max: 100 })}
        </div>
        <div class="row four">
          ${input('Stock quantity', `products.${i}.stock_qty`, { type: 'number' })}
          ${input('Quantity sold', `products.${i}.sold_qty`, { type: 'number', min: 0 })}
          ${input('Stock label', `products.${i}.stock_label`)}
          ${input('Stock status', `products.${i}.stock_status`, { kind: 'select', options: [{value:'instock',label:'In stock'},{value:'lowstock',label:'Low stock'},{value:'outofstock',label:'Out of stock'},{value:'preorder',label:'Pre-order'}] })}
          ${input('Fabric', `products.${i}.fabric`)}
        </div>
        <label class="field full">Size options, comma separated<input data-sizes="${i}" value="${esc(sizes)}" placeholder="S, M, L, XL"></label>
        <label class="field full">Colour options, format Name:#hex; Name:#hex<input data-colors="${i}" value="${esc(colors)}" placeholder="Black:#111111; White:#ffffff"></label>
        ${variantInventoryHtml(i)}
        ${productCategoriesHtml(i)}
        ${input('Short excerpt', `products.${i}.excerpt`, { kind: 'textarea', full: true })}
        ${input('Full product description', `products.${i}.content`, { kind: 'textarea', full: true })}
        ${imageTools(`products.${i}.image`, 'Main product image')}
        <div class="field full"><label>Multiple gallery images for this product</label><div class="gallery-list">${galleryHtml(i)}</div><div class="upload-box"><label class="upload-mini">Upload gallery image<input type="file" data-gallery-upload="${i}" accept="image/*,.svg,.avif,.webp,.bmp,.gif"></label><button type="button" class="ghost small" data-add-gallery="${i}">Add blank gallery URL</button></div><p class="muted">Upload as many product photos as needed. The first main image is used on product cards; all gallery images show on the product detail page.</p></div>
        ${productMediaLinksHtml(i)}
        <div class="checks">${checkbox('Featured', `products.${i}.featured`)}${checkbox('New arrival', `products.${i}.new_arrival`)}${checkbox('Hide this product from website', `products.${i}.hidden`)}</div>
      </article>`;
    }).join('');
  }

  function galleryHtml(i) {
    const gallery = state.products[i].gallery || [];
    if (!gallery.length) return '<div class="empty">No gallery images.</div>';
    return gallery.map((url, j) => `<div class="gallery-row">${url ? `<img src="${esc(url)}" onerror="this.style.visibility='hidden'" alt="">` : '<div class="gallery-empty">No image</div>'}<input data-path="products.${i}.gallery.${j}" value="${esc(url)}" placeholder="Gallery image URL"><button type="button" class="ghost small" data-delete-gallery-file="${i}.${j}">Delete file</button><button type="button" class="danger small" data-remove-gallery="${i}.${j}">Remove</button></div>`).join('');
  }

  function renderBlogs() {
    const list = $('#blogList');
    if (!state.blogs.length) {
      list.innerHTML = '<div class="empty">No blogs yet. Click Add Blog.</div>';
      return;
    }
    list.innerHTML = state.blogs.map((b, i) => `
      <article class="item-card">
        <div class="item-head">
          <div class="item-title">${b.image ? `<img class="thumb" src="${esc(b.image)}" onerror="this.style.visibility='hidden'" alt="">` : '<div class="thumb no-thumb">No image</div>'}<div><h3>${esc(b.title || 'Blog')}</h3><span class="status-dot ${b.hidden ? 'hidden' : ''}">${b.hidden ? 'Hidden from website' : 'Visible'}</span></div></div>
          <div class="actions"><button class="ghost small" data-move="blogs.${i}.-1">Up</button><button class="ghost small" data-move="blogs.${i}.1">Down</button><button class="danger small" data-remove="blogs.${i}">Delete</button></div>
        </div>
        <div class="row four">
          ${input('Blog title', `blogs.${i}.title`)}
          ${input('Slug', `blogs.${i}.slug`)}
          ${input('Published date', `blogs.${i}.published_at`, { type: 'date' })}
          ${input('Sort order', `blogs.${i}.sort_order`, { type: 'number' })}
        </div>
        ${input('Excerpt', `blogs.${i}.excerpt`, { kind: 'textarea', full: true })}
        ${input('Content', `blogs.${i}.content`, { kind: 'textarea', full: true })}
        ${imageTools(`blogs.${i}.image`, 'Blog image')}
        <div class="checks">${checkbox('Hide this blog from website', `blogs.${i}.hidden`)}</div>
      </article>
    `).join('');
  }

  function renderInquiries() {
    const list = $('#inquiryList');
    if (!list) return;
    if (!state.inquiries.length) {
      list.innerHTML = '<div class="empty">No inquiries yet. Website inquiries will appear here after customers submit the form.</div>';
      return;
    }
    list.innerHTML = state.inquiries.map((inq, i) => `
      <article class="item-card inquiry-card">
        <div class="item-head">
          <div><h3>${esc(inq.name || 'Customer inquiry')}</h3><span class="muted">${esc(inq.created_at || '')}</span></div>
          <div class="actions"><button class="danger small" data-remove="inquiries.${i}">Delete</button></div>
        </div>
        <div class="row three">
          ${input('Status', `inquiries.${i}.status`, { kind: 'select', options: [{value:'new',label:'New'},{value:'contacted',label:'Contacted'},{value:'closed',label:'Closed'}] })}
          ${input('Phone / WhatsApp', `inquiries.${i}.phone`)}
          ${input('Email', `inquiries.${i}.email`)}
        </div>
        <div class="row three">
          ${input('Product', `inquiries.${i}.product_title`)}
          ${input('Size', `inquiries.${i}.size`)}
          ${input('Colour', `inquiries.${i}.color`)}
        </div>
        ${input('Message', `inquiries.${i}.message`, { kind: 'textarea', full: true })}
      </article>
    `).join('');
  }

  function usedImages() {
    const entries = [];
    const push = (path, label, url) => { if (url) entries.push({ path, label, url }); };
    push('settings.hero_image', 'Homepage hero image', state.settings?.hero_image);
    (state.categories || []).forEach((cat, i) => push(`categories.${i}.image`, `Category: ${cat.name || i + 1}`, cat.image));
    (state.products || []).forEach((p, i) => {
      push(`products.${i}.image`, `Product main: ${p.title || i + 1}`, p.image);
      (p.gallery || []).forEach((url, j) => push(`products.${i}.gallery.${j}`, `Product gallery: ${p.title || i + 1} #${j + 1}`, url));
    });
    (state.blogs || []).forEach((b, i) => push(`blogs.${i}.image`, `Blog: ${b.title || i + 1}`, b.image));
    return entries;
  }

  function orderItemsHtml(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return '<div class="empty">No product items saved in this order.</div>';
    return `<div class="order-items">${items.map((item) => `<div class="order-item-row"><div><strong>${esc(item.product_title || 'Product')}</strong><span>${item.size ? `Size: ${esc(item.size)} ` : ''}${item.color ? `Colour: ${esc(item.color)}` : ''}</span></div><div class="tracker-count">${esc(item.quantity || 1)}</div></div>`).join('')}</div>`;
  }

  function renderOrders() {
    const list = $('#orderList');
    if (!list) return;
    state.orders = Array.isArray(state.orders) ? state.orders : [];
    if (!state.orders.length) {
      list.innerHTML = '<div class="empty">No purchases yet. Cart checkouts from the website will appear here with customer details and quantity sold.</div>';
      return;
    }
    list.innerHTML = state.orders.map((order, i) => {
      const customer = order.customer || {};
      return `<article class="item-card order-card">
        <div class="item-head">
          <div><h3>${esc(customer.name || 'Customer purchase')}</h3><span class="muted">${esc(order.created_at || '')} · ${esc(order.total_quantity || 0)} item(s) · NPR ${esc(moneyDisplay(order.subtotal || 0))}</span></div>
          <div class="actions"><button class="danger small" data-remove="orders.${i}">Delete</button></div>
        </div>
        <div class="row three">
          ${input('Order status', `orders.${i}.status`, { kind: 'select', options: [{value:'new',label:'New'},{value:'confirmed',label:'Confirmed'},{value:'packed',label:'Packed'},{value:'delivered',label:'Delivered'},{value:'cancelled',label:'Cancelled'}] })}
          ${input('Phone / WhatsApp', `orders.${i}.customer.phone`)}
          ${input('Email', `orders.${i}.customer.email`)}
        </div>
        <div class="row two">
          ${input('City / Area', `orders.${i}.customer.city`)}
          ${input('Customer name', `orders.${i}.customer.name`)}
        </div>
        ${input('Delivery address', `orders.${i}.customer.address`, { kind: 'textarea', full: true })}
        ${input('Customer note', `orders.${i}.customer.note`, { kind: 'textarea', full: true })}
        <div class="field full"><label>Purchased products</label>${orderItemsHtml(order)}</div>
      </article>`;
    }).join('');
  }

  function renderImages() {
    const list = $('#usedImageList');
    if (!list) return;
    const entries = usedImages();
    if (!entries.length) {
      list.innerHTML = '<div class="empty">No CMS images are currently attached. Upload images in Settings, Categories, Products, Blogs, or the global upload box.</div>';
      return;
    }
    list.innerHTML = entries.map((item) => `<div class="used-image-row"><img src="${esc(item.url)}" onerror="this.style.visibility='hidden'" alt=""><div><strong>${esc(item.label)}</strong><p class="code">${esc(item.url)}</p></div><button type="button" class="ghost small" data-clear-path="${esc(item.path)}">Clear</button><button type="button" class="danger small" data-delete-used-image="${esc(item.path)}">Delete file</button></div>`).join('');
  }

  function parseColors(value) {
    return String(value || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const [name, hex] = part.split(':');
      return { name: (name || '').trim(), hex: (hex || '#dddddd').trim() };
    }).filter(c => c.name);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read selected image.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadFile(file, path) {
    if (!file) throw new Error('Select an image first.');
    let result;
    if (window.LUXE_CMS_NETLIFY) {
      const base64 = await fileToBase64(file);
      result = await api('admin/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name || 'image',
          content_type: file.type || 'application/octet-stream',
          size: file.size || 0,
          base64
        })
      });
    } else {
      const form = new FormData();
      form.append('image', file);
      result = await api('admin/upload', { method: 'POST', body: form, headers: {} });
    }
    if (path) setPath(path, result.image.url);
    render();
    notice('Image uploaded. Press Save Changes to publish the new image URL to the website.');
    return result.image;
  }

  async function deleteImageUrl(url) {
    if (!url) throw new Error('No image URL selected.');
    const result = await api('admin/delete-image', { method: 'POST', body: JSON.stringify({ url }) });
    notice(result.message || 'Image deleted. Press Save Changes to publish the removal.');
    return result;
  }

  function replaceCategorySlug(oldSlug, newSlug) {
    const oldClean = slugify(oldSlug);
    const newClean = slugify(newSlug);
    if (!oldClean || !newClean || oldClean === newClean) return;
    (state.products || []).forEach(product => {
      const selected = new Set((product.category_slugs || []).map(slug => slugify(slug)).filter(Boolean));
      if (selected.delete(oldClean)) selected.add(newClean);
      product.category_slugs = Array.from(selected);
    });
  }

  function uniqueSlug(base, used) {
    const clean = slugify(base || 'item');
    let slug = clean;
    let n = 2;
    while (used.has(slug)) {
      slug = `${clean}-${n}`;
      n += 1;
    }
    used.add(slug);
    return slug;
  }

  function normalizeBeforeSave() {
    ensureDesignDefaults();
    state.categories = Array.isArray(state.categories) ? state.categories : [];
    state.products = Array.isArray(state.products) ? state.products : [];
    state.blogs = Array.isArray(state.blogs) ? state.blogs : [];
    state.inquiries = Array.isArray(state.inquiries) ? state.inquiries : [];
    state.orders = Array.isArray(state.orders) ? state.orders : [];

    const categorySlugMap = {};
    const usedCategorySlugs = new Set();
    state.categories = state.categories.map((cat, index) => {
      const currentCategorySlug = slugify(cat.slug);
      const oldSlug = (!currentCategorySlug || /^new-category(-\d+)?$/.test(currentCategorySlug)) ? slugify(cat.name || `category-${index + 1}`) : currentCategorySlug;
      const nextSlug = uniqueSlug(oldSlug, usedCategorySlugs);
      if (!categorySlugMap[oldSlug]) categorySlugMap[oldSlug] = nextSlug;
      if (cat.slug && !categorySlugMap[slugify(cat.slug)]) categorySlugMap[slugify(cat.slug)] = nextSlug;
      return {
        ...cat,
        id: cat.id || id('cat'),
        slug: nextSlug,
        description: cat.description || '',
        discount_label: cat.discount_label || '',
        discount_percent: cat.discount_percent || '',
        offer_text: cat.offer_text || '',
        hidden: !!cat.hidden,
        sort_order: Number(cat.sort_order || index + 1)
      };
    });

    const usedProductSlugs = new Set();
    state.products = state.products.map((product, index) => {
      const currentProductSlug = slugify(product.slug);
      const productSlugBase = (!currentProductSlug || /^new-product(-\d+)?$/.test(currentProductSlug)) ? (product.title || `product-${index + 1}`) : currentProductSlug;
      const nextSlug = uniqueSlug(productSlugBase, usedProductSlugs);
      const categorySlugs = Array.from(new Set((product.category_slugs || []).map(slug => {
        const clean = slugify(slug);
        return categorySlugMap[clean] || clean;
      }).filter(Boolean)));
      return {
        ...product,
        id: product.id || id('prod'),
        slug: nextSlug,
        discount_label: product.discount_label || '',
        discount_percent: product.discount_percent || '',
        sizes: Array.isArray(product.sizes) ? product.sizes : [],
        colors: Array.isArray(product.colors) ? product.colors : [],
        variants: Array.isArray(product.variants) ? product.variants.map((variant, variantIndex) => ({
          id: variant.id || id('var'),
          size: String(variant.size || '').trim(),
          color: String(variant.color || variant.colour || '').trim(),
          stock_qty: Math.max(0, Number(variant.stock_qty || 0) || 0),
          sold_qty: Math.max(0, Number(variant.sold_qty || 0) || 0),
          sort_order: Number(variant.sort_order || variantIndex + 1)
        })).filter(variant => variant.size || variant.color) : [],
        stock_qty: Array.isArray(product.variants) && product.variants.length ? product.variants.reduce((sum, variant) => sum + (Math.max(0, Number(variant.stock_qty || 0) || 0)), 0) : Math.max(0, Number(product.stock_qty || 0) || 0),
        sold_qty: Array.isArray(product.variants) && product.variants.length ? product.variants.reduce((sum, variant) => sum + (Math.max(0, Number(variant.sold_qty || 0) || 0)), 0) : Math.max(0, Number(product.sold_qty || 0) || 0),
        gallery: Array.isArray(product.gallery) ? product.gallery : [],
        media_links: Array.isArray(product.media_links) ? product.media_links.map((link, linkIndex) => ({
          label: String(link?.label || '').trim(),
          url: String(link?.url || '').trim(),
          hidden: !!link?.hidden,
          sort_order: Number(link?.sort_order || linkIndex + 1)
        })).filter(link => link.label || link.url) : [],
        category_slugs: categorySlugs,
        featured: !!product.featured,
        new_arrival: !!product.new_arrival,
        hidden: !!product.hidden,
        sort_order: Number(product.sort_order || index + 1)
      };
    });
  }

  async function loadData() {
    const result = await api('admin/data');
    state = result.data || state;
    ensureDesignDefaults();
    state.categories = state.categories || [];
    state.products = state.products || [];
    state.products.forEach(product => { product.variants = Array.isArray(product.variants) ? product.variants : []; });
    state.blogs = state.blogs || [];
    state.inquiries = state.inquiries || [];
    state.orders = state.orders || [];
    ensureDesignDefaults();
    state.analytics = state.analytics || { events: [] };
    state.analytics.events = Array.isArray(state.analytics.events) ? state.analytics.events : [];
    state.analytics_summary = (state.analytics_summary && state.analytics_summary.counts) ? state.analytics_summary : localAnalyticsSummary();
    render();
    notice('CMS loaded.');
  }

  async function saveData() {
    normalizeBeforeSave();
    render();
    const result = await api('admin/save', { method: 'POST', body: JSON.stringify({ data: state }) });
    state = result.data || state;
    render();
    notice('Saved successfully. The public website will show the updated content.');
  }

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));
    $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    const titles = { dashboard:'Dashboard', settings:'Settings, Fonts & Colours', categories:'Categories', products:'Products', orders:'Orders', blogs:'Blogs', inquiries:'Inquiries', images:'Images' };
    const title = $('[data-title]');
    if (title) title.textContent = titles[tab] || 'CMS';
  }

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches('[data-path]')) {
      const path = target.dataset.path;
      const oldValue = getPath(path);
      let value = target.type === 'checkbox' ? target.checked : target.value;
      if (/^categories\.\d+\.slug$/.test(path)) {
        const nextSlug = slugify(value);
        if (oldValue && nextSlug) replaceCategorySlug(oldValue, nextSlug);
        value = nextSlug;
        target.value = nextSlug;
      }
      setPath(path, value);
    }
    if (target.matches('[data-sizes]')) {
      state.products[Number(target.dataset.sizes)].sizes = target.value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (target.matches('[data-colors]')) {
      state.products[Number(target.dataset.colors)].colors = parseColors(target.value);
    }
  });

  document.addEventListener('change', async (event) => {
    const target = event.target;
    try {
      if (target.matches('[data-upload-path]')) await uploadFile(target.files[0], target.dataset.uploadPath);
      if (target.matches('[data-gallery-upload]')) {
        const product = state.products[Number(target.dataset.galleryUpload)];
        product.gallery = product.gallery || [];
        const image = await uploadFile(target.files[0]);
        if (image) {
          product.gallery.push(image.url);
          if (!product.image) product.image = image.url;
        }
        render();
      }
      if (target.matches('[data-product-category]')) {
        const product = state.products[Number(target.dataset.productCategory)];
        const checked = $$(`[data-product-category="${target.dataset.productCategory}"]:checked`).map(el => el.value);
        product.category_slugs = checked;
      }
    } catch (err) { notice(err.message, true); }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.matches('[data-tab]')) switchTab(target.dataset.tab);
      if (target.id === 'saveBtn') await saveData();
      if (target.id === 'reloadBtn') await loadData();
      if (target.id === 'addCategory') { state.categories.push({ id:id('cat'), name:'New Category', slug:'', description:'', discount_label:'', discount_percent:'', offer_text:'', image:'', hidden:false, sort_order:state.categories.length + 1 }); render(); }
      if (target.id === 'addProduct') { state.products.push({ id:id('prod'), title:'New Product', slug:'', excerpt:'', content:'', price:'', compare_price:'', discount_label:'', discount_percent:'', sku:'', fabric:'', sizes:[], colors:[], stock_qty:0, sold_qty:0, stock_status:'instock', stock_label:'In Stock', variants:[], image:'', gallery:[], media_links:[], category_slugs:[], featured:false, new_arrival:false, hidden:false, sort_order:state.products.length + 1 }); render(); }
      if (target.id === 'addBlog') { state.blogs.push({ id:id('blog'), title:'New Blog', slug:'new-blog', excerpt:'', content:'', image:'', published_at:new Date().toISOString().slice(0,10), hidden:false, sort_order:state.blogs.length + 1 }); render(); }
      if (target.matches('[data-remove]')) {
        const [collection, index] = target.dataset.remove.split('.');
        if (confirm('Delete this item from CMS data? Attached image files are not deleted unless you press Delete file first.')) { state[collection].splice(Number(index), 1); render(); }
      }
      if (target.matches('[data-move]')) {
        const [collection, index, delta] = target.dataset.move.split('.');
        const i = Number(index), d = Number(delta), j = i + d;
        if (j >= 0 && j < state[collection].length) {
          const arr = state[collection];
          [arr[i], arr[j]] = [arr[j], arr[i]];
          arr.forEach((item, idx) => item.sort_order = idx + 1);
          render();
        }
      }
      if (target.matches('[data-clear-path]')) { setPath(target.dataset.clearPath, ''); render(); }
      if (target.matches('[data-delete-upload]')) {
        const path = target.dataset.deleteUpload;
        const url = getPath(path);
        if (url && confirm('Delete this CMS-uploaded image file and clear the field?')) {
          await deleteImageUrl(url);
          setPath(path, '');
          render();
        }
      }
      if (target.matches('[data-add-gallery]')) { const p = state.products[Number(target.dataset.addGallery)]; p.gallery = p.gallery || []; p.gallery.push(''); render(); }
      if (target.matches('[data-add-variant]')) { const p = state.products[Number(target.dataset.addVariant)]; p.variants = Array.isArray(p.variants) ? p.variants : []; p.variants.push({ id:id('var'), size:'', color:'', stock_qty:0, sold_qty:0, sort_order:p.variants.length + 1 }); render(); }
      if (target.matches('[data-generate-variants]')) { generateVariantsForProduct(Number(target.dataset.generateVariants)); render(); }
      if (target.matches('[data-remove-variant]')) { const [i,j] = target.dataset.removeVariant.split('.').map(Number); state.products[i].variants.splice(j, 1); render(); }
      if (target.matches('[data-add-media-link]')) { const p = state.products[Number(target.dataset.addMediaLink)]; p.media_links = Array.isArray(p.media_links) ? p.media_links : []; p.media_links.push({ label:'Instagram video', url:'', hidden:false, sort_order:p.media_links.length + 1 }); render(); }
      if (target.matches('[data-remove-media-link]')) { const [i,j] = target.dataset.removeMediaLink.split('.').map(Number); state.products[i].media_links.splice(j, 1); render(); }
      if (target.matches('[data-remove-gallery]')) { const [i,j] = target.dataset.removeGallery.split('.').map(Number); state.products[i].gallery.splice(j, 1); render(); }
      if (target.matches('[data-delete-gallery-file]')) {
        const [i,j] = target.dataset.deleteGalleryFile.split('.').map(Number);
        const url = state.products[i]?.gallery?.[j];
        if (url && confirm('Delete this gallery image file and remove it from the product?')) {
          await deleteImageUrl(url);
          state.products[i].gallery.splice(j, 1);
          render();
        }
      }
      if (target.matches('[data-delete-used-image]')) {
        const path = target.dataset.deleteUsedImage;
        const url = getPath(path);
        if (url && confirm('Delete this CMS-uploaded image file and clear it from CMS data?')) {
          await deleteImageUrl(url);
          setPath(path, '');
          render();
        }
      }
      if (target.id === 'globalUploadBtn') {
        const file = $('#globalUpload').files[0];
        const image = await uploadFile(file);
        $('#globalUploadResult').innerHTML = image ? `<p class="code">${esc(image.url)}</p><p><a class="preview-link" href="${esc(image.url)}" target="_blank" rel="noopener">Open uploaded image</a></p>` : '';
      }
      if (target.id === 'deleteImageBtn') {
        const url = $('#deleteImageUrl').value.trim();
        if (confirm('Delete this uploaded image file from the server?')) await deleteImageUrl(url);
      }
    } catch (err) { notice(err.message, true); }
  });

  document.addEventListener('blur', (event) => {
    const target = event.target;
    if (target.matches('[data-path$=".name"],[data-path$=".title"]')) {
      const slugPath = target.dataset.path.replace(/\.(name|title)$/, '.slug');
      const currentSlug = slugify(getPath(slugPath));
      if (!currentSlug || /^new-(product|category)(-\d+)?$/.test(currentSlug)) {
        setPath(slugPath, slugify(target.value));
        render();
      }
    }
  }, true);

  function showStaticLogin(message) {
    const login = $('#staticLogin');
    const app = $('#cmsApp');
    const err = $('#staticLoginError');
    if (login) login.hidden = false;
    if (app) app.hidden = true;
    if (err) {
      err.hidden = !message;
      err.textContent = message || '';
    }
  }

  function showStaticApp() {
    const login = $('#staticLogin');
    const app = $('#cmsApp');
    if (login) login.hidden = true;
    if (app) app.hidden = false;
  }

  async function startStaticCms() {
    const form = $('#staticLoginForm');
    const inputToken = $('#staticAdminToken');
    const logout = $('#staticLogout');

    if (logout) {
      logout.addEventListener('click', async () => {
        try { await api('auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch (err) { /* ignore logout network errors */ }
        adminToken = '';
        showStaticLogin('Logged out.');
      });
    }

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const loginToken = (inputToken?.value || '').trim();
        if (!loginToken) return showStaticLogin('Please enter your GitHub token.');
        try {
          const login = await api('auth/login', {
            method: 'POST',
            body: JSON.stringify({ provider: 'github', token: loginToken })
          });
          if (inputToken) inputToken.value = '';
          showStaticApp();
          await loadData();
        } catch (err) {
          adminToken = '';
          showStaticLogin(err.message || 'Invalid GitHub token.');
        }
      });
    }

    // Try to use the backend HttpOnly session cookie. No token is stored in
    // localStorage/sessionStorage or readable browser JavaScript after login.
    try {
      showStaticApp();
      await loadData();
    } catch (err) {
      adminToken = '';
      showStaticLogin();
    }
  }

  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  if (staticLogin) startStaticCms(); else loadData().catch(err => notice(err.message, true));
})();
