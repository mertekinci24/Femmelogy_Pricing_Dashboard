# Femmelogy Pricing Engine - Final Independent Audit Data

## 1. System Architecture & Core Formulas

### 1.1 Turnover Margin Base
Profit margins are calculated based on the **Turnover / Revenue (Ciro)** of the sale.
$$\text{Net Margin} = \frac{\text{Net Profit}}{\text{Selling Price}} \times 100$$

### 1.2 Price Rounding Strategy (X.90 Ceil)
Prices are ceiled to the top of the tens decade (e.g., 141.20 becomes 149.90).

### 1.3 Amazon Engine & Dead Zone Rescue
- **Divisional Pricing:** $P = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - K_{\text{commission}} - M_{\text{target}}}$
- **Dead Zone:** Between ~500.00 and ~562.49, dropping the price to 499.90 (lower commission tier) often yields a higher absolute profit.
- **Dead Zone Rescue Patch:** If an extremely high margin target makes the high-commission tier mathematically infeasible (denominator $\le 0$), the engine checks if the low-commission tier (10.8%) is still viable. If selling at 499.90 yields a positive net profit, it rescues the calculation and forces 499.90 instead of throwing an error.

### 1.4 Trendyol Engine & Barem Opt
- **Global Profit Maximizer:** Calculates net profit across all shipping tiers (41.00, 79.00, 93.05 TL) and selects the price that yields the highest absolute cash profit.
- **KDV Offset:** Net VAT is dynamically offset by the cargo VAT. Extreme low-cost items can achieve 0 TL net VAT.
- **Group B (Traffic):** Low-cost items ($< 75$ TL target) are forced into multi-pack MOQ rules (MOQ=6, MOQ=3, MOQ=2) with fixed 2% margin.

---

## 2. Amazon Engine - 15 Edge-Case Scenarios

| ID | Description | Inputs | Rec Price (₺) | Comm % | Net Profit (₺) | Margin | Break-Even (₺) | Max Discount % | Dead Zone | Error/Hata |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Normal < 500 TL (Kozmetik) | Maliyet: 150, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 379.90 | 10.8% | 80.82 | 21.3% | 289.29 | 23.9% | Hayır | Yok |
| 2 | Prices naturally just above 500 TL | Maliyet: 310, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 669.90 | 16.8% | 139.31 | 20.8% | 468.67 | 30.0% | Hayır | Yok |
| 3 | Dead Zone Rescue (Forces 499.90) | Maliyet: 20, Amb: 0, Sabit: 0, Marj: %85, Kat: kozmetik | 499.90 | 10.8% | 332.86 | 66.6% | 126.74 | 74.6% | Evet | Yok |
| 4 | Dead Zone Fail (Rejects 499.90) | Maliyet: 400, Amb: 0, Sabit: 0, Marj: %85, Kat: kozmetik | 0.00 | 0% | 0.00 | N/A | 0.00 | 0.0% | Hayır | Hedef marj yüksek komisyon kademesiyle de elde edilemiyor. |
| 5 | Saglik category flat commission | Maliyet: 100, Amb: 5, Sabit: 5, Marj: %15, Kat: saglik | 299.90 | 16.2% | 48.27 | 16.1% | 242.30 | 19.2% | Hayır | Yok |
| 6 | Diger category flat commission | Maliyet: 100, Amb: 5, Sabit: 5, Marj: %15, Kat: diger | 279.90 | 10.8% | 46.62 | 16.7% | 227.63 | 18.7% | Hayır | Yok |
| 7 | Standard Dead Zone (not rescue, normal DZ) | Maliyet: 280, Amb: 10, Sabit: 5, Marj: %25, Kat: kozmetik | 669.90 | 16.8% | 169.31 | 25.3% | 435.03 | 35.1% | Hayır | Yok |
| 8 | High Ticket Scaling | Maliyet: 1200, Amb: 20, Sabit: 10, Marj: %15, Kat: kozmetik | 1949.90 | 16.8% | 299.27 | 15.3% | 1590.20 | 18.4% | Hayır | Yok |
| 9 | Zero Cost Guard | Maliyet: 0, Amb: 0, Sabit: 0, Marj: %20, Kat: kozmetik | 0.00 | 0% | 0.00 | N/A | 0.00 | 0.0% | Hayır | Maliyet Eksik |
| 10 | Impossible Target Margin (No Rescue possible) | Maliyet: 100, Amb: 5, Sabit: 5, Marj: %90, Kat: kozmetik | 0.00 | 0% | 0.00 | N/A | 0.00 | 0.0% | Hayır | Hedef marj bu komisyon oranı için çok yüksek. |
| 11 | Borderline DZ lower limit | Maliyet: 260, Amb: 5, Sabit: 5, Marj: %20, Kat: kozmetik | 499.90 | 10.8% | 82.86 | 16.6% | 407.01 | 18.6% | Evet | Yok |
| 12 | Borderline DZ upper limit | Maliyet: 320, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 679.90 | 16.8% | 137.63 | 20.2% | 479.88 | 29.4% | Hayır | Yok |
| 13 | Buybox provided | Maliyet: 150, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 379.90 | 10.8% | 80.82 | 21.3% | 289.29 | 23.9% | Hayır | Yok |
| 14 | Current Price tracking | Maliyet: 150, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 379.90 | 10.8% | 80.82 | 21.3% | 289.29 | 23.9% | Hayır | Yok |
| 15 | Very high margin, low cost (Rescue viable) | Maliyet: 10, Amb: 5, Sabit: 5, Marj: %87, Kat: kozmetik | 499.90 | 10.8% | 332.86 | 66.6% | 126.74 | 74.6% | Evet | Yok |

