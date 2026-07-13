# Femmelogy Pricing Engine — Enterprise Audit Report v3

> Generated: 2026-07-13T07:16:02.708Z
> Engine Version: app.js with APP_CONFIG, Flash Crash Guardrails (v20 cache)

## 1. System Constants (APP_CONFIG)

### Amazon Constants
| Constant | Value | Description |
|---|---|---|
| LIMIT_DEADZONE_LOW | 499.90 TL | Dead Zone price cap (Ölü Bölge) |
| LIMIT_DEADZONE_HIGH | 500.00 TL | Commission tier switch boundary |
| COMM_LOW | %10.8 | Kozmetik < 500 TL |
| COMM_HIGH | %16.8 | Kozmetik >= 500 TL |
| COMM_SAGLIK | %16.2 | Sağlık flat commission |
| COMM_DIGER | %10.8 | Diğer flat commission |
| Kargo (GP.kargo default) | 93.05 TL | Amazon default shipping cost |

### Trendyol Constants
| Constant | Value | Description |
|---|---|---|
| GIZLI_GIDER | 6.61 TL | Hidden fixed cost (per transaction) |
| SABIT_GIDER | 8.00 TL | Fixed unit cost (per transaction) |
| IADE_PAYI | 1.03 TL | Return allowance (applied when price > 75 TL) |
| HIZMET_BEDELI_STANDART | 13.19 TL | Standard service fee |
| HIZMET_BEDELI_KAMPANYA | 5.99 TL | "Bugün Kargoda" campaign service fee |
| TRAFIK_LIMIT_FIYAT | 75.00 TL | Group B max unit price limit |
| TRAFIK_SABIT_MARJ | %2 | Group B fixed target margin |

### Trendyol Shipping Tiers (Kargo Baremleri)
| Tier | Kargo Fee (KDV dahil) | Price Band |
|---|---|---|
| Tier 1 | 41.00 TL | 0 — 199.99 TL |
| Tier 2 | 79.00 TL | 200 — 349.99 TL |
| Tier 3 | 93.05 TL (GP.tyKargo) | 350+ TL |

---

## 2. Amazon Engine — 15 Edge-Case Scenarios

**Implicit Costs applied to all:** Kargo = 93.05 TL (unless stated). Break-Even computed via `breakEvenFiyatAmz()`.

| ID | Description | Maliyet | Ambalaj | Sabit | Kargo | Total COGS+Kargo | Target Margin | Category | Rec. Price (₺) | Applied Comm. (%) | Net Profit (₺) | Break-Even (₺) | Status / Guardrail |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AZ-01 | Normal <500 TL | 100 | 8 | 5 | 93.05 | 206.05 | %20 | kozmetik | 299.90 | 10.8% | 61.46 | 231.00 | PASS |
| AZ-02 | Natural >500 TL | 310 | 10 | 5 | 93.05 | 418.05 | %20 | kozmetik | 669.90 | 16.8% | 139.31 | 468.67 | PASS |
| AZ-03 | Borderline (total COGS ~428 TL) | 255 | 5 | 5 | 93.05 | 358.05 | %20 | kozmetik | 499.90 | 10.8% | 87.86 | 401.40 | PASS |
| AZ-04 | Just above 500 threshold | 290 | 10 | 5 | 93.05 | 398.05 | %20 | kozmetik | 629.90 | 16.8% | 126.03 | 446.24 | PASS |
| AZ-05 | Dead Zone Rescue (high marj, low cost) | 20 | 0 | 0 | 93.05 | 113.05 | %85 | kozmetik | 499.90 | 10.8% | 332.86 | 126.74 | PASS |
| AZ-06 | Dead Zone Rescue, very low cost | 10 | 5 | 5 | 93.05 | 113.05 | %87 | kozmetik | 499.90 | 10.8% | 332.86 | 126.74 | PASS |
| AZ-07 | Flat: Saglik (%16.2 flat) | 100 | 5 | 5 | 93.05 | 203.05 | %15 | saglik | 299.90 | 16.2% | 48.27 | 242.30 | PASS |
| AZ-08 | Flat: Diger (%10.8 flat) | 100 | 5 | 5 | 93.05 | 203.05 | %15 | diger | 279.90 | 10.8% | 46.62 | 227.63 | PASS |
| AZ-09 | Impossible Margin (guard) | 100 | 5 | 5 | 93.05 | 203.05 | %90 | kozmetik | 0.00 | 0% | 0.00 | 0.00 | GUARD: Hedef marj bu komisyon oranı için çok yüksek. |
| AZ-10 | Flash Crash: DZ rescue sub-BE | 430 | 0 | 0 | 93.05 | 523.05 | %85 | kozmetik | 0.00 | 0% | 0.00 | 0.00 | GUARD: Hedef marj yüksek komisyon kademesiyle de elde edilemiyor. |
| AZ-11 | Zero Cost Guard | 0 | 0 | 0 | 93.05 | 93.05 | %20 | kozmetik | 0.00 | 0% | 0.00 | 0.00 | GUARD: Maliyet Eksik |
| AZ-12 | High ticket 1000+ TL, marj %15 | 700 | 20 | 10 | 93.05 | 823.05 | %15 | kozmetik | 1209.90 | 16.8% | 183.59 | 989.24 | PASS |
| AZ-13 | High ticket Saglik 1500+ TL | 1000 | 20 | 10 | 93.05 | 1123.05 | %15 | saglik | 1639.90 | 16.2% | 251.19 | 1340.16 | PASS |
| AZ-14 | Low marj (%5), near BE | 200 | 10 | 5 | 93.05 | 308.05 | %5 | kozmetik | 369.90 | 10.8% | 21.90 | 345.35 | PASS |
| AZ-15 | Extreme high ticket >2000 TL | 1200 | 20 | 10 | 93.05 | 1323.05 | %15 | kozmetik | 1949.90 | 16.8% | 299.27 | 1590.20 | PASS |

