// AutoNegotiating.com  app.js

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

//  DEMO FALLBACK DATA 
const DEMO_CARS = [
  {id:1,emoji:'',type:'sedan',name:'Toyota Camry XSE',year:2024,trim:'V6  Midnight Black',dealer:'Pacific Toyota',dealerEmail:'internet@pacifictoyota.com',dealerCity:'Portland, OR',msrp:35420,floor:31500,specs:['V6 301hp','AWD','Sunroof','JBL Audio'],stock:'PCT-8821',img:null,isLive:false},
  {id:2,emoji:'',type:'suv',name:'Honda CR-V Touring',year:2024,trim:'Hybrid  Sonic Gray',dealer:'Sunset Honda',dealerEmail:'inet@sunsethonda.com',dealerCity:'Beaverton, OR',msrp:42800,floor:38000,specs:['Hybrid 204hp','AWD','HUD','Honda Sensing'],stock:'SH-44219',img:null,isLive:false},
  {id:3,emoji:'',type:'ev',name:'Tesla Model Y LR',year:2024,trim:'AWD  Pearl White',dealer:'Tesla Portland',dealerEmail:'pdx@tesla.com',dealerCity:'Portland, OR',msrp:52990,floor:47500,specs:['358mi Range','AWD','Autopilot','20" Wheels'],stock:'TP-EV-9012',img:null,isLive:false},
  {id:4,emoji:'',type:'truck',name:'Ford F-150 XLT Sport',year:2024,trim:'5.0L V8  Carbonized Gray',dealer:'Columbia Ford',dealerEmail:'sales@columbiaford.com',dealerCity:'Vancouver, WA',msrp:51200,floor:45000,specs:['V8 400hp','4x4','Bed Liner','FordPass'],stock:'CF-F150-3391',img:null,isLive:false},
  {id:5,emoji:'',type:'luxury',name:'BMW 5 Series 530i',year:2024,trim:'xDrive  Alpine White',dealer:'Northwest BMW',dealerEmail:'internet@nwbmw.com',dealerCity:'Portland, OR',msrp:62800,floor:56000,specs:['255hp Turbo','xDrive','Gesture Ctrl','Ambient Light'],stock:'NWB-530-5518',img:null,isLive:false},
  {id:6,emoji:'',type:'suv',name:'Kia Telluride EX',year:2024,trim:'3.8L V6  Ebony Bamboo',dealer:'Kia Northwest',dealerEmail:'internet@kianw.com',dealerCity:'Hillsboro, OR',msrp:45990,floor:41000,specs:['291hp V6','AWD','3-Row','Harman Kardon'],stock:'KNW-TELL-6612',img:null,isLive:false},
  {id:7,emoji:'',type:'ev',name:'Hyundai IONIQ 6 SE',year:2024,trim:'AWD  Atlas White',dealer:'Hyundai of Portland',dealerEmail:'imanager@hyundaioregon.com',dealerCity:'Portland, OR',msrp:46400,floor:40500,specs:['320mi Range','AWD','V2L','800V Charging'],stock:'HOP-I6-0182',img:null,isLive:false},
  {id:8,emoji:'',type:'truck',name:'Chevy Silverado 1500 LTZ',year:2024,trim:'6.2L  Black',dealer:'Rose City Chevy',dealerEmail:'fleet@rosecitychevy.com',dealerCity:'Portland, OR',msrp:58900,floor:52000,specs:['420hp V8','4WD','MultiPro Bed','Bose Audio'],stock:'RCC-SIL-7751',img:null,isLive:false},
];

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

//  NORMALIZE AUTO.DEV V1 LISTING 
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
    engine:      l.engine || '',
    transmission: l.transmission || '',
    drivetrain:  l.drivetrain || '',
    fuel:        l.fuelType || '',
    bodyStyle:   l.bodyStyle || l.bodyType || '',
    carfaxUrl:      l.vin ? `https://www.carfax.com/VehicleHistory/p/Report.cfx?partner=DEY_0&vin=${l.vin}` : (l.carfaxUrl || null),
    autoCheckUrl:   l.vin ? `https://www.autocheck.com/vehiclehistory/?vin=${l.vin}` : null,
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
    "X1",
    "X2",
    "X3",
    "X4",
    "X5",
    "X6",
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

  const trim     = document.getElementById('search-trim') ? document.getElementById('search-trim').value.trim() : '';
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

  setLoading(true);
  clearError();

  try {
    const fetchLimit = (condition || minYear || maxYear || trim) ? 100 : PAGE_SIZE;
    const data = await fetchInventory(params, page, fetchLimit);
    const records = data.data || data.listings || data.records || [];
    totalResultCount = data.totalCount || records.length;

    if (!Array.isArray(records) || records.length === 0) {
      showError('No listings found. Try a wider radius, different make, or adjust your filters.');
      useDemoData();
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

      allCars = normalized;
      isLiveData = true;
      populateYearFilters(allCars);
      document.getElementById('api-status-badge').textContent = 'LIVE';
      document.getElementById('api-status-badge').className = 'live-badge live';
      document.getElementById('grid-label').textContent =
        `Live Inventory  ${zip} ${parseInt(radius) >= 5000 ? '  Nationwide' : 'within ' + radius + ' miles'}`;
    }
  } catch (e) {
    console.error('Inventory fetch error:', e);
    showError(`Could not load live inventory: ${e.message}. Showing demo data.`);
    useDemoData();
  } finally {
    setLoading(false);
    applyFilter(currentFilter);
  }
}

