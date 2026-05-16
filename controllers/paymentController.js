const { db } = require("../config/firebase");
const {
  getAuthToken,
  createOrder,
  generatePaymentKey,
  verifyTransaction,
  getOrderTransactions,
} = require("../services/paymob");
const { logTransaction } = require("../utils/logger");
const { prepareStudentSubscriptionUpdate } = require("../services/subscriptionService");
const { recordSuccessfulPayment, establishPaymentDocument } = require("../services/paymentService");

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

    try {
      await establishPaymentDocument(db, { id: orderId, amount, studentId, studentName }, sessionId);
    } catch (firestoreError) {
      console.warn("Firestore payment record skipped:", firestoreError.message);
    }

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

    if (data.obj && data.obj.success === true) {
      const orderId = data.obj.order.id;
      const orderRef = db.collection("payments").doc(orderId.toString());

      try {
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
          console.warn("Webhook triggered but order not found in firestore:", orderId);
          return res.status(200).send('OK');
        }

        const orderData = orderDoc.data();
        if (orderData.status === "completed" || orderData.paymentStatus === "paid") {
          console.log("Order already marked as paid:", orderId);
          return res.status(200).send('OK');
        }

        const studentId = orderData.studentId;
        const amount = parseFloat(orderData.amount || 0);

        if (studentId && studentId !== "unknown") {
          const studentRef = db.collection("users").doc(studentId);
          const studentDoc = await studentRef.get();

          if (studentDoc.exists) {
            const sData = studentDoc.data();
            const totalFees = parseFloat(sData.totalFees || sData.feesTotal || sData.tuitionFees || 0);
            const currentPaid = parseFloat(sData.paidFees || sData.feesPaid || sData.feesCollected || 0);

            const nextPaid = currentPaid + amount;
            const remainingFees = Math.max(0, totalFees - nextPaid);
            const paymentStatus = remainingFees <= 0.009 ? "paid" : "partially_paid";

            const batch = db.batch();

            const billingCycle = sData.feesSubscriptionCycle || "yearly";
            let feesNextDueDate = sData.feesNextDueDate ? new Date(sData.feesNextDueDate.toDate ? sData.feesNextDueDate.toDate() : sData.feesNextDueDate) : null;
            if (billingCycle === 'monthly') {
              const now = new Date();
              if (!feesNextDueDate || now > feesNextDueDate) {
                feesNextDueDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
              }
            } else if (billingCycle === 'yearly') {
              const now = new Date();
              if (!feesNextDueDate || now > feesNextDueDate) {
                feesNextDueDate = new Date(now.getFullYear() + 1, now.getMonth(), 1);
              }
            }

            // Update student
            batch.update(studentRef, {
              paidFees: nextPaid,
              feesPaid: nextPaid,
              feesCollected: nextPaid,
              remainingFees: remainingFees,
              paymentStatus: paymentStatus,
              latestPaymentSessionId: orderId.toString(),
              latestPaymentStatus: "completed",
              latestPaymentAmount: amount,
              latestPaymentUpdatedAt: new Date(),
              lastPaidAt: new Date(),
              feesNextDueDate: feesNextDueDate || null
            });

            // Student's subcollection payment log
            const studentPaymentRef = studentRef.collection("payments").doc(orderId.toString());
            batch.set(studentPaymentRef, {
              sessionId: orderId.toString(),
              amount: amount,
              appliedAmount: amount,
              currency: orderData.currency || "EGP",
              status: "completed",
              paymentStatus: "paid",
              updatedAt: new Date(),
              paidAt: new Date(),
              source: "webhook"
            }, { merge: true });

            // Global payment update
            batch.update(orderRef, {
              status: "completed",
              paymentStatus: "paid",
              updatedAt: new Date(),
              paidAt: new Date(),
            });

            // If there's a parent, update parent
            const parentId = sData.parentId;
            if (parentId && parentId.trim() !== "") {
              const parentRef = db.collection("users").doc(parentId);
              const parentPaymentRef = parentRef.collection("payments").doc(orderId.toString());

              batch.set(parentPaymentRef, {
                sessionId: orderId.toString(),
                studentId: studentId,
                amount: amount,
                appliedAmount: amount,
                currency: orderData.currency || "EGP",
                status: "completed",
                paymentStatus: "paid",
                updatedAt: new Date(),
                paidAt: new Date(),
                source: "webhook"
              }, { merge: true });

              batch.update(parentRef, {
                latestPaymentSessionId: orderId.toString(),
                latestPaymentStudentId: studentId,
                latestPaymentStatus: "completed",
                latestPaymentAmount: amount,
                latestPaymentUpdatedAt: new Date()
              });
            }

            await batch.commit();
            console.log("Webhook processed and Firestore automatically updated for order:", orderId);
          } else {
            // Fallback if student somehow deleted
            await orderRef.update({
              status: "completed",
              paymentStatus: "paid",
              updatedAt: new Date(),
              paidAt: new Date(),
            });
          }
        } else {
          // No studentId associated
          await orderRef.update({
            status: "completed",
            paymentStatus: "paid",
            updatedAt: new Date(),
            paidAt: new Date(),
          });
        }
      } catch (firestoreError) {
        console.warn("Firestore webhook update failed:", firestoreError.message);
      }
    }

    res.status(200).send('OK');

  } catch (error) {
    console.error("Webhook processing error:", error.message);
    res.status(500).send('Error');
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
    res.json({ paymentStatus: "pending" });
  }
};

