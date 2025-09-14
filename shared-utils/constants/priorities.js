module.exports = {
  LOW: 'low',
  MEDIUM: 'medium', 
  HIGH: 'high',
  URGENT: 'urgent',
  
  // Priority levels (higher number = higher priority)
  LEVELS: {
    low: 1,
    medium: 2,
    high: 3,
    urgent: 4
  },
  
  // Priority colors for UI
  COLORS: {
    low: '#28a745',     // green
    medium: '#ffc107',  // yellow  
    high: '#fd7e14',    // orange
    urgent: '#dc3545'   // red
  }
};