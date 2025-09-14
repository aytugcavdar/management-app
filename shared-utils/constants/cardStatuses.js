module.exports = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review', 
  DONE: 'done',
  ARCHIVED: 'archived',
  
  // Status transitions (hangi status'ten hangi status'e geçilebilir)
  ALLOWED_TRANSITIONS: {
    todo: ['in_progress', 'archived'],
    in_progress: ['todo', 'in_review', 'archived'],
    in_review: ['in_progress', 'done', 'todo'],
    done: ['archived', 'in_review'],
    archived: ['todo']
  },
  
  // Check if transition is allowed
  canTransition: (fromStatus, toStatus) => {
    return module.exports.ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
  }
};