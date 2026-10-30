/* ============================================================
   PROFESSIONAL BETTING TIPS — Core App Logic
   ============================================================ */

// ── Config ──────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  PAYSTACK_PUBLIC_KEY: 'YOUR_PAYSTACK_PUBLIC_KEY',
  PAYPAL_CLIENT_ID: 'YOUR_PAYPAL_CLIENT_ID',
  // Premium gating is OFF during the testing period (sole user). Set to true to bring back sign-in, locked tips and
  // checkout exactly as before (requires the Supabase + Paystack keys above to be filled in).
  PREMIUM_GATING: false,
  SITE_NAME: 'Professional Betting Tips',
  FACEBOOK_PAGE: 'https://facebook.com/ProffesionalBettingTips',
};

// ── Supabase Client ─────────────────────────────────────────
let sb = null;
if (CONFIG.PREMIUM_GATING) {
  const { createClient } = supabase;
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

// ── State ────────────────────────────────────────────────────
let currentUser = null;
let userProfile = null;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!CONFIG.PREMIUM_GATING) { await initOpenMode(); return; }
  await initAuth();
  initNavHighlight();
  initMobileNav();
  initPricingTabs();
  initCheckoutModal();
  initFilterChips();

  // Page-specific loaders
  const page = document.body.dataset.page;
  if (page === 'home')       loadHomePage();
  if (page === 'daily')      loadPredictionsPage('daily');
  if (page === 'weekend')    loadPredictionsPage('weekend');
  if (page === 'monthly')    loadPredictionsPage('monthly');
  if (page === 'highlights') loadHighlightsPage();
  if (page === 'account')    loadAccountPage();
});

// ── Auth ─────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await fetchUserProfile();
  }
  updateNavAuth();

  sb.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    if (currentUser) await fetchUserProfile();
    else userProfile = null;
    updateNavAuth();
  });
}

async function fetchUserProfile() {
  if (!currentUser) return;
  const { data } = await sb
    .from('user_profiles')
    .select('*, subscriptions(*)')
    .eq('id', currentUser.id)
    .single();
  userProfile = data;
}

function updateNavAuth() {
  const loginBtn  = document.getElementById('nav-login-btn');
  const userMenu  = document.getElementById('nav-user-menu');
  const userName  = document.getElementById('nav-user-name');

  if (currentUser) {
    loginBtn?.classList.add('hidden');
    if (userMenu) userMenu.classList.remove('hidden');
    if (userName) userName.textContent = currentUser.email?.split('@')[0] || 'User';
  } else {
    loginBtn?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
  }
}

async function signUp(email, password, name) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  if (error) throw error;

  // Create profile
  if (data.user) {
    await sb.from('user_profiles').insert({
      id: data.user.id,
      email,
      full_name: name,
    });
  }
  return data;
}

async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = '/';
}

// ── Login / Signup Modal ─────────────────────────────────────
function openAuthModal(mode = 'login') {
  if (!CONFIG.PREMIUM_GATING) return;
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.add('open');
  setAuthMode(mode);
}

function closeAuthModal() {
  document.getElementById('auth-modal')?.classList.remove('open');
}

function setAuthMode(mode) {
  document.getElementById('auth-mode')?.setAttribute('data-mode', mode);
  const title = document.getElementById('auth-title');
  const sub   = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('auth-name-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  const switchLink = document.getElementById('auth-switch-link');

  if (mode === 'login') {
    if (title) title.textContent = 'Welcome Back';
    if (sub)   sub.textContent   = 'Sign in to access your premium tips';
    if (nameGroup) nameGroup.classList.add('hidden');
    if (submitBtn) submitBtn.textContent = 'Sign In';
    if (switchLink) switchLink.innerHTML = "Don't have an account? <a href='#' onclick='setAuthMode(\"signup\")'>Create one</a>";
  } else {
    if (title) title.textContent = 'Get Started';
    if (sub)   sub.textContent   = 'Create your account to unlock premium tips';
    if (nameGroup) nameGroup.classList.remove('hidden');
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (switchLink) switchLink.innerHTML = "Already have an account? <a href='#' onclick='setAuthMode(\"login\")'>Sign in</a>";
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode  = document.getElementById('auth-mode')?.dataset.mode;
    const email = document.getElementById('auth-email')?.value;
    const pass  = document.getElementById('auth-password')?.value;
    const name  = document.getElementById('auth-name')?.value;
    const btn   = document.getElementById('auth-submit-btn');

    btn.textContent = '...';
    btn.disabled = true;

    try {
      if (mode === 'login') {
        await signIn(email, pass);
        showToast('✅ Signed in successfully!', 'success');
      } else {
        await signUp(email, pass, name);
        showToast('✅ Account created! Check your email.', 'success');
      }
      closeAuthModal();
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    } finally {
      btn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
      btn.disabled = false;
    }
  });
});

