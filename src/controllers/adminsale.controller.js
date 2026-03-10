const { approveForSale } = require("../services/sale.service");

/**
 * Admin approves an item for sale
 * Route: POST /api/admin/sale/approve
 */
const approveSale = async (req, res) => {
  try {
    const { itemId, price } = req.body;

    // ✅ BASIC VALIDATION
    if (!itemId || price === undefined) {
      return res.status(400).json({
        message: "itemId and price are required",
      });
    }

    // ✅ ADMIN ID (comes from auth middleware)
    // Your friend’s admin backend will later ensure this is an admin
    const adminId = req.user?.uid;

    if (!adminId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // ✅ CALL SERVICE (now includes audit logging)
    await approveForSale(itemId.trim(), price, adminId);

    return res.status(200).json({
      message: "Item approved for sale",
    });
  } catch (error) {
    console.error("❌ Admin approve error:", error.message);

    return res.status(500).json({
      message: error.message || "Failed to approve item",
    });
  }
};

/**
 * Admin fetches items eligible for marketplace (older than 30 days, pending)
 * Route: GET /api/admin/sale/eligible-items
 */
const getEligibleItems = async (req, res) => {
  try {
    const { db } = require('../config/firebase');

    // We cannot easily query purely by calculated age in Firestore without a complex index
    // So we fetch all 'pending' items and filter in memory, or query items created before 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // Be careful with timestamps: some are saved as ISO strings, some as Firestore Timestamps
    // We'll fetch all pending items and filter exactly to ensure no type mismatch issues

    const snapshot = await db.collection("items")
      .where("status", "==", "pending")
      .get();

    const eligibleItems = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Only items that are NOT already listed/sold
      if (data.saleStatus === 'listed' || data.saleStatus === 'sold' || data.saleStatus === 'reserved') {
        return;
      }

      let createdAtMs = null;
      if (data.createdAt) {
        if (data.createdAt._seconds) {
          createdAtMs = data.createdAt._seconds * 1000;
        } else {
          createdAtMs = new Date(data.createdAt).getTime();
        }
      }

      if (createdAtMs) {
        const daysOld = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
        if (daysOld >= 30 || data.saleEligible === true) {
          eligibleItems.push({ id: doc.id, ...data });
        }
      } else if (data.saleEligible === true) {
        eligibleItems.push({ id: doc.id, ...data });
      }
    });

    return res.status(200).json({
      success: true,
      data: eligibleItems,
    });
  } catch (error) {
    console.error("❌ Admin getEligibleItems error:", error.message);
    return res.status(500).json({
      message: error.message || "Failed to fetch eligible items",
    });
  }
};

module.exports = {
  approveSale,
  getEligibleItems
};
