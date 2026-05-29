(function () {
  var _selectedPlan = 'annual';

  /* ── CSS ─────────────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = [
    '.pro-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:1rem}',
    '.pro-overlay.hidden{display:none}',
    '.pro-modal{background:#fff;border-radius:16px;padding:2rem;max-width:560px;width:100%;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.18);max-height:90vh;overflow-y:auto}',
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
    '.pro-start-btn{width:100%;padding:13px;background:#C95E1A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:6px}',
    '.pro-start-btn:hover{background:#a84e15}',
    '.pro-start-btn:disabled{opacity:0.6;cursor:default}',
    '.pro-fine{text-align:center;font-size:11px;color:#9b9b8f;margin-bottom:8px}',
    '.pro-restore{text-align:center;font-size:12px;color:#9b9b8f}',
    '.pro-restore a{color:#C95E1A;cursor:pointer;text-decoration:underline}',
    '.pro-modal-close{position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,0.9);border:1px solid #e0dfd8;color:#9b9b8f;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}',
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
        '<button class="pro-modal-close" onclick="window.closeProModal()">×</button>',
        '<div class="pro-title">AutoNegotiating Pro</div>',
        '<div class="pro-sub">Unlimited offer submissions, deal reports, and trade intelligence — all in one plan</div>',
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
    ].join('');
    document.body.appendChild(el);
  }

  /* ── Functions ────────────────────────────────────────────────────── */
  function proActivateSubscription(email) {
    window._proSubscriptionActive = true;
    if (email) sessionStorage.setItem('subEmail', email);
    if (typeof window.unlock === 'function') window.unlock();
    var pm = document.getElementById('paywall-modal');
    if (pm) { pm.classList.remove('visible'); setTimeout(function () { pm.style.display = 'none'; }, 200); }
    window.closeProModal();
  }

  window.openProModal = function () {
    if (window._proSubscriptionActive) return;
    var el = document.getElementById('pro-overlay');
    if (el) el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  window.closeProModal = function () {
    var el = document.getElementById('pro-overlay');
    if (el) el.classList.add('hidden');
    document.body.style.overflow = '';
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
    var orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      var cfg = await fetch('/api/stripe/config').then(function (r) { return r.json(); });
      var priceId = _selectedPlan === 'annual' ? cfg.annualPriceId : cfg.monthlyPriceId;
      var baseUrl = window.location.origin;
      var successUrl = baseUrl + '/?sub_success={CHECKOUT_SESSION_ID}';
      var res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: priceId, successUrl: successUrl, cancelUrl: window.location.href }),
      }).then(function (r) { return r.json(); });
      if (res.url) window.location.href = res.url;
      else { btn.disabled = false; btn.textContent = orig; }
    } catch (e) { btn.disabled = false; btn.textContent = orig; }
  };

  window.applyProPromoCode = function () {
    var input = document.getElementById('pro-promo-input');
    var btn = document.getElementById('pro-promo-btn');
    var msg = document.getElementById('pro-promo-msg');
    var code = input.value.trim();
    if (!code) { msg.style.display = 'block'; msg.style.color = '#dc3545'; msg.textContent = 'Please enter a promo code.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    msg.style.display = 'none';
    fetch('/api/promo/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        btn.disabled = false; btn.textContent = 'Apply';
        if (data.valid) {
          msg.style.display = 'block'; msg.style.color = '#1d9e75';
          msg.textContent = '✓ Promo applied — Pro access unlocked!';
          setTimeout(function () { proActivateSubscription(null); }, 800);
        } else {
          msg.style.display = 'block'; msg.style.color = '#dc3545';
          msg.textContent = data.message || 'Invalid promo code.';
        }
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Apply';
        msg.style.display = 'block'; msg.style.color = '#dc3545';
        msg.textContent = 'Could not validate code. Please try again.';
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
    } catch { alert('Could not verify subscription. Please try again.'); }
  };

  /* ── On load: restore subscription ───────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    buildModal();
    var email = sessionStorage.getItem('subEmail');
    if (email) {
      fetch('/api/stripe/subscription-status?email=' + encodeURIComponent(email))
        .then(function (r) { return r.json(); })
        .then(function (data) { if (data.active) proActivateSubscription(email); })
        .catch(function () {});
    }
  });
})();