---

## 3. Trendyol Engine - 15 Edge-Case Scenarios

| ID | Description | Inputs | Rec Price (₺) | Comm % | Net VAT (₺) | Net Profit (₺) | Cargo Fee (₺) | Hizmet (₺) | Break-Even (₺) | Max Discount % | Traffic Mode | Error/Hata |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Group B (Trafik) MOQ=6 | COGS: 5, Komis: GP, Marj: %GP, KDV: %20, Traffic: Evet | 39.90 | 19% | 13.12 | 8.04 | 41.00 | 13.19 | 0.00 | 0.0% | Evet | Yok |
| 2 | Group B (Trafik) MOQ=3 | COGS: 10, Komis: GP, Marj: %GP, KDV: %20, Traffic: Evet | 49.90 | 19% | 18.12 | 12.34 | 41.00 | 13.19 | 0.00 | 0.0% | Evet | Yok |
| 3 | Group B (Trafik) MOQ=2 | COGS: 17, Komis: GP, Marj: %GP, KDV: %20, Traffic: Evet | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 13.19 | 0.00 | 0.0% | Hayır | Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| 4 | Barem Optimization Jumps (to 379.90) | COGS: 46, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 389.90 | 19% | 49.47 | 98.46 | 93.05 | 13.19 | 169.42 | 56.5% | Hayır | Yok |
| 5 | 199.90 Barem Trap (Stay cheaper tier) | COGS: 34, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 349.90 | 19% | 45.15 | 96.44 | 79.00 | 13.19 | 150.77 | 56.9% | Hayır | Yok |
| 6 | Low-cost KDV offset zeroing out | COGS: 4, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 349.90 | 19% | 45.15 | 126.44 | 79.00 | 13.19 | 104.14 | 70.2% | Hayır | Yok |
| 7 | Custom commission overrides | COGS: 28, Komis: 10, Marj: %25, KDV: %20, Traffic: Hayır | 349.90 | 10% | 45.15 | 133.93 | 79.00 | 13.19 | 124.09 | 64.5% | Hayır | Yok |
| 8 | Different KDV rates (10%) | COGS: 28, Komis: GP, Marj: %25, KDV: %10, Traffic: Hayır | 349.90 | 19% | 24.63 | 122.96 | 79.00 | 13.19 | 130.86 | 62.6% | Hayır | Yok |
| 9 | Different KDV rates (1%) | COGS: 28, Komis: GP, Marj: %25, KDV: %1, Traffic: Hayır | 349.90 | 19% | 2.68 | 144.91 | 79.00 | 13.19 | 121.77 | 65.2% | Hayır | Yok |
| 10 | Group B invalid cost (> 75) | COGS: 50, Komis: GP, Marj: %GP, KDV: %20, Traffic: Evet | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 13.19 | 0.00 | 0.0% | Hayır | Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| 11 | Custom commission expired | COGS: 28, Komis: 10, Marj: %25, KDV: %20, Traffic: Hayır | 349.90 | 19% | 45.15 | 102.44 | 79.00 | 13.19 | 141.45 | 59.6% | Hayır | Yok |
| 12 | Missing COGS Guard | COGS: 0, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 13.19 | 0.00 | 0.0% | Hayır | Maliyet Eksik |
| 13 | Bugun Kargoda (True) | COGS: 60, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 409.90 | 19% | 52.81 | 104.53 | 93.05 | 5.99 | 179.99 | 56.1% | Hayır | Yok |
| 14 | High Ticket Scaling Trendyol | COGS: 830, Komis: GP, Marj: %20, KDV: %20, Traffic: Hayır | 2119.90 | 19% | 337.81 | 427.43 | 93.05 | 13.19 | 1455.50 | 31.3% | Hayır | Yok |
| 15 | Current Price tracking | COGS: 60, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 429.90 | 19% | 56.14 | 110.20 | 93.05 | 13.19 | 191.19 | 55.5% | Hayır | Yok |
