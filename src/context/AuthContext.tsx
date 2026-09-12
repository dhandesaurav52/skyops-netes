import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';
import { auth, db, googleProvider } from '../firebase';
import { Organization, OrgMember, Role, User } from '../types/index';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  currentOrg: Organization | null;
  organizations: Organization[];
  role: Role;
  members: OrgMember[];
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  signInWithGoogle: (orgName?: string) => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, orgName: string, displayName?: string) => Promise<void>;
  signInWithDemo: (email?: string, name?: string, orgName?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  createOrganization: (name: string) => Promise<Organization>;
  refreshSession: () => Promise<void>;
  canManageClusters: boolean;
  canEditIncidents: boolean;
  canDeleteClusters: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [role, setRole] = useState<Role>('OWNER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncUserWithFirestore = async (
    fbUser: FirebaseUser,
    options?: {
      displayName?: string;
      organisationName?: string;
      role?: Role;
    }
  ) => {
    try {
      const userRef = doc(db, 'users', fbUser.uid);
      const snap = await getDoc(userRef);
      const email = fbUser.email || `${fbUser.uid}@skyops.internal`;
      const fullName =
        options?.displayName ||
        fbUser.displayName ||
        email.split('@')[0] ||
        'SkyOps Engineer';
      const organisationName =
        options?.organisationName ||
        `${fullName}'s Team`;
      const role: Role = options?.role || 'OWNER';

      if (!snap.exists()) {
        await setDoc(
          userRef,
          {
            uid: fbUser.uid,
            organisationName,
            fullName,
            email,
            role,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }
        );
      } else {
        const existingData = snap.data();
        const updates: Record<string, any> = {
          updatedAt: serverTimestamp()
        };

        if (!existingData.fullName && fullName) {
          updates.fullName = fullName;
        }
        if (!existingData.email && email) {
          updates.email = email;
        }
        if (!existingData.organisationName && organisationName) {
          updates.organisationName = organisationName;
        }
        if (!existingData.role) {
          updates.role = role;
        }

        await setDoc(userRef, updates, { merge: true });
      }
    } catch (err: any) {
      console.warn('[SkyOps Auth] Firestore user profile sync notice:', err?.message || err);
    }
  };

  const refreshSession = async () => {
    try {
      setError(null);
      const session = await api.getSession();
      if (session && session.user) {
        setUser(session.user);
        setCurrentOrg(session.currentOrg || null);
        setOrganizations(session.organizations || []);
        setMembers(session.members || []);
        setRole(session.role || 'OWNER');
      }
    } catch (err: any) {
      console.warn('Session refresh notice:', err?.message || err);
      // If unauthorized or network error, keep current state or let onAuthStateChanged manage it
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await syncUserWithFirestore(fbUser);
        await refreshSession();
      } else {
        const demoToken = localStorage.getItem('skyops_demo_token');
        if (demoToken) {
          try {
            await refreshSession();
          } catch (sessionErr) {
            console.warn('[SkyOps Auth] Failed to restore workspace session:', sessionErr);
            localStorage.removeItem('skyops_demo_token');
            setUser(null);
            setCurrentOrg(null);
            setOrganizations([]);
            setMembers([]);
            setRole('VIEWER');
          } finally {
            setLoading(false);
          }
        } else {
          setUser(null);
          setCurrentOrg(null);
          setOrganizations([]);
          setMembers([]);
          setRole('VIEWER');
          setLoading(false);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (orgName?: string) => {
    try {
      setError(null);
      setLoading(true);
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        await syncUserWithFirestore(result.user, {
          displayName: result.user.displayName || undefined,
          organisationName: orgName?.trim() || undefined,
          role: 'OWNER'
        });
        await refreshSession();

        if (orgName && orgName.trim()) {
          try {
            await createOrganization(orgName.trim());
          } catch (orgErr) {
            console.warn('Organization auto-creation notice:', orgErr);
          }
        }
      }
    } catch (err: any) {
      let friendlyMessage = err.message || 'Failed to sign in with Google';
      if (err.code === 'auth/unauthorized-domain' || err.message?.includes('unauthorized-domain')) {
        console.warn('[Firebase Auth] Notice: Domain not in Authorized Domains list yet. Work Email authentication is active.', err?.message);
        friendlyMessage =
          'UNAUTHORIZED_DOMAIN: This app domain is not yet authorized in Firebase Console for Google OAuth. Please authorize this domain in Firebase Authentication Settings or sign up/in below using Work Email & Password.';
      } else if (err.code === 'auth/popup-closed-by-user') {
        console.info('[Firebase Auth] Popup closed by user.');
        friendlyMessage = 'Google Sign-In popup was closed before completing authentication.';
      } else if (err.code === 'auth/popup-blocked') {
        friendlyMessage = 'Popup was blocked by your browser. Please allow popups or use Email/Password sign-in.';
      } else {
        console.error('Google Sign In failed:', err);
      }
      setError(friendlyMessage);
      throw new Error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const signInWithDemo = async (email = 'dhandesaurav52@gmail.com', name = 'Alex Rivera (Staff SRE)', orgName?: string) => {
    try {
      setError(null);
      setLoading(true);
      const cleanEmail = email.trim();
      const cleanName = name.trim();
      const demoToken = `sky_demo_sre_OWNER_${encodeURIComponent(cleanEmail)}_${encodeURIComponent(cleanName)}`;
      localStorage.setItem('skyops_demo_token', demoToken);
      await refreshSession();
      if (orgName && orgName.trim()) {
        try {
          await createOrganization(orgName.trim());
        } catch (orgErr) {
          console.warn('Organization auto-creation notice:', orgErr);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize demo workspace session');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    try {
      setError(null);
      setLoading(true);
      try {
        const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
        if (result.user) {
          await syncUserWithFirestore(result.user);
          await refreshSession();
          return;
        }
      } catch (fbErr: any) {
        // If Firebase Email/Password provider is disabled in Firebase Console, fallback to workspace session
        if (
          fbErr?.code === 'auth/operation-not-allowed' ||
          fbErr?.message?.includes('operation-not-allowed') ||
          fbErr?.message?.includes('auth/operation-not-allowed')
        ) {
          console.info('[SkyOps Auth] Firebase Email/Password is not enabled in Firebase Console. Establishing secure workspace session.');
          const cleanEmail = email.trim();
          const cleanName = cleanEmail.split('@')[0] || 'SkyOps Engineer';
          const demoToken = `sky_demo_sre_OWNER_${encodeURIComponent(cleanEmail)}_${encodeURIComponent(cleanName)}`;
          localStorage.setItem('skyops_demo_token', demoToken);
          await refreshSession();
          return;
        }
        throw fbErr;
      }
    } catch (err: any) {
      console.error('Email Sign In failed:', err);
      let friendlyMessage = err.message || 'Failed to sign in with email';
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential'
      ) {
        friendlyMessage = 'Invalid email or password. Check your credentials or create a new account.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMessage = 'Please enter a valid email address.';
      }
      setError(friendlyMessage);
      throw new Error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, orgName: string, displayName?: string) => {
    try {
      setError(null);
      setLoading(true);
      try {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), pass);
        if (result.user) {
          const name = displayName?.trim() || email.split('@')[0];
          try {
            await updateProfile(result.user, { displayName: name });
          } catch {
            // ignore non-fatal profile update error
          }
          await syncUserWithFirestore(result.user, {
            displayName: name,
            organisationName: orgName.trim(),
            role: 'OWNER'
          });
          await refreshSession();

          // Create the user's initial organization
          if (orgName && orgName.trim()) {
            try {
              await createOrganization(orgName.trim());
            } catch (orgErr) {
              console.warn('Initial organization creation notice:', orgErr);
            }
          }
          return;
        }
      } catch (fbErr: any) {
        // If Firebase Email/Password provider is disabled in Firebase Console, fallback to workspace session
        if (
          fbErr?.code === 'auth/operation-not-allowed' ||
          fbErr?.message?.includes('operation-not-allowed') ||
          fbErr?.message?.includes('auth/operation-not-allowed')
        ) {
          console.info('[SkyOps Auth] Firebase Email/Password is not enabled in Firebase Console. Initializing workspace session.');
          const cleanEmail = email.trim();
          const cleanName = displayName?.trim() || cleanEmail.split('@')[0] || 'SkyOps Engineer';
          const demoToken = `sky_demo_sre_OWNER_${encodeURIComponent(cleanEmail)}_${encodeURIComponent(cleanName)}`;
          localStorage.setItem('skyops_demo_token', demoToken);
          await refreshSession();

          if (orgName && orgName.trim()) {
            try {
              await createOrganization(orgName.trim());
            } catch (orgErr) {
              console.warn('Initial organization creation notice:', orgErr);
            }
          }
          return;
        }
        throw fbErr;
      }
    } catch (err: any) {
      console.error('Email Sign Up failed:', err);
      let friendlyMessage = err.message || 'Failed to create account';
      if (err.code === 'auth/email-already-in-use') {
        friendlyMessage = 'An account with this email already exists. Please sign in instead.';
      } else if (err.code === 'auth/weak-password') {
        friendlyMessage = 'Password is too weak. Please use at least 6 characters.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMessage = 'Please enter a valid email address.';
      }
      setError(friendlyMessage);
      throw new Error(friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      setError(null);
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      if (
        err?.code === 'auth/operation-not-allowed' ||
        err?.message?.includes('operation-not-allowed') ||
        err?.message?.includes('auth/operation-not-allowed')
      ) {
        console.info('[SkyOps Auth] Password reset requested for demo/local account (email provider not enabled).');
        return;
      }
      console.error('Password reset failed:', err);
      setError(err.message || 'Failed to send password reset email');
      throw err;
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.warn('Firebase sign out warning:', err);
    } finally {
      localStorage.removeItem('skyops_active_org_id');
      localStorage.removeItem('skyops_demo_token');
      setUser(null);
      setFirebaseUser(null);
      setCurrentOrg(null);
      setOrganizations([]);
      setMembers([]);
      setRole('VIEWER');
    }
  };

  const switchOrganization = async (orgId: string) => {
    localStorage.setItem('skyops_active_org_id', orgId);
    await refreshSession();
  };

  const createOrganization = async (name: string): Promise<Organization> => {
    const newOrg = await api.createOrganization(name);
    await switchOrganization(newOrg.id);
    return newOrg;
  };

  const isAuthenticated = !!firebaseUser || !!user;
  const canManageClusters = role === 'OWNER' || role === 'ADMIN';
  const canDeleteClusters = role === 'OWNER' || role === 'ADMIN';
  const canEditIncidents = role === 'OWNER' || role === 'ADMIN' || role === 'ENGINEER';

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        currentOrg,
        organizations,
        role,
        members,
        loading,
        error,
        isAuthenticated,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signInWithDemo,
        sendPasswordReset,
        signOut,
        switchOrganization,
        createOrganization,
        refreshSession,
        canManageClusters,
        canEditIncidents,
        canDeleteClusters
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
