// AutoNegotiating.com  app.js

// Shared "no image" placeholder — used everywhere a photo is unavailable
const NO_IMG_SM  = `<span class="rp-ph-logo">Auto<em>Negotiating</em>.com</span><span class="rp-ph-sub">Image not available</span>`;
const NO_IMG_MD  = `<span style="font-family:'Playfair Display',serif;font-size:14px;font-weight:700;color:var(--ink3);letter-spacing:-0.2px">Auto<em style="color:var(--orange);font-style:normal">Negotiating</em>.com</span><span style="font-size:10px;font-weight:500;color:var(--ink3);letter-spacing:0.3px;text-transform:uppercase;opacity:0.7">Image not available</span>`;
const NO_IMG_LG  = `<span class="ph-logo">Auto<em>Negotiating</em>.com</span><span class="ph-sub">Image not available</span>`;

//  STATE
let allCars = [];
let filteredCars = [];
let currentCar = null;
let activeTab = 'cash';
let offerValid = false;
let currentFilter = 'all';
let currentSort = 'default';
let currentPage = 1;
let totalResultCount = 0;
let isLiveData = false;
const PAGE_SIZE = 12;

//  HELPERS 
const fmt = n => '$' + Math.round(n).toLocaleString();
const escHtml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function guessType(make, body) {
  const b = (body||'').toLowerCase(), m = (make||'').toLowerCase();
  if (b.includes('suv')||b.includes('crossover')||b.includes('cuv')||b.includes('wagon')) return 'suv';
  if (b.includes('truck')||b.includes('pickup')) return 'truck';
  if (['tesla','rivian'].includes(m)||b.includes('electric')) return 'ev';
  if (['bmw','lexus','mercedes','audi','porsche','cadillac','lincoln','genesis'].includes(m)) return 'luxury';
  return 'sedan';
}

function typeEmoji(type) {
  return {suv:'',truck:'',ev:'',luxury:''}[type]||'';
}


function guessEmail(name) {
  if (!name) return 'internet@dealer.com';
  return 'internet@' + name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,20) + '.com';
}

function dealerSearchUrl(car) {
  // 1. Use clickoffUrl (direct dealer VDP link from API) if available
  if (car.listingUrl) return car.listingUrl;
  const domain = car.dealerDomain;
  if (!domain || domain === 'dealer.com') return null;
  if (!car.vin) return `https://${domain}`;
  // 2. Try common dealer DMS VIN search URL patterns:
  //    - /inventory?vin=  (DealerInspire, VinSolutions, Tekion, most modern platforms)
  //    - /routevin.aspx?vin=  (CDK — very common for franchise dealers)
  //    We default to /inventory?vin= which is the most broadly supported
  return `https://${domain}/inventory?vin=${encodeURIComponent(car.vin)}`;
}

// CDK-style dealers use /routevin.aspx — detectable if domain ends in common CDK patterns
// For now /inventory?vin= works for the majority; if a dealer's site returns a 404
// the user lands on the inventory page and can search manually.

//  NORMALIZE AUTO.DEV V1 LISTING 
function colorFamily(colorStr) {
  const c = (colorStr || '').toLowerCase();
  if (!c) return '';
  if (/black|midnight|obsidian|phantom|jet/.test(c))                         return 'Black';
  if (/red|ruby|crimson|scarlet|carmine|barcelona|supersonic|maroon/.test(c)) return 'Red';
  if (/blue|navy|sky|aqua|teal|cyan|cobalt|sapphire|aegean|abyss/.test(c))   return 'Blue';
  if (/green|olive|forest|malachite/.test(c))                                return 'Green';
  if (/orange/.test(c))  return 'Orange';
  if (/yellow/.test(c))  return 'Yellow';
  if (/purple|violet|plum/.test(c)) return 'Purple';
  if (/brown|tan|beige|bronze|copper|mocha|sandy|cinnamon|nutmeg/.test(c))   return 'Brown/Tan';
  if (/gold/.test(c))    return 'Brown/Tan';
  if (/gray|grey|silver|graphite|slate|magnetic|titanium|quartz/.test(c))    return 'Gray/Silver';
  if (/metallic|lunar/.test(c))                                              return 'Gray/Silver';
  if (/white|pearl|ivory|cream|alpine/.test(c))                              return 'White';
  return 'Other';
}

function normalizeListing(l, idx) {
  // Price can be a number, a formatted string like "$32,000", or "accepting_offers"
  const rawPrice = l.priceUnformatted > 0 ? l.priceUnformatted
    : typeof l.price === 'number' && l.price > 0 ? l.price
    : typeof l.price === 'string' && l.price !== 'accepting_offers' ? parseFloat(l.price.replace(/[^0-9.]/g,'')) || 0
    : 0;
  const msrp = rawPrice || null; // null means no price available
  const displayMsrp = msrp || 0;
  const make  = l.make || '';
  const model = l.model || '';
  const trim  = l.trim || '';
  const year  = l.year || 2024;
  const color = l.displayColor || l.color || '';
  const body  = l.bodyStyle || l.bodyType || '';

  const fuel  = l.fuelType || '';
  const type  = guessType(make, body);
  const dealer     = l.dealerName || l.trackingParams?.dealerName || 'Local Dealer';
  const dealerCity = [l.city, l.state].filter(Boolean).join(', ');
  const condLabel = l.condition === 'new' ? 'New' : l.condition === 'certified' ? 'CPO' : l.condition === 'used' ? 'Used' : '';
  const specs = [
    trim || null,
    body ? body.charAt(0).toUpperCase()+body.slice(1) : null,
    condLabel || null,
    l.mileageUnformatted > 0 ? Math.round(l.mileageUnformatted).toLocaleString()+' mi' : (l.condition === 'new' ? 'New' : null),
  ].filter(Boolean);

  return {
    id:          l.id || l.vin || idx,
    emoji:       typeEmoji(type),
    type,
    name:        `${make} ${model}`.trim() || 'Unknown Vehicle',
    year,
    trim:        [trim, color].filter(Boolean).join('  ') || 'Standard',
    trimRaw:     trim, // raw trim without color for filtering
    dealer,
    dealerEmail: guessEmail(dealer),
    dealerDomain: guessEmail(dealer).split('@')[1],
    dealerCity,
    msrp:        displayMsrp,
    priceLabel:  msrp ? null : 'Call for Price',
    floor:       Math.round(displayMsrp * 0.91),
    incentives:  [],
    specs:       specs.slice(0, 4),
    stock:       l.vin ? l.vin.slice(-8) : 'N/A',
    vin:         l.vin || null,
    mileageRaw:  l.mileageUnformatted || 0,
    condition:   l.condition || 'used',
    distanceMi:  l.distanceFromOrigin ? Math.round(l.distanceFromOrigin / 1609) : null,
    img:         l.primaryPhotoUrl || (Array.isArray(l.photoUrls) && l.photoUrls.length ? l.photoUrls[0] : null),
    allPhotos:   Array.isArray(l.photoUrls) && l.photoUrls.length ? l.photoUrls.filter(u => u != null).map(u => u.split('?')[0]) : (l.primaryPhotoUrl ? [l.primaryPhotoUrl] : []),
    color:       color,
    colorFamily: colorFamily(color),
    engine:      l.engine || '',
    transmission: l.transmission || '',
    drivetrain:  l.drivetrain || '',
    fuel:        l.fuelType || '',
    bodyStyle:   l.bodyStyle || l.bodyType || '',
    listingUrl:     l.clickoffUrl || null,
    carfaxUrl:      l.vin ? `https://www.carfax.com/VehicleHistory/p/Report.cfx?partner=DEY_0&vin=${l.vin}` : (l.carfaxUrl || null),
    history:        l.history   || null,
    recentPriceDrop: l.recentPriceDrop === true,
    pricePlusFees:  l.pricePlusFees || null,
    daysOnLot:      l.createdAt ? Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 86400000) : null,
    createdAt:      l.createdAt || null,
    isLive:      true,
  };
}