// ── Predictions Loader ───────────────────────────────────────
async function loadPredictionsPage(category) {
  const grid = document.getElementById('predictions-grid');
  if (!grid) return;

  grid.innerHTML = '<p class="text-muted" style="padding:20px;">Loading tips...</p>';

  const today = new Date().toISOString().split('T')[0];
  let query = sb.from('predictions').select('*').order('kick_off_time', { ascending: true });

  if (category === 'daily')   query = query.eq('category', 'daily').eq('match_date', today);
  if (category === 'weekend') query = query.eq('category', 'weekend');
  if (category === 'monthly') query = query.eq('category', 'monthly');

  const { data, error } = await query;

  if (error || !data?.length) {
    grid.innerHTML = '<p class="text-muted" style="padding:20px;">No tips posted yet for today. Check back soon!</p>';
    return;
  }

  const isSubscribed = await checkSubscription(category);
  let html = '';

  data.forEach((tip, i) => {
    const locked = tip.is_premium && !isSubscribed;
    html += buildTipCard(tip, locked);
  });

  grid.innerHTML = html;
}

function buildTipCard(tip, locked) {
  const lockHTML = locked ? `
    <div class="lock-overlay">
      <div class="lock-icon">🔒</div>
      <div class="lock-text">Premium Tip</div>
      <button class="btn btn-gold btn-sm" onclick="openCheckoutModal('${tip.category}')">Unlock Tips</button>
    </div>` : '';

  return `
  <div class="tip-card ${locked ? 'premium-locked' : ''}">
    <div class="tip-card-header">
      <span class="league-tag">${tip.league || 'Football'}</span>
      <span class="tip-time">${tip.kick_off_time || '--:--'}</span>
    </div>
    <div class="tip-body">
      <div class="tip-teams">
        <span class="home">${tip.home_team}</span>
        <span class="vs-small">VS</span>
        <span class="away">${tip.away_team}</span>
      </div>
      <div class="tip-meta">
        <div class="tip-meta-item">
          <div class="key">Prediction</div>
          <div class="val green">${locked ? '?????' : tip.prediction}</div>
        </div>
        <div class="tip-meta-item">
          <div class="key">Odds</div>
          <div class="val gold">${locked ? '?.??' : tip.odds}</div>
        </div>
        <div class="tip-meta-item">
          <div class="key">Confidence</div>
          <div class="val">${locked ? '??%' : (tip.confidence || '85%')}</div>
        </div>
        <div class="tip-meta-item">
          <div class="key">Result</div>
          <div class="val ${tip.result === 'WIN' ? 'green' : tip.result === 'LOSS' ? '' : 'text-dim'}">${tip.result || 'Pending'}</div>
        </div>
      </div>
    </div>
    ${lockHTML}
  </div>`;
}

async function loadHomePage() {
  await loadFeaturedMatch();
  await loadFreeTips();
}

