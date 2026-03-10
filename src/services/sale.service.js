const { db } = require('../config/firebase');

/**
 * Admin approves an item for sale
 * Conditions:
 * - Item must exist
 * - Item must be marked saleEligible OR be older than 30 days and still pending
 * - Price must be a valid positive number
 */
const approveForSale = async (itemId, price) => {
  const ref = db.collection("items").doc(itemId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Item not found");
  }

  const item = doc.data();

  // 🔒 Ensure item is eligible for sale OR is older than 30 days and still pending
  let isEligible = item.saleEligible === true;

  if (!isEligible && item.status === 'pending' && item.createdAt) {
    let createdAtMs;
    // Handle Firestore Timestamp or ISO string
    if (item.createdAt._seconds) {
      createdAtMs = item.createdAt._seconds * 1000;
    } else {
      createdAtMs = new Date(item.createdAt).getTime();
    }

    const daysOld = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
    if (daysOld >= 30) {
      isEligible = true;
    }
  }

  if (!isEligible) {
    throw new Error("Item is not eligible for sale (must be saleEligible or older than 30 days and pending)");
  }

  // 🔒 Validate price
  if (typeof price !== "number" || price <= 0) {
    throw new Error("Invalid price");
  }

  await ref.update({
    price,
    saleEligible: true, // ensure it's marked eligible if it was approved by age
    saleApproved: true,
    saleStatus: "listed",
    approvedAt: Date.now(),
  });
};

/**
 * Buyer reserves an item
 * Rule: First buyer wins
 */
const reserveItem = async (itemId, buyerId) => {
  const ref = db.collection("items").doc(itemId);

  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);

    if (!doc.exists) {
      throw new Error("Item not found");
    }

    const item = doc.data();

    // 🔒 Item must be listed
    if (item.saleStatus !== "listed") {
      throw new Error("Item not available for sale");
    }

    t.update(ref, {
      saleStatus: "reserved",
      reservedBy: buyerId,
      reservedAt: Date.now(),
    });
  });
};

/**
 * Complete the sale
 * Condition:
 * - Item must be reserved before completing sale
 */
const completeSale = async (itemId, buyerId) => {
  const ref = db.collection("items").doc(itemId);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new Error("Item not found");
  }

  const item = doc.data();

  // 🔒 Ensure correct flow
  if (item.saleStatus !== "reserved") {
    throw new Error("Item must be reserved before completing sale");
  }

  await ref.update({
    saleStatus: "sold",
    ownerId: buyerId,
    soldAt: Date.now(),
  });
};

module.exports = {
  approveForSale,
  reserveItem,
  completeSale
};
