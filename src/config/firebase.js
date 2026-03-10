const admin = require("firebase-admin");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

dotenv.config();

if (!admin.apps.length) {
  const commonConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
  };

  let serviceAccount = null;

  try {
    /**
     * Strategy 1 — Render / Production (ENV JSON)
     */
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log("Initializing Firebase using FIREBASE_SERVICE_ACCOUNT env...");
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }

    /**
     * Strategy 2 — Individual environment variables
     */
    else if (
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PROJECT_ID
    ) {
      console.log("Initializing Firebase using individual env variables...");
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      };
    }

    /**
     * Strategy 3 — Local serviceAccountKey.json (for local development)
     */
    else {
      const localPath = path.resolve(process.cwd(), "serviceAccountKey.json");

      if (fs.existsSync(localPath)) {
        console.log(`Initializing Firebase using local file: ${localPath}`);
        serviceAccount = require(localPath);
      }
    }

    /**
     * Initialize Firebase
     */
    if (serviceAccount) {
      admin.initializeApp({
        ...commonConfig,
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      console.log("Initializing Firebase using default credentials...");
      admin.initializeApp(commonConfig);
    }

    console.log("✅ Firebase Admin Initialized");
  } catch (error) {
    console.error("❌ Firebase Initialization Error:", error);
    throw error;
  }
}

/**
 * Export services
 */
const db = admin.firestore();
const auth = admin.auth();

module.exports = {
  admin,
  db,
  auth,
};