async function loadFeaturedMatch() {
  const { data } = await sb.from('predictions')
    .select('*')
    .eq('is_featured', true)
    .eq('match_date', new Date().toISOString().split('T')[0])
    .limit(1)
    .single();

  if (!data) return;

  const el = document.getElementById('featured-home');
  if (!el) return;

  el.querySelector('.featured-home-name')?.textContent && (el.querySelector('.featured-home-name').textContent = data.home_team);
  el.querySelector('.featured-away-name')?.textContent && (el.querySelector('.featured-away-name').textContent = data.away_team);
  el.querySelector('.featured-pred-val')?.textContent  && (el.querySelector('.featured-pred-val').textContent  = data.prediction);
  el.querySelector('.featured-odds-val')?.textContent  && (el.querySelector('.featured-odds-val').textContent  = data.odds);
  el.querySelector('.featured-league')?.textContent    && (el.querySelector('.featured-league').textContent    = data.league || 'Premier League');
  el.querySelector('.featured-time')?.textContent      && (el.querySelector('.featured-time').textContent      = data.kick_off_time || '20:00');
}

async function loadFreeTips() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('predictions')
    .select('*')
    .eq('is_premium', false)
    .eq('match_date', today)
    .limit(3);

  if (!data?.length) return;

  const grid = document.getElementById('free-tips-grid');
  if (!grid) return;
  grid.innerHTML = data.map(tip => buildTipCard(tip, false)).join('');
}

// ── Subscription Check ────────────────────────────────────────
async function checkSubscription(category) {
  if (!currentUser) return false;
  const { data } = await sb.from('subscriptions')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('category', category)
    .eq('status', 'active')
    .gte('expires_at', new Date().toISOString())
    .limit(1);

  return data?.length > 0;
}

// ── Checkout Modal ────────────────────────────────────────────
const PLANS = {
  starter:  { name: 'Starter',  odds: 4,  price: 99  },
  standard: { name: 'Standard', odds: 8,  price: 149 },
  premium:  { name: 'Premium',  odds: 10, price: 199 },
};

let selectedPlan = 'standard';
let selectedCategory = 'daily';
let selectedPayment = 'paystack';

function openCheckoutModal(category = 'daily', plan = 'standard') {
  if (!CONFIG.PREMIUM_GATING) return;
  if (!currentUser) {
    openAuthModal('login');
    return;
  }
  selectedCategory = category;
  selectedPlan = plan;
  renderCheckout();
  document.getElementById('checkout-modal')?.classList.add('open');
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal')?.classList.remove('open');
}

function selectPayment(method) {
  selectedPayment = method;
  document.querySelectorAll('.payment-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.method === method);
  });
}

function selectCheckoutPlan(plan) {
  selectedPlan = plan;
  renderCheckoutSummary();
  document.querySelectorAll('.checkout-plan-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.plan === plan);
  });
}

function renderCheckout() {
  renderCheckoutSummary();
  const catEl = document.getElementById('checkout-category');
  if (catEl) catEl.textContent = selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1) + ' Odds';
}

function renderCheckoutSummary() {
  const p = PLANS[selectedPlan];
  if (!p) return;
  const nameEl   = document.getElementById('checkout-plan-name');
  const oddsEl   = document.getElementById('checkout-plan-odds');
  const priceEl  = document.getElementById('checkout-plan-price');
  if (nameEl)  nameEl.textContent  = p.name + ' Plan';
  if (oddsEl)  oddsEl.textContent  = p.odds + ' Odds';
  if (priceEl) priceEl.textContent = 'KES ' + p.price;
}

async function processPayment() {
  const p = PLANS[selectedPlan];
  const btn = document.getElementById('pay-btn');
  btn.textContent = 'Processing...';
  btn.disabled = true;

  if (selectedPayment === 'paystack') {
    const handler = PaystackPop.setup({
      key: CONFIG.PAYSTACK_PUBLIC_KEY,
      email: currentUser.email,
      amount: p.price * 100, // kobo
      currency: 'KES',
      ref: 'PBT-' + Date.now(),
      metadata: {
        plan: selectedPlan,
        category: selectedCategory,
        user_id: currentUser.id,
      },
      callback: async (response) => {
        await recordPurchase(response.reference, p);
        closeCheckoutModal();
        showToast('✅ Payment successful! Your tips are unlocked.', 'success');
        setTimeout(() => location.reload(), 1500);
      },
      onClose: () => {
        btn.textContent = 'Pay Now';
        btn.disabled = false;
        showToast('Payment cancelled.', 'error');
      },
    });
    handler.openIframe();
  } else {
    // PayPal flow is handled in paypal-button container
    showToast('Please use the PayPal button to complete payment.', 'error');
    btn.textContent = 'Pay Now';
    btn.disabled = false;
  }
}

