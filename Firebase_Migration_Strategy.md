# Firebase Migration Strategy — Femmelogy Pricing Dashboard

> **Document Type:** Architectural Design & Migration Plan  
> **Version:** 1.0  
> **Status:** Pre-Implementation (Code Freeze — Analysis Only)  
> **Scope:** localStorage → Firestore + Firebase Auth + Firebase Hosting  

---

## Executive Summary

The Femmelogy Pricing Engine is a battle-tested, 30/30-audited synchronous math engine.  
The migration to Firebase must be **additive and non-disruptive** — the math functions (`amazonHesap`, `trendyolHesap`) must **never be touched**.

The chosen architecture is the **Repository + State Hydration Pattern**:  
- A local `STATE` object continues to be the single source of truth for the math engine.  
- A new `firebase-db.js` module wraps all Firestore CRUD operations behind a clean interface.  
- Firebase operates as a **background sync layer**, not a blocking data layer.

---

## 1. Current Architecture Analysis

### 1.1 Data Flow (Current — localStorage)

```
User Action → app.js (sync) → STATE object (in-memory) → kaydet() → localStorage
                    ↑
               GP object reads from localStorage (also sync)
```

### 1.2 Identified Persistence Touchpoints

From codebase analysis, **9 distinct `kaydet()` call sites** exist across `app.js`:

| Line | Operation | Triggered By |
|---|---|---|
| 311 | `kaydet("amazon")` | `amazonYenidenHesapla()` — global recalc |
| 495 | `kaydet("amazon")` | `modalKaydet()` — save modal |
| 593 | `kaydet("amazon")` | Delete product |
| 2144 | `kaydet("amazon")` | Bulk Excel import |
| 1290 | `kaydet("trendyol")` | `modalTyKaydet()` — save modal |
| 1411 | `kaydet("trendyol")` | Delete product |
| 1455 | `kaydet("trendyol")` | `trendyolYenidenHesapla()` — global recalc |
| 1602 | `kaydet(aktif)` | Tab switch / export trigger |
| 2208 | `kaydet("trendyol")` | Bulk Excel import |

**Key Finding:** All writes go through a single `kaydet(platform)` function. This is the **only function that needs to change** to add Firebase sync.

### 1.3 GP Object (Global Parameters)

The `GP` object reads 6 keys from `localStorage` on every math call:
- `gp_kargo`, `gp_marj`, `gp_ty_komis`, `gp_ty_kargo`, `gp_ty_marj`

These are **user settings**, not product data — they should be stored in Firestore under a `users/{uid}/settings` document.

---

## 2. Core Architectural Challenges & Solutions

### Challenge 1 — Synchronous Math vs. Asynchronous Firestore

**Problem:**  
`STATE.amazon` and `STATE.trendyol` are populated synchronously at startup:
```javascript
// Current (Line 25-28)
const STATE = {
  amazon:   JSON.parse(localStorage.getItem("femmelogy_amazon")   || "[]"),
  trendyol: JSON.parse(localStorage.getItem("femmelogy_trendyol") || "[]"),
};
```
Firestore fetches are Promises (`async/await`). The math engine functions assume `STATE` is already populated when they are called.

**Solution — State Hydration Pattern:**

```
App Startup
    │
    ├── 1. Populate STATE from localStorage immediately (instant, zero latency)
    │        → UI renders with cached data (no blank screen)
    │
    ├── 2. Firebase Auth resolves (async, background)
    │        → onAuthStateChanged fires
    │
    └── 3. Firestore fetch resolves (async, background)
             → Hydrate STATE with Firestore data (merge/overwrite)
             → Re-render UI (tables refresh with latest data)
             → Update localStorage cache (for next offline start)
```

**The math engine is never called during the async window.** It is only called by user-triggered events (modal saves, bulk imports), which happen after startup hydration completes. No math function changes needed.

---

### Challenge 2 — Separation of Concerns (Repository Pattern)

**Solution — `firebase-db.js` Adapter Module**

Create a dedicated `firebase-db.js` file that acts as the **only point of contact** with Firebase. `app.js` never imports Firebase SDK directly.

```
app.js
  │  calls only:
  │    DB.save("amazon", STATE.amazon)
  │    DB.load("amazon")
  │    DB.delete("amazon", id)
  │    DB.saveSettings(gpObject)
  ↓
firebase-db.js (Repository Layer)
  │  internally calls:
  │    setDoc(), getDocs(), deleteDoc(), onSnapshot()
  ↓
Firestore SDK
```

**Proposed `firebase-db.js` Public Interface:**

```javascript
// firebase-db.js — Public API Contract
const DB = {
  init(userId)              // Called once on auth success
  save(platform, records)   // Write full array to Firestore
  load(platform)            // Return Promise<array>
  delete(platform, id)      // Delete single document
  saveSettings(gpObj)       // Write GP parameters
  loadSettings()            // Return Promise<gpSettings>
  subscribe(platform, cb)   // Real-time onSnapshot listener
  disconnect()              // Unsubscribe all listeners
};
```

