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

    try {
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
          return res.sendStatus(200);
        }

        const orderData = orderDoc.data();
        if (orderData.status === "completed" || orderData.paymentStatus === "paid") {
          console.log("Order already marked as paid:", orderId);
          return res.sendStatus(200);
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
              lastPaidAt: new Date()
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

    res.sendStatus(200);

  } catch (error) {
    console.error("Webhook processing error:", error.message);
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
    res.json({ paymentStatus: "pending" });
  }
};