//  MODEL DATA BY MAKE 
const MODELS_BY_MAKE = {
  "Toyota": [
    "4Runner",
    "Avalon",
    "Camry",
    "Corolla",
    "Corolla Cross",
    "Corolla Hatchback",
    "Crown",
    "GR86",
    "GR Corolla",
    "GR Supra",
    "Highlander",
    "Land Cruiser",
    "Prius",
    "Prius Prime",
    "RAV4",
    "RAV4 Hybrid",
    "RAV4 Prime",
    "Sequoia",
    "Sienna",
    "Tacoma",
    "Tundra",
    "Venza"
  ],
  "Honda": [
    "Accord",
    "Civic",
    "CR-V",
    "HR-V",
    "Odyssey",
    "Passport",
    "Pilot",
    "Prologue",
    "Ridgeline"
  ],
  "Ford": [
    "Bronco",
    "Bronco Sport",
    "Edge",
    "Escape",
    "Expedition",
    "Explorer",
    "F-150",
    "F-250",
    "F-350",
    "Maverick",
    "Mustang",
    "Mustang Mach-E",
    "Ranger",
    "Transit"
  ],
  "Chevrolet": [
    "Blazer",
    "Blazer EV",
    "Camaro",
    "Colorado",
    "Corvette",
    "Equinox",
    "Equinox EV",
    "Malibu",
    "Silverado 1500",
    "Silverado 2500",
    "Silverado 3500",
    "Silverado EV",
    "Suburban",
    "Tahoe",
    "Traverse",
    "Trax"
  ],
  "BMW": [
    "2 Series",
    "3 Series",
    "4 Series",
    "5 Series",
    "7 Series",
    "8 Series",
    "i4",
    "i5",
    "i7",
    "iX",
    "M2",
    "M3",
    "M4",
    "M5",
    "M8",
    "X1",
    "X2",
    "X3",
    "X3 M",
    "X4",
    "X5",
    "X5 M",
    "X6",
    "X6 M",
    "X7",
    "XM",
    "Z4"
  ],
  "Tesla": [
    "Cybertruck",
    "Model 3",
    "Model S",
    "Model X",
    "Model Y"
  ],
  "Hyundai": [
    "Elantra",
    "IONIQ 5",
    "IONIQ 6",
    "Kona",
    "Palisade",
    "Santa Cruz",
    "Santa Fe",
    "Sonata",
    "Tucson",
    "Venue"
  ],
  "Kia": [
    "Carnival",
    "EV6",
    "EV9",
    "K5",
    "Niro",
    "Seltos",
    "Sorento",
    "Soul",
    "Sportage",
    "Stinger",
    "Telluride"
  ],
  "Subaru": [
    "Ascent",
    "BRZ",
    "Crosstrek",
    "Forester",
    "Impreza",
    "Legacy",
    "Outback",
    "Solterra",
    "WRX"
  ],
  "Lexus": [
    "ES 250",
    "ES 300h",
    "ES 350",
    "GX 550",
    "IS 300",
    "IS 350",
    "IS 500",
    "LC 500",
    "LC 500h",
    "LX 600",
    "NX 250",
    "NX 350",
    "NX 350h",
    "NX 450h+",
    "RC 350",
    "RC F",
    "RX 350",
    "RX 350h",
    "RX 450h+",
    "RX 500h",
    "RZ 450e",
    "TX 350",
    "TX 500h",
    "UX 200",
    "UX 250h"
  ],
  "Nissan": [
    "Altima",
    "Ariya",
    "Armada",
    "Frontier",
    "GT-R",
    "Kicks",
    "Leaf",
    "Maxima",
    "Murano",
    "Pathfinder",
    "Rogue",
    "Rogue Sport",
    "Sentra",
    "Titan",
    "Titan XD",
    "Versa",
    "Z"
  ],
  "Mazda": [
    "CX-30",
    "CX-5",
    "CX-50",
    "CX-70",
    "CX-90",
    "Mazda3",
    "Mazda6",
    "MX-5 Miata",
    "MX-5 RF",
    "MX-30"
  ],
  "Volkswagen": [
    "Atlas",
    "Atlas Cross Sport",
    "Golf GTI",
    "Golf R",
    "ID.4",
    "Jetta",
    "Taos",
    "Tiguan"
  ],
  "RAM": [
    "1500",
    "2500",
    "3500",
    "ProMaster"
  ],
  "GMC": [
    "Acadia",
    "Canyon",
    "Envoy",
    "Envista",
    "Hummer EV",
    "Sierra 1500",
    "Sierra 2500",
    "Sierra 3500",
    "Terrain",
    "Yukon",
    "Yukon XL"
  ],
  "Jeep": [
    "Compass",
    "Gladiator",
    "Grand Cherokee",
    "Grand Cherokee L",
    "Grand Wagoneer",
    "Renegade",
    "Wagoneer",
    "Wrangler"
  ],
  "Rivian": [
    "R1S",
    "R1T"
  ],
  "Mercedes-Benz": [
    "A-Class",
    "C-Class",
    "CLA",
    "E-Class",
    "EQB",
    "EQE",
    "EQE SUV",
    "EQS",
    "EQS SUV",
    "G-Class",
    "GLA",
    "GLB",
    "GLC",
    "GLE",
    "GLS",
    "S-Class",
    "SL"
  ],
  "Audi": [
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "A8",
    "e-tron",
    "e-tron GT",
    "Q3",
    "Q4 e-tron",
    "Q5",
    "Q7",
    "Q8",
    "Q8 e-tron",
    "R8",
    "RS3",
    "RS5",
    "RS6",
    "RS7",
    "S3",
    "S4",
    "S5",
    "SQ5",
    "SQ7",
    "SQ8",
    "TT"
  ],
  "Porsche": [
    "718 Boxster",
    "718 Cayman",
    "911",
    "Cayenne",
    "Cayenne Coupe",
    "Macan",
    "Panamera",
    "Taycan",
    "Taycan Cross Turismo",
    "Taycan Sport Turismo"
  ],
  "Cadillac": [
    "CT4",
    "CT4-V",
    "CT5",
    "CT5-V",
    "Escalade",
    "Escalade ESV",
    "Escalade IQ",
    "LYRIQ",
    "XT4",
    "XT5",
    "XT6"
  ],
  "Lincoln": [
    "Aviator",
    "Continental",
    "Corsair",
    "Navigator",
    "Navigator L"
  ],
  "Genesis": [
    "G70",
    "G80",
    "G90",
    "GV70",
    "GV80"
  ],
  "Acura": [
    "ILX",
    "Integra",
    "MDX",
    "NSX",
    "RDX",
    "TLX"
  ],
  "Infiniti": [
    "Q50",
    "Q60",
    "QX50",
    "QX55",
    "QX60",
    "QX80"
  ],
  "Volvo": [
    "C40 Recharge",
    "S60",
    "S90",
    "V60",
    "V60 Cross Country",
    "V90",
    "V90 Cross Country",
    "XC40",
    "XC40 Recharge",
    "XC60",
    "XC90"
  ],
  "Land Rover": [
    "Defender 90",
    "Defender 110",
    "Defender 130",
    "Discovery",
    "Discovery Sport",
    "Range Rover",
    "Range Rover Evoque",
    "Range Rover Sport",
    "Range Rover Velar"
  ],
  "Dodge": [
    "Challenger",
    "Charger",
    "Durango",
    "Hornet"
  ],
  "Buick": [
    "Enclave",
    "Encore",
    "Encore GX",
    "Envision"
  ]
};;

function populateModels() {
  const make = document.getElementById('search-make').value;
  const modelSel = document.getElementById('search-model');
  const trimSel = document.getElementById('search-trim');
  modelSel.innerHTML = '';

  // Reset trim dropdown
  if (trimSel) {
    trimSel.innerHTML = '<option value="">Any Trim</option>';
    trimSel.disabled = true;
  }

  if (!make || !MODELS_BY_MAKE[make]) {
    modelSel.innerHTML = '<option value="">Select Make First</option>';
    modelSel.disabled = true;
    return;
  }

  modelSel.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Any Model';
  modelSel.appendChild(placeholder);

  MODELS_BY_MAKE[make].forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSel.appendChild(opt);
  });
}

async function populateTrims() {
  const make = document.getElementById('search-make').value;
  const model = document.getElementById('search-model').value;
  const trimSel = document.getElementById('search-trim');
  if (!trimSel) return;

  trimSel.innerHTML = '<option value="">Any Trim</option>';
  trimSel.disabled = true;

  if (!make || !model) return;

  // Show loading state
  const loadingOpt = document.createElement('option');
  loadingOpt.value = '';
  loadingOpt.textContent = 'Loading trims...';
  loadingOpt.disabled = true;
  trimSel.appendChild(loadingOpt);

  try {
    const res = await fetch('/api/trims?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model));
    const data = await res.json();
    const trims = data.trims || [];

    trimSel.innerHTML = '<option value="">Any Trim</option>';
    trimSel.disabled = false;

    if (trims.length > 0) {
      trims.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        trimSel.appendChild(opt);
      });
    }
  } catch(e) {
    trimSel.innerHTML = '<option value="">Any Trim</option>';
    trimSel.disabled = false;
  }
}

