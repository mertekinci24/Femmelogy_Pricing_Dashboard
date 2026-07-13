/**
 * app.js — Fiyat Paneli v4 (SaaS Edition)
 * Küresel parametreler · Modal düzenleyici · Kilitli matematik motoru · CSV içe aktarma
 */

/* ══════════════════════════════════════════
   KÜRESEL PARAMETRELER
══════════════════════════════════════════ */
const GP = {
  get kargo()  { return parseFloat(localStorage.getItem("gp_kargo")  ?? "93.05"); },
  get marj()   { return parseFloat(localStorage.getItem("gp_marj")   ?? "25"); },
  setKargo(v)  { localStorage.setItem("gp_kargo",  v); },
  setMarj(v)   { localStorage.setItem("gp_marj",   v); },
  get tyKomis() { return parseFloat(localStorage.getItem("gp_ty_komis") ?? "19"); },
  get tyKargo() { return parseFloat(localStorage.getItem("gp_ty_kargo") ?? "93.05"); },
  get tyMarj()  { return parseFloat(localStorage.getItem("gp_ty_marj")  ?? "25"); },
  setTyKomis(v){ localStorage.setItem("gp_ty_komis", v); },
  setTyKargo(v){ localStorage.setItem("gp_ty_kargo", v); },
  setTyMarj(v) { localStorage.setItem("gp_ty_marj",  v); },
};

/* ══════════════════════════════════════════
   DURUM — localStorage (Birincil Katman)
   Firebase Firestore (İkincil Katman — Arka Plan Senkronizasyonu)
══════════════════════════════════════════ */
const STATE = {
  amazon:   JSON.parse(localStorage.getItem("femmelogy_amazon")   || "[]"),
  trendyol: JSON.parse(localStorage.getItem("femmelogy_trendyol") || "[]"),
};

/**
 * kaydet(platform) — Double-Write Pattern
 * Layer 1: localStorage (senkron, garantili) — her zaman çalışır
 * Layer 2: Firestore (asenkron, fire-and-forget) — DB hazırsa çalışır
 */
function kaydet(p) {
  // Layer 1: Synchronous localStorage (DO NOT REMOVE)
  localStorage.setItem("femmelogy_" + p, JSON.stringify(STATE[p]));
  // Layer 2: Fire-and-forget Firestore sync (non-blocking)
  if (window.DB && window.DB.isReady) {
    window.DB.save(p, STATE[p]).catch(err => console.error("[Femmelogy] Firestore sync failed:", err));
  }
}

/* ══════════════════════════════════════════
   YARDIMCILAR
══════════════════════════════════════════ */
function en90eYuvarla(p) {
  let p_ceil = Math.ceil(p * 100) / 100;
  let d = Math.floor(p_ceil / 10);
  let c = d * 10 + 9.90;
  if (c < p_ceil) c += 10;
  return parseFloat(c.toFixed(2));
}
function para(v)  { return "\u20BA" + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function yuzde(v) { return "%" + Number(v).toFixed(1); }
function htmlK(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function hata(id, m) { const el=document.getElementById(id); if(!el)return; el.textContent=m; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),4000); }
function temizle(...ids) { ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; }); }

/* ══════════════════════════════════════════
   KİLİTLİ MATEMATİK MOTORU
   Brüt satış fiyatı bazlı hesaplama.
   ──────────────────────────────────────────
   Formül:
     Fiyat = (Maliyet + Ambalaj + Sabit + Kargo)
             / (1 - KomisyonOranı - HedefMarj/100)
   ──────────────────────────────────────────
   Kural 1: Önce %10,8 ile hesapla.
            Sonuç >= 500 ise %16,8 ile YENİDEN hesapla.
   Kural 2: Ölü Bölge — yüksek komisyonlu fiyatla elde
            edilen net kâr, 499,90'daki kârdan DÜŞÜKSE
            fiyatı 499,90'a sabitle.
   Kural 3: X,90 yukarı yuvarla.
══════════════════════════════════════════ */
const KOMIS_DUS  = 0.108;  // %10,8 (geriye dönük uyumluluk için korundu)
const KOMIS_YUK  = 0.168;  // %16,8 (geriye dönük uyumluluk için korundu)
const SINIR      = 499.99;
const OB_SABIT   = 499.90; // Ölü Bölge sabiti (geriye dönük uyumluluk için korundu)

/* ══════════════════════════════════════════
   MERKEZ KONFİGÜRASYON — Tüm sabit değerler
══════════════════════════════════════════ */
const APP_CONFIG = {
  AMAZON: {
    LIMIT_DEADZONE_LOW:  499.90,  // Ölü Bölge fiyat tavanı
    LIMIT_DEADZONE_HIGH: 500.00,  // Komisyon kademesi değişim sınırı
    COMM_LOW:            0.108,   // %10,8 — Kozmetik (<500 TL)
    COMM_HIGH:           0.168,   // %16,8 — Kozmetik (>=500 TL)
    COMM_SAGLIK:         0.162,   // %16,2 — Sağlık kategorisi sabit komisyon
    COMM_DIGER:          0.108    // %10,8 — Diğer kategorisi sabit komisyon
  },
  TRENDYOL: {
    GIZLI_GIDER:              6.61,  // Gizli sabit gider (komisyon+iade karşılığı)
    SABIT_GIDER:              8.00,  // Sabit birim gider
    IADE_PAYI:                1.03,  // İade payı (satış fiyatı > TRAFIK_LIMIT_FIYAT ise uygulanır)
    HIZMET_BEDELI_STANDART:  13.19,  // Normal kargo hizmet bedeli
    HIZMET_BEDELI_KAMPANYA:   5.99,  // Bugün kargoda kampanya hizmet bedeli
    TRAFIK_LIMIT_FIYAT:      75.00,  // Grup B (Trafik) birim fiyat üst sınırı
    TRAFIK_SABIT_MARJ:           2   // Grup B için sabit hedef marj (%2)
  }
};

function parseBuyboxFiyat(val) {
  if (!val || val === "—" || val === "-" || val === "N/A") return null;
  let str = String(val).replace(/ücretsiz/gi, "0").replace(/free/gi, "0");
  let parts = str.split('+');
  let total = 0;
  let valid = false;
  for (let p of parts) {
    let clean = p.replace(/[^\d.,]/g, '').trim();
    if (!clean) continue;
    valid = true;
    if (clean.includes(',') && clean.includes('.')) {
      if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } else {
        clean = clean.replace(/,/g, '');
      }
    } else if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }
    total += parseFloat(clean) || 0;
  }
  return valid ? total : null;
}

function breakEvenFiyatAmz(tm, kargo, kategori) {
  const baseCost = tm + kargo;
  if (baseCost <= 0) return 0;
  let cat = String(kategori || "kozmetik").toLowerCase();
  
  if (cat === "saglik") return Math.round((baseCost / (1 - APP_CONFIG.AMAZON.COMM_SAGLIK)) * 100) / 100;
  if (cat === "diger")  return Math.round((baseCost / (1 - APP_CONFIG.AMAZON.COMM_DIGER))  * 100) / 100;
  
  let beLow = baseCost / (1 - APP_CONFIG.AMAZON.COMM_LOW);
  if (beLow < APP_CONFIG.AMAZON.LIMIT_DEADZONE_HIGH) return Math.round(beLow * 100) / 100;
  
  return Math.round((baseCost / (1 - APP_CONFIG.AMAZON.COMM_HIGH)) * 100) / 100;
}

