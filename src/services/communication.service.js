const { db, admin } = require('../config/firebase');
const groqVisionService = require('./groqVisionService');

class CommunicationService {
    /**
     * Send a message (Chat)
     * @param {string} claimId 
     * @param {string} senderUid 
     * @param {string} content 
     * @param {boolean} isProofRequest 
     */
    async sendMessage(claimId, senderUid, content, isProofRequest = false) {
        if (!content || !content.trim()) throw new Error('Message content cannot be empty');

        // Verify claim exists
        const claimDoc = await db.collection('claims').doc(claimId).get();
        if (!claimDoc.exists) throw new Error('Claim not found');

        const message = {
            claimId,
            senderUid,
            content: content.trim(),
            isProofRequest,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('messages').add(message);

        // If message is from a normal user, trigger the AI bot reply
        if (senderUid !== 'bot' && !isProofRequest) {
            // Check if sender is an admin from their custom claims/role if needed, 
            // but for a simple chatbot we can trigger it asynchronously.
            this.generateBotReply(claimId, content).catch(console.error);
        }

        return {
            id: docRef.id,
            ...message,
            senderId: senderUid, // Add senderId for frontend interface compatibility
            timestamp: new Date().toISOString()
        };
    }

    async generateBotReply(claimId, userAction) {
        try {
            const systemPrompt = "You are a helpful customer support AI for a campus lost and found system. A user has opened a claim for a lost item and is messaging you. Keep your answer brief, friendly, and helpful (under 2 sentences).";

            // Get response from Llama through Groq
            // Since groqVisionService.analyzeText returns JSON if instructed, we just want raw text here,
            // but the service tries to parse JSON. Let's pass a prompt asking for JSON format.
            const userPrompt = `Message from user: "${userAction}". Reply with a valid JSON object strictly in this format: {"reply": "your message here"}`;

            const responseData = await groqVisionService.analyzeText(systemPrompt, userPrompt);
            const botMessageText = responseData.reply || "I'm sorry, I'm having trouble understanding right now.";

            // Save bot message to DB
            const message = {
                claimId,
                senderUid: 'bot',
                content: botMessageText,
                isProofRequest: false,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('messages').add(message);
        } catch (error) {
            console.error("Bot reply error:", error);
            // Fallback message
            await db.collection('messages').add({
                claimId,
                senderUid: 'bot',
                content: "I'll make sure an admin reviews your message shortly.",
                isProofRequest: false,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    }

    /**
     * Get message history for a claim
     * @param {string} claimId 
     */
    async getMessages(claimId) {
        try {
            const snapshot = await db.collection('messages')
                .where('claimId', '==', claimId)
                .get();

            const messages = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Ensure serializable data if needed, though getMessages is usually read-only
                };
            });

            // Manual sort to avoid index requirement for where + orderBy
            return messages.sort((a, b) => {
                const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime();
                const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime();
                return timeA - timeB;
            });
        } catch (error) {
            console.error('getMessages error:', error);
            throw error;
        }
    }

    /**
     * Request proof from claimant
     * @param {string} claimId 
     * @param {string} adminUid 
     */
    async requestProof(claimId, adminUid) {
        return this.sendMessage(claimId, adminUid, "Please upload additional proof of ownership.", true);
    }
}

module.exports = new CommunicationService();
