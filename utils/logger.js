/**
 * Transaction Logger
 * Writes verification attempts to Firestore `transactionLogs/{orderId}`.
 * Uses merge so repeated verifications append to the same document.
 */

const { FieldValue } = require("firebase-admin/firestore");

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} entry
 * @param {string} entry.orderId
 * @param {string|null} entry.transactionId
 * @param {"verified"|"already_paid"|"failed"|"invalid"} entry.status
 * @param {string} [entry.reason]
 * @param {number} [entry.amountCents]
 */
async function logTransaction(db, { orderId, transactionId, status, reason, amountCents }) {
    if (!orderId) return;

    const attempt = {
        transactionId: transactionId || null,
        status,
        reason: reason || null,
        amountCents: amountCents || null,
        attemptedAt: new Date().toISOString(),
    };

    try {
        await db
            .collection("transactionLogs")
            .doc(orderId.toString())
            .set(
                {
                    orderId: orderId.toString(),
                    lastAttemptAt: FieldValue.serverTimestamp(),
                    lastStatus: status,
                    attempts: FieldValue.arrayUnion(attempt),
                },
                { merge: true }
            );
    } catch (err) {
        // Logging must never break the verification flow
        console.warn("[logger] Failed to write transactionLog:", err.message);
    }
}

module.exports = { logTransaction };
