const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/create-payment", paymentController.createPayment);
router.post("/webhook", paymentController.webhook);
router.post("/confirm-payment", paymentController.confirmPayment);

module.exports = router;