**Impact on `app.js`:** Only 1 function changes — `kaydet()` becomes a wrapper:

```javascript
// New kaydet() — only addition, no removal
function kaydet(p) {
  localStorage.setItem("femmelogy_" + p, JSON.stringify(STATE[p])); // kept intact
  if (DB && DB.isReady()) {
    DB.save(p, STATE[p]).catch(err => console.error("Firestore sync failed:", err));
  }
}
```

> [!IMPORTANT]  
> The existing `localStorage.setItem()` line is **preserved**. Firestore sync is fire-and-forget (non-blocking). If Firebase is unavailable, the app continues working on localStorage with no error shown to the user.

---

### Challenge 3 — Offline Persistence

**Solution — Firestore Offline Persistence + localStorage Double-Write**

Firestore has a built-in IndexedDB-based offline cache that must be explicitly enabled:

```javascript
// firebase-db.js initialization
import { enableIndexedDbPersistence } from "firebase/firestore";

enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — persistence available in one tab only
    console.warn("Firestore offline persistence: multi-tab conflict");
  } else if (err.code === 'unimplemented') {
    // Browser does not support
    console.warn("Firestore offline persistence: not supported");
  }
});
```

**Three-Layer Fallback Architecture:**

```
Read Priority on Startup:
  Layer 1: Firestore onSnapshot (live, with offline cache)  ← Primary
  Layer 2: localStorage cache                               ← Fallback (instant)
  Layer 3: Empty array []                                   ← Last resort (new device)

Write Priority on Save:
  Layer 1: localStorage (synchronous, guaranteed)           ← Always writes first
  Layer 2: Firestore (async, queued offline if needed)     ← Syncs when online
```

When the user goes offline:
1. `kaydet()` still writes to `localStorage` instantly — **UI never breaks**
2. Firestore SDK queues the write in IndexedDB
3. When connectivity restores, Firestore auto-replays the queued operations
4. `onSnapshot` fires → STATE and UI refresh with confirmed server state

---

### Challenge 4 — Security & Authentication

**Solution — Firebase Email/Password Auth + Firestore Security Rules**

#### 4.1 Authentication Flow

```
App Loads
    │
    └── firebase.auth().onAuthStateChanged(user => {
            if (user) {
              DB.init(user.uid);        // Initialize DB with user's namespace
              DB.load("amazon").then(data => { STATE.amazon = data; amazonRender(); });
              DB.load("trendyol").then(data => { STATE.trendyol = data; trendyolRender(); });
            } else {
              showLoginScreen();        // Redirect to auth gate
            }
        });
```

**Login Gate Strategy:** A minimal `auth.html` page (or an overlay on `index.html`) shown before the dashboard. After successful login, it calls `window.location.href = 'index.html'` (or hides the overlay).

#### 4.2 Firestore Data Structure

```
Firestore Root
└── users/                          (collection)
    └── {uid}/                      (document — user namespace)
        ├── settings                (document)
        │   ├── gp_kargo: 93.05
        │   ├── gp_marj: 25
        │   ├── gp_ty_komis: 19
        │   ├── gp_ty_kargo: 93.05
        │   └── gp_ty_marj: 25
        ├── amazon/                 (sub-collection)
        │   ├── {product-id}        (document)
        │   │   ├── id: 1234567890
        │   │   ├── ad: "Ürün Adı"
        │   │   ├── sku: "SKU-001"
        │   │   ├── asin: "B0..."
        │   │   ├── maliyet: 100
        │   │   ├── ambalaj: 8
        │   │   ├── sabit: 5
        │   │   ├── hedefMarjPct: 20
        │   │   ├── kategori: "kozmetik"
        │   │   ├── currentPrice: 299.90
        │   │   └── buyboxPrice: 289.90
        │   └── ...
        └── trendyol/               (sub-collection)
            ├── {product-id}        (document)
            │   ├── id: 1234567891
            │   ├── ad: "Ürün Adı"
            │   ├── ozelKomis: null
            │   ├── vatSell: 20
            │   ├── bugunKargoda: false
            │   └── ...
            └── ...
```

> [!NOTE]  
> Each user's data is completely isolated under `users/{uid}`. No user can access another user's products.

#### 4.3 Firestore Security Rules

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can only access their own namespace
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Security guarantees:**
- ✅ Unauthenticated users → denied at Firebase level
- ✅ Authenticated User A cannot read User B's products
- ✅ Server-side enforcement (cannot be bypassed by JS manipulation)

---

## 3. New File Structure

