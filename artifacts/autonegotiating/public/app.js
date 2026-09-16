und for that email. Please subscribe or contact support.');
  }
}

function applySubPromoCode() {
  const input = document.getElementById('sub-promo-input');
  const btn   = document.getElementById('sub-promo-btn');
  const msgEl = document.getElementById('sub-promo-msg');
  const code  = input.value.trim();
  if (!code) {
    msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Please enter a promo code.'; return;
  }
  btn.disabled = true; btn.textContent = 'Checking…';
  msgEl.style.display = 'none';
  fetch('/api/promo/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  .then(r => r.json())
  .then(data => {
    btn.disabled = false; btn.textContent = 'Apply';
    if (data.valid) {
      msgEl.style.display = 'block'; msgEl.style.color = 'var(--success)';
      msgEl.textContent = '✓ Promo applied — Pro access unlocked!';
      setTimeout(() => {
        closeSubscribeModal();
        activateSubscription(null);
      }, 800);
    } else {
      msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)';
      msgEl.textContent = data.message || 'Invalid promo code.';
    }
  })
  .catch(() => {
    btn.disabled = false; btn.textContent = 'Apply';
    msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Could not validate code. Please try again.';
  });
}

function showOfferVerifyStep(carId) {
  _pendingOfferCarId = carId;
  const profile = getBuyerProfile();
  const nameEl  = document.getElementById('buyer-name');
  const emailEl = document.getElementById('buyer-email');
  const phoneEl = document.getElementById('buyer-phone');
  const errEl   = document.getElementById('verify-error');
  if (nameEl)  nameEl.value  = profile?.name  || '';
  if (emailEl) emailEl.value = profile?.email || '';
  if (phoneEl) phoneEl.value = profile?.phone || '';
  if (errEl)   errEl.style.display = 'none';
  document.getElementById('verify-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function applyOfferPromoCode() {
  const input = document.getElementById('offer-promo-input');
  const btn   = document.getElementById('offer-promo-btn');
  const msgEl = document.getElementById('offer-promo-msg');
  const code  = input.value.trim();
  if (!code) { msgEl.style.display='block'; msgEl.style.color='var(--danger)'; msgEl.textContent='Please enter a promo code.'; return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  msgEl.style.display = 'none';
  fetch('/api/promo/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  .then(r => r.json())
  .then(data => {
    btn.disabled = false; btn.textContent = 'Apply';
    if (data.valid) {
      msgEl.style.display = 'block'; msgEl.style.color = 'var(--success)';
      msgEl.textContent = '✓ Promo applied!';
      _offerUnlocked = true;
      setTimeout(() => {
        closeModal('offer-pay-overlay');
        if (_pendingOfferCarId) { const id = _pendingOfferCarId; _pendingOfferCarId = null; showOfferVerifyStep(id); }
      }, 800);
    } else {
      msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)';
      msgEl.textContent = data.message || 'Invalid promo code.';
    }
  })
  .catch(() => {
    btn.disabled = false; btn.textContent = 'Apply';
    msgEl.style.display = 'block'; msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Could not validate code. Please try again.';
  });
}

async function handleOfferPayment() {
  const btn = document.getElementById('offer-pay-btn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0"/></svg>Loading…';
  try {
    if (!_offerConfig) {
      _offerConfig = await fetch('/api/stripe/config').then(r => r.json());
    }
    const { publishableKey, offerPriceId } = _offerConfig;
    if (!offerPriceId) throw new Error('No offer price ID');
    const carId = _pendingOfferCarId || '';
    // Save car for restoration after Stripe redirect
    const car = allCars.find(c => String(c.id) === String(carId));
    if (car) sessionStorage.setItem('offerCar', JSON.stringify(car));
    const returnUrl = `${location.origin}/?offer_success={CHECKOUT_SESSION_ID}&car=${encodeURIComponent(carId)}`;
    const sessionRes = await fetch('/api/stripe/embedded-checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: offerPriceId, returnUrl })
    });
    const sessionData = await sessionRes.json();
    if (!sessionData.clientSecret) throw new Error('No client secret');
    // Hide paywall modal, show Stripe modal
    closeModal('offer-pay-overlay');
    const stripeModal = document.getElementById('offer-stripe-modal');
    stripeModal.style.display = 'flex';
    // Mount embedded checkout
    const stripe = Stripe(publishableKey);
    if (_offerStripeInstance) { _offerStripeInstance.destroy(); _offerStripeInstance = null; }
    _offerStripeInstance = await stripe.initEmbeddedCheckout({
      fetchClientSecret: () => Promise.resolve(sessionData.clientSecret),
    });
    const container = document.getElementById('offer-stripe-checkout-container');
    container.innerHTML = '';
    const mountDiv = document.createElement('div');
    mountDiv.id = 'offer-stripe-mount';
    container.appendChild(mountDiv);
    _offerStripeInstance.mount('#offer-stripe-mount');
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

function closeOfferStripeModal() {
  const modal = document.getElementById('offer-stripe-modal');
  if (modal) modal.style.display = 'none';
  if (_offerStripeInstance) { _offerStripeInstance.destroy(); _offerStripeInstance = null; }
  const loadingHTML = '<div id="offer-stripe-loading" style="display:flex;align-items:center;justify-content:center;padding:60px 0;gap:12px;color:var(--ink3);font-size:14px"><svg style="animation:spin 1s linear infinite" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>Loading secure checkout...</div>';
  const container = document.getElementById('offer-stripe-checkout-container');
  if (container) container.innerHTML = loadingHTML;
}

function openOfferModal(carId) {
  currentCar = allCars.find(c => String(c.id) === String(carId));
  if (!currentCar) return;
  activeTab = 'cash'; offerValid = false;

  const eff = currentCar.msrp || null;

  document.getElementById('modal-car-name').textContent = `${currentCar.year} ${currentCar.name}`;
  document.getElementById('modal-dealer-info').textContent =
    `${currentCar.dealer}${currentCar.dealerCity?'  '+currentCar.dealerCity:''}  Stock: ${currentCar.stock}`;
  document.getElementById('modal-msrp').textContent = eff ? fmt(eff) : 'N/A';
  const mktAvgEl = document.getElementById('modal-mktavg');
  const basisEl  = document.getElementById('modal-mktavg-basis');
  if (currentCar.apiMarketAvg) {
    // Prefer the broader API-sourced avg from the comparables endpoint
    if (mktAvgEl) mktAvgEl.textContent = fmt(currentCar.apiMarketAvg);
    if (basisEl)  basisEl.textContent  = 'market data';
  } else if (currentCar.marketAvg) {
    // Fall back to local search-result avg
    if (mktAvgEl) mktAvgEl.textContent = fmt(currentCar.marketAvg);
    if (basisEl) {
      const labels = { trim: 'same trim', model: 'same model', condition: 'new avg' };
      basisEl.textContent = labels[currentCar.marketAvgBasis] || '';
    }
  } else {
    if (mktAvgEl) mktAvgEl.textContent = 'N/A';
    if (basisEl)  basisEl.textContent  = '';
  }
  const floorEl = document.getElementById('modal-floor');
  const floorLbl = document.querySelector('#offer-overlay .price-box:last-child .pb-lbl');
  if (floorLbl) floorLbl.textContent = 'Dealer Invoice';
  if (floorEl) floorEl.textContent = currentCar.apiInvoice ? fmt(currentCar.apiInvoice) : 'N/A';

  // Wire up the Deal Intelligence CTA link with this car's params
  const intelLink = document.getElementById('modal-intel-link');
  if (intelLink && currentCar) {
    const p = new URLSearchParams({
      vin:       currentCar.vin       || '',
      year:      currentCar.year      || '',
      make:      currentCar.name?.split(' ')[0] || '',
      model:     currentCar.name?.split(' ').slice(1).join(' ') || '',
      trim:      currentCar.trim      || '',
      price:     currentCar.msrp      || 0,
      mileage:   currentCar.mileageRaw|| 0,
      condition: currentCar.condition === 'certified' ? 'cpo' : (currentCar.condition || 'used'),
    });
    intelLink.href = `/deal-intelligence.html?${p.toString()}`;
  }

  ['cash-offer','fin-down','fin-monthly','lease-down','lease-monthly'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['cash-feedback','fin-feedback','lease-feedback'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent='';el.className='offer-feedback';}});
  document.getElementById('cash-meter').style.width='0%';
  document.getElementById('submit-btn').disabled=true;
  document.querySelectorAll('.offer-tab').forEach((t,i)=>t.className='offer-tab'+(i===0?' active':''));
  resetTradeIn();
  switchTab('cash',null);
  document.getElementById('offer-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}

// ── Landing page UI controls ──────────────────────────────────────────────────

function setCondTab(btn, val) {
  document.querySelectorAll('.cond-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('search-condition').value = val;
}

function setBodyPill(btn, val) {
  document.querySelectorAll('.bs-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  // Electric maps to fuel, not body style
  if (val === 'electric') {
    document.getElementById('search-body').value = '';
    document.getElementById('search-fuel').value = 'electric';
  } else {
    document.getElementById('search-body').value = val;
    if (document.getElementById('search-fuel').value === 'electric') {
      document.getElementById('search-fuel').value = '';
    }
  }
}

function toggleMoreFilters() {
  const panel = document.getElementById('mf-panel');
  const toggle = document.getElementById('mf-toggle');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  toggle.classList.toggle('open', !isOpen);
}

// ── Recent searches (localStorage) ───────────────────────────────────────────

const RS_KEY = 'recentSearches';
const RS_MAX = 6;

function saveRecentSearch(make, model, trim, condition, zip, radius, body) {
  if (!make && !model && !body) return; // don't save blank searches
  const label = [
    make || 'Any Make',
    model || '',
    trim || '',
    condition ? ({new:'New',used:'Used'}[condition] || condition) : '',
    body || ''
  ].filter(Boolean).join(' ');
  // Save without images first — images are patched in after results load
  const entry = { make, model, trim, condition, zip, radius, body, label, ts: Date.now(), imgs: [] };
  let list = loadRecentSearches();
  list = list.filter(r => r.label !== label); // dedupe
  list.unshift(entry);
  list = list.slice(0, RS_MAX);
  try { localStorage.setItem(RS_KEY, JSON.stringify(list)); } catch(e) {}
  renderRecentPreviews();
  // Persist to DB if signed in
  if (window.Clerk?.user) {
    window.Clerk.session.getToken().then(token => {
      const user = window.Clerk.user;
      return fetch('/api/user/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ make, model, trim, condition, zip, radius, body, label,
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName })
      }).then(r => r.ok ? r.json() : null).then(row => {
        if (row?.id) {
          // Backfill DB id into localStorage entry
          let ls = loadRecentSearches();
          if (ls[0] && ls[0].label === label) { ls[0]._dbId = row.id; }
          try { localStorage.setItem(RS_KEY, JSON.stringify(ls)); } catch(_) {}
        }
      });
    }).catch(() => {});
  }
}

function patchRecentSearchImages(cars) {
  const imgs = (cars || []).slice(0, 4).map(c => c.img).filter(Boolean);
  if (!imgs.length) return;
  let list = loadRecentSearches();
  if (!list.length) return;
  list[0] = { ...list[0], imgs }; // update the most recent entry
  try { localStorage.setItem(RS_KEY, JSON.stringify(list)); } catch(e) {}
  renderRecentPreviews();
  // Patch images in DB if signed in
  if (window.Clerk?.user && list[0]._dbId) {
    const dbId = list[0]._dbId;
    window.Clerk.session.getToken().then(token => {
      fetch(`/api/user/searches/${dbId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imgs })
      }).catch(() => {});
    }).catch(() => {});
  }
}

function loadRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RS_KEY) || '[]'); } catch(e) { return []; }
}


function applyRecentSearch(idx) {
  const list = loadRecentSearches();
  const r = list[idx];
  if (!r) return;
  const makeEl = document.getElementById('search-make');
  const condEl = document.getElementById('search-condition');
  const zipEl  = document.getElementById('search-zip');
  if (r.zip) zipEl.value = r.zip;
  if (r.radius) {
    const radiusEl = document.getElementById('search-radius');
    if (radiusEl) radiusEl.value = r.radius;
  }
  if (condEl) condEl.value = r.condition || '';
  // sync cond tab
  document.querySelectorAll('.cond-tab').forEach(t => {
    const v = t.getAttribute('onclick')?.match(/setCondTab\(this,'([^']*)'\)/)?.[1] ?? '';
    t.classList.toggle('active', v === (r.condition || ''));
  });
  if (makeEl) {
    makeEl.value = r.make || '';
    makeEl.dispatchEvent(new Event('change'));
  }
  setTimeout(async () => {
    const modelEl = document.getElementById('search-model');
    if (modelEl && r.model) {
      modelEl.value = r.model;
      // dispatch for any other listeners (e.g. UI state), but don't rely on it for trims
      modelEl.dispatchEvent(new Event('change'));
    }
    if (r.body) {
      document.getElementById('search-body').value = r.body;
      document.querySelectorAll('.bs-pill').forEach(p => {
        const v = p.getAttribute('onclick')?.match(/setBodyPill\(this,'([^']*)'\)/)?.[1] ?? '';
        p.classList.toggle('active', v === r.body);
      });
    }
    if (r.trim) {
      // r.trim may be a comma-separated list (multi-trim) or a single value
      const trimValues = new Set(r.trim.split(',').map(function(t){ return t.trim(); }).filter(Boolean));
      await populateTrims(trimValues);
    }
    runSearch();
  }, 150);
}


function renderRecentPreviews() {
  const section = document.getElementById('recent-previews');
  if (!section) return;
  const list = loadRecentSearches();
  if (!list.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const cards = list.map((r, i) => {
    const imgs = r.imgs || [];
    // Build a 2x2 photo collage if we have multiple images, otherwise single image
    let photoHtml;
    if (imgs.length >= 4) {
      photoHtml = `<div class="rp-collage">
        ${imgs.slice(0,4).map(url => `<img src="${escHtml(url)}" alt="" loading="lazy" onerror="this.style.display='none'">`).join('')}
      </div>`;
    } else if (imgs.length >= 1) {
      photoHtml = `<img class="rp-single-img" src="${escHtml(imgs[0])}" alt="" loading="lazy" onerror="this.parentElement.querySelector('.rp-placeholder').style.display='flex';this.style.display='none'">
        <div class="rp-placeholder" style="display:none"><span class="rp-ph-logo">Auto<em>Negotiating</em>.com</span><span class="rp-ph-sub">Image not available</span></div>`;
    } else {
      photoHtml = `<div class="rp-placeholder"><span class="rp-ph-logo">Auto<em>Negotiating</em>.com</span><span class="rp-ph-sub">Image not available</span></div>`;
    }
    const condLabel = r.condition ? ({new:'New',used:'Used'}[r.condition] || r.condition) : 'All';
    return `
      <div class="rp-card" onclick="applyRecentSearch(${i})">
        <div class="rp-img-wrap">${photoHtml}</div>
        <div class="rp-info">
          <div class="rp-label">${escHtml(r.label)}</div>
          <div class="rp-meta">${escHtml(condLabel)}${r.zip ? ' · ' + escHtml(r.zip) : ''}</div>
        </div>
        <button class="rp-remove" onclick="removeRecentPreview(event,${i})" title="Remove">×</button>
      </div>`;
  }).join('');
  section.querySelector('.rp-grid').innerHTML = cards;
}

function removeRecentPreview(e, idx) {
  e.stopPropagation();
  let list = loadRecentSearches();
  const removed = list[idx];
  list.splice(idx, 1);
  try { localStorage.setItem(RS_KEY, JSON.stringify(list)); } catch(e) {}
  renderRecentPreviews();
  // Remove from DB if signed in and we have a DB id
  if (window.Clerk?.user && removed?._dbId) {
    window.Clerk.session.getToken().then(token => {
      fetch(`/api/user/searches/${removed._dbId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }).catch(() => {});
  }
}

// ── Card carousel ─────────────────────────────────────────────────────────────

function cardCarouselGo(e, carIdx, dir, toIdx) {
  e.stopPropagation();
  const carousel = document.querySelector(`.card-carousel[data-cc="${carIdx}"]`);
  if (!carousel) return;
  const imgs = carousel.querySelectorAll('img');
  const dots = carousel.querySelectorAll('.cc-dot');
  if (!imgs.length) return;
  let idx = parseInt(carousel.dataset.idx) || 0;
  if (toIdx !== undefined) {
    idx = toIdx;
  } else {
    idx = (idx + dir + imgs.length) % imgs.length;
  }
  imgs.forEach((img, i) => { img.style.opacity = i === idx ? '1' : '0'; });
  dots.forEach((d, i) => { d.classList.toggle('active', i === idx); });
  carousel.dataset.idx = idx;
}

function switchTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.offer-tab').forEach(t=>t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else { const idx=['cash','finance','lease'].indexOf(tab); document.querySelectorAll('.offer-tab')[idx]?.classList.add('active'); }
  ['cash','finance','lease'].forEach(t=>{ document.getElementById('tab-'+t).style.display=t===tab?'block':'none'; });
  offerValid=false; document.getElementById('submit-btn').disabled=true;
}

function setFeedback(id, meterId, pct, msg, type) {
  const el=document.getElementById(id); el.textContent=msg; el.className='offer-feedback show '+type;
  if(meterId){const m=document.getElementById(meterId);m.style.width=Math.min(Math.max(pct,0),100)+'%';m.style.background=type==='good'?'var(--success)':type==='warn'?'var(--warning)':'var(--danger)';}
}

function evaluateOffer() {
  if(!currentCar) return;
  const val=parseFloat(document.getElementById('cash-offer').value);
  const eff=currentCar.msrp, floor=currentCar.floor;
  offerValid=false; document.getElementById('submit-btn').disabled=true;
  if(!val||isNaN(val)){document.getElementById('cash-feedback').className='offer-feedback';document.getElementById('cash-meter').style.width='0%';return;}
  const pct=((val-floor)/(eff-floor))*100;
  const inp=document.getElementById('cash-offer');
  if(val<floor*0.88){setFeedback('cash-feedback','cash-meter',pct,` This offer of ${fmt(val)} cannot be submitted  it is too low. The minimum realistic offer is around ${fmt(Math.round(floor*0.9))}. Please revise your offer.`,'bad');inp.classList.add('error');}
  else if(val<floor){setFeedback('cash-feedback','cash-meter',pct,` ${fmt(val)} is below the estimated dealer floor. We can submit this, but expect a counter-offer.`,'warn');inp.classList.remove('error');offerValid=true;}
  else if(val<=eff*0.985){setFeedback('cash-feedback','cash-meter',Math.max(pct,65),` Strong offer! ${fmt(val)} is ${fmt(Math.round(eff-val))} below the after-incentive price  excellent negotiating position.`,'good');inp.classList.remove('error');offerValid=true;}
  else{setFeedback('cash-feedback','cash-meter',100,` ${fmt(val)} is at or near market price. Very likely to be accepted quickly.`,'good');inp.classList.remove('error');offerValid=true;}
  document.getElementById('submit-btn').disabled=!offerValid;
}

function evaluateFinance() {
  if(!currentCar) return;
  const down=parseFloat(document.getElementById('fin-down').value)||0;
  const monthly=parseFloat(document.getElementById('fin-monthly').value)||0;
  const term=parseInt(document.getElementById('fin-term').value)||60;
  const apr=parseFloat(document.getElementById('fin-apr').value)||6.9;
  offerValid=false; document.getElementById('submit-btn').disabled=true;
  if(!monthly){document.getElementById('fin-feedback').className='offer-feedback';document.getElementById('fin-calc').textContent='';return;}
  const r=apr/100/12, loan=r>0?monthly*(1-Math.pow(1+r,-term))/r:monthly*term, implied=Math.round(loan+down), floor=currentCar.floor;
  document.getElementById('fin-calc').textContent=`Implied price: ${fmt(implied)}  Loan: ${fmt(loan)}  Est. total paid: ${fmt(implied+Math.round(loan*apr/100/12*term))}`;
  if(implied<floor*0.88){setFeedback('fin-feedback',null,0,` Implied price of ${fmt(implied)} cannot be submitted  too low. Increase monthly payment or down payment.`,'bad');}
  else if(implied<floor){setFeedback('fin-feedback',null,0,` Implied price of ${fmt(implied)} is below dealer floor. We can submit but expect a counter.`,'warn');offerValid=true;}
  else{setFeedback('fin-feedback',null,0,` Implied price of ${fmt(implied)} is competitive. Strong financing offer!`,'good');offerValid=true;}
  document.getElementById('submit-btn').disabled=!offerValid;
}

function evaluateLease() {
  if(!currentCar) return;
  const down=parseFloat(document.getElementById('lease-down').value)||0;
  const monthly=parseFloat(document.getElementById('lease-monthly').value)||0;
  const term=parseInt(document.getElementById('lease-term').value)||36;
  offerValid=false; document.getElementById('submit-btn').disabled=true;
  if(!monthly){document.getElementById('lease-feedback').className='offer-feedback';document.getElementById('lease-calc').textContent='';return;}
  const eff=currentCar.msrp;
  const residual=eff*0.52, mf=0.0023, capCost=eff-down;
  const est=Math.round((capCost-residual)/term+(capCost+residual)*mf);
  document.getElementById('lease-calc').textContent=`Est. market lease: ${fmt(est)}/mo  Your ask: ${fmt(monthly)}/mo  Total: ~${fmt(monthly*term+down+895)}`;
  const min=est*0.87;
  if(monthly<min){setFeedback('lease-feedback',null,0,` ${fmt(monthly)}/mo cannot be submitted  too low. Market rate ~${fmt(est)}/mo. Minimum: ${fmt(Math.round(min))}/mo.`,'bad');}
  else if(monthly<est*0.95){setFeedback('lease-feedback',null,0,` ${fmt(monthly)}/mo is a strong below-market ask (~${fmt(est)}/mo market). We'll submit but expect negotiation.`,'warn');offerValid=true;}
  else{setFeedback('lease-feedback',null,0,` ${fmt(monthly)}/mo is competitive near market rate (est. ${fmt(est)}/mo). Likely to be accepted.`,'good');offerValid=true;}
  document.getElementById('submit-btn').disabled=!offerValid;
}

function toggleTradeIn() {
  const track  = document.getElementById('trade-toggle-track');
  const fields = document.getElementById('tradein-fields');
  const label  = document.getElementById('trade-toggle-label');
  const isOn   = track.classList.contains('on');
  track.classList.toggle('on', !isOn);
  fields.style.display = isOn ? 'none' : 'block';
  label.style.borderColor = isOn ? '' : 'var(--orange)';
  label.style.borderRadius = isOn ? 'var(--radius-sm)' : 'var(--radius-sm) var(--radius-sm) 0 0';
}

function resetTradeIn() {
  const track  = document.getElementById('trade-toggle-track');
  const fields = document.getElementById('tradein-fields');
  const label  = document.getElementById('trade-toggle-label');
  if (!track) return;
  track.classList.remove('on');
  fields.style.display = 'none';
  label.style.borderColor = '';
  label.style.borderRadius = 'var(--radius-sm)';
  ['ti-vin','ti-year','ti-make','ti-model','ti-trim','ti-miles','ti-color','ti-payoff'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['ti-condition','ti-accidents'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const statusEl = document.getElementById('ti-vin-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'ti-vin-status'; }
  const lookupBtn = document.getElementById('ti-vin-lookup');
  if (lookupBtn) lookupBtn.style.display = 'none';
}

function onTradeInVinInput(el) {
  el.value = el.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  const btn = document.getElementById('ti-vin-lookup');
  if (btn) btn.style.display = el.value.length === 17 ? 'inline-block' : 'none';
  const status = document.getElementById('ti-vin-status');
  if (status) { status.textContent = ''; status.className = 'ti-vin-status'; }
}

function tiTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function lookupTradeInVin() {
  const vinEl  = document.getElementById('ti-vin');
  const btn    = document.getElementById('ti-vin-lookup');
  const status = document.getElementById('ti-vin-status');
  const vin    = vinEl.value.trim().toUpperCase();
  if (vin.length !== 17) return;
  btn.disabled = true;
  btn.textContent = 'Looking up…';
  status.textContent = '';
  status.className = 'ti-vin-status';
  try {
    const res  = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
    const data = await res.json();
    const r    = data.Results?.[0];
    if (!r || (r.ErrorCode && !r.ErrorCode.startsWith('0'))) throw new Error('VIN not found');
    const year  = r.ModelYear || '';
    const make  = tiTitleCase(r.Make  || '');
    const model = tiTitleCase(r.Model || '');
    const trim  = r.Trim || r.Series || '';
    if (year)  document.getElementById('ti-year').value  = year;
    if (make)  document.getElementById('ti-make').value  = make;
    if (model) document.getElementById('ti-model').value = model;
    if (trim)  document.getElementById('ti-trim').value  = trim;
    const desc = [year, make, model].filter(Boolean).join(' ');
    if (desc) {
      status.textContent = `✓ Found: ${desc}${trim ? ' ' + trim : ''}`;
      status.className = 'ti-vin-status ok';
    } else {
      status.textContent = 'VIN decoded — please verify the filled fields';
      status.className = 'ti-vin-status ok';
    }
  } catch (err) {
    status.textContent = 'Could not decode this VIN — please fill in the fields manually';
    status.className = 'ti-vin-status err';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Look up';
  }
}

function submitOffer() { if(!currentCar||!offerValid) return; closeModal('offer-overlay'); buildEmailDraft(); }

//  EMAIL DRAFT 
function buildEmailDraft() {
  const car=currentCar;
  const eff=car.msrp||null;
  let offerBlock='';
  if(activeTab==='cash'){const v=parseFloat(document.getElementById('cash-offer').value);offerBlock=`Purchase Type:    Cash Purchase\nOffer Amount:     ${fmt(v)}`;}
  else if(activeTab==='finance'){const down=parseFloat(document.getElementById('fin-down').value)||0,monthly=parseFloat(document.getElementById('fin-monthly').value)||0,term=document.getElementById('fin-term').value,apr=document.getElementById('fin-apr').value;offerBlock=`Purchase Type:    Financed Purchase\nMonthly Payment:  ${fmt(monthly)}/month\nLoan Term:        ${term} months\nAPR:              ${apr}%\nDown Payment:     ${fmt(down)}`;}
  else{const down=parseFloat(document.getElementById('lease-down').value)||0,monthly=parseFloat(document.getElementById('lease-monthly').value)||0,term=document.getElementById('lease-term').value,miles=parseInt(document.getElementById('lease-miles').value);offerBlock=`Purchase Type:    Lease\nMonthly Payment:  ${fmt(monthly)}/month\nLease Term:       ${term} months\nAnnual Mileage:   ${miles.toLocaleString()} miles/year\nCap Cost Red.:    ${fmt(down)}`;}
  // Build trade-in block if toggled on
  let tradeBlock = '';
  const tradeTrack = document.getElementById('trade-toggle-track');
  if (tradeTrack && tradeTrack.classList.contains('on')) {
    const tiVin      = document.getElementById('ti-vin').value.trim().toUpperCase();
    const tiYear     = document.getElementById('ti-year').value.trim();
    const tiMake     = document.getElementById('ti-make').value.trim();
    const tiModel    = document.getElementById('ti-model').value.trim();
    const tiTrim     = document.getElementById('ti-trim').value.trim();
    const tiMiles    = parseInt(document.getElementById('ti-miles').value) || 0;
    const tiCond     = document.getElementById('ti-condition').value;
    const tiPayoff   = parseFloat(document.getElementById('ti-payoff').value) || 0;
    const tiColor    = document.getElementById('ti-color').value.trim();
    const tiAccident = document.getElementById('ti-accidents').value;
    const lines = ['\n\nTRADE-IN VEHICLE\n'];
    if (tiYear || tiMake || tiModel) lines.push(`Year / Make / Model:   ${[tiYear,tiMake,tiModel].filter(Boolean).join(' ')}`);
    if (tiTrim)     lines.push(`Trim Level:            ${tiTrim}`);
    if (tiVin)      lines.push(`VIN:                   ${tiVin}`);
    if (tiMiles)    lines.push(`Mileage:               ${tiMiles.toLocaleString()} miles`);
    if (tiCond)     lines.push(`Condition:             ${tiCond}`);
    if (tiColor)    lines.push(`Exterior Color:        ${tiColor}`);
    if (tiAccident) lines.push(`Accident History:      ${tiAccident}`);
    lines.push(`Payoff Balance:        ${tiPayoff > 0 ? fmt(tiPayoff) : 'Owned Outright – No Payoff'}`);
    lines.push('\nOur client is open to applying this trade-in toward the purchase price.');
    tradeBlock = lines.join('\n');
  }

  const profile = getBuyerProfile();
  const buyerName = profile?.name || 'Our Client';
  const today=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const subj=`Buyer Offer  ${car.year} ${car.name} | Stock ${car.stock} | AutoNegotiating.com`;
  const body=`Dear ${car.dealer} Internet Sales Team,

I am writing on behalf of ${buyerName}, a verified buyer registered through AutoNegotiating.com. Our client has submitted a formal offer on the following vehicle currently in your inventory:

VEHICLE DETAILS

Year / Make / Model:   ${car.year} ${car.name}
Trim Level:            ${car.trim}
Stock Number:          ${car.stock}${car.vin?'\nVIN:                   '+car.vin:''}
Listed Price:          ${eff ? fmt(eff) : 'Call for Price'}

CLIENT OFFER

${offerBlock}${tradeBlock}

Our client is a serious buyer ready to proceed immediately. This offer reflects current market pricing and all applicable incentives validated through AutoNegotiating.com.

Please respond within 24-48 business hours to accept, counter, or confirm availability:

  Email:  offers@autonegotiating.com
  Phone:  (503) 893-9408
  Web:    www.AutoNegotiating.com

Submitted: ${today} via AutoNegotiating.com verified buyer platform.

Best regards,
AutoNegotiating.com  Client Services
offers@autonegotiating.com | (503) 893-9408`;

  document.getElementById('email-to').textContent=`${car.dealer} — Internet Sales Division (Routed via AutoNegotiating.com)`;
  document.getElementById('email-subject').textContent=subj;
  document.getElementById('email-body').textContent=body;
  // Store for sendOfferEmail()
  document.getElementById('email-send-btn').dataset.to = car.dealerEmail;
  document.getElementById('email-send-btn').dataset.dealer = car.dealer;
  const sendLabel = document.getElementById('email-send-label');
  if (sendLabel) sendLabel.textContent = 'Send Offer';
  document.getElementById('email-send-btn').disabled = false;
  const anonCheckReset = document.getElementById('email-anon-check');
  if (anonCheckReset) anonCheckReset.checked = false;
  document.getElementById('email-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}

async function sendOfferEmail() {
  const btn = document.getElementById('email-send-btn');
  const label = document.getElementById('email-send-label');
  const to = btn.dataset.to;
  const dealerName = btn.dataset.dealer;
  const subject = document.getElementById('email-subject').textContent;
  const body = document.getElementById('email-body').textContent || document.getElementById('email-body').innerText;
  const profile = getBuyerProfile();
  const anonCheck = document.getElementById('email-anon-check');
  const anonymous = !!(anonCheck && anonCheck.checked);

  if (!to || !subject || !body) { showToast('Missing email details'); return; }

  const buyerEmail = profile?.email || window.Clerk?.user?.primaryEmailAddress?.emailAddress || null;
  if (!buyerEmail) {
    showToast('Please sign in and add your email before sending an offer.');
    return;
  }

  btn.disabled = true;
  label.textContent = 'Sending...';

  try {
    const car = JSON.parse(sessionStorage.getItem('offerCar') || 'null');
    const res = await fetch('/api/send-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        dealerName,
        subject,
        body,
        vin: car?.vin || null,
        buyerEmail,
        buyerName:  profile?.name  || null,
        buyerPhone: profile?.phone || null,
        anonymous,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed');
    label.textContent = 'Sent ✓';
    showToast('Offer sent! Check your inbox for a copy.');
    _offerUnlocked = false;
    sessionStorage.removeItem('offerUnlocked');
    sessionStorage.removeItem('offerCar');
    setTimeout(() => closeModal('email-overlay'), 2000);
  } catch (err) {
    btn.disabled = false;
    label.textContent = 'Send Offer';
    showToast('Failed to send: ' + err.message);
  }
}

//  MODAL / TOAST 
function closeModal(id){document.getElementById(id).classList.add('hidden');document.body.style.overflow='';}
function handleOverlayClick(e,id){if(e.target.id===id)closeModal(id);}
function copyEmail(){
  const full=`To: ${document.getElementById('email-to').textContent}\nSubject: ${document.getElementById('email-subject').textContent}\n\n${document.getElementById('email-body').textContent}`;
  navigator.clipboard.writeText(full).then(()=>showToast(' Email copied!')).catch(()=>showToast(' Select and copy manually'));
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal('email-overlay');closeModal('offer-overlay');closeModal('detail-overlay');closeModal('verify-overlay');closeModal('offer-pay-overlay');closeOfferStripeModal();}
  const detailOpen = !document.getElementById('detail-overlay').classList.contains('hidden');
  if(detailOpen && galleryPhotos.length > 1){
    if(e.key==='ArrowLeft')  galleryGo(-1);
    if(e.key==='ArrowRight') galleryGo(1);
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.activeElement.closest('.search-bar')){runSearch();}});

//  INIT  show empty state, don't auto-search 
(function init() {
  document.getElementById('loading-area').style.display = 'none';
  document.getElementById('inventory-grid').style.display = 'none';
  document.getElementById('grid-label').style.display = 'none';
  document.getElementById('stat-count').textContent = '';
  const si = document.getElementById('stat-inc'); if(si) si.textContent = '';
  const ss = document.getElementById('stat-savings'); if(ss) ss.textContent = '';
  document.getElementById('stat-dealers').textContent = '';
  // Wire make → model dropdown
  const makeEl = document.getElementById('search-make');
  if (makeEl) makeEl.addEventListener('change', populateModels);
  const modelEl = document.getElementById('search-model');
  if (modelEl) modelEl.addEventListener('change', () => { window._trimsPromise = populateTrims(); });

  renderRecentPreviews();

  // Restore subscription from localStorage (persists) or sessionStorage
  const savedSubEmail = (() => { try { return localStorage.getItem('subEmail'); } catch(_) {} })() || sessionStorage.getItem('subEmail');
  if (savedSubEmail) verifySubscriptionByEmail(savedSubEmail);

  renderRecentPreviews();

  // Handle Stripe offer payment return
  const urlParams = new URLSearchParams(window.location.search);
  const offerSuccess = urlParams.get('offer_success');
  const offerCarId   = urlParams.get('car');
  if (offerSuccess) {
    history.replaceState({}, '', location.origin + location.pathname);
    fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(offerSuccess)}`)
      .then(r => r.json())
      .then(data => {
        if (data.paid) {
          sessionStorage.setItem('offerUnlocked', 'once');
          // Restore saved car so openOfferModal can find it
          const savedCar = (() => { try { return JSON.parse(sessionStorage.getItem('offerCar') || 'null'); } catch(e) { return null; } })();
          if (savedCar && !allCars.find(c => String(c.id) === String(savedCar.id))) {
            allCars.push(savedCar);
          }
          if (offerCarId) showOfferVerifyStep(offerCarId);
        }
      })
      .catch(() => {});
  }

  // Auto-open subscribe modal if ?subscribe=1
  if (urlParams.get('subscribe') === '1') {
    history.replaceState({}, '', location.origin + location.pathname);
    if (!_subscriptionActive) openSubscribeModal();
  }

  // Handle subscription checkout return
  const subSuccess = urlParams.get('sub_success');
  if (subSuccess) {
    history.replaceState({}, '', location.origin + location.pathname);
    fetch(`/api/stripe/verify-session?session_id=${encodeURIComponent(subSuccess)}`)
      .then(r => r.json())
      .then(data => {
        if (data.paid && data.email) {
          activateSubscription(data.email);
        }
      })
      .catch(() => {});
  }

  // Auto-search if ?make= param is present (e.g. arriving from PDF comparable link)
  const makeParam  = urlParams.get('make');
  const modelParam = urlParams.get('model');
  const yearParam  = urlParams.get('year');

  if (makeParam) {
    const radiusEl = document.getElementById('search-radius');
    const makeEl   = document.getElementById('search-make');
    const yearMinEl = document.getElementById('search-min-year');
    const yearMaxEl = document.getElementById('search-max-year');

    if (radiusEl) radiusEl.value = '5000'; // nationwide

    // Set dropdowns for display
    if (makeEl) {
      const opt = Array.from(makeEl.options).find(o => o.value.toLowerCase() === makeParam.toLowerCase());
      if (opt) { makeEl.value = opt.value; populateModels(); }
    }
    if (yearParam) {
      if (yearMinEl) yearMinEl.value = yearParam;
      if (yearMaxEl) yearMaxEl.value = yearParam;
    }

    runSearch(1, { make: makeParam, model: modelParam || '' });
  }

  // ── Saved vehicles & offer history ───────────────────────────────────────
  window.openSavedVehicles = async function() {
    if (typeof closeProfileMenu === 'function') closeProfileMenu();
    const overlay = document.getElementById('saved-overlay');
    const body    = document.getElementById('saved-modal-body');
    overlay.classList.remove('hidden');
    body.innerHTML = '<div class="saved-empty"><p>Loading...</p></div>';

    if (!window.Clerk?.user) {
      body.innerHTML = '<div class="saved-empty"><p>Sign in to view saved vehicles.</p></div>';
      return;
    }
    try {
      const token = await window.Clerk.session.getToken();
      const res   = await fetch('/api/user/favorites', { headers: { Authorization: `Bearer ${token}` } });
      const rows  = res.ok ? await res.json() : [];

      if (!rows.length) {
        body.innerHTML = '<div class="saved-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.25"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><p>No saved vehicles yet.<br>Heart a listing to save it.</p></div>';
        return;
      }

      const cards = rows.map(row => {
        const d   = row.listingData || {};
        const img = d.img || (Array.isArray(d.allPhotos) && d.allPhotos[0]) || null;
        const name  = escHtml(d.year ? `${d.year} ${d.name||''}` : (d.name||'Vehicle'));
        const trim  = escHtml(d.trim || '');
        const price = d.msrp ? fmt(d.msrp) : 'Call for Price';
        const dealer = escHtml(d.dealer || '');
        const city   = escHtml(d.dealerCity || '');
        const vin    = row.vin || '';
        // Use a wrapper div so onerror can toggle visibility without quote conflicts
        return `
          <div class="saved-card">
            <div class="saved-card-img-wrap">
              ${img ? `<img class="saved-card-img" src="${escHtml(img)}" alt="${name}" onerror="this.style.display='none';this.parentElement.querySelector('.saved-card-img-ph').style.display='flex'">` : ''}
              <div class="saved-card-img-ph" style="${img ? 'display:none' : 'display:flex'}">${NO_IMG_MD}</div>
            </div>
            <div class="saved-card-body">
              <div class="saved-card-name">${name}</div>
              <div class="saved-card-trim">${trim}</div>
              <div class="saved-card-price">${price}</div>
              <div class="saved-card-meta">${dealer}${city ? ' · '+city : ''}</div>
              <div class="saved-card-actions">
                <button class="saved-card-offer" onclick="openOfferFromSaved('${escHtml(vin)}')">✉ Offer</button>
                <button class="saved-card-remove" onclick="removeSaved('${escHtml(vin)}',this)">Remove</button>
              </div>
            </div>
          </div>`;
      }).join('');
      body.innerHTML = `<div class="saved-grid">${cards}</div>`;
    } catch(e) {
      body.innerHTML = '<div class="saved-empty"><p>Could not load saved vehicles.</p></div>';
    }
  };

  window.removeSaved = async function(vin, btn) {
    if (!window.Clerk?.user || !vin) return;
    btn.textContent = '…';
    btn.disabled = true;
    try {
      const token = await window.Clerk.session.getToken();
      await fetch(`/api/user/favorites/${encodeURIComponent(vin)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      btn.closest('.saved-card').remove();
      const grid = document.querySelector('.saved-grid');
      if (grid && !grid.children.length) {
        document.getElementById('saved-modal-body').innerHTML =
          '<div class="saved-empty"><p>No saved vehicles yet.</p></div>';
      }
    } catch(e) { btn.textContent = 'Remove'; btn.disabled = false; }
  };

  window.openOfferFromSaved = function(vin) {
    document.getElementById('saved-overlay').classList.add('hidden');
    const car = allCars.find(c => c.vin === vin);
    if (car) openOffer(String(car.id));
  };

  window.openOfferHistory = async function() {
    if (typeof closeProfileMenu === 'function') closeProfileMenu();
    const overlay = document.getElementById('offers-overlay');
    const body    = document.getElementById('offers-modal-body');
    overlay.classList.remove('hidden');
    body.innerHTML = '<div class="saved-empty"><p>Loading...</p></div>';

    if (!window.Clerk?.user) {
      body.innerHTML = '<div class="saved-empty"><p>Sign in to view offer history.</p></div>';
      return;
    }
    try {
      const token = await window.Clerk.session.getToken();
      const res   = await fetch('/api/user/offers', { headers: { Authorization: `Bearer ${token}` } });
      const rows  = res.ok ? await res.json() : [];

      if (!rows.length) {
        body.innerHTML = '<div class="saved-empty"><p>No offers submitted yet.</p></div>';
        return;
      }

      const items = rows.map(row => {
        const date = new Date(row.submittedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
        return `<div style="padding:14px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--ink)">${escHtml(row.subject||'Offer')}</div>
              <div style="font-size:12px;color:var(--ink3);margin-top:2px">${escHtml(row.dealerName||'')}${row.dealerEmail?' · '+escHtml(row.dealerEmail):''}</div>
              ${row.vin ? `<div style="font-size:11px;color:var(--ink3);font-family:monospace;margin-top:2px">VIN: ${escHtml(row.vin)}</div>` : ''}
            </div>
            <div style="font-size:11px;color:var(--ink3);white-space:nowrap;flex-shrink:0">${date}</div>
          </div>
        </div>`;
      }).join('');
      body.innerHTML = `<div style="padding:0 2px">${items}</div>`;
    } catch(e) {
      body.innerHTML = '<div class="saved-empty"><p>Could not load offer history.</p></div>';
    }
  };

  // ── Multi-select ─────────────────────────────────────────────────────────
  window.selectedCars     = new Set();
  window.selectedCarsData = new Map(); // id → car object, persists across searches

  window.toggleSelect = function(e, carId) {
    e.stopPropagation();
    const id = String(carId).replace(/^"|"$/g, '');
    if (window.selectedCars.has(id)) {
      window.selectedCars.delete(id);
      window.selectedCarsData.delete(id);
    } else {
      window.selectedCars.add(id);
      const carObj = allCars.find(c => String(c.id) === id);
      if (carObj) window.selectedCarsData.set(id, carObj);
    }
    // Update card border + heart icon
    document.querySelectorAll('.car-card').forEach(card => {
      const btn = card.querySelector('.card-heart-btn');
      if (btn) {
        const btnId = btn.dataset.id;
        const sel = window.selectedCars.has(btnId);
        card.classList.toggle('selected', sel);
        btn.classList.toggle('selected', sel);
        btn.innerHTML = sel ? '♥' : '♡';
        btn.title = sel ? 'Remove from selection' : 'Add to selection';
      }
    });
    window.renderSelectionBar();
  };

  function showSaveToast(msg) {
    const t = document.getElementById('save-toast');
    if (!t) return;
    t.textContent = msg || '✓ Saved to favorites';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  window.renderSelectionBar = function renderSelectionBar() {
    const bar   = document.getElementById('selection-bar');
    const chips = document.getElementById('sel-chips');
    if (!bar || !chips) return;
    const ids = Array.from(window.selectedCars);
    if (!ids.length) { bar.classList.remove('visible'); return; }

    chips.innerHTML = ids.map(id => {
      const car = window.selectedCarsData.get(id) || allCars.find(c => String(c.id) === id);
      if (!car) return '';
      const photo = car.allPhotos?.[0] || car.img;
      const label = `${car.year} ${car.name}`.trim();
      const imgHtml = photo
        ? `<img class="sel-chip-img" src="${escHtml(photo)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      return `<div class="sel-chip" id="sel-chip-${escHtml(id)}">
        ${imgHtml}
        <div class="sel-chip-img-ph" style="${photo ? 'display:none' : 'display:flex'}">🚗</div>
        <span class="sel-chip-name">${escHtml(label)}</span>
        <button class="sel-chip-save" onclick="saveOneSelected('${escHtml(id)}')" title="Save to favorites">♡</button>
        <button class="sel-chip-remove" onclick="deselectCar('${escHtml(id)}')" title="Remove">✕</button>
      </div>`;
    }).join('');

    // Update count label
    const countEl = document.getElementById('sel-count');
    if (countEl) countEl.textContent = ids.length === 1 ? '1 selected' : `${ids.length} selected`;

    // Disable Compare button when fewer than 2 selected
    const cmpBtn = document.getElementById('sel-compare-btn');
    if (cmpBtn) {
      cmpBtn.disabled = ids.length < 2;
      cmpBtn.title = ids.length < 2 ? 'Select at least 2 vehicles to compare' : '';
      cmpBtn.style.opacity = ids.length < 2 ? '0.45' : '';
      cmpBtn.style.cursor  = ids.length < 2 ? 'not-allowed' : '';
    }

    bar.classList.add('visible');
  }

  window.deselectCar = function(id) {
    window.selectedCars.delete(String(id));
    window.selectedCarsData.delete(String(id));
    document.querySelectorAll('.car-card').forEach(card => {
      const btn = card.querySelector('.card-heart-btn');
      if (btn && btn.dataset.id === String(id)) {
        card.classList.remove('selected');
        btn.classList.remove('selected');
        btn.innerHTML = '♡';
      }
    });
    window.renderSelectionBar();
  };

  window.clearSelection = function() {
    window.selectedCars.clear();
    window.selectedCarsData.clear();
    document.querySelectorAll('.car-card').forEach(c => {
      c.classList.remove('selected');
      const btn = c.querySelector('.card-heart-btn');
      if (btn) { btn.classList.remove('selected'); btn.innerHTML = '♡'; }
    });
    window.renderSelectionBar();
  };

  window.compareSelected = function() {
    const cars = Array.from(window.selectedCars)
      .map(id => window.selectedCarsData.get(id) || allCars.find(c => String(c.id) === id))
      .filter(Boolean);
    if (cars.length < 2) { alert('Select at least 2 vehicles to compare.'); return; }

    const savedSet = new Set(); // track which have been saved this session

    function buildTable() {
      const rows = [
        ['Deal', c => {
          const m = {great:'★ Great Deal',good:'✓ Good Deal',fair:'Fair Price',high:'↑ High Price'};
          return c.dealRating ? `<span class="cmp-deal ${c.dealRating}">${m[c.dealRating]||c.dealRating}</span>` : '—';
        }],
        ['Condition',    c => c.condition ? ({new:'New',used:'Used'}[c.condition]||c.condition) : '—'],
        ['Mileage',      c => c.mileageRaw ? Number(c.mileageRaw).toLocaleString()+' mi' : (c.condition==='new' ? 'New' : '—')],
        ['Days on lot',  c => c.daysOnLot != null ? c.daysOnLot+' days' : '—'],
        ['Ext. Color',   c => escHtml(c.color||'—')],
        ['Body Style',   c => escHtml(c.bodyStyle ? c.bodyStyle.charAt(0).toUpperCase()+c.bodyStyle.slice(1) : '—')],
        ['Engine',       c => escHtml(c.engine||'—')],
        ['Transmission', c => escHtml(c.transmission||'—')],
        ['Drivetrain',   c => escHtml(c.drivetrain||'—')],
        ['Fuel Type',    c => escHtml(c.fuel||'—')],
        ['Distance',     c => c.distanceMi != null ? c.distanceMi+' mi away' : '—'],
        ['Dealer',       c => escHtml(c.dealer||'—')],
        ['Location',     c => escHtml(c.dealerCity||'—')],
        ['Stock #',      c => escHtml(c.stock||'—')],
        ['VIN',          c => c.vin ? `<span style="font-family:monospace;font-size:11px">${escHtml(c.vin)}</span>` : '—'],
      ];

      const thead = `<thead><tr><th style="min-width:110px;border-right:1px solid var(--border)"></th>${cars.map((c,i) => {
        const photo = (c.allPhotos?.[0] || c.img);
        return `<th>
          <button class="cmp-remove" onclick="removeCmpCar(${i})" title="Remove">×</button>
          ${photo
            ? `<div style="position:relative"><img class="cmp-photo" src="${escHtml(photo)}" alt="${escHtml(c.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="cmp-photo-ph" style="display:none">${NO_IMG_MD}</div></div>`
            : `<div class="cmp-photo-ph">${NO_IMG_MD}</div>`}
          <div class="cmp-vehicle-head">
            <div class="cmp-name">${escHtml(c.year+' '+c.name)}<br><span style="font-weight:400;color:var(--ink3)">${escHtml(c.trim||'')}</span></div>
            <div class="cmp-price">${c.msrp ? fmt(c.msrp) : 'Price N/A'}</div>
            <button class="cmp-save-btn${savedSet.has(String(c.id))?' saved':''}" onclick="cmpSaveCar(${i})" id="cmp-save-${i}">
              ${savedSet.has(String(c.id)) ? '✓ Saved' : '♡ Save'}
            </button>
          </div>
        </th>`;
      }).join('')}</tr></thead>`;

      const tbody = `<tbody>${rows.map(([label, fn]) =>
        `<tr class="row-label">
          <td>${label}</td>
          ${cars.map(c => `<td>${fn(c)}</td>`).join('')}
        </tr>`
      ).join('')}</tbody>`;

      document.getElementById('compare-table').innerHTML = thead + tbody;
    }

    window.removeCmpCar = function(idx) {
      const car = cars[idx];
      if (car) {
        window.selectedCars.delete(String(car.id));
        window.selectedCarsData.delete(String(car.id));
      }
      cars.splice(idx, 1);
      if (cars.length < 1) {
        document.getElementById('compare-overlay').classList.add('hidden');
        window.renderSelectionBar();
        return;
      }
      buildTable();
      window.renderSelectionBar();
    };

    window.cmpSaveCar = function(idx) {
      if (!window.Clerk?.user) {
        try { window.Clerk.openSignIn(); } catch(e) {}
        return;
      }
      const car = cars[idx];
      if (!car || savedSet.has(String(car.id))) return;
      savedSet.add(String(car.id));
      const btn = document.getElementById(`cmp-save-${idx}`);
      if (btn) { btn.textContent = '✓ Saved'; btn.classList.add('saved'); }
      saveFavorite(car);
    };

    buildTable();
    document.getElementById('compare-overlay').classList.remove('hidden');
  };

  function requireSignIn() {
    // Try Clerk modal first
    if (window.Clerk?.openSignIn) {
      try { window.Clerk.openSignIn(); return true; } catch(e) {}
    }
    // Clerk not ready yet — wait up to 3s for it to load then retry
    if (window.Clerk === undefined) {
      const interval = setInterval(() => {
        if (window.Clerk?.openSignIn) {
          clearInterval(interval);
          try { window.Clerk.openSignIn(); } catch(e) {}
        }
      }, 100);
      setTimeout(() => clearInterval(interval), 3000);
      return true;
    }
    // Fallback: click the nav sign-in button which triggers Clerk
    const navBtn = document.querySelector('.nav-auth-btn');
    if (navBtn) { navBtn.click(); return true; }
    return true;
  }

  window.saveOneSelected = function(id) {
    const car = window.selectedCarsData.get(id) || allCars.find(c => String(c.id) === id);
    if (!car) return;
    if (!window.Clerk?.user) { requireSignIn(); return; }
    const btn = document.querySelector(`#sel-chip-${CSS.escape(id)} .sel-chip-save`);
    if (btn) { btn.textContent = '✓'; btn.classList.add('saved'); btn.disabled = true; }
    saveFavorite(car);
    showSaveToast(`✓ ${car.year} ${car.name} saved`);
  };

  window.saveAllSelected = function() {
    if (!window.Clerk?.user) { requireSignIn(); return; }
    const cars = Array.from(window.selectedCars)
      .map(id => window.selectedCarsData.get(id) || allCars.find(c => String(c.id) === id))
      .filter(Boolean);
    if (!cars.length) return;
    cars.forEach(car => {
      saveFavorite(car);
      const id = String(car.id);
      const btn = document.querySelector(`#sel-chip-${CSS.escape(id)} .sel-chip-save`);
      if (btn) { btn.textContent = '✓'; btn.classList.add('saved'); btn.disabled = true; }
    });
    showSaveToast(cars.length === 1 ? `✓ ${cars[0].year} ${cars[0].name} saved` : `✓ ${cars.length} vehicles saved`);
    setTimeout(clearSelection, 1800);
  };

  function saveFavorite(car) {
    if (!window.Clerk?.user) { requireSignIn(); return; }
    return window.Clerk.session.getToken().then(token => {
      return fetch('/api/user/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vin: car.vin || String(car.id), listingData: car })
      }).then(res => {
        if (!res.ok) return res.json().then(e => { throw new Error(e.error || res.status); });
        return res.json();
      });
    }).catch(err => {
      console.error('saveFavorite failed:', err);
      showSaveToast('⚠ Could not save — ' + (err.message || 'please try again'));
    });
  }

  window.saveFromDetail = function() {
    if (!detailCar) return;
    if (!window.Clerk?.user) { requireSignIn(); return; }
    const btn = document.getElementById('btn-detail-save');
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    saveFavorite(detailCar).then(() => {
      if (btn) { btn.textContent = '♥ Saved'; btn.style.color = 'var(--orange)'; }
      showSaveToast(`✓ ${detailCar.year} ${detailCar.name} saved`);
    }).catch(() => {
      if (btn) { btn.textContent = '♡ Save'; btn.disabled = false; }
    });
  };

  // ── Clerk: sync user data when signed in ──────────────────────────────────
  window.addEventListener('clerk:signed-in', async (e) => {
    try {
      const token = await window.Clerk.session.getToken();
      // Fetch saved searches from DB and merge into localStorage
      const res = await fetch('/api/user/searches', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const dbSearches = await res.json();
        if (dbSearches.length) {
          // DB is source of truth when logged in — replace localStorage
          const merged = dbSearches.map(r => ({
            make: r.make, model: r.model, trim: r.trim,
            condition: r.condition, zip: r.zip, radius: r.radius,
            body: r.body, label: r.label, ts: new Date(r.createdAt).getTime(),
            imgs: Array.isArray(r.imgs) ? r.imgs : [],
            _dbId: r.id
          }));
          try { localStorage.setItem(RS_KEY, JSON.stringify(merged)); } catch(_) {}
          renderRecentPreviews();
        } else {
          // No DB records yet — push local searches to DB
          const localSearches = loadRecentSearches();
          for (const s of localSearches.slice().reverse()) {
            const t = await window.Clerk.session.getToken();
            await fetch('/api/user/searches', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
              body: JSON.stringify({ ...s, email: e.detail?.user?.primaryEmailAddress?.emailAddress, name: e.detail?.user?.fullName })
            }).catch(() => {});
          }
          // Re-fetch to get IDs
          const res2 = await fetch('/api/user/searches', { headers: { Authorization: `Bearer ${await window.Clerk.session.getToken()}` } });
          if (res2.ok) {
            const rows = await res2.json();
            const merged = rows.map(r => ({
              make: r.make, model: r.model, trim: r.trim,
              condition: r.condition, zip: r.zip, radius: r.radius,
              body: r.body, label: r.label, ts: new Date(r.createdAt).getTime(),
              imgs: Array.isArray(r.imgs) ? r.imgs : [],
              _dbId: r.id
            }));
            try { localStorage.setItem(RS_KEY, JSON.stringify(merged)); } catch(_) {}
            renderRecentPreviews();
          }
        }
      }

      // Sync buyer profile to/from DB
      const profRes = await fetch('/api/user/profile', {
        headers: { Authorization: `Bearer ${await window.Clerk.session.getToken()}` }
      });
      if (profRes.ok) {
        const dbProfile = await profRes.json();
        if (dbProfile && dbProfile.email) {
          try { localStorage.setItem('buyerProfile', JSON.stringify(dbProfile)); } catch(_) {}
        }
      }
    // Auto-check subscription for signed-in Clerk user
    const clerkEmail = e.detail?.user?.primaryEmailAddress?.emailAddress;
    if (clerkEmail && !_subscriptionActive) {
      verifySubscriptionByEmail(clerkEmail);
    }
    // Check if user chose Pro during sign-up flow
    try {
      if (localStorage.getItem('pendingProUpgrade') === '1') {
        localStorage.removeItem('pendingProUpgrade');
        setTimeout(() => { try { openSubscribeModal(); } catch(e2) {} }, 700);
      }
    } catch(_) {}
    } catch (err) {
      console.warn('[Clerk sync]', err);
    }
  });
})();
