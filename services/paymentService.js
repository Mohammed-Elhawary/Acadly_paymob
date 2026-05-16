/**
 * Payment Service
 * Handles persistence of payment histories and verifying the integrity of orders.
 */

async function recordSuccessfulPayment(db, batch, orderId, transactionId, amount, studentId, orderData, sData, sessionData) {
    // 1) Student local log
    const studentRef = db.collection("users").doc(studentId);
    const studentPaymentRef = studentRef.collection("payments").doc(orderId.toString());

    batch.set(studentPaymentRef, {
        sessionId: sessionData.sessionId,
        amount: amount,
        appliedAmount: amount,
        currency: orderData.currency || "EGP",
        status: "completed",
        paymentStatus: "paid",
        updatedAt: new Date(),
        paidAt: new Date(),
        source: sessionData.source,
        transactionId: transactionId
    }, { merge: true });

    // 2) Parent local log (if connected)
    const parentId = sData ? sData.parentId : null;
    if (parentId && parentId.trim() !== "") {
        const parentRef = db.collection("users").doc(parentId);
        const parentPaymentRef = parentRef.collection("payments").doc(orderId.toString());

        batch.set(parentPaymentRef, {
            sessionId: sessionData.sessionId,
            studentId: studentId,
            amount: amount,
            appliedAmount: amount,
            currency: orderData.currency || "EGP",
            status: "completed",
            paymentStatus: "paid",
            updatedAt: new Date(),
            paidAt: new Date(),
            source: sessionData.source,
            transactionId: transactionId
        }, { merge: true });

        batch.update(parentRef, {
            latestPaymentSessionId: sessionData.sessionId,
            latestPaymentStudentId: studentId,
            latestPaymentStatus: "completed",
            latestPaymentAmount: amount,
            latestPaymentUpdatedAt: new Date()
        });
    }

    // 3) Global order tracker
    const orderRef = db.collection("payments").doc(orderId.toString());
    batch.update(orderRef, {
        status: "completed",
        paymentStatus: "paid",
        updatedAt: new Date(),
        paidAt: new Date(),
        lastProcessedTransaction: transactionId
    });
}

function establishPaymentDocument(db, orderData, sessionId) {
    return db.collection("payments").doc(orderData.id.toString()).set({
        sessionId: sessionId || "web_session",
        studentId: orderData.studentId || "unknown",
        studentName: orderData.studentName || "Test Student",
        amount: orderData.amount,
        appliedAmount: orderData.amount,
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
}

module.exports = {
    recordSuccessfulPayment,
    establishPaymentDocument
};
