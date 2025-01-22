const express = require('express');
const http = require('http');
const app = express();
//const port = 3001;
const port = process.env.PORT || 3001;
const server = http.createServer(app);
// Store game state
const gameState = {
    players: new Map(),
    hostClients: new Set(),    // For host connections
    playerClients: new Map(),  // For player connections
    letters: [],
    playerWords: new Map()
};

app.use(express.static('./'));
app.use(express.json());

// Player joins
app.post('/player/join', (req, res) => {
    const { playerName } = req.body;
    const playerId = Math.random().toString(36).substring(2);
    
    gameState.players.set(playerId, {
        id: playerId,
        name: playerName
    });
    
    res.json({ playerId });
    
    // Notify host of new player
    broadcastToHost({
        type: 'player_joined',
        players: Array.from(gameState.players.values())
    });
});

// SSE endpoint for host
app.get('/host/connect', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    gameState.hostClients.add(res);

    // Send current state
    res.write(`data: ${JSON.stringify({
        type: 'initial_state',
        players: Array.from(gameState.players.values()),
        playerWords: Array.from(gameState.playerWords.entries()),
        letters: gameState.letters
    })}\n\n`);

    req.on('close', () => {
        gameState.hostClients.delete(res);
    });
});

// SSE endpoint for players
app.get('/player/connect/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Store the client connection
    gameState.playerClients.set(playerId, res);

    // Send current letters if they exist
    if (gameState.letters.length > 0) {
        res.write(`data: ${JSON.stringify({
            type: 'letters_update',
            letters: gameState.letters
        })}\n\n`);
    }

    req.on('close', () => {
        gameState.playerClients.delete(playerId);
    });
});

// Update letters
app.post('/host/update-letters', (req, res) => {
    const { letters } = req.body;
    gameState.letters = letters;
    
    const message = `data: ${JSON.stringify({
        type: 'letters_update',
        letters: letters
    })}\n\n`;

    // Broadcast to host clients
    gameState.hostClients.forEach(client => {
        client.write(message);
    });

    // Broadcast to all player clients
    gameState.playerClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            console.error('Error sending to player:', error);
        }
    });

    res.json({ success: true });
});

// Submit words
app.post('/player/submit-words', (req, res) => {
    const { playerId, words } = req.body;
    const player = gameState.players.get(playerId);
    
    if (player) {
        gameState.playerWords.set(playerId, {
            playerName: player.name,
            words: words
        });

        // Notify host of new submission
        broadcastToHost({
            type: 'words_submitted',
            playerName: player.name,
            words: words
        });

        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Player not found' });
    }
});

// Remove specific player
app.post('/host/remove-player/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    
    // Close and remove player's SSE connection
    const playerClient = gameState.playerClients.get(playerId);
    if (playerClient) {
        try {
            playerClient.end();
        } catch (error) {
            console.error('Error closing player connection:', error);
        }
        gameState.playerClients.delete(playerId);
    }
    
    gameState.players.delete(playerId);
    gameState.playerWords.delete(playerId);
    
    // Notify host of updated player list
    broadcastToHost({
        type: 'player_joined',
        players: Array.from(gameState.players.values())
    });
    
    res.json({ success: true });
});

// Clear all players
app.post('/host/clear-all-players', (req, res) => {
    // Close all player SSE connections
    gameState.playerClients.forEach((client, playerId) => {
        try {
            client.end();
        } catch (error) {
            console.error(`Error closing connection for player ${playerId}:`, error);
        }
    });
    
    // Clear all game state
    gameState.players.clear();
    gameState.playerWords.clear();
    gameState.playerClients.clear();
    
    // Notify host of empty player list
    broadcastToHost({
        type: 'player_joined',
        players: []
    });
    
    res.json({ success: true });
});

// Helper function to broadcast to host
function broadcastToHost(data) {
    gameState.hostClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error('Error broadcasting to host:', error);
            gameState.hostClients.delete(client);
        }
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});