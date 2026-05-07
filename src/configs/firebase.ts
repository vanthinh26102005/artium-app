import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Pull required Firebase env vars and fail fast with a clear message if any are missing.
const getEnvVar = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[firebase] Missing required environment variable: ${key}`);
  }
  return value;
};

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: getEnvVar("EXPO_PUBLIC_FIREBASE_API_KEY"),
  authDomain: getEnvVar("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  projectId: getEnvVar("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: getEnvVar("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnvVar("EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnvVar("EXPO_PUBLIC_FIREBASE_APP_ID")
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize and export services
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export default app;
