const { db } = require("../config/firebase");
const { getAuthToken, createOrder, generatePaymentKey } = require("../services/paymob");

exports.createPayment = async (req, res) => {
  try {
    const { amount, studentId, studentName, sessionId } = req.body;

    console.log("Amount:", amount);

    const token = await getAuthToken();
    console.log("Token:", token);

    const orderId = await createOrder(token, amount);
    console.log("OrderId:", orderId);

    const paymentToken = await generatePaymentKey(token, orderId, amount);
    console.log("PaymentToken:", paymentToken);

    await db.collection("payments").doc(orderId.toString()).set({
      sessionId: sessionId || "web_session",
      studentId: studentId || "unknown",
      studentName: studentName || "Test Student",
      amount: amount,
      appliedAmount: amount,
      currency: "EGP",
      status: "pending",
      paymentStatus: "pending",
      paymentMethod: "card",
      source: "paymob",
      initiatedByRole: "student",
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null
    });

    const iframeUrl =
      `https://accept.paymob.com/api/acceptance/iframes/1010977?payment_token=${paymentToken}`;
    res.json({ iframeUrl, sessionId: orderId.toString() });

  } catch (error) {
    console.log("ERROR STATUS:", error.response?.status);
    console.log("ERROR DATA:", error.response?.data);
    console.log("ERROR MESSAGE:", error.message);

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
};

exports.webhook = async (req, res) => {
  try {
    const data = req.body;

    if (data.obj.success === true) {
      const orderId = data.obj.order.id;

      await db.collection("payments")
        .doc(orderId.toString())
        .update({
          status: "successful",
          paymentStatus: "paid",
          updatedAt: new Date(),
          paidAt: new Date(),
        });
    }

    res.sendStatus(200);

  } catch (error) {
    res.sendStatus(500);
  }
};

exports.confirmPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const docRef = db.collection("payments").doc(sessionId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.json({ paymentStatus: "pending" });
    }

    const data = doc.data();
    res.json({ paymentStatus: data.paymentStatus || "pending" });
  } catch (error) {
    console.error("Confirm Payment Error:", error);
    res.status(500).json({ error: "Server Error" });
  }
};