async function recordPurchase(reference, plan) {
  const expiresAt = new Date();
  if (selectedCategory === 'daily')   expiresAt.setDate(expiresAt.getDate() + 1);
  if (selectedCategory === 'weekend') expiresAt.setDate(expiresAt.getDate() + 3);
  if (selectedCategory === 'monthly') expiresAt.setMonth(expiresAt.getMonth() + 1);

  await sb.from('subscriptions').insert({
    user_id: currentUser.id,
    category: selectedCategory,
    plan: selectedPlan,
    odds_count: PLANS[selectedPlan].odds,
    price_paid: PLANS[selectedPlan].price,
    currency: 'KES',
    payment_ref: reference,
    payment_method: selectedPayment,
    status: 'active',
    expires_at: expiresAt.toISOString(),
  });
}

// ── Pricing Tabs (Home Page) ──────────────────────────────────
function initPricingTabs() {
  const tabs = document.querySelectorAll('.pricing-tab');
  const panes = document.querySelectorAll('.pricing-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('pane-' + tab.dataset.tab)?.classList.remove('hidden');
    });
  });
}

// ── Filter Chips ──────────────────────────────────────────────
function initFilterChips() {
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.dataset.filter;
      filterPredictions(filter);
    });
  });
}

function filterPredictions(filter) {
  const cards = document.querySelectorAll('.tip-card');
  cards.forEach(card => {
    const league = card.querySelector('.league-tag')?.textContent?.toLowerCase() || '';
    card.style.display = (filter === 'all' || league.includes(filter)) ? '' : 'none';
  });
}

// ── Highlights ────────────────────────────────────────────────
async function loadHighlightsPage() {
  const grid = document.getElementById('highlights-grid');
  if (!grid) return;

  const { data } = await sb.from('highlights')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(12);

  if (!data?.length) {
    grid.innerHTML = '<p class="text-muted">No highlights posted yet.</p>';
    return;
  }

  grid.innerHTML = data.map(h => `
    <div class="highlight-card">
      <div class="highlight-thumb">
        <div class="highlight-thumb-inner">
          <div class="highlight-score">${h.score || '? - ?'}</div>
          <div class="highlight-teams-label">${h.home_team} vs ${h.away_team}</div>
        </div>
        <a href="${h.video_url || '#'}" target="_blank" class="play-btn">▶</a>
      </div>
      <div class="highlight-body">
        <div class="highlight-league">${h.league || 'Football'}</div>
        <div class="highlight-title">${h.title}</div>
        <div class="highlight-meta">
          <span>${h.match_date || ''}</span>
          <span>${h.duration || ''}</span>
        </div>
      </div>
    </div>`).join('');
}

