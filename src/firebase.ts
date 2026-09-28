import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously as firebaseSignInAnonymously,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { getFirestore, initializeFirestore, setLogLevel, Firestore } from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata,
  FirebaseStorage
} from 'firebase/storage';
import fallbackConfig from '../firebase-applet-config.json';

const env = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};

const rawBucket = env.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket || 'skyops-a1143.firebasestorage.app';
const cleanStorageBucket = String(rawBucket).replace(/^gs:\/\//, '').trim();

// Resolve Firebase configuration: environment variables take precedence, falling back to applet config
export const resolvedFirebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId,
  storageBucket: cleanStorageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || fallbackConfig.appId,
  firestoreDatabaseId:
    env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (fallbackConfig as any).firestoreDatabaseId
};

// Initialize Firebase App instance safely (singleton pattern)
export const app = !getApps().length ? initializeApp(resolvedFirebaseConfig) : getApp();

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Suppress internal Firestore gRPC idle stream warnings
try {
  setLogLevel('silent');
} catch {}

// Initialize Cloud Firestore with configured databaseId or default
const databaseId = resolvedFirebaseConfig.firestoreDatabaseId;
let firestoreInstance: Firestore;
try {
  firestoreInstance =
    databaseId && databaseId !== '(default)'
      ? initializeFirestore(app, { experimentalForceLongPolling: true }, databaseId)
      : initializeFirestore(app, { experimentalForceLongPolling: true });
} catch {
  firestoreInstance =
    databaseId && databaseId !== '(default)'
      ? getFirestore(app, databaseId)
      : getFirestore(app);
}
export const db: Firestore = firestoreInstance;

// Initialize Firebase Cloud Storage with canonical bucket
export const storage: FirebaseStorage = getStorage(app, `gs://${cleanStorageBucket}`);

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  firebaseSignInAnonymously,
  firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getMetadata
};
export type { FirebaseUser, FirebaseStorage };
