(function () {
  var _selectedPlan = 'annual';
  var _stripeInstance = null;
  var _stripeCheckout = null;

  /* ── CSS ─────────────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = [
    '.pro-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:1rem}',
    '.pro-overlay.hidden{display:none}',
    '.pro-modal{background:#fff;border-radius:16px;max-width:560px;width:100%;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.18);max-height:90vh;display:flex;flex-direction:column;overflow:hidden}',
    '.pro-modal-header{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e0dfd8;background:#fff}',
    '.pro-modal-header-title{font-size:14px;font-weight:600;color:#1a1a18;display:flex;align-items:center;gap:8px}',
    '.pro-modal-close{background:none;border:none;cursor:pointer;color:#9b9b8f;padding:4px;line-height:1;border-radius:4px}',
    '.pro-modal-body{flex:1;overflow-y:auto;padding:1.5rem;-webkit-overflow-scrolling:touch}',
    '.pro-modal-footer{flex-shrink:0;padding:10px 20px 14px;border-top:1px solid #e0dfd8;background:#f8f7f4;display:flex;align-items:center;justify-content:center;gap:6px}',
    '.pro-title{font-size:22px;font-weight:700;color:#1a1a18;text-align:center;margin-bottom:4px}',
    '.pro-sub{font-size:14px;color:#6b6b62;text-align:center;margin-bottom:1.25rem}',
    '.pro-promo-wrap{border:1px solid #e0dfd8;border-radius:10px;overflow:hidden;margin-bottom:1.25rem}',
    '.pro-promo-head{background:#f0faf6;border-bottom:1px solid rgba(29,158,117,0.2);padding:10px 14px;display:flex;align-items:center;gap:8px}',
    '.pro-promo-label{font-size:11px;font-weight:700;letter-spacing:0.5px;color:#1d9e75;text-transform:uppercase}',
    '.pro-promo-body{padding:12px 14px;background:#fff;display:flex;gap:8px}',
    '.pro-promo-input{flex:1;border:1px solid #e0dfd8;border-radius:8px;padding:0 12px;height:38px;font-size:13px;font-family:inherit;text-transform:uppercase;letter-spacing:1px;outline:none}',
    '.pro-promo-input:focus{border-color:#C95E1A}',
    '.pro-promo-btn{background:#1d9e75;color:#fff;font-size:13px;font-weight:600;border:none;padding:0 18px;border-radius:8px;cursor:pointer;white-space:nowrap;font-family:inherit}',
    '.pro-promo-msg{font-size:12px;margin-top:7px;display:none;padding:0 14px 10px}',
    '.pro-plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.25rem}',
    '@media(max-width:480px){.pro-plans{grid-template-columns:1fr}}',
    '.pro-plan{border:2px solid #e0dfd8;border-radius:12px;padding:1.25rem;cursor:pointer;position:relative;background:#f8f7f4;transition:border-color 0.15s}',
    '.pro-plan:hover{border-color:#C95E1A}',
    '.pro-plan.selected{border-color:#C95E1A;background:#fdf3ec}',
    '.pro-plan-badge{position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#C95E1A;color:#fff;font-size:10px;font-weight:700;padding:2px 10px;border-radius:20px;white-space:nowrap}',
    '.pro-plan-name{font-size:12px;font-weight:600;color:#6b6b62;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}',
    '.pro-plan-price{font-size:28px;font-weight:800;color:#1a1a18;line-height:1}',
    '.pro-plan-price span{font-size:14px;font-weight:500;color:#6b6b62}',
    '.pro-plan-note{font-size:11px;color:#6b6b62;margin-top:4px}',
    '.pro-features{list-style:none;padding:0;margin:0 0 1.25rem;display:flex;flex-direction:column;gap:7px}',
    '.pro-features li{font-size:13px;color:#6b6b62;display:flex;align-items:center;gap:8px}',
    '.pro-features li::before{content:"✓";color:#C95E1A;font-weight:700;flex-shrink:0}',
    '.pro-start-btn{width:100%;padding:13px;background:#C95E1A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:8px}',
    '.pro-start-btn:hover{background:#a84e15}',
    '.pro-start-btn:disabled{opacity:0.6;cursor:default}',
    '.pro-fine{text-align:center;font-size:11px;color:#9b9b8f;margin-bottom:8px}',
    '.pro-restore{text-align:center;font-size:12px;color:#9b9b8f}',
    '.pro-restore a{color:#C95E1A;cursor:pointer;text-decoration:underline}',
    '.pro-back-btn{background:none;border:none;cursor:pointer;color:#6b6b62;font-size:13px;display:flex;align-items:center;gap:5px;font-family:inherit;padding:0}',
    '.pro-back-btn:hover{color:#1a1a18}',
    '.pro-checkout-loading{display:flex;align-items:center;justify-content:center;padding:60px 0;gap:12px;color:#6b6b62;font-size:14px}',
    '.pro-spin{animation:pro-spin-anim 1s linear infinite}',
    '@keyframes pro-spin-anim{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
    '.pro-upsell-wrap{margin-top:1rem}',
    '.pro-divider{display:flex;align-items:center;gap:10px;margin-bottom:0.75rem}',
    '.pro-divider-line{flex:1;height:1px;background:#e0dfd8}',
    '.pro-divider-text{font-size:11px;color:#9b9b8f;font-weight:500;white-space:nowrap}',
    '.pro-upsell-btn{width:100%;padding:11px;background:transparent;border:1.5px solid #C95E1A;border-radius:10px;font-size:13px;font-weight:600;color:#C95E1A;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;transition:all 0.15s}',
    '.pro-upsell-btn:hover{background:#C95E1A;color:#fff}',
  ].join('');
  document.head.appendChild(style);

  /* ── Modal HTML ───────────────────────────────────────────────────── */
  function buildModal() {
    var el = document.createElement('div');
    el.id = 'pro-overlay';
    el.className = 'pro-overlay hidden';
    el.setAttribute('onclick', 'if(event.target===this)window.closeProModal()');
    el.innerHTML = [
      '<div class="pro-modal">',
        /* Header — shared by both views */
        '<div class="pro-modal-header" id="pro-modal-header">',
          '<div class="pro-modal-header-title" id="pro-header-title">',
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C95E1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            'AutoNegotiating Pro',
          '</div>',
          '<button class="pro-modal-close" onclick="window.closeProModal()">',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          '</button>',
        '</div>',

        /* ── Plan view ── */
        '<div id="pro-plan-view" class="pro-modal-body">',
          '<div class="pro-title">AutoNegotiating Pro</div>',
          '<div class="pro-sub">Unlimited deal reports, trade intelligence, and offer submissions</div>',
          '<div class="pro-promo-wrap">',
            '<div class="pro-promo-head">',
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
              '<span class="pro-promo-label">Have a promo code?</span>',
            '</div>',
            '<div class="pro-promo-body">',
              '<input class="pro-promo-input" id="pro-promo-input" placeholder="ENTER PROMO CODE" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key===\'Enter\')window.applyProPromoCode()">',
              '<button class="pro-promo-btn" id="pro-promo-btn" onclick="window.applyProPromoCode()">Apply</button>',
            '</div>',
            '<div class="pro-promo-msg" id="pro-promo-msg"></div>',
          '</div>',
          '<div class="pro-plans">',
            '<div class="pro-plan" id="pro-plan-monthly" onclick="window.selectProPlan(\'monthly\')">',
              '<div class="pro-plan-name">Monthly</div>',
              '<div class="pro-plan-price">$20<span>/mo</span></div>',
              '<div class="pro-plan-note">Cancel anytime</div>',
            '</div>',
            '<div class="pro-plan selected" id="pro-plan-annual" onclick="window.selectProPlan(\'annual\')">',
              '<div class="pro-plan-badge">Best Value — Save $40</div>',
              '<div class="pro-plan-name">Annual</div>',
              '<div class="pro-plan-price">$200<span>/yr</span></div>',
              '<div class="pro-plan-note">~$16.67/mo · billed yearly</div>',
            '</div>',
          '</div>',
          '<ul class="pro-features">',
            '<li>Unlimited Deal Intelligence Reports</li>',
            '<li>Unlimited Trade Intelligence Reports</li>',
            '<li>Unlimited offer submissions to dealers</li>',
            '<li>Priority support</li>',
          '</ul>',
          '<button class="pro-start-btn" id="pro-start-btn" onclick="window.startProSubscription()">Start Free Trial — Annual $200/yr</button>',
          '<div class="pro-fine">30-day free trial · Card required · Cancel anytime</div>',
          '<div class="pro-restore">Already subscribed? <a onclick="window.promptProRestore()">Restore access</a></div>',
        '</div>',

        /* ── Checkout view (Stripe embedded) ── */
        '<div id="pro-checkout-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">',
          '<div style="flex:1;overflow-y:auto;padding:20px;min-height:200px;-webkit-overflow-scrolling:touch" id="pro-stripe-container">',
            '<div class="pro-checkout-loading" id="pro-stripe-loading">',
              '<svg class="pro-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C95E1A" stroke-width="2"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>',
              'Loading secure checkout...',
            '</div>',
          '</div>',
          '<div class="pro-modal-footer">',
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9b9b8f" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
            '<span style="font-size:11px;color:#9b9b8f">Secured by Stripe · 30-day free trial · Cancel anytime</span>',
          '</div>',
        '</div>',

      '</div>',
    ].join('');
    document.body.appendChild(el);
  }

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function showPlanView() {
    var pv = document.getElementById('pro-plan-view');
    var cv = document.getElementById('pro-checkout-view');
    var ht = document.getElementById('pro-header-title');
    if (pv) pv.style.display = '';
    if (cv) cv.style.display = 'none';
    if (ht) ht.innerHTML = [
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C95E1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
      'AutoNegotiating Pro',
    ].join('');
    if (_stripeCheckout) { _stripeCheckout.destroy(); _stripeCheckout = null; }
  }

  function showCheckoutView() {
    var pv = document.getElementById('pro-plan-view');
    var cv = document.getElementById('pro-checkout-view');
    var ht = document.getElementById('pro-header-title');
    if (pv) pv.style.display = 'none';
    if (cv) { cv.style.display = 'flex'; }
    if (ht) ht.innerHTML = [
      '<button class="pro-back-btn" onclick="window._proBackToPlan()">',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>',
        'Back',
      '</button>',
      '<span style="font-size:14px;font-weight:600;color:#1a1a18;margin-left:6px">Complete Subscription</span>',
    ].join('');
  }

  function proActivateSubscription(email) {
    window._proSubscriptionActive = true;
    if (email) {
      try { localStorage.setItem('subEmail', email); } catch (_) {}
      sessionStorage.setItem('subEmail', email);
    }
    if (typeof window.unlock === 'function') window.unlock();
    var pm = document.getElementById('paywall-modal');
    if (pm) { pm.classList.remove('visible'); setTimeout(function () { pm.style.display = 'none'; }, 200); }
    window.closeProModal();
  }

  /* ── Public API ───────────────────────────────────────────────────── */
  window.openProModal = function () {
    if (window._proSubscriptionActive) return;
    var el = document.getElementById('pro-overlay');
    if (el) el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    showPlanView();
  };

  window.closeProModal = function () {
    if (_stripeCheckout) { _stripeCheckout.destroy(); _stripeCheckout = null; }
    showPlanView();
    var el = document.getElementById('pro-overlay');
    if (el) el.classList.add('hidden');
    document.body.style.overflow = '';
  };

  window._proBackToPlan = function () {
    showPlanView();
  };

  window.selectProPlan = function (plan) {
    _selectedPlan = plan;
    var m = document.getElementById('pro-plan-monthly');
    var a = document.getElementById('pro-plan-annual');
    var btn = document.getElementById('pro-start-btn');
    if (m) m.classList.toggle('selected', plan === 'monthly');
    if (a) a.classList.toggle('selected', plan === 'annual');
    if (btn) btn.textContent = plan === 'annual' ? 'Start Free Trial — Annual $200/yr' : 'Start Free Trial — Monthly $20/mo';
  };

  window.startProSubscription = async function () {
    var btn = document.getElementById('pro-start-btn');
    var origText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<svg class="pro-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg> Opening checkout…';

    try {
      var configRes = await fetch('/api/stripe/config');
      var config = await configRes.json();
      if (!config.publishableKey || (!config.monthlyPriceId && !config.annualPriceId)) {
        throw new Error('Stripe not configured');
      }

      var priceId = _selectedPlan === 'annual' ? config.annualPriceId : config.monthlyPriceId;
      var returnUrl = window.location.origin + window.location.pathname + '?sub_success={CHECKOUT_SESSION_ID}';

      var sessionRes = await fetch('/api/stripe/embedded-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: priceId, returnUrl: returnUrl }),
      });
      var sessionData = await sessionRes.json();
      if (!sessionData.clientSecret) throw new Error(sessionData.error || 'Failed to create session');

      /* Switch to checkout view */
      showCheckoutView();

      /* Mount Stripe embedded checkout */
      _stripeInstance = _stripeInstance || Stripe(config.publishableKey);
      _stripeCheckout = await _stripeInstance.initEmbeddedCheckout({
        fetchClientSecret: function () { return Promise.resolve(sessionData.clientSecret); },
      });

      var container = document.getElementById('pro-stripe-container');
      var mountDiv = document.createElement('div');
      mountDiv.id = 'pro-stripe-mount';
      container.innerHTML = '';
      container.appendChild(mountDiv);
      _stripeCheckout.mount('#pro-stripe-mount');

    } catch (e) {
      btn.disabled = false;
      btn.textContent = origText;
      showPlanView();
      alert('Could not open checkout. Please try again.');
    }
  };

  window.applyProPromoCode = function () {
    var input = document.getElementById('pro-promo-input');
    var btn = document.getElementById('pro-promo-btn');
    var msg = document.getElementById('pro-promo-msg');
    var code = input ? input.value.trim() : '';
    if (!code) { if (msg) { msg.style.display = 'block'; msg.style.color = '#dc3545'; msg.textContent = 'Please enter a promo code.'; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    if (msg) msg.style.display = 'none';
    fetch('/api/promo/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
        if (msg) { msg.style.display = 'block'; }
        if (data.valid) {
          if (msg) { msg.style.color = '#1d9e75'; msg.textContent = '✓ Promo applied — Pro access unlocked!'; }
          setTimeout(function () { proActivateSubscription(null); }, 800);
        } else {
          if (msg) { msg.style.color = '#dc3545'; msg.textContent = data.message || 'Invalid promo code.'; }
        }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
        if (msg) { msg.style.display = 'block'; msg.style.color = '#dc3545'; msg.textContent = 'Could not validate code. Please try again.'; }
      });
  };

  window.promptProRestore = async function () {
    var email = window.prompt('Enter your subscription email to restore access:');
    if (!email) return;
    try {
      var data = await fetch('/api/stripe/subscription-status?email=' + encodeURIComponent(email)).then(function (r) { return r.json(); });
      if (data.active) {
        proActivateSubscription(email);
        alert('✓ Subscription active! Access restored.');
      } else {
        alert('No active subscription found for that email.');
      }
    } catch (e) { alert('Could not verify subscription. Please try again.'); }
  };

  /* ── On load ──────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    buildModal();

    /* Restore subscription — localStorage persists across sessions */
    var email = (function () { try { return localStorage.getItem('subEmail'); } catch (_) {} })() || sessionStorage.getItem('subEmail');
    if (email) {
      fetch('/api/stripe/subscription-status?email=' + encodeURIComponent(email))
        .then(function (r) { return r.json(); })
        .then(function (data) { if (data.active) proActivateSubscription(email); })
        .catch(function () {});
    }

    /* Handle ?sub_success= redirect back from Stripe (works on any page) */
    var urlParams = new URLSearchParams(window.location.search);
    var subSuccess = urlParams.get('sub_success');
    if (subSuccess) {
      history.replaceState({}, '', window.location.origin + window.location.pathname);
      fetch('/api/stripe/verify-session?session_id=' + encodeURIComponent(subSuccess))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.email) {
            proActivateSubscription(data.email);
          }
        })
        .catch(function () {});
    }
  });
})();
