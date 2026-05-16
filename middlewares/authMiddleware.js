const admin = require("firebase-admin");

async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // attach UID

        if (next) return next();
    } catch (error) {
        console.error("Auth token verification failed:", error);
        return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
}

module.exports = { verifyToken };
