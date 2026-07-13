/**
 * firebase-db.js — Repository Layer (Phase 1)
 *
 * Implements the Repository Pattern as specified in Firebase_Migration_Strategy.md.
 * app.js NEVER imports Firebase SDK directly — all Firestore/Auth operations
 * go through the `DB` object exposed on window.DB.
 *
 * NOTE: firebase-config.js credentials are inlined here to avoid relative
 * import resolution issues on Firebase Hosting CDN. This file is served
 * directly; a separate firebase-config.js is still kept locally and gitignored.
 *
 * Public API:
 *   DB.init(userId)           — Set active user namespace
 *   DB.isReady                — Boolean: is DB initialised and user authenticated?
 *   DB.save(platform, arr)    — Write full product array to Firestore
 *   DB.load(platform)         — Return Promise<Array> of products
 *   DB.saveSettings(gpObj)    — Write GP global parameters
 *   DB.loadSettings()         — Return Promise<gpSettings object>
 *   DB.subscribe(platform,cb) — Real-time onSnapshot listener; returns unsubscribe fn
 *   DB.login(email, pass)     — Firebase Auth sign-in
 *   DB.logout()               — Firebase Auth sign-out
 *   DB.onAuthChange(cb)       — Listen to auth state changes
 *   DB.enableOffline()        — Enable IndexedDB offline persistence
 */

// ─── Firebase Config (inlined — firebase-config.js kept as local backup only)
const firebaseConfig = {
  apiKey:            "AIzaSyDRGaU6R6mo-LlBzmQLtY60D2cs75qnaPE",
  authDomain:        "femmelogy-pricing-engine.firebaseapp.com",
  projectId:         "femmelogy-pricing-engine",
  storageBucket:     "femmelogy-pricing-engine.firebasestorage.app",
  messagingSenderId: "1063762457017",
  appId:             "1:1063762457017:web:c7de1a47c64b7c13c28668"
};

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  enableIndexedDbPersistence,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
  onSnapshot,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ─── Firebase initialisation ────────────────────────────────────────────────
const _app  = initializeApp(firebaseConfig);
const _db   = getFirestore(_app);
const _auth = getAuth(_app);

// ─── Internal state ─────────────────────────────────────────────────────────
let _userId       = null;   // Active user UID
let _offlineReady = false;  // Has offline persistence been enabled?
const _listeners  = {};     // Active onSnapshot unsubscribe functions

// ─── Path helpers ───────────────────────────────────────────────────────────
// Strategy: store each platform's product array in a single document for
// simplicity and atomic writes. Path: users/{uid}/{platform}/inventory
function _platformDocRef(platform) {
  return doc(_db, 'users', _userId, platform, 'inventory');
}
function _settingsDocRef() {
  return doc(_db, 'users', _userId, 'meta', 'settings');
}

// ─── Public DB Object ────────────────────────────────────────────────────────
const DB = {

  /** True when a user is authenticated and DB namespace is initialised */
  get isReady() { return !!_userId; },

  /**
   * Called once after onAuthStateChanged confirms a valid user.
   * Sets the active user namespace for all subsequent operations.
   */
  init(userId) {
    _userId = userId;
    console.log('[DB] Initialised for user:', userId);
  },

  /**
   * Enable Firestore IndexedDB offline persistence.
   * Call once during app startup (before any reads/writes).
   */
  async enableOffline() {
    if (_offlineReady) return;
    try {
      await enableIndexedDbPersistence(_db);
      _offlineReady = true;
      console.log('[DB] Offline persistence enabled.');
    } catch (err) {
      if (err.code === 'failed-precondition') {
        console.warn('[DB] Offline persistence: multi-tab conflict — only one tab gets offline support.');
      } else if (err.code === 'unimplemented') {
        console.warn('[DB] Offline persistence: not supported in this browser.');
      }
    }
  },

  /**
   * Write the full product array for a platform to Firestore.
   * Stored as a single document: users/{uid}/{platform}/inventory
   * @param {string} platform — "amazon" or "trendyol"
   * @param {Array}  records  — Full STATE.amazon or STATE.trendyol array
   * @returns {Promise<void>}
   */
  async save(platform, records) {
    if (!_userId) throw new Error('[DB] save() called before init()');
    const ref = _platformDocRef(platform);
    await setDoc(ref, {
      records:   records,
      updatedAt: new Date().toISOString(),
      count:     records.length
    });
  },

  /**
   * Load the product array for a platform from Firestore.
   * @param {string} platform — "amazon" or "trendyol"
   * @returns {Promise<Array>} — product array (empty if document doesn't exist)
   */
  async load(platform) {
    if (!_userId) throw new Error('[DB] load() called before init()');
    const ref  = _platformDocRef(platform);
    const snap = await getDoc(ref);
    if (!snap.exists()) return [];
    return snap.data().records || [];
  },

  /**
   * Write GP global parameters to Firestore.
   * @param {Object} gpObj — { kargo, marj, tyKomis, tyKargo, tyMarj }
   * @returns {Promise<void>}
   */
  async saveSettings(gpObj) {
    if (!_userId) throw new Error('[DB] saveSettings() called before init()');
    await setDoc(_settingsDocRef(), {
      ...gpObj,
      updatedAt: new Date().toISOString()
    });
  },

  /**
   * Load GP global parameters from Firestore.
   * @returns {Promise<Object|null>} — settings object or null if not set
   */
  async loadSettings() {
    if (!_userId) throw new Error('[DB] loadSettings() called before init()');
    const snap = await getDoc(_settingsDocRef());
    if (!snap.exists()) return null;
    return snap.data();
  },

  /**
   * Subscribe to real-time updates for a platform.
   * Calls `callback(records)` every time Firestore data changes.
   * @param {string}   platform — "amazon" or "trendyol"
   * @param {Function} callback — receives the updated records array
   * @returns {Function} unsubscribe function
   */
  subscribe(platform, callback) {
    if (!_userId) throw new Error('[DB] subscribe() called before init()');
    // Unsubscribe any existing listener for this platform
    if (_listeners[platform]) _listeners[platform]();
    const ref = _platformDocRef(platform);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        callback(snap.data().records || []);
      }
    }, (err) => {
      console.error('[DB] onSnapshot error:', err);
    });
    _listeners[platform] = unsub;
    return unsub;
  },

  /** Unsubscribe all active real-time listeners */
  disconnect() {
    Object.values(_listeners).forEach(unsub => unsub());
    Object.keys(_listeners).forEach(k => delete _listeners[k]);
    console.log('[DB] All listeners disconnected.');
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Sign in with email and password.
   * @returns {Promise<UserCredential>}
   */
  async login(email, password) {
    return signInWithEmailAndPassword(_auth, email, password);
  },

  /** Sign out the current user. */
  async logout() {
    DB.disconnect();
    _userId = null;
    return signOut(_auth);
  },

  /**
   * Register a callback for auth state changes.
   * Callback receives `user` (Firebase User) or `null` when signed out.
   * @param {Function} callback
   */
  onAuthChange(callback) {
    onAuthStateChanged(_auth, callback);
  }

};

// ─── Global exposure ─────────────────────────────────────────────────────────
// ES Modules run in strict isolated scope. Explicitly attach DB to window so
// non-module app.js scripts can access window.DB from their global context.
window.DB = DB;
console.log('[firebase-db.js] window.DB is now globally available. isReady:', DB.isReady);

// Enable Firestore offline persistence immediately on module load
DB.enableOffline();

export { DB };