---

## 3. Trendyol Engine — 15 Edge-Case Scenarios

**All implicit costs are listed in the "Implicit Costs" column.** Kargo tier is determined by Global Profit Maximizer. GP.tyKomis default = 19%.

| ID | Description | Total COGS | Implicit Costs | Target Margin | KDV (%) | Traffic | Rec. Price (₺) | Net VAT (₺) | Net Profit (₺) | Break-Even (₺) | Status / Guardrail |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TY-01 | Group B: MOQ=6 (cogs<=25 TL) | 5 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %25 | %20 | Evet | 39.90 | 13.12 | 8.04 | 0.00 | PASS |
| TY-02 | Group B: MOQ=3 (cogs<=35 TL) | 10 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %25 | %20 | Evet | 49.90 | 18.12 | 12.34 | 0.00 | PASS |
| TY-03 | Group B: MOQ=2 (cogs<=50 TL) | 22 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %25 | %20 | Evet | 0.00 | 0.00 | 0.00 | 0.00 | GUARD: Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| TY-04 | Group B: Invalid cost >75 (guard) | 50 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %25 | %20 | Evet | 0.00 | 0.00 | 0.00 | 0.00 | GUARD: Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| TY-05 | Barem Opt Jump to 93.05 tier | 46 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:93.05 | %25 | %20 | Hayır | 389.90 | 49.47 | 98.46 | 169.42 | PASS |
| TY-06 | Barem Trap: Stay in 79.00 tier | 34 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:79 | %25 | %20 | Hayır | 349.90 | 45.15 | 96.44 | 150.77 | PASS |
| TY-07 | Extreme low cost, KDV offset ~0 | 4 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:79 | %25 | %20 | Hayır | 349.90 | 45.15 | 126.44 | 104.14 | PASS |
| TY-08 | KDV variation: 10% | 28 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:79 | %25 | %10 | Hayır | 349.90 | 24.63 | 122.96 | 130.86 | PASS |
| TY-09 | KDV variation: 1% | 28 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:79 | %25 | %1 | Hayır | 349.90 | 2.68 | 144.91 | 121.77 | PASS |
| TY-10 | Bugun Kargoda (hizmet=5.99) | 60 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:5.99(kampanya) / Kargo:93.05 | %25 | %20 | Hayır | 409.90 | 52.81 | 104.53 | 179.99 | PASS |
| TY-11 | Custom Commission 10% | 28 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:79 | %25 | %20 | Hayır | 349.90 | 45.15 | 133.93 | 124.09 | PASS |
| TY-12 | Impossible Margin (guard) | 28 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %95 | %20 | Hayır | 0.00 | 0.00 | 0.00 | 0.00 | GUARD: Komisyon + Hedef Marj + KDV %100 veya üstündedir. |
| TY-13 | Flash Crash: sub-BE scenario | 450 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %90 | %20 | Hayır | 0.00 | 0.00 | 0.00 | 0.00 | GUARD: Komisyon + Hedef Marj + KDV %100 veya üstündedir. |
| TY-14 | High ticket scaling 800+ TL COGS | 830 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>aktif / Hizmet:13.19 / Kargo:93.05 | %20 | %20 | Hayır | 2119.90 | 337.81 | 427.43 | 1455.50 | PASS |
| TY-15 | Zero Cost Guard | 0 | Gizli:6.61 / Sabit:8.00 / Iade:1.03>pasif / Hizmet:13.19 / Kargo:41 | %25 | %20 | Hayır | 0.00 | 0.00 | 0.00 | 0.00 | GUARD: Maliyet Eksik |

---

## 4. Guardrail Activation Summary

| ID | Type | Message |
|---|---|---|
| AZ-09 | Guard Activated | GUARD: Hedef marj bu komisyon oranı için çok yüksek. |
| AZ-10 | Guard Activated | GUARD: Hedef marj yüksek komisyon kademesiyle de elde edilemiyor. |
| AZ-11 | Zero Cost Guard | GUARD: Maliyet Eksik |
| TY-03 | Group B Reject / Impossible Margin | GUARD: Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| TY-04 | Group B Reject / Impossible Margin | GUARD: Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| TY-12 | Guard Activated | GUARD: Komisyon + Hedef Marj + KDV %100 veya üstündedir. |
| TY-13 | Guard Activated | GUARD: Komisyon + Hedef Marj + KDV %100 veya üstündedir. |
| TY-15 | Zero Cost Guard | GUARD: Maliyet Eksik |

---

*End of Report. All values are live-computed from app.js at generation time.*