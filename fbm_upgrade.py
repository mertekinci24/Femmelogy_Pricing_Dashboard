import re

# 1. Update index.html
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Add Category Select
html = html.replace(
    '<div class="modal-body">\n      <input type="hidden" id="modal-product-id" />',
    '''<div class="modal-body">
      <input type="hidden" id="modal-product-id" />
      <div class="modal-field">
        <label for="modal-amz-category">Kategori</label>
        <select id="modal-amz-category">
          <option value="kozmetik">Kozmetik (%10.8 / %16.8 + DeadZone)</option>
          <option value="saglik">Sağlık (%16.2 Flat)</option>
          <option value="diger">Diğer (%10.8 Flat)</option>
        </select>
      </div>'''
)

# Replace Modal Preview HTML
old_preview = '''      <!-- Canlı Önizleme -->
      <div class="modal-preview" id="modal-preview">
        <div class="preview-row">
          <span>Toplam Maliyet</span><span id="prev-total-cost">—</span>
        </div>
        <div class="preview-row">
          <span>Kargo</span><span id="prev-shipping">—</span>
        </div>
        <div class="preview-row">
          <span>Komisyon</span><span id="prev-commission">—</span>
        </div>
        <div class="preview-row highlight-row">
          <span>Önerilen Satış Fiyatı</span><span id="prev-price" class="prev-price-val">—</span>
        </div>
        <div class="preview-row">
          <span>Net Kâr</span><span id="prev-profit" class="prev-profit-val">—</span>
        </div>
        <div class="preview-row">
          <span>Gerçek Marj</span><span id="prev-margin" class="prev-margin-val">—</span>
        </div>
        <div class="preview-row">
          <span>Durum</span><span id="prev-status">—</span>
        </div>
      </div>'''

new_preview = '''      <!-- Canlı Önizleme -->
      <div id="amazon-ledger-preview" style="background: var(--bg-darker); padding: 12px; border-radius: 8px;">
        <div style="display:flex; justify-content:space-between; font-weight:700; font-size:16px; margin-bottom:12px;">
          <span>Önerilen Satış Fiyatı</span>
          <span id="amazon-onerilen-fiyat" style="color:var(--text-primary);">—</span>
        </div>
        <div style="font-size:13px; color:var(--text-secondary); border-bottom:1px solid var(--border-color); padding-bottom:8px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ürün Maliyeti (COGS)</span><span id="amazon-cogs-goster">—</span></div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Amazon Komisyonu</span><span id="amazon-komisyon-goster">—</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Kargo Maliyeti</span><span id="amazon-kargo-goster">—</span></div>
        </div>
        <div style="font-size:14px; font-weight:700;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Net Kâr</span><span id="amazon-netkarpro">—</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Net Marj</span><span id="amazon-marj-badge">—</span></div>
        </div>
        <div id="amazon-deadzone-uyari" class="hidden" style="margin-top:12px; background:rgba(239, 68, 68, 0.15); color:var(--accent-red); padding:8px; border-radius:6px; font-size:12px;">
          ⚠️ <b>Ölü Bölge (Dead Zone) Aktif:</b> Artan komisyon dilimi sebebiyle fiyat 499.90 TL'ye sabitlendi.
        </div>
        <div id="amazon-buybox-panel" class="hidden" style="margin-top:12px; border-top:1px solid var(--border-color); padding-top:8px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600;"><span>Buybox Fiyatı</span><span id="amazon-buybox-fiyat">—</span></div>
          <div style="display:flex; justify-content:space-between;"><span>Rekabet Durumu</span><span id="amazon-buybox-durum">—</span></div>
        </div>
      </div>'''

html = html.replace(old_preview, new_preview)

# Add BB to Table
html = html.replace('<th>Ürün Adı</th>\n              <th>Toplam Maliyet</th>', '<th>Ürün Adı</th>\n              <th style="text-align: center; width: 50px;">BB</th>\n              <th>Toplam Maliyet</th>')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

