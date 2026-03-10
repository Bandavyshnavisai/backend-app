const { db } = require('../firebaseAdmin');
const groqVision = require('./groqVisionService');
const matchingService = require('./matchingService');
const fetch = require('node-fetch');

class CctvService {

    /**
     * Verify a claim using CCTV logs + Groq AI verdict.
     *
     * Steps:
     *  1. Query cctvLogs for matching zone & ±2-hour window
     *  2. Combine everything into a Groq prompt for final verdict
     *  3. Save result & return
     *
     * @param {string} claimId
     * @returns {Object} { match, confidence, reasoning, verdict }
     */
    async verifyClaim(claimId) {
        // ── 1. Read claim ────────────────────────────────────────────────
        const claimDoc = await db.collection('claims').doc(claimId).get();
        if (!claimDoc.exists) throw new Error('Claim not found');
        const claim = claimDoc.data();

        const zone = claim.zone;
        const timeOfLoss = claim.timeOfLoss;   // e.g. "10:30am"
        const dateOfLoss = claim.dateOfLoss;   // e.g. "2024-01-15"

        if (!zone) throw new Error('Claim is missing zone');
        if (!dateOfLoss) throw new Error('Claim is missing dateOfLoss');

        // ── 2. Build timestamp window ────────────────────────────────────
        // Parse dateOfLoss + timeOfLoss into a Date, then ±2 hours
        let referenceDate;
        if (timeOfLoss) {
            referenceDate = this._parseDateTime(dateOfLoss, timeOfLoss);
        } else {
            referenceDate = new Date(dateOfLoss);
            referenceDate.setHours(12, 0, 0, 0); // default to noon if no time
        }

        const twoHoursMs = 2 * 60 * 60 * 1000;
        const windowStart = new Date(referenceDate.getTime() - twoHoursMs);
        const windowEnd = new Date(referenceDate.getTime() + twoHoursMs);

        // ── 3. Query CCTV logs ───────────────────────────────────────────
        const logsSnapshot = await db.collection('cctvLogs')
            .where('zone', '==', zone)
            .where('timestamp', '>=', windowStart)
            .where('timestamp', '<=', windowEnd)
            .get();

        let formattedLogEntries = 'No CCTV log entries found for this zone and time window.';

        if (!logsSnapshot.empty) {
            const entries = [];
            logsSnapshot.forEach(doc => {
                const data = doc.data();
                const ts = data.timestamp && data.timestamp.toDate
                    ? data.timestamp.toDate()
                    : new Date(data.timestamp);
                const timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const objectsList = (data.objects || []).join(', ');
                entries.push(`${timeStr} - ${objectsList} seen near ${zone}`);
            });
            formattedLogEntries = entries.join('\n');
        }

        // ── 4. Build Groq prompt ─────────────────────────────────────────
        const userPrompt =
            `A user is claiming they lost an item. Here is the context:\n\n` +
            `User description: ${claim.description || 'No description provided'}\n` +
            `Location: ${zone}\n` +
            `Time: ${timeOfLoss || 'Not specified'}\n` +
            `Date: ${dateOfLoss}\n\n` +
            `CCTV log entries from that location and time:\n${formattedLogEntries}\n\n` +
            `Based on all of this, how likely is it that this claim is legitimate?\n` +
            `Return ONLY JSON:\n` +
            `{\n` +
            `  "match": true or false,\n` +
            `  "confidence": 0.0 to 1.0,\n` +
            `  "reasoning": "string",\n` +
            `  "verdict": "likely_valid" or "possibly_valid" or "likely_invalid"\n` +
            `}`;

        const systemPrompt =
            'You are a claim verification AI. Analyze the provided context (CCTV logs, ' +
            'user description) and determine how likely a lost-item claim is legitimate. ' +
            'Return ONLY valid JSON with the fields: match (boolean), confidence (0.0-1.0), ' +
            'reasoning (string), verdict (likely_valid | possibly_valid | likely_invalid).';

        // Text-only prompt
        const verdict = await groqVision.analyzeText(systemPrompt, userPrompt);

        // ── 5. Save and return ───────────────────────────────────────────
        const resultDoc = {
            ...verdict,
            claimId,
            verifiedAt: new Date()
        };

        await db.collection('claims').doc(claimId).collection('cctvVerification').doc('summary').set(resultDoc);

        return verdict;
    }


    /**
     * Parse a date string + time string like "2024-01-15" + "10:30am" into a Date.
     */
    _parseDateTime(dateStr, timeStr) {
        // Start with the date
        const date = new Date(dateStr);

        if (!timeStr) return date;

        // Parse time like "10:30am", "2:15PM", "14:30"
        const cleaned = timeStr.trim().toLowerCase();
        const match = cleaned.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const period = match[3];

            if (period === 'pm' && hours !== 12) hours += 12;
            if (period === 'am' && hours === 12) hours = 0;

            date.setHours(hours, minutes, 0, 0);
        }

        return date;
    }
}

module.exports = new CctvService();