exports.checkPayment = async (req, res) => {
  try {
    const { orderId, transactionId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    // 1. Check double payment
    const orderRef = db.collection("payments").doc(orderId.toString());
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      await logTransaction(db, { orderId, transactionId, status: "invalid", reason: "Order not found in DB" });
      return res.status(404).json({ error: "Order not found" });
    }

    const orderData = orderDoc.data();
    if (orderData.status === "completed" || orderData.paymentStatus === "paid") {
      await logTransaction(db, { orderId, transactionId, status: "already_paid" });
      return res.json({ verified: true, paymentStatus: "paid", alreadyPaid: true });
    }

    // 2. Fetch from Paymob
    const token = await getAuthToken();
    let transaction = null;

    if (transactionId) {
      transaction = await verifyTransaction(token, transactionId);
    } else {
      const transactions = await getOrderTransactions(token, orderId);
      transaction = transactions.find((t) => t.success === true && !t.is_refunded);
      if (!transaction && transactions.length > 0) {
        transaction = transactions[0]; // fallback to first to log the failure reason
      }
    }

    if (!transaction) {
      await logTransaction(db, { orderId, transactionId, status: "failed", reason: "No transaction found in Paymob" });
      return res.json({ verified: false, reason: "Transaction not found" });
    }

    const tId = transaction.id;

    // 3. Verify success flag
    if (transaction.success !== true || transaction.is_refunded === true) {
      await logTransaction(db, { orderId, transactionId: tId, status: "failed", reason: "Paymob returned success=false or refunded" });
      return res.json({ verified: false, reason: "Payment not successful" });
    }

    // 4. Verify amount matches
    const expectedAmountCents = Number(orderData.amount || 0) * 100;
    const actualAmountCents = Number(transaction.amount_cents || 0);

    if (Math.abs(expectedAmountCents - actualAmountCents) > 10) { // small tolerance
      await logTransaction(db, {
        orderId,
        transactionId: tId,
        status: "invalid",
        reason: `Amount mismatch: expected ${expectedAmountCents}, got ${actualAmountCents}`
      });
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    // AUTH CHECK: Ownership verification
    const studentId = orderData.studentId;
    if (req.user && req.user.uid !== studentId) {
      // Only the original user can verify their own payment.
      return res.status(403).json({ error: "Unauthorized payment access" });
    }

    // IDEMPOTENCY CHECK
    if (orderData.lastProcessedTransaction === tId) {
      return res.status(200).json({ success: true, message: "Already processed", paymentStatus: "paid" });
    }

    // 5. Valid! Update Firestore (same batch as webhook)
    const amount = parseFloat(orderData.amount || 0);

    if (studentId && studentId !== "unknown") {
      const batch = db.batch();

      const subResult = await prepareStudentSubscriptionUpdate(
        db, batch, studentId, amount, { sessionId: orderId.toString() }
      );

      if (subResult) {
        await recordSuccessfulPayment(
          db, batch, orderId, tId, amount, studentId, orderData, subResult.sData,
          { sessionId: orderId.toString(), source: "server_verification" }
        );
        await batch.commit();
      } else {
        await orderRef.update({
          status: "completed",
          paymentStatus: "paid",
          updatedAt: new Date(),
          paidAt: new Date(),
          lastProcessedTransaction: tId
        });
      }
    } else {
      await orderRef.update({
        status: "completed",
        paymentStatus: "paid",
        updatedAt: new Date(),
        paidAt: new Date(),
        lastProcessedTransaction: tId
      });
    }

    await logTransaction(db, { orderId, transactionId: tId, status: "verified", amountCents: actualAmountCents });
    res.json({ verified: true, paymentStatus: "paid" });

  } catch (error) {
    console.error("Check Payment Error:", error);
    await logTransaction(db, { orderId: req.body.orderId, status: "failed", reason: "Exception: " + error.message });
    res.status(500).json({ error: "Internal server error during verification" });
  }
};