# 2. Update app.js
with open('app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Replace parseBuyboxFiyat injection and amazonHesap
old_amazon_hesap = re.search(r'function amazonHesap.*?\}\n\n/\* ════════', js, re.DOTALL).group(0)

new_amazon_hesap = '''function parseBuyboxFiyat(val) {
  if (!val || val === "—" || val === "-") return null;
  let str = String(val).replace(/ücretsiz/gi, "0").replace(/free/gi, "0");
  let parts = str.split('+');
  let total = 0;
  for (let p of parts) {
    let clean = p.replace(/[^\\d.,]/g, '').trim();
    if (!clean) continue;
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }
    total += parseFloat(clean) || 0;
  }
  return total;
}

function amazonHesap(maliyet, ambalaj, sabit, kargo, hedefMarjPct, kategori, buyboxFiyat = null, currentPrice = 0) {
  const toplMaliyet = maliyet + ambalaj + sabit + kargo;
  const m = hedefMarjPct / 100;
  const c_kategori = String(kategori || "kozmetik").toLowerCase();

  let currCommissionAmt = 0;
  let currNetProfit = 0;
  let currMargin = null;

  const curPriceVal = parseFloat(currentPrice) || 0;
  const getCommRate = (price, cat) => {
    if (cat === 'saglik') return 0.162;
    if (cat === 'diger') return 0.108;
    return price < 500 ? 0.108 : 0.168;
  };

  if (curPriceVal > 0) {
    const currRate = getCommRate(curPriceVal, c_kategori);
    currCommissionAmt = curPriceVal * currRate;
    currNetProfit = curPriceVal - toplMaliyet - currCommissionAmt;
    currMargin = (currNetProfit / curPriceVal) * 100;
  }

  if (c_kategori === "saglik" || c_kategori === "diger") {
    const flatRate = c_kategori === "saglik" ? 0.162 : 0.108;
    const coef = 1 - flatRate - m;
    if (coef <= 0) return { hata: "Hedef marj bu komisyon oranı için çok yüksek.", currCommissionAmt, currNetProfit, currMargin };
    const fiyat = en90eYuvarla(toplMaliyet / coef);
    const komisyonT = fiyat * flatRate;
    const netKar = fiyat - toplMaliyet - komisyonT;
    const gercekM = (netKar / fiyat) * 100;

    return {
      satisF: fiyat, komisyonO: flatRate * 100, komisyonT,
      toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
      deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
      currCommissionAmt, currNetProfit, currMargin
    };
  }

  const KOMIS_DUS = 0.108;
  const KOMIS_YUK = 0.168;
  const SINIR = 500;
  const OB_SABIT = 499.90;

  const paydaDus = 1 - KOMIS_DUS - m;
  if (paydaDus <= 0) return { hata: "Hedef marj bu komisyon oranı için çok yüksek.", currCommissionAmt, currNetProfit, currMargin };
  const fiyatDus = en90eYuvarla(toplMaliyet / paydaDus);

  if (fiyatDus <= SINIR) {
    const komisyonT = fiyatDus * KOMIS_DUS;
    const netKar = fiyatDus - toplMaliyet - komisyonT;
    const gercekM = (netKar / fiyatDus) * 100;
    return {
      satisF: fiyatDus, komisyonO: KOMIS_DUS * 100, komisyonT,
      toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
      deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
      currCommissionAmt, currNetProfit, currMargin
    };
  }

  const paydaYuk = 1 - KOMIS_YUK - m;
  if (paydaYuk <= 0) return { hata: "Hedef marj yüksek komisyon kademesiyle de elde edilemiyor.", currCommissionAmt, currNetProfit, currMargin };
  const fiyatYuk = en90eYuvarla(toplMaliyet / paydaYuk);

  const kar499 = OB_SABIT - toplMaliyet - OB_SABIT * KOMIS_DUS;
  const karYuk = fiyatYuk - toplMaliyet - fiyatYuk * KOMIS_YUK;

  if (kar499 >= karYuk) {
    const komisyonT = OB_SABIT * KOMIS_DUS;
    const netKar = OB_SABIT - toplMaliyet - komisyonT;
    const gercekM = (netKar / OB_SABIT) * 100;
    return {
      satisF: OB_SABIT, komisyonO: KOMIS_DUS * 100, komisyonT,
      toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
      deadZone: true, olduBolge: true, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
      currCommissionAmt, currNetProfit, currMargin
    };
  }

  const komisyonT = fiyatYuk * KOMIS_YUK;
  const netKar = fiyatYuk - toplMaliyet - komisyonT;
  const gercekM = (netKar / fiyatYuk) * 100;
  return {
    satisF: fiyatYuk, komisyonO: KOMIS_YUK * 100, komisyonT,
    toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
    deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
    currCommissionAmt, currNetProfit, currMargin
  };
}

/* ════════'''

js = js.replace(old_amazon_hesap, new_amazon_hesap)

# Replace amazonYenidenHesapla call
js = js.replace(
    'const r = amazonHesap(p.maliyet||0, p.ambalaj||0, p.sabit||0, GP.kargo, marj, p.currentPrice||0);',
    'const r = amazonHesap(p.maliyet||0, p.ambalaj||0, p.sabit||0, GP.kargo, marj, p.category || "kozmetik", p.buyboxPrice || null, p.currentPrice||0);'
)

# modalAc
js = js.replace(
    'document.getElementById("modal-margin").value = p.bireyselMarj ?? "";',
    'document.getElementById("modal-margin").value = p.bireyselMarj ?? "";\n    document.getElementById("modal-amz-category").value = p.category || "kozmetik";'
)
js = js.replace(
    'temizle("modal-name","modal-sku","modal-asin","modal-cost","modal-pkg","modal-fixed","modal-margin");',
    'temizle("modal-name","modal-sku","modal-asin","modal-cost","modal-pkg","modal-fixed","modal-margin");\n    document.getElementById("modal-amz-category").value = "kozmetik";'
)

# modalOnizle
old_onizle = '''  document.getElementById("prev-total-cost").textContent = para(toplam);
  document.getElementById("prev-shipping").textContent   = para(kargo);

  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;

  const r = amazonHesap(maliyet, ambalaj, sabit, kargo, marj, currentPrice);
  if (r.hata) {
    document.getElementById("prev-price").textContent   = "—";
    document.getElementById("prev-profit").textContent  = "—";
    document.getElementById("prev-margin").textContent  = "—";
    document.getElementById("prev-commission").textContent = "—";
    document.getElementById("prev-status").textContent  = r.hata;
    
    const currBlock = document.getElementById("prev-amz-curr-block");
    if (currBlock) currBlock.classList.add("hidden");
    return;
  }
  document.getElementById("prev-commission").textContent = para(r.komisyonT) + " (" + yuzde(r.komisyonO) + ")";
  document.getElementById("prev-price").textContent   = para(r.satisF);
  document.getElementById("prev-profit").textContent  = para(r.netKar);
  document.getElementById("prev-margin").textContent  = yuzde(r.gercekM);
  document.getElementById("prev-status").innerHTML    = durumRozet(r);'''

new_onizle = '''  const kat = document.getElementById("modal-amz-category").value;
  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;
  const buybox = existingProduct ? (existingProduct.buyboxPrice || null) : null;

  const r = amazonHesap(maliyet, ambalaj, sabit, kargo, marj, kat, buybox, currentPrice);
  if (r.hata) {
    document.getElementById("amazon-onerilen-fiyat").textContent = "—";
    document.getElementById("amazon-cogs-goster").textContent = "—";
    document.getElementById("amazon-komisyon-goster").textContent = "—";
    document.getElementById("amazon-kargo-goster").textContent = "—";
    document.getElementById("amazon-netkarpro").textContent = "—";
    document.getElementById("amazon-marj-badge").textContent = "—";
    document.getElementById("amazon-deadzone-uyari").classList.add("hidden");
    document.getElementById("amazon-buybox-panel").classList.add("hidden");
    document.getElementById("modal-error").textContent = r.hata;
    document.getElementById("modal-error").classList.remove("hidden");
    const currBlock = document.getElementById("prev-amz-curr-block");
    if (currBlock) currBlock.classList.add("hidden");
    return;
  }
  
  document.getElementById("modal-error").classList.add("hidden");
  document.getElementById("amazon-onerilen-fiyat").textContent = para(r.satisF);
  document.getElementById("amazon-cogs-goster").textContent = para(toplam);
  document.getElementById("amazon-komisyon-goster").textContent = para(r.komisyonT) + " (" + yuzde(r.komisyonO) + ")";
  document.getElementById("amazon-kargo-goster").textContent = para(kargo);
  document.getElementById("amazon-netkarpro").textContent = para(r.netKar);
  document.getElementById("amazon-marj-badge").textContent = "%" + (r.gercekM || 0).toFixed(2);
  
  if (r.deadZone) document.getElementById("amazon-deadzone-uyari").classList.remove("hidden");
  else document.getElementById("amazon-deadzone-uyari").classList.add("hidden");
  
  if (buybox !== null) {
    document.getElementById("amazon-buybox-panel").classList.remove("hidden");
    document.getElementById("amazon-buybox-fiyat").textContent = para(buybox);
    document.getElementById("amazon-buybox-durum").textContent = r.satisF <= buybox ? "✅ Bizde" : "❌ Rakipte";
  } else {
    document.getElementById("amazon-buybox-panel").classList.add("hidden");
  }'''

js = js.replace(old_onizle, new_onizle)

# modalKaydet
old_kaydet = '''  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;

  if (!ad) { hata("modal-error","Ürün adı zorunludur."); return; }

  const r = amazonHesap(maliyet, ambalaj, sabit, GP.kargo, marj, currentPrice);
  if (r.hata) { hata("modal-error", r.hata); return; }

  const yeniVeri = { ad, sku, asin, maliyet, ambalaj, sabit, bireyselMarj, currentPrice, ...r };'''

new_kaydet = '''  const kat = document.getElementById("modal-amz-category").value;
  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;
  const buybox = existingProduct ? (existingProduct.buyboxPrice || null) : null;

  if (!ad) { hata("modal-error","Ürün adı zorunludur."); return; }

  const r = amazonHesap(maliyet, ambalaj, sabit, GP.kargo, marj, kat, buybox, currentPrice);
  if (r.hata) { hata("modal-error", r.hata); return; }

  const yeniVeri = { 
    ad, sku, asin, maliyet, ambalaj, sabit, bireyselMarj, 
    currentPrice, category: kat, buyboxPrice: buybox, ...r 
  };'''
js = js.replace(old_kaydet, new_kaydet)

# amazonRender BB cell addition
old_row = '''    return `<tr class="${trClass}">
      <td class="td-num">${i+1}</td>
      <td class="td-name-cell">
        <span class="td-name" title="${htmlK(p.ad)}">${htmlK(p.ad)}</span>
        ${metaHtml}
      </td>
      <td>${para(toplam)}</td>'''

new_row = '''    let bbCell = '';
    if (p.currentPrice === 0 && !p.buyboxPrice) {
      bbCell = '<td style="text-align: center; color: var(--text-muted);">—</td>';
    } else if (!p.buyboxPrice || p.buyboxPrice === 0 || p.currentPrice <= p.buyboxPrice) {
      bbCell = '<td style="text-align: center; font-size: 16px; cursor: help;" title="Buybox Bizde">✅</td>';
    } else {
      bbCell = '<td style="text-align: center; font-size: 16px; cursor: help;" title="Buybox Rakipte">❌</td>';
    }

    return `<tr class="${trClass}">
      <td class="td-num">${i+1}</td>
      <td class="td-name-cell">
        <span class="td-name" title="${htmlK(p.ad)}">${htmlK(p.ad)}</span>
        ${metaHtml}
      </td>
      ${bbCell}
      <td>${para(toplam)}</td>'''
js = js.replace(old_row, new_row)

# CSV Parsing logic insertion
old_csv_parse = '''    const parseVal = (val) => {
      if (val === undefined || val === null) return null;
      if (typeof val === "number") return val;
      let clean = String(val).trim();
      if (!clean) return null;
      if (clean.includes(",")) {
        clean = clean.replace(/\\./g, "").replace(",", ".");
      }
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? null : parsed;
    };'''

new_csv_parse = '''    const parseVal = (val) => {
      if (val === undefined || val === null) return null;
      if (typeof val === "number") return val;
      let clean = String(val).trim();
      if (!clean) return null;
      if (clean.includes(",")) {
        clean = clean.replace(/\\./g, "").replace(",", ".");
      }
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? null : parsed;
    };

    const bbFiyatIdx = baslik.findIndex(h => /^öne çıkan teklif fiyatı$/i.test(h));'''
js = js.replace(old_csv_parse, new_csv_parse)

old_csv_row = '''      const currentPrice = currentPriceIdx !== -1 ? (parseVal(satir[currentPriceIdx]) || 0) : 0;

      // Benzersiz anahtar: önce ASIN, yoksa SKU
      const anahtar = asin || sku;

      // Mevcut ürünü ara (ASIN veya SKU eşleşmesi)
      const mevcutIdx = STATE.amazon.findIndex(p =>
        (asin && p.asin === asin) || (!asin && sku && p.sku === sku)
      );

      if (mevcutIdx !== -1) {
        // UPSERT — IF EXISTS: Sadece adı ve mevcut fiyatı güncelle, finansal verilere dokunma
        STATE.amazon[mevcutIdx].ad   = ad;
        STATE.amazon[mevcutIdx].sku  = sku  || STATE.amazon[mevcutIdx].sku;
        STATE.amazon[mevcutIdx].asin = asin || STATE.amazon[mevcutIdx].asin;
        STATE.amazon[mevcutIdx].currentPrice = currentPrice;
        guncellendi++;
      } else {
        // UPSERT — IF NEW: Varsayılan değerlerle ekle
        const r = amazonHesap(0, 0, 0, GP.kargo, GP.marj, currentPrice);'''

new_csv_row = '''      const currentPrice = currentPriceIdx !== -1 ? (parseVal(satir[currentPriceIdx]) || 0) : 0;
      let buyboxPrice = bbFiyatIdx !== -1 ? parseBuyboxFiyat(satir[bbFiyatIdx]) : null;

      // Benzersiz anahtar: önce ASIN, yoksa SKU
      const anahtar = asin || sku;

      // Mevcut ürünü ara (ASIN veya SKU eşleşmesi)
      const mevcutIdx = STATE.amazon.findIndex(p =>
        (asin && p.asin === asin) || (!asin && sku && p.sku === sku)
      );

      if (mevcutIdx !== -1) {
        // UPSERT — IF EXISTS: Sadece adı ve mevcut fiyatı güncelle, finansal verilere dokunma
        STATE.amazon[mevcutIdx].ad   = ad;
        STATE.amazon[mevcutIdx].sku  = sku  || STATE.amazon[mevcutIdx].sku;
        STATE.amazon[mevcutIdx].asin = asin || STATE.amazon[mevcutIdx].asin;
        STATE.amazon[mevcutIdx].currentPrice = currentPrice;
        STATE.amazon[mevcutIdx].buyboxPrice = buyboxPrice;
        guncellendi++;
      } else {
        // UPSERT — IF NEW: Varsayılan değerlerle ekle
        const r = amazonHesap(0, 0, 0, GP.kargo, GP.marj, "kozmetik", buyboxPrice, currentPrice);'''
js = js.replace(old_csv_row, new_csv_row)

old_csv_push = '''            ad, sku, asin,
            maliyet:0, ambalaj:0, sabit:0, bireyselMarj:null,
            currentPrice,
            ...r'''
new_csv_push = '''            ad, sku, asin,
            maliyet:0, ambalaj:0, sabit:0, bireyselMarj:null,
            currentPrice, buyboxPrice, category: "kozmetik",
            ...r'''
js = js.replace(old_csv_push, new_csv_push)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(js)