//  FETCH VIA PROXY 
async function fetchInventory(params, page, limit) {
  const qp = new URLSearchParams({ ...params, page, limit: limit || PAGE_SIZE });
  const res = await fetch(`/api/inventory?${qp}`);
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

//  SEARCH 
async function runSearch(page = 1, forceParams = {}) {
  currentPage = page;

  // Collect all search params
  const zip       = document.getElementById('search-zip').value.trim();
  const radius    = document.getElementById('search-radius').value || '50';
  const radiusNum = parseInt(radius) || 50;
  const make      = forceParams.make  !== undefined ? forceParams.make  : document.getElementById('search-make').value;
  const model     = forceParams.model !== undefined ? forceParams.model : document.getElementById('search-model').value.trim();
  const condition = document.getElementById('search-condition').value;
  const minYear   = document.getElementById('search-min-year').value;
  const maxYear   = document.getElementById('search-max-year').value;
  const minPrice  = document.getElementById('search-min-price').value;
  const maxPrice  = document.getElementById('search-max-price').value;
  const bodyStyle = document.getElementById('search-body').value;

  if (!zip) {
    showError('Please enter a ZIP code to search.');
    return;
  }

  const trim       = document.getElementById('search-trim') ? document.getElementById('search-trim').value.trim() : '';
  const fuel       = document.getElementById('search-fuel') ? document.getElementById('search-fuel').value : '';
  const drive      = document.getElementById('search-drive') ? document.getElementById('search-drive').value : '';
  const maxMileage = document.getElementById('search-max-mileage') ? document.getElementById('search-max-mileage').value : '';
  const params = { zip, distance: radius };
  if (make)      params['make']      = make;
  if (model)     params['model']     = model;
  if (condition) params['condition'] = condition;
  if (trim)      params['trim']      = trim;
  if (minPrice)  params['minPrice']  = minPrice;
  if (maxPrice)  params['maxPrice']  = maxPrice;
  if (bodyStyle) params['bodyStyle'] = bodyStyle;
  if (minYear)   params['minYear']   = minYear;
  if (maxYear)   params['maxYear']   = maxYear;
  if (fuel)      params['fuelType']  = fuel;
  if (drive)     params['driveType'] = drive;

  saveRecentSearch(make, model, trim, condition, zip, radius, bodyStyle);

  setLoading(true);

  clearError();

  try {
    const fetchLimit = 100;
    let records, totalResultCount_raw;

    if (!condition) {
      // "All Cars" — auto.dev only returns one condition type per request,
      // so fire new + used in parallel and merge by VIN.
      const [newData, usedData] = await Promise.all([
        fetchInventory({ ...params, condition: 'new' },  page, fetchLimit).catch(() => ({})),
        fetchInventory({ ...params, condition: 'used' }, page, fetchLimit).catch(() => ({})),
      ]);
      const newRecs  = newData.records  || newData.listings  || newData.data  || [];
      const usedRecs = usedData.records || usedData.listings || usedData.data || [];
      const seen = new Set();
      records = [];
      for (const r of [...newRecs, ...usedRecs]) {
        const key = r.vin || (r.year + '|' + r.make + '|' + r.model + '|' + r.trim + '|' + (r.price || r.priceUnformatted));
        if (!seen.has(key)) { seen.add(key); records.push(r); }
      }
      totalResultCount_raw = (newData.totalCount || 0) + (usedData.totalCount || 0);
    } else {
      const data = await fetchInventory(params, page, fetchLimit);
      records = data.data || data.listings || data.records || [];
      totalResultCount_raw = data.totalCount || records.length;
    }

    totalResultCount = totalResultCount_raw || records.length;

    if (!Array.isArray(records) || records.length === 0) {
      allCars = [];
      totalResultCount = 0;
      document.getElementById('api-status-badge').style.display = 'none';
      document.getElementById('grid-label').textContent = 'No results';
      showError('No listings found. Try a wider radius, different make, or adjust your filters.');
    } else {
      let normalized = records.map(normalizeListing);

      // Client-side trim filtering (fallback in case API doesn't filter by trim)
      if (trim) {
        const tl = trim.toLowerCase();
        const tlWords = new Set(tl.split(/\s+/).filter(function(w){ return w.length > 0; }));
        const trimMatches = normalized.filter(function(c) {
          const rt = (c.trimRaw || '').toLowerCase();
          if (rt === tl) return true;
          // Result trim must contain the selected trim (not the other way around — avoids false positives)
          if (rt.includes(tl)) return true;
          // All words in the selected trim must appear as whole words in the result trim
          const rtWords = new Set(rt.split(/\s+/).filter(function(w){ return w.length > 0; }));
          return [...tlWords].every(function(w){ return rtWords.has(w); });
        });
        if (trimMatches.length > 0) {
          normalized = trimMatches;
        }
      }

      // Client-side condition filtering
      if (condition) {
        normalized = normalized.filter(function(c) { return c.condition === condition; });
      }

      // Client-side year filtering (fallback in case API ignores minYear/maxYear)
      const minYearInt = parseInt(minYear) || 0;
      const maxYearInt = parseInt(maxYear) || 9999;
      if (minYearInt) normalized = normalized.filter(function(c) { return c.year >= minYearInt; });
      if (maxYearInt < 9999) normalized = normalized.filter(function(c) { return c.year <= maxYearInt; });

      // Client-side mileage filtering
      const maxMileageInt = parseInt(maxMileage) || 0;
      if (maxMileageInt) normalized = normalized.filter(function(c) { return !c.mileageRaw || c.mileageRaw <= maxMileageInt; });

      // Client-side fuel type filtering (fallback)
      if (fuel) {
        const fl = fuel.toLowerCase();
        normalized = normalized.filter(function(c) {
          return (c.fuel || '').toLowerCase().includes(fl) || (fl === 'electric' && (c.type === 'ev' || (c.fuel||'').toLowerCase().includes('bev')));
        });
      }

      // Client-side drivetrain filtering (fallback)
      if (drive) {
        const dl = drive.toLowerCase();
        normalized = normalized.filter(function(c) {
          return (c.drivetrain || '').toLowerCase().includes(dl);
        });
      }

      // Compute deal ratings based on price vs avg for same make/model/year
      computeDealRatings(normalized);

      allCars = normalized;
      patchRecentSearchImages(allCars);
      isLiveData = true;
      populateYearFilters(allCars);
      const badge = document.getElementById('api-status-badge');
      badge.textContent = 'LIVE';
      badge.className = 'live-badge live';
      badge.style.display = '';
      document.getElementById('grid-label').textContent =
        `Live Inventory  ${zip} ${parseInt(radius) >= 5000 ? '  Nationwide' : 'within ' + radius + ' miles'}`;
    }
  } catch (e) {
    allCars = [];
    totalResultCount = 0;
    document.getElementById('api-status-badge').style.display = 'none';
    document.getElementById('grid-label').textContent = 'No results';
    showError(`Could not load inventory: ${e.message}. Please try again.`);
  } finally {
    setLoading(false);
    applyFilter(currentFilter);
    // Re-render selection bar so chips from previous searches stay visible
    if (window.selectedCars && window.selectedCars.size > 0 && window.renderSelectionBar) {
      window.renderSelectionBar();
    }
  }
}

function changePage(dir) { runSearch(currentPage + dir); }

// Deal rating: compare each car's price to avg for same make+model+year in result set
function normTrim(t) { return (t || '').trim().toUpperCase().replace(/\s+/g, ' '); }
function groupAvg(map, key) {
  const g = map[key];
  return (g && g.length >= 2) ? g.reduce(function(s, p) { return s + p; }, 0) / g.length : null;
}

function computeDealRatings(cars) {
  const byTrim  = {}; // name|year|trim|condition
  const byModel = {}; // name|year|condition (no trim)

  cars.forEach(function(c) {
    if (!c.msrp) return;
    const cond = c.condition === 'new' ? 'new' : 'used';
    const kt = c.name + '|' + c.year + '|' + normTrim(c.trim) + '|' + cond;
    const km = c.name + '|' + c.year + '|' + cond;
    if (!byTrim[kt])  byTrim[kt]  = [];
    if (!byModel[km]) byModel[km] = [];
    byTrim[kt].push(c.msrp);
    byModel[km].push(c.msrp);
  });

  // Condition-wide fallback pools
  const newPrices  = cars.filter(function(c) { return c.msrp > 0 && c.condition === 'new'; }).map(function(c) { return c.msrp; });
  const usedPrices = cars.filter(function(c) { return c.msrp > 0 && c.condition !== 'new'; }).map(function(c) { return c.msrp; });
  const newAvg  = newPrices.length  ? newPrices.reduce(function(s, p)  { return s + p; }, 0) / newPrices.length  : 0;
  const usedAvg = usedPrices.length ? usedPrices.reduce(function(s, p) { return s + p; }, 0) / usedPrices.length : 0;

  cars.forEach(function(c) {
    if (!c.msrp) { c.dealRating = null; c.marketAvg = null; c.marketAvgBasis = null; return; }
    const cond = c.condition === 'new' ? 'new' : 'used';
    const kt = c.name + '|' + c.year + '|' + normTrim(c.trim) + '|' + cond;
    const km = c.name + '|' + c.year + '|' + cond;
    const condFallback = cond === 'new' ? newAvg : usedAvg;

    let avg, basis;
    const trimAvg  = groupAvg(byTrim,  kt);
    const modelAvg = groupAvg(byModel, km);

    if (trimAvg !== null)        { avg = trimAvg;   basis = 'trim'; }
    else if (modelAvg !== null)  { avg = modelAvg;  basis = 'model'; }
    else if (condFallback)       { avg = condFallback; basis = 'condition'; }
    else                         { c.dealRating = null; c.marketAvg = null; c.marketAvgBasis = null; return; }

    c.marketAvg      = Math.round(avg);
    c.marketAvgBasis = basis;
    const pct = (c.msrp - avg) / avg;
    if (pct <= -0.10)      c.dealRating = 'great';
    else if (pct <= -0.04) c.dealRating = 'good';
    else if (pct <= 0.05)  c.dealRating = 'fair';
    else                   c.dealRating = 'high';
  });
}

// Monthly payment: 10% down, 7% APR, 60-month term
function monthlyPayment(price) {
  if (!price || price <= 0) return null;
  const principal = price * 0.90;
  const r = 0.07 / 12;
  const n = 60;
  return Math.round(principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
}

//  FILTER & RENDER 
function populateYearFilters(cars) {
  const resultYears = [...new Set(cars.map(c => c.year).filter(Boolean))];
  // Combine result years with a full range 2015-2026
  const allYears = [...new Set([...resultYears, 2026,2025,2024,2023,2022,2021,2020,2019,2018,2017,2016,2015])].sort((a,b) => b-a);
  const minSel = document.getElementById('search-min-year');
  const maxSel = document.getElementById('search-max-year');
  if (!minSel || !maxSel) return;

  const currentMin = minSel.value;
  const currentMax = maxSel.value;

  const minOpts = ['<option value="">Min Year</option>',
    ...allYears.map(y => `<option value="${y}"${y==currentMin?'selected':''}>${y}</option>`)
  ].join('');
  const maxOpts = ['<option value="">Max Year</option>',
    ...allYears.map(y => `<option value="${y}"${y==currentMax?'selected':''}>${y}</option>`)
  ].join('');

  minSel.innerHTML = minOpts;
  maxSel.innerHTML = maxOpts;

  minSel.onchange = () => applyFilter(currentFilter);
  maxSel.onchange = () => applyFilter(currentFilter);
}

function setSort(sort, btn) {
  currentSort = sort;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter(currentFilter);
}

function sortCars(cars) {
  const sorted = [...cars];
  switch(currentSort) {
    case 'price-asc':  return sorted.sort((a,b) => (a.msrp||Infinity) - (b.msrp||Infinity));
    case 'price-desc': return sorted.sort((a,b) => (b.msrp||0) - (a.msrp||0));
    case 'year-desc':  return sorted.sort((a,b) => b.year - a.year);
    case 'year-asc':   return sorted.sort((a,b) => a.year - b.year);
    case 'mileage-asc':return sorted.sort((a,b) => (a.mileageRaw||Infinity) - (b.mileageRaw||Infinity));
    case 'distance-asc':return sorted.sort((a,b) => (a.distanceMi||Infinity) - (b.distanceMi||Infinity));
    default:           return sorted;
  }
}

function filterLocal(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  applyFilter(type);
}

function applyColorFilter() {
  applyFilter(currentFilter || 'all');
}

function applyFilter(type) {
  const minYear = parseInt(document.getElementById('search-min-year')?.value) || 0;
  const maxYear = parseInt(document.getElementById('search-max-year')?.value) || 9999;
  const colorSel = (document.getElementById('color-filter')?.value || '').trim();
  let base = type === 'all' ? allCars : allCars.filter(c => c.type === type);
  if (minYear) base = base.filter(c => c.year >= minYear);
  if (maxYear < 9999) base = base.filter(c => c.year <= maxYear);
  if (colorSel) base = base.filter(c => c.colorFamily === colorSel);
  filteredCars = sortCars(base);
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('inventory-grid');
  const withInc = 0; // incentives removed
  const avgSavings = 0;
  const dealers = new Set(filteredCars.map(c=>c.dealer)).size;

  document.getElementById('stat-count').textContent = totalResultCount > filteredCars.length ? totalResultCount.toLocaleString() : filteredCars.length;
  const newCount  = filteredCars.filter(c=>c.condition==='new').length;
  const usedCount = filteredCars.filter(c=>c.condition!=='new').length;
  const statNew  = document.getElementById('stat-new');  if(statNew)  statNew.textContent  = newCount;
  const statUsed = document.getElementById('stat-used'); if(statUsed) statUsed.textContent = usedCount;
  const statInc  = document.getElementById('stat-inc');  if(statInc)  statInc.textContent  = newCount;
  const statSav  = document.getElementById('stat-savings'); if(statSav) statSav.textContent = usedCount;
  document.getElementById('stat-dealers').textContent = dealers;
  document.getElementById('grid-label').style.display = 'flex';
  grid.style.display = 'grid';
  const sortBar = document.getElementById('sort-bar');
  if (sortBar) sortBar.style.display = 'flex';
  const sortSummary = document.getElementById('sort-summary');
  if (sortSummary) {
    const priced = filteredCars.filter(c => c.msrp > 0);
    const avgPrice = priced.length ? Math.round(priced.reduce((s,c)=>s+c.msrp,0)/priced.length) : 0;
    const displayCount = totalResultCount > filteredCars.length ? totalResultCount.toLocaleString() : filteredCars.length;
    sortSummary.innerHTML = `<strong>${displayCount}</strong> vehicles${avgPrice ? '  avg. price <strong>'+fmt(avgPrice)+'</strong>' : ''}`;
  }

  if (!filteredCars.length) {
    grid.innerHTML = `<div class="empty-state"><p style="font-size:2rem;margin-bottom:1rem"></p><p>No vehicles match this filter.</p></div>`;
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  grid.innerHTML = filteredCars.map((car, carIdx) => {
    const photos = (car.allPhotos && car.allPhotos.length ? car.allPhotos : (car.img ? [car.img] : [])).slice(0, 5);
    const cid = escHtml(JSON.stringify(String(car.id)));
    let carouselHtml;
    if (photos.length === 0) {
      carouselHtml = `<div class="car-emoji-ph">${NO_IMG_MD}</div>`;
    } else {
      const imgs = photos.map((url, i) =>
        `<img src="${escHtml(url)}" alt="${escHtml(car.name)}" loading="${i === 0 ? 'eager' : 'lazy'}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:${i===0?1:0};transition:opacity 0.25s" onerror="this.style.display='none'">`
      ).join('');
      const dots = photos.length > 1 ? `<div class="cc-dots">${photos.map((_,i)=>`<span class="cc-dot${i===0?' active':''}" onclick="cardCarouselGo(event,${carIdx},0,${i})"></span>`).join('')}</div>` : '';
      const arrows = photos.length > 1 ? `
        <button class="cc-arrow cc-prev" onclick="cardCarouselGo(event,${carIdx},-1)" aria-label="Previous photo">&#8249;</button>
        <button class="cc-arrow cc-next" onclick="cardCarouselGo(event,${carIdx},1)" aria-label="Next photo">&#8250;</button>` : '';
      carouselHtml = `<div class="card-carousel" data-idx="0" data-cc="${carIdx}" style="position:relative;width:100%;height:100%">${imgs}${arrows}${dots}</div>`;
    }
    const dropBadge = car.recentPriceDrop
      ? `<span class="price-drop-badge">↓ Price Dropped</span>`
      : '';
    const daysBadge = car.daysOnLot !== null && car.daysOnLot >= 30
      ? `<span class="days-badge ${car.daysOnLot >= 60 ? 'hot' : 'warm'}">${car.daysOnLot >= 60 ? '⏰' : '🕐'} ${car.daysOnLot}d on lot</span>`
      : '';
    const dealBadgeMap = { great: ['★ Great Deal', 'great'], good: ['✓ Good Deal', 'good'], fair: ['Fair Price', 'fair'], high: ['↑ High Price', 'high'] };
    const dealBadgeData = car.dealRating && dealBadgeMap[car.dealRating];
    const dealBadgeHtml = dealBadgeData ? `<span class="deal-badge ${dealBadgeData[1]}">${dealBadgeData[0]}</span>` : '';
    const pmt = monthlyPayment(car.msrp);
    const pmtHtml = pmt ? `<div class="monthly-pay">~${fmt(pmt)}/mo est.</div>` : '';
    const isSelected = window.selectedCars && window.selectedCars.has(String(car.id));
    return `
    <div class="car-card${isSelected?' selected':''}" onclick="openDetail(${cid})">
      <div class="car-img" style="overflow:hidden">
        <div class="card-select-wrap" onclick="event.stopPropagation()">
          <button class="card-heart-btn${isSelected?' selected':''}" data-id="${escHtml(String(car.id))}" onclick="toggleSelect(event,'${escHtml(String(car.id))}')" title="${isSelected?'Remove from selection':'Add to selection'}">
            ${isSelected ? '♥' : '♡'}
          </button>
        </div>
        ${carouselHtml}${daysBadge}${dropBadge}
      </div>
      <div class="car-body">
        <span class="src-tag ${car.isLive?'live':'demo'}">${car.isLive?' LIVE':' DEMO'}</span>
        ${dealBadgeHtml}
        <div class="car-meta">
          <div>
            <div class="car-name">${escHtml(car.year+' '+car.name)}</div>
            <div class="car-trim">${escHtml(car.trim)}</div>
          </div>
          <div class="msrp-b">
            <div class="msrp-lbl">PRICE</div>
            <div class="msrp-val">${car.priceLabel ? `<span style="font-size:12px;font-family:Inter,sans-serif;color:var(--ink3)">${car.priceLabel}</span>` : fmt(car.msrp)}</div>
            ${pmtHtml}
          </div>
        </div>
        <div class="car-specs">${car.specs.map(s=>`<span class="spec-tag">${escHtml(s)}</span>`).join('')}</div>
        <div class="car-specs">
          <span class="spec-tag"> ${escHtml(car.dealer)}</span>
          ${car.dealerCity?`<span class="spec-tag">${escHtml(car.dealerCity)}</span>`:''}
        </div>
        <div class="card-actions">
          <button class="offer-btn" onclick="event.stopPropagation();openOffer(${escHtml(JSON.stringify(String(car.id)))})">Make an Offer </button>
          <a class="intel-btn" href="/deal-intelligence.html?${new URLSearchParams(Object.assign({vin:car.vin||'',year:car.year,make:car.name.split(' ')[0],model:car.name.split(' ').slice(1).join(' '),trim:car.trim||'',price:car.msrp||0,mileage:car.mileageRaw||0,condition:car.condition==='certified'?'cpo':(car.condition||'used')},car.history?{accidents:car.history.accidentCount||0,oneOwner:car.history.oneOwner?'1':'0',ownerCount:car.history.ownerCount||0,personalUse:car.history.personalUse?'1':'0',usageType:car.history.usageType||''}:{})).toString()}" onclick="event.stopPropagation()"> Intel</a>
        </div>
        ${car.vin ? `<div class="card-history-links" onclick="event.stopPropagation()">
          <a href="${car.carfaxUrl}" target="_blank" rel="noopener" class="history-link carfax-link">
            <img src="https://static.carfax.com/global-header/imgs/logo.svg" alt="Carfax" height="11" style="display:block;filter:none" onerror="this.outerHTML='Carfax'">
          </a>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  if (isLiveData) {
    document.getElementById('pagination').classList.remove('hidden');
    const totalPages = Math.ceil(totalResultCount / PAGE_SIZE) || 1;
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prev-btn').disabled = currentPage <= 1;
    document.getElementById('next-btn').disabled = currentPage >= totalPages;
  } else {
    document.getElementById('pagination').classList.add('hidden');
  }
}

//  UI HELPERS 
function setLoading(on) {
  document.getElementById('loading-area').style.display = on ? 'block' : 'none';
  document.getElementById('inventory-grid').style.display = on ? 'none' : 'grid';
  document.getElementById('search-btn').disabled = on;
  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = 'none';
}
function showError(msg) {
  document.getElementById('error-area').innerHTML =
    `<div class="error-box"> ${escHtml(msg)}</div>`;
}
function clearError() { document.getElementById('error-area').innerHTML = ''; }

//  DETAIL MODAL 
let detailCar = null;
let galleryPhotos = [];
let galleryIdx = 0;

async function openDetail(carId) {
  detailCar = allCars.find(c => String(c.id) === String(carId));
  if (!detailCar) return;

  // Reset modal
  document.getElementById('gallery-main').innerHTML = `<div class="no-img">${NO_IMG_LG}</div>`;
  document.getElementById('gallery-thumbs').innerHTML = '';
  document.getElementById('detail-title').textContent = `${detailCar.year} ${detailCar.name}`;
  document.getElementById('detail-subtitle').textContent = [detailCar.trim, detailCar.dealer, detailCar.dealerCity].filter(Boolean).join('  ');
  document.getElementById('detail-price').textContent = detailCar.priceLabel || (detailCar.msrp ? fmt(detailCar.msrp) : '');
  document.getElementById('detail-price').className = 'detail-price' + (detailCar.priceLabel ? ' noprice' : '');
  document.getElementById('detail-intel-loading').style.display = 'flex';
  document.getElementById('detail-intel-rows').style.display = 'none';
  document.getElementById('detail-history-card').style.display = 'none';

  // Vehicle detail rows
  const mileageStr = detailCar.mileageRaw > 0 ? Math.round(detailCar.mileageRaw).toLocaleString() + ' mi' : '';
  document.getElementById('detail-vehicle-rows').innerHTML = [
    ['Year',           detailCar.year],
    ['Make',           detailCar.name.split(' ')[0]],
    ['Model',          detailCar.name.split(' ').slice(1).join(' ')],
    ['Trim',           detailCar.trimRaw || detailCar.trim?.split('  ')[0] || ''],
    ['Body Style',     detailCar.bodyStyle || ''],
    ['Condition',      detailCar.condition ? detailCar.condition.charAt(0).toUpperCase()+detailCar.condition.slice(1) : ''],
    ['Mileage',        mileageStr],
    ['Exterior Color', detailCar.color || ''],
    ['Engine',         detailCar.engine || ''],
    ['Horsepower',     ''],  // filled in by renderIntelligence
    ['Transmission',   detailCar.transmission || ''],
    ['Drivetrain',     detailCar.drivetrain || ''],
    ['Fuel Type',      detailCar.fuel || ''],
    ['MPG',            ''],  // filled in by renderIntelligence
    ['VIN',            detailCar.vin || ''],
  ].filter(([,v]) => v).map(([l,v]) =>
    `<div class="detail-row" id="dvr-${l.replace(/\s+/g,'-').toLowerCase()}"><span class="detail-row-label">${l}</span><span class="detail-row-val">${escHtml(String(v))}</span></div>`
  ).join('');

  // Dealer rows
  const daysOnLotStr = detailCar.daysOnLot !== null && detailCar.daysOnLot >= 0
    ? (detailCar.daysOnLot === 0 ? 'Listed today' : detailCar.daysOnLot + ' days' + (detailCar.daysOnLot >= 60 ? ' ⏰ motivated seller' : detailCar.daysOnLot >= 30 ? ' — price negotiable' : ''))
    : '';
  const dealerSiteLink = dealerSearchUrl(detailCar);
  const dealerDomainDisplay = detailCar.dealerDomain && detailCar.dealerDomain !== 'dealer.com' ? detailCar.dealerDomain : null;
  const dealerRows = [
    ['Dealer',   detailCar.dealer],
    ['Location', detailCar.dealerCity || ''],
    ['Distance', detailCar.distanceMi ? detailCar.distanceMi + ' miles' : ''],
    ['Days on Lot', daysOnLotStr],
  ].filter(([,v]) => v).map(([l,v]) =>
    `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-val">${escHtml(String(v))}</span></div>`
  ).join('');

  // Dealer website link row
  const dealerWebRow = dealerSiteLink && dealerDomainDisplay ? `
    <div class="detail-row">
      <span class="detail-row-label">Website</span>
      <span class="detail-row-val">
        <a href="${escHtml(dealerSiteLink)}" target="_blank" rel="noopener"
           style="color:var(--orange);text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:4px">
          ${escHtml(dealerDomainDisplay)}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
        ${!detailCar.listingUrl && detailCar.vin ? `<span style="font-size:10px;color:var(--ink3);margin-left:6px">search by VIN</span>` : ''}
      </span>
    </div>` : '';

  const historyBtns = detailCar.vin ? `
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <a href="${escHtml(detailCar.carfaxUrl)}" target="_blank" rel="noopener" class="history-report-btn carfax-btn">
        <img src="https://static.carfax.com/global-header/imgs/logo.svg" alt="Carfax" height="14" style="display:block" onerror="this.outerHTML='Carfax Report'">
      </a>
    </div>` : '';
  document.getElementById('detail-dealer-rows').innerHTML = dealerRows + dealerWebRow + historyBtns;

  // View Listing button — show whenever we have any dealer link
  const listingBtn = document.getElementById('btn-detail-listing');
  if (listingBtn) {
    if (dealerSiteLink) {
      listingBtn.href = dealerSiteLink;
      listingBtn.textContent = detailCar.listingUrl ? 'View Listing' : 'Find on Dealer Site';
      listingBtn.style.display = '';
    } else {
      listingBtn.style.display = 'none';
    }
  }

  // Wire up Deal Intelligence button with car data
  const intelBtn = document.getElementById('btn-detail-intel');
  if (intelBtn && detailCar.vin) {
    const make  = detailCar.name.split(' ')[0];
    const model = detailCar.name.split(' ').slice(1).join(' ');
    const historyParams = detailCar.history ? {
      accidents: detailCar.history.accidentCount || 0,
      oneOwner: detailCar.history.oneOwner ? '1' : '0',
      ownerCount: detailCar.history.ownerCount || 0,
      personalUse: detailCar.history.personalUse ? '1' : '0',
      usageType: detailCar.history.usageType || '',
    } : {};
    intelBtn.href = '/deal-intelligence.html?' + new URLSearchParams(Object.assign({
      vin: detailCar.vin, year: detailCar.year, make, model,
      trim: detailCar.trimRaw || '', price: detailCar.msrp || 0,
      mileage: detailCar.mileageRaw || 0,
      condition: detailCar.condition === 'certified' ? 'cpo' : (detailCar.condition || 'used'),
    }, historyParams)).toString();
  }

  // Photo gallery
  if (detailCar.allPhotos && detailCar.allPhotos.length > 0) {
    renderGallery(detailCar.allPhotos);
  } else if (detailCar.img) {
    renderGallery([detailCar.img]);
  }

  document.getElementById('detail-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Fetch vehicle intelligence if we have a VIN
  if (detailCar.vin) {
    fetchVehicleIntelligence(detailCar.vin);
    fetchPriceHistory(detailCar.vin);
  } else {
    document.getElementById('detail-intel-loading').style.display = 'none';
    document.getElementById('detail-intel-rows').innerHTML = '<div style="font-size:12px;color:var(--ink3)">No VIN available for market data.</div>';
    document.getElementById('detail-intel-rows').style.display = 'block';
  }
}

async function fetchPriceHistory(vin) {
  try {
    const res = await fetch('/api/price-history?vin=' + encodeURIComponent(vin));
    if (!res.ok) return;
    const data = await res.json();
    renderPriceHistory(data.history || []);
  } catch(e) {
    // silently skip
  }
}

function renderPriceHistory(history) {
  const card = document.getElementById('detail-history-card');
  const list = document.getElementById('detail-price-history');
  if (!card || !list || history.length < 2) return;

  // Only show if there were actual price changes
  const prices = history.map(h => h.price);
  const hasChanges = prices.some(p => p !== prices[0]);
  if (!hasChanges) return;

  card.style.display = 'block';
  list.innerHTML = history.map((h, i) => {
    const prev = i > 0 ? history[i - 1].price : null;
    const delta = prev !== null ? h.price - prev : 0;
    const cls = delta < 0 ? 'drop' : delta > 0 ? 'rise' : '';
    const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '';
    const deltaStr = delta !== 0 ? ` ${arrow}${fmt(Math.abs(delta))}` : '';
    const dateStr = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `<div class="price-change">
      <span class="price-change-date">${dateStr}</span>
      <span class="price-change-val ${cls}">${fmt(h.price)}${deltaStr ? `<span style="font-size:10px;margin-left:4px">${deltaStr}</span>` : ''}</span>
    </div>`;
  }).join('');
}

function renderGallery(photos) {
  galleryPhotos = photos.slice(0, 30);
  galleryIdx = 0;
  _renderGalleryFrame();

  const thumbs = document.getElementById('gallery-thumbs');
  thumbs.innerHTML = '';
  if (galleryPhotos.length > 1) {
    galleryPhotos.forEach(function(url, i) {
      const div = document.createElement('div');
      div.className = i === 0 ? 'gallery-thumb active' : 'gallery-thumb';
      div.onclick = function() { galleryGoTo(i); };
      const tImg = document.createElement('img');
      tImg.src = url;
      tImg.alt = 'Photo ' + (i + 1);
      tImg.loading = 'lazy';
      tImg.onerror = function() { div.style.display = 'none'; };
      div.appendChild(tImg);
      thumbs.appendChild(div);
    });
  }
}

function _renderGalleryFrame() {
  const main = document.getElementById('gallery-main');
  main.style.position = 'relative';
  main.innerHTML = '';

  const img = document.createElement('img');
  img.src = galleryPhotos[galleryIdx];
  img.alt = 'Vehicle photo ' + (galleryIdx + 1);
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
  img.onerror = function() { this.style.display = 'none'; };
  main.appendChild(img);

  if (galleryPhotos.length > 1) {
    const prev = document.createElement('button');
    prev.className = 'gallery-nav-btn prev';
    prev.innerHTML = '&#8249;';
    prev.onclick = function(e) { e.stopPropagation(); galleryGo(-1); };
    main.appendChild(prev);

    const next = document.createElement('button');
    next.className = 'gallery-nav-btn next';
    next.innerHTML = '&#8250;';
    next.onclick = function(e) { e.stopPropagation(); galleryGo(1); };
    main.appendChild(next);

    const counter = document.createElement('div');
    counter.className = 'gallery-counter';
    counter.textContent = (galleryIdx + 1) + ' / ' + galleryPhotos.length;
    main.appendChild(counter);
  }
}

function galleryGo(dir) {
  galleryIdx = (galleryIdx + dir + galleryPhotos.length) % galleryPhotos.length;
  _renderGalleryFrame();
  const thumbs = document.querySelectorAll('.gallery-thumb');
  thumbs.forEach(function(t, i) { t.classList.toggle('active', i === galleryIdx); });
  const activeTh = thumbs[galleryIdx];
  if (activeTh) activeTh.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function galleryGoTo(idx) {
  galleryIdx = idx;
  _renderGalleryFrame();
  document.querySelectorAll('.gallery-thumb').forEach(function(t, i) { t.classList.toggle('active', i === idx); });
}

function switchPhoto(url, thumbEl) {
  const idx = galleryPhotos.indexOf(url);
  if (idx >= 0) { galleryGoTo(idx); return; }
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Vehicle photo';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
  img.onerror = function() { this.style.display = 'none'; };
  const main = document.getElementById('gallery-main');
  main.innerHTML = '';
  main.appendChild(img);
  document.querySelectorAll('.gallery-thumb').forEach(t => t.classList.remove('active'));
  thumbEl.classList.add('active');
}

async function fetchVehicleIntelligence(vin) {
  if (!detailCar) return;
  try {
    const make  = detailCar.name.split(' ')[0];
    const model = detailCar.name.split(' ').slice(1).join(' ');
    const params = new URLSearchParams({
      make, model,
      year:      detailCar.year,
      trim:      detailCar.trimRaw || '',
      condition: detailCar.condition === 'certified' ? 'cpo' : (detailCar.condition || 'used'),
      price:     detailCar.msrp || 0,
      mileage:   detailCar.mileageRaw || 0,
    });
    const [compResult, vinResult] = await Promise.allSettled([
      fetch('/api/comparables?' + params.toString()),
      vin ? fetch('/api/vin-decode?vin=' + encodeURIComponent(vin)) : Promise.reject(),
    ]);
    const compData = compResult.status === 'fulfilled' && compResult.value.ok
      ? await compResult.value.json() : {};
    const vinData  = vinResult.status  === 'fulfilled' && vinResult.value.ok
      ? await vinResult.value.json()  : null;
    renderIntelligence(compData, vinData);
  } catch(e) {
    document.getElementById('detail-intel-loading').style.display = 'none';
    document.getElementById('detail-intel-rows').innerHTML = '<div style="font-size:12px;color:var(--ink3)">Market data unavailable for this vehicle.</div>';
    document.getElementById('detail-intel-rows').style.display = 'block';
  }
}

function updateDetailVehicleRow(labelId, value) {
  const el = document.getElementById('dvr-' + labelId);
  if (!value) return;
  if (el) {
    el.querySelector('.detail-row-val').textContent = value;
  } else {
    // Row wasn't rendered (value was empty) — insert before the VIN row
    const vinRow = document.getElementById('dvr-vin');
    if (vinRow) {
      const label = labelId.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      const div = document.createElement('div');
      div.className = 'detail-row';
      div.id = 'dvr-' + labelId;
      div.innerHTML = `<span class="detail-row-label">${label}</span><span class="detail-row-val">${escHtml(String(value))}</span>`;
      vinRow.parentNode.insertBefore(div, vinRow);
    }
  }
}

function renderIntelligence(data, vinData) {
  document.getElementById('detail-intel-loading').style.display = 'none';
  const rows = document.getElementById('detail-intel-rows');

  // ── Inject VIN-decoded vehicle details ──────────────────────────────────────
  if (vinData) {
    // MPG
    if (vinData.mpg?.city || vinData.mpg?.highway) {
      const city = vinData.mpg.city || '?';
      const hwy  = vinData.mpg.highway || '?';
      updateDetailVehicleRow('mpg', `${city} city / ${hwy} hwy`);
    }

    // Horsepower
    if (vinData.engine?.horsepower) {
      updateDetailVehicleRow('horsepower', `${vinData.engine.horsepower} hp`);
    }

    // Enrich engine string if currently empty
    if (!detailCar.engine && vinData.engine?.name) {
      updateDetailVehicleRow('engine', vinData.engine.name);
    }

    // Number of doors
    if (vinData.numOfDoors) {
      updateDetailVehicleRow('doors', vinData.numOfDoors + '-door');
    }
  }

  // data is now from the comparables API: { comparables, stats }
  const stats = data.stats || {};
  const comps  = data.comparables || [];

  // Cache the API-sourced market avg on the car object so the offer modal can use it
  if (stats.avgPrice && detailCar) {
    detailCar.apiMarketAvg = Math.round(stats.avgPrice);
    // Also update the matching entry in allCars so the offer modal picks it up
    const inAll = allCars.find(c => String(c.id) === String(detailCar.id));
    if (inAll) inAll.apiMarketAvg = detailCar.apiMarketAvg;
  }

  // Cache real VIN invoice on car so the offer modal can use it
  const vinInvoice = vinData?.price?.baseInvoice || null;
  if (vinInvoice && detailCar) {
    detailCar.apiInvoice     = vinInvoice;
    detailCar.apiInvoiceType = detailCar.condition === 'new' ? 'Dealer Invoice' : 'Orig. Invoice (new)';
    const inAll2 = allCars.find(c => String(c.id) === String(detailCar.id));
    if (inAll2) { inAll2.apiInvoice = vinInvoice; inAll2.apiInvoiceType = detailCar.apiInvoiceType; }
  }

  const carPrice = detailCar.msrp || 0;
  const avg      = stats.avgPrice  || 0;
  const lo       = stats.minPrice  || 0;
  const hi       = stats.maxPrice  || 0;
  const vs       = carPrice && avg ? carPrice - avg : 0;
  const pos      = stats.pricePosition;

  // VIN price data
  const invoice    = vinData?.price?.baseInvoice   || null;
  const msrpVin    = vinData?.price?.baseMsrp      || null;
  const tmvRetail  = vinData?.price?.usedTmvRetail || null;
  const privParty  = vinData?.price?.usedPrivateParty || null;
  const tradeIn    = vinData?.price?.usedTradeIn   || null;

  // Price position label
  let posLabel = '', posClass = '';
  if (pos !== null && pos !== undefined) {
    if (pos <= 25)      { posLabel = 'Great Deal';   posClass = 'green'; }
    else if (pos <= 50) { posLabel = 'Good Price';   posClass = 'green'; }
    else if (pos <= 75) { posLabel = 'Fair Price';   posClass = 'orange'; }
    else                { posLabel = 'Above Market'; posClass = ''; }
  }

  let html = '';

  // Invoice / TMV / pricing section
  const isNew = detailCar?.condition === 'new';

  // Invoice — show real VIN data only; no estimates
  if (invoice) {
    const aboveInvoice = carPrice && invoice ? carPrice - invoice : null;
    const invoiceLabel = isNew ? 'Dealer Invoice' : 'Original Dealer Invoice';
    html += `<div class="detail-row"><span class="detail-row-label">${invoiceLabel}</span><span class="detail-row-val invoice">${fmt(invoice)}</span></div>`;
    if (aboveInvoice !== null) {
      const aboveLabel = aboveInvoice >= 0 ? `+${fmt(aboveInvoice)} above invoice` : `${fmt(Math.abs(aboveInvoice))} below invoice`;
      html += `<div class="detail-row"><span class="detail-row-label">Listed vs Invoice</span><span class="detail-row-val ${aboveInvoice > 0 ? '' : 'green'}">${aboveLabel}</span></div>`;
    }
    if (!isNew) {
      html += `<div class="invoice-note">Original factory invoice (what the dealer paid when new). A useful anchor — most used cars sell above original invoice.</div>`;
    }
  } else {
    html += `<div class="detail-row"><span class="detail-row-label">${isNew ? 'Dealer Invoice' : 'Original Dealer Invoice'}</span><span class="detail-row-val" style="color:var(--ink3)">N/A</span></div>`;
  }

  // Used / CPO additional VIN pricing
  if (!isNew) {
    if (tmvRetail) html += `<div class="detail-row"><span class="detail-row-label">Edmunds TMV Retail</span><span class="detail-row-val">${fmt(tmvRetail)}</span></div>`;
    if (privParty) html += `<div class="detail-row"><span class="detail-row-label">Private Party Value</span><span class="detail-row-val">${fmt(privParty)}</span></div>`;
    if (tradeIn)   html += `<div class="detail-row"><span class="detail-row-label">Trade-In Value</span><span class="detail-row-val">${fmt(tradeIn)}</span></div>`;
  }

  if (!stats.count || stats.count === 0) {
    if (!html) {
      rows.innerHTML = '<div style="font-size:12px;color:var(--ink3)">No comparable market data found for this vehicle.</div>';
      rows.style.display = 'block';
      return;
    }
    rows.innerHTML = html;
    rows.style.display = 'block';
    return;
  }

  html += [
    avg    ? ['Market Avg Price',   fmt(avg)]                                                         : null,
    lo     ? ['Market Price Range', `${fmt(lo)} – ${fmt(hi)}`]                                        : null,
    vs && carPrice ? ['vs. Market Avg', vs > 0 ? `+${fmt(vs)} above` : `${fmt(Math.abs(vs))} below`, vs > 0 ? '' : 'green'] : null,
    posLabel ? ['Price Position',  posLabel, posClass]                                                : null,
    stats.count ? ['Comparable Listings', `${stats.count} found nationwide`]                          : null,
    stats.avgMileage ? ['Avg Comparable Miles', Math.round(stats.avgMileage).toLocaleString() + ' mi'] : null,
  ].filter(Boolean).map(([l, v, cls = '']) =>
    `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-val ${cls}">${escHtml(String(v))}</span></div>`
  ).join('');

  // Price bar: where does this listing sit vs market range?
  if (lo && hi && carPrice) {
    const range     = hi - lo || 1;
    const markerPct = Math.max(0, Math.min(100, ((carPrice - lo) / range) * 100));
    html += `<div class="fair-price-bar" style="margin-top:10px">
      <div class="fair-price-label">This listing vs market range</div>
      <div class="fair-price-track" style="position:relative">
        <div class="fair-price-range" style="left:0%;width:100%"></div>
        <div class="fair-price-marker" style="left:${markerPct}%" title="This listing"></div>
      </div>
      <div class="fair-price-labels"><span>${fmt(lo)}</span><span>▲ avg ${fmt(avg)}</span><span>${fmt(hi)}</span></div>
    </div>`;
  }

  rows.innerHTML = html;
  rows.style.display = 'block';
}

function openOfferFromDetail() {
  if (!detailCar) return;
  closeModal('detail-overlay');
  openOffer(String(detailCar.id));
}

//  OFFER MODAL 
// Buyer profile helpers
let _pendingOfferCarId = null;

function getBuyerProfile() {
  try { return JSON.parse(localStorage.getItem('buyerProfile') || 'null'); } catch(e) { return null; }
}

function openOffer(carId) {
  const profile = getBuyerProfile();
  if (!profile) {
    _pendingOfferCarId = carId;
    document.getElementById('buyer-name').value = '';
    document.getElementById('buyer-email').value = '';
    document.getElementById('buyer-phone').value = '';
    const errEl = document.getElementById('verify-error');
    if (errEl) errEl.style.display = 'none';
    document.getElementById('verify-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('buyer-name').focus(), 100);
    return;
  }
  checkOfferPaywall(carId);
}

function saveBuyerProfile() {
  const name  = document.getElementById('buyer-name').value.trim();
  const email = document.getElementById('buyer-email').value.trim();
  const phone = document.getElementById('buyer-phone').value.trim();
  const errEl = document.getElementById('verify-error');

  if (!name) { errEl.textContent = 'Please enter your full name.'; errEl.style.display='block'; return; }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) { errEl.textContent = 'Please enter a valid email address.'; errEl.style.display='block'; return; }
  errEl.style.display = 'none';

  localStorage.setItem('buyerProfile', JSON.stringify({ name, email, phone }));
  closeModal('verify-overlay');
  if (_pendingOfferCarId) {
    const id = _pendingOfferCarId;
    _pendingOfferCarId = null;
    checkOfferPaywall(id);
  }
}

let _offerUnlocked = false;
let _offerConfig = null;
let _offerStripeInstance = null;
let _subscriptionActive = false;
let _selectedSubPlan = 'annual';

function activateSubscription(email) {
  _subscriptionActive = true;
  window._proSubscriptionActive = true;
  if (email) {
    try { localStorage.setItem('subEmail', email); } catch (_) {}
    sessionStorage.setItem('subEmail', email);
  }
  const manageBtn = document.getElementById('manage-sub-btn');
  const manageDivider = document.getElementById('manage-sub-divider');
  if (manageBtn) manageBtn.style.display = 'flex';
  if (manageDivider) manageDivider.style.display = 'block';
}

async function openManageSubscription() {
  const email = (() => { try { return localStorage.getItem('subEmail'); } catch(_) {} })()
    || sessionStorage.getItem('subEmail')
    || window.Clerk?.user?.primaryEmailAddress?.emailAddress;
  if (!email) { alert('No subscription found for your account.'); return; }
  try {
    const res = await fetch('/api/stripe/portal-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, returnUrl: window.location.href })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else alert(data.error || 'Could not open subscription portal. Please try again.');
  } catch { alert('Could not open subscription portal. Please try again.'); }
}

function buildPlanModal() {
  if (document.getElementById('plan-modal-overlay')) return;
  const el = document.createElement('div');
  el.id = 'plan-modal-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2000;display:none;align-items:center;justify-content:center;padding:16px';
  el.onclick = e => { if (e.target === el) closePlanModal(); };
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:560px;width:100%;padding:2rem 2rem 1.5rem;position:relative;box-shadow:0 24px 64px rgba(0,0,0,0.18)">
    <button onclick="closePlanModal()" style="position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:22px;color:#8A8A84;cursor:pointer;line-height:1;padding:2px 6px">&#x2715;</button>
    <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#1A1A18;letter-spacing:-0.3px;margin-bottom:4px">Get Started</div>
    <div style="font-size:13px;color:#4A4A46;margin-bottom:1.75rem">Choose the plan that's right for you. Upgrade or cancel anytime.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:1.25rem">
      <div onclick="selectPlanAndContinue('free')" style="border:2px solid #E8E8E2;border-radius:12px;padding:1.25rem;cursor:pointer;display:flex;flex-direction:column" onmouseover="this.style.borderColor='#D0D0C8'" onmouseout="this.style.borderColor='#E8E8E2'">
        <div style="font-size:14px;font-weight:700;color:#1A1A18;margin-bottom:4px">Free</div>
        <div style="font-size:28px;font-weight:700;color:#1A1A18;line-height:1;margin-bottom:2px">$0</div>
        <div style="font-size:11px;color:#8A8A84;margin-bottom:14px">forever</div>
        <ul style="list-style:none;padding:0;margin:0;font-size:12px;color:#4A4A46;display:flex;flex-direction:column;gap:7px;flex:1">
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Live inventory searches</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Market intelligence</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#D0D0C8;flex-shrink:0">–</span>Deal Intelligence reports ($9.99 ea.)</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#D0D0C8;flex-shrink:0">–</span>Trade Intelligence reports ($9.99 ea.)</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#D0D0C8;flex-shrink:0">–</span>Offer submissions ($9.99 ea.)</li>
        </ul>
        <button style="width:100%;background:transparent;border:1.5px solid #D0D0C8;color:#4A4A46;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;padding:10px;border-radius:8px;cursor:pointer;margin-top:16px">Continue Free</button>
      </div>
      <div onclick="selectPlanAndContinue('pro')" style="border:2px solid #C95E1A;border-radius:12px;padding:1.25rem;cursor:pointer;background:#FBF0E8;position:relative;display:flex;flex-direction:column" onmouseover="this.style.background='#f5e8d8'" onmouseout="this.style.background='#FBF0E8'">
        <div style="position:absolute;top:-1px;right:14px;background:#C95E1A;color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:0 0 6px 6px;letter-spacing:0.8px">BEST VALUE</div>
        <div style="font-size:14px;font-weight:700;color:#1A1A18;margin-bottom:4px">Pro</div>
        <div style="font-size:28px;font-weight:700;color:#C95E1A;line-height:1;margin-bottom:2px">$20<span style="font-size:13px;font-weight:400;color:#D97230">/mo</span></div>
        <div style="font-size:11px;color:#D97230;margin-bottom:14px">or $200/yr · 30-day free trial</div>
        <ul style="list-style:none;padding:0;margin:0;font-size:12px;color:#4A4A46;display:flex;flex-direction:column;gap:7px;flex:1">
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Unlimited Deal Intelligence reports</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Unlimited Trade Intelligence reports</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Unlimited offer submissions to dealers</li>
          <li style="display:flex;align-items:flex-start;gap:6px"><span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>Priority support</li>
        </ul>
        <button style="width:100%;background:#C95E1A;border:none;color:#fff;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;padding:10px;border-radius:8px;cursor:pointer;margin-top:16px">Start Free Trial</button>
      </div>
    </div>
    <div style="text-align:center;font-size:12px;color:#8A8A84">Already have an account? <a href="#" onclick="closePlanModal();try{window.Clerk.openSignIn();}catch(e){}return false" style="color:#C95E1A;text-decoration:none;font-weight:500">Sign in</a></div>
  </div>`;
  document.body.appendChild(el);
}
function openPlanModal() { buildPlanModal(); document.getElementById('plan-modal-overlay').style.display = 'flex'; }
function closePlanModal() { const el = document.getElementById('plan-modal-overlay'); if (el) el.style.display = 'none'; }
function selectPlanAndContinue(plan) {
  closePlanModal();
  if (plan === 'pro') { try { localStorage.setItem('pendingProUpgrade', '1'); } catch(_) {} }
  try { window.Clerk.openSignIn(); } catch(e) {}
}

function _showSubStatus(data) {
  const el = document.getElementById('pd-sub-status');
  if (!el) return;
  if (!data || !data.active) {
    el.textContent = 'Free Plan';
    el.style.display = 'inline-flex';
    el.style.color = '#6A6A64';
    el.style.background = '#F0F0EA';
    el.style.border = '1px solid #D0D0C8';
    return;
  }
  const plan = data.planInterval === 'year' ? 'Annual' : data.planInterval === 'month' ? 'Monthly' : 'Pro';
  let text;
  if (data.status === 'trialing' && data.trialEnd) {
    const days = Math.ceil((data.trialEnd * 1000 - Date.now()) / 86400000);
    text = `⭐ Pro Trial · ${Math.max(0, days)} day${days !== 1 ? 's' : ''} left`;
  } else if (data.currentPeriodEnd) {
    const date = new Date(data.currentPeriodEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    text = `⭐ Pro ${plan} · renews ${date}`;
  } else {
    text = `⭐ Pro ${plan}`;
  }
  el.textContent = text;
  el.style.display = 'inline-flex';
  el.style.color = 'var(--orange, #C95E1A)';
  el.style.background = 'var(--orange-light, #FBF0E8)';
  el.style.border = '1px solid rgba(201,94,26,0.2)';
}

async function verifySubscriptionByEmail(email) {
  try {
    const data = await fetch(`/api/stripe/subscription-status?email=${encodeURIComponent(email)}`).then(r => r.json());
    if (data.active) { activateSubscription(email); _showSubStatus(data); }
    return data.active;
  } catch { return false; }
}

function checkOfferPaywall(carId) {
  if (_subscriptionActive || _offerUnlocked) {
    openOfferModal(carId);
    return;
  }
  if (sessionStorage.getItem('offerUnlocked') === 'once') {
    sessionStorage.removeItem('offerUnlocked');
    _offerUnlocked = true;
    openOfferModal(carId);
    return;
  }
  _pendingOfferCarId = carId;
  document.getElementById('offer-pay-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// ── Subscription modal ────────────────────────────────────────────────────────
function openSubscribeModal() {
  if (_subscriptionActive) return;
  document.getElementById('subscribe-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeSubscribeModal() {
  document.getElementById('subscribe-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}
function selectSubPlan(plan) {
  _selectedSubPlan = plan;
  document.getElementById('sub-plan-monthly').classList.toggle('selected', plan === 'monthly');
  document.getElementById('sub-plan-annual').classList.toggle('selected', plan === 'annual');
  const btn = document.getElementById('sub-start-btn');
  if (btn) btn.textContent = plan === 'annual' ? 'Start Free Trial — Annual $200/yr' : 'Start Free Trial — Monthly $20/mo';
}
async function startSubscription() {
  const btn = document.getElementById('sub-start-btn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const cfg = await fetch('/api/stripe/config').then(r => r.json());
    const priceId = _selectedSubPlan === 'annual' ? cfg.annualPriceId : cfg.monthlyPriceId;
    const baseUrl = window.location.origin;
    const returnUrl = `${baseUrl}/?sub_success={CHECKOUT_SESSION_ID}`;
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId, successUrl: returnUrl, cancelUrl: baseUrl + '/' }),
    }).then(r => r.json());
    if (res.url) window.location.href = res.url;
    else { btn.disabled = false; btn.textContent = orig; }
  } catch {
    btn.disabled = false; btn.textContent = orig;
  }
}
async function promptCheckSubscription() {
  const email = window.prompt('Enter your subscription email to restore access:');
  if (!email) return;
  const active = await verifySubscriptionByEmail(email);
  if (active) {
    closeSubscribeModal();
    alert('✓ Subscription active! All paywalls are now bypassed.');
  } else {
    alert('No active subscription found for that email. Please subscribe or contact support.');
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
    condition ? ({new:'New',used:'Used',certified:'CPO'}[condition] || condition) : '',
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
      // Directly await populateTrims so we know it's finished before setting the value
      await populateTrims();
      const trimEl = document.getElementById('search-trim');
      if (trimEl) trimEl.value = r.trim;
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
    const condLabel = r.condition ? ({new:'New',used:'Used',certified:'CPO'}[r.condition] || r.condition) : 'All';
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

  if (!to || !subject || !body) { showToast('Missing email details'); return; }

  btn.disabled = true;
  label.textContent = 'Sending...';

  try {
    const res = await fetch('/api/send-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        dealerName,
        subject,
        body,
        buyerEmail: profile?.email || null,
        buyerName:  profile?.name  || null,
        buyerPhone: profile?.phone || null,
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
        ['Condition',    c => c.condition ? ({new:'New',used:'Used',certified:'CPO'}[c.condition]||c.condition) : '—'],
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
    // Prompt sign-in; works whether Clerk is loaded or not
    if (window.Clerk?.openSignIn) {
      try { window.Clerk.openSignIn(); return true; } catch(e) {}
    }
    alert('Please sign in to save vehicles to your favorites.');
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
    window.Clerk.session.getToken().then(token => {
      fetch('/api/user/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vin: car.vin || String(car.id), listingData: car })
      }).catch(() => {});
    }).catch(() => {});
  }

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
