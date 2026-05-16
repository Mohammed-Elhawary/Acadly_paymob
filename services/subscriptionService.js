/**
 * Subscription Service
 * Handles calculation of subscription cycles and applying fees logic.
 */

function calculateNextDueDate(billingCycle, currentNextDueDateStr) {
    let feesNextDueDate = currentNextDueDateStr
        ? new Date(currentNextDueDateStr.toDate ? currentNextDueDateStr.toDate() : currentNextDueDateStr)
        : null;

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
    return feesNextDueDate;
}

async function prepareStudentSubscriptionUpdate(db, batch, studentId, amount, sessionData) {
    const studentRef = db.collection("users").doc(studentId);
    const studentDoc = await studentRef.get();

    if (!studentDoc.exists) return null;

    const sData = studentDoc.data();
    const totalFees = parseFloat(sData.totalFees || sData.feesTotal || sData.tuitionFees || 0);
    const currentPaid = parseFloat(sData.paidFees || sData.feesPaid || sData.feesCollected || 0);

    const nextPaid = currentPaid + amount;
    const remainingFees = Math.max(0, totalFees - nextPaid);
    const paymentStatus = remainingFees <= 0.009 ? "paid" : "partially_paid";

    const billingCycle = sData.feesSubscriptionCycle || "yearly";
    let feesNextDueDate = calculateNextDueDate(billingCycle, sData.feesNextDueDate);

    batch.update(studentRef, {
        paidFees: nextPaid,
        feesPaid: nextPaid,
        feesCollected: nextPaid,
        remainingFees: remainingFees,
        paymentStatus: paymentStatus,
        latestPaymentSessionId: sessionData.sessionId,
        latestPaymentStatus: "completed",
        latestPaymentAmount: amount,
        latestPaymentUpdatedAt: new Date(),
        lastPaidAt: new Date(),
        feesNextDueDate: feesNextDueDate || null
    });

    return { studentRef, sData, paymentStatus };
}

module.exports = {
    calculateNextDueDate,
    prepareStudentSubscriptionUpdate
};
