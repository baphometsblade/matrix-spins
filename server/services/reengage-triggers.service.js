/**
 * Re-engagement triggers for player retention
 * Fires popup/notification when player shows signs of leaving
 */
const db = require('../database');

const TRIGGERS = {
    LOW_BALANCE: { threshold: 2, message: 'Your balance is running low! Deposit now for a 25% reload bonus!', type: 'deposit_prompt' },
    LOSS_STREAK: { threshold: 5, message: 'Luck changes! Spin again for a chance at our progressive jackpot!', type: 'encouragement' },
    IDLE_WARNING: { seconds: 180, message: 'Still there? Your lucky streak awaits!', type: 'idle_nudge' },
    SESSION_MILESTONE: { spins: 50, message: 'You have earned 50 loyalty points this session! Keep spinning for rewards!', type: 'milestone' },
    NEAR_JACKPOT: { message: 'The Grand Jackpot is at its highest ever! One spin could change everything!', type: 'jackpot_tease' }
};

async function checkTriggers(userId, sessionData) {
    const triggers = [];
    
    if (sessionData.balance < TRIGGERS.LOW_BALANCE.threshold) {
        triggers.push(TRIGGERS.LOW_BALANCE);
    }
    
    if (sessionData.consecutiveLosses >= TRIGGERS.LOSS_STREAK.threshold) {
        triggers.push(TRIGGERS.LOSS_STREAK);
    }
    
    if (sessionData.spinCount > 0 && sessionData.spinCount % TRIGGERS.SESSION_MILESTONE.spins === 0) {
        triggers.push(TRIGGERS.SESSION_MILESTONE);
    }
    
    return triggers;
}

module.exports = { checkTriggers, TRIGGERS };