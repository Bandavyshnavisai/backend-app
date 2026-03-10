const express = require("express");
const { approveSale, getEligibleItems } = require("../controllers/adminsale.controller");
const authenticate = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");

const router = express.Router();

router.get("/eligible-items", authenticate, authorize('admin'), getEligibleItems);
router.post("/approve", authenticate, authorize('admin'), approveSale);

module.exports = router;