// ── Account Page ──────────────────────────────────────────────
async function loadAccountPage() {
  if (!currentUser) {
    window.location.href = '/?login=1';
    return;
  }

  const { data: subs } = await sb.from('subscriptions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  const nameEl  = document.getElementById('account-name');
  const emailEl = document.getElementById('account-email');
  const initEl  = document.getElementById('account-initials');

  if (nameEl)  nameEl.textContent  = userProfile?.full_name || 'User';
  if (emailEl) emailEl.textContent = currentUser.email;
  if (initEl)  initEl.textContent  = (userProfile?.full_name || currentUser.email)[0].toUpperCase();

  const subsList = document.getElementById('subscriptions-list');
  if (!subsList) return;

  if (!subs?.length) {
    subsList.innerHTML = '<p class="text-muted">No subscriptions yet. Purchase a plan to get started!</p>';
    return;
  }

  subsList.innerHTML = subs.map(sub => {
    const exp = new Date(sub.expires_at);
    const active = sub.status === 'active' && exp > new Date();
    return `
    <div class="tip-card" style="margin-bottom:12px;">
      <div class="tip-card-header">
        <span class="league-tag">${sub.category} odds</span>
        <span class="subscription-badge">${active ? '✅ Active' : '❌ Expired'}</span>
      </div>
      <div class="tip-body">
        <div class="tip-meta">
          <div class="tip-meta-item">
            <div class="key">Plan</div>
            <div class="val">${sub.plan} (${sub.odds_count} odds)</div>
          </div>
          <div class="tip-meta-item">
            <div class="key">Paid</div>
            <div class="val gold">KES ${sub.price_paid}</div>
          </div>
          <div class="tip-meta-item">
            <div class="key">Expires</div>
            <div class="val">${exp.toLocaleDateString()}</div>
          </div>
          <div class="tip-meta-item">
            <div class="key">Via</div>
            <div class="val">${sub.payment_method}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Navigation ────────────────────────────────────────────────
function initNavHighlight() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') === path) link.classList.add('active');
  });
}

function initMobileNav() {
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobile-nav');

  hamburger?.addEventListener('click', () => {
    mobileNav?.classList.toggle('open');
  });
}

// ── Checkout Modal Init ───────────────────────────────────────
function initCheckoutModal() {
  const overlay = document.getElementById('checkout-modal');
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeCheckoutModal();
  });

  const authOverlay = document.getElementById('auth-modal');
  authOverlay?.addEventListener('click', (e) => {
    if (e.target === authOverlay) closeAuthModal();
  });

  document.getElementById('pay-btn')?.addEventListener('click', processPayment);
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Ticker Data ───────────────────────────────────────────────
async function loadTicker() {
  const { data } = await sb.from('predictions')
    .select('home_team, away_team, odds, kick_off_time')
    .eq('match_date', new Date().toISOString().split('T')[0])
    .limit(10);

  if (!data?.length) return;

  const track = document.getElementById('ticker-content');
  if (!track) return;

  const items = [...data, ...data].map(tip => `
    <span class="ticker-item">
      ${tip.home_team} <span class="vs">vs</span> ${tip.away_team}
      &nbsp;|&nbsp; <span class="odds">${tip.odds}</span>
      &nbsp;·&nbsp; ${tip.kick_off_time || ''}
    </span>`).join('');

  track.innerHTML = items;
}

if (CONFIG.PREMIUM_GATING) document.addEventListener('DOMContentLoaded', loadTicker);

// ── URL Params (auto-open login modal) ────────────────────────
window.addEventListener('load', () => {
  if (!CONFIG.PREMIUM_GATING) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('login')) openAuthModal('login');
  if (params.get('signup')) openAuthModal('signup');
});


// ════════════════════════════════════════════════════════════
// OPEN MODE (PREMIUM_GATING = false): everything visible, no sign-in, no checkout.
// Tips come from the Prediction Lab data files (data/recent.json) instead of Supabase.
// ════════════════════════════════════════════════════════════
const LAB_COMP = { PL: 'Premier League', ELC: 'Championship', BL1: 'Bundesliga', SA: 'Serie A', PD: 'La Liga', FL1: 'Ligue 1', DED: 'Eredivisie', PPL: 'Primeira Liga', CL: 'Champions League', BSA: 'Brasileirão',
  E0: 'Premier League', E1: 'Championship', E2: 'League One', E3: 'League Two', EC: 'National League', SC0: 'Scottish Premiership', D1: 'Bundesliga', D2: '2. Bundesliga', I1: 'Serie A', I2: 'Serie B', SP1: 'La Liga', SP2: 'La Liga 2', F1: 'Ligue 1', F2: 'Ligue 2', N1: 'Eredivisie', B1: 'Belgian Pro League', P1: 'Primeira Liga', T1: 'Süper Lig', G1: 'Super League Greece', X: 'Football' };
const LAB_PICK = { H: 'Home Win', D: 'Draw', A: 'Away Win' };
const labEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eatTime = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' });
const eatDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

async function loadLabTips() {
  try { const r = await fetch('data/recent.json?t=' + Date.now()); if (!r.ok) return []; return (await r.json()).filter((p) => p.status === 'pending' && new Date(p.kickoff) > Date.now()); }
  catch { return []; }
}

function buildLabCard(p) {
  const pk = p.pk, conf = Math.round(pk.x12p * 100);
  const ou = pk.ou === 'O' ? 'Over 2.5' : 'Under 2.5';
  return `
  <div class="tip-card">
    <div class="tip-card-header">
      <span class="league-tag">${labEsc(LAB_COMP[p.comp] || p.comp)}</span>
      <span class="tip-time">${eatTime(p.kickoff)}</span>
    </div>
    <div class="tip-body">
      <div class="tip-teams"><span class="home">${labEsc(p.home)}</span><span class="vs-small">VS</span><span class="away">${labEsc(p.away)}</span></div>
      <div class="tip-meta">
        <div class="tip-meta-item"><div class="key">Prediction</div><div class="val green">${LAB_PICK[pk.x12]}</div></div>
        <div class="tip-meta-item"><div class="key">Confidence</div><div class="val">${conf}%</div></div>
        <div class="tip-meta-item"><div class="key">Goals</div><div class="val gold">${ou}</div></div>
        <div class="tip-meta-item"><div class="key">Safer</div><div class="val">${pk.dc}</div></div>
      </div>
    </div>
  </div>`;
}

async function initOpenMode() {
  document.body.classList.add('ungated');
  initNavHighlight(); initMobileNav(); initFilterChips();
  // hide everything that is about accounts, payment or locked content
  const hide = (el) => el && el.classList.add('gate-hidden');
  document.querySelectorAll('[onclick*="openCheckoutModal"], [onclick*="openAuthModal"], a[href="/pricing.html"], a[href="/account.html"], #nav-login-btn, #nav-user-menu, #auth-modal, #checkout-modal, .premium-locked, .lock-overlay').forEach(hide);
  document.querySelectorAll('.fb-cta-section').forEach((el) => { if (el.querySelector('[onclick*="openCheckoutModal"]')) hide(el); });
  document.querySelectorAll('section').forEach((sec) => { if (sec.querySelector('#pane-daily')) hide(sec); });
  document.querySelectorAll('.section-head').forEach((h) => { if (/premium/i.test(h.textContent)) { hide(h); const g = h.nextElementSibling; if (g && g.id === 'predictions-grid') hide(g); } });
  // add a link to the Prediction Lab in the navigation
  document.querySelectorAll('.nav-links, #mobile-nav').forEach((nav) => { if (!nav.querySelector('a[href="/lab.html"]')) { const a = document.createElement('a'); a.href = '/lab.html'; a.textContent = '🧪 Prediction Lab'; nav.appendChild(a); } });

  const sub = document.querySelector('.page-title p'); if (sub && ['daily', 'home'].includes(document.body.dataset.page)) sub.textContent = 'Model-driven predictions for upcoming matches, updated every few hours. Every prediction is graded against the real result in the Prediction Lab.';
  // footer columns whose links are all hidden (Account) disappear too
  document.querySelectorAll('.footer-links').forEach((fl) => { if ([...fl.children].every((a) => a.classList.contains('gate-hidden'))) hide(fl.parentElement); });
  const page = document.body.dataset.page;
  const tips = await loadLabTips();
  const tk = document.getElementById('ticker-content');
  if (tk && tips.length) { const items = tips.slice(0, 10); tk.innerHTML = [...items, ...items].map((t) => `<span class="ticker-item">${labEsc(t.home)} <span class="vs">vs</span> ${labEsc(t.away)} &nbsp;|&nbsp; <span class="odds">${LAB_PICK[t.pk.x12]}</span> &nbsp;·&nbsp; ${eatTime(t.kickoff)}</span>`).join(''); }
  else if (tk) tk.innerHTML = '<span class="ticker-item">Predictions appear here after the next agent run</span>';
  if (['weekend', 'monthly', 'highlights'].includes(page)) { await renderListingPage(page); return; }
  const grid = document.getElementById('free-tips-grid');
  if (page === 'daily' && grid) {
    const days = [...new Set(tips.map((t) => eatDay(t.kickoff)))].sort();
    const today = eatDay(new Date().toISOString());
    const shown = days.includes(today) ? today : days[0];
    const list = tips.filter((t) => eatDay(t.kickoff) === shown).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    const head = grid.previousElementSibling?.querySelector('h2'); if (head) head.textContent = shown === today ? "Today's Predictions" : 'Next Fixtures';
    grid.innerHTML = list.length ? list.map(buildLabCard).join('') : '<p class="text-muted" style="padding:20px;">No predictions yet. They appear after the agent\'s next run.</p>';
  }
  if (page === 'home') {
    const top = [...tips].sort((a, b) => b.pk.x12p - a.pk.x12p);
    if (grid && top.length) grid.innerHTML = top.slice(0, 3).map(buildLabCard).join('');
    const f = top[0], el = document.getElementById('featured-home');
    if (f && el) {
      const set = (sel, v) => { const n = el.querySelector(sel); if (n) n.textContent = v; };
      set('.featured-home-name', f.home); set('.featured-away-name', f.away);
      set('#featured-league', '⭐ ' + (LAB_COMP[f.comp] || 'Feature') + ' · ' + eatTime(f.kickoff));
      const odds = f.ctx?.odds || [1 / f.p.h, 1 / f.p.d, 1 / f.p.a];
      el.querySelectorAll('.odd-chip .value').forEach((n, i) => { if (odds[i]) n.textContent = (+odds[i]).toFixed(2); });
      const ix = { H: 0, D: 1, A: 2 }[f.pk.x12];
      const ini = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
      set('#featured-home-init', ini(f.home)); set('#featured-away-init', ini(f.away));
      set('.featured-pred-val', LAB_PICK[f.pk.x12]);
      if (odds[ix]) set('.featured-odds-val', (+odds[ix]).toFixed(2));
      set('.featured-time', '⏰ ' + eatTime(f.kickoff) + ' EAT');
      set('.featured-meta', LAB_COMP[f.comp] || '');
      el.querySelectorAll('.odd-chip').forEach((c, i) => c.classList.toggle('active', i === ix));
    }
  }
}

// ── Weekend / Monthly / Highlights pages (open mode) ──────────
const labJson = async (f, fb) => { try { const r = await fetch('data/' + f + '?t=' + Date.now()); return r.ok ? await r.json() : fb; } catch { return fb; } };
const eatLong = (iso) => new Date(iso).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' });
const pctTxt = (x) => (x == null ? '–' : Math.round(x * 100) + '%');

function groupByDay(list, card) {
  let out = '', cur = '';
  for (const p of list) {
    const d = eatDay(p.kickoff);
    if (d !== cur) { cur = d; out += `<h3 style="margin:26px 0 12px;font-family:var(--font-head);letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);">${labEsc(eatLong(p.kickoff))}</h3><div class="tips-grid">`; }
    out += card(p);
    const next = list[list.indexOf(p) + 1];
    if (!next || eatDay(next.kickoff) !== cur) out += '</div>';
  }
  return out;
}
function buildResultCard(p) {
  const ok = p.ok?.x12, pk = p.pk;
  return `
  <div class="tip-card">
    <div class="tip-card-header"><span class="league-tag">${labEsc(LAB_COMP[p.comp] || p.comp)}</span><span class="tip-time">${eatDay(p.kickoff).slice(5)}</span></div>
    <div class="tip-body">
      <div class="tip-teams"><span class="home">${labEsc(p.home)}</span><span class="vs-small">${p.result.hg}–${p.result.ag}</span><span class="away">${labEsc(p.away)}</span></div>
      <div class="tip-meta">
        <div class="tip-meta-item"><div class="key">Prediction</div><div class="val green">${LAB_PICK[pk.x12]}</div></div>
        <div class="tip-meta-item"><div class="key">Confidence</div><div class="val">${Math.round(pk.x12p * 100)}%</div></div>
        <div class="tip-meta-item"><div class="key">Safer</div><div class="val">${pk.dc} ${p.ok?.dc ? '✓' : '✗'}</div></div>
        <div class="tip-meta-item"><div class="key">Result</div><div class="val ${ok ? 'green' : ''}">${ok ? '✓ WIN' : '✗ LOSS'}</div></div>
      </div>
    </div>
  </div>`;
}
const kpi = (l, v, sub = '') => `<div class="tip-card" style="padding:14px 16px;"><div class="key" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2)">${l}</div><div class="val gold" style="font-size:28px;font-family:var(--font-head);font-weight:800">${v}</div><div style="font-size:12px;color:var(--text-3)">${sub}</div></div>`;

async function renderListingPage(page) {
  const box = document.getElementById('page-content'); if (!box) return;
  const all = await labJson('recent.json', []);
  const upcoming = all.filter((p) => p.status === 'pending' && new Date(p.kickoff) > Date.now()).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const settled = all.filter((p) => p.status === 'settled').sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const stats = await labJson('stats.json', null);
  const empty = (msg) => `<div class="tip-card" style="padding:24px;text-align:center;color:var(--text-2)">${msg}</div>`;

  if (page === 'weekend') {
    const e = new Date(Date.now() + 3 * 3600000), dow = e.getUTCDay();            // EAT = UTC+3
    const sinceFri = dow >= 5 ? dow - 5 : dow + 2;
    const fri = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate() - sinceFri, 15, 0));   // Fri 18:00 EAT
    const inWeekendNow = dow === 6 || dow === 0 || (dow === 1 && e.getUTCHours() < 6) || (dow === 5 && e.getUTCHours() >= 18);
    const startAt = inWeekendNow || dow === 5 ? fri : new Date(fri.getTime() + 7 * 86400000);
    const end = new Date(startAt.getTime() + 60 * 3600000);                              // to Mon 06:00 EAT
    const list = upcoming.filter((p) => { const t = new Date(p.kickoff); return t >= startAt && t < end; });
    box.innerHTML = list.length ? groupByDay(list, buildLabCard)
      : empty(upcoming.length ? `Weekend fixtures are not published yet. The next predictions are for ${labEsc(eatLong(upcoming[0].kickoff))}. Check <a href="/daily.html" style="color:var(--gold)">Daily Odds</a>.` : 'No predictions yet. They appear after the agent\'s next run.');
  }

  if (page === 'monthly') {
    const g = stats?.settled ? `<div class="tips-grid" style="margin-bottom:8px">${kpi('Graded predictions', stats.settled, stats.pending + ' pending')}${kpi('1X2 accuracy', pctTxt(stats.markets.x12.acc), stats.markets.x12.correct + ' of ' + stats.markets.x12.n)}${kpi('Double chance', pctTxt(stats.markets.dc.acc), 'safer pick')}${kpi('Over/Under 2.5', pctTxt(stats.markets.ou.acc), '')}</div><p class="text-muted" style="font-size:13px;margin-bottom:8px;">Track record since testing began. Small samples are noisy; see the <a href="/lab.html#accuracy" style="color:var(--gold)">Prediction Lab</a> for calibration and detail.</p>` : empty('The track record appears here once the first predictions have been graded.');
    box.innerHTML = g + (upcoming.length ? '<h2 style="margin:30px 0 4px;">Upcoming predictions</h2>' + groupByDay(upcoming, buildLabCard) : empty('No upcoming predictions yet.'));
  }

  if (page === 'highlights') {
    const best = settled.filter((p) => p.ok?.x12).sort((a, b) => b.pk.x12p - a.pk.x12p).slice(0, 6);
    const jp = (await labJson('jackpots.json', [])).filter((j) => j.games.some((x) => x.result));
    let out = '';
    if (best.length) out += `<h2 style="margin:0 0 12px;">Best calls</h2><div class="tips-grid">${best.map(buildResultCard).join('')}</div>`;
    if (jp.length) out += '<h2 style="margin:30px 0 12px;">Jackpot results</h2><div class="tips-grid">' + jp.map((j) => { const d = j.games.filter((x) => x.result); return kpi(labEsc(j.name), d.filter((x) => x.ok.x12).length + ' / ' + d.length, 'straight picks right (' + d.filter((x) => x.ok.dc).length + ' with double chance)'); }).join('') + '</div>';
    if (settled.length) out += `<h2 style="margin:30px 0 12px;">Recent results</h2><div class="tips-grid">${settled.slice(0, 30).map(buildResultCard).join('')}</div>`;
    box.innerHTML = out || empty('Results appear here once matches have finished and been graded.');
  }
}
