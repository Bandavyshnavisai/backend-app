const fetch = require('node-fetch');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const apiKey = process.env.GROQ_API_KEY;
const apiUrl = 'https://api.groq.com/openai/v1/chat/completions';

async function listModels() {
    console.log("--- Listing Models ---");
    try {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        if (data.data) {
            const visionModels = data.data.filter(m => m.id.toLowerCase().includes('vision') || m.id.toLowerCase().includes('llama-4'));
            console.log("Available Vision/Llama-4 Models:");
            visionModels.forEach(m => console.log(` - ${m.id}`));
        } else {
            console.log("Error listing models:", data);
        }
    } catch (err) {
        console.error("Failed to list models:", err.message);
    }
}

async function testVision(modelName) {
    console.log(`\n--- Testing Model: ${modelName} ---`);
    const payload = {
        model: modelName,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "What is in this image?" },
                    { type: "image_url", image_url: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gnome-face-smile.svg/1024px-Gnome-face-smile.svg.png" } }
                ]
            }
        ],
        max_tokens: 100
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (response.ok) {
            console.log(`✅ Success with ${modelName}:`, data.choices[0].message.content);
        } else {
            console.log(`❌ Error with ${modelName}:`, response.status, JSON.stringify(data.error));
        }
    } catch (err) {
        console.error(`💥 Failed with ${modelName}:`, err.message);
    }
}

async function run() {
    if (!apiKey) {
        console.error("GROQ_API_KEY missing in .env");
        return;
    }
    await listModels();
    await testVision("meta-llama/llama-4-scout-17b-16e-instruct");
    await testVision("llama-3.2-11b-vision-preview");
}

run();