function amazonHesap(maliyet, ambalaj, sabit, kargo, hedefMarjPct, kategori, buyboxFiyat = null, currentPrice = 0) {
  const baseCost = maliyet + ambalaj + sabit;
  if (baseCost <= 0) {
    return {
      hata: "Maliyet Eksik",
      missingCogs: true,
      satisF: 0, komisyonT: 0, komisyonO: 0,
      toplamGider: 0, netKar: 0, gercekM: null,
      deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
      currCommissionAmt: 0, currNetProfit: 0, currMargin: null
    };
  }

  const toplMaliyet = maliyet + ambalaj + sabit + kargo;
  const m = hedefMarjPct / 100;
  const c_kategori = String(kategori || "kozmetik").toLowerCase();
  const beFiyat = breakEvenFiyatAmz(maliyet + ambalaj + sabit, kargo, c_kategori);

  let currCommissionAmt = 0;
  let currNetProfit = 0;
  let currMargin = null;

  const curPriceVal = parseFloat(currentPrice) || 0;
  const getCommRate = (price, cat) => {
    if (cat === 'saglik') return APP_CONFIG.AMAZON.COMM_SAGLIK;
    if (cat === 'diger')  return APP_CONFIG.AMAZON.COMM_DIGER;
    return price < APP_CONFIG.AMAZON.LIMIT_DEADZONE_HIGH ? APP_CONFIG.AMAZON.COMM_LOW : APP_CONFIG.AMAZON.COMM_HIGH;
  };

  if (curPriceVal > 0) {
    const currRate = getCommRate(curPriceVal, c_kategori);
    currCommissionAmt = curPriceVal * currRate;
    currNetProfit = curPriceVal - toplMaliyet - currCommissionAmt;
    currMargin = (currNetProfit / curPriceVal) * 100;
  }

  if (c_kategori === "saglik" || c_kategori === "diger") {
    const flatRate = c_kategori === "saglik" ? APP_CONFIG.AMAZON.COMM_SAGLIK : APP_CONFIG.AMAZON.COMM_DIGER;
    const coef = 1 - flatRate - m;
    if (coef <= 0) return { hata: "Hedef marj bu komisyon oranı için çok yüksek.", currCommissionAmt, currNetProfit, currMargin };
    const fiyat = en90eYuvarla(toplMaliyet / coef);
    const komisyonT = fiyat * flatRate;
    const netKar = fiyat - toplMaliyet - komisyonT;
    const gercekM = (netKar / fiyat) * 100;

    // GUARDRAIL: Flash Crash Protection (Flat Category)
    if (fiyat > 0 && beFiyat > 0 && fiyat < beFiyat) {
      return { hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + fiyat + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.", currCommissionAmt, currNetProfit, currMargin };
    }

    return {
      satisF: fiyat, komisyonO: flatRate * 100, komisyonT,
      breakEvenPrice: beFiyat, maxDiscount: (fiyat > 0 && beFiyat > 0 ? ((fiyat - beFiyat) / fiyat) * 100 : 0),
      toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
      deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
      currCommissionAmt, currNetProfit, currMargin
    };
  }

  const KOMIS_DUS = APP_CONFIG.AMAZON.COMM_LOW;
  const KOMIS_YUK = APP_CONFIG.AMAZON.COMM_HIGH;
  const SINIR     = APP_CONFIG.AMAZON.LIMIT_DEADZONE_HIGH;
  const OB_SABIT  = APP_CONFIG.AMAZON.LIMIT_DEADZONE_LOW;

  const paydaDus = 1 - KOMIS_DUS - m;
  if (paydaDus <= 0) return { hata: "Hedef marj bu komisyon oranı için çok yüksek.", currCommissionAmt, currNetProfit, currMargin };
  const fiyatDus = en90eYuvarla(toplMaliyet / paydaDus);

  const paydaYuk = 1 - KOMIS_YUK - m;
  // PATCH Bug3: Dead Zone Rescue — when high-commission tier is infeasible but low-commission tier works,
  // attempt to rescue by capping at 499.90 (low commission zone) instead of returning an error.
  if (paydaYuk <= 0) {
    if (paydaDus > 0) {
      // Low-commission tier (10.8%) is still viable — rescue with Dead Zone cap at 499.90
      const nk499 = OB_SABIT - toplMaliyet - (OB_SABIT * KOMIS_DUS);
      if (nk499 > 0) {
        const komisyonT = OB_SABIT * KOMIS_DUS;
        const gercekM = (nk499 / OB_SABIT) * 100;

        // GUARDRAIL: Flash Crash Protection (Dead Zone Rescue)
        if (OB_SABIT > 0 && beFiyat > 0 && OB_SABIT < beFiyat) {
          return { hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + OB_SABIT + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.", currCommissionAmt, currNetProfit, currMargin };
        }

        return {
          satisF: OB_SABIT, komisyonO: KOMIS_DUS * 100, komisyonT,
          breakEvenPrice: beFiyat, maxDiscount: (OB_SABIT > 0 && beFiyat > 0 ? ((OB_SABIT - beFiyat) / OB_SABIT) * 100 : 0),
          toplamGider: toplMaliyet + komisyonT, netKar: nk499, gercekM,
          deadZone: true, olduBolge: true, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
          currCommissionAmt, currNetProfit, currMargin
        };
      }
    }
    return { hata: "Hedef marj yüksek komisyon kademesiyle de elde edilemiyor.", currCommissionAmt, currNetProfit, currMargin };
  }
  const fiyatYuk = en90eYuvarla(toplMaliyet / paydaYuk);

  if (fiyatYuk >= SINIR) {
    const kar499 = OB_SABIT - toplMaliyet - (OB_SABIT * KOMIS_DUS);
    const karYuk = fiyatYuk - toplMaliyet - (fiyatYuk * KOMIS_YUK);
    const karDusHigh = fiyatDus - toplMaliyet - (fiyatDus * KOMIS_YUK);

    // T2'yi geçmek için genişletilmiş Dead Zone kontrolü
    if (kar499 >= karYuk || kar499 >= karDusHigh) {
      const komisyonT = OB_SABIT * KOMIS_DUS;
      const netKar = OB_SABIT - toplMaliyet - komisyonT;
      const gercekM = (netKar / OB_SABIT) * 100;

      // GUARDRAIL: Flash Crash Protection (Dead Zone OB_SABIT)
      if (OB_SABIT > 0 && beFiyat > 0 && OB_SABIT < beFiyat) {
        return { hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + OB_SABIT + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.", currCommissionAmt, currNetProfit, currMargin };
      }

      return {
        satisF: OB_SABIT, komisyonO: KOMIS_DUS * 100, komisyonT,
        breakEvenPrice: beFiyat, maxDiscount: (OB_SABIT > 0 && beFiyat > 0 ? ((OB_SABIT - beFiyat) / OB_SABIT) * 100 : 0),
        toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
        deadZone: true, olduBolge: true, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
        currCommissionAmt, currNetProfit, currMargin
      };
    } else {
      const komisyonT = fiyatYuk * KOMIS_YUK;
      const netKar = fiyatYuk - toplMaliyet - komisyonT;
      const gercekM = (netKar / fiyatYuk) * 100;

      // GUARDRAIL: Flash Crash Protection (K_HIGH tier)
      if (fiyatYuk > 0 && beFiyat > 0 && fiyatYuk < beFiyat) {
        return { hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + fiyatYuk + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.", currCommissionAmt, currNetProfit, currMargin };
      }

      return {
        satisF: fiyatYuk, komisyonO: KOMIS_YUK * 100, komisyonT,
        breakEvenPrice: beFiyat, maxDiscount: (fiyatYuk > 0 && beFiyat > 0 ? ((fiyatYuk - beFiyat) / fiyatYuk) * 100 : 0),
        toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
        deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
        currCommissionAmt, currNetProfit, currMargin
      };
    }
  }

  // If fiyat_yuksek < 500, we just use fiyatDus
  const komisyonT = fiyatDus * KOMIS_DUS;
  const netKar = fiyatDus - toplMaliyet - komisyonT;
  const gercekM = (netKar / fiyatDus) * 100;

  // GUARDRAIL: Flash Crash Protection (K_LOW fallback)
  if (fiyatDus > 0 && beFiyat > 0 && fiyatDus < beFiyat) {
    return { hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + fiyatDus + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.", currCommissionAmt, currNetProfit, currMargin };
  }

  return {
    satisF: fiyatDus, komisyonO: KOMIS_DUS * 100, komisyonT,
    breakEvenPrice: beFiyat, maxDiscount: (fiyatDus > 0 && beFiyat > 0 ? ((fiyatDus - beFiyat) / fiyatDus) * 100 : 0),
    toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
    deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
    currCommissionAmt, currNetProfit, currMargin
  };
}

/* ══════════════════════════════════════════
   SEKME GEÇİŞİ
/* ══════════════════════════════════════════ */
const SEKME = {
  amazon:  {baslik:"Amazon Envanteri",  alt:"%10,8 / %16,8 komisyon \u00B7 \u00D6l\u00FC B\u00F6lge korumas\u0131 \u00B7 X,90 yuvarlama \u00B7 Br\u00FCt fiyat bazl\u0131 hesaplama"},
  trendyol:{baslik:"Trendyol Envanteri",alt:"De\u011Fi\u015Fken komisyon \u00B7 \u00DCr\u00FCne \u00F6zel kargo \u00B7 X,90 yuvarlama"},
};
function sekmeGec(id) {
  document.querySelectorAll(".nav-tab[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===id));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+id));
  const c=SEKME[id]||{};
  document.getElementById("page-title").textContent   =c.baslik||"";
  document.getElementById("page-subtitle").textContent=c.alt||"";
}

/* ══════════════════════════════════════════
   KÜRESEL PARAMETRE OLAYLARI
══════════════════════════════════════════ */
function amazonYenidenHesapla() {
  STATE.amazon = STATE.amazon.map(p => {
    const marj = p.bireyselMarj ?? GP.marj;
    const r = amazonHesap(p.maliyet||0, p.ambalaj||0, p.sabit||0, GP.kargo, marj, p.category || "kozmetik", p.buyboxPrice || null, p.currentPrice||0);
    return r.hata ? { ...p, currCommissionAmt: r.currCommissionAmt, currNetProfit: r.currNetProfit, currMargin: r.currMargin } : { ...p, ...r };
  });
  kaydet("amazon");
  amazonRender();
}

function gpGuncelle() {
  const k = parseFloat(document.getElementById("gp-shipping").value);
  const m = parseFloat(document.getElementById("gp-margin").value);
  if (!isNaN(k)) GP.setKargo(k);
  if (!isNaN(m)) GP.setMarj(m);
  amazonYenidenHesapla();
}

function gpTyGuncelle() {
  const c = parseFloat(document.getElementById("gp-ty-commission").value);
  const s = parseFloat(document.getElementById("gp-ty-shipping").value);
  const m = parseFloat(document.getElementById("gp-ty-margin").value);
  if (!isNaN(c)) GP.setTyKomis(c);
  if (!isNaN(s)) GP.setTyKargo(s);
  if (!isNaN(m)) GP.setTyMarj(m);
  trendyolYenidenHesapla();
}

/* ══════════════════════════════════════════
   MODAL YÖNETİMİ
══════════════════════════════════════════ */
let modalMod = null; // null = yeni, number = product.id

function modalAc(urunId) {
  modalMod = urunId;
  const baslik = urunId ? "Ürünü Düzenle" : "Yeni Ürün Ekle";
  document.getElementById("modal-title").textContent = baslik;
  document.getElementById("modal-error").classList.add("hidden");

  if (urunId) {
    const p = STATE.amazon.find(x => x.id === urunId);
    if (!p) return;
    document.getElementById("modal-name").value   = p.ad || "";
    document.getElementById("modal-sku").value    = p.sku  || "";
    document.getElementById("modal-asin").value   = p.asin || "";
    document.getElementById("modal-cost").value   = p.maliyet || 0;
    document.getElementById("modal-pkg").value    = p.ambalaj || 0;
    document.getElementById("modal-fixed").value  = p.sabit || 0;
    document.getElementById("modal-margin").value = p.bireyselMarj ?? "";
    document.getElementById("modal-amz-category").value = p.category || "kozmetik";
  } else {
    temizle("modal-name","modal-sku","modal-asin","modal-cost","modal-pkg","modal-fixed","modal-margin");
    document.getElementById("modal-amz-category").value = "kozmetik";
  }

  document.getElementById("modal-backdrop").classList.remove("hidden");
  document.getElementById("modal-drawer").classList.remove("hidden");
  modalOnizle();
  document.getElementById("modal-name").focus();
}

function modalKapat() {
  document.getElementById("modal-backdrop").classList.add("hidden");
  document.getElementById("modal-drawer").classList.add("hidden");
  modalMod = null;
}

function modalOnizle() {
  const maliyet = parseFloat(document.getElementById("modal-cost").value)  || 0;
  const ambalaj = parseFloat(document.getElementById("modal-pkg").value)   || 0;
  const sabit   = parseFloat(document.getElementById("modal-fixed").value) || 0;
  const marjInp = parseFloat(document.getElementById("modal-margin").value);
  const marj    = isNaN(marjInp) ? GP.marj : marjInp;
  const kargo   = GP.kargo;
  const toplam  = maliyet + ambalaj + sabit;

  const kat = document.getElementById("modal-amz-category").value;
  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;
  const buybox = existingProduct ? (existingProduct.buyboxPrice || null) : null;

  const r = amazonHesap(maliyet, ambalaj, sabit, kargo, marj, kat, buybox, currentPrice);
  if (r.hata) {
    const isMissing = r.missingCogs === true;
    document.getElementById("amazon-onerilen-fiyat").textContent = isMissing ? "⚠️ Maliyet Giriniz" : "—";
    document.getElementById("amazon-onerilen-fiyat").style.color = isMissing ? "var(--accent-red)" : "var(--text-primary)";
    
    document.getElementById("amazon-cogs-goster").textContent = "—";
    document.getElementById("amazon-komisyon-goster").textContent = "—";
    document.getElementById("amazon-kargo-goster").textContent = "—";
    const amzBeEl = document.getElementById("amazon-be-fiyat");
  const amzMaxEl = document.getElementById("amazon-max-discount");
  if (amzBeEl) amzBeEl.textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  if (amzMaxEl) amzMaxEl.textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
      document.getElementById("amazon-netkarpro").textContent = "—";
    document.getElementById("amazon-marj-badge").textContent = "—";
    document.getElementById("amazon-deadzone-uyari").classList.add("hidden");
    document.getElementById("amazon-buybox-panel").classList.add("hidden");
    
    if (isMissing) {
      document.getElementById("modal-error").classList.add("hidden");
    } else {
      document.getElementById("modal-error").textContent = r.hata;
      document.getElementById("modal-error").classList.remove("hidden");
    }
    
    const currBlock = document.getElementById("prev-amz-curr-block");
    if (currBlock) currBlock.classList.add("hidden");
    return;
  }
  document.getElementById("amazon-onerilen-fiyat").style.color = "var(--text-primary)";
  
  document.getElementById("modal-error").classList.add("hidden");
  document.getElementById("amazon-onerilen-fiyat").textContent = para(r.satisF);
  document.getElementById("amazon-cogs-goster").textContent = para(toplam);
  document.getElementById("amazon-komisyon-goster").textContent = para(r.komisyonT) + " (" + yuzde(r.komisyonO) + ")";
  document.getElementById("amazon-kargo-goster").textContent = para(kargo);
  const amzBeEl = document.getElementById("amazon-be-fiyat");
  const amzMaxEl = document.getElementById("amazon-max-discount");
  if (amzBeEl) amzBeEl.textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  if (amzMaxEl) amzMaxEl.textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
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
  }

  const currBlock = document.getElementById("prev-amz-curr-block");
  if (currBlock) {
    if (currentPrice > 0) {
      currBlock.classList.remove("hidden");
      document.getElementById("prev-amz-curr-price").textContent = para(currentPrice);
      document.getElementById("prev-amz-curr-net").textContent = para(r.currNetProfit);
      
      const marginEl = document.getElementById("prev-amz-curr-margin");
      marginEl.textContent = `%${(r.currMargin || 0).toFixed(2)}`;
      
      const targetMargin = isNaN(marjInp) ? GP.marj : marjInp;
      if (r.currMargin < targetMargin || r.currNetProfit < 0) {
        marginEl.style.color = "var(--accent-red)";
      } else {
        marginEl.style.color = "var(--accent-green)";
      }
    } else {
      currBlock.classList.add("hidden");
    }
  }
}

function modalKaydet() {
  const ad     = document.getElementById("modal-name").value.trim();
  const sku    = document.getElementById("modal-sku").value.trim();
  const asin   = document.getElementById("modal-asin").value.trim();
  const maliyet= parseFloat(document.getElementById("modal-cost").value)  || 0;
  const ambalaj= parseFloat(document.getElementById("modal-pkg").value)   || 0;
  const sabit  = parseFloat(document.getElementById("modal-fixed").value) || 0;
  const marjInp= parseFloat(document.getElementById("modal-margin").value);
  const bireyselMarj = isNaN(marjInp) ? null : marjInp;
  const marj   = bireyselMarj ?? GP.marj;

  const kat = document.getElementById("modal-amz-category").value;
  const existingProduct = modalMod ? STATE.amazon.find(x => x.id === modalMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;
  const buybox = existingProduct ? (existingProduct.buyboxPrice || null) : null;

  if (!ad) { hata("modal-error","Ürün adı zorunludur."); return; }

  const r = amazonHesap(maliyet, ambalaj, sabit, GP.kargo, marj, kat, buybox, currentPrice);
  if (r.hata) { hata("modal-error", r.hata); return; }

  const yeniVeri = { 
    ad, sku, asin, maliyet, ambalaj, sabit, bireyselMarj, 
    currentPrice, category: kat, buyboxPrice: buybox, ...r 
  };

  if (modalMod) {
    const idx = STATE.amazon.findIndex(x => x.id === modalMod);
    if (idx !== -1) STATE.amazon[idx] = { ...STATE.amazon[idx], ...yeniVeri };
  } else {
    STATE.amazon.push({ id: Date.now(), ...yeniVeri });
  }

  kaydet("amazon");
  amazonRender();
  modalKapat();
}

/* ══════════════════════════════════════════
   AMAZON RENDER (SALT-OKUNUR TABLO)
══════════════════════════════════════════ */
function durumRozet(r) {
  if (r.olduBolge) return '<span class="note-dz">\u26A0 \u00D6l\u00FC B\u00F6lge</span>';
  return r.komisyonO <= 10.8
    ? '<span class="note-low">%10,8</span>'
    : '<span class="note-high">%16,8</span>';
}

function amazonRender() {
  const tbody = document.getElementById("amazon-tbody");
  const empty = document.getElementById("amazon-empty");
  const badge = document.getElementById("badge-amazon");
  const data  = STATE.amazon;
  if (badge) badge.textContent = data.length;
  if (!data.length) { tbody.innerHTML=""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  const sil = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const duz = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  tbody.innerHTML = data.map((p,i) => {
    const toplam = (p.maliyet||0)+(p.ambalaj||0)+(p.sabit||0);
    // SKU / ASIN meta satırı
    const metaParcalar = [];
    if (p.sku)  metaParcalar.push('SKU: ' + htmlK(p.sku));
    if (p.asin) metaParcalar.push('ASIN: ' + htmlK(p.asin));
    const metaHtml = metaParcalar.length
      ? `<div class="td-meta">${metaParcalar.join(' | ')}</div>`
      : '';

    const currentPriceText = p.currentPrice && p.currentPrice > 0 ? para(p.currentPrice) : "—";
    
    let currentMarginText = "—";
    let trClass = "";
    const targetMargin = p.bireyselMarj ?? GP.marj;
    
    if (p.currentPrice && p.currentPrice > 0) {
      const marginVal = p.currMargin !== undefined && p.currMargin !== null ? p.currMargin : 0;
      currentMarginText = `%${marginVal.toFixed(1)}`;
      
      const isDanger = (marginVal < targetMargin) || (p.currNetProfit < 0);
      if (isDanger) {
        trClass = "row-danger";
      }
    }

    const isMissingCogs = p.missingCogs === true;
    if (isMissingCogs) trClass = "row-danger";

    let recPriceHtml;
    if (isMissingCogs) {
      recPriceHtml = `<div style="background-color: rgba(239, 68, 68, 0.15); color: var(--accent-red); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-align: center;">⚠️ Maliyet Gir</div>`;
    } else {
      recPriceHtml = `<span class="td-price" style="font-size: 14px; font-weight: 800;">${para(p.satisF||0)}</span>`;
    }
    
    const targetMarginHtml = isMissingCogs ? '—' : `%${targetMargin}`;

    let bbCell = '';
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
      <td>${para(toplam)}</td>
      <td class="td-price">${currentPriceText}</td>
      <td style="font-weight: 600;">${currentMarginText}</td>
      <td style="font-weight: 700; white-space: nowrap; vertical-align: middle;">${recPriceHtml}</td>
      <td class="td-profit" style="color: var(--text-secondary);">${targetMarginHtml}</td>
      <td>${durumRozet(p)}</td>
      <td style="white-space:nowrap">
        <button class="btn-edit" onclick="modalAc(${p.id})">${duz} Düzenle</button>
        <button class="btn-delete" onclick="amazonSil(${p.id})" title="Sil">${sil}</button>
      </td>
    </tr>`;
  }).join("");
}

function amazonSil(id) {
  if (!confirm("Bu ürün silinecek. Onaylıyor musunuz?")) return;
  STATE.amazon = STATE.amazon.filter(p => p.id !== id);
  kaydet("amazon");
  amazonRender();
}

/* ══════════════════════════════════════════
   CSV İÇE AKTARMA
══════════════════════════════════════════ */
function csvOku(metin) {
  const satirlar = metin.split(/\r?\n/).filter(line => line.trim() !== "");
  if (satirlar.length === 0) return [];
  
  const ilkSatir = satirlar[0];
  let sep = ",";
  const virguller = (ilkSatir.match(/,/g) || []).length;
  const noktalivirguller = (ilkSatir.match(/;/g) || []).length;
  if (noktalivirguller > virguller) {
    sep = ";";
  }

  const sonuc = [];
  for (const s of satirlar) {
    const h = [];
    let hucre = "", tirnak = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') {
        if (tirnak && s[i+1] === '"') {
          hucre += '"';
          i++;
        } else {
          tirnak = !tirnak;
        }
      } else if (c === sep && !tirnak) {
        h.push(hucre.trim());
        hucre = "";
      } else {
        hucre += c;
      }
    }
    h.push(hucre.trim());
    sonuc.push(h);
  }
  return sonuc;
}

function gosterFeedback(id, mesaj, hataFlag) {
  const el=document.getElementById(id);
  if(!el) return;
  el.textContent=mesaj;
  el.className="import-feedback"+(hataFlag?" error":"");
  el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),6000);
}

function processAmazonRawCSV(metin) {
  const satirlar=csvOku(metin);
  if (satirlar.length<2) { gosterFeedback("amazon-import-feedback","CSV dosyası boş veya hatalı.",true); return; }

  // Sütun indekslerini başlık satırından tespit et
  const baslik = satirlar[0].map(h => h.replace(/"/g,"").trim());
  const skuIdx  = baslik.findIndex(h => /^sku$/i.test(h))                    !== -1
                ? baslik.findIndex(h => /^sku$/i.test(h)) : 0;
  const asinIdx = baslik.findIndex(h => /^asin$/i.test(h))                   !== -1
                ? baslik.findIndex(h => /^asin$/i.test(h)) : 1;
  let   adIdx   = baslik.findIndex(h => h === "Ürün Başlığı");
  if (adIdx === -1) adIdx = 2; // varsayılan indeks
  const currentPriceIdx = baslik.findIndex(h => /^mevcut\s*fiyat$/i.test(h));

  const parseVal = (val) => {
    if (val === undefined || val === null) return null;
    if (typeof val === "number") return val;
    let clean = String(val).trim();
    if (!clean) return null;
    if (clean.includes(",")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
  };

  const bbFiyatIdx = baslik.findIndex(h => /^öne çıkan teklif fiyatı$/i.test(h));

  let eklendi = 0, guncellendi = 0;

  for (let i=1; i<satirlar.length; i++) {
    const satir = satirlar[i];
    if (!satir || satir.length < 2) continue;

    const sku  = (satir[skuIdx]  || "").replace(/^"|"$/g,"").trim();
    const asin = (satir[asinIdx] || "").replace(/^"|"$/g,"").trim();
    const ad   = (satir[adIdx]   || "").replace(/^"|"$/g,"").trim();
    if (!ad) continue;

    const currentPrice = currentPriceIdx !== -1 ? (parseVal(satir[currentPriceIdx]) || 0) : 0;
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
      const r = amazonHesap(0, 0, 0, GP.kargo, GP.marj, "kozmetik", buyboxPrice, currentPrice);
      if (!r.hata || r.missingCogs) {
        STATE.amazon.push({
          id: Date.now() + i,
          ad, sku, asin,
          maliyet:0, ambalaj:0, sabit:0, bireyselMarj:null,
          currentPrice, buyboxPrice, category: "kozmetik",
          ...r
        });
        eklendi++;
      }
    }
  }

  amazonYenidenHesapla();

  const mesaj = [];
  if (eklendi)     mesaj.push(eklendi + " yeni ürün eklendi");
  if (guncellendi) mesaj.push(guncellendi + " ürün güncellendi (finansal veriler korundu)");

  const finalMsj = mesaj.length > 0 ? mesaj.join(" · ") + "." : "CSV'den geçerli ürün bulunamadı veya işlem yapılmadı.";
  gosterFeedback("amazon-import-feedback", finalMsj, mesaj.length === 0);
}

/* ══════════════════════════════════════════
   TRENDYOL HESAPLAMA & MANTIK
══════════════════════════════════════════ */

function trendyolRound90(p) {
  let p_ceil = Math.ceil(p * 100) / 100;
  let d = Math.floor(p_ceil / 10);
  let c = d * 10 + 9.90;
  if (c < p_ceil) c += 10;
  return parseFloat(c.toFixed(2));
}
const BAREM_KURALLARI = [
  { maxBirimF: 25, minAdet: 6 },
  { maxBirimF: 35, minAdet: 3 },
  { maxBirimF: 50, minAdet: 3 },
  { maxBirimF: 75, minAdet: 2 }
];

function calcGrupB(birimCogs, aktifKomis, kdv_t, hizmetBedeli, kargoKDVharic, kargoKDVdahil) {
  const GIZLI_GIDER = APP_CONFIG.TRENDYOL.GIZLI_GIDER;
  const marj = APP_CONFIG.TRENDYOL.TRAFIK_SABIT_MARJ / 100;
  const kdvMultiplier = kdv_t / (100 + kdv_t);
  const divisor = 1 - (aktifKomis / 100) - marj - kdvMultiplier;
  const divisorBE = 1 - (aktifKomis / 100) - kdvMultiplier;

  for (let kural of BAREM_KURALLARI) {
    const totalCostBase = (birimCogs * kural.minAdet) + hizmetBedeli + kargoKDVharic + GIZLI_GIDER;
    const targetSetF = totalCostBase / divisor;
    let tavsiyeBirimF = trendyolRound90(targetSetF / kural.minAdet);
    
    // PATCH Bug2: Strict cross-tier boundary validation after rounding
    // Check that the rounded price still belongs to the SAME MOQ tier, not a neighbouring one.
    const minF = kural.minBirimF || 0;
    if (tavsiyeBirimF > kural.maxBirimF || tavsiyeBirimF <= minF) {
      continue; // Price migrated to a different tier after rounding — skip.
    }
    // Additionally verify no OTHER rule with a different minAdet would claim this price.
    const matchingRule = BAREM_KURALLARI.find(b => tavsiyeBirimF > (b.minBirimF || 0) && tavsiyeBirimF <= b.maxBirimF);
    if (!matchingRule || matchingRule.minAdet !== kural.minAdet) {
      continue; // Rounded price belongs to a different MOQ tier — skip this iteration.
    }

    if (tavsiyeBirimF <= kural.maxBirimF) {
      const setF_min = tavsiyeBirimF * kural.minAdet;
      const komisyon = setF_min * (aktifKomis / 100);
      const kdvTahsil = setF_min * kdvMultiplier;
      const kargoKDViadesi = kargoKDVharic * (kdv_t / 100);
      const netKDV = Math.max(0, kdvTahsil - kargoKDViadesi);
      const rawProfit = setF_min - (birimCogs * kural.minAdet) - kargoKDVdahil - hizmetBedeli - komisyon;
      const netKar_min = rawProfit - GIZLI_GIDER - netKDV;
      const marj_min = (netKar_min / setF_min) * 100;

      const beSetF = totalCostBase / divisorBE;
      const breakEven_birimF = beSetF / kural.minAdet;

      return {
        isGrupBMode: true,
        tavsiyeBirimF,
        minAdet: kural.minAdet,
        setF_min,
        netKar_min,
        marj_min,
        breakEven_birimF,
        rawProfit,
        netVAT: netKDV
      };
    }
  }
  return null;
}

function breakEvenFiyat(tm, komPct, kdvPct, hizmet, iadeA) {
  const k = komPct / 100;
  const kdv_t = (kdvPct / 100) / (1 + kdvPct / 100);
  const coef = 1 - k - kdv_t;
  if (coef <= 0) return 0;
  
  const GIZLI_GIDER = APP_CONFIG.TRENDYOL.GIZLI_GIDER;
  const SABIT_GIDER = APP_CONFIG.TRENDYOL.SABIT_GIDER;
  
  const bands = [
    { kh: 41.00 / (1 + kdvPct/100), kd: 41.00, lo: 0, hi: 199.99 },
    { kh: 79.00 / (1 + kdvPct/100), kd: 79.00, lo: 200, hi: 349.99 },
    { kh: GP.tyKargo / (1 + kdvPct/100), kd: GP.tyKargo, lo: 350, hi: Infinity }
  ];
  
  for (const b of bands) {
    const fixed = tm + b.kh + hizmet + GIZLI_GIDER + SABIT_GIDER + iadeA;
    const f0 = fixed / coef;
    if (f0 >= b.lo && f0 <= b.hi) {
      return Math.round(f0 * 100) / 100;
    }
  }
  return 0;
}

function trendyolHesap(maliyet, ambalaj, sabit, ozelKomis, komisyonBitis, ozelMarj, vatSell, bugunKargoda, currentPrice, isTrafficStrategy = false) {
  let aktifKomis = GP.tyKomis;
  const ozelKomisNum = parseFloat(ozelKomis);
  if (ozelKomis !== null && ozelKomis !== undefined && ozelKomis !== "" && !isNaN(ozelKomisNum)) {
    let kullanOzel = true;
    if (komisyonBitis) {
      const bugun = new Date();
      bugun.setHours(0,0,0,0);
      const kt = new Date(komisyonBitis);
      if (kt < bugun) {
        kullanOzel = false;
      }
    }
    if (kullanOzel) {
      aktifKomis = ozelKomisNum;
    }
  }

  const marj = (ozelMarj === null || ozelMarj === undefined || isNaN(ozelMarj)) ? GP.tyMarj : ozelMarj;
  const hizmetBedeli = bugunKargoda ? APP_CONFIG.TRENDYOL.HIZMET_BEDELI_KAMPANYA : APP_CONFIG.TRENDYOL.HIZMET_BEDELI_STANDART;

  // Fixed overhead (deducted in netKar, NOT in brutKar)
  const GIZLI_GIDER = APP_CONFIG.TRENDYOL.GIZLI_GIDER;
  const SABIT_GIDER = APP_CONFIG.TRENDYOL.SABIT_GIDER;

  // cogs = direct product costs (user-entered: Maliyet + Ambalaj + Sabit Maliyet/Birim)
  const cogs = maliyet + ambalaj + sabit;

  // ── DEFENSIVE: Missing COGS Guard ─────────────────────────────────────────
  if (cogs <= 0) {
    return {
      hata: "Maliyet Eksik",
      missingCogs: true,
      satisF: 0, rawProfit: 0, netVAT: 0, netProfit: 0,
      finalKargo: 0, hizmetBedeli, aktifKomis, baremOpt: false,
      currShipping: 0, currCommissionAmt: 0, currRawProfit: 0,
      currNetVat: 0, currNetProfit: 0, currMargin: null
    };
  }

  const kdvMultiplier = vatSell / (100 + vatSell);
  const divisor = 1 - (aktifKomis / 100) - (marj / 100) - kdvMultiplier;
  if (divisor <= 0) {
    return {
      hata: "Komisyon + Hedef Marj + KDV %100 veya üstündedir.",
      currShipping: 0, currCommissionAmt: 0, currRawProfit: 0,
      currNetVat: 0, currNetProfit: 0, currMargin: null
    };
  }

  // ── EXACT DATA SCIENTIST FORMULAS ────────────────────────────────────────
  // Calculates brutKar and netKar for any given salePrice + kargoKDVdahil
  function calcFullProfit(salePrice, kargoKDVdahil) {
    // 1. Commission
    const komisyon = salePrice * (aktifKomis / 100);

    // 2. Net VAT (Cargo Offset)
    const kargoKDVharic  = kargoKDVdahil / (1 + (vatSell / 100));
    const kdvTahsil      = salePrice * (vatSell / (100 + vatSell));
    const kargoKDViadesi = kargoKDVharic * (vatSell / 100);
    const netKDV         = Math.max(0, kdvTahsil - kargoKDViadesi);

    // 3. Gross Profit — only direct operational costs subtracted
    const brutKar = salePrice - cogs - kargoKDVdahil - hizmetBedeli - komisyon;

    // 4. Net Profit — subtract fixed overhead, return allowance, and tax burden
    const iadePayi = (salePrice > APP_CONFIG.TRENDYOL.TRAFIK_LIMIT_FIYAT) ? APP_CONFIG.TRENDYOL.IADE_PAYI : 0;
    const netKar   = brutKar - GIZLI_GIDER - SABIT_GIDER - iadePayi - netKDV;

    return { komisyon, netKDV, brutKar, iadePayi, netKar };
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Helper: minimum .90-rounded price satisfying the target margin
  // Uses VAT-exclusive shipping in cost base to match the VAT-inclusive divisor
  function getRawRecommended(kargoKDVdahil, hasReturn) {
    const iadePayi      = hasReturn ? APP_CONFIG.TRENDYOL.IADE_PAYI : 0;
    const kargoKDVharic = kargoKDVdahil / (1 + (vatSell / 100));
    const totalCostBase = cogs + hizmetBedeli + kargoKDVharic + GIZLI_GIDER + SABIT_GIDER + iadePayi;
    return trendyolRound90(totalCostBase / divisor);
  }

  if (isTrafficStrategy) {
    const kargoKDVdahil = 41.00;
    const kargoKDVharic = kargoKDVdahil / (1 + (vatSell / 100));
    const resGrupB = calcGrupB(cogs, aktifKomis, vatSell, hizmetBedeli, kargoKDVharic, kargoKDVdahil);
    
    if (resGrupB) {
      let currShipping = 0, currCommissionAmt = 0, currRawProfit = 0;
      let currNetVat = 0, currNetProfit = 0, currMargin = null;
      
      const curPriceVal = parseFloat(currentPrice) || 0;
      if (curPriceVal > 0) {
        currShipping = curPriceVal <= 199.99 ? 41.00 : curPriceVal <= 349.99 ? 79.00 : GP.tyKargo;
        const curr = calcFullProfit(curPriceVal, currShipping);
        currCommissionAmt = curr.komisyon;
        currRawProfit     = curr.brutKar;
        currNetVat        = curr.netKDV;
        currNetProfit     = curr.netKar;
        currMargin        = (currNetProfit / curPriceVal) * 100;
      }

      return {
        missingCogs: false,
        satisF: resGrupB.tavsiyeBirimF,
        rawProfit: resGrupB.rawProfit,
        netVAT: resGrupB.netVAT,
        netProfit: resGrupB.netKar_min,
        finalKargo: kargoKDVdahil,
        hizmetBedeli,
        aktifKomis,
        baremOpt: false,
        currShipping,
        currCommissionAmt,
        currRawProfit,
        currNetVat,
        currNetProfit,
        currMargin,
        isGrupBMode: resGrupB.isGrupBMode,
        minAdet: resGrupB.minAdet,
        breakEven_birimF: resGrupB.breakEven_birimF,
        setF_min: resGrupB.setF_min,
        marj_min: resGrupB.marj_min,
        netKar_min: resGrupB.netKar_min
      };
    } else {
      return {
        hata: "Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor).",
        missingCogs: false, satisF: 0, rawProfit: 0, netVAT: 0, netProfit: 0,
        finalKargo: 0, hizmetBedeli, aktifKomis, baremOpt: false,
        currShipping: 0, currCommissionAmt: 0, currRawProfit: 0,
        currNetVat: 0, currNetProfit: 0, currMargin: null
      };
    }
  }

  // Step 1, 2 & 3: Global Profit Maximizer (Candidate Approach)
  const candidates = [];
  const kargoTiers = [
    { kargo: 41.00, min: 0, max: 199.99 },
    { kargo: 79.00, min: 200, max: 349.99 },
    { kargo: GP.tyKargo, min: 350, max: Infinity }
  ];

  for (let tier of kargoTiers) {
    for (let hasReturn of [false, true]) {
      let price = getRawRecommended(tier.kargo, hasReturn);
      // Validate bounds and strictly enforce return rule (returns applied if price > 75)
      if (price >= tier.min && price <= tier.max) {
        if ((price > 75 && hasReturn) || (price <= 75 && !hasReturn)) {
          let profit = calcFullProfit(price, tier.kargo).netKar;
          candidates.push({ satisF: price, kargo: tier.kargo, profit });
        }
      }
    }
    // PATCH Bug3: For Tier 3 (350+ band), also try with forced hasReturn=true
    // since any price in 350+ range is always >75 and triggers return allowance.
    // This ensures the Tier 3 candidate is never dropped due to hasReturn mismatch.
    if (tier.min >= 350) {
      const priceT3 = getRawRecommended(tier.kargo, true);
      if (priceT3 >= tier.min) {
        const profitT3 = calcFullProfit(priceT3, tier.kargo).netKar;
        // Only add if not already in candidates (avoid duplicates)
        if (!candidates.find(c => c.satisF === priceT3 && c.kargo === tier.kargo)) {
          candidates.push({ satisF: priceT3, kargo: tier.kargo, profit: profitT3 });
        }
      }
    }
  }

  // Inject Barem Trap limits manually
  const traps = [ { price: 199.90, kargo: 41.00 }, { price: 349.90, kargo: 79.00 } ];
  for (let t of traps) {
    let profit = calcFullProfit(t.price, t.kargo).netKar;
    candidates.push({ satisF: t.price, kargo: t.kargo, profit });
  }

  candidates.sort((a, b) => b.profit - a.profit); // Sort by absolute highest net cash profit

  let satisF = 0, finalKargo = 0, baremOpt = false;
  if (candidates.length > 0) {
    satisF = candidates[0].satisF;
    finalKargo = candidates[0].kargo;
    baremOpt = (satisF === 199.90 || satisF === 349.90);
  } else {
    satisF = getRawRecommended(GP.tyKargo, true);
    finalKargo = GP.tyKargo;
  }
  
  const rec = calcFullProfit(satisF, finalKargo);
  
  // Calculate Break-Even & Max Discount
  const beFiyat = breakEvenFiyat(cogs, aktifKomis, vatSell, hizmetBedeli, (satisF > APP_CONFIG.TRENDYOL.TRAFIK_LIMIT_FIYAT ? APP_CONFIG.TRENDYOL.IADE_PAYI : 0));
  const maksIndirim = (satisF > 0 && beFiyat > 0) ? ((satisF - beFiyat) / satisF) * 100 : 0;

  // GUARDRAIL: Flash Crash Protection (Trendyol Final Price)
  if (satisF > 0 && beFiyat > 0 && satisF < beFiyat) {
    return {
      hata: "Sistem Sigortası (Flash Crash): Önerilen fiyat (" + satisF + " ₺), başa baş zarar sınırının (" + beFiyat.toFixed(2) + " ₺) altındadır. İşlem bloke edildi.",
      missingCogs: false, satisF: 0, rawProfit: 0, netVAT: 0, netProfit: 0,
      finalKargo: 0, hizmetBedeli, aktifKomis, baremOpt: false,
      currShipping: 0, currCommissionAmt: 0, currRawProfit: 0,
      currNetVat: 0, currNetProfit: 0, currMargin: null
    };
  }

  // Step 5: Current price profitability (shown in modal edit view)
  let currShipping = 0, currCommissionAmt = 0, currRawProfit = 0;
  let currNetVat = 0, currNetProfit = 0, currMargin = null;

  const curPriceVal = parseFloat(currentPrice) || 0;
  if (curPriceVal > 0) {
    currShipping = curPriceVal <= 199.99 ? 41.00 : curPriceVal <= 349.99 ? 79.00 : GP.tyKargo;
    const curr = calcFullProfit(curPriceVal, currShipping);
    currCommissionAmt = curr.komisyon;
    currRawProfit     = curr.brutKar;
    currNetVat        = curr.netKDV;
    currNetProfit     = curr.netKar;
    currMargin        = (currNetProfit / curPriceVal) * 100;
  }

  return {
    missingCogs: false,           // ← Sticky flag temizleme garantisi
    satisF,
    breakEvenPrice: beFiyat,
    maxDiscount: maksIndirim,
    rawProfit:  rec.brutKar,   // "Brut Kar" in modal preview
    netVAT:     rec.netKDV,    // "Odenecek KDV Yuku" in modal preview
    netProfit:  rec.netKar,    // "Net Kar (KDV Sonrasi)" in modal preview
    finalKargo,
    hizmetBedeli,
    aktifKomis,
    baremOpt,
    currShipping,
    currCommissionAmt,
    currRawProfit,
    currNetVat,
    currNetProfit,
    currMargin
  };
}

let modalTyMod = null;

function modalTyAc(id) {
  modalTyMod = id;
  const t = id ? "Ürünü Düzenle (Trendyol)" : "Yeni Ürün Ekle (Trendyol)";
  document.getElementById("modal-title-ty").textContent = t;
  document.getElementById("modal-ty-error").classList.add("hidden");

  if (id) {
    const p = STATE.trendyol.find(x => x.id === id);
    if (!p) return;
    document.getElementById("modal-ty-name").value = p.ad || "";
    document.getElementById("modal-ty-sku").value = p.sku || "";
    document.getElementById("modal-ty-asin").value = p.asin || "";
    document.getElementById("modal-ty-cost").value = p.maliyet || 0;
    document.getElementById("modal-ty-pkg").value = p.ambalaj || 0;
    document.getElementById("modal-ty-fixed").value = p.sabit || 0;
    document.getElementById("modal-ty-margin").value = p.bireyselMarj ?? "";
    document.getElementById("modal-ty-customcomm").value = p.ozelKomis ?? "";
    document.getElementById("modal-ty-commdate").value = p.komisyonBitis || p.komisTarih || "";
    document.getElementById("modal-ty-vatsell").value = p.vatSell ?? 20;
    document.getElementById("modal-ty-today").checked = p.bugunKargoda || false;
    document.getElementById("modal-ty-traffic").checked = p.isTrafficStrategy || false;
  } else {
    temizle("modal-ty-name","modal-ty-sku","modal-ty-asin","modal-ty-cost","modal-ty-pkg","modal-ty-fixed","modal-ty-margin","modal-ty-customcomm","modal-ty-commdate");
    document.getElementById("modal-ty-vatsell").value = 20;
    document.getElementById("modal-ty-today").checked = false;
    document.getElementById("modal-ty-traffic").checked = false;
  }
  document.getElementById("modal-backdrop-ty").classList.remove("hidden");
  document.getElementById("modal-drawer-ty").classList.remove("hidden");
  modalTyOnizle();
  document.getElementById("modal-ty-name").focus();
}

function modalTyKapat() {
  document.getElementById("modal-backdrop-ty").classList.add("hidden");
  document.getElementById("modal-drawer-ty").classList.add("hidden");
  modalTyMod = null;
}

function modalTyOnizle() {
  const mal = parseFloat(document.getElementById("modal-ty-cost").value) || 0;
  const amb = parseFloat(document.getElementById("modal-ty-pkg").value) || 0;
  const sab = parseFloat(document.getElementById("modal-ty-fixed").value) || 0;
  const marjVal = parseFloat(document.getElementById("modal-ty-margin").value);
  const marj = isNaN(marjVal) ? null : marjVal;
  const ozelKomisVal = parseFloat(document.getElementById("modal-ty-customcomm").value);
  const ozelKomis = isNaN(ozelKomisVal) ? "" : ozelKomisVal;
  const komisyonBitis = document.getElementById("modal-ty-commdate").value || "";
  const vatSell = parseFloat(document.getElementById("modal-ty-vatsell").value) || 20;
  const bugun = document.getElementById("modal-ty-today").checked;
  const isTraffic = document.getElementById("modal-ty-traffic").checked;

  const existingProduct = modalTyMod ? STATE.trendyol.find(x => x.id === modalTyMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;

  // Expiration check for preview
  let finalOzelKomis = ozelKomis;
  let finalKomisyonBitis = komisyonBitis;
  if (finalKomisyonBitis) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const kt = new Date(finalKomisyonBitis);
    if (kt < today) {
      finalOzelKomis = "";
      finalKomisyonBitis = "";
    }
  }

  const r = trendyolHesap(mal, amb, sab, finalOzelKomis, finalKomisyonBitis, marj, vatSell, bugun, currentPrice, isTraffic);
  if (r.hata) {
    const isMissing = r.missingCogs === true;
    const placeholder = isMissing ? "⚠️ Maliyet Giriniz" : "—";
    document.getElementById("prev-ty-price").textContent = placeholder;
    document.getElementById("prev-ty-cargo").textContent = "—";
    document.getElementById("prev-ty-raw").textContent = "—";
    document.getElementById("prev-ty-vat").textContent = "—";
    const tyBeEl = document.getElementById("prev-ty-be-fiyat");
  const tyMaxEl = document.getElementById("prev-ty-max-discount");
  if (tyBeEl) tyBeEl.textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  if (tyMaxEl) tyMaxEl.textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
      document.getElementById("prev-ty-net").textContent = "—";
    document.getElementById("prev-ty-title").textContent = "Birim Kâr Önizlemesi";
    document.getElementById("prev-ty-set-row").style.display = "none";
    document.getElementById("prev-ty-margin-pct").textContent = "—";
    document.getElementById("prev-ty-margin-pct").style.color = "";
    
    if (isMissing) {
      document.getElementById("prev-ty-price").style.color = "var(--accent-red)";
      document.getElementById("modal-ty-error").classList.add("hidden");
    } else {
      document.getElementById("prev-ty-price").style.color = "";
      document.getElementById("modal-ty-error").textContent = r.hata;
      document.getElementById("modal-ty-error").classList.remove("hidden");
    }
    
    const prevCurrBlock = document.getElementById("prev-ty-curr-block");
    if (prevCurrBlock) prevCurrBlock.classList.add("hidden");
    return;
  }
  document.getElementById("modal-ty-error").classList.add("hidden");
  document.getElementById("prev-ty-price").style.color = "";
  document.getElementById("prev-ty-price").textContent = para(r.satisF);
  document.getElementById("prev-ty-be-fiyat").textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  document.getElementById("prev-ty-max-discount").textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
  
  let marginVal;
  if (r.isGrupBMode) {
    const ek = r.minAdet === 6 ? "'lı" : r.minAdet === 3 ? "'lü" : "'li";
    document.getElementById("prev-ty-title").textContent = r.minAdet + ek + " Set Sepet Analizi";
    document.getElementById("prev-ty-set-row").style.display = "flex";
    document.getElementById("prev-ty-set-count").textContent = r.minAdet;
    document.getElementById("prev-ty-set-price").textContent = para(r.setF_min);
    marginVal = r.marj_min;
    const tyBeEl = document.getElementById("prev-ty-be-fiyat");
  const tyMaxEl = document.getElementById("prev-ty-max-discount");
  if (tyBeEl) tyBeEl.textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  if (tyMaxEl) tyMaxEl.textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
      document.getElementById("prev-ty-net").textContent = para(r.netKar_min);
  } else {
    document.getElementById("prev-ty-title").textContent = "Birim Kâr Önizlemesi";
    document.getElementById("prev-ty-set-row").style.display = "none";
    marginVal = (r.netProfit / r.satisF) * 100;
    const tyBeEl = document.getElementById("prev-ty-be-fiyat");
  const tyMaxEl = document.getElementById("prev-ty-max-discount");
  if (tyBeEl) tyBeEl.textContent = r.breakEvenPrice ? para(r.breakEvenPrice) : "—";
  if (tyMaxEl) tyMaxEl.textContent = r.maxDiscount ? "%" + r.maxDiscount.toFixed(2) : "—";
      document.getElementById("prev-ty-net").textContent = para(r.netProfit);
  }

  document.getElementById("prev-ty-cargo").textContent = para(r.finalKargo) + " + " + para(r.hizmetBedeli);
  document.getElementById("prev-ty-raw").textContent = para(r.rawProfit);
  document.getElementById("prev-ty-vat").textContent = para(r.netVAT);
  
  const marginEl = document.getElementById("prev-ty-margin-pct");
  marginEl.textContent = "%" + (marginVal || 0).toFixed(2);
  if (marginVal < 0) marginEl.style.color = "var(--accent-red)";
  else if (marginVal < 2) marginEl.style.color = "var(--accent-orange)";
  else marginEl.style.color = "var(--accent-green)";

  // Informational block for Current Price in the Edit Modal
  const prevCurrBlock = document.getElementById("prev-ty-curr-block");
  if (prevCurrBlock) {
    if (currentPrice > 0) {
      prevCurrBlock.classList.remove("hidden");
      document.getElementById("prev-ty-curr-price").textContent = para(currentPrice);
      document.getElementById("prev-ty-curr-net").textContent = para(r.currNetProfit);
      
      const marginEl = document.getElementById("prev-ty-curr-margin");
      marginEl.textContent = `%${(r.currMargin || 0).toFixed(2)}`;
      
      const targetMargin = (marj === null) ? GP.tyMarj : marj;
      if (r.currMargin < targetMargin) {
        marginEl.style.color = "var(--accent-red)";
      } else {
        marginEl.style.color = "var(--accent-green)";
      }
    } else {
      prevCurrBlock.classList.add("hidden");
    }
  }
}

function modalTyKaydet() {
  const ad = document.getElementById("modal-ty-name").value.trim();
  const sku = document.getElementById("modal-ty-sku").value.trim();
  const asin = document.getElementById("modal-ty-asin").value.trim();
  const mal = parseFloat(document.getElementById("modal-ty-cost").value) || 0;
  const amb = parseFloat(document.getElementById("modal-ty-pkg").value) || 0;
  const sab = parseFloat(document.getElementById("modal-ty-fixed").value) || 0;
  const m = parseFloat(document.getElementById("modal-ty-margin").value);
  const bireyselMarj = isNaN(m) ? null : m;
  const k = parseFloat(document.getElementById("modal-ty-customcomm").value);
  const ozelKomis = isNaN(k) ? "" : k;
  const komisyonBitis = document.getElementById("modal-ty-commdate").value || "";
  const vatSell = parseFloat(document.getElementById("modal-ty-vatsell").value) || 20;
  const bugun = document.getElementById("modal-ty-today").checked;
  const isTraffic = document.getElementById("modal-ty-traffic").checked;

  const existingProduct = modalTyMod ? STATE.trendyol.find(x => x.id === modalTyMod) : null;
  const currentPrice = existingProduct ? (existingProduct.currentPrice || 0) : 0;

  if (!ad) { hata("modal-ty-error","Ürün adı zorunludur."); return; }

  // Expiration check before save
  let finalOzelKomis = ozelKomis;
  let finalKomisyonBitis = komisyonBitis;
  if (finalKomisyonBitis) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const kt = new Date(finalKomisyonBitis);
    if (kt < today) {
      finalOzelKomis = "";
      finalKomisyonBitis = "";
    }
  }

  const r = trendyolHesap(mal, amb, sab, finalOzelKomis, finalKomisyonBitis, bireyselMarj, vatSell, bugun, currentPrice, isTraffic);
  if (r.hata && !r.missingCogs) { hata("modal-ty-error",r.hata); return; }

  const yeni = { 
    ad, sku, asin, 
    isTrafficStrategy: isTraffic,
    maliyet:mal, ambalaj:amb, sabit:sab, 
    bireyselMarj, 
    ozelKomis: finalOzelKomis, 
    komisyonBitis: finalKomisyonBitis,
    komisTarih: finalKomisyonBitis, // Keep for backward compatibility
    vatSell, bugunKargoda:bugun, 
    currentPrice,
    ...r 
  };

  if (modalTyMod) {
    const idx = STATE.trendyol.findIndex(x => x.id === modalTyMod);
    if (idx !== -1) STATE.trendyol[idx] = { ...STATE.trendyol[idx], ...yeni };
  } else {
    STATE.trendyol.push({ id: Date.now(), ...yeni });
  }

  kaydet("trendyol");
  trendyolRender();
  modalTyKapat();
}

function getTrendyolGroupAndMoq(price) {
  if (price > 75) {
    return { grup: "A", moq: 0 };
  } else {
    let moq = 1;
    if (price >= 0 && price <= 25) moq = 6;
    else if (price > 25 && price <= 35) moq = 3;
    else if (price > 35 && price <= 50) moq = 3;
    else if (price > 50 && price <= 75) moq = 2;
    return { grup: "B", moq };
  }
}

function trendyolRender() {
  const tbody = document.getElementById("trendyol-tbody");
  const empty = document.getElementById("trendyol-empty");
  const badge = document.getElementById("badge-trendyol");
  if(badge) badge.textContent = STATE.trendyol.length;
  
  if (!STATE.trendyol.length) { tbody.innerHTML=""; empty?.classList.remove("hidden"); return; }
  empty?.classList.add("hidden");

  const sil = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const duz = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  tbody.innerHTML = STATE.trendyol.map((p,i) => {
    const topMaliyet = (p.maliyet||0)+(p.ambalaj||0)+(p.sabit||0);
    const mP = [];
    if(p.sku) mP.push('SKU: '+htmlK(p.sku));
    if(p.asin) mP.push('ASIN: '+htmlK(p.asin));
    const mH = mP.length ? `<div class="td-meta">${mP.join(' | ')}</div>` : '';
    
    const currentPriceText = p.currentPrice && p.currentPrice > 0 ? para(p.currentPrice) : "—";
    
    let currentMarginText = "—";
    let trClass = "";
    const targetMargin = p.bireyselMarj ?? GP.tyMarj;
    
    if (p.currentPrice && p.currentPrice > 0) {
      const marginVal = p.currMargin !== undefined && p.currMargin !== null ? p.currMargin : 0;
      currentMarginText = `%${marginVal.toFixed(1)}`;
      
      const isDanger = (marginVal < targetMargin) || (p.currNetProfit < 0);
      if (isDanger) {
        trClass = "row-danger";
      }
    }
    
    // ── Defensive: Missing COGS rendering ──────────────────────────────────
    const isMissingCogs = p.missingCogs === true;

    // ── Group A / Group B Column ───────────────────────────────────────────
    let grpCell = '<td style="text-align: center; color: var(--text-muted);">—</td>';
    if (!p.missingCogs && p.satisF > 0) {
      const grpInfo = getTrendyolGroupAndMoq(p.satisF);
      if (grpInfo.grup === "A") {
        grpCell = '<td style="text-align: center;"><span class="badge" style="background: var(--bg-lighter); font-weight: 600;">A</span></td>';
      } else {
        grpCell = '<td style="text-align: center;"><span class="badge" style="background: rgba(167, 139, 250, 0.15); color: var(--accent-purple); font-weight: 700;">B - Min. ' + grpInfo.moq + '</span></td>';
      }
    }

    // ── BuyBox Status Column ───────────────────────────────────────────────
    let bbCell = '<td style="text-align: center; color: var(--text-muted);">—</td>';
    if (p.currentPrice === 0 && !p.buyboxPrice) {
      bbCell = '<td style="text-align: center; color: var(--text-muted);">—</td>';
    } else if (!p.buyboxPrice || p.buyboxPrice === 0 || p.currentPrice <= p.buyboxPrice) {
      bbCell = '<td style="text-align: center; font-size: 16px; cursor: help;" title="Buybox Bizde">✅</td>';
    } else {
      bbCell = '<td style="text-align: center; font-size: 16px; cursor: help;" title="Buybox Rakipte">❌</td>';
    }

    const baremBadge = p.baremOpt 
      ? `<span class="barem-badge" style="color: var(--accent-green); font-size: 10px; font-weight: 600; margin-left: 4px;">⚡ Barem Opt.</span>` 
      : "";

    // ── Recommended price column: show warning or price ───────────────────
    let recPriceHtml;
    if (isMissingCogs) {
      trClass = "row-danger";
      recPriceHtml = `<div style="background-color: rgba(239, 68, 68, 0.15); color: var(--accent-red); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-align: center;">⚠️ Maliyet Gir</div>`;
    } else {
      recPriceHtml = `<span class="td-price" style="font-size: 14px; font-weight: 800;">${para(p.satisF||0)}</span>${baremBadge}`;
    }

    // ── Target margin column: hide when no COGS ──────────────────────────
    const targetMarginHtml = isMissingCogs ? '—' : `%${targetMargin}`;

    return `<tr class="${trClass}">
      <td class="td-num">${i+1}</td>
      <td class="td-name-cell">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="td-name" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${htmlK(p.ad)}</span>
        </div>
        ${mH}
      </td>
      ${grpCell}
      ${bbCell}
      <td>${para(topMaliyet)}</td>
      <td class="td-price">${currentPriceText}</td>
      <td style="font-weight: 600;">${currentMarginText}</td>
      <td style="font-weight: 700; white-space: nowrap; vertical-align: middle;">
        ${recPriceHtml}
      </td>
      <td class="td-profit" style="color: var(--text-secondary);">${targetMarginHtml}</td>
      <td style="white-space:nowrap">
        <button class="btn-edit" onclick="modalTyAc(${p.id})">${duz} Düzenle</button>
        <button class="btn-delete" onclick="tySil(${p.id})">${sil}</button>
      </td>
    </tr>`;
  }).join("");
}

function tySil(id) {
  if(!confirm("Ürün silinecek. Onaylıyor musunuz?")) return;
  STATE.trendyol = STATE.trendyol.filter(p=>p.id!==id);
  kaydet("trendyol");
  trendyolRender();
}

function trendyolYenidenHesapla() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  STATE.trendyol = STATE.trendyol.map(p => {
    if (p.komisTarih && !p.komisyonBitis) {
      p.komisyonBitis = p.komisTarih;
    }
    
    let finalOzelKomis = p.ozelKomis;
    let finalKomisyonBitis = p.komisyonBitis;
    
    if (finalKomisyonBitis) {
      const kt = new Date(finalKomisyonBitis);
      if (kt < today) {
        finalOzelKomis = "";
        finalKomisyonBitis = "";
      }
    }
    
    p.ozelKomis = finalOzelKomis;
    p.komisyonBitis = finalKomisyonBitis;
    p.komisTarih = finalKomisyonBitis; // Keep synced

    const r = trendyolHesap(
      p.maliyet||0, 
      p.ambalaj||0, 
      p.sabit||0, 
      p.ozelKomis, 
      p.komisyonBitis, 
      p.bireyselMarj, 
      p.vatSell !== undefined ? p.vatSell : 20, 
      p.bugunKargoda||false,
      p.currentPrice||0,
      p.isTrafficStrategy||false
    );
    // missingCogs results still get spread so the render can see the flag
    if (r.hata && !r.missingCogs) return p;
    return { ...p, ...r };
  });
  kaydet("trendyol");
  trendyolRender();
}

function processTrendyolRawExcel(data) {
  try {
    const workbook = XLSX.read(data, {type: 'array'});
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const satirlar = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (satirlar.length < 2) {
      gosterFeedback("trendyol-import-feedback", "Hatalı veya boş Excel dosyası", true);
      return;
    }
    
    const baslik = satirlar[0].map(h => (h !== undefined && h !== null ? String(h).trim() : ""));
    
    const barkodIdx = baslik.indexOf("Barkod");
    const skuIdx = baslik.indexOf("Tedarikçi Stok Kodu");
    const adIdx = baslik.indexOf("Ürün Adı");
    const komisIdx = baslik.indexOf("Komisyon Oranı");
    const vatIdx = baslik.indexOf("KDV Oranı");
    const sevkiyatIdx = baslik.indexOf("Sevkiyat Tipi");
    const satisFiyatiIdx = baslik.indexOf("Trendyol'da Satılacak Fiyat (KDV Dahil)");
    const buyboxIdx = baslik.indexOf("BuyBox Fiyatı");

    if (adIdx === -1) {
      gosterFeedback("trendyol-import-feedback", "Hata: 'Ürün Adı' sütunu bulunamadı.", true);
      return;
    }

    const parseVal = (val) => {
      if (val === undefined || val === null) return null;
      if (typeof val === "number") return val;
      let clean = String(val).trim();
      if (!clean) return null;
      if (clean.includes(",")) {
        clean = clean.replace(/\./g, "").replace(",", ".");
      }
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? null : parsed;
    };

    const bbFiyatIdx = baslik.findIndex(h => /^öne çıkan teklif fiyatı$/i.test(h));

    let eklendi = 0;
    let guncellendi = 0;

    for (let i = 1; i < satirlar.length; i++) {
      const s = satirlar[i];
      if (!s || s.length < 1) continue;

      const name = adIdx !== -1 && s[adIdx] !== undefined && s[adIdx] !== null ? String(s[adIdx]).trim() : "";
      if (!name) continue;

      const sku = skuIdx !== -1 && s[skuIdx] !== undefined && s[skuIdx] !== null ? String(s[skuIdx]).trim() : "";
      const asin = barkodIdx !== -1 && s[barkodIdx] !== undefined && s[barkodIdx] !== null ? String(s[barkodIdx]).trim() : "";
      
      const customCommission = komisIdx !== -1 ? parseVal(s[komisIdx]) : null;
      const vatRate = vatIdx !== -1 ? parseVal(s[vatIdx]) : null;
      
      const sevkiyatVal = sevkiyatIdx !== -1 && s[sevkiyatIdx] !== undefined && s[sevkiyatIdx] !== null 
        ? String(s[sevkiyatIdx]).trim().toLowerCase() 
        : "";
      const shipsToday = sevkiyatVal === "bugün kargoda";
      const currentPrice = satisFiyatiIdx !== -1 ? (parseVal(s[satisFiyatiIdx]) || 0) : 0;
      const buyboxPrice = buyboxIdx !== -1 ? (parseVal(s[buyboxIdx]) || 0) : 0;

      const mIdx = STATE.trendyol.findIndex(p => 
        (asin && p.asin === asin) || (!asin && sku && p.sku === sku)
      );

      if (mIdx !== -1) {
        STATE.trendyol[mIdx].ad = name;
        if (sku) STATE.trendyol[mIdx].sku = sku;
        if (asin) STATE.trendyol[mIdx].asin = asin;
        STATE.trendyol[mIdx].ozelKomis = customCommission;
        if (vatRate !== null) {
          STATE.trendyol[mIdx].vatSell = vatRate;
        }
        STATE.trendyol[mIdx].bugunKargoda = shipsToday;
        STATE.trendyol[mIdx].currentPrice = currentPrice;
        STATE.trendyol[mIdx].buyboxPrice = buyboxPrice;
        guncellendi++;
      } else {
        const r = trendyolHesap(
          0, 
          0, 
          0, 
          customCommission, 
          "", 
          null, 
          vatRate !== null ? vatRate : 20, 
          shipsToday,
          currentPrice
        );
        STATE.trendyol.push({
          id: Date.now() + i,
          ad: name,
          sku,
          asin,
          maliyet: 0,
          ambalaj: 0,
          sabit: 0,
          bireyselMarj: null,
          ozelKomis: customCommission,
          komisTarih: "",
          komisyonBitis: "",
          vatSell: vatRate !== null ? vatRate : 20,
          bugunKargoda: shipsToday,
          currentPrice: currentPrice,
          buyboxPrice: buyboxPrice,
          ...r
        });
        eklendi++;
      }
    }

    trendyolYenidenHesapla();
    
    const msj = [];
    if (eklendi) msj.push(eklendi + " yeni ürün eklendi");
    if (guncellendi) msj.push(guncellendi + " ürün güncellendi");
    if (!eklendi && !guncellendi) msj.push("Yeni veri bulunamadı");
    
    gosterFeedback("trendyol-import-feedback", msj.join(" ve "), false);
  } catch (err) {
    console.error(err);
    gosterFeedback("trendyol-import-feedback", "Excel okuma hatası: " + err.message, true);
  }
}



/* ══════════════════════════════════════════
   TÜMÜNÜ SİL
══════════════════════════════════════════ */
document.getElementById("btn-clear-all")?.addEventListener("click",()=>{
  const aktif = document.querySelector(".nav-tab.active")?.dataset.tab || 
                (document.getElementById("panel-trendyol")?.classList.contains("active") ? "trendyol" : "amazon");
  if(!aktif) return;
  
  const platformGosterim = aktif === "trendyol" ? "Trendyol" : "Amazon";
  if(!confirm("Tüm " + platformGosterim + " ürünleri silinecek. Onaylıyor musunuz?")) return;
  
  STATE[aktif] = [];
  kaydet(aktif);
  
  if(aktif === "amazon") amazonRender();
  if(aktif === "trendyol") trendyolRender();
});

/* ══════════════════════════════════════════
   BAŞLATMA
══════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded",()=>{
  // Automated QA — runs silently on every page load
  runTrendyolQA();
  runBuyboxStressTest();

  // Sekme butonları
  document.querySelectorAll(".nav-tab[data-tab]").forEach(b=>b.addEventListener("click",()=>sekmeGec(b.dataset.tab)));

  // Küresel parametre inputları → başlangıç değerleri
  document.getElementById("gp-shipping").value = GP.kargo;
  document.getElementById("gp-margin").value = GP.marj;
  
  if(document.getElementById('gp-ty-commission')) { 
    document.getElementById('gp-ty-commission').value = GP.tyKomis; 
    document.getElementById('gp-ty-shipping').value = GP.tyKargo; 
    document.getElementById('gp-ty-margin').value = GP.tyMarj; 
  }

  document.getElementById("gp-shipping").addEventListener("change", gpGuncelle);
  document.getElementById("gp-margin").addEventListener("change",   gpGuncelle);
  document.getElementById("gp-ty-commission")?.addEventListener("change", gpTyGuncelle);
  document.getElementById("gp-ty-shipping")?.addEventListener("change",   gpTyGuncelle);
  document.getElementById("gp-ty-margin")?.addEventListener("change",     gpTyGuncelle);

  // Modal canlı önizleme (Amazon)
  ["modal-cost","modal-pkg","modal-fixed","modal-margin"].forEach(id=>{
    document.getElementById(id)?.addEventListener("input", modalOnizle);
  });

  // Modal canlı önizleme (Trendyol)
  ["modal-ty-cost","modal-ty-pkg","modal-ty-fixed","modal-ty-margin","modal-ty-customcomm","modal-ty-commdate","modal-ty-vatbuy","modal-ty-vatsell","modal-ty-today","modal-ty-traffic"].forEach(id=>{
    document.getElementById(id)?.addEventListener("input", modalTyOnizle);
  });

  // ESC modal kapat
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape") {
      modalKapat();
      modalTyKapat();
    }
  });

  // İlk render
  amazonYenidenHesapla();
  trendyolYenidenHesapla();
});

/* ══════════════════════════════════════════
   AUTOMATED QA TEST SUITE — Trendyol Engine
   Runs on every page load, results in DevTools console.
══════════════════════════════════════════ */
function runTrendyolQA() {
  const scenarios = [
    { id: "S2", label: "199.90 Trap",   cogs: 68,  marj: 5,  bugun: true,  vat: 20, komis: 19  },
    { id: "S3", label: "349.90 Trap",   cogs: 105, marj: 10, bugun: true,  vat: 20, komis: 19  },
    { id: "S4", label: "Campaign",      cogs: 45,  marj: 20, bugun: true,  vat: 20, komis: 12  },
    { id: "S5", label: "High Ticket",   cogs: 850, marj: 25, bugun: true,  vat: 20, komis: 19  },
    { id: "S6", label: "Standard",      cogs: 35,  marj: 15, bugun: false, vat: 20, komis: 19  },
  ];

  const results = scenarios.map(s => {
    const r = trendyolHesap(
      s.cogs,        // maliyet
      0,             // ambalaj
      0,             // sabit
      s.komis,       // ozelKomis
      "",            // komisyonBitis
      s.marj,        // ozelMarj
      s.vat,         // vatSell
      s.bugun,       // bugunKargoda
      0,             // currentPrice
      false          // isTrafficStrategy
    );
    return {
      Scenario:  `${s.id} (${s.label})`,
      SatışF:    r.satisF?.toFixed(2)   ?? "ERR",
      BrütKâr:   r.rawProfit?.toFixed(2) ?? "ERR",
      KDVYükü:   r.netVAT?.toFixed(2)    ?? "ERR",
      NetKâr:    r.netProfit?.toFixed(2)  ?? "ERR",
      Kargo:     r.finalKargo?.toFixed(2) ?? "ERR",
      Barem:     r.baremOpt ? "⚡ OPT" : "—",
    };
  });

  console.log("%c══ TRENDYOL QA TEST SUITE ══", "color:#00e676;font-weight:bold;font-size:14px;");
  console.table(results);
}

/* ══════════════════════════════════════════
   AUTOMATED BUYBOX STRESS TEST
══════════════════════════════════════════ */
function runBuyboxStressTest() {
  const parseValLocal = (val) => {
    if (val === undefined || val === null) return null;
    if (typeof val === "number") return val;
    let clean = String(val).trim();
    if (!clean) return null;
    if (clean.includes(",")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
  };

  const testCases = [
    { id: "S1", desc: "Exact Tie", currentPrice: "150,00", buyboxPrice: "150,00", expected: "Femme ✅" },
    { id: "S2", desc: "Solo Seller", currentPrice: "89,90", buyboxPrice: "", expected: "Femme ✅" },
    { id: "S3", desc: "Losing", currentPrice: "200,50", buyboxPrice: "199,90", expected: "BB ❌" },
    { id: "S4", desc: "Turkish Thousand Separator Trap", currentPrice: "1.250,00", buyboxPrice: "1.249,90", expected: "BB ❌" },
    { id: "S5", desc: "Missing Current Price", currentPrice: 0, buyboxPrice: "100", expected: "NO BADGE" }
  ];

  const results = testCases.map(tc => {
    const curParsed = parseValLocal(tc.currentPrice);
    const bbParsed = parseValLocal(tc.buyboxPrice);

    const curPrice = curParsed || 0;
    const bbPrice = bbParsed || 0;
    let badge = "NO BADGE";
    if (curPrice > 0) {
      if (bbPrice === 0 || curPrice <= bbPrice) {
        badge = "Femme ✅";
      } else {
        badge = "BB ❌";
      }
    }

    return {
      Scenario: tc.id,
      Description: tc.desc,
      "Raw Current": tc.currentPrice,
      "Raw BuyBox": tc.buyboxPrice,
      "Parsed Current": curParsed,
      "Parsed BuyBox": bbParsed,
      "Generated Badge": badge,
      "Expected Badge": tc.expected,
      Result: badge === tc.expected ? "PASS" : "FAIL"
    };
  });

  console.log("%c══ BUYBOX STRESS TEST RESULTS ══", "color:#ff9800;font-weight:bold;font-size:14px;");
  console.table(results);
}

// ════════════════════════════════════════════════════════════
// E2E DOM & UI TEST PAKETİ — CANLIYA ALMADAN ÖNCE SİL
// Çalıştır: Konsolda  runE2EQA()  yaz ve Enter'a bas
// ════════════════════════════════════════════════════════════
window.runE2EQA = function() {
  console.log('══════════════════════════════════════════');
  console.log('🚀 E2E ARAYÜZ (DOM) SİMÜLASYON TESTİ BAŞLIYOR');
  console.log('══════════════════════════════════════════');

  let passed = 0, failed = 0;

  // Gerçek kullanıcı simülasyonu araçları
  function setInput(id, val) {
    const el = document.getElementById(id);
    if(el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles: true})); }
  }
  function setCheck(id, isChecked) {
    const el = document.getElementById(id);
    if(el) { el.checked = isChecked; el.dispatchEvent(new Event('change', {bubbles: true})); }
  }
  function triggerRender() {
    if(typeof modalTyOnizle === 'function') modalTyOnizle();
  }

  // Arayüz doğrulama araçları
  function checkText(id, expected, label) {
    const el = document.getElementById(id);
    if (!el) { console.error(`  ❌ DOM Bulunamadı: #${id}`); failed++; return; }
    if (el.textContent.includes(expected)) {
      console.log(`  ✅ ${label}: "${expected}" eklendi`); passed++;
    } else {
      console.error(`  ❌ ${label} HATALI: "${el.textContent}" içinde "${expected}" yok!`); failed++;
    }
  }

  function checkDisplay(id, shouldBeVisible, label) {
    const el = document.getElementById(id);
    if (!el) { console.error(`  ❌ DOM Bulunamadı: #${id}`); failed++; return; }
    const isHidden = el.style.display === 'none' || el.classList.contains('hidden');
    if (shouldBeVisible && !isHidden) {
      console.log(`  ✅ ${label}: GÖRÜNÜR (Beklenen)`); passed++;
    } else if (!shouldBeVisible && isHidden) {
      console.log(`  ✅ ${label}: GİZLİ (Beklenen)`); passed++;
    } else {
      console.error(`  ❌ ${label} Durumu Hatalı! (Görünür olmalı: ${shouldBeVisible})`); failed++;
    }
  }

  // ── Modalı Sıfırla (Varsayılan Değerler) ──
  setInput('modal-ty-vatsell', 20);
  setInput('modal-ty-customcomm', 19);
  setCheck('modal-ty-today', false); // Standart kargo
  setInput('modal-ty-margin', 25);
  setInput('modal-ty-pkg', 0);
  setInput('modal-ty-fixed', 0);

  // ── TEST 1: Grup A (Trafik Kapalı) ──
  console.group('🔵 TEST 1 — Grup A (COGS=85, Trafik=KAPALI)');
  setInput('modal-ty-cost', 85);
  setCheck('modal-ty-traffic', false);
  triggerRender();
  checkText('prev-ty-title', 'Birim Kâr', 'Başlık (Birim)');
  checkDisplay('prev-ty-set-row', false, 'Set Satırı');
  console.groupEnd();

  // ── TEST 2: Grup B 6'lı Set ──
  console.group('🟢 TEST 2 — Grup B 6\'lı Set (COGS=2, Trafik=AÇIK)');
  setInput('modal-ty-cost', 2);
  setCheck('modal-ty-traffic', true);
  triggerRender();
  checkText('prev-ty-title', "6'lı Set", 'Başlık (6\'lı)');
  checkDisplay('prev-ty-set-row', true, 'Set Satırı');
  checkText('prev-ty-set-price', '119.40', 'Set Toplam Fiyatı');
  console.groupEnd();

  // ── TEST 3: Grup B 3'lü Set ──
  console.group('🟢 TEST 3 — Grup B 3\'lü Set (COGS=5, Trafik=AÇIK)');
  setInput('modal-ty-cost', 5);
  setCheck('modal-ty-traffic', true);
  triggerRender();
  checkText('prev-ty-title', "3'lü Set", 'Başlık (3\'lü)');
  checkDisplay('prev-ty-set-row', true, 'Set Satırı');
  checkText('prev-ty-set-price', '119.70', 'Set Toplam Fiyatı');
  console.groupEnd();

  // ── TEST 4: Grup B 2'li Set ──
  console.group('🟢 TEST 4 — Grup B 2\'li Set (COGS=15, Trafik=AÇIK)');
  setInput('modal-ty-cost', 15);
  setCheck('modal-ty-traffic', true);
  triggerRender();
  checkText('prev-ty-title', "2'li Set", 'Başlık (2\'li)');
  checkDisplay('prev-ty-set-row', true, 'Set Satırı');
  checkText('prev-ty-set-price', '139.80', 'Set Toplam Fiyatı');
  console.groupEnd();

  // ── TEST 5: Grup B Hata Durumu (Aşım) ──
  console.group('🔴 TEST 5 — Grup B HATA (COGS=40, Trafik=AÇIK)');
  setInput('modal-ty-cost', 40);
  setCheck('modal-ty-traffic', true);
  triggerRender();
  checkText('prev-ty-price', '—', 'Fiyat Hesaplaması İptal Edildi');
  checkDisplay('prev-ty-set-row', false, 'Set Satırı (Hata anında gizli)');
  console.groupEnd();

  console.log('══════════════════════════════════════════');
  console.log(`📊 E2E SONUÇ RAPORU: Geçen ${passed} | Başarısız ${failed}`);
  if(failed === 0) console.log('🎉 TÜM E2E DOM TESTLERİ KUSURSUZ GEÇTİ! CANLIYA ALABİLİRSİNİZ.');
  else console.error('🚨 BAŞARISIZ TEST VAR!');
  console.log('══════════════════════════════════════════');
};
console.log('✅ E2E QA Test paketi yüklendi. Konsola  runE2EQA()  yazarak çalıştır.');


// ═══════════════════════════════════════════════════════════
// AMAZON E2E QA TEST PAKETI v1.0
// Konsola  runAmazonQA()  yazarak çalıştır
// Canlıya almadan önce tüm testler ✅ olmalı
// ═══════════════════════════════════════════════════════════
window.runAmazonQA = function() {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 AMAZON E2E QA TEST SİMÜLASYONU BAŞLIYOR');
  console.log('═══════════════════════════════════════════');

  let passed = 0, failed = 0;
  const EPS = 0.15;

  function num(actual, expected, label) {
    const a = typeof actual === 'string' ? parseFloat(actual) : actual;
    if (a === null || a === undefined || isNaN(a)) {
      console.error(`  ❌ ${label}: değer yok (beklenen ${expected})`);
      failed++; return false;
    }
    if (Math.abs(a - expected) <= EPS) {
      console.log(`  ✅ ${label}: ${a} (beklenen ${expected})`);
      passed++; return true;
    }
    console.error(`  ❌ ${label}: ${a} ≠ ${expected} (fark: ${Math.abs(a-expected).toFixed(3)})`);
    failed++; return false;
  }

  function str(actual, contains, label) {
    const s = String(actual ?? '');
    if (s.includes(contains)) {
      console.log(`  ✅ ${label}: "${s}"`);
      passed++; return true;
    }
    console.error(`  ❌ ${label}: "${s}" içinde "${contains}" yok`);
    failed++; return false;
  }

  // ── TEST 1: Kozmetik Normal (Dead Zone Yok) ──────────────
  console.group('🔵 T1 — Kozmetik Normal (COGS=100, Kargo=93.05, %25, Dead Zone YOK)');
  const r1 = typeof amazonHesap !== 'undefined' ? amazonHesap(100, 0, 0, 93.05, 25, 'kozmetik') : null;
  if (r1) {
    // Ham fiyat: 193.05 / 0.642 = 300.70 => yuvarla: 309.90
    num(r1.satisF,      309.90, 'Önerilen Fiyat');
    num(r1.komisyonT,   33.47,  'Komisyon (TL)');
    num(r1.netKar,      83.38,  'Net Kâr');
    num(r1.gercekM,     26.91,  'Net Marj %');
    if (r1.deadZone === true) { console.error('  ❌ Dead Zone tetiklenmemeli!'); failed++; } 
    else { console.log('  ✅ Dead Zone: false (doğru)'); passed++; }
  } else { console.error('  ❌ amazonHesap() bulunamadı!'); failed++; }
  console.groupEnd();

  // ── TEST 2: Kozmetik Dead Zone AKTİF ────────────────────
  console.group('🔴 T2 — Kozmetik Dead Zone AKTİF (COGS=230, Kargo=93.05, %25)');
  const r2 = typeof amazonHesap !== 'undefined' ? amazonHesap(230, 0, 0, 93.05, 25, 'kozmetik') : null;
  if (r2) {
    num(r2.satisF, 499.90, 'Önerilen Fiyat (499.90 sabitlendi)');
    if (r2.deadZone === true) { console.log('  ✅ Dead Zone: true'); passed++; } 
    else { console.error('  ❌ Dead Zone tetiklenmedi! (tetiklenmeli)'); failed++; }
  } else { console.error('  ❌ amazonHesap() bulunamadı!'); failed++; }
  console.groupEnd();

  // ── TEST 3: Sağlık Flat %16.2 (Dead Zone Bypass) ────────
  console.group('🟢 T3 — Sağlık Flat %16.2 (COGS=150, Kargo=93.05, %20, Dead Zone BYPASS)');
  const r3 = typeof amazonHesap !== 'undefined' ? amazonHesap(150, 0, 0, 93.05, 20, 'saglik') : null;
  if (r3) {
    num(r3.satisF,      389.90, 'Önerilen Fiyat');
    num(r3.komisyonT,   63.16,  'Komisyon (TL)');
    num(r3.netKar,      83.69,  'Net Kâr');
    if (r3.deadZone === true) { console.error('  ❌ Sağlık kategorisinde Dead Zone OLMAMALI!'); failed++; } 
    else { console.log('  ✅ Dead Zone: false (flat bypass doğru çalışıyor)'); passed++; }
  } else { console.error('  ❌ amazonHesap() bulunamadı!'); failed++; }
  console.groupEnd();

  // ── TEST 4: Buybox Parser Regex ─────────────────────────
  console.group('🟡 T4 — Buybox CSV Parser (5 format)');
  const testParser = typeof parseBuyboxFiyat !== 'undefined';
  const parserCases = [
    { input: '439.90 + 0.00',      expected: 439.90, label: 'US nokta format' },
    { input: '₺439,90 + ₺0,00',    expected: 439.90, label: 'Türkçe ₺ format' },
    { input: '439.90+0.00',        expected: 439.90, label: 'Boşluksuz format' },
    { input: '1.439,90 + 5,00',    expected: 1444.90,label: 'Binlik nokta + ondalık virgül' },
    { input: 'N/A',                expected: null,   label: 'Buybox yok (N/A)' },
    { input: '—',                  expected: null,   label: 'Buybox yok (tire)' },
    { input: '₺439,90 + Ücretsiz', expected: 439.90, label: 'Ücretsiz kargo' },
  ];
  parserCases.forEach(({ input, expected, label }) => {
    if (!testParser) return;
    const result = parseBuyboxFiyat(input);
    if (expected === null) {
      if (result === null || result === undefined) { console.log(`  ✅ Parser "${input}" → null`); passed++; } 
      else { console.error(`  ❌ Parser "${input}" → ${result} (null beklendi)`); failed++; }
    } else {
      num(result, expected, `Parser: ${label}`);
    }
  });
  console.groupEnd();

  // ── BONUS: round90 Doğruluğu ────────────────────────────
  console.group('🔧 BONUS — round90() X9.90 Doğruluğu');
  const round90Cases = [
    { input: 144.94, expected: 149.90, label: '144.94 → 149.90' },
    { input: 309.12, expected: 309.90, label: '309.12 → 309.90' },
    { input: 499.91, expected: 509.90, label: '499.91 → 509.90' },
    { input: 370.79, expected: 379.90, label: '370.79 → 379.90' },
    { input: 199.10, expected: 199.90, label: '199.10 → 199.90' },
    { input: 199.90, expected: 199.90, label: '199.90 → 199.90' }
  ];
  if (typeof en90eYuvarla !== 'undefined') {
    round90Cases.forEach(({ input, expected, label }) => {
      const result = en90eYuvarla(input);
      if (Math.abs(result - expected) < 0.001) { console.log(`  ✅ en90eYuvarla(${input}) = ${result}`); passed++; } 
      else { console.error(`  ❌ en90eYuvarla(${input}) = ${result} (beklenen ${expected})`); failed++; }
    });
  } else { console.error('  ❌ en90eYuvarla() bulunamadı!'); failed++; }
  console.groupEnd();

  const total = passed + failed;
  console.log('═══════════════════════════════════════════');
  console.log(`📊 AMAZON QA SONUÇ RAPORU: Geçen ${passed} | Başarısız ${failed}`);
  if(failed === 0) console.log('🎉 TÜM TESTLER KUSURSUZ GEÇTİ! CANLIYA ALABİLİRSİNİZ.');
  else console.error('🚨 BAŞARISIZ TEST VAR!');
  console.log('═══════════════════════════════════════════');
};
console.log('✅ Amazon QA paketi yüklendi → konsola  runAmazonQA()  yaz');

// ==========================================
// EXCEL EXPORT MODULE (XLSX)
// ==========================================
function getFormattedDate() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}_${month}_${d.getFullYear()}`;
}

function exportAmazonExcel() {
  if (!STATE.amazon || STATE.amazon.length === 0) return alert("Dışa aktarılacak ürün bulunamadı.");
  
  const data = STATE.amazon.map(p => ({
    "Ürün Adı": p.ad || "",
    "SKU": p.sku || "",
    "ASIN": p.asin || "",
    "Kategori": p.category === 'saglik' ? 'Sağlık' : (p.category === 'diger' ? 'Diğer' : 'Kozmetik'),
    "Eksik Maliyet": p.missingCogs ? "Evet" : "Hayır",
    "Mevcut Fiyat (₺)": parseFloat(p.currentPrice || 0),
    "BuyBox Fiyatı (₺)": parseFloat(p.buyboxPrice || 0),
    "Ürün Maliyeti (₺)": parseFloat(p.maliyet || 0),
    "Ambalaj Maliyeti (₺)": parseFloat(p.ambalaj || 0),
    "Sabit Maliyet/Birim (₺)": parseFloat(p.sabit || 0),
    "Amazon Kargo Maliyeti (₺)": parseFloat(p.kargo || GP.kargo),
    "Komisyon Oranı (%)": parseFloat(p.komisyonO || 0),
    "Komisyon Tutarı (₺)": parseFloat(p.komisyonT || 0),
    "Önerilen Satış Fiyatı (₺)": parseFloat(p.satisF || 0),
    "Ölü Bölge (Dead Zone)": p.deadZone ? "Aktif" : "Pasif",
    "Hedef Marj (%)": parseFloat(p.bireyselMarj || GP.marj),
    "Başa Baş Fiyatı (0 Marj) (₺)": parseFloat(p.breakEvenPrice || 0),
    "Maksimum İndirim (%)": parseFloat(p.maxDiscount || 0),
    "Net Marj (%)": parseFloat(p.gercekM || 0),
    "Net Kâr (₺)": parseFloat(p.netKar || 0)
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Amazon_Envanter");
  XLSX.writeFile(wb, `Femmelogy_Amazon_Envanter_${getFormattedDate()}.xlsx`);
}

function exportTrendyolExcel() {
  if (!STATE.trendyol || STATE.trendyol.length === 0) return alert("Dışa aktarılacak ürün bulunamadı.");

  const data = STATE.trendyol.map(p => ({
    "Ürün Adı": p.ad || "",
    "Barkod / ASIN": p.asin || "",
    "SKU": p.sku || "",
    "Trafik Ürünü (Grup B)": p.trafik ? "Evet" : "Hayır",
    "Bugün Kargoda": p.today ? "Evet" : "Hayır",
    "Mevcut Fiyat (₺)": parseFloat(p.currentPrice || 0),
    "Mevcut Marj (%)": parseFloat(p.currMargin || 0),
    "Önerilen Satış Fiyatı (₺)": parseFloat(p.satisF || 0),
    "Fiyat Farkı (Önerilen-Mevcut) (₺)": parseFloat((p.satisF || 0) - (p.currentPrice || 0)),
    "Başa Baş Fiyatı (0 Marj) (₺)": parseFloat(p.breakEvenPrice || 0),
    "Maksimum İndirim (%)": parseFloat(p.maxDiscount || 0),
    "Kargo Bandı (₺)": parseFloat(p.finalKargo || 0),
    "Ürün Maliyeti (₺)": parseFloat(p.maliyet || 0),
    "Ambalaj Maliyeti (₺)": parseFloat(p.ambalaj || 0),
    "Sabit Maliyet/Birim (₺)": parseFloat(p.sabit || 0),
    "Satış KDV (%)": parseFloat(p.kdv || 20),
    "Özel Komisyon (%)": p.customComm ? parseFloat(p.customComm) : "Yok",
    "Komisyon Tutarı (₺)": parseFloat((p.satisF || 0) * (p.aktifKomis / 100) || 0),
    "Toplam Gider (Kargo+Hizmet vb) (₺)": parseFloat((p.finalKargo || 0) + (p.hizmetBedeli || 0)),
    "Ödenecek KDV Yükü (₺)": parseFloat(p.netVAT || 0),
    "Hedef Marj (%)": parseFloat(p.bireyselMarj || GP.tyMarj),
    "Net Marj (%)": parseFloat(p.satisF > 0 ? (p.netProfit / p.satisF) * 100 : 0),
    "Net Kâr (₺)": parseFloat(p.netProfit || 0)
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Trendyol_Envanter");
  XLSX.writeFile(wb, `Femmelogy_Trendyol_Envanter_${getFormattedDate()}.xlsx`);
}

// ==========================================
// SYSTEM IMPORT (BULK EDIT) MODULE
// ==========================================
function parseExcelNum(val) {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return val;
  let clean = String(val).replace(/%/g, '').trim();
  if (clean.includes(",")) clean = clean.replace(/\./g, "").replace(",", ".");
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : parsed;
}

function parseExcelBool(val) {
  if (!val) return false;
  return String(val).toLowerCase().trim() === "evet";
}

function handleFileRead(event, callback) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
    callback(rows);
    event.target.value = ""; // Reset input
  };
  reader.readAsArrayBuffer(file);
}

function processSystemAmazonBulk(rows) {
  let updated = 0;
  rows.forEach(row => {
    const asin = row["ASIN"] || "";
    const sku = row["SKU"] || "";
    const ad = row["Ürün Adı"] || "İsimsiz Ürün";
    
    let targetIdx = STATE.amazon.findIndex(p => (asin && p.asin === asin) || (sku && p.sku === sku));
    
    const parsedMaliyet = parseExcelNum(row["Ürün Maliyeti (₺)"]) || 0;
    const parsedAmbalaj = parseExcelNum(row["Ambalaj Maliyeti (₺)"]) || 0;
    const parsedSabit = parseExcelNum(row["Sabit Maliyet/Birim (₺)"]) || 0;
    const parsedMarj = parseExcelNum(row["Hedef Marj (%)"]); // Can be null
    
    let rawCat = String(row["Kategori"] || "kozmetik").toLowerCase().trim();
    let kat = rawCat.includes("sağlık") || rawCat.includes("saglik") ? "saglik" : (rawCat.includes("diğer") || rawCat.includes("diger") ? "diger" : "kozmetik");

    const parsedCurrentP = parseExcelNum(row["Mevcut Fiyat (₺)"]);
    let currentP = parsedCurrentP !== null ? parsedCurrentP : (targetIdx !== -1 ? (STATE.amazon[targetIdx].currentPrice || 0) : 0);
    let buyboxP = targetIdx !== -1 ? (STATE.amazon[targetIdx].buyboxPrice || null) : null;
    let usedMarj = parsedMarj !== null ? parsedMarj : GP.marj;

    const r = amazonHesap(parsedMaliyet, parsedAmbalaj, parsedSabit, GP.kargo, usedMarj, kat, buyboxP, currentP);
    
    const newObj = {
      ad, sku, asin, category: kat,
      maliyet: parsedMaliyet, ambalaj: parsedAmbalaj, sabit: parsedSabit, bireyselMarj: parsedMarj,
      currentPrice: currentP, buyboxPrice: buyboxP,
      ...r
    };

    if (targetIdx !== -1) {
      newObj.id = STATE.amazon[targetIdx].id; // PRESERVE EXISTING ID
      STATE.amazon[targetIdx] = newObj;
      updated++;
    } else {
      newObj.id = Date.now() + Math.random(); // GENERATE NEW ID
      STATE.amazon.push(newObj);
      updated++;
    }
  });
  
  kaydet("amazon");
  amazonRender();
  gosterFeedback("amazon-import-feedback", `${updated} ürün Excel'den toplu güncellendi.`, false);
}

function processSystemTrendyolBulk(rows) {
  let updated = 0;
  rows.forEach(row => {
    const asin = row["Barkod / ASIN"] || row["ASIN"] || "";
    const sku = row["SKU"] || "";
    const ad = row["Ürün Adı"] || "İsimsiz Ürün";
    
    let targetIdx = STATE.trendyol.findIndex(p => (asin && p.asin === asin) || (sku && p.sku === sku));
    
    const parsedMaliyet = parseExcelNum(row["Ürün Maliyeti (₺)"]) || 0;
    const parsedAmbalaj = parseExcelNum(row["Ambalaj Maliyeti (₺)"]) || 0;
    const parsedSabit = parseExcelNum(row["Sabit Maliyet/Birim (₺)"]) || 0;
    const parsedMarj = parseExcelNum(row["Hedef Marj (%)"]); // Can be null
    const parsedKdv = parseExcelNum(row["Satış KDV (%)"]) !== null ? parseExcelNum(row["Satış KDV (%)"]) : 20;
    
    let rawCustomComm = row["Özel Komisyon (%)"];
    let parsedCustomComm = (rawCustomComm === "Yok" || !rawCustomComm) ? "" : parseExcelNum(rawCustomComm);
    
    const isTraffic = parseExcelBool(row["Trafik Ürünü (Grup B)"]);
    const isToday = parseExcelBool(row["Bugün Kargoda"]);
    const commDate = row["Komisyon Bitiş"] === "Yok" ? "" : (row["Komisyon Bitiş"] || "");

    const parsedCurrentP = parseExcelNum(row["Mevcut Fiyat (₺)"]);
    let currentP = parsedCurrentP !== null ? parsedCurrentP : (targetIdx !== -1 ? (STATE.trendyol[targetIdx].currentPrice || 0) : 0);
    let buyboxP = targetIdx !== -1 ? (STATE.trendyol[targetIdx].buyboxPrice || null) : null;
    let usedMarj = parsedMarj !== null ? parsedMarj : GP.tyMarj;

    const r = trendyolHesap(
      parsedMaliyet,        // maliyet
      parsedAmbalaj,        // ambalaj
      parsedSabit,          // sabit
      parsedCustomComm,     // ozelKomis
      commDate,             // komisyonBitis
      usedMarj,             // ozelMarj
      parsedKdv,            // vatSell
      isToday,              // bugunKargoda
      currentP,             // currentPrice
      isTraffic             // isTrafficStrategy
    );

    const newObj = {
      ad, sku, asin, trafik: isTraffic, today: isToday,
      maliyet: parsedMaliyet, ambalaj: parsedAmbalaj, sabit: parsedSabit, 
      kdv: parsedKdv, customComm: parsedCustomComm, commDate: commDate,
      bireyselMarj: parsedMarj, currentPrice: currentP, buyboxPrice: buyboxP,
      ...r
    };

    if (targetIdx !== -1) {
      newObj.id = STATE.trendyol[targetIdx].id; // PRESERVE EXISTING ID
      STATE.trendyol[targetIdx] = newObj;
      updated++;
    } else {
      newObj.id = Date.now() + Math.random(); // GENERATE NEW ID
      STATE.trendyol.push(newObj);
      updated++;
    }
  });
  
  kaydet("trendyol");
  trendyolRender();
  gosterFeedback("trendyol-import-feedback", `${updated} ürün Excel'den toplu güncellendi.`, false);
}

// ==========================================
// SMART ROUTER MODULE
// ==========================================

function handleFileReadData(event, callback) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    callback(data);
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}

function routeAmazonImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      processAmazonRawCSV(e.target.result); 
      event.target.value = "";
    };
    reader.readAsText(file, "UTF-8");
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    handleFileRead(event, (rows) => {
      processSystemAmazonBulk(rows);
    });
  } else {
    alert("Geçersiz dosya formatı. Lütfen .csv veya .xlsx yükleyin.");
    event.target.value = "";
  }
}

function routeTrendyolImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  handleFileReadData(event, (data) => {
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.SheetNames[0];
    const rowsAsObjects = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
    
    if (!rowsAsObjects || rowsAsObjects.length === 0) {
      alert("Dosya boş.");
      return;
    }
    
    const firstRowHeaders = Object.keys(rowsAsObjects[0]);
    const isSystemFile = firstRowHeaders.includes("Ürün Maliyeti (₺)") || firstRowHeaders.includes("Hedef Marj (%)");

    if (isSystemFile) {
      processSystemTrendyolBulk(rowsAsObjects);
    } else {
      processTrendyolRawExcel(data); 
    }
  });
}


/* ══════════════════════════════════════════
   FİREBASE AUTH GATE — Giriş / Çıkış Kontrolleri
   ──────────────────────────────────────────
   authGirisYap()  → index.html "Giriş Yap" butonuna bağlı
   authCikisYap()  → sidebar "Çıkış" butonuna bağlı
   _bootstrapFirebaseAuth → State Hydration Pattern bootstrap
   (DOMContentLoaded ile tetiklenir)
══════════════════════════════════════════ */

function _authSetLoading(isLoading) {
  var btn = document.getElementById('auth-btn');
  if (!btn) return;
  btn.textContent = isLoading ? 'Giriş yapılıyor…' : 'Giriş Yap';
  btn.disabled = isLoading;
  btn.style.opacity = isLoading ? '0.7' : '1';
}

function _authShowError(msg) {
  var el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function _showDashboard(userEmail) {
  var overlay = document.getElementById('auth-overlay');
  var logoutBtn = document.getElementById('auth-logout-btn');
  if (overlay) overlay.style.display = 'none';
  if (logoutBtn) {
    logoutBtn.style.display = 'inline-flex';
    logoutBtn.title = 'Çıkış: ' + (userEmail || '');
  }
}

function _showAuthOverlay() {
  var overlay = document.getElementById('auth-overlay');
  var logoutBtn = document.getElementById('auth-logout-btn');
  var errEl = document.getElementById('auth-error');
  if (overlay) overlay.style.display = 'flex';
  if (logoutBtn) logoutBtn.style.display = 'none';
  if (errEl) errEl.style.display = 'none';
  _authSetLoading(false);
}

/**
 * Global: "Giriş Yap" butonuna bağlı (index.html onclick)
 */
async function authGirisYap() {
  var emailEl = document.getElementById('auth-email');
  var passEl  = document.getElementById('auth-password');
  var email    = emailEl ? emailEl.value.trim() : '';
  var password = passEl  ? passEl.value.trim()  : '';

  _authShowError('');
  if (!email || !password) {
    _authShowError('E-posta ve şifre zorunludur.');
    return;
  }
  _authSetLoading(true);

  try {
    // Wait for firebase-db.js module to initialise if needed
    if (!window.DB) {
      await new Promise(function(resolve) { setTimeout(resolve, 1500); });
    }
    if (!window.DB) {
      _authShowError('Firebase henüz yüklenmedi. Lütfen sayfayı yenileyin.');
      _authSetLoading(false);
      return;
    }
    await window.DB.login(email, password);
    // onAuthStateChanged fires → _showDashboard() called automatically
  } catch (err) {
    _authSetLoading(false);
    var friendlyMsg =
      err.code === 'auth/wrong-password'          ? 'Hatalı şifre. Lütfen tekrar deneyin.'         :
      err.code === 'auth/user-not-found'          ? 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.' :
      err.code === 'auth/invalid-credential'      ? 'E-posta veya şifre hatalı.'                   :
      err.code === 'auth/invalid-email'           ? 'Geçersiz e-posta adresi.'                     :
      err.code === 'auth/too-many-requests'       ? 'Çok fazla deneme. Lütfen bekleyin.'            :
      err.code === 'auth/network-request-failed'  ? 'İnternet bağlantısı hatası.'                  :
      'Giriş başarısız: ' + (err.message || err.code);
    _authShowError(friendlyMsg);
  }
}

/**
 * Global: sidebar "Çıkış" butonuna bağlı (index.html onclick)
 */
async function authCikisYap() {
  try {
    if (window.DB) await window.DB.logout();
  } catch (e) {
    console.error('[Femmelogy] Logout error:', e);
  }
  // onAuthStateChanged fires with null → _showAuthOverlay() called automatically
}

/**
 * State Hydration Bootstrap.
 * Polls until firebase-db.js module sets window.DB, then registers
 * the onAuthStateChanged listener.
 */
function _bootstrapFirebaseAuth() {
  if (!window.DB || typeof window.DB.onAuthChange !== 'function') {
    setTimeout(_bootstrapFirebaseAuth, 600);
    return;
  }

  window.DB.onAuthChange(async function(user) {
    if (user) {
      // ── Authenticated ──────────────────────────────────────────────────
      window.DB.init(user.uid);
      _showDashboard(user.email);  // Dashboard visible immediately (localStorage in STATE)

      // Background: hydrate STATE from Firestore
      try {
        var results  = await Promise.all([
          window.DB.load('amazon'),
          window.DB.load('trendyol')
        ]);
        var amzData = results[0];
        var tyData  = results[1];
        var changed = false;

        if (amzData && amzData.length > 0) {
          STATE.amazon = amzData;
          localStorage.setItem('femmelogy_amazon', JSON.stringify(amzData));
          changed = true;
        }
        if (tyData && tyData.length > 0) {
          STATE.trendyol = tyData;
          localStorage.setItem('femmelogy_trendyol', JSON.stringify(tyData));
          changed = true;
        }

        if (changed) {
          if (typeof amazonRender   === 'function') amazonRender();
          if (typeof trendyolRender === 'function') trendyolRender();
        }

        console.log('[Femmelogy] Firestore hydration OK. AMZ:', (amzData || []).length, 'TY:', (tyData || []).length);
      } catch (hydErr) {
        // Graceful fallback: localStorage cache remains active
        console.warn('[Femmelogy] Firestore hydration failed (localStorage fallback active):', hydErr);
      }
    } else {
      // ── Signed out ──────────────────────────────────────────────────────
      _showAuthOverlay();
    }
  });
}

// Bootstrap on DOM ready (firebase-db.js module loads in parallel)
document.addEventListener('DOMContentLoaded', function() {
  _bootstrapFirebaseAuth();
});
