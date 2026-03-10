const { db, admin } = require('../config/firebase');

class ClaimsService {
    /**
     * Create a new claim
     * @param {string} itemId 
     * @param {string} claimantUid 
     * @returns {Promise<Object>}
     */
    async createClaim(itemId, claimantUid) {
        // Prevent duplicate claims per item per user
        // We check if there is an existing claim for this item by this user that is NOT rejected?
        // Prompt says "Prevent duplicate claims per item per user". 
        // Usually implies any active claim. But maybe even history?
        // I will check for 'pending' or 'approved' status. If rejected, maybe they can claim again?
        // Let's stick to strict "duplicate" -> if one exists with same itemId and claimantUid, block it?
        // "Status defaults to pending".
        // Let's assume we block if there's a pending or approved claim. Rejected ones might allow retry.
        // Actually, prompt just says "Prevent duplicate claims per item per user".
        // I'll check for any claim with same itemId and claimantUid that is NOT rejected.

        const existingClaims = await db.collection('claims')
            .where('itemId', '==', itemId)
            .where('claimantUid', '==', claimantUid)
            .where('status', 'in', ['pending', 'approved'])
            .get();

        if (!existingClaims.empty) {
            throw new Error('Duplicate claim: You have already claimed this item.');
        }

        const newClaim = {
            itemId,
            claimantUid,
            status: 'pending',
            aiConfidence: Math.floor(Math.random() * 100), // Mock AI confidence
            adminNotes: [],
            locked: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('claims').add(newClaim);
        return { id: docRef.id, ...newClaim };
    }

    /**
     * Get claims for a specific user
     * @param {string} uid 
     * @returns {Promise<Array>}
     */
    async getMyClaims(uid) {
        const snapshot = await db.collection('claims')
            .where('claimantUid', '==', uid)
            .orderBy('createdAt', 'desc')
            .get();

        const claims = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch associated items for each claim
        for (const claim of claims) {
            if (claim.itemId) {
                try {
                    const itemDoc = await db.collection('items').doc(claim.itemId).get();
                    if (itemDoc.exists) {
                        claim.item = { id: itemDoc.id, ...itemDoc.data() };
                    }
                } catch (e) {
                    console.error("Error fetching item for claim:", e);
                }
            }
        }

        return claims;
    }

    /**
     * Get all pending claims (Admin)
     * @returns {Promise<Array>}
     */
    async getPendingClaims() {
        const snapshot = await db.collection('claims')
            .where('status', '==', 'pending')
            .get();

        const claims = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort in memory (oldest first for admin queue)
        claims.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeA - timeB;
        });

        // Fetch associated items for each claim
        for (const claim of claims) {
            if (claim.itemId) {
                try {
                    const itemDoc = await db.collection('items').doc(claim.itemId).get();
                    if (itemDoc.exists) {
                        claim.item = { id: itemDoc.id, ...itemDoc.data() };
                    }
                } catch (e) {
                    console.error("Error fetching item for claim:", e);
                }
            }
        }

        return claims;
    }

    /**
     * Get claims by status (Admin)
     * @param {string[]} statuses - array of statuses
     * @returns {Promise<Array>}
     */
    async getClaimsByStatus(statuses) {
        // Fetch without orderBy to avoid needing a Firestore composite index
        const snapshot = await db.collection('claims')
            .where('status', 'in', statuses)
            .get();

        const claims = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort in memory (newest first)
        claims.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });

        // Fetch associated items for each claim
        for (const claim of claims) {
            if (claim.itemId) {
                try {
                    const itemDoc = await db.collection('items').doc(claim.itemId).get();
                    if (itemDoc.exists) {
                        claim.item = { id: itemDoc.id, ...itemDoc.data() };
                    }
                } catch (e) {
                    console.error("Error fetching item for claim:", e);
                }
            }
        }

        return claims;
    }

    /**
     * Approve a claim
     * @param {string} claimId 
     * @returns {Promise<Object>}
     */
    async approveClaim(claimId) {
        return await db.runTransaction(async (transaction) => {
            const claimRef = db.collection('claims').doc(claimId);
            const claimDoc = await transaction.get(claimRef);

            if (!claimDoc.exists) {
                throw new Error('Claim not found');
            }

            const claimData = claimDoc.data();
            if (claimData.status !== 'pending') {
                throw new Error('Claim is not pending');
            }

            const itemRef = db.collection('items').doc(claimData.itemId);
            // We assume item exists as per prompt flow, but good to check in real world.
            // For this task, we proceed to update.

            transaction.update(claimRef, { status: 'approved' });
            transaction.update(itemRef, { status: 'returned' });

            return { id: claimId, status: 'approved' };
        });
    }

    /**
     * Reject a claim
     * @param {string} claimId 
     * @returns {Promise<Object>}
     */
    async rejectClaim(claimId) {
        const claimRef = db.collection('claims').doc(claimId);

        // Simple update
        await claimRef.update({ status: 'rejected' });
        return { id: claimId, status: 'rejected' };
    }

    /**
     * Add an admin note
     * @param {string} claimId 
     * @param {string} adminUid 
     * @param {string} text 
     */
    async addAdminNote(claimId, adminUid, text) {
        const claimRef = db.collection('claims').doc(claimId);
        const note = {
            adminUid,
            text,
            timestamp: new Date().toISOString()
        };
        await claimRef.update({
            adminNotes: admin.firestore.FieldValue.arrayUnion(note)
        });
        return note;
    }

    /**
     * Get claim evidence (mocked)
     * @param {string} claimId 
     */
    async getClaimEvidence(claimId) {
        // in a real app, fetch from a separate collection or storage
        return {
            aiAnalysis: {
                matchScore: 85,
                details: "High similarity with item #12345"
            },
            cctvClips: [
                "https://example.com/cctv/clip1.mp4"
            ]
        };
    }

    /**
     * Reopen a closed claim
     * @param {string} claimId 
     */
    async reopenClaim(claimId) {
        const claimRef = db.collection('claims').doc(claimId);
        await claimRef.update({
            status: 'pending',
            locked: false
        });
        return { id: claimId, status: 'pending', locked: false };
    }
}

module.exports = new ClaimsService();
