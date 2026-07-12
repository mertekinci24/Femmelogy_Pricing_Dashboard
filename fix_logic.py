import re

with open('app.js', 'r', encoding='utf-8') as f:
    js = f.read()

old_logic = '''  const paydaDus = 1 - KOMIS_DUS - m;
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
  };'''

new_logic = '''  const paydaDus = 1 - KOMIS_DUS - m;
  if (paydaDus <= 0) return { hata: "Hedef marj bu komisyon oranı için çok yüksek.", currCommissionAmt, currNetProfit, currMargin };
  const fiyatDus = en90eYuvarla(toplMaliyet / paydaDus);

  const paydaYuk = 1 - KOMIS_YUK - m;
  if (paydaYuk <= 0) return { hata: "Hedef marj yüksek komisyon kademesiyle de elde edilemiyor.", currCommissionAmt, currNetProfit, currMargin };
  const fiyatYuk = en90eYuvarla(toplMaliyet / paydaYuk);

  if (fiyatYuk >= SINIR) {
    const kar499 = OB_SABIT - toplMaliyet - (OB_SABIT * KOMIS_DUS);
    const karYuk = fiyatYuk - toplMaliyet - (fiyatYuk * KOMIS_YUK);

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
    } else {
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
  }

  // If fiyat_yuksek < 500, we just use fiyatDus
  const komisyonT = fiyatDus * KOMIS_DUS;
  const netKar = fiyatDus - toplMaliyet - komisyonT;
  const gercekM = (netKar / fiyatDus) * 100;
  return {
    satisF: fiyatDus, komisyonO: KOMIS_DUS * 100, komisyonT,
    toplamGider: toplMaliyet + komisyonT, netKar, gercekM,
    deadZone: false, olduBolge: false, maliyet, ambalaj, sabit, kargo, hedefMarjPct,
    currCommissionAmt, currNetProfit, currMargin
  };'''

js = js.replace(old_logic, new_logic)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(js)