function changePage(dir) { runSearch(currentPage + dir); }

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

function applyFilter(type) {
  const minYear = parseInt(document.getElementById('search-min-year')?.value) || 0;
  const maxYear = parseInt(document.getElementById('search-max-year')?.value) || 9999;
  let base = type === 'all' ? allCars : allCars.filter(c => c.type === type);
  if (minYear) base = base.filter(c => c.year >= minYear);
  if (maxYear < 9999) base = base.filter(c => c.year <= maxYear);
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

  grid.innerHTML = filteredCars.map(car => {
    const imgHtml = car.img
      ? `<img src="${escHtml(car.img)}" alt="${escHtml(car.name)}" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="car-emoji-ph">${car.emoji}</div>`;
    const dropBadge = car.recentPriceDrop
      ? `<span class="price-drop-badge">↓ Price Dropped</span>`
      : '';
    const photoCount = car.allPhotos && car.allPhotos.length > 1
      ? `<span style="position:absolute;top:8px;right:8px;background:rgba(26,26,24,0.55);color:#fff;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;backdrop-filter:blur(2px);z-index:2">${car.allPhotos.length} photos</span>`
      : '';
    const daysBadge = car.daysOnLot !== null && car.daysOnLot >= 30
      ? `<span class="days-badge ${car.daysOnLot >= 60 ? 'hot' : 'warm'}">${car.daysOnLot >= 60 ? '⏰' : '🕐'} ${car.daysOnLot}d on lot</span>`
      : '';
    return `
    <div class="car-card" onclick="openDetail(${escHtml(JSON.stringify(String(car.id)))})">
      <div class="car-img">${imgHtml}${daysBadge}${dropBadge}${photoCount}</div>
      <div class="car-body">
        <span class="src-tag ${car.isLive?'live':'demo'}">${car.isLive?' LIVE':' DEMO'}</span>
        <div class="car-meta">
          <div>
            <div class="car-name">${escHtml(car.year+' '+car.name)}</div>
            <div class="car-trim">${escHtml(car.trim)}</div>
          </div>
          <div class="msrp-b">
            <div class="msrp-lbl">PRICE</div>
            <div class="msrp-val">${car.priceLabel ? `<span style="font-size:12px;font-family:Inter,sans-serif;color:var(--ink3)">${car.priceLabel}</span>` : fmt(car.msrp)}</div>
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Carfax
          </a>
          <span class="history-link-sep">·</span>
          <a href="${car.autoCheckUrl}" target="_blank" rel="noopener" class="history-link autocheck-link">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            AutoCheck
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

function useDemoData() {
  allCars = DEMO_CARS;
  totalResultCount = DEMO_CARS.length;
  isLiveData = false;
  document.getElementById('api-status-badge').textContent = 'DEMO MODE';
  document.getElementById('api-status-badge').className = 'api-status demo';
  document.getElementById('grid-label').textContent = 'Demo Inventory';
}

//  DETAIL MODAL 
let detailCar = null;
let galleryPhotos = [];
let galleryIdx = 0;

async function openDetail(carId) {
  detailCar = allCars.find(c => String(c.id) === String(carId));
  if (!detailCar) return;

  // Reset modal
  document.getElementById('gallery-main').innerHTML = '<div class="no-img"></div>';
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
    ['Year',        detailCar.year],
    ['Make',        detailCar.name.split(' ')[0]],
    ['Model',       detailCar.name.split(' ').slice(1).join(' ')],
    ['Trim',        detailCar.trimRaw || detailCar.trim?.split('  ')[0] || ''],
    ['Body Style',  detailCar.bodyStyle || ''],
    ['Condition',   detailCar.condition ? detailCar.condition.charAt(0).toUpperCase()+detailCar.condition.slice(1) : ''],
    ['Mileage',     mileageStr],
    ['Engine',      detailCar.engine || ''],
    ['Transmission',detailCar.transmission || ''],
    ['Drivetrain',  detailCar.drivetrain || ''],
    ['Fuel Type',   detailCar.fuel || ''],
    ['VIN',         detailCar.vin || ''],
  ].filter(([,v]) => v).map(([l,v]) =>
    `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-val">${escHtml(String(v))}</span></div>`
  ).join('');

  // Dealer rows
  const daysOnLotStr = detailCar.daysOnLot !== null && detailCar.daysOnLot >= 0
    ? (detailCar.daysOnLot === 0 ? 'Listed today' : detailCar.daysOnLot + ' days' + (detailCar.daysOnLot >= 60 ? ' ⏰ motivated seller' : detailCar.daysOnLot >= 30 ? ' — price negotiable' : ''))
    : '';
  const dealerRows = [
    ['Dealer',   detailCar.dealer],
    ['Location', detailCar.dealerCity || ''],
    ['Distance', detailCar.distanceMi ? detailCar.distanceMi + ' miles' : ''],
    ['Days on Lot', daysOnLotStr],
  ].filter(([,v]) => v).map(([l,v]) =>
    `<div class="detail-row"><span class="detail-row-label">${l}</span><span class="detail-row-val">${escHtml(String(v))}</span></div>`
  ).join('');
  const historyBtns = detailCar.vin ? `
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <a href="${escHtml(detailCar.carfaxUrl)}" target="_blank" rel="noopener" class="history-report-btn carfax-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Carfax Report
      </a>
      <a href="${escHtml(detailCar.autoCheckUrl)}" target="_blank" rel="noopener" class="history-report-btn autocheck-btn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        AutoCheck
      </a>
    </div>` : '';
  document.getElementById('detail-dealer-rows').innerHTML = dealerRows + historyBtns;

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

function renderIntelligence(data, vinData) {
  document.getElementById('detail-intel-loading').style.display = 'none';
  const rows = document.getElementById('detail-intel-rows');

  // data is now from the comparables API: { comparables, stats }
  const stats = data.stats || {};
  const comps  = data.comparables || [];

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

  if (isNew) {
    // New cars: auto.dev VIN data doesn't include invoice. Show an estimate from MSRP.
    if (carPrice) {
      const estInvoice = Math.round(carPrice * 0.955);
      const spread = carPrice - estInvoice;
      html += `<div class="detail-row"><span class="detail-row-label">Est. Dealer Invoice</span><span class="detail-row-val invoice">${fmt(estInvoice)} <span style="font-size:10px;opacity:0.6">(est.)</span></span></div>`;
      html += `<div class="detail-row"><span class="detail-row-label">MSRP vs Invoice</span><span class="detail-row-val">+${fmt(spread)} above invoice</span></div>`;
      html += `<div class="invoice-note">Estimated invoice is ~4–5% below MSRP (typical holdback). Aim for 2–5% above this as your opening offer. Run AI Analysis for exact dealer cost and current manufacturer incentives.</div>`;
    }
  } else if (invoice || tmvRetail || privParty) {
    // Used / CPO: show actual VIN pricing data from auto.dev
    if (invoice) {
      const aboveInvoice = carPrice && invoice ? carPrice - invoice : null;
      html += `<div class="detail-row"><span class="detail-row-label">Original Dealer Invoice</span><span class="detail-row-val invoice">${fmt(invoice)}</span></div>`;
      if (aboveInvoice !== null) {
        const aboveLabel = aboveInvoice >= 0 ? `+${fmt(aboveInvoice)} above invoice` : `${fmt(Math.abs(aboveInvoice))} below invoice`;
        html += `<div class="detail-row"><span class="detail-row-label">Current vs Invoice</span><span class="detail-row-val ${aboveInvoice > 0 ? '' : 'green'}">${aboveLabel}</span></div>`;
      }
    }
    if (tmvRetail)  html += `<div class="detail-row"><span class="detail-row-label">Edmunds TMV Retail</span><span class="detail-row-val">${fmt(tmvRetail)}</span></div>`;
    if (privParty)  html += `<div class="detail-row"><span class="detail-row-label">Private Party Value</span><span class="detail-row-val">${fmt(privParty)}</span></div>`;
    if (tradeIn)    html += `<div class="detail-row"><span class="detail-row-label">Trade-In Value</span><span class="detail-row-val">${fmt(tradeIn)}</span></div>`;
    if (invoice) {
      html += `<div class="invoice-note">Original factory invoice (what the dealer paid when new). A useful anchor — most used cars sell above original invoice.</div>`;
    }
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
function openOffer(carId) {
  currentCar = allCars.find(c => String(c.id) === String(carId));
  if (!currentCar) return;
  activeTab = 'cash'; offerValid = false;

  const eff = currentCar.msrp;

  document.getElementById('modal-car-name').textContent = `${currentCar.year} ${currentCar.name}`;
  document.getElementById('modal-dealer-info').textContent =
    `${currentCar.dealer}${currentCar.dealerCity?'  '+currentCar.dealerCity:''}  Stock: ${currentCar.stock}`;
  document.getElementById('modal-msrp').textContent = fmt(currentCar.msrp);
  document.getElementById('modal-inc-total').textContent = 'None';
  document.getElementById('modal-target').textContent = fmt(Math.round(eff*0.97));

  ['cash-offer','fin-down','fin-monthly','lease-down','lease-monthly'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['cash-feedback','fin-feedback','lease-feedback'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent='';el.className='offer-feedback';}});
  document.getElementById('cash-meter').style.width='0%';
  document.getElementById('submit-btn').disabled=true;
  document.querySelectorAll('.offer-tab').forEach((t,i)=>t.className='offer-tab'+(i===0?' active':''));
  switchTab('cash',null);
  document.getElementById('offer-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
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

function submitOffer() { if(!currentCar||!offerValid) return; closeModal('offer-overlay'); buildEmailDraft(); }

//  EMAIL DRAFT 
function buildEmailDraft() {
  const car=currentCar;
  const eff=car.msrp;
  let offerBlock='';
  if(activeTab==='cash'){const v=parseFloat(document.getElementById('cash-offer').value);offerBlock=`Purchase Type:    Cash Purchase\nOffer Amount:     ${fmt(v)}`;}
  else if(activeTab==='finance'){const down=parseFloat(document.getElementById('fin-down').value)||0,monthly=parseFloat(document.getElementById('fin-monthly').value)||0,term=document.getElementById('fin-term').value,apr=document.getElementById('fin-apr').value;offerBlock=`Purchase Type:    Financed Purchase\nMonthly Payment:  ${fmt(monthly)}/month\nLoan Term:        ${term} months\nAPR:              ${apr}%\nDown Payment:     ${fmt(down)}`;}
  else{const down=parseFloat(document.getElementById('lease-down').value)||0,monthly=parseFloat(document.getElementById('lease-monthly').value)||0,term=document.getElementById('lease-term').value,miles=parseInt(document.getElementById('lease-miles').value);offerBlock=`Purchase Type:    Lease\nMonthly Payment:  ${fmt(monthly)}/month\nLease Term:       ${term} months\nAnnual Mileage:   ${miles.toLocaleString()} miles/year\nCap Cost Red.:    ${fmt(down)}`;}
  const today=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const subj=`Buyer Offer  ${car.year} ${car.name} | Stock ${car.stock} | AutoNegotiating.com`;
  const body=`Dear ${car.dealer} Internet Sales Team,

I am writing on behalf of a verified, pre-qualified buyer registered through AutoNegotiating.com. Our client has submitted a formal offer on the following vehicle currently in your inventory:

VEHICLE DETAILS

Year / Make / Model:   ${car.year} ${car.name}
Trim Level:            ${car.trim}
Stock Number:          ${car.stock}${car.vin?'\nVIN:                   '+car.vin:''}
MSRP:                  ${fmt(car.msrp)}
Applied Incentives:    None
After-Incentive Price: ${fmt(eff)}

CLIENT OFFER

${offerBlock}

Our client is a serious buyer ready to proceed immediately. This offer reflects current market pricing and all applicable incentives validated through AutoNegotiating.com.

Please respond within 2448 business hours to accept, counter, or confirm availability:

  Email:  offers@autonegotiating.com
  Phone:  (800) 555-AUTO
  Web:    www.AutoNegotiating.com

Submitted: ${today} via AutoNegotiating.com verified buyer platform.

Best regards,
AutoNegotiating.com  Client Services
offers@autonegotiating.com | (800) 555-AUTO`;

  document.getElementById('email-to').textContent=`${car.dealer} Internet Sales <${car.dealerEmail}>`;
  document.getElementById('email-subject').textContent=subj;
  document.getElementById('email-body').textContent=body;
  document.getElementById('email-mailto-btn').href=`mailto:${car.dealerEmail}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  document.getElementById('email-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
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
  if(e.key==='Escape'){closeModal('email-overlay');closeModal('offer-overlay');closeModal('detail-overlay');}
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
  if (modelEl) modelEl.addEventListener('change', populateTrims);

  // Auto-search if ?make= param is present (e.g. arriving from PDF comparable link)
  const urlParams = new URLSearchParams(window.location.search);
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
})();