```
Femmelogy_Pricing_Dashboard/
├── index.html              ← Add Firebase SDK script tags, auth gate overlay
├── app.js                  ← MINIMAL changes: kaydet() wrapper + auth listener
├── firebase-db.js          ← NEW: Repository layer (all Firestore logic here)
├── style.css               ← Unchanged
├── sw.js                   ← Update cache manifest to include firebase-db.js
├── manifest.json           ← Unchanged
├── firestore.rules         ← NEW: Security rules file
└── .firebaserc             ← NEW: Firebase project config (auto-generated)
```

> [!IMPORTANT]  
> **Files NOT modified:** `amazonHesap`, `trendyolHesap`, `calcGrupB`, `breakEvenFiyat`, `breakEvenFiyatAmz`, `APP_CONFIG`, all Flash Crash guardrails, and all rendering functions remain **100% untouched**.

---

## 4. Migration Phases

### Phase 0 — Firebase Project Setup (Prerequisites)
- [ ] Create Firebase project in Firebase Console
- [ ] Enable Firestore Database (production mode)
- [ ] Enable Firebase Authentication (Email/Password provider)
- [ ] Enable Firebase Hosting
- [ ] Run `firebase init` in project root → generates `.firebaserc` and `firebase.json`

### Phase 1 — Repository Layer (`firebase-db.js`)
- [ ] Write `firebase-db.js` with full `DB` interface (init, save, load, delete, subscribe, saveSettings, loadSettings)
- [ ] Unit test all DB methods against a Firestore emulator
- [ ] Write `firestore.rules` with security rules
- [ ] No changes to `app.js` during this phase

### Phase 2 — State Hydration Integration
- [ ] Add Firebase SDK to `index.html` (CDN or bundled)
- [ ] Add `onAuthStateChanged` listener that calls `DB.init()` then hydrates `STATE`
- [ ] Wrap `kaydet()` to call `DB.save()` as fire-and-forget (preserve localStorage line)
- [ ] Add GP settings read/write via `DB.saveSettings()` / `DB.loadSettings()`
- [ ] Update `sw.js` cache version to `femmelogy-v21-cache`

### Phase 3 — Auth Gate UI
- [ ] Design minimal login overlay / auth screen in `index.html`
- [ ] Implement email/password sign-in + sign-out button
- [ ] Handle auth error states (wrong password, network error)

### Phase 4 — Offline Persistence & Testing
- [ ] Enable `enableIndexedDbPersistence()` in `firebase-db.js`
- [ ] Test offline → make changes → go online → verify sync
- [ ] Test multi-device: login on Device A, confirm products appear on Device B

### Phase 5 — Deploy to Firebase Hosting
- [ ] Run `firebase deploy`
- [ ] Verify `https://{project-id}.web.app` serves the dashboard
- [ ] Run full 30-scenario audit against production deployment

---

## 5. Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Firestore down → app unusable | Low | High | localStorage fallback always active |
| Auth token expiry during session | Medium | Medium | `onAuthStateChanged` auto-refreshes tokens |
| Concurrent edits from 2 devices | Medium | Medium | `onSnapshot` real-time listener overwrites STATE — last write wins |
| IndexedDB not supported (old browser) | Low | Low | Silent fallback to online-only mode |
| Large inventory → Firestore read costs | Low | Low | All products under one user doc; read on login only |
| SW cache serving stale firebase-db.js | Medium | High | Bump cache version to v21 on every deploy |

---

## 6. Design Pattern Summary

| Pattern | Applied To | Purpose |
|---|---|---|
| **Repository Pattern** | `firebase-db.js` | Isolates all Firestore SDK calls behind a clean `DB` interface |
| **State Hydration Pattern** | `STATE` object startup | Bridges async Firestore with sync math engine |
| **Observer Pattern** | `DB.subscribe()` + `onSnapshot` | Real-time push updates across devices |
| **Double-Write Pattern** | `kaydet()` | localStorage + Firestore both written; guarantees offline resilience |
| **Namespace Isolation** | `users/{uid}/` Firestore path | Every user's data is completely isolated at the DB level |

---

## 7. Implementation Readiness Checklist

Before writing a single line of code, confirm:

- [ ] Firebase project created and plan selected (Spark/Blaze)
- [ ] Firebase project ID noted for `.firebaserc`
- [ ] Firebase API keys obtained (stored in `firebase-config.js`, excluded from git via `.gitignore`)
- [ ] `firebase-tools` installed globally (`npm install -g firebase-tools`)
- [ ] Team aligned on Firestore document ID strategy (use existing `Date.now()` IDs vs Firestore auto-IDs)

> [!CAUTION]  
> Firebase API keys must be added to `.gitignore` immediately. The public repo on GitHub must never contain production credentials. Use environment variables or a separate `firebase-config.js` file that is gitignored.

---

*This document is a read-only architectural specification. No code has been modified.*  
*Awaiting Product Owner approval to proceed to Phase 0.*
