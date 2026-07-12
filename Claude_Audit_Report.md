# Femmelogy Pricing Engine - Independent Audit Data

## 1. System Architecture & Core Formulas

### 1.1 Turnover Margin Base
Profit margins are strictly calculated based on the **Turnover / Revenue (Ciro)** of the sale, rather than markup on cost.
- **Formula:**
  $$\text{Net Margin} = \frac{\text{Net Profit}}{\text{Selling Price}} \times 100$$

### 1.2 Price Rounding Strategy (X.90 Ceil)
To maintain a premium pricing strategy and align with consumer psychological pricing (X.90 rule), recommended prices are ceiled to the top of the tens decade.
- **Algorithm:**
  $$\text{CeilValue} = \text{ceil}(p \times 100) / 100$$
  $$\text{Decade} = \text{floor}(\text{CeilValue} / 10)$$
  $$\text{Candidate} = \text{Decade} \times 10 + 9.90$$
  If $\text{Candidate} < \text{CeilValue}$, then $\text{Candidate} = \text{Candidate} + 10$.

### 1.3 Amazon Engine Mechanics

#### 1.3.1 Divisional Pricing Formula
$$P = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - K_{\text{commission}} - M_{\text{target}}}$$
Where:
- $C_{\text{COGS}}$ is the sum of product cost, packaging, and unit fixed overhead.
- $C_{\text{shipping}}$ is the baseline shipping fee.
- $K_{\text{commission}}$ is the category commission rate (10.8% under 500 TL, 16.8% above 500 TL for Cosmetic; flat 16.2% for Health; flat 10.8% for Other).
- $M_{\text{target}}$ is the target profit margin.

#### 1.3.2 Dead Zone (Ölü Bölge) Logic
When pricing items in the cosmetic category, crossing the 500 TL threshold immediately increases the commission from 10.8% to 16.8%. The system simulates the net cash profit at 499.90 TL ($KOMIS = 10.8\%$) vs the natural priced item ($KOMIS = 16.8\%$).
- If $\text{Profit}_{\text{OB_SABIT}(499.90)} \ge \text{Profit}_{\text{Natural}}$, the price is hard-capped at **499.90 TL** to maximize net cash profit.

#### 1.3.3 Amazon Break-Even Solver
Calculates the lowest selling price where net profit is exactly 0.
- For Health category: $P_{\text{BE}} = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - 0.162}$
- For Other category: $P_{\text{BE}} = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - 0.108}$
- For Cosmetic category: If the lower tier break-even ($P_{\text{BE,low}} = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - 0.108}$) is $< 500$ TL, that value is used. Otherwise, it scales to the higher commission tier ($P_{\text{BE,high}} = \frac{C_{\text{COGS}} + C_{\text{shipping}}}{1 - 0.168}$).

---

### 1.4 Trendyol Engine Mechanics

#### 1.4.1 Global Profit Maximizer
Instead of a simple sequential check, the engine uses a candidate-based approach:
1. Calculates recommended prices for all cargo tiers:
   - Tier 1: 0 - 199.99 TL (Cargo: 41.00 TL, return fee: 0 TL)
   - Tier 2: 200 - 349.99 TL (Cargo: 79.00 TL, return fee: 1.03 TL)
   - Tier 3: 350+ TL (Cargo: 93.05 TL, return fee: 1.03 TL)
2. Validates candidates to ensure they fall within their respective cargo bounds.
3. Automatically tests "Barem Trap / Barem Optimization" boundaries (**199.90 TL** and **349.90 TL**).
4. Selects the candidate that yields the absolute **highest cash net profit**.

#### 1.4.2 KDV Offset Logic
Calculates net VAT by offsetting the VAT collected from the consumer against the VAT paid on the shipping invoice.
- **Formula:**
  $$\text{Net VAT} = \max(0, \text{Price} \times \frac{\text{VAT}_{\text{sell}}}{100 + \text{VAT}_{\text{sell}}} - \text{Cargo}_{\text{excl. VAT}} \times \frac{\text{VAT}_{\text{sell}}}{100})$$
  *(This allows extreme low-cost items to completely offset their VAT burden to 0 TL).*

#### 1.4.3 Group B (Traffic Product Strategy)
Applied to low-cost products ($< 75$ TL target) to drive store traffic by removing fixed overheads and return allowances, setting target margin to exactly 2%, and calculating Minimum Order Quantity (MOQ).
- **MOQ Rules:**
  - If $Price \le 25 \implies MOQ = 6$
  - If $25 < Price \le 35 \implies MOQ = 3$
  - If $35 < Price \le 50 \implies MOQ = 3$
  - If $50 < Price \le 75 \implies MOQ = 2$

