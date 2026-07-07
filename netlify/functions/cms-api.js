'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let getStore = null;
let connectLambda = null;
try {
  ({ getStore, connectLambda } = require('@netlify/blobs'));
} catch (error) {
  getStore = null;
  connectLambda = null;
}


let FILE_CONFIG = {};
try {
  // Git-based fallback token. Keep this file inside netlify/functions so it is
  // bundled with the function and is not published as a public browser file.
  FILE_CONFIG = require('./cms-config.json');
} catch (error) {
  FILE_CONFIG = {};
}

function expectedAdminToken() {
  return process.env.CMS_ADMIN_TOKEN || FILE_CONFIG.admin_token || 'change-this-admin-token';
}

const DATA_KEY = 'content';
const IMAGE_PREFIX = 'image:';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const FALLBACK_DIR = path.join(os.tmpdir(), 'luxe-boutique-cms');
const FALLBACK_DATA = path.join(FALLBACK_DIR, 'content.json');
const FALLBACK_IMAGES = path.join(FALLBACK_DIR, 'images');

const DEFAULT_DATA = {
  version: 3,
  updated_at: new Date().toISOString(),
  settings: {
    site_name: 'Own Light',
    topbar_text: 'New boutique catalogue: browse categories, inquire online, Instagram, or WhatsApp us directly.',
    hero_title: 'Boutique Styles, Curated by Category',
    hero_text: 'Upload your own high-quality products and gallery images from the CMS. The website updates from the CMS after saving.',
    hero_image: '',
    whatsapp_number: '9779868800001',
    instagram_url: '',
    default_message: 'Hello, I want to inquire about your boutique products.',
    contact_heading: 'Contact Own Light',
    contact_text: 'Use the inquiry form, Instagram, or WhatsApp for direct messages.',
    fonts: {
      body: 'Poppins, Arial, sans-serif',
      heading: 'Playfair Display, Georgia, serif',
      nav: 'Poppins, Arial, sans-serif',
      button: 'Poppins, Arial, sans-serif',
      body_size: '16px',
      heading_weight: '700'
    },
    colors: {
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
    }
  },
  categories: [
    { id: 'cat_new', name: 'New Arrivals', slug: 'new-arrivals', description: 'Latest boutique additions.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 1 },
    { id: 'cat_dresses', name: 'Dresses', slug: 'dresses', description: 'Boutique dresses for day and evening.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 2 },
    { id: 'cat_kurtis', name: 'Kurtis', slug: 'kurtis', description: 'Kurtis and kurti sets.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 3 },
    { id: 'cat_sarees', name: 'Sarees', slug: 'sarees', description: 'Festive and party sarees.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 4 },
    { id: 'cat_tops', name: 'Tops', slug: 'tops', description: 'Everyday and statement tops.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 5 },
    { id: 'cat_coord', name: 'Co-ord Sets', slug: 'co-ord-sets', description: 'Matching two-piece sets.', discount_label: '', discount_percent: '', offer_text: '', image: '', hidden: false, sort_order: 6 }
  ],
  products: [
    { id: 'prod_001', title: 'Sample Product - Replace From CMS', slug: 'sample-product', excerpt: 'Edit or delete this sample product from the CMS.', content: 'Use the CMS product form to add price, discount, sizes, colors, main image, and multiple gallery images. The website will update from saved CMS data.', price: '', compare_price: '', discount_label: '', discount_percent: '', sku: '', fabric: '', sizes: ['S', 'M', 'L', 'XL'], colors: [{ name: 'Black', hex: '#111111' }, { name: 'White', hex: '#ffffff' }], stock_qty: 0, sold_qty: 0, variants: [], stock_status: 'instock', stock_label: 'In Stock', image: '', gallery: [], media_links: [], category_slugs: ['new-arrivals'], featured: false, new_arrival: true, hidden: true, sort_order: 1 }
  ],
  blogs: [],
  inquiries: [],
  orders: [],
  analytics: { events: [] }
};

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Cms-Token, X-Luxe-Token',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function text(value, max = 5000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, '').trim().slice(0, max);
}

function slugify(value) {
  return text(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `item-${Date.now().toString(36)}`;
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

function normalizeProductVariants(product) {
  return (Array.isArray(product.variants) ? product.variants : []).map((variant, index) => ({
    id: text(variant.id || `var_${index + 1}`, 120),
    size: text(variant.size || '', 80),
    color: text(variant.color || variant.colour || '', 120),
    stock_qty: Math.max(0, Number(variant.stock_qty || 0) || 0),
    sold_qty: Math.max(0, Number(variant.sold_qty || variant.quantity_sold || 0) || 0),
    sort_order: Number(variant.sort_order || index + 1)
  })).filter((variant) => variant.size || variant.color);
}

function variantTotal(variants, key) {
  return (Array.isArray(variants) ? variants : []).reduce((sum, variant) => sum + Math.max(0, Number(variant[key] || 0) || 0), 0);
}

function normalizeData(out) {
  const categorySlugMap = {};
  const usedCategorySlugs = new Set();
  out.categories = (Array.isArray(out.categories) ? out.categories : []).map((category, index) => {
    const currentCategorySlug = slugify(category.slug);
    const originalSlug = (!currentCategorySlug || /^new-category(-\d+)?$/.test(currentCategorySlug)) ? slugify(category.name || `category-${index + 1}`) : currentCategorySlug;
    const nextSlug = uniqueSlug(originalSlug, usedCategorySlugs);
    if (!categorySlugMap[originalSlug]) categorySlugMap[originalSlug] = nextSlug;
    if (category.slug && !categorySlugMap[slugify(category.slug)]) categorySlugMap[slugify(category.slug)] = nextSlug;
    return {
      ...category,
      id: text(category.id || `cat_${index + 1}`, 120),
      slug: nextSlug,
      description: text(category.description || '', 1200),
      discount_label: text(category.discount_label || '', 160),
      discount_percent: text(category.discount_percent || '', 20),
      offer_text: text(category.offer_text || '', 240),
      hidden: bool(category.hidden),
      sort_order: Number(category.sort_order || index + 1)
    };
  });

  const usedProductSlugs = new Set();
  out.products = (Array.isArray(out.products) ? out.products : []).map((product, index) => {
    const categorySlugs = Array.from(new Set((product.category_slugs || []).map((slug) => {
      const clean = slugify(slug);
      return categorySlugMap[clean] || clean;
    }).filter(Boolean)));
    return {
      ...product,
      id: text(product.id || `prod_${index + 1}`, 120),
      slug: uniqueSlug((!slugify(product.slug) || /^new-product(-\d+)?$/.test(slugify(product.slug))) ? (product.title || `product-${index + 1}`) : product.slug, usedProductSlugs),
      discount_label: text(product.discount_label || '', 160),
      discount_percent: text(product.discount_percent || '', 20),
      sizes: Array.isArray(product.sizes) ? product.sizes.map((item) => text(item, 80)).filter(Boolean) : [],
      colors: Array.isArray(product.colors) ? product.colors.map((item) => ({ name: text(item.name || '', 80), hex: text(item.hex || '#dddddd', 20) })).filter((item) => item.name) : [],
      variants: normalizeProductVariants(product),
      stock_qty: normalizeProductVariants(product).length ? variantTotal(normalizeProductVariants(product), 'stock_qty') : Math.max(0, Number(product.stock_qty || 0) || 0),
      sold_qty: normalizeProductVariants(product).length ? variantTotal(normalizeProductVariants(product), 'sold_qty') : Math.max(0, Number(product.sold_qty || product.quantity_sold || 0) || 0),
      gallery: Array.isArray(product.gallery) ? product.gallery.map((item) => text(item, 3000)).filter(Boolean) : [],
      media_links: Array.isArray(product.media_links) ? product.media_links.map((link, linkIndex) => ({
        label: text(link && link.label ? link.label : '', 120),
        url: text(link && link.url ? link.url : '', 3000),
        hidden: bool(link && link.hidden),
        sort_order: Number((link && link.sort_order) || linkIndex + 1)
      })).filter((link) => link.label || link.url) : [],
      category_slugs: categorySlugs,
      featured: bool(product.featured),
      new_arrival: bool(product.new_arrival),
      hidden: bool(product.hidden),
      sort_order: Number(product.sort_order || index + 1)
    };
  });
  const usedBlogSlugs = new Set();
  out.blogs = (Array.isArray(out.blogs) ? out.blogs : []).map((blog, index) => ({
    ...blog,
    id: text(blog.id || `blog_${index + 1}`, 120),
    title: text(blog.title || 'Blog', 240),
    slug: uniqueSlug((!slugify(blog.slug) || /^new-blog(-\d+)?$/.test(slugify(blog.slug))) ? (blog.title || `blog-${index + 1}`) : blog.slug, usedBlogSlugs),
    excerpt: text(blog.excerpt || '', 1200),
    content: text(blog.content || '', 20000),
    image: text(blog.image || '', 3000),
    published_at: text(blog.published_at || blog.created_at || '', 80),
    hidden: bool(blog.hidden),
    sort_order: Number(blog.sort_order || index + 1)
  }));

  out.orders = (Array.isArray(out.orders) ? out.orders : []).map((order, index) => ({
    ...order,
    id: text(order.id || `ord_${index + 1}`, 120),
    created_at: text(order.created_at || '', 80),
    status: text(order.status || 'new', 40),
    customer: order.customer && typeof order.customer === 'object' ? {
      name: text(order.customer.name || '', 160),
      phone: text(order.customer.phone || '', 80),
      email: text(order.customer.email || '', 180),
      city: text(order.customer.city || '', 160),
      address: text(order.customer.address || '', 1000),
      note: text(order.customer.note || order.customer.notes || '', 1500)
    } : {},
    items: Array.isArray(order.items) ? order.items.map((item) => ({
      product_id: text(item.product_id || '', 120),
      product_slug: slugify(item.product_slug || item.product_title || ''),
      product_title: text(item.product_title || 'Product', 240),
      quantity: Math.max(1, Math.min(999, Number(item.quantity || 1) || 1)),
      size: text(item.size || '', 80),
      color: text(item.color || '', 120),
      price: text(item.price || item.unit_price || '', 80),
      image: text(item.image || '', 3000)
    })) : [],
    total_quantity: Math.max(0, Number(order.total_quantity || 0) || 0),
    subtotal: Math.max(0, Number(order.subtotal || 0) || 0),
    source: text(order.source || 'website-cart', 80)
  }));
  return out;
}


function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function safeTokenCompare(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidEmail(value) {
  const email = text(value, 180);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function isValidPhone(value) {
  const phone = text(value, 80);
  if (!phone) return false;
  if (!/^\+?[0-9][0-9\s().-]{5,24}$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function cleanContact(customer) {
  const next = customer || {};
  next.phone = isValidPhone(next.phone) ? text(next.phone, 80) : '';
  next.email = isValidEmail(next.email) ? text(next.email, 180) : '';
  return next;
}

function parseCookies(event) {
  const raw = (event.headers || {}).cookie || (event.headers || {}).Cookie || '';
  return String(raw).split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function cmsSessionCookie(token, maxAgeSeconds) {
  const value = token ? encodeURIComponent(token) : '';
  const maxAge = Math.max(0, Number(maxAgeSeconds || 0) || 0);
  return `ownlight_cms_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function tokenFromEvent(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const cookies = parseCookies(event);
  return (
    cookies.ownlight_cms_session ||
    headers['x-cms-token'] || headers['X-Cms-Token'] ||
    headers['x-luxe-token'] || headers['X-Luxe-Token'] ||
    (event.queryStringParameters || {}).token || ''
  ).trim();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function sessionSecret() {
  return (
    process.env.CMS_SESSION_SECRET ||
    process.env.CMS_ADMIN_TOKEN ||
    FILE_CONFIG.admin_token ||
    process.env.SITE_ID ||
    'luxe-boutique-cms-session-secret'
  );
}

function signSession(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifySession(token) {
  try {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) return null;
    const expectedSignature = crypto
      .createHmac('sha256', sessionSecret())
      .update(`${header}.${payload}`)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(base64UrlDecode(payload));
    if (data.type !== 'luxe-cms-session') return null;
    if (!data.exp || Number(data.exp) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (error) {
    return null;
  }
}

function createSession(authData) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.CMS_SESSION_TTL_SECONDS || FILE_CONFIG.session_ttl_seconds || 7 * 24 * 60 * 60);
  const payload = {
    type: 'luxe-cms-session',
    auth: authData.auth || 'cms',
    login: authData.login || 'admin',
    name: authData.name || '',
    iat: now,
    exp: now + Math.max(300, ttl)
  };
  return { token: signSession(payload), payload, maxAge: Math.max(300, ttl) };
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function githubConfig() {
  const github = FILE_CONFIG.github || {};
  return {
    allowedUsers: parseList(process.env.GITHUB_ALLOWED_USERS || github.allowed_users || FILE_CONFIG.github_allowed_users),
    // Repo checking is OFF by default because many fine-grained GitHub tokens
    // are valid but intentionally have no repository write permissions. This
    // CMS uses GitHub only as a one-time login verifier; it does not need repo
    // access to edit CMS content.
    requireRepoAccess: bool(process.env.GITHUB_REQUIRE_REPO_ACCESS || github.require_repo_access || FILE_CONFIG.github_require_repo_access),
    repo: text(process.env.GITHUB_REPO_FULL_NAME || process.env.GITHUB_REPOSITORY || github.repo || FILE_CONFIG.github_repo_full_name || FILE_CONFIG.github_repo, 180)
  };
}

async function githubRequest(apiPath, token) {
  const https = require('https');
  const pathName = String(apiPath || '/user').startsWith('/') ? apiPath : `/${apiPath}`;
  const options = {
    hostname: 'api.github.com',
    path: pathName,
    method: 'GET',
    headers: {
      'accept': 'application/vnd.github+json',
      'authorization': `Bearer ${token}`,
      'user-agent': 'luxe-boutique-cms-netlify',
      'x-github-api-version': '2022-11-28'
    }
  };

  return await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (error) { json = {}; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('GitHub token check timed out.')));
    req.on('error', reject);
    req.end();
  });
}

async function validateGithubToken(token) {
  if (!token || token.length < 20) {
    throw new Error('Paste a valid GitHub personal access token.');
  }

  const cfg = githubConfig();
  let userResult = null;
  let login = 'github-user';
  let userPayload = {};

  // Best case: /user returns the GitHub username. Some fine-grained tokens
  // without profile/account permissions can be valid but still fail /user, so
  // v6 also falls back to /rate_limit to verify the token itself.
  userResult = await githubRequest('/user', token);
  if (userResult.status >= 200 && userResult.status < 300 && userResult.json.login) {
    userPayload = userResult.json || {};
    login = String(userPayload.login || 'github-user');
  } else {
    const rateResult = await githubRequest('/rate_limit', token);
    if (rateResult.status < 200 || rateResult.status >= 300) {
      const message = userResult?.json?.message || rateResult?.json?.message || 'Bad credentials';
      throw new Error(`GitHub token rejected: ${message}. Generate a new token and paste the full token.`);
    }
    // Token is valid, but GitHub did not expose profile information for this
    // fine-grained token. Accept it because the user asked for GitHub Developer
    // tokens to work as one-time CMS login tokens.
    login = 'github-token';
    userPayload = {};
  }

  if (cfg.allowedUsers.length) {
    if (login === 'github-token') {
      throw new Error('This token is valid, but GitHub did not expose the username. Remove GITHUB_ALLOWED_USERS or create a token with profile/user read permission.');
    }
    const allowed = cfg.allowedUsers.map((item) => item.toLowerCase());
    if (!allowed.includes(login.toLowerCase())) {
      throw new Error(`GitHub user ${login} is not allowed to access this CMS.`);
    }
  }

  if (cfg.requireRepoAccess && cfg.repo) {
    const repoResult = await githubRequest(`/repos/${cfg.repo}`, token);
    if (repoResult.status < 200 || repoResult.status >= 300) {
      throw new Error(`This GitHub token cannot access repository ${cfg.repo}.`);
    }
  }

  return {
    login,
    name: userPayload.name || '',
    id: userPayload.id || '',
    avatar_url: userPayload.avatar_url || ''
  };
}

function isAdmin(event) {
  const provided = tokenFromEvent(event);
  if (verifySession(provided)) return true;
  return safeTokenCompare(provided, expectedAdminToken());
}

function endpointFromEvent(event) {
  const qsEndpoint = (event.queryStringParameters || {}).endpoint;
  if (qsEndpoint) return String(qsEndpoint).replace(/^\/+/, '');
  const rawPath = String(event.path || '').replace(/\/+$/, '');
  const pieces = [
    '/.netlify/functions/cms-api/',
    '/api/'
  ];
  for (const marker of pieces) {
    const index = rawPath.indexOf(marker);
    if (index !== -1) return rawPath.slice(index + marker.length).replace(/^\/+/, '');
  }
  return '';
}

function baseUrl(event) {
  const headers = event.headers || {};
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  const host = headers.host || headers.Host || '';
  return host ? `${proto}://${host}` : '';
}

function parseJson(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch (error) { return {}; }
}

async function store() {
  if (!getStore) return null;
  try {
    return getStore('luxe-boutique-cms');
  } catch (error) {
    // If Netlify Blobs is not available, use temporary filesystem fallback
    // instead of crashing the CMS. On real Netlify Functions, connectLambda()
    // prepares the Blobs context before this function is called.
    if (/environment has not been configured|MissingBlobsEnvironmentError/i.test(error.message || '')) {
      return null;
    }
    throw error;
  }
}

function replaceOldBrand(value) {
  return typeof value === 'string' ? value.replace(new RegExp('\\b' + 'SH' + 'REE' + '\\b', 'g'), 'Own Light') : value;
}

function normalizeBrandSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  ['site_name', 'topbar_text', 'hero_title', 'hero_text', 'default_message', 'contact_heading', 'contact_text'].forEach((key) => {
    settings[key] = replaceOldBrand(settings[key]);
  });
  return settings;
}

function safeColor(value, fallback) {
  const clean = text(value || '', 80);
  if (/^#[0-9a-f]{3,8}$/i.test(clean) || /^rgba?\(/i.test(clean) || /^[a-z]+$/i.test(clean)) return clean;
  return fallback;
}

function normalizeColors(colors = {}) {
  const defaults = DEFAULT_DATA.settings.colors;
  const out = { ...defaults, ...(colors && typeof colors === 'object' ? colors : {}) };
  Object.keys(defaults).forEach((key) => { out[key] = safeColor(out[key], defaults[key]); });
  return out;
}

function mergeData(data) {
  const out = { ...DEFAULT_DATA, ...(data && typeof data === 'object' ? data : {}) };
  out.settings = normalizeBrandSettings({ ...DEFAULT_DATA.settings, ...(out.settings || {}) });
  out.settings.fonts = { ...DEFAULT_DATA.settings.fonts, ...((out.settings && out.settings.fonts) || {}) };
  out.settings.colors = normalizeColors((out.settings && out.settings.colors) || {});
  out.categories = Array.isArray(out.categories) ? out.categories : [];
  out.products = Array.isArray(out.products) ? out.products : [];
  out.blogs = Array.isArray(out.blogs) ? out.blogs : [];
  out.inquiries = Array.isArray(out.inquiries) ? out.inquiries : [];
  out.orders = Array.isArray(out.orders) ? out.orders : [];
  out.analytics = out.analytics && typeof out.analytics === 'object' ? out.analytics : { events: [] };
  out.analytics.events = Array.isArray(out.analytics.events) ? out.analytics.events : [];
  return normalizeData(out);
}

async function loadData() {
  const s = await store();
  if (s) {
    const data = await s.get(DATA_KEY, { type: 'json' }).catch(() => null);
    if (data) return mergeData(data);
    await s.setJSON(DATA_KEY, DEFAULT_DATA);
    return mergeData(DEFAULT_DATA);
  }
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  if (!fs.existsSync(FALLBACK_DATA)) {
    fs.writeFileSync(FALLBACK_DATA, JSON.stringify(DEFAULT_DATA, null, 2));
  }
  return mergeData(JSON.parse(fs.readFileSync(FALLBACK_DATA, 'utf8')));
}

async function saveData(data) {
  const clean = data && typeof data === 'object' ? { ...data } : {};
  delete clean.analytics_summary;
  const saved = mergeData(clean);
  saved.version = 3;
  saved.updated_at = new Date().toISOString();
  const s = await store();
  if (s) {
    await s.setJSON(DATA_KEY, saved);
  } else {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    fs.writeFileSync(FALLBACK_DATA, JSON.stringify(saved, null, 2));
  }
  return saved;
}

function visible(items, includeHidden = false) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => includeHidden || !item.hidden)
    .sort((a, b) => Number(a.sort_order || 999) - Number(b.sort_order || 999));
}

function hasCategory(product, slug) {
  const clean = slugify(slug);
  return (product.category_slugs || []).map((item) => slugify(item)).includes(clean);
}


function publicCategory(category, data, includeHidden = false) {
  const slug = category.slug;
  const count = visible(data.products, includeHidden).filter((product) => hasCategory(product, slug)).length;
  return { ...category, count };
}

function publicProduct(product, data) {
  const categoryBySlug = new Map(visible(data.categories, false).map((category) => [slugify(category.slug), category]));
  const categories = (product.category_slugs || [])
    .map((slug) => categoryBySlug.get(slugify(slug)))
    .filter(Boolean)
    .map((category) => ({ name: category.name, slug: category.slug, discount_label: category.discount_label || '', discount_percent: category.discount_percent || '', offer_text: category.offer_text || '' }));
  const media_links = (Array.isArray(product.media_links) ? product.media_links : [])
    .filter((link) => link && link.url && !bool(link.hidden))
    .sort((a, b) => Number(a.sort_order || 999) - Number(b.sort_order || 999))
    .map((link) => ({ label: text(link.label || 'Open link', 120), url: text(link.url, 3000) }));
  return { ...product, categories, media_links };
}


function priceNumber(value) {
  const raw = String(value ?? '').replace(/[^0-9.]/g, '');
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

function findProductForOrder(data, item) {
  const id = text(item.product_id || '', 120);
  const slug = slugify(item.product_slug || item.slug || item.product_title || '');
  return (data.products || []).find((product) => id && String(product.id || '') === id)
    || (data.products || []).find((product) => slug && slugify(product.slug || product.title || product.id || '') === slug)
    || null;
}

function sanitizeOrder(body, data) {
  const now = new Date().toISOString();
  const customerBody = body.customer && typeof body.customer === 'object' ? body.customer : body;
  const customer = {
    name: text(customerBody.name, 160),
    phone: text(customerBody.phone, 80),
    email: text(customerBody.email, 180),
    city: text(customerBody.city, 160),
    address: text(customerBody.address, 1000),
    note: text(customerBody.note || customerBody.notes, 1500)
  };
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((rawItem) => {
    const item = rawItem || {};
    const product = findProductForOrder(data, item);
    const quantity = Math.max(1, Math.min(999, Number(item.quantity || item.qty || 1) || 1));
    const productSlug = product ? slugify(product.slug || product.title || product.id) : slugify(item.product_slug || item.product_title || 'product');
    const productTitle = product ? text(product.title || 'Product', 240) : text(item.product_title || 'Product', 240);
    const productPrice = (product && String(product.price || '').trim()) ? product.price : (item.price || item.unit_price || '');
    return {
      product_id: product ? text(product.id || '', 120) : text(item.product_id || '', 120),
      product_slug: productSlug,
      product_title: productTitle,
      quantity,
      size: text(item.size, 80),
      color: text(item.color, 120),
      price: text(productPrice, 80),
      line_total: priceNumber(productPrice) * quantity,
      image: text(item.image || (product && product.image) || '', 3000)
    };
  }).filter((item) => item.product_slug || item.product_title);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);

  return {
    id: `ord_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    created_at: now,
    status: 'new',
    payment_status: 'not_paid',
    customer,
    items,
    total_quantity: totalQuantity,
    subtotal,
    source: text(body.source || 'website-cart', 80)
  };
}

function applyOrderSoldQuantities(data, order) {
  (Array.isArray(order.items) ? order.items : []).forEach((item) => {
    const product = findProductForOrder(data, item);
    const qty = Math.max(1, Number(item.quantity || 1) || 1);
    if (product) {
      product.sold_qty = Math.max(0, Number(product.sold_qty || 0) || 0) + qty;
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const size = text(item.size || '', 80).toLowerCase();
      const color = text(item.color || '', 120).toLowerCase();
      const variant = variants.find((row) => {
        const sizeOk = !size || text(row.size || '', 80).toLowerCase() === size;
        const colorOk = !color || text(row.color || row.colour || '', 120).toLowerCase() === color;
        return sizeOk && colorOk;
      });
      if (variant) variant.sold_qty = Math.max(0, Number(variant.sold_qty || 0) || 0) + qty;
    }
  });
  return data;
}

function sanitizeInquiry(body) {
  const now = new Date().toISOString();
  return {
    id: `inq_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    created_at: now,
    status: 'new',
    name: text(body.name, 160),
    phone: text(body.phone, 80),
    email: text(body.email, 180),
    product_slug: (body.product_slug || body.product) ? slugify(body.product_slug || body.product) : '',
    product_title: text(body.product_title || body.product || '', 240),
    size: text(body.size, 80),
    color: text(body.color, 120),
    message: text(body.message, 2500),
    source: text(body.source || 'website', 80)
  };
}

function safeFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']);
  const cleanBase = path.basename(filename || 'image', ext).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return `${cleanBase}${allowed.has(ext) ? ext : '.img'}`;
}

function validateImageUpload(body) {
  const filename = safeFilename(body.filename || 'image');
  const contentType = text(body.content_type || 'application/octet-stream', 120).toLowerCase();
  const buffer = Buffer.from(String(body.base64 || ''), 'base64');

  if (!buffer.length) throw new Error('No image data received.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Image is too large. Maximum size is 25 MB.');

  const ext = path.extname(filename).toLowerCase();
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg', '.img']);
  const allowedMime = contentType.startsWith('image/') || contentType === 'application/octet-stream';
  if (!allowedExt.has(ext) || !allowedMime) throw new Error('Unsupported image type.');

  if (ext === '.svg' || contentType === 'image/svg+xml') {
    const svg = buffer.toString('utf8').toLowerCase();
    if (/<script|on\w+\s*=|javascript:|<foreignobject/.test(svg)) {
      throw new Error('Unsafe SVG rejected. Remove scripts/events and upload again.');
    }
  }

  return { filename, contentType: contentType === 'application/octet-stream' ? 'image/*' : contentType, buffer };
}

async function saveImage(key, payload) {
  const s = await store();
  const value = { content_type: payload.contentType, base64: payload.buffer.toString('base64'), filename: payload.filename };
  if (s) {
    await s.setJSON(`${IMAGE_PREFIX}${key}`, value);
  } else {
    const file = path.join(FALLBACK_IMAGES, encodeURIComponent(key) + '.json');
    fs.mkdirSync(FALLBACK_IMAGES, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
}

async function readImage(key) {
  const s = await store();
  if (s) return await s.get(`${IMAGE_PREFIX}${key}`, { type: 'json' }).catch(() => null);
  const file = path.join(FALLBACK_IMAGES, encodeURIComponent(key) + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function deleteImage(key) {
  const s = await store();
  if (s) {
    await s.delete(`${IMAGE_PREFIX}${key}`);
  } else {
    const file = path.join(FALLBACK_IMAGES, encodeURIComponent(key) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function imageKeyFromUrl(url) {
  try {
    const parsed = new URL(url, 'https://example.com');
    const match = parsed.pathname.match(/\/api\/image\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (error) {
    return '';
  }
}

function productTitleFromSlug(data, slug, fallback = '') {
  const clean = slugify(slug || fallback || '');
  const product = (data.products || []).find((item) => slugify(item.slug || item.title || item.id) === clean || String(item.id || '') === String(slug || ''));
  return product && product.title ? product.title : (fallback || clean || 'Unknown product');
}

function topRowsFromMap(map, limit = 10) {
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, limit);
}

function analyticsSummary(data) {
  const inquiryMap = {};
  (Array.isArray(data.inquiries) ? data.inquiries : []).forEach((inquiry) => {
    const slug = slugify(inquiry.product_slug || inquiry.product_title || 'general-inquiry');
    const title = productTitleFromSlug(data, slug, inquiry.product_title || 'General inquiry');
    if (!inquiryMap[slug]) inquiryMap[slug] = { slug, title, count: 0 };
    inquiryMap[slug].count += 1;
  });

  const orders = Array.isArray(data.orders) ? data.orders : [];
  const soldMap = {};
  let totalQuantitySold = 0;
  let totalSalesAmount = 0;
  orders.forEach((order) => {
    totalSalesAmount += Number(order.subtotal || 0) || 0;
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      const slug = slugify(item.product_slug || item.product_title || 'unknown-product');
      const title = productTitleFromSlug(data, slug, item.product_title || 'Unknown product');
      const qty = Math.max(1, Number(item.quantity || 1) || 1);
      if (!soldMap[slug]) soldMap[slug] = { slug, title, count: 0 };
      soldMap[slug].count += qty;
      totalQuantitySold += qty;
    });
  });

  const events = data.analytics && Array.isArray(data.analytics.events) ? data.analytics.events : [];
  const counts = { product_view: 0, inquiry_click: 0, whatsapp_click: 0, inquiry_open: 0, inquiry_submit: 0, add_to_cart: 0, order_submit: 0 };
  const viewMap = {};
  const clickMap = {};
  events.forEach((event) => {
    const type = text(event.event_type || event.type || '', 80);
    if (counts[type] !== undefined) counts[type] += 1;
    const slug = slugify(event.product_slug || event.product_title || 'unknown-product');
    const title = productTitleFromSlug(data, slug, event.product_title || 'Unknown product');
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
    top_inquiries: topRowsFromMap(inquiryMap),
    top_views: topRowsFromMap(viewMap),
    top_clicks: topRowsFromMap(clickMap),
    top_sold: topRowsFromMap(soldMap),
    total_orders: orders.length,
    total_quantity_sold: totalQuantitySold,
    total_sales_amount: totalSalesAmount,
    total_events: events.length
  };
}

function sanitizeAnalyticsEvent(body) {
  const allowedTypes = new Set(['product_view', 'inquiry_click', 'whatsapp_click', 'inquiry_open', 'inquiry_submit', 'add_to_cart', 'order_submit']);
  const eventType = text(body.event_type || body.type || '', 80);
  if (!allowedTypes.has(eventType)) throw new Error('Unsupported tracking event.');
  const productSlug = slugify(body.product_slug || body.product || body.product_title || '');
  const productTitle = text(body.product_title || '', 240);
  if (!productSlug && !productTitle) throw new Error('Product is required for tracking.');
  return {
    id: `evt_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    created_at: new Date().toISOString(),
    event_type: eventType,
    product_id: text(body.product_id || '', 120),
    product_slug: productSlug,
    product_title: productTitle,
    page: text(body.page || '', 500),
    source: text(body.source || 'website', 80)
  };
}

function recordAnalyticsEvent(data, event) {
  data.analytics = data.analytics && typeof data.analytics === 'object' ? data.analytics : { events: [] };
  data.analytics.events = Array.isArray(data.analytics.events) ? data.analytics.events : [];
  data.analytics.events.push(event);
  const maxEvents = Number(process.env.CMS_ANALYTICS_MAX_EVENTS || FILE_CONFIG.analytics_max_events || 5000);
  if (data.analytics.events.length > maxEvents) {
    data.analytics.events = data.analytics.events.slice(data.analytics.events.length - maxEvents);
  }
  return data;
}

exports.handler = async function handler(event) {
  // Required by @netlify/blobs when the function is executed in Netlify's
  // Lambda-compatible runtime. Without this, getStore() can throw:
  // 'The environment has not been configured to use Netlify Blobs'.
  if (typeof connectLambda === 'function') {
    try { connectLambda(event); } catch (error) { /* fallback storage will handle it */ }
  }

  const method = event.httpMethod || 'GET';
  const endpoint = endpointFromEvent(event);
  const [root, second, ...rest] = endpoint.split('/').filter(Boolean);

  if (method === 'OPTIONS') return response(200, { ok: true });

  try {
    if (!root || root === 'health') {
      return response(200, { ok: true, time: new Date().toISOString(), auth: 'session-or-github-login-v6' });
    }

    if (root === 'auth' && second === 'logout' && method === 'POST') {
      return response(200, { ok: true, message: 'Logged out.' }, { 'Set-Cookie': cmsSessionCookie('', 0) });
    }

    if (root === 'auth' && second === 'login' && method === 'POST') {
      const body = parseJson(event);
      const token = text(body.token || '', 500);
      const provider = text(body.provider || 'github', 40).toLowerCase();

      if (!token) return response(400, { ok: false, message: 'Token is required.' });

      // Legacy CMS token still works, but the browser receives a short CMS
      // session instead of storing the raw admin token.
      if (safeTokenCompare(token, expectedAdminToken())) {
        const session = createSession({ auth: 'cms-token', login: 'admin' });
        return response(200, {
          ok: true,
          expires_at: new Date(session.payload.exp * 1000).toISOString(),
          user: { login: 'admin', provider: 'cms-token' }
        }, { 'Set-Cookie': cmsSessionCookie(session.token, session.maxAge) });
      }

      if (provider === 'github') {
        const githubUser = await validateGithubToken(token);
        const session = createSession({ auth: 'github', login: githubUser.login, name: githubUser.name });
        return response(200, {
          ok: true,
          expires_at: new Date(session.payload.exp * 1000).toISOString(),
          user: { ...githubUser, provider: 'github' }
        }, { 'Set-Cookie': cmsSessionCookie(session.token, session.maxAge) });
      }

      return response(400, { ok: false, message: 'Unsupported login provider.' });
    }

    if (root === 'image' && method === 'GET') {
      const key = decodeURIComponent([second, ...rest].filter(Boolean).join('/'));
      const image = await readImage(key);
      if (!image) return response(404, { ok: false, message: 'Image not found.' });
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'content-type': image.content_type || 'image/jpeg',
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff'
        },
        body: image.base64
      };
    }

    if (root === 'admin') {
      if (!isAdmin(event)) return response(401, { ok: false, message: 'Invalid admin token.' });

      if (second === 'data' && method === 'GET') {
        const data = await loadData();
        return response(200, { ok: true, data: { ...data, analytics_summary: analyticsSummary(data) } });
      }

      if (second === 'save' && method === 'POST') {
        const body = parseJson(event);
        const saved = await saveData(body.data || body);
        return response(200, { ok: true, data: saved, message: 'Saved successfully.' });
      }

      if (second === 'upload' && method === 'POST') {
        const body = parseJson(event);
        const payload = validateImageUpload(body);
        const date = new Date().toISOString().slice(0, 10);
        const key = `uploads/${date}/${crypto.randomUUID()}-${payload.filename}`;
        await saveImage(key, payload);
        const url = `${baseUrl(event)}/api/image/${encodeURIComponent(key)}`;
        return response(200, { ok: true, image: { key, url, filename: payload.filename, content_type: payload.contentType, size: payload.buffer.length } });
      }

      if (second === 'delete-image' && method === 'POST') {
        const body = parseJson(event);
        const key = imageKeyFromUrl(body.url || '');
        if (!key) return response(400, { ok: false, message: 'Only CMS-uploaded Netlify images can be deleted.' });
        await deleteImage(key);
        return response(200, { ok: true, message: 'Image deleted from CMS storage.' });
      }

      return response(404, { ok: false, message: 'Admin endpoint not found.' });
    }

    if (root === 'track' && method === 'POST') {
      const eventBody = parseJson(event);
      const current = await loadData();
      recordAnalyticsEvent(current, sanitizeAnalyticsEvent(eventBody));
      await saveData(current);
      return response(200, { ok: true });
    }

    const data = await loadData();
    const includeHidden = false;

    if (root === 'settings' && method === 'GET') return response(200, data.settings);

    if (root === 'banners' && method === 'GET') {
      return response(200, [{ title: data.settings.hero_title, text: data.settings.hero_text, image: data.settings.hero_image }]);
    }

    if (root === 'categories' && method === 'GET') {
      return response(200, visible(data.categories, includeHidden).map((category) => publicCategory(category, data, includeHidden)));
    }

    if ((root === 'products' || root === 'product') && method === 'GET') {
      const qs = event.queryStringParameters || {};
      let products = visible(data.products, includeHidden);
      const requestedSlug = second ? slugify(second) : '';
      if (requestedSlug) {
        const product = products.find((item) => item.slug === requestedSlug);
        if (!product) return response(404, { ok: false, message: 'Product not found.' });
        return response(200, publicProduct(product, data));
      }
      if (qs.category) products = products.filter((product) => hasCategory(product, qs.category));
      if (qs.featured) products = products.filter((product) => product.featured);
      if (qs.new) products = products.filter((product) => product.new_arrival);
      if (qs.q) {
        const query = text(qs.q, 120).toLowerCase();
        products = products.filter((product) => [product.title, product.excerpt, product.content, product.sku, product.fabric].some((value) => String(value || '').toLowerCase().includes(query)));
      }
      return response(200, products.map((product) => publicProduct(product, data)));
    }

    if (root === 'orders' && method === 'POST') {
      const body = parseJson(event);
      const current = await loadData();
      const order = sanitizeOrder(body, current);
      cleanContact(order.customer);
      if (!order.customer.name || !order.customer.address) return response(422, { ok: false, message: 'Name and delivery address are required.' });
      if (!order.customer.phone && !order.customer.email) return response(422, { ok: false, message: 'Enter at least one valid contact: a valid phone number or a valid email address.' });
      if (!order.items.length) return response(422, { ok: false, message: 'Cart is empty.' });
      current.orders = Array.isArray(current.orders) ? current.orders : [];
      current.orders.unshift(order);
      applyOrderSoldQuantities(current, order);
      recordAnalyticsEvent(current, {
        id: `evt_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
        created_at: new Date().toISOString(),
        event_type: 'order_submit',
        product_id: '',
        product_slug: order.items[0]?.product_slug || '',
        product_title: order.items[0]?.product_title || 'Cart order',
        page: '#cart',
        source: 'website-cart'
      });
      await saveData(current);
      return response(200, { ok: true, order: { id: order.id, created_at: order.created_at, total_quantity: order.total_quantity, subtotal: order.subtotal }, message: 'Purchase saved in CMS.' });
    }

    if (root === 'inquiries' && method === 'POST') {
      const body = parseJson(event);
      const inquiry = sanitizeInquiry(body);
      if (!inquiry.name || !inquiry.phone || !inquiry.message) return response(422, { ok: false, message: 'Name, phone, and message are required.' });
      const current = await loadData();
      current.inquiries = Array.isArray(current.inquiries) ? current.inquiries : [];
      current.inquiries.unshift(inquiry);
      if (inquiry.product_slug || inquiry.product_title) {
        recordAnalyticsEvent(current, {
          id: `evt_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
          created_at: new Date().toISOString(),
          event_type: 'inquiry_submit',
          product_id: '',
          product_slug: inquiry.product_slug,
          product_title: inquiry.product_title,
          page: '#inquiry',
          source: 'website-inquiry-form'
        });
      }
      await saveData(current);
      return response(200, { ok: true, inquiry: { id: inquiry.id, created_at: inquiry.created_at }, message: 'Inquiry saved in CMS.' });
    }

    if (root === 'blogs' && method === 'GET') {
      const blogs = visible(data.blogs, includeHidden);
      const requestedSlug = second ? slugify(second) : '';
      if (requestedSlug) {
        const blog = blogs.find((item) => slugify(item.slug || item.title || item.id) === requestedSlug);
        if (!blog) return response(404, { ok: false, message: 'Blog not found.' });
        return response(200, { ok: true, blog });
      }
      return response(200, blogs);
    }

    if (root === 'home' && method === 'GET') {
      const categories = visible(data.categories).map((category) => publicCategory(category, data));
      const products = visible(data.products).map((product) => publicProduct(product, data));
      return response(200, {
        ok: true,
        settings: data.settings,
        categories,
        featured: products.filter((product) => product.featured).slice(0, 8),
        new_arrivals: products.filter((product) => product.new_arrival).slice(0, 8),
        blogs: visible(data.blogs).slice(0, 6)
      });
    }

    return response(404, { ok: false, message: 'Endpoint not found.' });
  } catch (error) {
    return response(500, { ok: false, message: error.message || 'Service error.' });
  }
};