---

## 2. Amazon Engine - 15 Edge-Case Scenarios

| ID | Description | Inputs | Rec Price (₺) | Comm % | Net Profit (₺) | Margin | Break-Even (₺) | Max Discount % | Dead Zone | Error/Hata |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Normal < 500 TL (Kozmetik) | Maliyet: 150, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 379.90 | 10.8% | 80.82 | 21.3% | 289.29 | 23.9% | Hayır | Yok |
| 2 | Maliyet Eksik (Error Guard) | Maliyet: 0, Amb: 0, Sabit: 0, Marj: %20, Kat: kozmetik | 0.00 | 0% | 0.00 | N/A | 0.00 | 0.0% | Hayır | Maliyet Eksik |
| 3 | Prices naturally just above 500 TL (>500 limit) | Maliyet: 310, Amb: 10, Sabit: 5, Marj: %20, Kat: kozmetik | 669.90 | 16.8% | 139.31 | 20.8% | 468.67 | 30.0% | Hayır | Yok |
| 4 | Dead Zone Override triggered (kar499 > karYuk) | Maliyet: 280, Amb: 10, Sabit: 5, Marj: %25, Kat: kozmetik | 669.90 | 16.8% | 169.31 | 25.3% | 435.03 | 35.1% | Hayır | Yok |
| 5 | Flat Commission bypass Dead Zone - Sağlık | Maliyet: 280, Amb: 10, Sabit: 5, Marj: %25, Kat: saglik | 669.90 | 16.2% | 173.33 | 25.9% | 463.07 | 30.9% | Hayır | Yok |
| 6 | Flat Commission bypass Dead Zone - Diğer | Maliyet: 280, Amb: 10, Sabit: 5, Marj: %25, Kat: diger | 609.90 | 10.8% | 155.98 | 25.6% | 435.03 | 28.7% | Hayır | Yok |
| 7 | High Ticket Scaling (2000 TL target) | Maliyet: 1200, Amb: 20, Sabit: 10, Marj: %15, Kat: kozmetik | 1949.90 | 16.8% | 299.27 | 15.3% | 1590.20 | 18.4% | Hayır | Yok |
| 8 | Negative / Zero Cost Guard (Ambalaj & Sabit > 0, Maliyet = 0) | Maliyet: 0, Amb: 5, Sabit: 2, Marj: %20, Kat: kozmetik | 149.90 | 10.8% | 33.66 | 22.5% | 112.16 | 25.2% | Hayır | Yok |
| 9 | Extremely low margin target | Maliyet: 50, Amb: 5, Sabit: 5, Marj: %2, Kat: kozmetik | 179.90 | 10.8% | 7.42 | 4.1% | 171.58 | 4.6% | Hayır | Yok |
| 10 | Extremely high margin target (may exceed 100% divisor) | Maliyet: 50, Amb: 5, Sabit: 5, Marj: %85, Kat: kozmetik | 0.00 | 0% | 0.00 | N/A | 0.00 | 0.0% | Hayır | Hedef marj yüksek komisyon kademesiyle de elde edilemiyor. |
| 11 | Borderline high category (> 2000 TL) | Maliyet: 1500, Amb: 20, Sabit: 20, Marj: %25, Kat: kozmetik | 2809.90 | 16.8% | 704.79 | 25.1% | 1962.80 | 30.1% | Hayır | Yok |
| 12 | Saglik category (Normal price) | Maliyet: 100, Amb: 5, Sabit: 5, Marj: %15, Kat: saglik | 299.90 | 16.2% | 48.27 | 16.1% | 242.30 | 19.2% | Hayır | Yok |
| 13 | Diger category (Normal price) | Maliyet: 100, Amb: 5, Sabit: 5, Marj: %15, Kat: diger | 279.90 | 10.8% | 46.62 | 16.7% | 227.63 | 18.7% | Hayır | Yok |
| 14 | Borderline lower limit (Very cheap items) | Maliyet: 10, Amb: 1, Sabit: 1, Marj: %10, Kat: kozmetik | 139.90 | 10.8% | 19.74 | 14.1% | 117.77 | 15.8% | Hayır | Yok |
| 15 | Dead Zone Override with current price provided | Maliyet: 280, Amb: 10, Sabit: 5, Marj: %25, Kat: kozmetik | 669.90 | 16.8% | 169.31 | 25.3% | 435.03 | 35.1% | Hayır | Yok |

---

## 3. Trendyol Engine - 15 Edge-Case Scenarios

| ID | Description | Inputs | Rec Price (₺) | Comm % | Net VAT (₺) | Net Profit (₺) | Cargo Fee (₺) | Hizmet (₺) | Break-Even (₺) | Max Discount % | Traffic Mode | Error/Hata |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Grup B (Traffic Product) MOQ=6 | COGS: 6, Komis: GP, Marj: %2, KDV: %20, Traffic: Evet | 39.90 | 19% | 13.12 | 12.24 | 41.00 | 5.99 | 0.00 | 0.0% | Evet | Yok |
| 2 | Grup B (Traffic Product) MOQ=3 | COGS: 19, Komis: GP, Marj: %2, KDV: %20, Traffic: Evet | 69.90 | 19% | 16.47 | 5.17 | 41.00 | 5.99 | 0.00 | 0.0% | Evet | Yok |
| 3 | Grup B (Traffic Product) MOQ=2 | COGS: 31, Komis: GP, Marj: %2, KDV: %20, Traffic: Evet | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 5.99 | 0.00 | 0.0% | Hayır | Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| 4 | Grup B (Traffic Product) too expensive (Error) | COGS: 85, Komis: GP, Marj: %2, KDV: %20, Traffic: Evet | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 5.99 | 0.00 | 0.0% | Hayır | Bu maliyet Grup B (Trafik) stratejisi için çok yüksek (75₺ aşılıyor). |
| 5 | 199.90 Barem Trap (Stay cheaper tier) | COGS: 74, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 449.90 | 19% | 59.47 | 116.26 | 93.05 | 5.99 | 250.98 | 44.2% | Hayır | Yok |
| 6 | 349.90 Barem Opt (Jump to higher tier) | COGS: 140, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 609.90 | 19% | 86.14 | 153.20 | 93.05 | 5.99 | 371.77 | 39.0% | Hayır | Yok |
| 7 | Maliyet Eksik Guard (Trendyol) | COGS: 0, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 0.00 | 19% | 0.00 | 0.00 | 0.00 | 5.99 | 0.00 | 0.0% | Hayır | Maliyet Eksik |
| 8 | Extreme low cost item (KDV Offset) | COGS: 4, Komis: GP, Marj: %20, KDV: %20, Traffic: Hayır | 349.90 | 19% | 45.15 | 133.64 | 79.00 | 5.99 | 92.95 | 73.4% | Hayır | Yok |
| 9 | Custom commission override active | COGS: 110, Komis: 10, Marj: %25, KDV: %20, Traffic: Hayır | 439.90 | 10% | 57.81 | 113.42 | 93.05 | 5.99 | 269.27 | 38.8% | Hayır | Yok |
| 10 | Custom commission override expired | COGS: 110, Komis: 10, Marj: %25, KDV: %20, Traffic: Hayır | 539.90 | 19% | 74.47 | 138.16 | 93.05 | 5.99 | 306.94 | 43.1% | Hayır | Yok |
| 11 | High Ticket Scaling Trendyol (2000 TL target) | COGS: 1130, Komis: GP, Marj: %20, KDV: %20, Traffic: Hayır | 2779.90 | 19% | 447.81 | 559.23 | 93.05 | 5.99 | 1910.63 | 31.3% | Hayır | Yok |
| 12 | Today cargo vs Normal shipping cargo fee impact | COGS: 110, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 559.90 | 19% | 77.81 | 143.83 | 93.05 | 13.19 | 318.13 | 43.2% | Hayır | Yok |
| 13 | VAT 10% scenario | COGS: 110, Komis: GP, Marj: %25, KDV: %10, Traffic: Hayır | 469.90 | 19% | 34.26 | 121.68 | 93.05 | 5.99 | 282.92 | 39.8% | Hayır | Yok |
| 14 | Invalid Divisor Error (komis + marj + kdv >= 100%) | COGS: 110, Komis: GP, Marj: %75, KDV: %20, Traffic: Hayır | 0.00 | 0% | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | Hayır | Komisyon + Hedef Marj + KDV %100 veya üstündedir. |
| 15 | Standard Normal Scenario Trendyol (>350 price) | COGS: 220, Komis: GP, Marj: %25, KDV: %20, Traffic: Hayır | 819.90 | 19% | 121.14 | 208.30 | 93.05 | 5.99 | 496.12 | 39.5% | Hayır | Yok |
